/**
 * Alcance de visibilidad del solicitante.
 *
 * CLI-02: un `nutricionista` ve únicamente a SUS pacientes; un
 * `admin_clinica` ve los de toda la clínica.
 *
 * Se resuelve una vez por petición y se pasa al repositorio como
 * parámetro OBLIGATORIO, igual que `tenantId`. Es deliberado: si fuese
 * un filtro opcional, el noveno endpoint que alguien añada se olvidaría
 * de aplicarlo y la fuga no daría ningún error.
 */
import { pool } from '../db.js'

export const ROL_ADMIN_CLINICA = 'admin_clinica'

export interface Alcance {
  /** profesional.id del solicitante dentro de esta clínica. */
  profesionalId: string
  /**
   * null  -> ve toda la clínica (admin_clinica)
   * valor -> solo los pacientes cuyo nutricionista_id coincida
   */
  restringirA: string | null
  esAdmin: boolean
}

/**
 * Devuelve null si el token no corresponde a ningún profesional activo
 * de esta clínica; quien llama responde 403.
 */
export async function resolverAlcance(
  tenantId: string,
  sub: string,
  roles: string[],
): Promise<Alcance | null> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from profesional
     where keycloak_user_id = $1 and clinica_id = $2 and estado <> 'inactivo'
     limit 1`,
    [sub, tenantId],
  )

  const profesionalId = rows[0]?.id
  if (!profesionalId) return null

  // Si alguien acumula ambos roles, el de administrador gana: es el
  // superconjunto, y negarle acceso por tener además el rol de
  // nutricionista sería un resultado sorprendente.
  const esAdmin = roles.includes(ROL_ADMIN_CLINICA)

  return { profesionalId, restringirA: esAdmin ? null : profesionalId, esAdmin }
}
