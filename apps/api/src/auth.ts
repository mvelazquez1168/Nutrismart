/**
 * Autenticacion contra el realm "nutrismart" de Keycloak.
 *
 * Valida la firma del JWT contra el JWKS remoto y exige tres cosas:
 *  1. iss  === KEYCLOAK_ISSUER  (comparacion literal, ver nota abajo)
 *  2. aud  contiene KEYCLOAK_AUDIENCE
 *  3. el claim tenant_id existe y es un UUID
 *
 * De ahi salen `tenantId` y `sub`, que TODA query de negocio debe usar.
 * Cualquier fallo es 401: nunca se deja pasar una peticion sin tenant,
 * porque una query sin filtro de clinica es una fuga entre inquilinos.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { config } from './config.js'

export interface AuthContext {
  /** clinica_id del profesional; acota TODAS las queries. */
  tenantId: string
  /** 'sub' del token = profesional.keycloak_user_id */
  sub: string
  /** Roles de realm, para autorizacion mas fina en rebanadas futuras. */
  roles: string[]
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext
  }
}

/**
 * El JWKS se descarga por la ruta de RED (jwksUrl), que dentro de Docker
 * es keycloak:8080. El issuer que se compara es OTRA cosa: la cadena
 * literal del token, siempre localhost:8080. Mezclarlas es el fallo que
 * convierte todos los tokens validos en 401.
 */
const jwks = createRemoteJWKSet(new URL(config.keycloak.jwksUrl), {
  cooldownDuration: 30_000,
  cacheMaxAge: 600_000,
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

class AuthError extends Error {}

function extractBearer(request: FastifyRequest): string {
  const header = request.headers.authorization
  if (!header) throw new AuthError('Falta la cabecera Authorization')

  const [scheme, token] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new AuthError('La cabecera Authorization debe ser "Bearer <token>"')
  }
  return token.trim()
}

function readRoles(payload: JWTPayload): string[] {
  const realmAccess = payload['realm_access']
  if (realmAccess && typeof realmAccess === 'object' && 'roles' in realmAccess) {
    const roles = (realmAccess as { roles?: unknown }).roles
    if (Array.isArray(roles)) return roles.filter((r): r is string => typeof r === 'string')
  }
  return []
}

function toAuthContext(payload: JWTPayload): AuthContext {
  const sub = payload.sub
  if (!sub) throw new AuthError('El token no trae "sub"')

  const tenantId = payload['tenant_id']
  if (typeof tenantId !== 'string' || tenantId === '') {
    throw new AuthError(
      'El token no trae el claim "tenant_id". Revisa el protocol mapper del cliente en Keycloak.',
    )
  }
  if (!UUID_RE.test(tenantId)) {
    throw new AuthError(`El claim "tenant_id" no es un UUID valido: "${tenantId}"`)
  }

  return { tenantId, sub, roles: readRoles(payload) }
}

/**
 * preHandler que exige un token valido. Uso:
 *   app.get('/api/algo', { preHandler: requireAuth }, handler)
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const token = extractBearer(request)

    const { payload } = await jwtVerify(token, jwks, {
      // Comparacion literal contra la cadena esperada. jose falla si no
      // coincide exactamente; es justo el comportamiento que queremos.
      issuer: config.keycloak.issuer,
      audience: config.keycloak.audience,
    })

    request.auth = toAuthContext(payload)
  } catch (error) {
    const motivo = error instanceof Error ? error.message : 'token invalido'
    request.log.warn({ motivo }, 'auth: peticion rechazada')

    // Al cliente se le dice que no esta autorizado, sin detallar por que:
    // el detalle exacto queda en el log del servidor.
    await reply.code(401).send({ error: 'unauthorized', message: 'Token ausente o invalido' })
  }
}

/**
 * Declara la propiedad `auth` en el objeto request. Debe llamarse UNA vez
 * sobre la instancia raiz, antes de registrar rutas.
 */
export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest('auth', null)
}
