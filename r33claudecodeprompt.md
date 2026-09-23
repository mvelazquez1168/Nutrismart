# r33-claudecode-prompt.md
# NutriSmart — Rebanada 33
# RPM-02: Integración con básculas inteligentes — Withings API

## Contexto de continuidad

SaaS multi-tenant de nutrición clínica. Monorepo: `apps/api` (Fastify),
`apps/web-professional` (Vite + React, puerto 5173), `apps/web-patient` (Vite + React, puerto 5175).

**Reglas permanentes (ver r32 para lista completa):**

1. Framework del servidor: **Fastify** (nunca Express).
2. Multi-tenancy paciente: `SELECT clinica_id FROM paciente WHERE keycloak_user_id = request.user.sub`.
3. Borrado suave únicamente. Nunca `DELETE` físico.
4. `registro_metrica.medido_en` (no `fecha`); columna `fuente` (añadida en r32).
5. `paciente.estado` — enum texto, NO booleano.
6. **`conexion_wearable`** ya existe desde r32; esta rebanada añade el proveedor `'withings'`.
7. **`wearableCrypto.ts`** ya existe desde r32 — importar, no recrear.

---

## Contexto de la integración

### Por qué Withings

Withings (antes Nokia Health) es el estándar de facto en básculas conectadas para uso clínico.
Su API soporta: Withings Body, Body+, Body Cardio, ScanWatch y docenas de básculas
de otras marcas que sincronizan a través de Google Fit o Fitbit (ya cubiertos en r32).

Datos que expone vía API (Measure API, mtype):

| mtype | Descripción               | Tipo en `registro_metrica` |
|-------|---------------------------|----------------------------|
| 1     | Peso (kg)                 | `peso`                     |
| 6     | % grasa corporal          | `grasa_pct`                |
| 8     | Masa grasa (kg)           | `masa_grasa_kg`            |
| 76    | Masa muscular (kg)        | `masa_muscular_kg`         |
| 77    | Masa ósea (kg)            | `masa_osea_kg`             |
| 88    | Masa muscular sin agua    | `masa_muscular_seca_kg`    |

Solo se insertan los mtypes que la báscula del usuario soporte; los demás llegan como
arrays vacíos y se omiten silenciosamente.

### Flujo de sincronización

Withings soporta **webhooks push**: cada vez que el usuario se pesa, Withings llama
a nuestro endpoint con la notificación. El backend la recibe, llama a la API de medidas
y guarda en `registro_metrica`. No hay polling.

```
Paciente se pesa
      ↓
Báscula → Withings Cloud
      ↓
POST /api/wearable/webhook/withings  (nuestro backend)
      ↓
Withings Measure API → datos
      ↓
registro_metrica (fuente='withings')
```

---

## Paso 0 — Leer antes de tocar nada

```bash
# 1. Verificar que r32 está aplicado
SELECT column_name FROM information_schema.columns
WHERE table_name = 'registro_metrica' AND column_name = 'fuente';

SELECT table_name FROM information_schema.tables
WHERE table_name = 'conexion_wearable';

# 2. Verificar que wearableCrypto.ts existe
ls apps/api/src/lib/wearableCrypto.ts

# 3. Verificar que el proveedor 'withings' no existe ya
SELECT proveedor FROM conexion_wearable WHERE proveedor = 'withings' LIMIT 1;

# 4. Última migración aplicada
SELECT migration_name FROM schema_migrations ORDER BY migration_name DESC LIMIT 1;

# 5. ¿Existe ya algún archivo de withings?
find apps/api/src -name "*withings*" 2>/dev/null

# 6. Ver cómo registra las rutas pacienteWearablesRoutes (r32)
# para seguir el mismo patrón de autenticación del paciente
grep -n "getPacienteId\|request.user.sub" apps/api/src/paciente/wearables.ts | head -10
```

Si r32 no está aplicado, detener y aplicarlo primero.

---

## Variables de entorno

Añadir a `apps/api/.env`:

```
# Withings Developer App (https://developer.withings.com/dashboard)
WITHINGS_CLIENT_ID=
WITHINGS_CLIENT_SECRET=

# Secret para verificar firma de webhooks Withings
# Generado en el portal de Withings al crear la suscripción
WITHINGS_WEBHOOK_SECRET=

# (Ya debe existir de r32)
WEARABLE_ENCRYPTION_KEY=
APP_PUBLIC_URL=https://192.168.X.X:5175
```

