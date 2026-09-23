# r28-claudecode-prompt.md
# NutriSmart — Rebanada 28
# GAM-01: Configuración de la clínica  |  GAM-02: Gestión del equipo profesional

## Contexto de continuidad

SaaS multi-tenant de nutrición clínica. Monorepo: `apps/api` (Fastify),
`apps/web-professional` (Vite + React, puerto 5173), `apps/web-patient` (Vite + React, puerto 5175).

**Reglas permanentes (no vuelvas a preguntar):**

1. Framework del servidor: **Fastify** (nunca Express).
2. Multi-tenancy profesional: `request.auth.tenantId` → `clinica_id`.
   Multi-tenancy paciente: `SELECT clinica_id FROM paciente WHERE keycloak_user_id = $1`.
3. Borrado suave únicamente: `activo = false`. Nunca `DELETE` físico.
4. Gráficas: **SVG puro**. Cero librerías de charting externas.
5. Colores: **CSS vars / tokens Tailwind**. Nunca hex en línea en JSX.
6. Email transaccional: **Resend** con variable `RESEND_API_KEY`.
   Si la variable no está definida → `console.log` en lugar de enviar.
   Nunca exponer el valor de la key en el código fuente ni en mensajes.
7. `TIMESTAMPTZ` → JSON: devolver el valor crudo del driver `pg` (produce `…000Z`).
   **Nunca** `to_char(x, '…OF')` — produce `+00` que `new Date()` rechaza.
8. `ORDER BY` en fechas que deciden primero/último: **siempre añadir `id` como desempate**
   (`ORDER BY fecha DESC, id DESC`).
9. `ORDER BY` en enums: **CASE WHEN**, nunca por valor de texto (ordena alfabéticamente).
10. Columna nombre del paciente: **`paciente.nombre`** (no existe `nombre_completo`).
11. **Antes de crear cualquier migración**: ejecutar
    `SELECT migration_name FROM schema_migrations ORDER BY migration_name DESC LIMIT 1`
    y usar el número siguiente disponible.

---

## Paso 0 — Verificación previa (obligatoria)

Ejecuta estas consultas antes de tocar nada:

```sql
-- 1. Número de migración disponible
SELECT migration_name
FROM schema_migrations
ORDER BY migration_name DESC
LIMIT 1;

-- 2. Columnas actuales de clinica
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'clinica'
ORDER BY ordinal_position;

-- 3. Columnas actuales de profesional
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'profesional'
ORDER BY ordinal_position;

-- 4. Verificar si ya existe el enum profesional_rol
SELECT typname FROM pg_type WHERE typname = 'profesional_rol';
```

Usa los resultados para adaptar las migraciones con `ADD COLUMN IF NOT EXISTS`
y `DO $$ BEGIN CREATE TYPE … EXCEPTION WHEN duplicate_object THEN NULL; END $$`.

---

## Migraciones

### apps/api/migrations/0NN_gam_clinica_config.sql

Usa el número siguiente al último registrado en schema_migrations.

```sql
-- Amplía clinica con datos de configuración y branding
ALTER TABLE clinica
  ADD COLUMN IF NOT EXISTS logo_url         TEXT,
  ADD COLUMN IF NOT EXISTS color_primario   TEXT NOT NULL DEFAULT '#059669',
  ADD COLUMN IF NOT EXISTS color_secundario TEXT NOT NULL DEFAULT '#0284c7',
  ADD COLUMN IF NOT EXISTS direccion        TEXT,
  ADD COLUMN IF NOT EXISTS telefono         TEXT,
  ADD COLUMN IF NOT EXISTS sitio_web        TEXT,
  ADD COLUMN IF NOT EXISTS zona_horaria     TEXT NOT NULL DEFAULT 'America/Mexico_City',
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT now();
```

### apps/api/migrations/0NN1_gam_profesional_rol.sql

Usa el número siguiente al anterior (0NN + 1).

