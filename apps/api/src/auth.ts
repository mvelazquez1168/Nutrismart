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
 * Contexto de un PACIENTE autenticado.
 *
 * No lleva tenantId, y es deliberado. El claim `tenant_id` lo pone un
 * protocol mapper sobre un atributo del usuario, y un paciente que acaba
 * de registrarse no tiene ese atributo: su clinica no vive en Keycloak,
 * vive en la invitacion que le enviaron. Exigir el claim aqui haria que
 * la vinculacion fallara con 401 antes de llegar al handler.
 *
 * La clinica del paciente se resuelve SIEMPRE contra la base a partir de
 * `sub`. Eso no es una concesion: es mas seguro que confiar en un claim,
 * porque el tenant deja de depender de nada que viaje en el token.
 */
export interface AuthPaciente {
  /** 'sub' del token = paciente.keycloak_user_id */
  sub: string
  roles: string[]
}

declare module 'fastify' {
  interface FastifyRequest {
    authPac: AuthPaciente
  }
}

/**
 * preHandler para las rutas del paciente. Valida firma, emisor y
 * audiencia igual que requireAuth, y NO exige tenant_id.
 *
 * Tampoco exige el rol `paciente`, y conviene explicar por que. Nadie
 * asigna ese rol cuando alguien se registra desde el enlace de
 * invitacion: exigirlo aqui haria que la vinculacion —el unico momento
 * en que podria asignarse— fallara con 403 antes de ocurrir. Es un
 * circulo cerrado.
 *
 * La autorizacion real no la da el rol, la da la fila: solo se atiende a
 * quien tiene un expediente ACTIVO cuyo keycloak_user_id coincide con el
 * `sub` del token. Un token sin expediente detras no abre nada, lleve el
 * rol que lleve. El rol seguiria siendo una etiqueta sobre la misma
 * comprobacion.
 */
export async function requireAuthPaciente(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    const token = extractBearer(request)
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.keycloak.issuer,
      audience: config.keycloak.audience,
    })

    const sub = payload.sub
    if (!sub) throw new AuthError('El token no trae "sub"')

    request.authPac = { sub, roles: readRoles(payload) }
  } catch (error) {
    const motivo = error instanceof Error ? error.message : 'token invalido'
    request.log.warn({ motivo }, 'auth-paciente: peticion rechazada')
    await reply.code(401).send({ error: 'unauthorized', message: 'Token ausente o invalido' })
  }
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
  // Fastify quiere que el decorador exista antes de la primera peticion
  // para no cambiar la forma del objeto request en caliente (lo que
  // penaliza el rendimiento). Pero `auth` esta declarado como
  // AuthContext, no como AuthContext|null, porque dentro de un handler
  // protegido por requireAuth SIEMPRE existe: declararlo opcional
  // obligaria a comprobarlo en cada ruta para nada.
  //
  // La conversion salva justo ese hueco entre el valor inicial y el
  // tipo que se garantiza en tiempo de ejecucion.
  app.decorateRequest('auth', null as unknown as AuthContext)
  app.decorateRequest('authPac', null as unknown as AuthPaciente)
}
