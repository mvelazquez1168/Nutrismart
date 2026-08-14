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
  /** true cuando el paciente ya activó su cuenta en la app. */
  tieneCuenta: boolean
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

/* ------------------ Rebanada 5 · laboratorios ------------------ */

/**
 * `sin_referencia` NO es un nivel de gravedad entre normal y alterado:
 * es la ausencia de criterio. Ocurre cuando la clínica no ha definido
 * rango para ese analito, o cuando el paciente no tiene sexo biológico
 * registrado y el rango solo existe segmentado.
 */
export type EstadoResultado = 'normal' | 'alterado' | 'sin_referencia'

export interface Biomarcador {
  codigo: string
  nombre: string
  unidad: string
  decimales: number
  grupo: string
  minimo: number | null
  maximo: number | null
  origenRango: 'por_sexo' | 'general' | 'ninguno'
}

export interface ResultadoLab {
  codigo: string
  nombre: string
  unidad: string
  valor: number
  rango: { minimo: number | null; maximo: number | null } | null
  estado: EstadoResultado
  anterior: number | null
  delta: number | null
  tendencia: Tendencia
}

export interface ArchivoAdjunto {
  id: string
  nombreOriginal: string
  mime: string
}

export interface EstudioLab {
  id: string
  fecha: string
  laboratorio: string | null
  notas: string | null
  snapshotId: string | null
  profesional: string | null
  archivo: ArchivoAdjunto | null
  resultados: ResultadoLab[]
}

export interface ArchivoSubido {
  id: string
  nombreOriginal: string
  mime: string
  tamanoBytes: number
  sha256: string
}

export interface PrevisualizacionCsv {
  reconocidos: { codigo: string; nombre: string; unidad: string; valor: number }[]
  noReconocidos: { etiqueta: string; valor: string }[]
  avisos: string[]
}

export interface DatosEstudioEnvio {
  fecha: string
  laboratorio: string | null
  notas: string | null
  archivoId: string | null
  snapshotId: string | null
  resultados: { codigo: string; valor: number }[]
}

/* ------------------------------------------------------------------ */
/* Roles (CLI-06)                                                      */
/* ------------------------------------------------------------------ */

/**
 * Rol de realm que autoriza la configuración de la clínica. Mismo valor
 * que ROL_ADMIN_CLINICA en la API (apps/api/src/pacientes/acceso.ts):
 * es una cadena que viaja en el token, así que tiene que coincidir
 * literalmente en ambos lados.
 */
export const ROL_ADMIN_CLINICA = 'admin_clinica'

/* ------------------------------------------------------------------ */
/* Sociodemografía (CLI-07)                                            */
/* ------------------------------------------------------------------ */

export const NIVELES_ACTIVIDAD = ['sedentario', 'leve', 'moderada', 'intensa'] as const
export type NivelActividad = (typeof NIVELES_ACTIVIDAD)[number]

export const FRECUENCIAS_ALCOHOL = ['nunca', 'ocasional', 'frecuente'] as const
export type FrecuenciaAlcohol = (typeof FRECUENCIAS_ALCOHOL)[number]

export const ESCOLARIDADES = [
  'ninguna',
  'primaria',
  'secundaria',
  'tecnica',
  'universitaria',
  'posgrado',
] as const
export type Escolaridad = (typeof ESCOLARIDADES)[number]

export const TIPOS_HOGAR = [
  'solo',
  'pareja',
  'familia_nuclear',
  'familia_extendida',
  'companeros',
] as const
export type TipoHogar = (typeof TIPOS_HOGAR)[number]

export interface DatosSocio {
  nivelActividad: NivelActividad | null
  horasSueno: number | null
  tabaco: boolean | null
  alcohol: FrecuenciaAlcohol | null
  ocupacion: string | null
  escolaridad: Escolaridad | null
  personasEnHogar: number | null
  tipoHogar: TipoHogar | null
}

export interface Sociodemografia {
  consentimientoOtorgado: boolean
  consentimientoFecha: string | null
  /** true si existe fila, aunque el consentimiento esté revocado. */
  recolectado: boolean
  /** null mientras no haya consentimiento vigente: la API no los envía. */
  datos: DatosSocio | null
}

export interface DatosSocioEnvio extends DatosSocio {
  consentimientoOtorgado: boolean
}
