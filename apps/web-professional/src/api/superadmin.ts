/** Cliente API para el panel super-administrador de NutriSmart. */
import { apiGet, apiPost } from './client'

export interface Clinica {
  id: string
  nombre_comercial: string
  nombre_fiscal: string | null
  pais: string
  created_at: string
}

export interface AdminClinica {
  id: string
  keycloakUserId: string
  clinicaId: string
  nombre: string
  correo: string
  rol: 'admin_clinica'
  estado: 'activo'
}

export function getClincias(signal?: AbortSignal): Promise<Clinica[]> {
  return apiGet<Clinica[]>('/api/superadmin/clinicas', signal)
}

export function crearClinica(
  datos: { nombre_comercial: string; pais: string },
  signal?: AbortSignal,
): Promise<{ id: string; nombre_comercial: string; pais: string }> {
  return apiPost('/api/superadmin/clinicas', datos, signal)
}

export function crearAdminClinica(
  clinicaId: string,
  datos: { nombre: string; correo: string },
  signal?: AbortSignal,
): Promise<AdminClinica> {
  return apiPost(`/api/superadmin/clinicas/${clinicaId}/admin`, datos, signal)
}