---

## Migración (solo si r32 no añadió los tipos de grasa/músculo)

```sql
-- No se necesita migración de tabla — conexion_wearable ya existe.
-- Solo verificar que los nuevos tipos de métrica no rompen ningún CHECK constraint.
-- Si hay un CHECK en registro_metrica.tipo con lista fija, ampliarla:

-- Verificar:
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'registro_metrica'::regclass AND contype = 'c';

-- Si existe un CHECK con lista fija de tipos, añadir los nuevos:
-- 'grasa_pct', 'masa_grasa_kg', 'masa_muscular_kg', 'masa_osea_kg', 'masa_muscular_seca_kg'
-- Adaptar según lo que se encuentre.
```

---

## Backend — apps/api

### apps/api/src/paciente/withings.ts

```typescript
import type { FastifyInstance } from 'fastify'
import { pool } from '../db'
import { cifrarToken, descifrarToken } from '../lib/wearableCrypto'
import { createHmac } from 'crypto'

const APP_URL          = process.env.APP_PUBLIC_URL ?? 'https://localhost:5175'
const WITHINGS_AUTH    = 'https://account.withings.com/oauth2_user/authorize2'
const WITHINGS_TOKEN   = 'https://wbsapi.withings.net/v2/oauth2'
const WITHINGS_MEASURE = 'https://wbsapi.withings.net/measure'
const CLIENT_ID        = process.env.WITHINGS_CLIENT_ID!
const CLIENT_SECRET    = process.env.WITHINGS_CLIENT_SECRET!
const WEBHOOK_SECRET   = process.env.WITHINGS_WEBHOOK_SECRET ?? ''
const CALLBACK_PATH    = '/api/paciente/wearable/callback/withings'

// Mapeo mtype Withings → tipo en registro_metrica
const MTYPE_MAP: Record<number, string> = {
  1:  'peso',
  6:  'grasa_pct',
  8:  'masa_grasa_kg',
  76: 'masa_muscular_kg',
  77: 'masa_osea_kg',
  88: 'masa_muscular_seca_kg',
}

// ── Helper pacienteId ────────────────────────────────────────────────────────

async function getPacienteId(sub: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM paciente WHERE keycloak_user_id = $1 AND estado = 'activo'`,
    [sub]
  )
  return rows[0]?.id ?? null
}

// ── Renovar token Withings ───────────────────────────────────────────────────

async function refrescarTokenWithings(conexionId: string): Promise<string> {
  const { rows } = await pool.query<{
    access_token: string; refresh_token: string | null; token_expira_en: Date | null
  }>(
    `SELECT access_token, refresh_token, token_expira_en
     FROM conexion_wearable WHERE id = $1`,
    [conexionId]
  )
  const cx = rows[0]
  if (!cx) throw new Error('Conexión no encontrada')

  const expira = cx.token_expira_en ? new Date(cx.token_expira_en).getTime() : null
  const margen = 5 * 60 * 1000

  if (expira && Date.now() + margen < expira) {
    return descifrarToken(cx.access_token)
  }

  if (!cx.refresh_token) throw new Error('Sin refresh_token para renovar')

  const body = new URLSearchParams({
    action:        'requesttoken',
    grant_type:    'refresh_token',
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: descifrarToken(cx.refresh_token),
  })

  const res  = await fetch(WITHINGS_TOKEN, { method: 'POST', body })
  const data = await res.json() as {
    status: number
    body?: { access_token: string; refresh_token: string; expires_in: number }
  }

  if (data.status !== 0 || !data.body?.access_token) {
    throw new Error(`Withings token refresh failed: status ${data.status}`)
  }

  const nuevaExpira = new Date(Date.now() + data.body.expires_in * 1000)
  await pool.query(
    `UPDATE conexion_wearable
     SET access_token = $1, refresh_token = $2, token_expira_en = $3
     WHERE id = $4`,
    [
      cifrarToken(data.body.access_token),
      cifrarToken(data.body.refresh_token),
      nuevaExpira,
      conexionId,
    ]
  )
  return data.body.access_token
}

// ── Sincronización: llamar a Measure API ────────────────────────────────────

