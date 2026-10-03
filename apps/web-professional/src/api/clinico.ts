/** Historial clínico, farmacología y evaluación dietética — EVAL-03, EVAL-04. */
import { apiDelete, apiGet, apiPost, apiPut } from './client'

/**
 * Tipos de actividad física con su factor.
 *
 * Ya NO se ofrecen en pantalla: la R44 retiró las tarjetas de selección
 * del bloque «Actividad física» del Clínico. La tabla se queda porque es
 * la referencia de lo que significa cada `tipo_actividad` guardado —el
 * servidor sigue derivando el `faf` de esa columna— y porque sin ella no
 * hay forma de volver a pintar lo ya registrado si el selector regresa.
 */
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
  // R44. Son diagnósticos concretos dentro de «enfermedad inflamatoria
  // intestinal», que se queda: no todo caso tiene el subtipo precisado.
  'CUCI (Colitis Ulcerosa Crónica Idiopática)',
  'Enfermedad de Crohn',
] as const

/**
 * Tamizaje de relación con los alimentos — siete preguntas (R44).
 *
 * Están redactadas en segunda persona porque se leen en voz alta al
 * paciente, no se interpretan desde la ficha.
 *
 * Dos conservan su columna de antes: la de culpa y la de emociones
 * preguntan lo mismo con otras palabras, así que lo ya respondido sigue
 * siendo válido y aparece al abrir el historial.
 */
export const LIKERT = [
  { clave: 'culpaAlComer', etiqueta: '¿Hay alimentos que generen culpa o vergüenza?' },
  {
    clave: 'mereceComerTrasEjercicio',
    etiqueta: '¿Sientes que mereces comer solo después de hacer ejercicio?',
  },
  { clave: 'alimentacionEmocional', etiqueta: '¿Las emociones influyen en cómo y qué comes?' },
  {
    clave: 'identificaHambreSaciedad',
    etiqueta: '¿Te resulta fácil identificar cuándo tienes hambre o estás satisfecho/a?',
  },
  { clave: 'valorPersonalApariencia', etiqueta: '¿Sientes que tu valor personal depende de cómo luces?' },
  {
    clave: 'comidaOcupaPensamientos',
    etiqueta: '¿La comida ocupa gran parte de tus pensamientos durante el día?',
  },
  {
    clave: 'clasificaAlimentosBuenosMalos',
    etiqueta: '¿Clasificas ciertos alimentos o grupos de alimentos como «buenos» o «malos»?',
  },
] as const

/**
 * Preguntas retiradas del cuestionario en la R44.
 *
 * No se preguntan ni se pintan, pero sus respuestas siguen en la base y
 * el formulario las devuelve tal cual al guardar: el PUT del historial
 * reemplaza la fila entera, así que sin este viaje de ida y vuelta se
 * borrarían. Mismo patrón que `notasAdicionales` desde la R41.
 */
export const LIKERT_RETIRADOS = ['salteoComidas', 'atracones', 'dietasFrecuentes'] as const

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
  mereceComerTrasEjercicio: number | null
  identificaHambreSaciedad: number | null
  valorPersonalApariencia: number | null
  comidaOcupaPensamientos: number | null
  clasificaAlimentosBuenosMalos: number | null
  /**
   * Observaciones del historial (R44), del PACIENTE.
   *
   * No confundir con `Conclusion.observacionesClinicas`, que es el
   * juicio de UNA consulta. Comparten rótulo porque viven en carpetas
   * distintas de la valoración.
   */
  observacionesClinicas: string | null
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

/**
 * Guarda SOLO las observaciones del historial.
 *
 * Endpoint propio y no `guardarHistorial`: ese PUT reemplaza la fila
 * entera, y esta sección vive en su propia tarjeta con su propio botón
 * —después de Hábitos— sin el estado del resto del formulario a mano.
 */
export function guardarObservacionesHistorial(
  pacienteId: string,
  observacionesClinicas: string | null,
): Promise<Historial> {
  return apiPut<Historial>(`/api/pacientes/${pacienteId}/historial/observaciones`, {
    observacionesClinicas,
  })
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
