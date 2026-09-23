# R25 — PAC-09 Personalización de perfil y fondo del paciente

## Contexto obligatorio — leer antes de tocar cualquier archivo

- Monorepo: `apps/api` (Fastify), `apps/web-patient` (Vite + React, puerto 5175), `apps/web-professional` (Vite + React, puerto 5173)
- Columnas reales: `paciente.nombre` (no `nombre_completo`), `paciente.correo`, `paciente.estado`, `paciente.sexo_biologico`, `clinica.nombre_comercial`
- `clinica_id` del paciente: `SELECT clinica_id FROM paciente WHERE keycloak_user_id = request.user.sub`
- Colores vía CSS vars o Tailwind design tokens — nunca hex hardcodeado
- Nunca DELETE físico — soft-delete con `activo = false`
- Gráficas solo SVG — sin recharts ni ninguna librería de charting externa
- Framework API: **Fastify** — nunca Express
- Nunca `to_char()` en campos TIMESTAMPTZ que vayan a JSON — devolver el valor crudo del driver
- Todo `ORDER BY fecha` o `ORDER BY created_at` que decida cuál registro es el primero o el último incluye `id` como tiebreaker explícito
- `ORDER BY` sobre enums usa `CASE WHEN` — nunca sobre el nombre textual del valor

---

## Paso 0 — Verificar prerequisitos y número de migración

```sql
-- 1. Confirmar que configuracion_paciente existe (r24 ya ejecutado)
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('configuracion_paciente', 'recurso_pac');
```

Si alguna falta, detener y avisar: "Ejecuta r24 primero."

```sql
-- 2. Obtener el número de la última migración ejecutada
SELECT migration_name
FROM schema_migrations
ORDER BY migration_name DESC
LIMIT 1;
```

Usar el número siguiente como prefijo para los archivos de esta rebanada. En los pasos siguientes se escribe `0NN` — sustituir por el número real.

---

## Paso 1 — Migration: extender configuracion_paciente

Crear `apps/api/src/db/migrations/0NN_perfil_paciente.sql`:

```sql
-- Añadir columnas de personalización a la tabla ya existente
ALTER TABLE configuracion_paciente
  ADD COLUMN IF NOT EXISTS fondo           TEXT        NOT NULL DEFAULT 'neutro'
    CHECK (fondo IN ('neutro','verde','azul','morado','salmon','cafe','noche')),
  ADD COLUMN IF NOT EXISTS foto_url        TEXT,
  ADD COLUMN IF NOT EXISTS nombre_preferido TEXT
    CHECK (nombre_preferido IS NULL OR char_length(nombre_preferido) BETWEEN 1 AND 50);

COMMENT ON COLUMN configuracion_paciente.fondo
  IS 'Clave del tema visual de la app del paciente';
COMMENT ON COLUMN configuracion_paciente.foto_url
  IS 'URL externa de la foto de perfil; NULL = usar iniciales';
COMMENT ON COLUMN configuracion_paciente.nombre_preferido
  IS 'Nombre que el paciente quiere ver en la app; NULL = usar paciente.nombre';
```

Ejecutar la migración mediante el runner existente (el `IF NOT EXISTS` la hace idempotente).

---

## Paso 2 — API: extender el endpoint de configuración

Editar `apps/api/src/paciente/alimentos.ts` (o el archivo donde viven las rutas de configuración del paciente):

### 2a — GET /api/paciente/configuracion (ampliar respuesta)

Incluir los tres campos nuevos en el SELECT:

```typescript
// Cambiar la query existente de configuracion_paciente para incluir:
`SELECT p.id AS paciente_id, p.clinica_id, p.nombre,
        COALESCE(c.modo_diario,      'simple')  AS modo_diario,
        COALESCE(c.fondo,            'neutro')  AS fondo,
        c.foto_url,
        COALESCE(c.nombre_preferido, p.nombre)  AS nombre_preferido
 FROM paciente p
 LEFT JOIN configuracion_paciente c
        ON c.paciente_id = p.id AND c.clinica_id = p.clinica_id
 WHERE p.keycloak_user_id = $1`
```

### 2b — PATCH /api/paciente/configuracion (aceptar fondo)

Ampliar la validación del body para aceptar `fondo` junto a `modo_diario`:

