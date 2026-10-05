/**
 * Cliente API para el panel super-administrador de NutriSmart.
 *
 * Es el único módulo de esta aplicación que NO está acotado a una clínica:
 * trabaja por encima de todas ellas. La autorización la da el rol
 * `super_admin` del token, que la API comprueba con su propio preHandler
 * (`requireSuperAdmin` en apps/api/src/auth.ts).
 *
 * Los nombres en snake_case son los que devuelve la API en estas rutas.
 * Se dejan tal cual a propósito: traducirlos aquí a camelCase crearía dos
 * vocabularios para el mismo objeto, y el de la API es el que se ve al
 * depurar con `curl`.
 */
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

export function getClinicas(signal?: AbortSignal): Promise<Clinica[]> {
  return apiGet<Clinica[]>('/api/superadmin/clinicas', signal)
}

export function crearClinica(
  datos: { nombre_comercial: string; pais: string },
  signal?: AbortSignal,
): Promise<{ id: string; nombre_comercial: string; pais: string }> {
  return apiPost('/api/superadmin/clinicas', datos, signal)
}

/**
 * Crea el primer administrador de una clínica: usuario en Keycloak con el
 * rol `admin_clinica`, el atributo `tenant_id` de esa clínica, y el correo
 * para que establezca su contraseña.
 *
 * Si el rol no se puede asignar, la API responde **503 `rol_no_asignado`**
 * y deshace el usuario: no deja a nadie a medio crear. Un administrador sin
 * su rol entraría sin poder administrar nada.
 */
export function crearAdminClinica(
  clinicaId: string,
  datos: { nombre: string; correo: string },
  signal?: AbortSignal,
): Promise<AdminClinica> {
  return apiPost(`/api/superadmin/clinicas/${clinicaId}/admin`, datos, signal)
}
