# r32-claudecode-prompt.md
# NutriSmart — Rebanada 32
# RPM-01: Integración con wearables — Fitbit Web API + Google Fit REST API

## Contexto de continuidad

SaaS multi-tenant de nutrición clínica. Monorepo: `apps/api` (Fastify),
`apps/web-professional` (Vite + React, puerto 5173), `apps/web-patient` (Vite + React, puerto 5175).

**Reglas permanentes:**

1. Framework del servidor: **Fastify** (nunca Express).
2. Multi-tenancy: paciente identifica su clínica por `SELECT clinica_id FROM paciente WHERE keycloak_user_id = request.user.sub`.
3. Borrado suave únicamente. Nunca `DELETE` físico.
4. Gráficas: **SVG puro**. Cero librerías de charting externas.
5. Colores: **CSS vars / tokens Tailwind**. Nunca hex en línea en JSX.
6. `TIMESTAMPTZ` → JSON: valor crudo del driver `pg`. Nunca `to_char(…OF)`.
7. `registro_metrica.medido_en` (no `fecha`).
8. `paciente.estado` y `profesional.estado` — enum texto, NO booleano.
9. `cita.inicio` TIMESTAMPTZ único; `cita.duracion_minutos`.
10. `paciente.nutricionista_id` (no `profesional_id`).

---

## Contexto de la integración

### Por qué Fitbit y Google Fit (y no HealthKit / Health Connect)

Apple HealthKit y Google Health Connect son SDKs nativos — no tienen API REST accesible
desde un backend web. Lo que sí tienen API REST pública con OAuth2 es:

- **Fitbit Web API**: la más documentada y popular en LATAM. En iOS, la app de Fitbit
  sincroniza automáticamente con Apple Health — el usuario de iPhone que usa Fitbit
  obtiene datos de Apple Watch en NutriSmart sin ningún paso extra.
- **Google Fit REST API**: accesible desde backend con OAuth2, datos de Android.

La pantalla de la app mostrará una nota explicando que usuarios de Apple Watch
deben conectar Fitbit (que sincroniza con Apple Health automáticamente).

### Métricas que se sincronizan

| Fuente      | Tipo en `registro_metrica` | Descripción              |
|-------------|----------------------------|--------------------------|
| Fitbit/GFit | `pasos`                    | Pasos diarios            |
| Fitbit/GFit | `frecuencia_cardiaca`      | FC media diaria (bpm)    |
| Fitbit      | `sueño_horas`              | Horas de sueño total     |

---

## Paso 0 — Leer antes de tocar nada

```bash
# 1. ¿Tiene registro_metrica columna fuente?
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'registro_metrica'
ORDER BY ordinal_position;

# 2. ¿Existe ya conexion_wearable?
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('conexion_wearable', 'wearable_conexion', 'dispositivo_paciente');

# 3. Última migración aplicada
SELECT migration_name FROM schema_migrations ORDER BY migration_name DESC LIMIT 1;

# 4. ¿Existe ya algún archivo de wearables?
find apps/api/src -name "*wearable*" -o -name "*fitbit*" -o -name "*googlefit*" 2>/dev/null

# 5. ¿Tiene el token de paciente el claim sub?
# (Solo verificar cómo se accede al user id en las rutas de paciente existentes)
grep -rn "request.user.sub\|pacienteId\|keycloak_user_id" apps/api/src/paciente/ | head -10
```

---

## Migración

