/** Historial clínico, farmacología y evaluación dietética — EVAL-03, EVAL-04. */
import { apiDelete, apiGet, apiPost, apiPut } from './client'

export const TIPOS_ACTIVIDAD = [
  { clave: 'sedentario', etiqueta: 'Sedentario', faf: 1.2, descripcion: 'Trabajo de oficina, sin ejercicio' },
  { clave: 'leve', etiqueta: 'Leve', faf: 1.375, descripcion: 'Ejercicio ligero 1-3 días' },
  { clave: 'moderado', etiqueta: 'Moderado', faf: 1.55, descripcion: 'Ejercicio moderado 3-5 días' },
  { clave: 'intenso', etiqueta: 'Intenso', faf: 1.725, descripcion: 'Ejercicio fuerte 6-7 días' },
  { clave: 'muy_intenso', etiqueta: 'Muy intenso', faf: 1.9, descripcion: 'Trabajo físico o doble sesión' },
] as const

export const CONDICIONES = [
  'Diabetes tipo 2',
  'Hipertensión',
  'Dislipidemia',
  'Obesidad',
  'Enfermedad cardiovascular',
  'Cáncer',
  'Tiroides',
  'Osteoporosis',
] as const

export const SINTOMAS_GI = [
  'Distensión',
  'Estreñimiento',
  'Diarrea',
  'Reflujo o acidez',
  'Colon irritable',
  'Enfermedad inflamatoria intestinal',
  'Intolerancia alimentaria',
] as const

export const LIKERT = [
  { clave: 'alimentacionEmocional', etiqueta: 'Come por emociones' },
  { clave: 'salteoComidas', etiqueta: 'Se salta comidas' },
  { clave: 'atracones', etiqueta: 'Episodios de atracón' },
  { clave: 'culpaAlComer', etiqueta: 'Culpa al comer' },
  { clave: 'dietasFrecuentes', etiqueta: 'Dietas frecuentes' },
] as const

export const ESCALA_LIKERT = ['Nunca', 'Casi nunca', 'A veces', 'A menudo', 'Siempre'] as const

export interface Historial {
  id: string
  consultaId: string | null
  apf: { condicion: string; parientes?: string }[]
  app: { condicion: string; desde?: string }[]
  tipoActividad: string | null
  sesionesSemana: number | null
  duracionMin: number | null
  faf: number | null
  actividadDetalle: string | null
  fuma: boolean | null
  alcohol: boolean | null
  otrasSustancias: string | null
  sintomasGi: string[]
  giDetalle: string | null
  alimentacionEmocional: number | null
  salteoComidas: number | null
  atracones: number | null
  culpaAlComer: number | null
  dietasFrecuentes: number | null
  notasAdicionales: string | null
}

export interface Medicamento {
  id: string
  nombre: string
  dosis: string | null
  frecuencia: string | null
  desde: string | null
  activo: boolean
}

export type Severidad = 'info' | 'advertencia' | 'importante'

export interface Interaccion {
  medicamento: string
  principio: string
  nutrientes: string[]
  tipo: string
  recomendacion: string
  severidad: Severidad
}

export interface RevisionInteracciones {
  interacciones: Interaccion[]
  /** Fármacos que la lista no cubre. Su presencia acota la revisión. */
  noReconocidos: string[]
  cobertura: number
}

export interface Alimento {
  nombre: string
  cantidad: number | null
  unidad: string
  kcal: number | null
}

export interface ComidaR24 {
  hora: string
  tipo: string
  alimentos: Alimento[]
}

export interface Dietetico {
  id: string
  consultaId: string | null
  recordatorio24h: ComidaR24[]
  frecuenciaConsumo: Record<string, string>
  hidratacionLitros: number | null
  kcalEstimadas: number | null
  proteinaG: number | null
  choG: number | null
  grasaG: number | null
  fibraG: number | null
  notasDieteticas: string | null
}

/* ---- Historial ---- */
export function getHistorial(pacienteId: string, signal?: AbortSignal): Promise<Historial> {
  return apiGet<Historial>(`/api/pacientes/${pacienteId}/historial`, signal)
}
export function guardarHistorial(
  pacienteId: string,
  datos: Record<string, unknown>,
): Promise<Historial> {
  return apiPut<Historial>(`/api/pacientes/${pacienteId}/historial`, datos)
}

/* ---- Farmacología ---- */
export function getMedicamentos(pacienteId: string, signal?: AbortSignal): Promise<Medicamento[]> {
  return apiGet<Medicamento[]>(`/api/pacientes/${pacienteId}/farmacologia`, signal)
}
export function crearMedicamento(
  pacienteId: string,
  datos: { nombre: string; dosis?: string | null; frecuencia?: string | null; desde?: string | null },
): Promise<Medicamento> {
  return apiPost<Medicamento>(`/api/pacientes/${pacienteId}/farmacologia`, datos)
}
export function actualizarMedicamento(
  pacienteId: string,
  medId: string,
  datos: Record<string, unknown>,
): Promise<Medicamento> {
  return apiPut<Medicamento>(`/api/pacientes/${pacienteId}/farmacologia/${medId}`, datos)
}
export function suspenderMedicamento(pacienteId: string, medId: string): Promise<void> {
  return apiDelete(`/api/pacientes/${pacienteId}/farmacologia/${medId}`)
}
export function getInteracciones(
  pacienteId: string,
  signal?: AbortSignal,
): Promise<RevisionInteracciones> {
  return apiGet<RevisionInteracciones>(
    `/api/pacientes/${pacienteId}/farmacologia/interacciones`,
    signal,
  )
}

/* ---- Dietético ---- */
export function getDietetico(pacienteId: string, signal?: AbortSignal): Promise<Dietetico> {
  return apiGet<Dietetico>(`/api/pacientes/${pacienteId}/dietetico`, signal)
}
export function guardarDietetico(
  pacienteId: string,
  datos: Record<string, unknown>,
): Promise<Dietetico> {
  return apiPut<Dietetico>(`/api/pacientes/${pacienteId}/dietetico`, datos)
}