```typescript
const FONDOS_VALIDOS = ['neutro','verde','azul','morado','salmon','cafe','noche'] as const
type FondoKey = typeof FONDOS_VALIDOS[number]

app.patch('/api/paciente/configuracion', { onRequest: [app.authenticate] }, async (req, reply) => {
  const sub = (req as any).user.sub
  const body = req.body as { modo_diario?: 'simple' | 'detallado'; fondo?: FondoKey }

  if (body.modo_diario && !['simple', 'detallado'].includes(body.modo_diario))
    return reply.code(400).send({ error: 'modo_diario inválido' })
  if (body.fondo && !FONDOS_VALIDOS.includes(body.fondo))
    return reply.code(400).send({ error: 'fondo inválido' })
  if (!body.modo_diario && !body.fondo)
    return reply.code(400).send({ error: 'Sin campos para actualizar' })

  const { rows } = await pool.query(
    `SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1`, [sub]
  )
  if (!rows.length) return reply.code(404).send({ error: 'Paciente no encontrado' })
  const { id: pacienteId, clinica_id: clinicaId } = rows[0]

  // Construir SET dinámico solo con los campos enviados
  const campos: string[] = []
  const valores: unknown[] = [pacienteId, clinicaId]
  if (body.modo_diario) { campos.push(`modo_diario = $${valores.length + 1}`); valores.push(body.modo_diario) }
  if (body.fondo)        { campos.push(`fondo = $${valores.length + 1}`);       valores.push(body.fondo) }
  campos.push('updated_at = now()')

  await pool.query(
    `INSERT INTO configuracion_paciente (paciente_id, clinica_id, modo_diario, fondo, updated_at)
     VALUES ($1, $2, COALESCE($3, 'simple'), COALESCE($4, 'neutro'), now())
     ON CONFLICT (paciente_id, clinica_id) DO UPDATE
       SET ${campos.join(', ')}`,
    valores
  )
  return { ok: true }
})
```

### 2c — PATCH /api/paciente/perfil (foto_url + nombre_preferido)

Añadir la ruta en el mismo archivo:

