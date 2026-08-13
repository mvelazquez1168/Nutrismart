/** Contratos de docs/REBANADA-01.md. */

export type EstadoClinico = 'normal' | 'alerta' | 'critico'

export interface Paciente {
  id: string
  nombre: string
  /** null si el paciente no tiene fecha de nacimiento registrada. */
  edad: number | null
  estadoClinico: EstadoClinico
  /** 'YYYY-MM-DD' o null si nunca ha venido. */
  ultimaVisita: string | null
  nutricionista: string | null
}

export interface Me {
  profesional: { id: string; nombre: string; rol: string }
  clinica: { id: string; nombre: string }
}
