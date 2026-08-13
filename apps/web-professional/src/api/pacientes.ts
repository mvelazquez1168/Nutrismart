import { apiGet } from './client'
import type { Me, Paciente, EstadoClinico } from './tipos'

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