```sql
-- Enum de roles
DO $$ BEGIN
  CREATE TYPE profesional_rol AS ENUM ('admin', 'nutricionista');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Columnas adicionales del profesional
ALTER TABLE profesional
  ADD COLUMN IF NOT EXISTS rol      profesional_rol NOT NULL DEFAULT 'nutricionista',
  ADD COLUMN IF NOT EXISTS email    TEXT,
  ADD COLUMN IF NOT EXISTS foto_url TEXT;

-- Bootstrap: el profesional más antiguo de cada clínica pasa a ser 'admin'.
-- Solo aplica cuando ningún profesional de esa clínica tiene ya el rol 'admin'
-- (primera ejecución); las ejecuciones subsiguientes son no-op.
UPDATE profesional p
SET rol = 'admin'
WHERE p.id IN (
  SELECT DISTINCT ON (clinica_id) id
  FROM profesional
  WHERE activo = true
  ORDER BY clinica_id, created_at ASC
)
AND NOT EXISTS (
  SELECT 1 FROM profesional p2
  WHERE p2.clinica_id = p.clinica_id
    AND p2.rol = 'admin'
);
```

---

## Backend — apps/api

### apps/api/src/middleware/requireAdmin.ts

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify'
import { pool } from '../db'

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { rows } = await pool.query<{ rol: string }>(
    `SELECT rol
     FROM profesional
     WHERE keycloak_user_id = $1
       AND clinica_id        = $2
       AND activo            = true
     LIMIT 1`,
    [request.user.sub, request.auth.tenantId]
  )
  if (rows[0]?.rol !== 'admin') {
    reply.status(403).send({ error: 'Se requiere rol de administrador' })
  }
}
```

### apps/api/src/profesional/yo.ts  ← archivo nuevo

Este endpoint se llama en cada arranque del frontend para saber quién es
el usuario actual y qué rol tiene. Incluye datos de la clínica para el header.

```typescript
import type { FastifyInstance } from 'fastify'
import { pool } from '../db'

export async function profesionalYoRoutes(fastify: FastifyInstance) {
  fastify.get('/api/profesional/yo', async (request, reply) => {
    // Intento 1: buscar por keycloak_user_id (caso normal)
    let { rows } = await pool.query(
      `SELECT
         p.id, p.nombre, p.especialidad, p.email, p.foto_url, p.rol,
         c.nombre          AS clinica_nombre,
         c.logo_url        AS clinica_logo_url,
         c.color_primario,
         c.color_secundario
       FROM profesional p
       JOIN clinica c ON c.id = p.clinica_id
       WHERE p.keycloak_user_id = $1
         AND p.clinica_id       = $2
         AND p.activo           = true
       LIMIT 1`,
      [request.user.sub, request.auth.tenantId]
    )

    // Intento 2: si no existe, intentar vincular por email (primer login)
    // Requiere que el JWT de Keycloak incluya el claim 'email'.
    if (!rows[0]) {
      const emailJwt = (request.user as Record<string, unknown>).email as string | undefined
      if (emailJwt) {
        const linked = await pool.query(
          `UPDATE profesional
           SET keycloak_user_id = $1,
               updated_at       = now()
           WHERE email       = $2
             AND clinica_id  = $3
             AND keycloak_user_id IS NULL
             AND activo      = true
           RETURNING id, nombre, especialidad, email, foto_url, rol`,
          [request.user.sub, emailJwt.toLowerCase(), request.auth.tenantId]
        )
        if (linked.rows[0]) {
          // Releer con JOIN a clinica para devolver los mismos campos
          const full = await pool.query(
            `SELECT
               p.id, p.nombre, p.especialidad, p.email, p.foto_url, p.rol,
               c.nombre          AS clinica_nombre,
               c.logo_url        AS clinica_logo_url,
               c.color_primario,
               c.color_secundario
             FROM profesional p
             JOIN clinica c ON c.id = p.clinica_id
             WHERE p.id = $1`,
            [linked.rows[0].id]
          )
          return full.rows[0]
        }
      }
      return reply.status(404).send({ error: 'Profesional no encontrado' })
    }

    return rows[0]
  })
}
```

Registra `profesionalYoRoutes` en `apps/api/src/server.ts`.

> **Nota Keycloak**: para que el claim `email` llegue al JWT, verifica en
> Keycloak Admin → Client Scopes → `email` → está incluido en el token del
> cliente `nutrismart-professional`.

### apps/api/src/admin/clinica.ts

```typescript
import type { FastifyInstance } from 'fastify'
import { pool } from '../db'
import { requireAdmin } from '../middleware/requireAdmin'

const CAMPOS_PERMITIDOS = [
  'nombre', 'logo_url', 'color_primario', 'color_secundario',
  'direccion', 'telefono', 'sitio_web', 'zona_horaria',
] as const

