/**
 * Unidades: llevarlas a una base comun y negarse cuando no se pueden comparar.
 *
 * ## Por que una base y no una tabla de pares
 *
 * Comparar «250 ml» con «1 tz» pide una sola cosa: un numero en la misma
 * unidad a cada lado. Con una base por sistema —ml para volumen, g para
 * masa— cada unidad necesita UN factor, y agregar «pinta» es una linea. Una
 * tabla de conversiones de par en par necesitaria una entrada por combinacion
 * y crece al cuadrado.
 *
 * ## Lo que este modulo NO hace: inventar densidades
 *
 * No hay conversion entre sistemas. Una taza de arroz no son 240 g ni 90 ml de
 * leche son 90 g: eso depende de la densidad del alimento, que el documento de
 * intercambios no da. Cuando el profesional escribe mililitros y la fila de
 * referencia esta en unidades —«1 unidad mediana»—, la division correcta no
 * existe, y la respuesta correcta es decirlo.
 *
 * Es la diferencia que convierte «250 ml de leche» en 1.04 porciones y no en
 * 250: dividir un volumen entre una cuenta da un numero que se multiplica igual
 * que uno bueno y despues nadie lo distingue.
 */

/** El sistema de una unidad. Solo se divide dentro del mismo. */
export type Sistema = 'volumen' | 'masa' | 'unidades'

export interface Medida {
  sistema: Sistema
  /** El valor en la base del sistema: ml, g, o la cuenta tal cual. */
  base: number
  /** La unidad como se escribio, normalizada. null = un numero sin unidad. */
  unidad: string | null
}

/**
 * Volumen, base ml. Los nombres largos y las abreviaturas del documento
 * («tz», «cda», «cdta») valen lo mismo porque son lo mismo.
 */
const A_ML: Record<string, number> = {
  taza: 240,
  tazas: 240,
  tz: 240,
  tzs: 240,
  cucharada: 15,
  cucharadas: 15,
  cda: 15,
  cdas: 15,
  cucharadita: 5,
  cucharaditas: 5,
  cdta: 5,
  cdtas: 5,
  ml: 1,
  mililitro: 1,
  mililitros: 1,
  cc: 1,
  litro: 1000,
  litros: 1000,
  l: 1000,
}

/** Masa, base g. La onza es la avoirdupois: 28.35 g, la del documento. */
const A_G: Record<string, number> = {
  g: 1,
  gr: 1,
  grs: 1,
  gramo: 1,
  gramos: 1,
  oz: 28.35,
  onza: 28.35,
  onzas: 28.35,
  kg: 1000,
  kilo: 1000,
  kilos: 1000,
  libra: 453.59,
  libras: 453.59,
  lb: 453.59,
}

/**
 * Sin acentos, en minusculas y sin puntos.
 *
 * Nadie escribe la misma unidad dos veces igual: «Tz.», «tz», «TZ». Y la
 * busqueda de equivalencias ya normaliza asi (ver `alimento_texto_busqueda` en
 * la migracion 026), de modo que este modulo no introduce un criterio nuevo.
 */
export function normalizarUnidad(bruta: string | null | undefined): string | null {
  if (bruta === null || bruta === undefined) return null
  const limpia = bruta
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
  return limpia === '' ? null : limpia
}

/**
 * Una cantidad con su unidad, convertida a la base de su sistema.
 *
 * Devuelve null cuando la cantidad no sirve para dividir: cero, negativa, o no
 * numerica. Un cero en el divisor da infinito y un infinito multiplicado por
 * los valores de un grupo sigue siendo un numero que se puede guardar.
 *
 * **Una unidad desconocida cae en `unidades`, no se descarta.** El documento
 * mide en rebanadas, paquetes, dedos, galletas y «unidades medianas»: son
 * cuentas, y dos cuentas se dividen entre si. Lo que importa es que una cuenta
 * NO se divida contra un volumen, y de eso se encarga `compatibles`.
 */
