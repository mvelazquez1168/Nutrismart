/** Valoración ABCD — EVAL-00, EVAL-01, EVAL-02. */
import { apiGet, apiPost, apiPut } from './client'

export const SECCIONES = [
  { clave: 'antrop', etiqueta: 'Antropometría' },
  { clave: 'bioquim', etiqueta: 'Bioquímica' },
  { clave: 'clinico', etiqueta: 'Clínico' },
  { clave: 'dietetico', etiqueta: 'Dietético' },
  { clave: 'conclusion', etiqueta: 'Conclusiones' },
] as const

export type Seccion = (typeof SECCIONES)[number]['clave']

/** Sin estas dos no se puede finalizar; el servidor lo repite. */
export const SECCIONES_EXIGIDAS: Seccion[] = ['antrop', 'conclusion']

export interface Consulta {
  id: string
  pacienteId: string
  tipo: 'inicial' | 'seguimiento'
  numeroConsulta: number
  estado: 'borrador' | 'finalizada'
  fechaConsulta: string
  seccionesCompletas: Record<string, boolean>
  profesional: string | null
  createdAt: string
  updatedAt: string
}

export interface Medicion {
  id: string
  fechaMedicion: string
  consultaId: string | null
  pesoKg: number | null
  tallaCm: number | null
  imc: number | null
  cinturaCm: number | null
  caderaCm: number | null
  icc: number | null
  brazoCm: number | null
  piernaCm: number | null
  metodo: 'bia' | 'pliegues' | null
  masaLibreGrasaKg: number | null
  masaMuscularKg: number | null
  pctGrasa: number | null
  masaGrasaKg: number | null
  aguaCorporalPct: number | null
  anguloFase: number | null
  plieguesDatos: Record<string, number> | null
  plieguesFormula: string | null
  createdAt: string
}

export type EstadoMarcador = 'normal' | 'bajo' | 'alto' | 'sin_referencia'

export interface Marcador {
  codigo: string
  nombre: string
  unidad: string
  valor: number
  rango: { minimo: number | null; maximo: number | null } | null
  estado: EstadoMarcador
  fecha: string
}

export interface Bioquimica {
  dias: number
  fechaMasReciente: string | null
  totalMarcadores: number
  marcadoresAlterados: number
  alterados: { codigo: string; nombre: string; estado: EstadoMarcador }[]
  grupos: { nombre: string; marcadores: Marcador[]; tieneAlterados: boolean }[]
}

/* ---- Consultas ---- */

export function getConsultas(pacienteId: string, signal?: AbortSignal): Promise<Consulta[]> {
  return apiGet<Consulta[]>(`/api/pacientes/${pacienteId}/consultas`, signal)
}

export function getConsulta(
  pacienteId: string,
  consultaId: string,
  signal?: AbortSignal,
): Promise<Consulta> {
  return apiGet<Consulta>(`/api/pacientes/${pacienteId}/consultas/${consultaId}`, signal)
}

export function crearConsulta(pacienteId: string): Promise<Consulta> {
  return apiPost<Consulta>(`/api/pacientes/${pacienteId}/consultas`, {})
}

export function marcarSeccion(
  pacienteId: string,
  consultaId: string,
  seccion: Seccion,
  completa: boolean,
): Promise<Consulta> {
  return apiPut<Consulta>(`/api/pacientes/${pacienteId}/consultas/${consultaId}/seccion`, {
    seccion,
    completa,
  })
}

export function finalizarConsulta(pacienteId: string, consultaId: string): Promise<Consulta> {
  return apiPut<Consulta>(`/api/pacientes/${pacienteId}/consultas/${consultaId}/finalizar`, {})
}

/* ---- Antropometría ---- */

export function getMediciones(
  pacienteId: string,
  limite = 10,
  signal?: AbortSignal,
): Promise<Medicion[]> {
  return apiGet<Medicion[]>(`/api/pacientes/${pacienteId}/antropometria?limite=${limite}`, signal)
}

export function getMedicionDeConsulta(
  pacienteId: string,
  consultaId: string,
  signal?: AbortSignal,
): Promise<Medicion> {
  return apiGet<Medicion>(
    `/api/pacientes/${pacienteId}/antropometria/consulta/${consultaId}`,
    signal,
  )
}

export function guardarMedicion(
  pacienteId: string,
  datos: Record<string, unknown>,
): Promise<Medicion> {
  return apiPost<Medicion>(`/api/pacientes/${pacienteId}/antropometria`, datos)
}

/* ---- Bioquímica ---- */

export function getBioquimica(
  pacienteId: string,
  dias = 90,
  signal?: AbortSignal,
): Promise<Bioquimica> {
  return apiGet<Bioquimica>(`/api/pacientes/${pacienteId}/labs/nutricional?dias=${dias}`, signal)
}