export async function adminClinicaRoutes(fastify: FastifyInstance) {
  // GET /api/admin/clinica
  fastify.get(
    '/api/admin/clinica',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { rows } = await pool.query(
        `SELECT id, nombre, logo_url, color_primario, color_secundario,
                direccion, telefono, sitio_web, zona_horaria
         FROM clinica
         WHERE id = $1`,
        [request.auth.tenantId]
      )
      return rows[0] ?? reply.status(404).send({ error: 'Clínica no encontrada' })
    }
  )

  // PATCH /api/admin/clinica
  fastify.patch(
    '/api/admin/clinica',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const body = request.body as Record<string, unknown>
      const fields = Object.keys(body).filter(k =>
        (CAMPOS_PERMITIDOS as readonly string[]).includes(k)
      )
      if (fields.length === 0) {
        return reply.status(400).send({ error: 'Sin campos válidos para actualizar' })
      }

      const sets   = fields.map((f, i) => `${f} = $${i + 2}`)
      const values = fields.map(f => body[f])

      const { rows } = await pool.query(
        `UPDATE clinica
         SET ${sets.join(', ')}, updated_at = now()
         WHERE id = $1
         RETURNING id, nombre, logo_url, color_primario, color_secundario,
                   direccion, telefono, sitio_web, zona_horaria`,
        [request.auth.tenantId, ...values]
      )
      return rows[0]
    }
  )
}
```

### apps/api/src/admin/profesionales.ts

```typescript
import type { FastifyInstance } from 'fastify'
import { pool } from '../db'
import { requireAdmin } from '../middleware/requireAdmin'

interface AgregarBody {
  nombre:       string
  especialidad?: string
  email:        string
  rol?:         'admin' | 'nutricionista'
}

