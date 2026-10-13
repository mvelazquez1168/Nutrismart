/**
 * El sistema de intercambios: buscar el alimento, resolver las porciones y
 * multiplicar.
 *
 * ## Quien calcula
 *
 * **El codigo, no el modelo.** Hasta la 048 los once grupos vivian escritos en
 * un prompt y el modelo hacia todo: identificaba, clasificaba, multiplicaba y
 * sumaba. Ahora los valores son filas de `grupo_intercambio` y la aritmetica
 * ocurre aca.
 *
 * No es una preferencia de estilo. El requerimiento pide que el calculo se base
 * *exclusivamente* en el documento de intercambios, y eso solo es verificable si
 * la multiplicacion la hace codigo contra una tabla: mientras el modelo sume,
 * «exclusivamente» es una instruccion dentro de una cadena de texto, y nadie
 * puede comprobar de donde salio un numero.
 *
 * Al modelo le queda **leer el texto libre y partirlo en alimentos con su
 * cantidad**. Ni siquiera le queda asignar el grupo: el grupo sale de la tabla
 * al encontrar el alimento, asi que es el del documento y no la opinion del
 * modelo.
 *
 * ## Que pasa cuando no se encuentra
 *
 * Se devuelve `encontrado: false` y **no se inventa un numero**. Antes un
 * alimento que el modelo no sabia clasificar llegaba como `0` —`parsearJson`
 * convertia cualquier cosa no numerica en cero— y en pantalla se veia igual que
 * un alimento sin calorias. Un cero que significa «no se» es la peor forma de
 * no saber.
 */
import { pool } from '../db.js'

export interface GrupoIntercambio {
  nombre: string
  choG: number
  chonG: number
  grasaG: number
  kcal: number
}

export interface Macros {
  cho_g: number
  chon_g: number
  grasa_g: number
  kcal: number
}

export interface PorcionDeGrupo {
  grupo_id: string
  cantidad_decimal: number
}

export interface Equivalencia {
  alimento: string
  cantidadDescripcion: string
  cantidadG: number | null
  subtipo: string | null
  porciones: PorcionDeGrupo[]
}

/** Lo que el resolvedor dice de un alimento pedido. */
export interface AlimentoResuelto {
  /** Lo que escribio el profesional, tal cual. */
  pedido: string
  cantidadPedida: string | null
  encontrado: boolean
  /** La fila del documento que se uso, si se encontro. */
  equivalencia: Equivalencia | null
  /**
   * Cuantas veces la porcion de referencia. 2 = el doble de lo que dice la
   * fila del documento.
   */
  factor: number
  /**
   * `true` cuando no se pudo deducir el factor de la cantidad escrita y se
   * asumio una porcion. Viaja hasta la pantalla: una suposicion silenciosa en
   * un calculo clinico es indistinguible de una medicion.
   */
  factorSupuesto: boolean
  macros: Macros
}

const CERO: Macros = { cho_g: 0, chon_g: 0, grasa_g: 0, kcal: 0 }

/** Dos decimales: mas precision que eso es falsa para una tabla de intercambios. */
function redondear(n: number): number {
  return Math.round(n * 100) / 100
}

export function sumarMacros(partes: Macros[]): Macros {
  const t = partes.reduce(
    (acc, m) => ({
      cho_g: acc.cho_g + m.cho_g,
      chon_g: acc.chon_g + m.chon_g,
      grasa_g: acc.grasa_g + m.grasa_g,
      kcal: acc.kcal + m.kcal,
    }),
    CERO,
  )
  return {
    cho_g: redondear(t.cho_g),
    chon_g: redondear(t.chon_g),
    grasa_g: redondear(t.grasa_g),
    kcal: redondear(t.kcal),
  }
}

/**
 * Los grupos visibles para una clinica: los globales mas los propios.
 *
 * El propio gana cuando coincide el nombre, que es para lo que existe la
 * columna `clinica_id`: una clinica puede ajustar un grupo sin tocar el de
 * nadie.
 */
