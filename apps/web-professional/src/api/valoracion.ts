/** Valoración ABCD — EVAL-00, EVAL-01, EVAL-02. */
import { apiGet, apiPost, apiPut } from './client'
import type { DatosCalculadora } from '../lib/calculadoraNutricion'
import type { EstadoPlan, TipoComida } from './planes'

export const SECCIONES = [
  { clave: 'antrop', etiqueta: 'Antropometría' },
  // La clave sigue siendo 'bioquim': la valida el servidor
  // (routes/consultas.ts) y está escrita en las filas de
  // `consulta_seccion` ya guardadas. Cambiarla obligaría a migrar datos
  // para renombrar una etiqueta. Lo que ve el profesional es
  // «Laboratorios», que es lo que la sección enseña de verdad.
  { clave: 'bioquim', etiqueta: 'Laboratorios' },
  { clave: 'clinico', etiqueta: 'Clínico' },
  { clave: 'dietetico', etiqueta: 'Dietético' },
  // La clave sigue siendo 'conclusion' —la valida el servidor y está
  // escrita en los `secciones_completas` ya guardados—; lo que ve el
  // profesional es «Prescripción» desde la R44.
  { clave: 'conclusion', etiqueta: 'Prescripción' },
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

/**
 * Abre una consulta.
 *
 * `tipo` es opcional: sin él el servidor lo deriva del ordinal —la
 * primera inicial, el resto seguimiento— que es el comportamiento de
 * antes de la R44.
 */
export function crearConsulta(
  pacienteId: string,
  tipo?: Consulta['tipo'],
): Promise<Consulta> {
  return apiPost<Consulta>(
    `/api/pacientes/${pacienteId}/consultas`,
    tipo ? { tipo } : {},
  )
}

/**
 * Cómo se llama cada tipo de consulta en pantalla (R44).
 *
 * Las claves son las del enum de la base (`inicial`, `seguimiento`) y no
 * se tocan; lo que cambió es el rótulo.
 */
export const TIPOS_CONSULTA = [
  {
    clave: 'inicial',
    etiqueta: 'Consulta normal',
    descripcion: 'Valoración completa: se recorre el ABCD de principio a fin',
  },
  {
    clave: 'seguimiento',
    etiqueta: 'Seguimiento rutinario',
    descripcion: 'Control sobre lo ya valorado: se compara contra la visita anterior',
  },
] as const

export function etiquetaTipoConsulta(tipo: Consulta['tipo']): string {
  return TIPOS_CONSULTA.find((t) => t.clave === tipo)?.etiqueta ?? tipo
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

/**
 * Lo que se puede marcar en la prescripción.
 *
 * Agrupadas, porque quince fichas seguidas sin orden se leen peor que
 * cuatro: primero el tipo de dieta —densidad calórica, fibra, proteína—
 * y después las exclusiones.
 */
export const RESTRICCIONES = [
  { clave: 'hipocalorica', etiqueta: 'Hipocalórica' },
  { clave: 'normocalorica', etiqueta: 'Normocalórica' },
  { clave: 'hipercalorica', etiqueta: 'Hipercalórica' },
  { clave: 'hiperproteica', etiqueta: 'Hiperproteica' },
  { clave: 'normoproteica', etiqueta: 'Normoproteica' },
  { clave: 'hipoproteica', etiqueta: 'Hipoproteica' },
  { clave: 'alta_fibra', etiqueta: 'Alta en fibra' },
  { clave: 'fibra_soluble', etiqueta: 'Fibra soluble' },
  { clave: 'fibra_insoluble', etiqueta: 'Fibra insoluble' },
  { clave: 'sin_gluten', etiqueta: 'Sin gluten' },
  { clave: 'sin_lactosa', etiqueta: 'Sin lactosa' },
  { clave: 'bajo_sodio', etiqueta: 'Bajo en sodio' },
  { clave: 'bajo_grasa', etiqueta: 'Bajo en grasas' },
  { clave: 'vegetariana', etiqueta: 'Vegetariana' },
  { clave: 'vegana', etiqueta: 'Vegana' },
] as const

/**
 * Ya no se ofrecen, pero pueden venir guardadas.
 *
 * «Diabética» y «Renal» salieron del menú en la R37. Una conclusión
 * anterior puede tenerlas, y el servidor las sigue aceptando para no
 * borrarlas al reguardar. Aquí están solo para poder PINTARLAS con su
 * nombre: sin esto aparecería la clave cruda, «renal», en el
 * expediente.
 */
export const RESTRICCIONES_RETIRADAS: Record<string, string> = {
  diabetica: 'Diabética',
  renal: 'Renal',
}

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
  objetivos: string | null
  /** Razones clínicas de lo que se prescribe (R44). */
  justificacion: string | null
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
  /** Meta ponderal: lo que hace medible el progreso del paciente. */
  pesoObjetivo: number | null
  fechaObjetivoPeso: string | null
  acuerdos: Acuerdo[]
  /** Bloque persistido de la calculadora (R39); null si nunca se aplicó. */
  datosCalculadora: DatosCalculadora | null
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


/* ------------------------------------------------------------------ */
/* Detalle de una consulta pasada (R43)                                */
/* ------------------------------------------------------------------ */

export interface ComidaDeConsulta {
  tipoComida: TipoComida
  patron: string | null
  ejemploMenu: string | null
}

/**
 * El plan que regía el día de la consulta.
 *
 * «Vigente», no «de la consulta»: el plan no cuelga de la consulta en el
 * modelo, el servidor lo deduce por fechas. Ver consulta-detalle.ts.
 */
export interface PlanVigenteEnConsulta {
  id: string
  nombre: string
  objetivo: string | null
  fechaInicio: string | null
  fechaFin: string | null
  estado: EstadoPlan
  notas: string | null
  comidas: ComidaDeConsulta[]
}

/** Todo lo registrado en una consulta, en una sola lectura. */
export interface ConsultaDetalle {
  consulta: Consulta
  /** null cuando esa sección quedó sin registrar. */
  antropometria: Medicion | null
  conclusion: Conclusion | null
  plan: PlanVigenteEnConsulta | null
}

export function getConsultaDetalle(
  pacienteId: string,
  consultaId: string,
  signal?: AbortSignal,
): Promise<ConsultaDetalle> {
  return apiGet<ConsultaDetalle>(
    `/api/pacientes/${pacienteId}/consultas/${consultaId}/detalle`,
    signal,
  )
}