export function medir(cantidad: number | null, unidad: string | null): Medida | null {
  if (cantidad === null || !Number.isFinite(cantidad) || cantidad <= 0) return null
  const u = normalizarUnidad(unidad)

  if (u === null) return { sistema: 'unidades', base: cantidad, unidad: null }

  const ml = A_ML[u]
  if (ml !== undefined) return { sistema: 'volumen', base: cantidad * ml, unidad: u }

  const g = A_G[u]
  if (g !== undefined) return { sistema: 'masa', base: cantidad * g, unidad: u }

  return { sistema: 'unidades', base: cantidad, unidad: u }
}

/** Dos medidas se dividen solo si miden lo mismo. */
export function compatibles(a: Medida, b: Medida): boolean {
  return a.sistema === b.sistema
}

/** Las fracciones del documento, que vienen como glifo y no como «1/2». */
const FRACCIONES: Record<string, number> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
}

/**
 * La PRIMERA cantidad de un texto y la palabra que la sigue.
 *
 * Que sea la primera importa: «1 unidad de 15 cm» tiene dos numeros y el que
 * cuenta es el 1 —una unidad—, no los 15 centimetros, que describen la unidad
 * en vez de contarla. Tomar el ultimo numero convertiria un pejibaye en quince.
 */
export function partirCantidad(texto: string): { cantidad: number; unidad: string | null } | null {
  const t = texto.trim()
  if (t === '') return null

  const glifo = Object.keys(FRACCIONES).find((f) => t.includes(f))
  if (glifo !== undefined) {
    const resto = t.slice(t.indexOf(glifo) + glifo.length)
    return { cantidad: FRACCIONES[glifo]!, unidad: palabraInicial(resto) }
  }

  const quebrado = t.match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/)
  if (quebrado) {
    const a = Number(quebrado[1]!.replace(',', '.'))
    const b = Number(quebrado[2]!.replace(',', '.'))
    if (b !== 0) {
      return { cantidad: a / b, unidad: palabraInicial(t.slice(quebrado.index! + quebrado[0].length)) }
    }
  }

  const simple = t.match(/\d+(?:[.,]\d+)?/)
  if (!simple) return null
  return {
    cantidad: Number(simple[0].replace(',', '.')),
    unidad: palabraInicial(t.slice(simple.index! + simple[0].length)),
  }
}

/** La primera palabra de un texto, o null si no empieza por una. */
function palabraInicial(resto: string): string | null {
  const m = resto.match(/^\s*([a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]+)/)
  return m ? m[1]! : null
}

/**
 * Las lecturas posibles de una porcion de referencia, para elegir despues la
 * que corresponda al sistema en el que escribio el profesional.
 *
 * Son DOS porque una fila del documento puede traer las dos: «arroz blanco, ½
 * tz, 90 g» se puede leer como 120 ml o como 90 g, y las dos son correctas. Con
 * cual se divide lo decide lo que escribio el profesional —«1 taza» pide la
 * volumetrica, «180 g» pide la de masa—, no un orden fijo.
 *
 * Fijar el orden era el defecto sutil: preferir siempre los gramos convierte «1
 * taza de arroz» en un problema sin solucion (tazas contra gramos), cuando la
 * misma fila trae una lectura en tazas que divide exacto.
 */
export function lecturasReferencia(
  cantidadDescripcion: string,
  cantidadG: number | null,
): Medida[] {
  const lecturas: Medida[] = []

  const desc = partirCantidad(cantidadDescripcion)
  const deDesc = desc ? medir(desc.cantidad, desc.unidad) : null
  if (deDesc) lecturas.push(deDesc)

  if (cantidadG !== null && Number.isFinite(cantidadG) && cantidadG > 0) {
    const enMasa = { sistema: 'masa' as const, base: cantidadG, unidad: 'g' }
    // No se duplica cuando la descripcion ya era gramos («30 g o 1 oz»): la
    // columna y el texto dicen lo mismo y la columna es la autoritativa.
    const i = lecturas.findIndex((l) => l.sistema === 'masa')
    if (i === -1) lecturas.push(enMasa)
    else lecturas[i] = enMasa
  }

  return lecturas
}

/** La lectura de referencia que se puede dividir contra lo que se escribio. */
export function elegirReferencia(usuario: Medida, lecturas: Medida[]): Medida | null {
  return lecturas.find((l) => compatibles(usuario, l)) ?? null
}
