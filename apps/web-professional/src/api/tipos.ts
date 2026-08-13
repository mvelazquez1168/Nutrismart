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
