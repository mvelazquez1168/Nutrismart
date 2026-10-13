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

export function analizarFilaDietetica(
  pacienteId: string,
  consultaId: string,
  tipo: TipoRegistro,
  tiempoComida: string,
): Promise<RegistroDietetico> {
  return apiPost<RegistroDietetico>(`${base(pacienteId, consultaId, tipo)}/analizar-ia`, {
    tiempo_comida: tiempoComida,
  })
}