export async function adminProfesionalesRoutes(fastify: FastifyInstance) {
  // GET /api/admin/profesionales
  fastify.get(
    '/api/admin/profesionales',
    { preHandler: [requireAdmin] },
    async (request) => {
      const { rows } = await pool.query(
        `SELECT
           p.id,
           p.nombre,
           p.especialidad,
           p.email,
           p.foto_url,
           p.rol,
           p.activo,
           p.created_at,
           (SELECT COUNT(*)
            FROM cita c
            WHERE c.profesional_id = p.id
              AND c.fecha >= CURRENT_DATE - INTERVAL '30 days'
              AND c.clinica_id = $1)::int   AS citas_ultimo_mes,
           (SELECT COUNT(DISTINCT c2.paciente_id)
            FROM cita c2
            WHERE c2.profesional_id = p.id
              AND c2.clinica_id     = $1
              AND c2.estado         = 'completada')::int AS pacientes_atendidos
         FROM profesional p
         WHERE p.clinica_id = $1
         ORDER BY
           CASE p.rol WHEN 'admin' THEN 0 ELSE 1 END,
           p.nombre`,
        [request.auth.tenantId]
      )
      return rows
    }
  )

  // POST /api/admin/profesionales — crear registro (sin cuenta Keycloak)
  // El admin de Keycloak crea la cuenta; el profesional se vincula en su primer login.
  fastify.post<{ Body: AgregarBody }>(
    '/api/admin/profesionales',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { nombre, especialidad, email, rol = 'nutricionista' } = request.body

      if (!nombre?.trim()) {
        return reply.status(400).send({ error: 'El nombre es obligatorio' })
      }
      if (!email?.includes('@')) {
        return reply.status(400).send({ error: 'Email inválido' })
      }

      const existe = await pool.query(
        `SELECT id FROM profesional
         WHERE email = $1 AND clinica_id = $2`,
        [email.toLowerCase(), request.auth.tenantId]
      )
      if (existe.rows.length) {
        return reply.status(409).send({ error: 'Ya existe un profesional con ese email en esta clínica' })
      }

      const { rows } = await pool.query(
        `INSERT INTO profesional
           (clinica_id, nombre, especialidad, email, rol, activo)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING id, nombre, especialidad, email, rol, activo, created_at`,
        [
          request.auth.tenantId,
          nombre.trim(),
          especialidad?.trim() ?? null,
          email.toLowerCase(),
          rol,
        ]
      )

      await enviarBienvenida({ nombre: rows[0].nombre, email: rows[0].email })

      reply.status(201)
      return rows[0]
    }
  )

  // PATCH /api/admin/profesionales/:id
  fastify.patch<{ Params: { id: string } }>(
    '/api/admin/profesionales/:id',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id } = request.params
      const body   = request.body as Record<string, unknown>

      // Verificar que el profesional pertenece a esta clínica
      const check = await pool.query(
        `SELECT id, rol FROM profesional
         WHERE id = $1 AND clinica_id = $2`,
        [id, request.auth.tenantId]
      )
      if (!check.rows[0]) {
        return reply.status(404).send({ error: 'Profesional no encontrado' })
      }

      // Proteger el último admin de la clínica
      if (
        (body.rol === 'nutricionista' || body.activo === false) &&
        check.rows[0].rol === 'admin'
      ) {
        const { rows: admins } = await pool.query(
          `SELECT COUNT(*)::int AS total
           FROM profesional
           WHERE clinica_id = $1 AND rol = 'admin' AND activo = true`,
          [request.auth.tenantId]
        )
        if (admins[0].total <= 1) {
          return reply.status(409).send({
            error: 'No se puede modificar al único administrador activo de la clínica',
          })
        }
      }

      const PERMITIDOS = ['nombre', 'especialidad', 'email', 'foto_url', 'rol', 'activo']
      const fields  = Object.keys(body).filter(k => PERMITIDOS.includes(k))
      if (fields.length === 0) {
        return reply.status(400).send({ error: 'Sin campos válidos' })
      }

      const sets   = fields.map((f, i) => `${f} = $${i + 2}`)
      const values = fields.map(f => body[f])

      const { rows } = await pool.query(
        `UPDATE profesional
         SET ${sets.join(', ')}, updated_at = now()
         WHERE id = $1
         RETURNING id, nombre, especialidad, email, foto_url, rol, activo`,
        [id, ...values]
      )
      return rows[0]
    }
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function enviarBienvenida(profesional: { nombre: string; email: string }) {
  const cuerpo = {
    from:    'NutriSmart <no-reply@nutrismart.mx>',
    to:      profesional.email,
    subject: `Bienvenido a NutriSmart, ${profesional.nombre}`,
    html: `
      <p>Hola <strong>${profesional.nombre}</strong>,</p>
      <p>Tu clínica te ha registrado en NutriSmart.</p>
      <p>Para acceder, solicita tus credenciales al administrador de Keycloak de tu clínica.
         Inicia sesión con ese usuario en
         <a href="https://app.nutrismart.mx">app.nutrismart.mx</a>.</p>
      <p>Si tu email en Keycloak coincide con este correo, tu cuenta quedará
         vinculada automáticamente en tu primer inicio de sesión.</p>
    `,
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY
  if (RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cuerpo),
      })
    } catch (err) {
      console.error('[email] Error al enviar bienvenida:', err)
    }
  } else {
    console.log('[email-dev] Bienvenida →', cuerpo)
  }
}
```

### Registro en apps/api/src/server.ts

```typescript
// Añadir junto con las demás importaciones de rutas:
import { profesionalYoRoutes }     from './profesional/yo'
import { adminClinicaRoutes }       from './admin/clinica'
import { adminProfesionalesRoutes } from './admin/profesionales'

// En el bloque de registro de rutas (después de las migraciones):
await fastify.register(profesionalYoRoutes)
await fastify.register(adminClinicaRoutes)
await fastify.register(adminProfesionalesRoutes)
```

---

## Frontend — apps/web-professional

### apps/web-professional/src/hooks/useYo.ts  ← archivo nuevo

```typescript
import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'

export interface YoData {
  id:               string
  nombre:           string
  especialidad?:    string
  email?:           string
  foto_url?:        string
  rol:              'admin' | 'nutricionista'
  clinica_nombre:   string
  clinica_logo_url?: string
  color_primario:   string
  color_secundario: string
}

let _cache: YoData | null = null

export function useYo() {
  const [yo, setYo] = useState<YoData | null>(_cache)
  const [cargando, setCargando] = useState(!_cache)

  useEffect(() => {
    if (_cache) return
    apiFetch('/api/profesional/yo')
      .then(r => r.json())
      .then((d: YoData) => {
        _cache = d
        setYo(d)
      })
      .catch(console.error)
      .finally(() => setCargando(false))
  }, [])

  return { yo, cargando, esAdmin: yo?.rol === 'admin' }
}
```

> La variable `_cache` evita llamadas duplicadas cuando varios componentes
> usan `useYo()` en el mismo render tree. Se resetea al recargar la página.

### Sidebar — sección Administración

Localiza el componente Sidebar de `apps/web-professional` (busca `NavItem` o
el texto `"Agenda"` o `"Pacientes"` en los archivos del sidebar).

Añade al final de la lista de ítems, **condicional a `esAdmin`**:

```tsx
// Importar en el archivo del Sidebar:
import { useYo } from '../hooks/useYo'
import { BarChart2, Building2, Users } from 'lucide-react'

