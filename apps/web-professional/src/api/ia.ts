/** IA clínica — IA-01, IA-02. */
import { apiGet, apiPost, apiPut } from './client'

export interface Interpretacion {
  id: string
  interpretacion: string
  modelo: string
  tokensEntrada: number | null
  tokensSalida: number | null
  revisada: boolean
  revisadaEn?: string | null
  revisadaPor?: string | null
  profesional?: string | null
  createdAt: string
}

export interface BorradorSOAP {
  subjetivo: string | null
  objetivo: string | null
  analisis: string | null
  planSoap: string | null
}

export interface RespuestaBorrador {
  borrador: BorradorSOAP
  textoCompleto: string
  modelo: string
  tokensSalida: number
}

export interface NotaSOAPResumen {
  id: string
  extracto: string
  generadaIa: boolean
  revisada: boolean
  profesional: string | null
  createdAt: string
}

export interface NotaSOAP extends BorradorSOAP {
  id: string
  generadaIa: boolean
  revisada: boolean
  revisadaEn: string | null
  profesional: string | null
  esAutor: boolean
  createdAt: string
}

/* ---- IA-01 ---- */

/** 404 mientras el estudio no se haya interpretado: es el estado inicial. */
export function getInterpretacion(estudioId: string, signal?: AbortSignal) {
  return apiGet<Interpretacion>(`/api/labs/${estudioId}/interpretacion`, signal)
}

export function interpretar(estudioId: string) {
  return apiPost<Interpretacion>(`/api/labs/${estudioId}/interpretar`, {})
}

export function revisarInterpretacion(estudioId: string, id: string) {
  return apiPut<{ revisada: boolean }>(`/api/labs/${estudioId}/interpretacion/${id}/revisar`, {})
}

/* ---- IA-02 ---- */

export function generarSOAP(
  pacienteId: string,
  datos: { motivoConsulta?: string; observacionesProfesional?: string },
) {
  return apiPost<RespuestaBorrador>(`/api/pacientes/${pacienteId}/soap/generar`, datos)
}

export function guardarSOAP(
  pacienteId: string,
  datos: BorradorSOAP & { generadaIa: boolean; consultaId?: string },
) {
  return apiPost<NotaSOAP>(`/api/pacientes/${pacienteId}/soap`, datos)
}

export function getNotasSOAP(pacienteId: string, signal?: AbortSignal) {
  return apiGet<NotaSOAPResumen[]>(`/api/pacientes/${pacienteId}/soap`, signal)
}

export function getNotaSOAP(pacienteId: string, id: string, signal?: AbortSignal) {
  return apiGet<NotaSOAP>(`/api/pacientes/${pacienteId}/soap/${id}`, signal)
}

export function editarSOAP(pacienteId: string, id: string, cambios: Partial<BorradorSOAP>) {
  return apiPut<NotaSOAP>(`/api/pacientes/${pacienteId}/soap/${id}`, cambios)
}

export function revisarSOAP(pacienteId: string, id: string) {
  return apiPut<{ revisada: boolean }>(`/api/pacientes/${pacienteId}/soap/${id}/revisar`, {})
}

/** Traduce el `tipo` del 503 a algo que el profesional pueda accionar. */
export function motivoIaCaida(tipo: string | undefined): string {
  switch (tipo) {
    case 'sin_configurar':
      return 'Las funciones de IA no están configuradas en este servidor. Habla con quien administra la plataforma.'
    case 'limite_de_uso':
      return 'Se agotó el límite de uso de IA por ahora. El resto del expediente sigue disponible.'
    case 'credencial_invalida':
      return 'La credencial de IA no es válida. Habla con quien administra la plataforma.'
    case 'tiempo_agotado':
      return 'La IA tardó demasiado en responder. Vuelve a intentarlo.'
    case 'sin_conexion':
      return 'No se pudo contactar con el servicio de IA. Vuelve a intentarlo en un momento.'
    case 'sin_contenido':
      return 'El modelo no devolvió contenido para estos datos.'
    default:
      return 'El servicio de IA no está disponible ahora mismo.'
  }
}
