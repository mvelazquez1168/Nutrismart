import { apiGet, apiPost, apiPut } from './client'
import type {
  DatosSnapshotEnvio,
  Expediente,
  MetricaCatalogo,
  SnapshotResumen,
} from './tipos'

export function getMetricas(signal?: AbortSignal): Promise<MetricaCatalogo[]> {
  return apiGet<MetricaCatalogo[]>('/api/metricas', signal)
}

export function getExpediente(pacienteId: string, signal?: AbortSignal): Promise<Expediente> {
  return apiGet<Expediente>(`/api/pacientes/${pacienteId}/expediente`, signal)
}

export function getTimeline(
  pacienteId: string,
  signal?: AbortSignal,
): Promise<SnapshotResumen[]> {
  return apiGet<SnapshotResumen[]>(`/api/pacientes/${pacienteId}/snapshots`, signal)
}

export function getSnapshot(id: string, signal?: AbortSignal): Promise<SnapshotResumen> {
  return apiGet<SnapshotResumen>(`/api/snapshots/${id}`, signal)
}

export interface SnapshotCreado {
  id: string
  estado: string
  fecha: string
}

export function crearSnapshot(
  pacienteId: string,
  datos: DatosSnapshotEnvio,
): Promise<SnapshotCreado> {
  return apiPost<SnapshotCreado>(`/api/pacientes/${pacienteId}/snapshots`, datos)
}

export function actualizarSnapshot(
  snapshotId: string,
  datos: DatosSnapshotEnvio,
): Promise<SnapshotCreado> {
  return apiPut<SnapshotCreado>(`/api/snapshots/${snapshotId}`, datos)
}

export function cerrarSnapshot(snapshotId: string): Promise<SnapshotCreado> {
  // Cuerpo vacío pero con Content-Type JSON: sin cabecera, algunos
  // clientes mandan form-urlencoded y Fastify responde 415.
  return apiPost<SnapshotCreado>(`/api/snapshots/${snapshotId}/cerrar`, {})
}

export function corregirSnapshot(
  snapshotId: string,
): Promise<{ id: string; corrigeA: string; estado: string }> {
  return apiPost(`/api/snapshots/${snapshotId}/corregir`, {})
}
