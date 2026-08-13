import { apiGet, apiPost, apiPut } from './client'
import type {
  Me,
  Paciente,
  PacienteDetalle,
  DatosPacienteEnvio,
  EstadoClinico,
} from './tipos'

export function getMe(signal?: AbortSignal): Promise<Me> {
  return apiGet<Me>('/api/me', signal)
}

export interface FiltrosPacientes {
  search?: string
  estadoClinico?: EstadoClinico | null
}

export function getPacientes(
  filtros: FiltrosPacientes = {},
  signal?: AbortSignal,
): Promise<Paciente[]> {
  const params = new URLSearchParams()

  if (filtros.search?.trim()) params.set('search', filtros.search.trim())
  if (filtros.estadoClinico) params.set('estadoClinico', filtros.estadoClinico)

  const qs = params.toString()
  return apiGet<Paciente[]>(`/api/pacientes${qs ? `?${qs}` : ''}`, signal)
}

export function getPaciente(id: string, signal?: AbortSignal): Promise<PacienteDetalle> {
  return apiGet<PacienteDetalle>(`/api/pacientes/${id}`, signal)
}

export interface PacienteCreado {
  id: string
  numeroExpediente: number
  estado: string
}

export function crearPaciente(datos: DatosPacienteEnvio): Promise<PacienteCreado> {
  return apiPost<PacienteCreado>('/api/pacientes', datos)
}

export function actualizarPaciente(
  id: string,
  datos: DatosPacienteEnvio,
): Promise<PacienteDetalle> {
  return apiPut<PacienteDetalle>(`/api/pacientes/${id}`, datos)
}

export interface ResultadoBaja {
  id: string
  estado: string
  bajaFecha: string
  bajaMotivo: string | null
}

export function darDeBajaPaciente(id: string, motivo: string | null): Promise<ResultadoBaja> {
  return apiPost<ResultadoBaja>(`/api/pacientes/${id}/baja`, { motivo })
}