export async function leerGrupos(clinicaId: string): Promise<Map<string, GrupoIntercambio>> {
  const { rows } = await pool.query<{
    nombre: string
    cho_g: string
    chon_g: string
    grasa_g: string
    kcal: string
    propio: boolean
  }>(
    `select nombre, cho_g, chon_g, grasa_g, kcal, (clinica_id is not null) as propio
       from grupo_intercambio
      where clinica_id is null or clinica_id = $1
      order by (clinica_id is not null)`,
    [clinicaId],
  )

  const mapa = new Map<string, GrupoIntercambio>()
  for (const f of rows) {
    // El `order by` pone los propios al final, asi que sobreescriben al global.
    mapa.set(f.nombre.toLowerCase(), {
      nombre: f.nombre,
      choG: Number(f.cho_g),
      chonG: Number(f.chon_g),
      grasaG: Number(f.grasa_g),
      kcal: Number(f.kcal),
    })
  }
  return mapa
}

interface FilaEquivalencia {
  alimento: string
  cantidad_descripcion: string
  cantidad_g: string | null
  subtipo: string | null
  porciones_json: PorcionDeGrupo[]
}

function aEquivalencia(f: FilaEquivalencia): Equivalencia {
  return {
    alimento: f.alimento,
    cantidadDescripcion: f.cantidad_descripcion,
    cantidadG: f.cantidad_g === null ? null : Number(f.cantidad_g),
    subtipo: f.subtipo,
    porciones: f.porciones_json,
  }
}

/**
 * Busca el alimento, en tres pasos y en este orden.
 *
 * 1. Exacto, sin acentos ni mayusculas.
 * 2. Contenido **con cobertura**: «arroz blanco cocido» encuentra «arroz
 *    blanco». Ver abajo por que la cobertura no es opcional.
 * 3. Parecido por trigramas, con un umbral alto.
 *
 * El umbral de 0.45 no es arbitrario y conviene saber de que lado se equivoca:
 * es lo bastante alto para que «natilla» no encuentre «mantequilla», y eso
 * significa que ante la duda **no encuentra** en vez de encontrar mal. Para un
 * calculo clinico, un «no encontrado» que el profesional corrige es mejor que
 * un acierto plausible que nadie revisa.
 *
 * ## La cobertura, que me la encontro una prueba
 *
 * La primera version aceptaba cualquier contencion, y «pizza con piña»
 * encontraba «piña»: el calculo devolvia **1 fruta — 15 g de CHO y 60 kcal —
 * para una pizza**, y se veia perfectamente razonable. Es el peor modo de
 * fallar de los dos que hay aca: no encontrar se ve; encontrar mal no.
 *
 * Asi que la coincidencia por contencion exige cubrir al menos el 60 % de lo
 * que se escribio. «arroz blanco» cubre 12 de 19 caracteres de «arroz blanco
 * cocido» y pasa; «piña» cubre 4 de 14 de «pizza con piña» y no.
 */
const COBERTURA_MINIMA = 0.6
export async function buscarEquivalencia(
  clinicaId: string,
  alimento: string,
): Promise<Equivalencia | null> {
  const texto = alimento.trim()
  if (texto === '') return null

  const { rows } = await pool.query<FilaEquivalencia>(
    `with candidatas as (
       select alimento, cantidad_descripcion, cantidad_g, subtipo, porciones_json,
              (clinica_id is not null) as propio,
              alimento_texto_busqueda(alimento, '{}'::text[]) as buscable
         from equivalencia_intercambio
        where activo = true and (clinica_id is null or clinica_id = $1)
     ),
     pedido as (select alimento_texto_busqueda($2, '{}'::text[]) as q)
     select c.alimento, c.cantidad_descripcion, c.cantidad_g, c.subtipo, c.porciones_json
       from candidatas c, pedido p
      where c.buscable = p.q
         or (p.q like '%' || c.buscable || '%'
             and length(c.buscable)::numeric / greatest(length(p.q), 1) >= $3)
         or similarity(c.buscable, p.q) >= 0.45
      order by c.propio desc,
               (c.buscable = p.q) desc,
               (p.q like '%' || c.buscable || '%') desc,
               similarity(c.buscable, p.q) desc,
               length(c.buscable) desc
      limit 1`,
    [clinicaId, texto, COBERTURA_MINIMA],
  )

  const f = rows[0]
  return f ? aEquivalencia(f) : null
}

/** El primer numero de un texto, aceptando coma decimal y las fracciones del documento. */
const FRACCIONES: Record<string, number> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
}

export function numeroDeTexto(texto: string): number | null {
  for (const [glifo, valor] of Object.entries(FRACCIONES)) {
    if (texto.includes(glifo)) return valor
  }
  const m = texto.match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/)
  if (m) {
    const a = Number(m[1]!.replace(',', '.'))
    const b = Number(m[2]!.replace(',', '.'))
    if (b !== 0) return a / b
  }
  const simple = texto.match(/\d+(?:[.,]\d+)?/)
  return simple ? Number(simple[0].replace(',', '.')) : null
}

