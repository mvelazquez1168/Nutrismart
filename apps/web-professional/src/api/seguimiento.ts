/** Consulta de seguimiento — EVAL-08. */
import { apiGet } from './client'

export interface FotoAntropometria {
  pesoKg: number | null
  tallaCm: number | null
  imc: number | null
  pctGrasa: number | null
  masaLibreGrasaKg: number | null
  masaMuscularKg: number | null
  anguloFase: number | null
  cinturaCm: number | null
  caderaCm: number | null
  icc: number | null
  metodo: string | null
  fechaMedicion: string | null
}

export interface FotoConsulta {
  consulta: {
    id: string
    tipo: string
    numeroConsulta: number
    fechaConsulta: string
    estado: string
  }
  antropometria: FotoAntropometria | null
  historial: Record<string, unknown> | null
  dietetico: Record<string, unknown> | null
  conclusion: Record<string, unknown> | null
}

export interface Indicador {
  clave: string
  etiqueta: string
  unidad: string
  anterior: number | null
  actual: number | null
  delta: number | null
  pctCambio: number | null
  /** Dirección del cambio. NO dice si es bueno o malo — ver la API. */
  direccion: 'sube' | 'baja' | 'igual' | null
}

export interface Comparativa {
  anterior: FotoConsulta | null
  actual: FotoConsulta
  diasEntre: number | null
  indicadores: Indicador[]
  acuerdos: {
    total: number
    cumplidos: number
    detalle: { texto: string; cumplido: boolean }[]
  }
}

/** 404 cuando es la primera valoración; quien llama lo trata como modo inicial. */
export function getUltimaFinalizada(
  pacienteId: string,
  signal?: AbortSignal,
): Promise<FotoConsulta> {
  return apiGet<FotoConsulta>(`/api/pacientes/${pacienteId}/consultas/ultima-finalizada`, signal)
}

export function getComparativa(
  pacienteId: string,
  consultaActualId: string,
  signal?: AbortSignal,
): Promise<Comparativa> {
  return apiGet<Comparativa>(
    `/api/pacientes/${pacienteId}/consultas/comparativa?consultaActualId=${consultaActualId}`,
    signal,
  )
}