```sql
-- Añadir fuente a registro_metrica si no existe
ALTER TABLE registro_metrica
  ADD COLUMN IF NOT EXISTS fuente TEXT NOT NULL DEFAULT 'manual';

-- Índice para consultas por fuente
CREATE INDEX IF NOT EXISTS idx_registro_metrica_fuente
  ON registro_metrica (paciente_id, fuente, medido_en DESC);

-- Tabla de conexiones a proveedores externos
CREATE TABLE IF NOT EXISTS conexion_wearable (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id     UUID        NOT NULL REFERENCES paciente(id),
  proveedor       TEXT        NOT NULL,           -- 'fitbit' | 'google_fit' | 'withings'
  access_token    TEXT        NOT NULL,           -- cifrado AES-256-GCM (ver lib/crypto.ts)
  refresh_token   TEXT,                           -- cifrado AES-256-GCM
  token_expira_en TIMESTAMPTZ,
  scope           TEXT,
  ultimo_sync     TIMESTAMPTZ,
  activo          BOOLEAN     NOT NULL DEFAULT true,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (paciente_id, proveedor)                -- un paciente, una cuenta por proveedor
);

-- Función para actualizar actualizado_en automáticamente
CREATE OR REPLACE FUNCTION set_actualizado_en()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.actualizado_en = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_conexion_wearable_updated
  BEFORE UPDATE ON conexion_wearable
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
```

---

## Variables de entorno

Añadir a `apps/api/.env` (los valores se obtienen de los portales de desarrollador
de Fitbit y Google Cloud — no incluir los valores reales en el código):

```
# Fitbit Developer App (https://dev.fitbit.com/apps)
FITBIT_CLIENT_ID=
FITBIT_CLIENT_SECRET=

# Google Cloud OAuth 2.0 (https://console.cloud.google.com)
# API habilitada: Fitness API
GOOGLE_FIT_CLIENT_ID=
GOOGLE_FIT_CLIENT_SECRET=

# Clave de cifrado para tokens OAuth (32 bytes hex aleatorio)
# Generar con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
WEARABLE_ENCRYPTION_KEY=

# URL pública de la API (para OAuth callback y webhooks)
# Desarrollo: https://192.168.X.X:5175  (proxy Vite)
# Producción: https://api.nutrismart.app (o el dominio real)
APP_PUBLIC_URL=https://192.168.X.X:5175
```

---

## Backend — apps/api

### apps/api/src/lib/wearableCrypto.ts

Cifrado/descifrado de tokens OAuth con AES-256-GCM.
No usa pgcrypto — cifrado en aplicación para evitar dependencia de extensión PG.

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'
const KEY  = Buffer.from(process.env.WEARABLE_ENCRYPTION_KEY ?? '', 'hex')

if (KEY.length !== 32) {
  throw new Error('WEARABLE_ENCRYPTION_KEY debe ser 32 bytes hex (64 chars)')
}

