/** Dashboard administrativo — CLI-08. */
import { apiGet } from './client'
import type { CitaHoy } from '../components/AgendaHoy'
import type { FilaProfesional } from '../components/TablaProfesionales'

export const PERIODOS = ['hoy', 'semana', 'mes'] as const
export type Periodo = (typeof PERIODOS)[number]

export const ETIQUETA_PERIODO: Record<Periodo, string> = {
  hoy: 'Hoy',
  semana: 'Semana',
  mes: 'Este mes',
}

export interface Dashboard {
  periodo: Periodo
  desde: string
  hasta: string
  generadoEn: string
  kpis: {
    citasTotal: number
    citasCompletadas: number
    citasCanceladas: number
    citasPendientes: number
    pacientesActivos: number
    pacientesNuevos: number
    snapshotsCreados: number
    examenesSubidos: number
  }
  agendaHoy: CitaHoy[]
  porProfesional: FilaProfesional[]
}

export function getDashboard(periodo: Periodo, signal?: AbortSignal): Promise<Dashboard> {
  return apiGet<Dashboard>(`/api/admin/dashboard?periodo=${periodo}`, signal)
}
