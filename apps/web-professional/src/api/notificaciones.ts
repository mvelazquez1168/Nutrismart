/** Notificaciones y reglas paramétricas — COM-02 y COM-03. */
import { apiDelete, apiGet, apiPost, apiPut } from './client'

export type TipoNotificacion =
  | 'mensaje_nuevo'
  | 'lab_cargado'
  | 'cita_proxima'
  | 'cita_hoy'
  | 'plan_actualizado'
  | 'paciente_nuevo'
  | 'cumpleanos'
  | 'reminder'
  | 'checkup'
  | 'fecha_importante'

export interface Notificacion {
  id: string
  tipo: TipoNotificacion
  titulo: string
  contenido: string | null
  enlace: string | null
  leida: boolean
  createdAt: string
}

export const TIPOS_REGLA = [
  {
    clave: 'cumpleanos',
    etiqueta: 'Cumpleaños',
    descripcion: 'Avisa el día que un paciente cumple años.',
  },
  {
    clave: 'reminder',
    etiqueta: 'Recordatorio de cita',
    descripcion: 'Avisa de las citas próximas con la antelación que elijas.',
  },
  {
    clave: 'checkup',
    etiqueta: 'Control de seguimiento',
    descripcion: 'Avisa cuando un paciente lleva tiempo sin consulta.',
  },
  {
    clave: 'fecha_importante',
    etiqueta: 'Fecha señalada',
    descripcion: 'Avisa a toda la clínica en una fecha concreta.',
  },
] as const

export type TipoRegla = (typeof TIPOS_REGLA)[number]['clave']

export interface Regla {
  id: string
  nombre: string
  tipo: TipoRegla
  activa: boolean
  parametros: Record<string, unknown>
  createdAt: string
}

export function getNotificaciones(limite = 20, signal?: AbortSignal): Promise<Notificacion[]> {
  return apiGet<Notificacion[]>(`/api/notificaciones?limite=${limite}`, signal)
}

export function getContadorNotificaciones(signal?: AbortSignal): Promise<{ noLeidas: number }> {
  return apiGet<{ noLeidas: number }>('/api/notificaciones/contador', signal)
}

export function marcarNotificacionLeida(id: string): Promise<{ marcada: boolean }> {
  return apiPut<{ marcada: boolean }>(`/api/notificaciones/${id}/leer`, {})
}

export function marcarTodasLeidas(): Promise<{ actualizadas: number }> {
  return apiPut<{ actualizadas: number }>('/api/notificaciones/leer-todas', {})
}

export function getReglas(signal?: AbortSignal): Promise<Regla[]> {
  return apiGet<Regla[]>('/api/notificaciones/reglas', signal)
}

export function crearRegla(datos: {
  nombre: string
  tipo: TipoRegla
  parametros: Record<string, unknown>
}): Promise<Regla> {
  return apiPost<Regla>('/api/notificaciones/reglas', datos)
}

export function actualizarRegla(
  id: string,
  datos: { nombre?: string; parametros?: Record<string, unknown> },
): Promise<Regla> {
  return apiPut<Regla>(`/api/notificaciones/reglas/${id}`, datos)
}

export function activarRegla(id: string, activa: boolean): Promise<{ activa: boolean }> {
  return apiPut<{ activa: boolean }>(`/api/notificaciones/reglas/${id}/activar`, { activa })
}

export function eliminarRegla(id: string): Promise<void> {
  return apiDelete(`/api/notificaciones/reglas/${id}`)
}

export function evaluarReglas(): Promise<{ generadas: number; reglasEvaluadas: number }> {
  return apiPost<{ generadas: number; reglasEvaluadas: number }>(
    '/api/notificaciones/reglas/evaluar',
    {},
  )
}