async function sincronizarWithings(pacienteId: string): Promise<number> {
  const { rows } = await pool.query<{ id: string; ultimo_sync: Date | null }>(
    `SELECT id, ultimo_sync FROM conexion_wearable
     WHERE paciente_id = $1 AND proveedor = 'withings' AND activo = true`,
    [pacienteId]
  )
  if (!rows.length) return 0

  const cx    = rows[0]
  const token = await refrescarTokenWithings(cx.id)

  const desdeTs = cx.ultimo_sync
    ? Math.floor(cx.ultimo_sync.getTime() / 1000) - 60  // 1 min de margen
    : Math.floor((Date.now() - 30 * 86400_000) / 1000)  // primera sync: 30 días

  const params = new URLSearchParams({
    action:     'getmeas',
    meastypes:  Object.keys(MTYPE_MAP).join(','),
    category:   '1',              // 1 = mediciones reales (no objetivos)
    startdate:  desdeTs.toString(),
    enddate:    Math.floor(Date.now() / 1000).toString(),
  })

  const res = await fetch(`${WITHINGS_MEASURE}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json() as {
    status: number
    body?: {
      measuregrps: {
        date:     number
        measures: { type: number; value: number; unit: number }[]
      }[]
    }
  }

  if (data.status !== 0) {
    throw new Error(`Withings Measure API error: ${data.status}`)
  }

  let insertados = 0
  for (const grp of data.body?.measuregrps ?? []) {
    const medido_en = new Date(grp.date * 1000)
    for (const m of grp.measures) {
      const tipo = MTYPE_MAP[m.type]
      if (!tipo) continue
      // Withings devuelve valor * 10^unit (p.ej. value=7050, unit=-2 → 70.50 kg)
      const valor = m.value * Math.pow(10, m.unit)
      const valorRedondeado = Math.round(valor * 100) / 100

      const { rowCount } = await pool.query(
        `INSERT INTO registro_metrica (paciente_id, tipo, valor, medido_en, fuente)
         VALUES ($1, $2, $3, $4, 'withings')
         ON CONFLICT (paciente_id, tipo, medido_en, fuente) DO NOTHING`,
        [pacienteId, tipo, valorRedondeado, medido_en]
      )
      insertados += rowCount ?? 0
    }
  }

  await pool.query(
    `UPDATE conexion_wearable SET ultimo_sync = now() WHERE id = $1`,
    [cx.id]
  )
  return insertados
}

// ── Rutas ────────────────────────────────────────────────────────────────────

export async function withingsRoutes(fastify: FastifyInstance) {

  // GET /api/paciente/wearable/connect/withings
  // Inicia flujo OAuth → redirige a Withings
  fastify.get('/api/paciente/wearable/connect/withings', async (request, reply) => {
    const pacienteId = await getPacienteId(request.user.sub)
    if (!pacienteId) return reply.code(404).send({ error: 'Paciente no encontrado' })

    const state      = Buffer.from(pacienteId).toString('base64url')
    const redirectUri = `${APP_URL}${CALLBACK_PATH}`

    const params = new URLSearchParams({
      response_type: 'code',
      client_id:     CLIENT_ID,
      redirect_uri:  redirectUri,
      scope:         'user.metrics',
      state,
    })

    return reply.redirect(`${WITHINGS_AUTH}?${params}`)
  })

  // GET /api/paciente/wearable/callback/withings
  // Recibe código OAuth, intercambia por tokens
  fastify.get('/api/paciente/wearable/callback/withings', async (request, reply) => {
    const { code, state, error } = request.query as {
      code?: string; state?: string; error?: string
    }

    if (error || !code || !state) {
      return reply.redirect(`${APP_URL}/paciente/dispositivos?error=auth_cancelada`)
    }

    const pacienteId  = Buffer.from(state, 'base64url').toString()
    const redirectUri = `${APP_URL}${CALLBACK_PATH}`

    const body = new URLSearchParams({
      action:        'requesttoken',
      grant_type:    'authorization_code',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri:  redirectUri,
    })

    const res  = await fetch(WITHINGS_TOKEN, { method: 'POST', body })
    const data = await res.json() as {
      status: number
      body?: {
        access_token: string; refresh_token: string
        expires_in: number; scope: string; userid: string
      }
    }

    if (data.status !== 0 || !data.body?.access_token) {
      fastify.log.error({ data }, 'Withings token exchange failed')
      return reply.redirect(`${APP_URL}/paciente/dispositivos?error=token_fallido`)
    }

    const expira = new Date(Date.now() + data.body.expires_in * 1000)

    await pool.query(
      `INSERT INTO conexion_wearable
         (paciente_id, proveedor, access_token, refresh_token, token_expira_en, scope, activo)
       VALUES ($1, 'withings', $2, $3, $4, $5, true)
       ON CONFLICT (paciente_id, proveedor) DO UPDATE SET
         access_token    = EXCLUDED.access_token,
         refresh_token   = EXCLUDED.refresh_token,
         token_expira_en = EXCLUDED.token_expira_en,
         scope           = EXCLUDED.scope,
         activo          = true`,
      [
        pacienteId,
        cifrarToken(data.body.access_token),
        cifrarToken(data.body.refresh_token),
        expira,
        data.body.scope,
      ]
    )

    // Registrar suscripción webhook en Withings
    // (Withings la acepta pero solo llama al webhook si está en HTTPS público)
    setImmediate(() => registrarWebhookWithings(data.body!.access_token, pacienteId)
      .catch(e => fastify.log.warn(e, 'Withings webhook subscription failed'))
    )

    // Sync inmediata con el token recién obtenido
    setImmediate(() => sincronizarWithings(pacienteId)
      .catch(e => fastify.log.error(e, 'Withings sync inicial falló'))
    )

    return reply.redirect(`${APP_URL}/paciente/dispositivos?conectado=withings`)
  })

  // POST /api/wearable/webhook/withings
  // Endpoint que Withings llama cuando el usuario registra una medición
  // ⚠ NO lleva autenticación de paciente — Withings llama desde sus servidores
  fastify.post(
    '/api/wearable/webhook/withings',
    { config: { rawBody: true } },   // necesita el body crudo para verificar la firma
    async (request, reply) => {
      // Verificar firma HMAC-SHA256 (Withings firma con WITHINGS_WEBHOOK_SECRET)
      const signature = (request.headers['x-wbs-signature'] as string) ?? ''
      const rawBody   = (request as any).rawBody as Buffer | undefined
      if (WEBHOOK_SECRET && rawBody) {
        const expected = createHmac('sha256', WEBHOOK_SECRET)
          .update(rawBody)
          .digest('hex')
        if (signature !== expected) {
          fastify.log.warn('Withings webhook: firma inválida')
          return reply.code(403).send()
        }
      }

      const body = request.body as { userid?: string; appli?: number }
      // appli = 1 → medición disponible
      if (body.appli !== 1 || !body.userid) {
        return reply.code(200).send()  // Withings espera 200 aunque no procesemos
      }

      // Buscar paciente por withings_userid almacenado como metadata
      // (guardamos el userid en la columna scope temporalmente — ver nota abajo)
      const { rows } = await pool.query<{ paciente_id: string }>(
        `SELECT paciente_id FROM conexion_wearable
         WHERE proveedor = 'withings' AND activo = true
           AND scope LIKE $1`,
        [`%${body.userid}%`]
      )

      if (!rows.length) {
        // Puede ocurrir si el paciente desconectó entre el evento y el webhook
        return reply.code(200).send()
      }

      // Sincronizar en background — el webhook debe responder rápido
      setImmediate(() =>
        sincronizarWithings(rows[0].paciente_id)
          .catch(e => fastify.log.error(e, 'Withings webhook sync falló'))
      )

      return reply.code(200).send()
    }
  )

  // POST /api/paciente/wearable/sync/withings — sincronización manual
  fastify.post('/api/paciente/wearable/sync/withings', async (request, reply) => {
    const pacienteId = await getPacienteId(request.user.sub)
    if (!pacienteId) return reply.code(404).send({ error: 'Paciente no encontrado' })
    const insertados = await sincronizarWithings(pacienteId)
    return { insertados }
  })

  // DELETE /api/paciente/wearable/withings — desconectar
  // (Reutiliza la ruta genérica de r32 — solo registrar si no existe)
}

// ── Registro webhook en Withings ─────────────────────────────────────────────

async function registrarWebhookWithings(
  accessToken: string,
  pacienteId:  string
): Promise<void> {
  const callbackUrl = `${APP_URL}/api/wearable/webhook/withings`
  const body = new URLSearchParams({
    action:     'subscribe',
    callbackurl: callbackUrl,
    appli:      '1',   // 1 = mediciones
    comment:    `nutrismart-${pacienteId.slice(0, 8)}`,
  })
  const res  = await fetch('https://wbsapi.withings.net/notify', {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body,
  })
  const data = await res.json() as { status: number }
  if (data.status !== 0) {
    // No fatal — la sincronización manual sigue funcionando
    console.warn(`Withings webhook subscription: status ${data.status} (ignorado en dev)`)
  }
}
```

### Nota sobre el almacenamiento del userid Withings

El webhook de Withings incluye `userid` pero no `paciente_id`. Para relacionarlos,
guardamos el `userid` de Withings en la columna `scope` junto al scope real,
separados por `|`:

```typescript
// En el INSERT del callback, reemplazar la línea del scope:
data.body.scope + '|wuserid=' + data.body.userid
```

Y la búsqueda en el webhook usa `LIKE '%wuserid=12345%'`.

Alternativa más limpia (añadir en migración si se prefiere):

```sql
ALTER TABLE conexion_wearable
  ADD COLUMN IF NOT EXISTS external_user_id TEXT;
```

Y buscar por `external_user_id = body.userid`. **Preferir esta opción** si el equipo
quiere el esquema limpio — adaptar el INSERT y la búsqueda del webhook.

### Registro en apps/api/src/server.ts

```typescript
import { withingsRoutes } from './paciente/withings'
await fastify.register(withingsRoutes)
```

### Raw body en Fastify (para verificar la firma del webhook)

Fastify no expone el body crudo por defecto. Añadir en la configuración del servidor:

```typescript
// En la creación del servidor Fastify o en el plugin de contentType
fastify.addContentTypeParser(
  'application/x-www-form-urlencoded',
  { parseAs: 'buffer' },
  (req, body, done) => {
    ;(req as any).rawBody = body
    const parsed = Object.fromEntries(new URLSearchParams(body.toString()))
    done(null, parsed)
  }
)
```

---

## Frontend — DispositivosPage (ampliar r32)

En el archivo `DispositivosPage.tsx` creado en r32, añadir Withings al array `PROVEEDORES`:

```tsx
const PROVEEDORES = [
  {
    id:          'fitbit',
    nombre:      'Fitbit',
    descripcion: 'Pasos, frecuencia cardíaca y sueño. Sincroniza con Apple Health en iPhone.',
  },
  {
    id:          'google_fit',
    nombre:      'Google Fit',
    descripcion: 'Pasos y frecuencia cardíaca desde Android.',
  },
  {
    id:          'withings',
    nombre:      'Withings / Nokia Health',
    descripcion: 'Peso, % grasa, masa muscular y masa ósea desde tu báscula inteligente Withings. Compatible con Body, Body+, Body Cardio y ScanWatch.',
  },
]
```

No hay cambios en la lógica de la página — el flujo OAuth y la sincronización
funcionan igual para los tres proveedores.

---

## Nota sobre webhooks en desarrollo

Withings solo puede llamar a URLs HTTPS públicas. Durante el desarrollo local:

- La suscripción al webhook **fallará en silencio** (ya está manejado con `console.warn`).
- Esto no impide el desarrollo: la sincronización manual funciona igual.
- Para probar webhooks en local: usar `ngrok http 5175` y registrar
  `https://<ngrok-url>/api/wearable/webhook/withings` temporalmente.
- En producción (AWS), el webhook funcionará automáticamente.

---

## Lista de verificación

```
[ ] WITHINGS_CLIENT_ID / WITHINGS_CLIENT_SECRET configurados
[ ] WITHINGS_WEBHOOK_SECRET configurado (puede estar vacío en desarrollo)
[ ] Callbacks registrados en https://developer.withings.com/dashboard
[ ] Flujo OAuth: clic "Conectar Withings" → redirige → callback → conexión activa
[ ] Sync manual: registro_metrica tiene filas con fuente='withings' y tipos correctos
[ ]   - peso en kg (no gramos — verificar conversión unit)
[ ]   - grasa_pct como porcentaje (p.ej. 22.5, no 2250)
[ ] Sin duplicados al sincronizar dos veces
[ ] DispositivosPage: Withings aparece como tercer proveedor con badge y botón
[ ] Webhook: POST /api/wearable/webhook/withings devuelve 200 (aunque no procese en dev)
[ ] Firma inválida en webhook → 403 (probar con body alterado)
[ ] Token expirado → se renueva antes de llamar a Measure API
[ ] Desconectar: activo = false, datos en registro_metrica se conservan
[ ] Los nuevos tipos (grasa_pct, masa_muscular_kg, etc.) no violan ningún CHECK constraint
```
