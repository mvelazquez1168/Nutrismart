/** Sociodemografía del paciente — CLI-07. */
import { apiGet, apiPut } from './client'
import type { DatosSocioEnvio, Sociodemografia } from './tipos'

export function getSociodemografico(
  pacienteId: string,
  signal?: AbortSignal,
): Promise<Sociodemografia> {
  return apiGet<Sociodemografia>(`/api/pacientes/${pacienteId}/sociodemografico`, signal)
}

export function guardarSociodemografico(
  pacienteId: string,
  datos: DatosSocioEnvio,
): Promise<Sociodemografia> {
  return apiPut<Sociodemografia>(`/api/pacientes/${pacienteId}/sociodemografico`, datos)
}
