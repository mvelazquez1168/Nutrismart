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
  /**
   * Si este plan ya tiene resumen clinico guardado (R49).
   *
   * Opcional porque solo lo manda el listado, no el detalle. Un plan de
   * antes de la R49 llega en `false`, y el boton del historico dice
   * «Generar resumen» en vez de «Ver resumen»: el estado ausente se
   * nombra, no se disfraza de normal.
   */
  tieneResumen?: boolean
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

/**
 * Estado del resumen clinico tras guardar (R49).
 *
 * `generado` con la redaccion de la IA; `sin_ia` cuando el modelo no
 * respondio y el resumen quedo armado solo con los datos de la consulta;
 * `fallo` cuando no se pudo guardar ninguno. **El plan se guardo en los
 * tres casos** — esta bandera no habla del plan.
 */
export type EstadoResumen = 'generado' | 'sin_ia' | 'sin_plan' | 'fallo'

export function guardarComidas(
  planId: string,
  comidas: ComidaEnvio[],
): Promise<{ planId: string; comidas: number; resumen?: EstadoResumen }> {
  return apiPut<{ planId: string; comidas: number; resumen?: EstadoResumen }>(
    `/api/planes/${planId}/comidas`,
    comidas,
  )
}

/* ---- El resumen clinico del plan — R49 ---------------------------- */

export interface MacrosResumen {
  kcal: number | null
  choG: number | null
  protG: number | null
  grasaG: number | null
  choPct: number | null
  protPct: number | null
  grasaPct: number | null
  fuente: 'conclusion' | 'calculadora' | 'ausente'
}

export interface ResumenClinico {
  id: string
  planId: string
  generadoEn: string
  /** 'ia' = redactado por el modelo; 'datos' = armado sin el modelo. */
  origen: 'ia' | 'datos'
  modelo: string | null
  bloques: {
    objetivos: string | null
    observacionesClinicas: string | null
    justificacion: string | null
    planAlimentario: string | null
    distribucionMacros: string | null
    recomendaciones: string | null
    tareas: string | null
  }
  macros: MacrosResumen | null
}

/**
 * El resumen guardado, si existe.
 *
 * `existe: false` llega con 200, no con 404: el plan existe, lo que no
 * existe es su resumen. Son dos ausencias distintas y la pantalla dice
 * cosas distintas en cada caso.
 */
export function getResumenPlan(
  planId: string,
  signal?: AbortSignal,
): Promise<{ existe: boolean; resumen?: ResumenClinico }> {
  return apiGet<{ existe: boolean; resumen?: ResumenClinico }>(
    `/api/planes/${planId}/resumen`,
    signal,
  )
}

/** Genera el resumen a pedido: planes viejos, o reintento tras un fallo. */
export function generarResumenPlan(
  planId: string,
): Promise<{ existe: boolean; estado: EstadoResumen; resumen: ResumenClinico | null }> {
  return apiPost<{ existe: boolean; estado: EstadoResumen; resumen: ResumenClinico | null }>(
    `/api/planes/${planId}/resumen`,
    {},
  )
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
