/**
 * FASE 1 — el modelo identifica, y nada mas.
 *
 * ## Que cambia respecto a la busqueda por trigramas
 *
 * La busqueda en Postgres (`buscarEquivalencia`) compara cadenas: «arroz
 * cocido» y «arroz blanco» comparten pocos trigramas y no se encuentran, aunque
 * para un nutricionista sean lo mismo. Eso es lo que el modelo hace bien y una
 * funcion de similitud no puede hacer: reconocer que «leche descremada» es la
 * fila «leche 0% grasa».
 *
 * Asi que el modelo elige la fila. Y solo eso: se le entrega el catalogo
 * numerado y devuelve el numero.
 *
 * ## Por que el indice y no el uuid
 *
 * El catalogo se numera 1..N en cada llamada y el indice se traduce a uuid
 * aca. Un uuid dentro de un prompt es una cadena de 36 caracteres sin
 * significado que el modelo puede copiar con un digito cambiado; el resultado
 * seria otra fila existente —otro alimento— y el calculo saldria plausible.
 * Un indice fuera de rango, en cambio, no resuelve a nada y se detecta.
 *
 * ## Lo que se cree del modelo y lo que no
 *
 * Del modelo se toma lo que solo el puede dar: **que fila es** y **que cantidad
 * y unidad escribio el profesional** en texto libre. Los numeros de la
 * equivalencia —la porcion de referencia y las porciones por grupo— vienen de
 * la base por `equivalencia_id`, aunque el modelo tambien los devuelva: el
 * esquema se los pide para poder COTEJARLOS, y una divergencia se registra.
 *
 * Es la regla de oro del proyecto aplicada al detalle: la IA asiste, el codigo
 * calcula y la tabla manda.
 */
import { pool } from '../db.js'
import type { PorcionDeGrupo } from './intercambios.js'

/** Una fila del catalogo, con el indice que se le muestra al modelo. */
export interface EntradaCatalogo {
  indice: number
  id: string
  alimento: string
  cantidadDescripcion: string
  cantidadG: number | null
  subtipo: string | null
  porciones: PorcionDeGrupo[]
}

/**
 * El catalogo visible para una clinica: las filas globales mas las propias.
 *
 * La propia gana cuando coincide el nombre —mismo criterio que `leerGrupos`—
 * porque si las dos entraran al prompt el modelo tendria dos opciones
 * identicas y elegiria una al azar, incluida la que la clinica quiso
 * reemplazar.
 */
export async function leerCatalogo(clinicaId: string): Promise<EntradaCatalogo[]> {
  const { rows } = await pool.query<{
    id: string
    alimento: string
    cantidad_descripcion: string
    cantidad_g: string | null
    subtipo: string | null
    porciones_json: PorcionDeGrupo[]
    propio: boolean
  }>(
    `select id, alimento, cantidad_descripcion, cantidad_g, subtipo, porciones_json,
            (clinica_id is not null) as propio
       from equivalencia_intercambio
      where activo = true and (clinica_id is null or clinica_id = $1)
      order by (clinica_id is not null), lower(alimento)`,
    [clinicaId],
  )

  const porNombre = new Map<string, EntradaCatalogo>()
  for (const f of rows) {
    // El `order by` pone las propias al final: sobreescriben a la global.
    porNombre.set(f.alimento.toLowerCase(), {
      indice: 0,
      id: f.id,
      alimento: f.alimento,
      cantidadDescripcion: f.cantidad_descripcion,
      cantidadG: f.cantidad_g === null ? null : Number(f.cantidad_g),
      subtipo: f.subtipo,
      porciones: f.porciones_json,
    })
  }

  // El indice se asigna sobre el orden final y estable (alfabetico): dos
  // llamadas con el mismo catalogo numeran igual, que es lo que hace
  // reproducible un caso reportado por un profesional.
  const catalogo = [...porNombre.values()].sort((a, b) =>
    a.alimento.localeCompare(b.alimento, 'es'),
  )
  catalogo.forEach((e, i) => {
    e.indice = i + 1
  })
  return catalogo
}