// Dentro del componente Sidebar, añadir:
const { esAdmin } = useYo()

// En el JSX, al final de la lista de NavItems:
{esAdmin && (
  <>
    <div className="px-3 pt-5 pb-1 text-xs font-semibold uppercase tracking-wider
                    text-[var(--color-muted)]">
      Administración
    </div>
    <NavItem to="/admin/dashboard" icon={<BarChart2 size={18} />} label="Dashboard" />
    <NavItem to="/admin/clinica"   icon={<Building2  size={18} />} label="Clínica" />
    <NavItem to="/admin/equipo"    icon={<Users      size={18} />} label="Equipo" />
  </>
)}
```

### Guardia de rutas admin

Si el proyecto tiene un componente `ProtectedRoute` o similar, crea junto a
él un `RequireAdmin`:

```tsx
// apps/web-professional/src/components/RequireAdmin.tsx
import { Navigate } from 'react-router-dom'
import { useYo } from '../hooks/useYo'

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { esAdmin, cargando } = useYo()
  if (cargando) return null
  if (!esAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}
```

### apps/web-professional/src/pages/admin/ConfiguracionClinicaPage.tsx

```tsx
import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'

interface ClinicaData {
  id:              string
  nombre:          string
  logo_url?:       string
  color_primario:  string
  color_secundario: string
  direccion?:      string
  telefono?:       string
  sitio_web?:      string
  zona_horaria:    string
}

const ZONAS_HORARIAS = [
  'America/Mexico_City',
  'America/Monterrey',
  'America/Cancun',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/Caracas',
  'America/Guayaquil',
  'America/La_Paz',
  'America/Asuncion',
  'America/Montevideo',
]

