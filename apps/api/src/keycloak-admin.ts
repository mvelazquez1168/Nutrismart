/**
 * Cliente del Keycloak Admin API.
 *
 * Permite que la API cree usuarios directamente en Keycloak sin
 * intervención manual. Usa un service account del realm nutrismart
 * con el rol `manage-users` de `realm-management`.
 *
 * Variables de entorno requeridas:
 *   KEYCLOAK_ADMIN_URL   — URL interna de Keycloak (ej: http://keycloak:8080)
 *   KEYCLOAK_REALM       — Realm donde viven los usuarios (ej: nutrismart)
 *   KEYCLOAK_SVC_CLIENT  — Client ID del service account (ej: nutrismart-backend)
 *   KEYCLOAK_SVC_SECRET  — Client secret del service account
 */
import { config } from './config.js'

/**
 * Token del service account, reutilizado mientras siga vigente.
 *
 * Dar de alta a un administrador son cuatro o cinco llamadas al Admin API
 * (crear usuario, leer roles, asignar, mandar el correo). Pedir un token
 * nuevo en cada una multiplica la latencia del alta y llena los eventos de
 * Keycloak de logins del backend.
 *
 * Se descarta 30 segundos antes de caducar: usado hasta el último
 * instante, una llamada que sale justo en el límite llega con un token ya
 * expirado y responde 401 sin motivo aparente.
 */
let tokenCache: { valor: string; expiraEn: number } | null = null

/** Obtiene un access token via client_credentials del service account. */
async function getAdminToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiraEn) return tokenCache.valor

  const url = `${config.keycloak.adminUrl}/realms/${config.keycloak.realm}/protocol/openid-connect/token`
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.keycloak.svcClientId,
    client_secret: config.keycloak.svcClientSecret,
  })

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Keycloak admin token error ${resp.status}: ${text}`)
  }

  const data = (await resp.json()) as { access_token: string; expires_in?: number }
  const vidaSegundos = typeof data.expires_in === 'number' ? data.expires_in : 60
  tokenCache = {
    valor: data.access_token,
    expiraEn: Date.now() + Math.max(0, vidaSegundos - 30) * 1000,
  }
  return data.access_token
}

/**
 * Crea un usuario en Keycloak y devuelve su UUID (keycloak_user_id).
 *
 * El usuario nace habilitado pero con `UPDATE_PASSWORD` como acción
 * requerida: en su primer acceso Keycloak le pedirá que establezca
 * su contraseña. El correo de activación se envía por separado con
 * `enviarEmailActivacion`.
 *
 * ── `tenantId` es OBLIGATORIO, y conviene explicar por qué ──────────
 *
 * El claim `tenant_id` del token no lo inventa Keycloak: sale de un
 * protocol mapper del cliente `nutrismart-web` que copia el **atributo de
 * usuario** `tenant_id` (ver infra/keycloak/realm-nutrismart.json). Si el
 * usuario nace sin ese atributo, su token nace sin el claim, y
 * `requireAuth` responde **401 a todo**.
 *
 * El síntoma es de los peores que hay: el alta sale perfecta, el correo
 * llega, la persona establece su contraseña, Keycloak la autentica sin un
 * solo error… y la aplicación le dice que su sesión no es válida. Nada en
 * el log de Keycloak apunta al problema, porque desde su punto de vista no
 * hay ninguno.
 *
 * Por eso va como parámetro requerido y no como opcional: un `tenantId?`
 * se olvida en la siguiente llamada que alguien añada, y el olvido no
 * produce ningún error hasta que una persona real intenta entrar.
 */
export async function crearUsuarioKeycloak(params: {
  username: string
  email: string
  firstName: string
  lastName?: string
  /** clinica_id a la que pertenece. Va al atributo que alimenta el claim. */
  tenantId: string
}): Promise<string> {
  const token = await getAdminToken()
  const url = `${config.keycloak.adminUrl}/admin/realms/${config.keycloak.realm}/users`

  const body = {
    username: params.username,
    email: params.email,
    firstName: params.firstName,
    lastName: params.lastName ?? '',
    enabled: true,
    emailVerified: false,
    requiredActions: ['UPDATE_PASSWORD'],
    // El mapper lo declara `multivalued: false`, pero el Admin API espera
    // los atributos como lista. Keycloak toma el primer elemento.
    attributes: { tenant_id: [params.tenantId] },
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  if (resp.status === 409) {
    throw new Error('Ya existe un usuario con ese correo en Keycloak')
  }
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Keycloak create user error ${resp.status}: ${text}`)
  }

  // Keycloak devuelve el ID en el header Location: .../users/{id}
  const location = resp.headers.get('Location') ?? ''
  const userId = location.split('/').at(-1)
  if (!userId) throw new Error('Keycloak no devolvió el ID del usuario creado')

  return userId
}

/**
 * Envía el email de activación para que el profesional establezca
 * su contraseña. Si Keycloak no tiene SMTP configurado, el link
 * aparece en los eventos del administrador.
 */
export async function enviarEmailActivacion(keycloakUserId: string): Promise<void> {
  const token = await getAdminToken()
  const url =
    `${config.keycloak.adminUrl}/admin/realms/${config.keycloak.realm}` +
    `/users/${keycloakUserId}/execute-actions-email`

  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(['UPDATE_PASSWORD']),
  })

  if (!resp.ok) {
    // No lanzamos: el usuario ya fue creado. Solo logueamos.
    const text = await resp.text()
    console.warn(`[keycloak-admin] email de activación falló ${resp.status}: ${text}`)
  }
}