/** Cifra un token. Devuelve string base64 que incluye iv + authTag + ciphertext. */
export function cifrarToken(plain: string): string {
  const iv         = randomBytes(12)                   // 96 bits para GCM
  const cipher     = createCipheriv(ALGO, KEY, iv)
  const encrypted  = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag        = cipher.getAuthTag()
  // Formato: iv(12) + tag(16) + ciphertext — todo base64
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

/** Descifra un token cifrado con cifrarToken. */
export function descifrarToken(encoded: string): string {
  const buf       = Buffer.from(encoded, 'base64')
  const iv        = buf.subarray(0,  12)
  const tag       = buf.subarray(12, 28)
  const encrypted = buf.subarray(28)
  const decipher  = createDecipheriv(ALGO, KEY, iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8')
}
```

### apps/api/src/paciente/wearables.ts

```typescript
import type { FastifyInstance } from 'fastify'
import { pool } from '../db'
import { cifrarToken, descifrarToken } from '../lib/wearableCrypto'

// ── Constantes OAuth ────────────────────────────────────────────────────────

const FITBIT = {
  authUrl:    'https://www.fitbit.com/oauth2/authorize',
  tokenUrl:   'https://api.fitbit.com/oauth2/token',
  clientId:   process.env.FITBIT_CLIENT_ID!,
  secret:     process.env.FITBIT_CLIENT_SECRET!,
  scope:      'activity heartrate sleep',
  callbackPath: '/api/paciente/wearable/callback/fitbit',
}

const GOOGLE_FIT = {
  authUrl:    'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl:   'https://oauth2.googleapis.com/token',
  clientId:   process.env.GOOGLE_FIT_CLIENT_ID!,
  secret:     process.env.GOOGLE_FIT_CLIENT_SECRET!,
  scope:      [
    'https://www.googleapis.com/auth/fitness.activity.read',
    'https://www.googleapis.com/auth/fitness.heart_rate.read',
  ].join(' '),
  callbackPath: '/api/paciente/wearable/callback/google_fit',
}

const APP_URL = process.env.APP_PUBLIC_URL ?? 'https://localhost:5175'

// ── Helper: obtener paciente_id desde token ─────────────────────────────────

async function getPacienteId(sub: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM paciente WHERE keycloak_user_id = $1 AND estado = 'activo'`,
    [sub]
  )
  return rows[0]?.id ?? null
}

// ── Helper: renovar access_token si está próximo a expirar ─────────────────

async function refrescarTokenSiNecesario(conexionId: string): Promise<string> {
  const { rows } = await pool.query<{
    access_token: string
    refresh_token: string | null
    token_expira_en: Date | null
    proveedor: string
  }>(
    `SELECT access_token, refresh_token, token_expira_en, proveedor
     FROM conexion_wearable WHERE id = $1`,
    [conexionId]
  )
  const cx = rows[0]
  if (!cx) throw new Error('Conexión no encontrada')

  const expira = cx.token_expira_en ? new Date(cx.token_expira_en).getTime() : null
  const margen = 5 * 60 * 1000  // 5 minutos antes de expirar

  if (expira && Date.now() + margen < expira) {
    return descifrarToken(cx.access_token)   // todavía válido
  }

  // Renovar
  if (!cx.refresh_token) throw new Error('No hay refresh_token para renovar')
  const cfg = cx.proveedor === 'fitbit' ? FITBIT : GOOGLE_FIT
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: descifrarToken(cx.refresh_token),
    client_id:     cfg.clientId,
  })
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
  if (cx.proveedor === 'fitbit') {
    // Fitbit requiere Basic Auth
    headers['Authorization'] = 'Basic ' +
      Buffer.from(`${cfg.clientId}:${cfg.secret}`).toString('base64')
  } else {
    body.append('client_secret', cfg.secret)
  }

  const res  = await fetch(cfg.tokenUrl, { method: 'POST', headers, body })
  const data = await res.json() as {
    access_token: string; refresh_token?: string; expires_in?: number
  }
  if (!data.access_token) throw new Error('Renovación de token fallida')

  const nuevaExpira = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000)
    : null

  await pool.query(
    `UPDATE conexion_wearable
     SET access_token = $1, refresh_token = $2, token_expira_en = $3
     WHERE id = $4`,
    [
      cifrarToken(data.access_token),
      data.refresh_token ? cifrarToken(data.refresh_token) : cx.refresh_token,
      nuevaExpira,
      conexionId,
    ]
  )
  return data.access_token
}

// ── Rutas ───────────────────────────────────────────────────────────────────

export async function pacienteWearablesRoutes(fastify: FastifyInstance) {

  // GET /api/paciente/wearable/estado
  // Lista las conexiones activas del paciente
  fastify.get('/api/paciente/wearable/estado', async (request, reply) => {
    const pacienteId = await getPacienteId(request.user.sub)
    if (!pacienteId) return reply.code(404).send({ error: 'Paciente no encontrado' })

    const { rows } = await pool.query<{
      proveedor: string; ultimo_sync: Date | null; activo: boolean
    }>(
      `SELECT proveedor, ultimo_sync, activo
       FROM conexion_wearable
       WHERE paciente_id = $1
       ORDER BY proveedor`,
      [pacienteId]
    )
    return rows
  })

  // GET /api/paciente/wearable/connect/:proveedor
  // Inicia el flujo OAuth → redirige al proveedor
  fastify.get('/api/paciente/wearable/connect/:proveedor', async (request, reply) => {
    const { proveedor } = request.params as { proveedor: string }
    const pacienteId = await getPacienteId(request.user.sub)
    if (!pacienteId) return reply.code(404).send({ error: 'Paciente no encontrado' })

    const cfg = proveedor === 'fitbit' ? FITBIT
              : proveedor === 'google_fit' ? GOOGLE_FIT
              : null
    if (!cfg) return reply.code(400).send({ error: 'Proveedor no soportado' })

    const redirectUri = `${APP_URL}${cfg.callbackPath}`
    // state = pacienteId codificado en base64 (sin datos sensibles)
    const state = Buffer.from(pacienteId).toString('base64url')

    const params = new URLSearchParams({
      client_id:     cfg.clientId,
      response_type: 'code',
      scope:         cfg.scope,
      redirect_uri:  redirectUri,
      state,
      ...(proveedor === 'google_fit' && { access_type: 'offline', prompt: 'consent' }),
    })

    return reply.redirect(`${cfg.authUrl}?${params}`)
  })

  // GET /api/paciente/wearable/callback/:proveedor
  // Recibe el código OAuth, intercambia por tokens, guarda
  fastify.get('/api/paciente/wearable/callback/:proveedor', async (request, reply) => {
    const { proveedor } = request.params as { proveedor: string }
    const { code, state, error } = request.query as {
      code?: string; state?: string; error?: string
    }

    if (error || !code || !state) {
      return reply.redirect(`${APP_URL}/paciente/dispositivos?error=auth_cancelada`)
    }

    const pacienteId = Buffer.from(state, 'base64url').toString()
    const cfg = proveedor === 'fitbit' ? FITBIT
              : proveedor === 'google_fit' ? GOOGLE_FIT
              : null
    if (!cfg) return reply.code(400).send({ error: 'Proveedor no soportado' })

    const redirectUri = `${APP_URL}${cfg.callbackPath}`
    const body = new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id:    cfg.clientId,
    })
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    }
    if (proveedor === 'fitbit') {
      headers['Authorization'] = 'Basic ' +
        Buffer.from(`${cfg.clientId}:${cfg.secret}`).toString('base64')
    } else {
      body.append('client_secret', cfg.secret)
    }

    const res  = await fetch(cfg.tokenUrl, { method: 'POST', headers, body })
    const data = await res.json() as {
      access_token: string; refresh_token?: string
      expires_in?: number; scope?: string
    }
    if (!data.access_token) {
      fastify.log.error({ proveedor, data }, 'OAuth token exchange failed')
      return reply.redirect(`${APP_URL}/paciente/dispositivos?error=token_fallido`)
    }

    const expira = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null

    await pool.query(
      `INSERT INTO conexion_wearable
         (paciente_id, proveedor, access_token, refresh_token, token_expira_en, scope, activo)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (paciente_id, proveedor) DO UPDATE SET
         access_token    = EXCLUDED.access_token,
         refresh_token   = EXCLUDED.refresh_token,
         token_expira_en = EXCLUDED.token_expira_en,
         scope           = EXCLUDED.scope,
         activo          = true`,
      [
        pacienteId,
        proveedor,
        cifrarToken(data.access_token),
        data.refresh_token ? cifrarToken(data.refresh_token) : null,
        expira,
        data.scope ?? cfg.scope,
      ]
    )

    // Sincronización inmediata en background (no bloquear el redirect)
    setImmediate(() => sincronizarWearable(pacienteId, proveedor).catch(
      e => fastify.log.error(e, `Sync inicial ${proveedor} falló`)
    ))

    return reply.redirect(`${APP_URL}/paciente/dispositivos?conectado=${proveedor}`)
  })

  // POST /api/paciente/wearable/sync/:proveedor
  // Sincronización manual (el paciente presiona "Sincronizar ahora")
  fastify.post('/api/paciente/wearable/sync/:proveedor', async (request, reply) => {
    const { proveedor } = request.params as { proveedor: string }
    const pacienteId = await getPacienteId(request.user.sub)
    if (!pacienteId) return reply.code(404).send({ error: 'Paciente no encontrado' })

    const insertados = await sincronizarWearable(pacienteId, proveedor)
    return { insertados }
  })

  // DELETE /api/paciente/wearable/:proveedor
  // Desconectar (soft-delete)
  fastify.delete('/api/paciente/wearable/:proveedor', async (request, reply) => {
    const { proveedor } = request.params as { proveedor: string }
    const pacienteId = await getPacienteId(request.user.sub)
    if (!pacienteId) return reply.code(404).send({ error: 'Paciente no encontrado' })

    await pool.query(
      `UPDATE conexion_wearable SET activo = false
       WHERE paciente_id = $1 AND proveedor = $2`,
      [pacienteId, proveedor]
    )
    return reply.code(204).send()
  })
}

// ── Motor de sincronización ─────────────────────────────────────────────────

async function sincronizarWearable(
  pacienteId: string,
  proveedor:  string
): Promise<number> {
  const { rows } = await pool.query<{ id: string; ultimo_sync: Date | null }>(
    `SELECT id, ultimo_sync FROM conexion_wearable
     WHERE paciente_id = $1 AND proveedor = $2 AND activo = true`,
    [pacienteId, proveedor]
  )
  if (!rows.length) return 0

  const cx      = rows[0]
  const token   = await refrescarTokenSiNecesario(cx.id)

  // Rango: desde último sync (máx 30 días) hasta hoy
  const hasta   = new Date()
  const desde   = cx.ultimo_sync
    ? new Date(Math.max(cx.ultimo_sync.getTime(), hasta.getTime() - 30 * 86400_000))
    : new Date(hasta.getTime() - 7 * 86400_000)  // primera sync: 7 días

  const metricas = proveedor === 'fitbit'
    ? await fetchFitbit(token, desde, hasta)
    : await fetchGoogleFit(token, desde, hasta)

  if (!metricas.length) {
    await pool.query(
      `UPDATE conexion_wearable SET ultimo_sync = now() WHERE id = $1`,
      [cx.id]
    )
    return 0
  }

  // INSERT ignorando duplicados por (paciente_id, tipo, medido_en, fuente)
  // La restricción UNIQUE debe existir; si no, el ON CONFLICT es solo ON CONFLICT DO NOTHING
  let insertados = 0
  for (const m of metricas) {
    const { rowCount } = await pool.query(
      `INSERT INTO registro_metrica (paciente_id, tipo, valor, medido_en, fuente)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (paciente_id, tipo, medido_en, fuente) DO NOTHING`,
      [pacienteId, m.tipo, m.valor, m.medido_en, proveedor]
    )
    insertados += rowCount ?? 0
  }

  await pool.query(
    `UPDATE conexion_wearable SET ultimo_sync = now() WHERE id = $1`,
    [cx.id]
  )
  return insertados
}

// ── Fetch Fitbit ────────────────────────────────────────────────────────────

interface MetricaRaw { tipo: string; valor: number; medido_en: Date }

async function fetchFitbit(
  token: string,
  desde: Date,
  hasta: Date
): Promise<MetricaRaw[]> {
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10)
  const headers = { Authorization: `Bearer ${token}` }
  const result: MetricaRaw[] = []

  // Pasos — serie de 30 días máximo
  const stepsRes = await fetch(
    `https://api.fitbit.com/1/user/-/activities/steps/date/${fmtDate(desde)}/${fmtDate(hasta)}.json`,
    { headers }
  )
  if (stepsRes.ok) {
    const data = await stepsRes.json() as {
      'activities-steps': { dateTime: string; value: string }[]
    }
    for (const d of data['activities-steps'] ?? []) {
      const v = parseInt(d.value, 10)
      if (v > 0) result.push({ tipo: 'pasos', valor: v, medido_en: new Date(d.dateTime) })
    }
  }

  // Frecuencia cardíaca media diaria
  const hrRes = await fetch(
    `https://api.fitbit.com/1/user/-/activities/heart/date/${fmtDate(desde)}/${fmtDate(hasta)}.json`,
    { headers }
  )
  if (hrRes.ok) {
    const data = await hrRes.json() as {
      'activities-heart': { dateTime: string; value: { restingHeartRate?: number } }[]
    }
    for (const d of data['activities-heart'] ?? []) {
      const rhr = d.value?.restingHeartRate
      if (rhr) result.push({ tipo: 'frecuencia_cardiaca', valor: rhr, medido_en: new Date(d.dateTime) })
    }
  }

  // Sueño — total horas
  const sleepRes = await fetch(
    `https://api.fitbit.com/1.2/user/-/sleep/date/${fmtDate(desde)}/${fmtDate(hasta)}.json`,
    { headers }
  )
  if (sleepRes.ok) {
    const data = await sleepRes.json() as {
      sleep: { dateOfSleep: string; duration: number }[]
    }
    for (const s of data.sleep ?? []) {
      const horas = s.duration / 3_600_000   // ms → horas
      result.push({ tipo: 'sueño_horas', valor: Math.round(horas * 10) / 10, medido_en: new Date(s.dateOfSleep) })
    }
  }

  return result
}

// ── Fetch Google Fit ────────────────────────────────────────────────────────

async function fetchGoogleFit(
  token: string,
  desde: Date,
  hasta: Date
): Promise<MetricaRaw[]> {
  const result: MetricaRaw[] = []

  // Google Fit usa nanosegundos epoch para el tiempo
  const startTimeNs = (desde.getTime() * 1_000_000).toString()
  const endTimeNs   = (hasta.getTime()  * 1_000_000).toString()

  const body = {
    aggregateBy: [
      { dataTypeName: 'com.google.step_count.delta' },
      { dataTypeName: 'com.google.heart_rate.bpm'  },
    ],
    bucketByTime: { durationMillis: 86_400_000 },  // un bucket por día
    startTimeMillis: desde.getTime().toString(),
    endTimeMillis:   hasta.getTime().toString(),
  }

  const res = await fetch(
    'https://fitness.googleapis.com/v1/users/me/dataset:aggregate',
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  )
  if (!res.ok) return result

  const data = await res.json() as {
    bucket: {
      startTimeMillis: string
      dataset: {
        dataSourceId: string
        point: { value: { intVal?: number; fpVal?: number }[] }[]
      }[]
    }[]
  }

  for (const bucket of data.bucket ?? []) {
    const dia = new Date(parseInt(bucket.startTimeMillis, 10))
    for (const ds of bucket.dataset ?? []) {
      for (const point of ds.point ?? []) {
        if (ds.dataSourceId.includes('step_count')) {
          const v = point.value[0]?.intVal ?? 0
          if (v > 0) result.push({ tipo: 'pasos', valor: v, medido_en: dia })
        }
        if (ds.dataSourceId.includes('heart_rate')) {
          const v = point.value[0]?.fpVal
          if (v) result.push({ tipo: 'frecuencia_cardiaca', valor: Math.round(v), medido_en: dia })
        }
      }
    }
  }

  return result
}
```

### Restricción UNIQUE en registro_metrica

La deduplicación de la sincronización requiere que exista una restricción única.
Verificar si ya existe; si no, añadir en la migración:

```sql
-- Solo si no existe ya
ALTER TABLE registro_metrica
  ADD CONSTRAINT uq_registro_metrica_dedup
  UNIQUE (paciente_id, tipo, medido_en, fuente);
```

Si ya hay datos que violarían esta restricción, usar:

```sql
-- Alternativa: índice único parcial (más flexible)
CREATE UNIQUE INDEX IF NOT EXISTS idx_rm_dedup
  ON registro_metrica (paciente_id, tipo, medido_en, fuente);
```

### Registro en apps/api/src/server.ts

```typescript
import { pacienteWearablesRoutes } from './paciente/wearables'
await fastify.register(pacienteWearablesRoutes)
```

---

## Frontend — apps/web-patient

### apps/web-patient/src/pages/DispositivosPage.tsx

```tsx
import { useEffect, useState } from 'react'
import { Smartphone, Zap, AlertCircle, CheckCircle2, Unlink } from 'lucide-react'
import { apiFetch } from '../lib/api'

interface Conexion {
  proveedor:   string
  ultimo_sync: string | null
  activo:      boolean
}

const PROVEEDORES = [
  {
    id:          'fitbit',
    nombre:      'Fitbit',
    descripcion: 'Pasos, frecuencia cardíaca y sueño. Sincroniza automáticamente con Apple Health en iPhone.',
  },
  {
    id:          'google_fit',
    nombre:      'Google Fit',
    descripcion: 'Pasos y frecuencia cardíaca desde Android.',
  },
]

export default function DispositivosPage() {
  const [conexiones, setConexiones] = useState<Conexion[]>([])
  const [sincronizando, setSincronizando] = useState<string | null>(null)

  // Leer parámetros de URL (respuesta de OAuth callback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const conectado = params.get('conectado')
    const error     = params.get('error')
    if (conectado || error) {
      window.history.replaceState({}, '', window.location.pathname)
    }
    cargar()
  }, [])

  async function cargar() {
    const res = await apiFetch('/api/paciente/wearable/estado')
    if (res.ok) setConexiones(await res.json())
  }

  function conexionDe(id: string): Conexion | undefined {
    return conexiones.find(c => c.proveedor === id && c.activo)
  }

  async function conectar(id: string) {
    // Redirige al flujo OAuth — el backend maneja todo
    window.location.href = `/api/paciente/wearable/connect/${id}`
  }

  async function sincronizar(id: string) {
    setSincronizando(id)
    try {
      await apiFetch(`/api/paciente/wearable/sync/${id}`, { method: 'POST' })
      await cargar()
    } finally {
      setSincronizando(null)
    }
  }

  async function desconectar(id: string) {
    if (!confirm('¿Desconectar este dispositivo? Tus datos registrados no se eliminarán.')) return
    await apiFetch(`/api/paciente/wearable/${id}`, { method: 'DELETE' })
    await cargar()
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center gap-3">
        <Smartphone className="text-[var(--color-primary)]" size={24} />
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Mis dispositivos</h1>
      </div>

      <p className="text-sm text-[var(--color-muted)]">
        Conecta tu cuenta de Fitbit o Google Fit para que tus pasos,
        frecuencia cardíaca y sueño se sincronicen automáticamente con NutriSmart.
      </p>

      {/* Nota Apple Watch */}
      <div className="flex gap-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4">
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
        <p className="text-xs text-[var(--color-muted)]">
          <strong className="text-[var(--color-text)]">¿Usas Apple Watch?</strong>{' '}
          Instala la app de Fitbit en tu iPhone y activa la sincronización con Apple Health.
          Tus datos de Apple Watch llegarán automáticamente a NutriSmart vía Fitbit.
        </p>
      </div>

      {/* Cards de proveedores */}
      <div className="space-y-4">
        {PROVEEDORES.map(p => {
          const cx      = conexionDe(p.id)
          const activo  = !!cx
          const syncing = sincronizando === p.id

          return (
            <div
              key={p.id}
              className="rounded-xl border border-[var(--color-border)]
                         bg-[var(--color-surface)] p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[var(--color-text)]">{p.nombre}</span>
                    {activo && (
                      <span className="flex items-center gap-1 rounded-full bg-[var(--color-success)]/10
                                       px-2 py-0.5 text-xs text-[var(--color-success)]">
                        <CheckCircle2 size={10} /> Conectado
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--color-muted)]">{p.descripcion}</p>
                  {cx?.ultimo_sync && (
                    <p className="text-xs text-[var(--color-muted)]">
                      Última sync: {new Date(cx.ultimo_sync).toLocaleString('es-CR')}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-col gap-2">
                  {activo ? (
                    <>
                      <button
                        onClick={() => sincronizar(p.id)}
                        disabled={syncing}
                        className="flex items-center gap-1 rounded-lg bg-[var(--color-primary)]
                                   px-3 py-1.5 text-xs font-medium text-white
                                   hover:opacity-90 disabled:opacity-50"
                      >
                        <Zap size={12} />
                        {syncing ? 'Sincronizando…' : 'Sincronizar'}
                      </button>
                      <button
                        onClick={() => desconectar(p.id)}
                        className="flex items-center gap-1 rounded-lg border
                                   border-[var(--color-border)] px-3 py-1.5
                                   text-xs text-[var(--color-muted)]
                                   hover:text-[var(--color-danger)]"
                      >
                        <Unlink size={12} /> Desconectar
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => conectar(p.id)}
                      className="rounded-lg bg-[var(--color-primary)] px-4 py-1.5
                                 text-xs font-medium text-white hover:opacity-90"
                    >
                      Conectar
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

### Router — añadir la ruta

```tsx
import DispositivosPage from './pages/DispositivosPage'
// Dentro del bloque de rutas protegidas del paciente:
<Route path="/paciente/dispositivos" element={<DispositivosPage />} />
```

### Menú / navegación del paciente

Añadir enlace a `Mis dispositivos` en el menú de la app del paciente,
junto a las secciones de diario, progreso y tareas.

---

## Nota para desarrollo local

Los proveedores OAuth requieren una `redirect_uri` HTTPS registrada en su portal.
Con el setup de mkcert ya hecho, la URL de callback es:

```
https://192.168.X.X:5175/api/paciente/wearable/callback/fitbit
https://192.168.X.X:5175/api/paciente/wearable/callback/google_fit
```

Registrar estas URLs en:
- **Fitbit**: https://dev.fitbit.com/apps → editar app → Callback URL
- **Google**: https://console.cloud.google.com → Credenciales → URIs de redirección

En producción, la URL cambiaría al dominio público.

---

## Lista de verificación

```
[ ] Migración aplicada: fuente en registro_metrica, tabla conexion_wearable creada
[ ] WEARABLE_ENCRYPTION_KEY configurada (32 bytes hex)
[ ] FITBIT_CLIENT_ID / FITBIT_CLIENT_SECRET configurados
[ ] GOOGLE_FIT_CLIENT_ID / GOOGLE_FIT_CLIENT_SECRET configurados
[ ] APP_PUBLIC_URL configurado con la IP local o dominio
[ ] Callbacks registrados en portales Fitbit y Google Cloud
[ ] GET /api/paciente/wearable/estado devuelve [] sin token → no falla
[ ] Flujo Fitbit: clic Conectar → redirige a fitbit.com → callback → conexión activa
[ ] Flujo Google Fit: igual con cuentas Google
[ ] Sincronización manual: pasos, FC y sueño aparecen en registro_metrica con fuente='fitbit'
[ ] Sin duplicados al sincronizar dos veces el mismo día
[ ] Desconectar: activo = false, datos en registro_metrica se conservan
[ ] Token expirado: se renueva automáticamente en el siguiente sync
[ ] DispositivosPage: proveedores conectados muestran badge verde y botón Sincronizar
[ ] Nota de Apple Watch visible en la pantalla
```
