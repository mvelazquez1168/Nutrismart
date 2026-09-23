/** Plan alimentario — CLI-09 / R38: patrón diario de seis tiempos fijos. */
import { apiDelete, apiGet, apiPost, apiPut } from './client'

export type EstadoPlan = 'borrador' | 'activo' | 'archivado'

/**
 * Los seis tiempos del día, en orden cronológico. Fijos: un plan es este
 * patrón, con o sin contenido en cada franja. Las claves coinciden con el
 * enum `tipo_comida` de la base (sin acentos ni eñes).
 */
export const TIPOS_COMIDA = [
  { clave: 'desayuno', etiqueta: 'Desayuno' },
  { clave: 'merienda_am', etiqueta: 'Merienda AM' },
  { clave: 'almuerzo', etiqueta: 'Almuerzo' },
  { clave: 'merienda_pm', etiqueta: 'Merienda PM' },
  { clave: 'cena', etiqueta: 'Cena' },
  { clave: 'colacion_nocturna', etiqueta: 'Colación nocturna' },
] as const

export type TipoComida = (typeof TIPOS_COMIDA)[number]['clave']

export interface Plan {
  id: string
  nombre: string
  objetivo: string | null
  /** 'AAAA-MM-DD' o null. Fecha sin hora: no pasa por Date. */
  fechaInicio: string | null
  fechaFin: string | null
  estado: EstadoPlan
  notas: string | null
  createdAt: string
  updatedAt: string
}

export interface ComidaPlan {
  id: string
  tipoComida: TipoComida
  patron: string | null
  ejemploMenu: string | null
}

export interface PlanDetalle extends Plan {
  pacienteId: string
  /** Lista plana ordenada por tiempo de comida. Franjas sin contenido no aparecen. */
  comidas: ComidaPlan[]
}

export interface ComidaEnvio {
  tipoComida: TipoComida
  patron: string | null
  ejemploMenu: string | null
}

export interface DatosPlanEnvio {
  nombre: string
  objetivo?: string | null
  fechaInicio?: string | null
  fechaFin?: string | null
  notas?: string | null
}

export function getPlanes(pacienteId: string, signal?: AbortSignal): Promise<Plan[]> {
  return apiGet<Plan[]>(`/api/pacientes/${pacienteId}/planes`, signal)
}

export function getPlan(planId: string, signal?: AbortSignal): Promise<PlanDetalle> {
  return apiGet<PlanDetalle>(`/api/planes/${planId}`, signal)
}

export function crearPlan(pacienteId: string, datos: DatosPlanEnvio): Promise<Plan> {
  return apiPost<Plan>(`/api/pacientes/${pacienteId}/planes`, datos)
}

export function guardarComidas(
  planId: string,
  comidas: ComidaEnvio[],
): Promise<{ planId: string; comidas: number }> {
  return apiPut<{ planId: string; comidas: number }>(`/api/planes/${planId}/comidas`, comidas)
}

export function activarPlan(planId: string): Promise<Plan> {
  return apiPut<Plan>(`/api/planes/${planId}/activar`, {})
}

export function archivarPlan(planId: string): Promise<Plan> {
  return apiPut<Plan>(`/api/planes/${planId}/archivar`, {})
}

export function eliminarPlan(planId: string): Promise<void> {
  return apiDelete(`/api/planes/${planId}`)
}