/** Los gramos explicitos de un texto: «90 g», «120 ml». */
export function gramosDeTexto(texto: string): number | null {
  const m = texto.match(/(\d+(?:[.,]\d+)?)\s*(?:g|gr|gramos|ml)\b/i)
  return m ? Number(m[1]!.replace(',', '.')) : null
}

/**
 * Cuantas porciones de referencia hay en lo que se escribio.
 *
 * Tres caminos, del mas confiable al menos:
 *
 * 1. **Gramos contra gramos.** Si lo pedido trae gramos y la fila del documento
 *    tambien, es una division y no hay nada que suponer.
 * 2. **Numero contra numero**, cuando la unidad coincide en espiritu: «2
 *    rebanadas» contra «1 rebanada». Es lo que hace que escribir «2 tz» cuente
 *    el doble que «1 tz».
 * 3. **Una porcion**, y se marca `factorSupuesto`. Pasa con «1 paquete» o «4
 *    dedos» cuando lo pedido no trae numero comparable.
 *
 * Lo que NO hace: convertir unidades. Nadie deduce aca cuantos gramos tiene una
 * taza de arroz, porque el documento no lo dice y un gramaje supuesto se
 * multiplica igual que uno medido y despues no se distingue del real.
 */
export function calcularFactor(
  cantidadPedida: string | null,
  equivalencia: Equivalencia,
): { factor: number; supuesto: boolean } {
  if (cantidadPedida === null || cantidadPedida.trim() === '') {
    return { factor: 1, supuesto: true }
  }

  const gramosPedidos = gramosDeTexto(cantidadPedida)
  if (gramosPedidos !== null && equivalencia.cantidadG !== null && equivalencia.cantidadG > 0) {
    return { factor: redondear(gramosPedidos / equivalencia.cantidadG), supuesto: false }
  }

  const nPedido = numeroDeTexto(cantidadPedida)
  const nRef = numeroDeTexto(equivalencia.cantidadDescripcion)
  if (nPedido !== null && nRef !== null && nRef > 0) {
    return { factor: redondear(nPedido / nRef), supuesto: false }
  }

  return { factor: 1, supuesto: true }
}

/** Aplica las porciones del documento contra los valores del grupo. */
export function macrosDePorciones(
  porciones: PorcionDeGrupo[],
  factor: number,
  grupos: Map<string, GrupoIntercambio>,
): Macros {
  const partes: Macros[] = []
  for (const p of porciones) {
    const g = grupos.get(String(p.grupo_id).toLowerCase())
    if (!g) {
      // El disparador de la 048 lo impide al escribir, asi que llegar aca
      // significa que alguien borro un grupo que una equivalencia nombra. Se
      // omite en vez de contar cero en silencio... y se deja constancia.
      console.warn('[intercambios] porciones_json nombra un grupo inexistente: %s', p.grupo_id)
      continue
    }
    const n = Number(p.cantidad_decimal) * factor
    partes.push({
      cho_g: g.choG * n,
      chon_g: g.chonG * n,
      grasa_g: g.grasaG * n,
      kcal: g.kcal * n,
    })
  }
  return sumarMacros(partes)
}

/** Un alimento con su cantidad, resuelto de punta a punta. */
export async function resolverAlimento(
  clinicaId: string,
  alimento: string,
  cantidad: string | null,
  grupos?: Map<string, GrupoIntercambio>,
): Promise<AlimentoResuelto> {
  const tabla = grupos ?? (await leerGrupos(clinicaId))
  const equivalencia = await buscarEquivalencia(clinicaId, alimento)

  if (!equivalencia) {
    return {
      pedido: alimento,
      cantidadPedida: cantidad,
      encontrado: false,
      equivalencia: null,
      factor: 0,
      factorSupuesto: false,
      macros: CERO,
    }
  }

  const { factor, supuesto } = calcularFactor(cantidad, equivalencia)
  return {
    pedido: alimento,
    cantidadPedida: cantidad,
    encontrado: true,
    equivalencia,
    factor,
    factorSupuesto: supuesto,
    macros: macrosDePorciones(equivalencia.porciones, factor, tabla),
  }
}