/** Lo que el modelo devuelve por alimento. El esquema es el contrato. */
export interface AlimentoIdentificado {
  descripcion_usuario: string
  alimento_encontrado: string | null
  cantidad_usuario: number | null
  unidad_usuario: string | null
  equivalencia_id: number | null
  cantidad_porcion_referencia: number | null
  unidad_porcion_referencia: string | null
  grupos: { grupo: string; porciones_por_referencia: number }[]
  encontrado: boolean
  nota: string | null
}

const INSTRUCCIONES = `Eres un asistente de nutricion clinica. Tu UNICA tarea es IDENTIFICAR alimentos en un texto libre y emparejarlos con una fila del catalogo de equivalencias que se te entrega.

NO CALCULAS NADA. No multiplicas, no sumas, no conviertes unidades, no estimas porciones ni calorias ni macronutrientes. De eso se encarga el servidor. Si devuelves un calculo, se descarta.

Lo que SI haces:
1. Separar el texto en alimentos individuales. "Gallo pinto con huevo" son DOS alimentos.
2. Para cada uno, copiar la cantidad y la unidad TAL COMO las escribio el profesional, separadas: "250 ml" -> cantidad_usuario: 250, unidad_usuario: "ml". "1/2 taza" -> cantidad_usuario: 0.5, unidad_usuario: "taza". "1 huevo" -> cantidad_usuario: 1, unidad_usuario: null (no hay unidad, es una cuenta).
3. Elegir del catalogo la fila que corresponde al alimento, por SIGNIFICADO y no por parecido de letras: "leche descremada" es "leche 0% grasa"; "arroz cocido" es "arroz blanco".
4. Copiar de la fila elegida su numero (equivalencia_id), su porcion de referencia partida en cantidad y unidad, y sus grupos con las porciones que indica.

Reglas:
- equivalencia_id es el numero entre corchetes del catalogo. No inventes numeros: si ningun alimento del catalogo corresponde, usa encontrado: false, equivalencia_id: null y explica en "nota" que no esta en el catalogo.
- Ante la duda entre dos filas, elige la mas especifica que el texto respalde. Si el texto no alcanza para decidir, usa encontrado: false antes que adivinar: un acierto equivocado no se ve, un "no encontrado" si.
- No agregues alimentos que el texto no menciona.
- Si el texto no dice cantidad, usa cantidad_usuario: null y dilo en "nota".
- unidad_porcion_referencia es la unidad de la porcion del catalogo ("tz", "cda", "g", "unidad", "rebanada"...), no la del profesional.
- Responde UNICAMENTE con JSON valido, sin texto adicional y sin cercas de markdown.

Formato exacto de la respuesta:
{
  "alimentos": [
    {
      "descripcion_usuario": "250 ml de leche descremada",
      "alimento_encontrado": "leche 0% grasa",
      "cantidad_usuario": 250,
      "unidad_usuario": "ml",
      "equivalencia_id": 42,
      "cantidad_porcion_referencia": 1,
      "unidad_porcion_referencia": "tz",
      "grupos": [{ "grupo": "lacteo_descremado", "porciones_por_referencia": 1 }],
      "encontrado": true,
      "nota": null
    }
  ]
}`

/** Una linea de catalogo: lo justo para elegir, sin los valores del grupo. */
function linea(e: EntradaCatalogo): string {
  const grupos = e.porciones
    .map((p) => `${p.grupo_id} x${p.cantidad_decimal}`)
    .join(' + ')
  const gramos = e.cantidadG === null ? '' : ` (${e.cantidadG} g)`
  const subtipo = e.subtipo === null ? '' : ` [${e.subtipo}]`
  return `[${e.indice}] ${e.alimento}${subtipo} — porcion: ${e.cantidadDescripcion}${gramos} — grupos: ${grupos}`
}

/**
 * El prompt de la fase 1.
 *
 * Los valores nutricionales de los grupos NO van en el prompt, a proposito: si
 * el modelo los ve, los multiplica —se lo pida o no—, y despues hay dos
 * numeros, el suyo y el del servidor, sin forma de saber cual se mostro. No
 * dandoselos, la unica aritmetica posible es la del servidor.
 *
 * `excluidos` son indices que ya se intentaron y no sirvieron: es la vuelta que
 * pide la fase 2 cuando la unidad de la fila elegida no se puede comparar con
 * la que escribio el profesional.
 */