```typescript
// GET /api/paciente/perfil  →  ya cubierto por GET /api/paciente/configuracion (devuelve nombre y foto_url)

// PATCH /api/paciente/perfil
app.patch('/api/paciente/perfil', { onRequest: [app.authenticate] }, async (req, reply) => {
  const sub = (req as any).user.sub
  const { foto_url, nombre_preferido } =
    req.body as { foto_url?: string | null; nombre_preferido?: string | null }

  // Validaciones
  if (nombre_preferido !== undefined && nombre_preferido !== null) {
    const len = nombre_preferido.trim().length
    if (len < 1 || len > 50)
      return reply.code(400).send({ error: 'nombre_preferido: entre 1 y 50 caracteres' })
  }
  if (foto_url !== undefined && foto_url !== null) {
    try { new URL(foto_url) } catch {
      return reply.code(400).send({ error: 'foto_url no es una URL válida' })
    }
  }

  const { rows } = await pool.query(
    `SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1`, [sub]
  )
  if (!rows.length) return reply.code(404).send({ error: 'Paciente no encontrado' })
  const { id: pacienteId, clinica_id: clinicaId } = rows[0]

  await pool.query(
    `INSERT INTO configuracion_paciente (paciente_id, clinica_id, foto_url, nombre_preferido, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (paciente_id, clinica_id) DO UPDATE
       SET foto_url          = COALESCE(EXCLUDED.foto_url, configuracion_paciente.foto_url),
           nombre_preferido  = COALESCE(EXCLUDED.nombre_preferido, configuracion_paciente.nombre_preferido),
           updated_at        = now()`,
    [pacienteId, clinicaId, foto_url ?? null, nombre_preferido?.trim() ?? null]
  )
  return { ok: true }
})
```

> **Nota**: si el usuario envía `foto_url: null` explícitamente, quiere borrar la foto. Ajustar el UPSERT para distinguir `undefined` (no enviado) de `null` (borrar):

```typescript
// Antes del UPSERT, detectar si el campo fue enviado en el body:
const bodyRaw = req.body as Record<string, unknown>
const quitarFoto    = 'foto_url' in bodyRaw && bodyRaw.foto_url === null
const quitarNombre  = 'nombre_preferido' in bodyRaw && bodyRaw.nombre_preferido === null

await pool.query(
  `INSERT INTO configuracion_paciente (paciente_id, clinica_id, foto_url, nombre_preferido, updated_at)
   VALUES ($1, $2, $3, $4, now())
   ON CONFLICT (paciente_id, clinica_id) DO UPDATE
     SET foto_url         = CASE WHEN $5 THEN NULL
                                 WHEN $3 IS NOT NULL THEN $3
                                 ELSE configuracion_paciente.foto_url END,
         nombre_preferido = CASE WHEN $6 THEN NULL
                                 WHEN $4 IS NOT NULL THEN $4
                                 ELSE configuracion_paciente.nombre_preferido END,
         updated_at       = now()`,
  [pacienteId, clinicaId,
   foto_url   ?? null, nombre_preferido?.trim() ?? null,
   quitarFoto, quitarNombre]
)
```

---

## Paso 3 — Definición de los 7 temas (design tokens)

Los temas son objetos de configuración — no clases de CSS hardcodeadas. Crear `apps/web-patient/src/lib/temas.ts`:

```typescript
export const TEMAS = {
  neutro: {
    label:       'Natural',
    gradiente:   'from-stone-100 to-stone-200',
    acento:      'var(--color-primary)',
    preview:     '#d6d3d1',   // solo para el selector visual
  },
  verde: {
    label:       'Verde salud',
    gradiente:   'from-emerald-50 to-teal-100',
    acento:      '#059669',
    preview:     '#6ee7b7',
  },
  azul: {
    label:       'Calma',
    gradiente:   'from-sky-50 to-blue-100',
    acento:      '#0284c7',
    preview:     '#7dd3fc',
  },
  morado: {
    label:       'Bienestar',
    gradiente:   'from-violet-50 to-purple-100',
    acento:      '#7c3aed',
    preview:     '#c4b5fd',
  },
  salmon: {
    label:       'Energía',
    gradiente:   'from-rose-50 to-orange-100',
    acento:      '#e11d48',
    preview:     '#fda4af',
  },
  cafe: {
    label:       'Tierra',
    gradiente:   'from-amber-50 to-yellow-100',
    acento:      '#b45309',
    preview:     '#fcd34d',
  },
  noche: {
    label:       'Oscuro',
    gradiente:   'from-slate-800 to-slate-900',
    acento:      '#818cf8',
    preview:     '#334155',
  },
} as const

export type FondoKey = keyof typeof TEMAS
```

---

## Paso 4 — Hook usePerfil

Crear `apps/web-patient/src/hooks/usePerfil.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'
import type { FondoKey } from '../lib/temas'

export interface PerfilPaciente {
  nombre: string           // nombre real de la BD
  nombre_preferido: string // nombre_preferido ?? nombre
  foto_url: string | null
  modo_diario: 'simple' | 'detallado'
  fondo: FondoKey
}

export function usePerfil() {
  const [perfil, setPerfil] = useState<PerfilPaciente | null>(null)
  const [loading, setLoading] = useState(true)

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch('/api/paciente/configuracion')
      const d = await r.json()
      setPerfil({
        nombre:           d.nombre,
        nombre_preferido: d.nombre_preferido ?? d.nombre,
        foto_url:         d.foto_url ?? null,
        modo_diario:      d.modo_diario ?? 'simple',
        fondo:            (d.fondo as FondoKey) ?? 'neutro',
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  return { perfil, loading, refrescar: cargar }
}
```

---

## Paso 5 — Componente Avatar

Crear `apps/web-patient/src/components/Avatar.tsx`:

```tsx
import { TEMAS } from '../lib/temas'
import type { FondoKey } from '../lib/temas'

interface Props {
  nombre: string
  fotoUrl?: string | null
  fondo?: FondoKey
  size?: 'sm' | 'md' | 'lg'
}

const SIZES = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-20 w-20 text-xl',
}

export function Avatar({ nombre, fotoUrl, fondo = 'neutro', size = 'md' }: Props) {
  const iniciales = nombre
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0].toUpperCase())
    .join('')

  if (fotoUrl) {
    return (
      <img
        src={fotoUrl}
        alt={nombre}
        className={`${SIZES[size]} rounded-full object-cover ring-2 ring-white/60`}
        onError={e => {
          // Si la URL falla, caer a iniciales eliminando el src
          e.currentTarget.style.display = 'none'
          const siguiente = e.currentTarget.nextElementSibling as HTMLElement | null
          if (siguiente) siguiente.style.display = 'flex'
        }}
      />
    )
  }

  return (
    <div
      className={`${SIZES[size]} rounded-full flex items-center justify-center
                  font-semibold text-white ring-2 ring-white/60`}
      style={{ backgroundColor: TEMAS[fondo].acento }}
      aria-label={nombre}
    >
      {iniciales}
    </div>
  )
}
```

---

## Paso 6 — Página PerfilPage

Crear `apps/web-patient/src/pages/PerfilPage.tsx`:

```tsx
import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePerfil } from '../hooks/usePerfil'
import { Avatar } from '../components/Avatar'
import { TEMAS } from '../lib/temas'
import type { FondoKey } from '../lib/temas'
import { apiFetch } from '../lib/api'

export default function PerfilPage() {
  const navigate = useNavigate()
  const { perfil, loading, refrescar } = usePerfil()

  const [nombreEdit,   setNombreEdit]   = useState('')
  const [fotoEdit,     setFotoEdit]     = useState('')
  const [editandoNombre, setEditandoNombre] = useState(false)
  const [editandoFoto,   setEditandoFoto]   = useState(false)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  if (loading || !perfil) return (
    <div className="flex items-center justify-center min-h-screen">
      <span className="text-sm text-[var(--color-text-muted)]">Cargando…</span>
    </div>
  )

  const guardarPerfil = async (patch: { nombre_preferido?: string; foto_url?: string | null }) => {
    setSaving(true); setError('')
    try {
      const r = await apiFetch('/api/paciente/perfil', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      if (!r.ok) throw new Error()
      await refrescar()
      setEditandoNombre(false)
      setEditandoFoto(false)
    } catch {
      setError('Error al guardar. Intenta de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  const cambiarFondo = async (fondo: FondoKey) => {
    await apiFetch('/api/paciente/configuracion', {
      method: 'PATCH',
      body: JSON.stringify({ fondo }),
    })
    await refrescar()
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-24">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <button
          onClick={() => navigate(-1)}
          className="rounded-full p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-alt)]"
          aria-label="Volver"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M13 4L7 10l6 6" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <h1 className="text-base font-semibold text-[var(--color-text)]">Mi perfil</h1>
      </header>

      <div className="space-y-6 px-4 py-5">

        {/* Foto de perfil */}
        <section className="flex flex-col items-center gap-3">
          <Avatar
            nombre={perfil.nombre_preferido}
            fotoUrl={perfil.foto_url}
            fondo={perfil.fondo}
            size="lg"
          />

          {!editandoFoto ? (
            <button
              onClick={() => { setFotoEdit(perfil.foto_url ?? ''); setEditandoFoto(true) }}
              className="text-sm text-[var(--color-primary)] underline"
            >
              {perfil.foto_url ? 'Cambiar foto' : 'Añadir foto de perfil'}
            </button>
          ) : (
            <div className="w-full space-y-2">
              <input
                type="url"
                value={fotoEdit}
                onChange={e => setFotoEdit(e.target.value)}
                placeholder="https://…"
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-alt)]
                           px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => guardarPerfil({ foto_url: fotoEdit.trim() || null })}
                  disabled={saving}
                  className="flex-1 rounded-lg bg-[var(--color-primary)] py-2 text-sm
                             font-medium text-white disabled:opacity-60"
                >
                  Guardar
                </button>
                {perfil.foto_url && (
                  <button
                    onClick={() => guardarPerfil({ foto_url: null })}
                    disabled={saving}
                    className="rounded-lg border border-[var(--color-danger)] px-3 py-2
                               text-sm text-[var(--color-danger)] disabled:opacity-60"
                  >
                    Quitar
                  </button>
                )}
                <button
                  onClick={() => setEditandoFoto(false)}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-2
                             text-sm text-[var(--color-text-muted)]"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Nombre preferido */}
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Nombre en la app
          </h2>
          {!editandoNombre ? (
            <div className="flex items-center justify-between rounded-xl border border-[var(--color-border)]
                            bg-[var(--color-bg-alt)] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">{perfil.nombre_preferido}</p>
                {perfil.nombre_preferido !== perfil.nombre && (
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Nombre real: {perfil.nombre}
                  </p>
                )}
              </div>
              <button
                onClick={() => { setNombreEdit(perfil.nombre_preferido); setEditandoNombre(true) }}
                className="text-sm text-[var(--color-primary)] underline"
              >
                Editar
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="text"
                value={nombreEdit}
                onChange={e => setNombreEdit(e.target.value)}
                maxLength={50}
                placeholder={perfil.nombre}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-alt)]
                           px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => guardarPerfil({ nombre_preferido: nombreEdit.trim() || perfil.nombre })}
                  disabled={saving || !nombreEdit.trim()}
                  className="flex-1 rounded-lg bg-[var(--color-primary)] py-2 text-sm
                             font-medium text-white disabled:opacity-60"
                >
                  Guardar
                </button>
                <button
                  onClick={() => setEditandoNombre(false)}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-2
                             text-sm text-[var(--color-text-muted)]"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Selector de fondo */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Tema de la app
          </h2>
          <div className="grid grid-cols-4 gap-3">
            {(Object.entries(TEMAS) as [FondoKey, typeof TEMAS[FondoKey]][]).map(([key, tema]) => (
              <button
                key={key}
                onClick={() => cambiarFondo(key)}
                className="flex flex-col items-center gap-1.5"
                aria-label={tema.label}
                aria-pressed={perfil.fondo === key}
              >
                {/* Círculo de color */}
                <div
                  className={`h-12 w-12 rounded-full ring-2 transition-all
                              ${perfil.fondo === key
                                ? 'ring-[var(--color-primary)] ring-offset-2'
                                : 'ring-transparent'}`}
                  style={{ backgroundColor: tema.preview }}
                />
                <span className={`text-[10px] font-medium
                                  ${perfil.fondo === key
                                    ? 'text-[var(--color-primary)]'
                                    : 'text-[var(--color-text-muted)]'}`}>
                  {tema.label}
                </span>
              </button>
            ))}
          </div>

          {/* Preview del tema seleccionado */}
          <div className={`rounded-xl bg-gradient-to-br ${TEMAS[perfil.fondo].gradiente}
                           p-4 flex items-center gap-3`}>
            <Avatar nombre={perfil.nombre_preferido} fotoUrl={perfil.foto_url} fondo={perfil.fondo} size="md"/>
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">
                Hola, {perfil.nombre_preferido.split(' ')[0]}
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">Así se verá tu inicio</p>
            </div>
          </div>
        </section>

        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
      </div>
    </div>
  )
}
```

---

## Paso 7 — Aplicar el fondo en InicioPage

En `apps/web-patient/src/pages/InicioPage.tsx` (o como se llame el Inicio / Home del paciente):

1. Importar el hook y temas:
```typescript
import { usePerfil } from '../hooks/usePerfil'
import { TEMAS } from '../lib/temas'
import { Avatar } from '../components/Avatar'
```

2. Usar el hook:
```typescript
const { perfil } = usePerfil()
const tema = perfil ? TEMAS[perfil.fondo] : TEMAS.neutro
```

3. Aplicar el gradiente a la sección hero (el bloque de bienvenida en la parte superior):
```tsx
{/* Hero / bienvenida */}
<div className={`bg-gradient-to-br ${tema.gradiente} px-4 pt-5 pb-6`}>
  <div className="flex items-center gap-3">
    {perfil && (
      <Avatar
        nombre={perfil.nombre_preferido}
        fotoUrl={perfil.foto_url}
        fondo={perfil.fondo}
        size="md"
      />
    )}
    <div>
      <p className="text-xs text-[var(--color-text-muted)]">
        {saludoSegunHora()}  {/* 'Buenos días' / 'Buenas tardes' / 'Buenas noches' */}
      </p>
      <p className="text-base font-semibold text-[var(--color-text)]">
        {perfil?.nombre_preferido.split(' ')[0] ?? '…'}
      </p>
    </div>
  </div>
</div>
```

4. Añadir la función helper `saludoSegunHora` en el mismo archivo:
```typescript
function saludoSegunHora(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}
```

5. El avatar en el header (si hay un `<header>` fijo con el nombre/avatar del usuario) también debe usar `<Avatar>` en lugar del placeholder o las iniciales en texto plano.

---

## Paso 8 — Ruta y acceso a PerfilPage

### 8a — Router

En `apps/web-patient/src/App.tsx`:

```tsx
import PerfilPage from './pages/PerfilPage'
// ...
<Route path="/perfil" element={<PerfilPage />} />
```

### 8b — Punto de acceso desde el header

El header fijo de la app del paciente (normalmente en la parte superior de cada página) ya muestra el nombre o un avatar. Convertir ese elemento en un enlace a `/perfil`:

```tsx
// En el componente de header/layout del paciente
import { Link } from 'react-router-dom'
import { Avatar } from './Avatar'
import { usePerfil } from '../hooks/usePerfil'

// Dentro del componente:
const { perfil } = usePerfil()
// ...
<Link to="/perfil" aria-label="Mi perfil">
  <Avatar
    nombre={perfil?.nombre_preferido ?? '?'}
    fotoUrl={perfil?.foto_url}
    fondo={perfil?.fondo ?? 'neutro'}
    size="sm"
  />
</Link>
```

> Si el header del paciente no existe aún como componente propio, crearlo como `apps/web-patient/src/components/HeaderPaciente.tsx` y usarlo en todas las páginas que lo necesiten.

---

## Paso 9 — Verificación

```bash
# 1. Verificar la migración
psql $DATABASE_URL -c "
  SELECT column_name, data_type, column_default
  FROM information_schema.columns
  WHERE table_name = 'configuracion_paciente'
  ORDER BY ordinal_position;"

# 2. Verificar endpoints
curl -X GET -H "Authorization: Bearer $PATIENT_TOKEN" \
  http://localhost:4001/api/paciente/configuracion
# Debe incluir: fondo, foto_url, nombre_preferido

curl -X PATCH \
  -H "Authorization: Bearer $PATIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fondo":"verde"}' \
  http://localhost:4001/api/paciente/configuracion
# Debe responder: {"ok":true}

curl -X GET -H "Authorization: Bearer $PATIENT_TOKEN" \
  http://localhost:4001/api/paciente/configuracion
# fondo debe ser "verde"

curl -X PATCH \
  -H "Authorization: Bearer $PATIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fondo":"invalido"}' \
  http://localhost:4001/api/paciente/configuracion
# Debe responder 400: {"error":"fondo inválido"}

curl -X PATCH \
  -H "Authorization: Bearer $PATIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nombre_preferido":"Ana"}' \
  http://localhost:4001/api/paciente/perfil
# Debe responder: {"ok":true}

# 3. TypeScript sin errores
cd apps/api && npx tsc --noEmit
cd apps/web-patient && npx tsc --noEmit

# 4. Compilación del frontend
cd apps/web-patient && npm run build 2>&1 | tail -5
```

Si algún `tsc --noEmit` falla, corregir antes de dar por finalizado. Si la migración ya fue aplicada (columna existente), el `IF NOT EXISTS` lo hace inocuo.

---

## Resumen de cambios

| Capa | Archivo | Cambio |
|------|---------|--------|
| Migración | `0NN_perfil_paciente.sql` | 3 columnas nuevas en `configuracion_paciente`: `fondo`, `foto_url`, `nombre_preferido` |
| API | `src/paciente/alimentos.ts` (o equiv.) | `GET /api/paciente/configuracion` devuelve los 3 campos nuevos |
| API | ídem | `PATCH /api/paciente/configuracion` acepta `fondo` |
| API | ídem | `PATCH /api/paciente/perfil` actualiza `foto_url` y `nombre_preferido` |
| PWA | `src/lib/temas.ts` | 7 temas: neutro, verde, azul, morado, salmon, cafe, noche |
| PWA | `src/hooks/usePerfil.ts` | Carga y expone perfil completo del paciente |
| PWA | `src/components/Avatar.tsx` | Avatar con foto o iniciales sobre color del tema |
| PWA | `src/pages/PerfilPage.tsx` | Editar nombre, foto y tema visual |
| PWA | `src/pages/InicioPage.tsx` | Hero con gradiente del tema + avatar del paciente |
| PWA | `src/components/HeaderPaciente.tsx` | Avatar en header que navega a `/perfil` |
| PWA | `src/App.tsx` | Ruta `/perfil` |