export default function ConfiguracionClinicaPage() {
  const [datos,     setDatos]     = useState<Partial<ClinicaData>>({})
  const [guardando, setGuardando] = useState(false)
  const [ok,        setOk]        = useState(false)
  const [error,     setError]     = useState('')

  useEffect(() => {
    apiFetch('/api/admin/clinica')
      .then(r => r.json())
      .then(setDatos)
  }, [])

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      const r = await apiFetch('/api/admin/clinica', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(datos),
      })
      if (!r.ok) {
        const d = await r.json()
        setError(d.error ?? 'Error al guardar')
        return
      }
      setOk(true)
      setTimeout(() => setOk(false), 3000)
    } finally {
      setGuardando(false)
    }
  }

  function campo(
    label: string,
    key: keyof ClinicaData,
    type = 'text'
  ) {
    return (
      <div>
        <label className="block text-sm font-medium text-[var(--color-text)] mb-1">
          {label}
        </label>
        <input
          type={type}
          value={(datos[key] as string) ?? ''}
          onChange={e => setDatos(d => ({ ...d, [key]: e.target.value }))}
          className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2
                     text-sm bg-[var(--color-surface)] text-[var(--color-text)]
                     focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold text-[var(--color-text)] mb-6">
        Configuración de la clínica
      </h1>

      <form onSubmit={guardar} className="space-y-5">

        {/* Datos generales */}
        <section className="rounded-xl border border-[var(--color-border)]
                            bg-[var(--color-surface)] p-5 space-y-4">
          <h2 className="font-semibold text-[var(--color-text)]">Datos generales</h2>
          {campo('Nombre de la clínica', 'nombre')}
          {campo('Dirección', 'direccion')}
          {campo('Teléfono', 'telefono', 'tel')}
          {campo('Sitio web', 'sitio_web', 'url')}
        </section>

        {/* Identidad visual */}
        <section className="rounded-xl border border-[var(--color-border)]
                            bg-[var(--color-surface)] p-5 space-y-4">
          <h2 className="font-semibold text-[var(--color-text)]">Identidad visual</h2>
          {campo('URL del logotipo', 'logo_url', 'url')}

          <div className="grid grid-cols-2 gap-4">
            {(['color_primario', 'color_secundario'] as const).map(key => (
              <div key={key}>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-1">
                  {key === 'color_primario' ? 'Color primario' : 'Color secundario'}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={(datos[key] as string) ?? '#059669'}
                    onChange={e => setDatos(d => ({ ...d, [key]: e.target.value }))}
                    className="h-9 w-16 cursor-pointer rounded border border-[var(--color-border)]"
                  />
                  <span className="text-xs font-mono text-[var(--color-muted)]">
                    {(datos[key] as string) ?? '#059669'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Vista previa de colores */}
          {datos.color_primario && (
            <div className="flex gap-3 pt-1">
              <div className="h-8 w-28 rounded-lg"
                   style={{ backgroundColor: datos.color_primario }} />
              <div className="h-8 w-28 rounded-lg"
                   style={{ backgroundColor: datos.color_secundario }} />
              <span className="self-center text-xs text-[var(--color-muted)]">
                Vista previa
              </span>
            </div>
          )}
        </section>

        {/* Zona horaria */}
        <section className="rounded-xl border border-[var(--color-border)]
                            bg-[var(--color-surface)] p-5">
          <h2 className="font-semibold text-[var(--color-text)] mb-3">Zona horaria</h2>
          <select
            value={datos.zona_horaria ?? 'America/Mexico_City'}
            onChange={e => setDatos(d => ({ ...d, zona_horaria: e.target.value }))}
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2
                       text-sm bg-[var(--color-surface)] text-[var(--color-text)]"
          >
            {ZONAS_HORARIAS.map(z => (
              <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </section>

        {/* Acciones */}
        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={guardando}
            className="rounded-lg bg-[var(--color-primary)] px-6 py-2.5 text-sm
                       font-semibold text-white disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
          {ok && (
            <span className="text-sm text-[var(--color-success)]">
              ✓ Cambios guardados
            </span>
          )}
        </div>
      </form>
    </div>
  )
}
```

### apps/web-professional/src/pages/admin/EquipoPage.tsx

```tsx
import { useEffect, useState } from 'react'
import { Plus, Pencil, CheckCircle, XCircle } from 'lucide-react'
import { apiFetch } from '../../lib/api'

interface Profesional {
  id:                 string
  nombre:             string
  especialidad?:      string
  email?:             string
  foto_url?:          string
  rol:                'admin' | 'nutricionista'
  activo:             boolean
  citas_ultimo_mes:   number
  pacientes_atendidos: number
  created_at:         string
}

const ROL_LABEL: Record<string, string> = {
  admin:         'Administrador',
  nutricionista: 'Nutricionista',
}

type ModalState = 'agregar' | { profesional: Profesional } | null

export default function EquipoPage() {
  const [equipo, setEquipo] = useState<Profesional[]>([])
  const [modal,  setModal]  = useState<ModalState>(null)
  const [error,  setError]  = useState('')

  async function cargar() {
    const r = await apiFetch('/api/admin/profesionales')
    if (r.ok) setEquipo(await r.json())
  }

  useEffect(() => { cargar() }, [])

  async function toggleActivo(p: Profesional) {
    setError('')
    const r = await apiFetch(`/api/admin/profesionales/${p.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ activo: !p.activo }),
    })
    if (!r.ok) {
      const d = await r.json()
      setError(d.error ?? 'No se pudo actualizar')
    } else {
      cargar()
    }
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Equipo profesional</h1>
        <button
          onClick={() => setModal('agregar')}
          className="flex items-center gap-2 rounded-lg bg-[var(--color-primary)]
                     px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus size={16} /> Agregar profesional
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-[var(--color-danger)]/10 px-4 py-2
                      text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--color-border)]
                      bg-[var(--color-surface)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)]
                           text-left text-[var(--color-muted)]">
              <th className="px-4 py-3 font-medium">Profesional</th>
              <th className="px-4 py-3 font-medium">Rol</th>
              <th className="px-4 py-3 text-right font-medium">Pacientes</th>
              <th className="px-4 py-3 text-right font-medium">Citas (30d)</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {equipo.map(p => (
              <tr key={p.id}
                  className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center
                                 rounded-full text-sm font-bold text-white overflow-hidden"
                      style={{ backgroundColor: 'var(--color-primary)' }}
                    >
                      {p.foto_url
                        ? <img src={p.foto_url} alt="" className="h-full w-full object-cover" />
                        : p.nombre.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium text-[var(--color-text)]">{p.nombre}</div>
                      {p.especialidad && (
                        <div className="text-xs text-[var(--color-muted)]">{p.especialidad}</div>
                      )}
                      {p.email && (
                        <div className="text-xs text-[var(--color-muted)]">{p.email}</div>
                      )}
                    </div>
                  </div>
                </td>

                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium
                    ${p.rol === 'admin'
                      ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                      : 'bg-[var(--color-muted)]/10 text-[var(--color-muted)]'}`}>
                    {ROL_LABEL[p.rol]}
                  </span>
                </td>

                <td className="px-4 py-3 text-right text-[var(--color-text)]">
                  {p.pacientes_atendidos}
                </td>
                <td className="px-4 py-3 text-right text-[var(--color-text)]">
                  {p.citas_ultimo_mes}
                </td>

                <td className="px-4 py-3">
                  <span className={`text-xs font-medium
                    ${p.activo
                      ? 'text-[var(--color-success)]'
                      : 'text-[var(--color-danger)]'}`}>
                    {p.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>

                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setModal({ profesional: p })}
                      title="Editar"
                      className="p-1 text-[var(--color-muted)] hover:text-[var(--color-text)]"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => toggleActivo(p)}
                      title={p.activo ? 'Desactivar' : 'Reactivar'}
                      className={`p-1 ${p.activo
                        ? 'text-[var(--color-danger)]'
                        : 'text-[var(--color-success)]'}`}
                    >
                      {p.activo ? <XCircle size={15} /> : <CheckCircle size={15} />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {equipo.length === 0 && (
              <tr>
                <td colSpan={6}
                    className="px-4 py-8 text-center text-sm text-[var(--color-muted)]">
                  No hay profesionales registrados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modales */}
      {modal === 'agregar' && (
        <ModalAgregarProfesional
          onClose={() => setModal(null)}
          onGuardado={() => { setModal(null); cargar() }}
        />
      )}
      {modal && typeof modal === 'object' && (
        <ModalEditarProfesional
          profesional={modal.profesional}
          onClose={() => setModal(null)}
          onGuardado={() => { setModal(null); cargar() }}
        />
      )}
    </div>
  )
}

// ── Modal agregar profesional ──────────────────────────────────────────────

function ModalAgregarProfesional({
  onClose, onGuardado
}: { onClose: () => void; onGuardado: () => void }) {
  const [form, setForm] = useState({
    nombre: '', especialidad: '', email: '', rol: 'nutricionista',
  })
  const [error,     setError]     = useState('')
  const [guardando, setGuardando] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      const r = await apiFetch('/api/admin/profesionales', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      })
      if (!r.ok) {
        setError((await r.json()).error ?? 'Error al guardar')
        return
      }
      onGuardado()
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal titulo="Agregar profesional" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Campo label="Nombre completo" value={form.nombre} required
          onChange={v => setForm(f => ({ ...f, nombre: v }))} />
        <Campo label="Especialidad" value={form.especialidad}
          onChange={v => setForm(f => ({ ...f, especialidad: v }))} />
        <Campo label="Email" type="email" value={form.email} required
          onChange={v => setForm(f => ({ ...f, email: v }))} />
        <SelectorRol value={form.rol}
          onChange={v => setForm(f => ({ ...f, rol: v }))} />

        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

        <p className="text-xs text-[var(--color-muted)]">
          Se enviará un correo con instrucciones. La cuenta de acceso debe
          crearse por separado en el panel de Keycloak con el mismo email.
        </p>

        <BotonesModal onClose={onClose} guardando={guardando} />
      </form>
    </Modal>
  )
}

// ── Modal editar profesional ───────────────────────────────────────────────

function ModalEditarProfesional({
  profesional, onClose, onGuardado
}: { profesional: Profesional; onClose: () => void; onGuardado: () => void }) {
  const [form, setForm] = useState({
    nombre:       profesional.nombre,
    especialidad: profesional.especialidad ?? '',
    email:        profesional.email ?? '',
    rol:          profesional.rol,
  })
  const [error,     setError]     = useState('')
  const [guardando, setGuardando] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      const r = await apiFetch(`/api/admin/profesionales/${profesional.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      })
      if (!r.ok) {
        setError((await r.json()).error ?? 'Error al guardar')
        return
      }
      onGuardado()
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal titulo={`Editar: ${profesional.nombre}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Campo label="Nombre" value={form.nombre} required
          onChange={v => setForm(f => ({ ...f, nombre: v }))} />
        <Campo label="Especialidad" value={form.especialidad}
          onChange={v => setForm(f => ({ ...f, especialidad: v }))} />
        <Campo label="Email" type="email" value={form.email}
          onChange={v => setForm(f => ({ ...f, email: v }))} />
        <SelectorRol value={form.rol}
          onChange={v => setForm(f => ({ ...f, rol: v }))} />

        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

        <BotonesModal onClose={onClose} guardando={guardando} />
      </form>
    </Modal>
  )
}

// ── Subcomponentes compartidos ─────────────────────────────────────────────

function Modal({
  titulo, onClose, children
}: { titulo: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-[var(--color-surface)] p-6 shadow-xl">
        <h2 className="mb-5 text-lg font-bold text-[var(--color-text)]">{titulo}</h2>
        {children}
      </div>
    </div>
  )
}

function Campo({
  label, value, onChange, required, type = 'text'
}: {
  label:    string
  value:    string
  onChange: (v: string) => void
  required?: boolean
  type?:    string
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm
                   bg-[var(--color-surface)] text-[var(--color-text)]
                   focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
      />
    </div>
  )
}

function SelectorRol({
  value, onChange
}: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">Rol</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm
                   bg-[var(--color-surface)] text-[var(--color-text)]"
      >
        <option value="nutricionista">Nutricionista</option>
        <option value="admin">Administrador</option>
      </select>
    </div>
  )
}

function BotonesModal({
  onClose, guardando
}: { onClose: () => void; guardando: boolean }) {
  return (
    <div className="flex gap-3 pt-2">
      <button
        type="button"
        onClick={onClose}
        className="flex-1 rounded-lg border border-[var(--color-border)] py-2
                   text-sm text-[var(--color-text)]"
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={guardando}
        className="flex-1 rounded-lg bg-[var(--color-primary)] py-2
                   text-sm font-semibold text-white disabled:opacity-50"
      >
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}
```

### Router — nuevas rutas admin

En el archivo del router de `apps/web-professional` (el que registra
`/pacientes`, `/agenda`, etc.), añade:

```tsx
import { RequireAdmin }              from './components/RequireAdmin'
import ConfiguracionClinicaPage      from './pages/admin/ConfiguracionClinicaPage'
import EquipoPage                    from './pages/admin/EquipoPage'
// DashboardAdminPage se añade en r29

// Dentro del bloque de rutas protegidas:
<Route path="/admin/clinica"
  element={<RequireAdmin><ConfiguracionClinicaPage /></RequireAdmin>} />
<Route path="/admin/equipo"
  element={<RequireAdmin><EquipoPage /></RequireAdmin>} />
```

---

## Lista de verificación

Antes de confirmar la rebanada como completada:

- [ ] Verificación paso 0 ejecutada antes de crear migraciones.
- [ ] Migraciones aplicadas sin error; columnas añadidas a `clinica` y `profesional`.
- [ ] Bootstrap: al menos un profesional por clínica tiene `rol = 'admin'`.
- [ ] `GET /api/profesional/yo` devuelve `{ id, nombre, rol, clinica_nombre, color_primario, color_secundario }`.
- [ ] Vinculación por email funciona: si `keycloak_user_id IS NULL` y el email del JWT coincide, el registro se vincula.
- [ ] `GET /api/admin/clinica` devuelve 403 si el usuario no es admin.
- [ ] `GET /api/admin/clinica` devuelve 200 con datos si el usuario es admin.
- [ ] `PATCH /api/admin/clinica` actualiza los campos correctamente y devuelve el objeto actualizado.
- [ ] `GET /api/admin/profesionales` devuelve la lista con `citas_ultimo_mes` y `pacientes_atendidos`.
- [ ] `POST /api/admin/profesionales` crea el registro, devuelve 201, devuelve 409 si email repetido.
- [ ] `PATCH /api/admin/profesionales/:id` protege al último admin (devuelve 409 si se intenta degradar/desactivar).
- [ ] `RequireAdmin` redirige a `/` si el usuario no es admin.
- [ ] Sidebar muestra sección "Administración" solo para usuarios con `rol = 'admin'`.
- [ ] `/admin/clinica` renderiza el formulario y guarda cambios.
- [ ] `/admin/equipo` muestra la tabla, abre modal de agregar y modal de editar.
- [ ] Desactivar profesional hace `activo = false`; la tabla se actualiza.