/**
 * Elimina un usuario de Keycloak. Solo se usa para hacer rollback
 * si la inserción en la DB falla después de crear el usuario.
 */
export async function eliminarUsuarioKeycloak(keycloakUserId: string): Promise<void> {
  const token = await getAdminToken()
  const url =
    `${config.keycloak.adminUrl}/admin/realms/${config.keycloak.realm}/users/${keycloakUserId}`

  await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

interface RolKeycloak {
  id?: string
  name?: string
}

/** Lee una lista de roles de realm del Admin API. */
async function leerRoles(url: string, token: string, que: string): Promise<RolKeycloak[]> {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!resp.ok) {
    throw new Error(`Keycloak ${que} error ${resp.status}: ${await resp.text()}`)
  }
  return (await resp.json()) as RolKeycloak[]
}

/**
 * Asigna un rol de realm a un usuario de Keycloak.
 *
 * Se usa al crear un admin_clinica para que su token ya traiga el rol
 * `admin_clinica` desde el primer login, sin intervención manual.
 *
 * ── Por qué el rol se busca en los endpoints del USUARIO ────────────
 *
 * El endpoint de role-mappings no acepta el nombre del rol: quiere la
 * representación completa (`{id, name}`). Lo evidente sería pedirla con
 * `GET /roles/{nombre}`, pero esa ruta exige el rol **`view-realm`** del
 * service account, mientras que las de role-mappings de un usuario se
 * cubren con el **`manage-users`** que ya hace falta para crearlo — el
 * único permiso que la cabecera de este módulo promete.
 *
 * Pedir más permiso del necesario para ahorrar una llamada es un mal
 * cambio: `view-realm` abre la lectura de toda la configuración del
 * realm, y el síntoma de que falte es desconcertante —el usuario se crea
 * bien y el rol no, con un 403 que no menciona ningún rol.
 *
 * ── Y por qué eso además lo hace idempotente ────────────────────────
 *
 * `/available` devuelve los roles que al usuario le **faltan**. Así que
 * primero se mira lo que ya tiene: si el rol está ahí, no hay nada que
 * hacer. Sin ese primer paso, reasignar un rol que ya tiene lo buscaría
 * entre los disponibles, no lo encontraría, y se reportaría como «el
 * realm no tiene ese rol» — exactamente al revés de lo que pasa.
 *
 * Si el rol no existe en el realm, lanza un error.
 * Si la asignación falla, lanza un error — el llamador decide si hacer
 * rollback o no; en `superadmin.ts` eliminamos al usuario de Keycloak si
 * no podemos asignarle el rol, y en `equipo.ts` el alta sigue adelante y
 * el aviso viaja en la respuesta (ver `intentarAsignarRol`).
 */
export async function asignarRolKeycloak(
  keycloakUserId: string,
  rolNombre: string,
): Promise<void> {
  const token = await getAdminToken()
  const baseUrl =
    `${config.keycloak.adminUrl}/admin/realms/${config.keycloak.realm}` +
    `/users/${keycloakUserId}/role-mappings/realm`

  // 1. Lo que ya tiene. Si el rol está, no hay nada que hacer.
  const yaTiene = await leerRoles(baseUrl, token, 'get user realm roles')
  if (yaTiene.some((r) => r.name === rolNombre)) return

  // 2. Lo que le falta, que es donde vive la representación con su id.
  const disponibles = await leerRoles(
    `${baseUrl}/available`,
    token,
    'get available realm roles',
  )
  const rol = disponibles.find((r) => r.name === rolNombre)
  if (!rol?.id) {
    throw new Error(
      `Keycloak: el realm "${config.keycloak.realm}" no tiene el rol "${rolNombre}". ` +
        `Créalo en Keycloak → Realm roles y vuelve a intentarlo.`,
    )
  }

  // 3. Asignar.
  const asignResp = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify([{ id: rol.id, name: rolNombre }]),
  })

  if (!asignResp.ok) {
    const text = await asignResp.text()
    throw new Error(
      `Keycloak: no se pudo asignar el rol "${rolNombre}" al usuario ${keycloakUserId} (${asignResp.status}): ${text}`,
    )
  }
}

/**
 * Igual que `asignarRolKeycloak` pero **no lanza**: devuelve el motivo
 * del fallo, o `null` si fue bien.
 *
 * Es la forma que usa el alta de equipo (`routes/equipo.ts`), donde al
 * llegar a este punto el usuario ya existe en Keycloak **y el profesional
 * ya está en la base**. Si un fallo aquí tumbara la petición con un 500,
 * el administrador vería «no se pudo dar de alta» sobre alguien que SÍ
 * quedó dado de alta, y al reintentar chocaría con «correo repetido».
 *
 * `superadmin.ts` no la usa, y con razón: allí el rol se asigna **antes**
 * del insert, así que un fallo se puede deshacer por completo borrando el
 * usuario. Teniendo rollback limpio, es mejor fallar que quedar a medias.
 *
 * El motivo viaja en la respuesta para que la pantalla pueda decir qué
 * falta en vez de fingir que todo salió bien.
 */
export async function intentarAsignarRol(
  keycloakUserId: string,
  rolNombre: string,
): Promise<string | null> {
  try {
    await asignarRolKeycloak(keycloakUserId, rolNombre)
    return null
  } catch (err) {
    const motivo = err instanceof Error ? err.message : `No se pudo asignar el rol ${rolNombre}`
    console.warn(`[keycloak-admin] rol "${rolNombre}" no asignado a ${keycloakUserId}: ${motivo}`)
    return motivo
  }
}
