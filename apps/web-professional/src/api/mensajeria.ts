/** Mensajería profesional–paciente — COM-01. */
import { apiGet, apiPost, apiPut } from './client'

export interface Conversacion {
  id: string
  paciente: { id: string; nombre: string }
  ultimoMensajeAt: string | null
  ultimoContenido: string | null
  ultimoAutor: 'profesional' | 'paciente' | null
  noLeidos: number
}

export interface Mensaje {
  id: string
  autorTipo: 'profesional' | 'paciente'
  contenido: string
  leido: boolean
  createdAt: string
}

export const MAX_MENSAJE = 4000

export function getConversaciones(signal?: AbortSignal): Promise<Conversacion[]> {
  return apiGet<Conversacion[]>('/api/mensajeria/conversaciones', signal)
}

export function abrirConversacion(pacienteId: string): Promise<Conversacion> {
  return apiPost<Conversacion>('/api/mensajeria/conversaciones', { pacienteId })
}

/**
 * `desde` es la marca del último mensaje que ya se tiene: el sondeo pide
 * solo lo posterior en vez de traerse el hilo entero cada pocos segundos.
 */
export function getMensajes(
  conversacionId: string,
  desde?: string | null,
  signal?: AbortSignal,
): Promise<Mensaje[]> {
  const query = desde ? `?desde=${encodeURIComponent(desde)}` : ''
  return apiGet<Mensaje[]>(`/api/mensajeria/conversaciones/${conversacionId}/mensajes${query}`, signal)
}

export function enviarMensaje(conversacionId: string, contenido: string): Promise<Mensaje> {
  return apiPost<Mensaje>(`/api/mensajeria/conversaciones/${conversacionId}/mensajes`, { contenido })
}

export function marcarLeida(conversacionId: string): Promise<{ marcados: number }> {
  return apiPut<{ marcados: number }>(`/api/mensajeria/conversaciones/${conversacionId}/leer`, {})
}

export function getNoLeidos(signal?: AbortSignal): Promise<{ total: number }> {
  return apiGet<{ total: number }>('/api/mensajeria/no-leidos', signal)
}
