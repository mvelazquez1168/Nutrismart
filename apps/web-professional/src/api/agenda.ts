import { apiGet, apiPost, apiPut } from './client'
import type { Cita, CitaEstado, DatosCitaEnvio, Profesional } from './tipos'

export interface FiltrosAgenda {
  /** Instantes ISO; los construye lib/fechas a partir del día local. */
  desde: string
  hasta: string
  estado?: CitaEstado | null
  profesionalId?: string | null
  pacienteId?: string | null
}

export function getCitas(filtros: FiltrosAgenda, signal?: AbortSignal): Promise<Cita[]> {
  const p = new URLSearchParams({ desde: filtros.desde, hasta: filtros.hasta })
  if (filtros.estado) p.set('estado', filtros.estado)
  if (filtros.profesionalId) p.set('profesionalId', filtros.profesionalId)
  if (filtros.pacienteId) p.set('pacienteId', filtros.pacienteId)
  return apiGet<Cita[]>(`/api/citas?${p.toString()}`, signal)
}

export function getCita(id: string, signal?: AbortSignal): Promise<Cita> {
  return apiGet<Cita>(`/api/citas/${id}`, signal)
}

export function getProfesionales(signal?: AbortSignal): Promise<Profesional[]> {
  return apiGet<Profesional[]>('/api/profesionales', signal)
}

export function crearCita(datos: DatosCitaEnvio): Promise<{ id: string; estado: string }> {
  return apiPost('/api/citas', datos)
}

export function actualizarCita(id: string, datos: DatosCitaEnvio): Promise<Cita> {
  return apiPut<Cita>(`/api/citas/${id}`, datos)
}

export function cambiarEstadoCita(
  id: string,
  estado: CitaEstado,
): Promise<{ id: string; estado: CitaEstado }> {
  return apiPost(`/api/citas/${id}/estado`, { estado })
}

export function registrarControl(
  citaId: string,
): Promise<{ citaId: string; snapshotId: string; estado: string }> {
  return apiPost(`/api/citas/${citaId}/control`, {})
}
