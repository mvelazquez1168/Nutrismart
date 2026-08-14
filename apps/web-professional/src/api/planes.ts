/** Plan alimentario semanal — CLI-09. */
import { apiDelete, apiGet, apiPost, apiPut } from './client'

export type EstadoPlan = 'borrador' | 'activo' | 'archivado'

export const TIPOS_COMIDA = [
  { clave: 'desayuno', etiqueta: 'Desayuno' },
  { clave: 'media_manana', etiqueta: 'Media mañana' },
  { clave: 'almuerzo', etiqueta: 'Almuerzo' },
  { clave: 'merienda', etiqueta: 'Merienda' },
  { clave: 'cena', etiqueta: 'Cena' },
  { clave: 'extra', etiqueta: 'Extra' },
] as const

export type TipoComida = (typeof TIPOS_COMIDA)[number]['clave']

/** 1 = lunes … 7 = domingo (ISO-8601), igual que en la base. */
export const DIAS = [
  { numero: 1, corto: 'Lun', largo: 'Lunes' },
  { numero: 2, corto: 'Mar', largo: 'Martes' },
  { numero: 3, corto: 'Mié', largo: 'Miércoles' },
  { numero: 4, corto: 'Jue', largo: 'Jueves' },
  { numero: 5, corto: 'Vie', largo: 'Viernes' },
  { numero: 6, corto: 'Sáb', largo: 'Sábado' },
  { numero: 7, corto: 'Dom', largo: 'Domingo' },
] as const

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
  diaSemana: number
  tipoComida: TipoComida
  descripcion: string
  caloriasKcal: number | null
  proteinasG: number | null
  carbohidratosG: number | null
  grasasG: number | null
  notas: string | null
}

export interface PlanDetalle extends Plan {
  pacienteId: string
  /** Clave = día como cadena ('1'…'7'). Días sin comidas no aparecen. */
  dias: Record<string, ComidaPlan[]>
}

export interface ComidaEnvio {
  diaSemana: number
  tipoComida: TipoComida
  descripcion: string
  caloriasKcal?: number | null
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
