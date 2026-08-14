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

/* ------------------------------------------------------------------ */
/* Conclusiones (EVAL-05)                                              */
/* ------------------------------------------------------------------ */

export const RESTRICCIONES = [
  { clave: 'sin_gluten', etiqueta: 'Sin gluten' },
  { clave: 'sin_lactosa', etiqueta: 'Sin lactosa' },
  { clave: 'bajo_sodio', etiqueta: 'Bajo en sodio' },
  { clave: 'bajo_grasa', etiqueta: 'Bajo en grasas' },
  { clave: 'diabetica', etiqueta: 'Diabética' },
  { clave: 'vegetariana', etiqueta: 'Vegetariana' },
  { clave: 'vegana', etiqueta: 'Vegana' },
  { clave: 'renal', etiqueta: 'Renal' },
] as const

/** Diagnósticos nutricionales frecuentes, con su código CIE-10. */
export const DIAGNOSTICOS = [
  { cie10: 'E44.0', nombre: 'Desnutrición proteico-calórica moderada' },
  { cie10: 'E44.1', nombre: 'Desnutrición proteico-calórica leve' },
  { cie10: 'E46', nombre: 'Desnutrición proteico-calórica no especificada' },
  { cie10: 'E55.9', nombre: 'Deficiencia de vitamina D' },
  { cie10: 'E61.1', nombre: 'Deficiencia de hierro' },
  { cie10: 'E66.0', nombre: 'Obesidad por exceso de calorías' },
  { cie10: 'E66.9', nombre: 'Obesidad no especificada' },
  { cie10: 'E67.8', nombre: 'Hiperalimentación especificada' },
  { cie10: 'R63.4', nombre: 'Pérdida anormal de peso' },
  { cie10: 'R63.5', nombre: 'Aumento anormal de peso' },
  { cie10: 'Z71.3', nombre: 'Consulta para instrucción dietética' },
  { cie10: 'Z72.4', nombre: 'Régimen alimentario inadecuado' },
] as const

export const RECOMENDACIONES_FRECUENTES = [
  'Aumentar el aporte de proteína',
  'Hidratación de 2 litros al día',
  'Reducir el sodio',
  'Alimentos ricos en hierro',
  'Priorizar la fibra',
  'Reducir azúcares libres',
  'Fraccionar las comidas',
  'Actividad física progresiva',
] as const

export interface Acuerdo {
  texto: string
  cumplido: boolean
}

export interface Conclusion {
  id: string
  consultaId: string
  diagnosticoPrincipal: string | null
  diagnosticoCie10: string | null
  diagnosticoSecundario: string | null
  observacionesClinicas: string | null
  recomendaciones: string[]
  kcalPrescritas: number | null
  pctProteina: number | null
  pctCho: number | null
  pctGrasa: number | null
  proteinaG: number | null
  choG: number | null
  grasaG: number | null
  restricciones: string[]
  suplementos: string | null
  acuerdos: Acuerdo[]
}

export function getConclusion(
  pacienteId: string,
  consultaId: string,
  signal?: AbortSignal,
): Promise<Conclusion> {
  return apiGet<Conclusion>(
    `/api/pacientes/${pacienteId}/consultas/${consultaId}/conclusion`,
    signal,
  )
}

export function guardarConclusion(
  pacienteId: string,
  consultaId: string,
  datos: Record<string, unknown>,
): Promise<Conclusion> {
  return apiPut<Conclusion>(
    `/api/pacientes/${pacienteId}/consultas/${consultaId}/conclusion`,
    datos,
  )
}
