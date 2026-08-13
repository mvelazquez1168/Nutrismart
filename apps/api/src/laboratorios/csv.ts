/**
 * Parseo de CSV de laboratorio.
 *
 * Lo que sale de aqui NUNCA se guarda directamente: alimenta una
 * pantalla de revision donde el profesional confirma o corrige. Un
 * decimal mal leido en un laboratorio no es un error cosmetico.
 *
 * El formato "oficial" es `biomarcador,valor`, pero un CSV real llega
 * de Excel en español, de un sistema del laboratorio o de una
 * exportacion manual. Se toleran las variaciones que aparecen de
 * verdad; lo que no se reconoce se devuelve aparte, nunca se descarta
 * en silencio.
 */

export interface FilaReconocida {
  codigo: string
  nombre: string
  unidad: string
  valor: number
}

export interface FilaNoReconocida {
  etiqueta: string
  valor: string
}

export interface ResultadoParseo {
  reconocidos: FilaReconocida[]
  noReconocidos: FilaNoReconocida[]
  avisos: string[]
}

export interface BiomarcadorConocido {
  codigo: string
  nombre: string
  unidad: string
}

/** Marca de orden de bytes que Excel antepone en sus CSV UTF-8. */
const BOM = String.fromCharCode(0xfeff)

/** Inicio y fin del bloque Unicode de marcas diacriticas combinantes. */
const DIACRITICO_MIN = 0x0300
const DIACRITICO_MAX = 0x036f

/**
 * Sin acentos, sin mayusculas, sin espacios de mas: para comparar
 * etiquetas de laboratorio con el catalogo.
 *
 * Los diacriticos se descartan por PUNTO DE CODIGO, no con un rango de
 * caracteres literales dentro de una expresion regular: escritos tal
 * cual dependerian de como se guarde este archivo y podrian dejar de
 * coincidir sin que nada avise.
 */
function normalizar(texto: string): string {
  let salida = ''
  for (const caracter of texto.normalize('NFD')) {
    const punto = caracter.codePointAt(0) ?? 0
    if (punto >= DIACRITICO_MIN && punto <= DIACRITICO_MAX) continue
    salida += caracter
  }
  return salida.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Excel en español exporta con punto y coma, porque la coma es el
 * separador decimal. Se decide por la linea de cabecera, que es donde
 * el separador aparece con seguridad.
 */
function detectarSeparador(cabecera: string): ';' | ',' | '\t' {
  const tabs = (cabecera.match(/\t/g) ?? []).length
  const puntoYComa = (cabecera.match(/;/g) ?? []).length
  const comas = (cabecera.match(/,/g) ?? []).length

  if (tabs > 0 && tabs >= puntoYComa && tabs >= comas) return '\t'
  if (puntoYComa >= comas) return ';'
  return ','
}

/**
 * Convierte a numero admitiendo la coma decimal.
 *
 * Solo cuando el separador de columnas NO es la coma: con separador
 * coma, un "1,5" seria dos columnas y no un decimal, y adivinarlo
 * produciria valores inventados.
 */
function aNumero(bruto: string, separador: string): number | null {
  let texto = bruto.trim().replace(/\s/g, '')
  if (texto === '') return null

  // Algunos informes traen "< 5" o "> 200": no son un valor medido.
  if (/^[<>]/.test(texto)) return null

  if (separador !== ',') texto = texto.replace(',', '.')

  const n = Number(texto)
  return Number.isFinite(n) ? n : null
}

/** Parte una linea respetando comillas dobles. */
function partirLinea(linea: string, separador: string): string[] {
  const campos: string[] = []
  let actual = ''
  let entreComillas = false

  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]
    if (c === '"') {
      if (entreComillas && linea[i + 1] === '"') {
        actual += '"'
        i++
      } else {
        entreComillas = !entreComillas
      }
    } else if (c === separador && !entreComillas) {
      campos.push(actual)
      actual = ''
    } else {
      actual += c
    }
  }
  campos.push(actual)
  return campos.map((c) => c.trim())
}

export function parsearCsv(
  contenido: Buffer,
  catalogo: BiomarcadorConocido[],
): ResultadoParseo {
  // Excel antepone un BOM en sus exportaciones UTF-8. Sin quitarlo, la
  // primera etiqueta nunca coincide con nada y el fallo es invisible:
  // el archivo "se importa bien" pero le falta el primer analito.
  const crudo = contenido.toString('utf8')
  const texto = crudo.startsWith(BOM) ? crudo.slice(BOM.length) : crudo

  const lineas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')

  const reconocidos: FilaReconocida[] = []
  const noReconocidos: FilaNoReconocida[] = []
  const avisos: string[] = []

  if (lineas.length === 0) {
    return { reconocidos, noReconocidos, avisos: ['El archivo está vacío'] }
  }

  const separador = detectarSeparador(lineas[0] ?? '')

  // Indice por codigo y por nombre normalizado: los laboratorios
  // exportan "Glucosa en ayunas", no "glucosa_ayunas".
  const porClave = new Map<string, BiomarcadorConocido>()
  for (const b of catalogo) {
    porClave.set(normalizar(b.codigo), b)
    porClave.set(normalizar(b.nombre), b)
  }

  const primera = partirLinea(lineas[0] ?? '', separador).map(normalizar)
  const tieneCabecera =
    primera.includes('biomarcador') ||
    primera.includes('analito') ||
    primera.includes('prueba') ||
    primera.includes('examen')

  if (!tieneCabecera) {
    avisos.push(
      'No se encontró una cabecera "biomarcador,valor". Se interpretaron todas las filas como datos.',
    )
  }

  const filas = tieneCabecera ? lineas.slice(1) : lineas
  const desplazamiento = tieneCabecera ? 2 : 1
  const vistos = new Set<string>()

  filas.forEach((linea, i) => {
    const numeroLinea = i + desplazamiento
    const campos = partirLinea(linea, separador)

    const etiqueta = campos[0] ?? ''
    const bruto = campos[1] ?? ''

    if (etiqueta === '') return

    const conocido = porClave.get(normalizar(etiqueta))
    if (!conocido) {
      noReconocidos.push({ etiqueta, valor: bruto })
      return
    }

    const valor = aNumero(bruto, separador)
    if (valor === null) {
      avisos.push(`Línea ${numeroLinea}: "${etiqueta}" no tiene un valor numérico ("${bruto}")`)
      noReconocidos.push({ etiqueta, valor: bruto })
      return
    }

    // Un mismo analito dos veces en el archivo: se queda el primero y
    // se avisa, en vez de que el ultimo pise al anterior sin decir nada.
    if (vistos.has(conocido.codigo)) {
      avisos.push(`Línea ${numeroLinea}: "${conocido.nombre}" aparece repetido; se ignoró`)
      return
    }
    vistos.add(conocido.codigo)

    reconocidos.push({
      codigo: conocido.codigo,
      nombre: conocido.nombre,
      unidad: conocido.unidad,
      valor,
    })
  })

  if (reconocidos.length === 0 && noReconocidos.length > 0) {
    avisos.push(
      'No se reconoció ningún analito. Revisa que la primera columna tenga el nombre o el código del biomarcador.',
    )
  }

  return { reconocidos, noReconocidos, avisos }
}
