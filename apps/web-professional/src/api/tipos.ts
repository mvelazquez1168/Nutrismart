/** Contratos de docs/REBANADA-01.md y docs/REBANADA-02.md. */

export type EstadoClinico = 'normal' | 'alerta' | 'critico'

/**
 * Ciclo de vida administrativo, distinto del estado clínico:
 *   activo   = en seguimiento
 *   inactivo = sin citas activas, puede volver; SÍ aparece en la lista
 *   baja     = archivado; la API nunca lo devuelve en el listado
 */
export type EstadoPaciente = 'activo' | 'inactivo' | 'baja'

export const DOCUMENTO_TIPOS = ['cedula', 'dimex', 'pasaporte', 'nite'] as const
export type DocumentoTipo = (typeof DOCUMENTO_TIPOS)[number]

export const SEXOS_BIOLOGICOS = ['masculino', 'femenino', 'intersexual'] as const
export type SexoBiologico = (typeof SEXOS_BIOLOGICOS)[number]

export interface Paciente {
  id: string
  nombre: string
  /** null si el paciente no tiene fecha de nacimiento registrada. */
  edad: number | null
  estado: EstadoPaciente
  estadoClinico: EstadoClinico
  /** 'YYYY-MM-DD' o null si nunca ha venido. */
  ultimaVisita: string | null
  nutricionista: string | null
}

export interface PacienteDetalle {
  id: string
  numeroExpediente: number | null
  nombre: string
  edad: number | null
  fechaNacimiento: string | null
  sexoBiologico: SexoBiologico | null
  documento: { tipo: DocumentoTipo | null; numero: string | null }
  telefono: string | null
  correo: string | null
  estado: EstadoPaciente
  estadoClinico: EstadoClinico
  motivoConsulta: string | null
  diagnosticos: { descripcion: string }[]
  alergias: { descripcion: string }[]
  nutricionista: string | null
  baja: { motivo: string | null; fecha: string } | null
}

/** Cuerpo de POST y PUT. Coincide con validarPaciente() de la API. */
export interface DatosPacienteEnvio {
  nombre: string
  documentoTipo: DocumentoTipo | null
  documentoNumero: string | null
  fechaNacimiento: string | null
  sexoBiologico: SexoBiologico | null
  telefono: string | null
  correo: string | null
  motivoConsulta: string | null
  diagnosticos: string[]
  alergias: string[]
}

/** Un error de validación de la API, ya asociado a su campo. */
export interface ErrorCampo {
  campo: string
  mensaje: string
}

export interface Me {
  profesional: { id: string; nombre: string; rol: string }
  clinica: { id: string; nombre: string }
}

/* ---------------- Rebanada 3 · expediente y timeline ---------------- */

export interface MetricaCatalogo {
  codigo: string
  nombre: string
  unidad: string
  decimales: number
  minPlausible: number | null
  maxPlausible: number | null
}

/**
 * `tendencia` es DIRECCIÓN, no juicio clínico: bajar de peso puede ser
 * el objetivo o una alarma según el paciente. La UI muestra hacia dónde
 * se movió el dato; interpretarlo es del profesional.
 */
export type Tendencia = 'sube' | 'baja' | 'igual' | null

export interface MetricaValor {
  codigo: string
  nombre: string
  unidad: string
  valor: number
  fecha?: string
  /** null = no hay punto previo con el que comparar (distinto de 0). */
  anterior: number | null
  delta: number | null
  tendencia: Tendencia
}

export type EstadoSnapshot = 'borrador' | 'cerrado' | 'corregido'

export interface SnapshotResumen {
  id: string
  fecha: string
  estado: EstadoSnapshot
  profesional: string | null
  nota: string | null
  metricas: MetricaValor[]
  corrigeA: string | null
  /** Versión anterior, anidada bajo la que la reemplaza. */
  corregidoPor: SnapshotResumen | null
  /** Enganches de CLI-04 y CLI-05; hoy siempre null. */
  labs: null
  estrategia: null
}

export interface Expediente {
  paciente: { id: string; nombre: string; edad: number | null }
  metricas: MetricaValor[]
  diagnosticos: { descripcion: string }[]
  alergias: { descripcion: string }[]
  antecedentes: { tipo: string; descripcion: string }[]
  ultimoSnapshot: { id: string; fecha: string } | null
}

export interface DatosSnapshotEnvio {
  fecha: string
  metricas: Record<string, number>
  nota: string | null
}

/* ---------------------- Rebanada 4 · agenda ---------------------- */

export const CITA_TIPOS = ['primera_vez', 'seguimiento', 'control'] as const
export type CitaTipo = (typeof CITA_TIPOS)[number]

export const CITA_ESTADOS = ['programada', 'completada', 'cancelada'] as const
export type CitaEstado = (typeof CITA_ESTADOS)[number]

export interface Cita {
  id: string
  /** Instante en UTC; se formatea en el huso del navegador. */
  inicio: string
  fin: string
  duracionMinutos: number
  tipo: CitaTipo
  estado: CitaEstado
  notas: string | null
  /** Control clínico generado por esta cita, si lo hay. */
  snapshotId: string | null
  paciente: { id: string; nombre: string }
  profesional: string | null
}

export interface DatosCitaEnvio {
  pacienteId?: string
  inicio: string
  duracionMinutos: number
  tipo: CitaTipo
  notas: string | null
}

export interface Profesional {
  id: string
  nombre: string
  rol: string
}
