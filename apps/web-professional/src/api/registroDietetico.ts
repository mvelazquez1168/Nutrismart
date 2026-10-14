/** Registro dietético estructurado (recordatorio 24h / consumo usual) — R40. */
import { apiGet, apiPost, apiPut } from './client'

export type TipoRegistro = 'recordatorio_24h' | 'consumo_usual'

export interface FilaDietetica {
  tiempo_comida: string
  hora: string | null
  alimentos_consumidos: string | null
  ai_kcal: number | null
  ai_cho_g: number | null
  ai_prot_g: number | null
  ai_grasas_g: number | null
  ai_calculado_en: string | null
  /**
   * Los cuatro valores corregidos a mano por el profesional — R41, R50.
   *
   * null = vale el calculado. El efectivo es `X_manual ?? ai_X`; los
   * `ai_*` nunca se pisan, así que vaciar la casilla deshace la
   * corrección.
   */
  kcal_manual: number | null
  cho_g_manual: number | null
  prot_g_manual: number | null
  grasas_g_manual: number | null
  /**
   * Los alimentos del texto que NO están en la lista de intercambios — R48.
   *
   * null = nunca se analizó. Lista vacía = se analizó y se encontró todo.
   * Con contenido, la fila lleva el aviso: esos valores no salen de la
   * lista y hay que escribirlos a mano.
   */
  ai_no_encontrado: string[] | null
}

export interface RegistroDietetico {
  observaciones: string | null
  totalKcal: number | null
  totalChoG: number | null
  totalProtG: number | null
  totalGrasasG: number | null
  filas: FilaDietetica[]
}

/** Lo que el cliente envía al guardar (los ai_* nunca viajan aquí). */
export interface FilaEnvio {
  tiempo_comida: string
  hora: string | null
  alimentos_consumidos: string | null
  /** Las cuatro correcciones sí viajan: son del profesional, no de la IA. */
  kcal_manual: number | null
  cho_g_manual: number | null
  prot_g_manual: number | null
  grasas_g_manual: number | null
}

function base(pacienteId: string, consultaId: string, tipo: TipoRegistro): string {
  return `/api/pacientes/${pacienteId}/consultas/${consultaId}/registro-dietetico/${tipo}`
}

export function getRegistroDietetico(
  pacienteId: string,
  consultaId: string,
  tipo: TipoRegistro,
  signal?: AbortSignal,
): Promise<RegistroDietetico> {
  return apiGet<RegistroDietetico>(base(pacienteId, consultaId, tipo), signal)
}

export function guardarRegistroDietetico(
  pacienteId: string,
  consultaId: string,
  tipo: TipoRegistro,
  body: { observaciones: string | null; filas: FilaEnvio[] },
): Promise<RegistroDietetico> {
  return apiPut<RegistroDietetico>(base(pacienteId, consultaId, tipo), body)
}

/**
 * El detalle por alimento que devuelve `/calcular`, al lado del registro.
 *
 * La tabla no lo usa todavía —hidrata con las seis filas, como antes— y viaja
 * en el tipo porque es lo que hace auditable un total: cuántas porciones salió
 * cada alimento y contra qué fila de la lista de intercambios.
 */
export interface AlimentoCalculado {
  descripcion_usuario: string
  cantidad_usuario: number | null
  unidad_usuario: string | null
  encontrado: boolean
  no_encontrado: boolean
  alimento_encontrado: string | null
  porcion_referencia: string | null
  grupos: { grupo: string; porciones_por_referencia: number }[]
  porciones: number | null
  porciones_supuestas: boolean
  nota: string | null
  /** El mensaje de «no se pudo calcular» de ese alimento, o null. */
  error: string | null
  cho_g: number | null
  chon_g: number | null
  grasa_g: number | null
  kcal: number | null
}

export interface RegistroCalculado extends RegistroDietetico {
  alimentos?: AlimentoCalculado[]
  /** Presente solo si NINGÚN alimento dio números. */
  error?: string | null
  no_encontrado?: boolean
  alimentos_no_encontrados?: string[]
}

/**
 * Calcula un tiempo de comida — `/calcular`, el camino de dos fases.
 *
 * ## Por qué ya no es `/analizar-ia`
 *
 * `/analizar-ia` buscaba cada alimento por parecido de letras en Postgres:
 * encontraba «arroz blanco» escribiendo «arroz blanco» y **no** lo encontraba
 * escribiendo «arroz cocido». `/calcular` hace el emparejamiento con el modelo
 * —que sí sabe que son el mismo alimento— y la aritmética en el servidor,
 * contra la tabla de intercambios.
 *
 * Se manda `tiempo_comida` y no el texto: el servidor analiza el texto
 * **guardado**, que es por lo que quien llama guarda primero. Mandar el texto
 * desde aquí permitiría calcular una cosa y tener otra escrita en la fila.
 *
 * La respuesta sigue siendo el registro completo —las seis filas—, así que la
 * tabla hidrata igual que antes.
 */
export function analizarFilaDietetica(
  pacienteId: string,
  consultaId: string,
  tipo: TipoRegistro,
  tiempoComida: string,
): Promise<RegistroCalculado> {
  return apiPost<RegistroCalculado>(`${base(pacienteId, consultaId, tipo)}/calcular`, {
    tiempo_comida: tiempoComida,
  })
}