export function construirPromptIdentificacion(
  texto: string,
  catalogo: EntradaCatalogo[],
  excluidos: number[] = [],
): string {
  const lineas = catalogo.map(linea).join('\n')
  const veto =
    excluidos.length === 0
      ? ''
      : `\n\nIMPORTANTE: ya se intentaron las filas ${excluidos.join(', ')} y su unidad de porcion NO se puede comparar con la cantidad que escribio el profesional (por ejemplo, el escribio mililitros y la fila mide en unidades). Busca otra fila del catalogo cuya unidad de porcion sea del mismo tipo que la que escribio el profesional. Si no existe ninguna, devuelve encontrado: false.`

  return `${INSTRUCCIONES}

CATALOGO DE EQUIVALENCIAS (elige por numero):
${lineas}

TEXTO DEL PROFESIONAL:
${texto}${veto}

Devuelve el JSON.`
}

/**
 * Lee la respuesta del modelo con el esquema de la fase 1.
 *
 * **Lo que no se entiende se descarta o se marca; no se convierte en cero.** Un
 * alimento con los campos a medias entra como `encontrado: false`, que la
 * pantalla muestra como aviso. Un cero se muestra como un alimento que no
 * aporta nada, y eso es una afirmacion clinica falsa.
 */
export function parsearIdentificacion(texto: string): AlimentoIdentificado[] {
  let limpio = texto.trim()
  const cerca = limpio.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (cerca?.[1]) limpio = cerca[1].trim()
  else {
    const inicio = limpio.indexOf('{')
    const fin = limpio.lastIndexOf('}')
    if (inicio !== -1 && fin !== -1) limpio = limpio.slice(inicio, fin + 1)
  }

  const obj = JSON.parse(limpio) as Record<string, unknown>
  const crudos = Array.isArray(obj['alimentos']) ? (obj['alimentos'] as unknown[]) : []

  const salida: AlimentoIdentificado[] = []
  for (const cruda of crudos) {
    const o = (cruda ?? {}) as Record<string, unknown>

    const descripcion =
      typeof o['descripcion_usuario'] === 'string' ? o['descripcion_usuario'].trim() : ''
    if (descripcion === '') continue

    salida.push({
      descripcion_usuario: descripcion,
      alimento_encontrado: cadena(o['alimento_encontrado']),
      cantidad_usuario: numero(o['cantidad_usuario']),
      unidad_usuario: cadena(o['unidad_usuario']),
      equivalencia_id: entero(o['equivalencia_id']),
      cantidad_porcion_referencia: numero(o['cantidad_porcion_referencia']),
      unidad_porcion_referencia: cadena(o['unidad_porcion_referencia']),
      grupos: grupos(o['grupos']),
      encontrado: o['encontrado'] === true,
      nota: cadena(o['nota']),
    })
  }
  return salida
}

function cadena(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

function numero(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  // Algunos modelos devuelven "250" o "0.5" como cadena. Se acepta el numero,
  // no la fraccion escrita: "1/2" aca seria una conversion, y convertir es
  // trabajo del servidor.
  if (typeof v === 'string') {
    const n = Number(v.trim().replace(',', '.'))
    if (Number.isFinite(n)) return n
  }
  return null
}

function entero(v: unknown): number | null {
  const n = numero(v)
  return n === null ? null : Math.trunc(n)
}

function grupos(v: unknown): { grupo: string; porciones_por_referencia: number }[] {
  if (!Array.isArray(v)) return []
  const salida: { grupo: string; porciones_por_referencia: number }[] = []
  for (const cruda of v) {
    const o = (cruda ?? {}) as Record<string, unknown>
    const nombre = cadena(o['grupo'])
    const n = numero(o['porciones_por_referencia'])
    if (nombre !== null && n !== null && n > 0) {
      salida.push({ grupo: nombre, porciones_por_referencia: n })
    }
  }
  return salida
}
