import { apiGet, apiPost, apiUpload, apiDescargar } from './client'
import type {
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

export function crearEstudio(
  pacienteId: string,
  datos: DatosEstudioEnvio,
): Promise<{ id: string; fecha: string; resultados: number }> {
  return apiPost(`/api/pacientes/${pacienteId}/laboratorios`, datos)
}

export function descargarArchivo(archivoId: string, nombre: string): Promise<void> {
  return apiDescargar(`/api/archivos/${archivoId}`, nombre)
}
