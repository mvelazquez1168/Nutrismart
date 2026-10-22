import { apiGet, apiPost, apiDelete, apiUpload, apiDescargar } from './client'
import type {
  AnalitoHistorico,
  ArchivoSubido,
  Biomarcador,
  DatosEstudioEnvio,
  EstudioLab,
  PrevisualizacionCsv,
  SexoBiologico,
} from './tipos'

export function getBiomarcadores(
  sexo?: SexoBiologico | null,
  signal?: AbortSignal,
): Promise<Biomarcador[]> {
  const qs = sexo ? `?sexo=${sexo}` : ''
  return apiGet<Biomarcador[]>(`/api/biomarcadores${qs}`, signal)
}

/**
 * La serie histórica por analito — R49.
 *
 * Aparte de `getLaboratorios`: aquél está organizado por ESTUDIO —lo que
 * trajo cada informe— y éste por ANALITO —cómo ha ido evolucionando cada uno—.
 * Son las dos preguntas de una consulta de seguimiento, y ninguna se contesta
 * bien con la forma de la otra.
 */
export function getAnalitica(
  pacienteId: string,
  signal?: AbortSignal,
): Promise<AnalitoHistorico[]> {
  return apiGet<AnalitoHistorico[]>(`/api/pacientes/${pacienteId}/analitica`, signal)
}

export function getLaboratorios(
  pacienteId: string,
  signal?: AbortSignal,
): Promise<EstudioLab[]> {
  return apiGet<EstudioLab[]>(`/api/pacientes/${pacienteId}/laboratorios`, signal)
}

export function subirArchivo(archivo: File): Promise<ArchivoSubido> {
  return apiUpload<ArchivoSubido>('/api/archivos', archivo)
}

export function previsualizarCsv(archivoId: string): Promise<PrevisualizacionCsv> {
  return apiPost<PrevisualizacionCsv>(`/api/archivos/${archivoId}/previsualizar-csv`, {})
}

/**
 * Lectura con IA del PDF del informe — R43.
 *
 * Misma forma que la del CSV a propósito: lo que devuelve alimenta la misma
 * pantalla de revisión, y el profesional confirma antes de que nada se guarde.
 * Los fallos de lectura llegan como `avisos`, no como error: el informe ya
 * está adjunto y la captura manual sigue abierta.
 */
export function previsualizarPdf(archivoId: string): Promise<PrevisualizacionCsv> {
  return apiPost<PrevisualizacionCsv>(`/api/archivos/${archivoId}/previsualizar-pdf`, {})
}

export function crearEstudio(
  pacienteId: string,
  datos: DatosEstudioEnvio,
): Promise<{ id: string; fecha: string; resultados: number }> {
  return apiPost(`/api/pacientes/${pacienteId}/laboratorios`, datos)
}

/**
 * Borra un estudio cargado por equivocación — R51.
 *
 * No es «anular»: eso es para un estudio que ocurrió y clínicamente no vale,
 * y se queda en el expediente. Esto deshace una carga que no debió existir.
 */
export function eliminarEstudio(pacienteId: string, estudioId: string): Promise<void> {
  return apiDelete(`/api/pacientes/${pacienteId}/laboratorios/${estudioId}`)
}

export function descargarArchivo(archivoId: string, nombre: string): Promise<void> {
  return apiDescargar(`/api/archivos/${archivoId}`, nombre)
}
