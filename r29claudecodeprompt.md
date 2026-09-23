# r29-claudecode-prompt.md
# NutriSmart — Rebanada 29
# GAM-03: Dashboard administrativo + Exportación de datos

## Contexto de continuidad

SaaS multi-tenant de nutrición clínica. Monorepo: `apps/api` (Fastify),
`apps/web-professional` (Vite + React, puerto 5173), `apps/web-patient` (Vite + React, puerto 5175).

**Reglas permanentes:**

1. Framework del servidor: **Fastify** (nunca Express).
2. Multi-tenancy profesional: `request.auth.tenantId` → `clinica_id`.
3. Borrado suave únicamente: `activo = false`. Nunca `DELETE` físico.
4. Gráficas: **SVG puro**. Cero librerías de charting externas.
5. Colores: **CSS vars / tokens Tailwind**. Nunca hex en línea en JSX.
6. `TIMESTAMPTZ` → JSON: valor crudo del driver `pg`. Nunca `to_char(…OF)`.
7. `ORDER BY` en fechas: añadir siempre `id` como desempate (`ORDER BY fecha DESC, id DESC`).
8. `ORDER BY` en enums: **CASE WHEN**, nunca por valor de texto.
9. Columna nombre del paciente: **`paciente.nombre`**.
10. Antes de migración: `SELECT migration_name FROM schema_migrations ORDER BY migration_name DESC LIMIT 1`.
11. La tabla `cita` usa el enum `cita_estado`; estado `completada` (no `realizada`), `no_asistio`.
12. El middleware `requireAdmin` y el hook `useYo` vienen de la Rebanada 28.

---

## Sin migraciones nuevas

Esta rebanada no agrega tablas ni columnas. Toda la información proviene de
tablas ya existentes: `clinica`, `profesional`, `paciente`, `cita`, `registro_comida`,
`registro_metrica`, `registro_bienestar`.

---

## Backend — apps/api

### apps/api/src/admin/estadisticas.ts

Todas las consultas corren en paralelo (`Promise.all`).
La serie semanal y la mensual se generan con `generate_series` para garantizar
que los periodos sin datos aparecen como 0 (no como filas faltantes).

```typescript
import type { FastifyInstance } from 'fastify'
import { pool } from '../db'
import { requireAdmin } from '../middleware/requireAdmin'

export async function adminEstadisticasRoutes(fastify: FastifyInstance) {
  // GET /api/admin/estadisticas
  fastify.get(
    '/api/admin/estadisticas',
    { preHandler: [requireAdmin] },
    async (request) => {
      const cid = request.auth.tenantId

      const [
        pacientes,
        citas,
        adherencia,
        porSemana,
        porMes,
        porProfesional,
      ] = await Promise.all([

        // ── Pacientes ──────────────────────────────────────────────────────
        pool.query<{
          total: number
          activos: number
          nuevos_este_mes: number
        }>(
          `SELECT
             COUNT(*)::int                                          AS total,
             COUNT(*) FILTER (WHERE activo = true)::int            AS activos,
             COUNT(*) FILTER (
               WHERE activo = true
                 AND created_at >= date_trunc('month', now())
             )::int                                                AS nuevos_este_mes
           FROM paciente
           WHERE clinica_id = $1`,
          [cid]
        ),

        // ── Citas ──────────────────────────────────────────────────────────
        pool.query<{
          esta_semana:      number
          este_mes:         number
          completadas_mes:  number
          no_asistio_mes:   number
        }>(
          `SELECT
             COUNT(*) FILTER (
               WHERE fecha >= date_trunc('week', CURRENT_DATE)
             )::int                                AS esta_semana,
             COUNT(*) FILTER (
               WHERE fecha >= date_trunc('month', CURRENT_DATE)
             )::int                                AS este_mes,
             COUNT(*) FILTER (
               WHERE fecha >= date_trunc('month', CURRENT_DATE)
                 AND estado = 'completada'
             )::int                                AS completadas_mes,
             COUNT(*) FILTER (
               WHERE fecha >= date_trunc('month', CURRENT_DATE)
                 AND estado = 'no_asistio'
             )::int                                AS no_asistio_mes
           FROM cita
           WHERE clinica_id = $1`,
          [cid]
        ),

        // ── Adherencia al diario (últimos 7 días) ──────────────────────────
        // % de días con al menos un registro entre todos los pacientes activos
        pool.query<{ pct: number }>(
          `WITH dias_esperados AS (
             SELECT COUNT(*) * 7 AS total
             FROM paciente
             WHERE clinica_id = $1 AND activo = true
           ),
           dias_registrados AS (
             SELECT COUNT(DISTINCT (paciente_id, fecha)) AS total
             FROM registro_comida
             WHERE clinica_id = $1
               AND fecha >= CURRENT_DATE - 6
               AND activo   = true
           )
           SELECT
             ROUND(
               100.0 * dr.total::numeric /
               GREATEST(de.total, 1)
             , 1) AS pct
           FROM dias_esperados de, dias_registrados dr`,
          [cid]
        ),

        // ── Citas por semana — últimas 8 semanas ───────────────────────────
        pool.query<{ label: string; value: number }>(
          `WITH semanas AS (
             SELECT generate_series(
               date_trunc('week', CURRENT_DATE) - INTERVAL '7 weeks',
               date_trunc('week', CURRENT_DATE),
               '1 week'::interval
             ) AS semana
           ),
           por_semana AS (
             SELECT date_trunc('week', fecha) AS semana, COUNT(*)::int AS total
             FROM cita
             WHERE clinica_id = $1
               AND fecha >= CURRENT_DATE - INTERVAL '8 weeks'
               AND estado   != 'cancelada'
             GROUP BY 1
           )
           SELECT
             to_char(s.semana, 'DD Mon') AS label,
             COALESCE(p.total, 0)        AS value
           FROM semanas s
           LEFT JOIN por_semana p ON p.semana = s.semana
           ORDER BY s.semana`,
          [cid]
        ),

        // ── Nuevos pacientes por mes — últimos 6 meses ────────────────────
        pool.query<{ label: string; value: number }>(
          `WITH meses AS (
             SELECT generate_series(
               date_trunc('month', CURRENT_DATE) - INTERVAL '5 months',
               date_trunc('month', CURRENT_DATE),
               '1 month'::interval
             ) AS mes
           ),
           por_mes AS (
             SELECT date_trunc('month', created_at) AS mes, COUNT(*)::int AS total
             FROM paciente
             WHERE clinica_id = $1
               AND created_at >= CURRENT_DATE - INTERVAL '6 months'
             GROUP BY 1
           )
           SELECT
             to_char(m.mes, 'Mon YY') AS label,
             COALESCE(p.total, 0)     AS value
           FROM meses m
           LEFT JOIN por_mes p ON p.mes = m.mes
           ORDER BY m.mes`,
          [cid]
        ),

        // ── Resumen por profesional ────────────────────────────────────────
        pool.query<{
          id:              string
          nombre:          string
          rol:             string
          pacientes:       number
          citas_mes:       number
          completadas_mes: number
        }>(
          `SELECT
             p.id,
             p.nombre,
             p.rol,
             COUNT(DISTINCT c_all.paciente_id)::int                  AS pacientes,
             COUNT(c_mes.id)::int                                     AS citas_mes,
             COUNT(c_mes.id) FILTER (
               WHERE c_mes.estado = 'completada'
             )::int                                                   AS completadas_mes
           FROM profesional p
           LEFT JOIN cita c_all ON c_all.profesional_id = p.id
                                AND c_all.clinica_id    = $1
                                AND c_all.estado        = 'completada'
           LEFT JOIN cita c_mes ON c_mes.profesional_id = p.id
                                AND c_mes.clinica_id    = $1
                                AND c_mes.fecha >= date_trunc('month', CURRENT_DATE)
           WHERE p.clinica_id = $1 AND p.estado = 'activo'
           GROUP BY p.id, p.nombre, p.rol
           ORDER BY
             CASE p.rol WHEN 'admin_clinica' THEN 0 ELSE 1 END,
             p.nombre`,
          [cid]
        ),
      ])

      const c     = citas.rows[0]
      const citasMes = c.completadas_mes + c.no_asistio_mes
      const tasaAsistencia = citasMes > 0
        ? Math.round(100 * c.completadas_mes / citasMes)
        : null

      return {
        pacientes: pacientes.rows[0],
        citas: {
          esta_semana:         c.esta_semana,
          este_mes:            c.este_mes,
          completadas_mes:     c.completadas_mes,
          tasa_asistencia_pct: tasaAsistencia,
        },
        adherencia_diario_pct: adherencia.rows[0]?.pct ?? 0,
        por_semana:     porSemana.rows,
        por_mes:        porMes.rows,
        por_profesional: porProfesional.rows,
      }
    }
  )
}
```

### apps/api/src/admin/exportar.ts

Usa una función helper `toCSV` interna — sin dependencias externas.

```typescript
import type { FastifyInstance } from 'fastify'
import { pool } from '../db'
import { requireAdmin } from '../middleware/requireAdmin'

export async function adminExportarRoutes(fastify: FastifyInstance) {
  // GET /api/admin/exportar/pacientes
  fastify.get(
    '/api/admin/exportar/pacientes',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { rows } = await pool.query(
        `SELECT
           p.nombre,
           p.correo,
           CASE p.sexo
             WHEN 'M' THEN 'Masculino'
             WHEN 'F' THEN 'Femenino'
             ELSE      p.sexo
           END                                                         AS sexo,
           to_char(p.fecha_nacimiento, 'YYYY-MM-DD')                   AS fecha_nacimiento,
           prof.nombre                                                  AS profesional,
           (SELECT to_char(MAX(c.fecha), 'YYYY-MM-DD')
            FROM cita c
            WHERE c.paciente_id  = p.id
              AND c.estado       = 'completada')                        AS ultima_cita,
           (SELECT COUNT(*)
            FROM cita c2
            WHERE c2.paciente_id = p.id
              AND c2.estado      = 'completada')::int                   AS total_citas,
           (SELECT rm.valor
            FROM registro_metrica rm
            WHERE rm.paciente_id = p.id AND rm.tipo = 'peso'
            ORDER BY rm.medido_en ASC, rm.id ASC
            LIMIT 1)                                                    AS peso_inicial_kg,
           (SELECT rm2.valor
            FROM registro_metrica rm2
            WHERE rm2.paciente_id = p.id AND rm2.tipo = 'peso'
            ORDER BY rm2.medido_en DESC, rm2.id DESC
            LIMIT 1)                                                    AS peso_actual_kg,
           CASE WHEN p.activo THEN 'Activo' ELSE 'Inactivo' END        AS estado
         FROM paciente p
         LEFT JOIN profesional prof ON prof.id = p.nutricionista_id
         WHERE p.clinica_id = $1
         ORDER BY p.nombre`,
        [request.auth.tenantId]
      )

      const csv = toCSV(rows, [
        'nombre', 'correo', 'sexo', 'fecha_nacimiento', 'profesional',
        'ultima_cita', 'total_citas',
        'peso_inicial_kg', 'peso_actual_kg', 'estado',
      ])

      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="pacientes.csv"')
      return reply.send('﻿' + csv)  // BOM para Excel
    }
  )

  // GET /api/admin/exportar/citas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
  fastify.get(
    '/api/admin/exportar/citas',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const query = request.query as { desde?: string; hasta?: string }
      const desde = query.desde ?? new Date(Date.now() - 30 * 86400_000)
                                       .toISOString().slice(0, 10)
      const hasta = query.hasta ?? new Date().toISOString().slice(0, 10)

      const { rows } = await pool.query(
        `SELECT
           to_char(c.fecha, 'YYYY-MM-DD')                 AS fecha,
           c.hora_inicio                                   AS hora,
           pac.nombre                                      AS paciente,
           prof.nombre                                     AS profesional,
           c.tipo,
           c.duracion_min,
           c.estado
         FROM cita c
         JOIN paciente    pac  ON pac.id  = c.paciente_id
         JOIN profesional prof ON prof.id = c.profesional_id
         WHERE c.clinica_id = $1
           AND c.fecha BETWEEN $2 AND $3
         ORDER BY c.fecha DESC, c.hora_inicio DESC`,
        [request.auth.tenantId, desde, hasta]
      )

      const csv = toCSV(rows, [
        'fecha', 'hora', 'paciente', 'profesional',
        'tipo', 'duracion_min', 'estado',
      ])

      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="citas.csv"')
      return reply.send('﻿' + csv)
    }
  )
}

// ── Helper CSV ─────────────────────────────────────────────────────────────

function toCSV(rows: Record<string, unknown>[], headers: string[]): string {
  const escape = (v: unknown): string => {
    if (v == null) return ''
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  return [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
  ].join('\r\n')
}
```

### Registro en apps/api/src/server.ts

```typescript
import { adminEstadisticasRoutes } from './admin/estadisticas'
import { adminExportarRoutes }     from './admin/exportar'

await fastify.register(adminEstadisticasRoutes)
await fastify.register(adminExportarRoutes)
```

---

## Frontend — apps/web-professional

### apps/web-professional/src/pages/admin/DashboardAdminPage.tsx

```tsx
import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { apiFetch } from '../../lib/api'

// ── Tipos ──────────────────────────────────────────────────────────────────

interface Estadisticas {
  pacientes: {
    total:           number
    activos:         number
    nuevos_este_mes: number
  }
  citas: {
    esta_semana:         number
    este_mes:            number
    completadas_mes:     number
    tasa_asistencia_pct: number | null
  }
  adherencia_diario_pct: number
  por_semana: { label: string; value: number }[]
  por_mes:    { label: string; value: number }[]
  por_profesional: {
    id:              string
    nombre:          string
    rol:             string
    pacientes:       number
    citas_mes:       number
    completadas_mes: number
  }[]
}

// ── Componente principal ───────────────────────────────────────────────────

export default function DashboardAdminPage() {
  const [stats,    setStats]    = useState<Estadisticas | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    apiFetch('/api/admin/estadisticas')
      .then(r => r.json())
      .then(setStats)
      .finally(() => setCargando(false))
  }, [])

  if (cargando) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="text-sm text-[var(--color-muted)]">Cargando estadísticas…</span>
      </div>
    )
  }
  if (!stats) return null

  const { pacientes, citas, adherencia_diario_pct, por_semana, por_mes, por_profesional } = stats

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Dashboard administrativo</h1>
        <BotonesExportar />
      </div>

      {/* Tarjetas de resumen */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          titulo="Pacientes activos"
          valor={pacientes.activos}
          subtitulo={`+${pacientes.nuevos_este_mes} este mes`}
          color="var(--color-primary)"
        />
        <StatCard
          titulo="Citas esta semana"
          valor={citas.esta_semana}
          subtitulo={`${citas.este_mes} este mes`}
          color="var(--color-primary)"
        />
        <StatCard
          titulo="Asistencia (mes)"
          valor={citas.tasa_asistencia_pct != null ? `${citas.tasa_asistencia_pct}%` : '—'}
          subtitulo={`${citas.completadas_mes} completadas`}
          color={
            citas.tasa_asistencia_pct != null && citas.tasa_asistencia_pct >= 80
              ? 'var(--color-success)'
              : 'var(--color-accent)'
          }
        />
        <StatCard
          titulo="Adherencia diario"
          valor={`${adherencia_diario_pct}%`}
          subtitulo="Últimos 7 días"
          color={
            adherencia_diario_pct >= 60
              ? 'var(--color-success)'
              : 'var(--color-danger)'
          }
        />
      </div>

      {/* Gráficas */}
      <div className="grid gap-6 lg:grid-cols-2">
        <GraficaBarras
          titulo="Citas por semana"
          datos={por_semana}
          color="var(--color-primary)"
        />
        <GraficaBarras
          titulo="Nuevos pacientes por mes"
          datos={por_mes}
          color="var(--color-secondary, #0284c7)"
        />
      </div>

      {/* Tabla por profesional */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-[var(--color-text)]">
          Rendimiento por profesional
        </h2>
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)]
                        bg-[var(--color-surface)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                <th className="px-4 py-3 font-medium">Profesional</th>
                <th className="px-4 py-3 text-right font-medium">Pacientes</th>
                <th className="px-4 py-3 text-right font-medium">Citas (mes)</th>
                <th className="px-4 py-3 text-right font-medium">Completadas</th>
                <th className="px-4 py-3 text-right font-medium">Asistencia</th>
              </tr>
            </thead>
            <tbody>
              {por_profesional.map(p => {
                const tasa = p.citas_mes > 0
                  ? Math.round(100 * p.completadas_mes / p.citas_mes)
                  : null
                return (
                  <tr key={p.id}
                      className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--color-text)]">{p.nombre}</div>
                      <div className="text-xs text-[var(--color-muted)] capitalize">{p.rol}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--color-text)]">
                      {p.pacientes}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--color-text)]">
                      {p.citas_mes}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--color-text)]">
                      {p.completadas_mes}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {tasa != null ? (
                        <span className={
                          tasa >= 80
                            ? 'text-[var(--color-success)]'
                            : tasa >= 60
                            ? 'text-[var(--color-accent)]'
                            : 'text-[var(--color-danger)]'
                        }>
                          {tasa}%
                        </span>
                      ) : (
                        <span className="text-[var(--color-muted)]">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

// ── Subcomponentes ─────────────────────────────────────────────────────────

function StatCard({
  titulo, valor, subtitulo, color
}: {
  titulo:    string
  valor:     number | string
  subtitulo: string
  color:     string
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)]
                    bg-[var(--color-surface)] p-4">
      <p className="text-xs font-medium text-[var(--color-muted)] mb-1">{titulo}</p>
      <p className="text-3xl font-bold" style={{ color }}>{valor}</p>
      <p className="text-xs text-[var(--color-muted)] mt-1">{subtitulo}</p>
    </div>
  )
}

// ── Gráfica de barras SVG ──────────────────────────────────────────────────

const SVG_W  = 400
const SVG_H  = 180
const PAD    = { top: 20, right: 12, bottom: 30, left: 36 }
const CHART_W = SVG_W - PAD.left - PAD.right
const CHART_H = SVG_H - PAD.top  - PAD.bottom

function GraficaBarras({
  titulo, datos, color
}: {
  titulo: string
  datos:  { label: string; value: number }[]
  color:  string
}) {
  if (!datos.length) return null

  const max     = Math.max(...datos.map(d => d.value), 1)
  const barStep = CHART_W / datos.length
  const barW    = barStep * 0.6

  // Tick lines del eje Y (3 niveles)
  const ticks = [0, Math.round(max / 2), max]

  return (
    <div className="rounded-xl border border-[var(--color-border)]
                    bg-[var(--color-surface)] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">{titulo}</h3>
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full"
        style={{ height: SVG_H }}
        aria-label={titulo}
      >
        {/* Grid lines y etiquetas del eje Y */}
        {ticks.map(t => {
          const y = PAD.top + CHART_H - (t / max) * CHART_H
          return (
            <g key={t}>
              <line
                x1={PAD.left} y1={y}
                x2={SVG_W - PAD.right} y2={y}
                stroke="var(--color-border)"
                strokeWidth={1}
                strokeDasharray={t === 0 ? 'none' : '3 3'}
              />
              <text
                x={PAD.left - 4} y={y + 4}
                textAnchor="end"
                fontSize={9}
                fill="var(--color-muted)"
              >
                {t}
              </text>
            </g>
          )
        })}

        {/* Barras */}
        {datos.map((d, i) => {
          const barH = Math.max((d.value / max) * CHART_H, 1)
          const x    = PAD.left + i * barStep + (barStep - barW) / 2
          const y    = PAD.top  + CHART_H - barH

          return (
            <g key={i}>
              <rect
                x={x} y={y}
                width={barW} height={barH}
                fill={color}
                rx={3}
                opacity={0.85}
              />
              {/* Valor encima de la barra (solo si hay espacio) */}
              {d.value > 0 && barH > 16 && (
                <text
                  x={x + barW / 2} y={y - 4}
                  textAnchor="middle"
                  fontSize={8}
                  fill="var(--color-text)"
                >
                  {d.value}
                </text>
              )}
              {/* Etiqueta del eje X */}
              <text
                x={x + barW / 2}
                y={SVG_H - 8}
                textAnchor="middle"
                fontSize={8}
                fill="var(--color-muted)"
              >
                {d.label}
              </text>
            </g>
          )
        })}

        {/* Eje Y */}
        <line
          x1={PAD.left} y1={PAD.top}
          x2={PAD.left} y2={PAD.top + CHART_H}
          stroke="var(--color-border)"
          strokeWidth={1}
        />
      </svg>
    </div>
  )
}

// ── Botones de exportación ─────────────────────────────────────────────────

function BotonesExportar() {
  function descargar(url: string, nombre: string) {
    apiFetch(url)
      .then(r => r.blob())
      .then(blob => {
        const a   = document.createElement('a')
        a.href    = URL.createObjectURL(blob)
        a.download = nombre
        a.click()
        URL.revokeObjectURL(a.href)
      })
      .catch(console.error)
  }

  // Rango por defecto: últimos 30 días
  const hasta = new Date().toISOString().slice(0, 10)
  const desde = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => descargar('/api/admin/exportar/pacientes', 'pacientes.csv')}
        className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)]
                   px-3 py-1.5 text-xs font-medium text-[var(--color-text)]
                   hover:bg-[var(--color-muted)]/10"
      >
        <Download size={13} /> Pacientes CSV
      </button>
      <button
        onClick={() =>
          descargar(
            `/api/admin/exportar/citas?desde=${desde}&hasta=${hasta}`,
            `citas_${desde}_${hasta}.csv`
          )
        }
        className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)]
                   px-3 py-1.5 text-xs font-medium text-[var(--color-text)]
                   hover:bg-[var(--color-muted)]/10"
      >
        <Download size={13} /> Citas CSV (30d)
      </button>
    </div>
  )
}
```

### Router — ruta del dashboard admin

En el router de `apps/web-professional`, añade junto con las rutas de r28:

```tsx
import { RequireAdmin }    from './components/RequireAdmin'   // ya existe desde r28
import DashboardAdminPage  from './pages/admin/DashboardAdminPage'

// Dentro del bloque de rutas protegidas:
<Route path="/admin/dashboard"
  element={<RequireAdmin><DashboardAdminPage /></RequireAdmin>} />
```

La ruta `/admin` sin sufijo puede redirigir a `/admin/dashboard`:

```tsx
<Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
```

### Sidebar — enlace activo

Si el Sidebar de r28 ya tiene el ítem `"Dashboard"` apuntando a `/admin/dashboard`,
no hay cambio adicional. Verifica que el `NavItem` usa `to="/admin/dashboard"`.

---

## Lista de verificación

Antes de confirmar la rebanada como completada:

- [ ] `GET /api/admin/estadisticas` devuelve 403 si el usuario no es admin.
- [ ] `GET /api/admin/estadisticas` devuelve JSON con los campos:
      `pacientes`, `citas`, `adherencia_diario_pct`, `por_semana` (8 elementos),
      `por_mes` (6 elementos), `por_profesional`.
- [ ] `por_semana` siempre tiene exactamente 8 elementos, incluso si algunas
      semanas tienen 0 citas.
- [ ] `por_mes` siempre tiene exactamente 6 elementos.
- [ ] `GET /api/admin/exportar/pacientes` devuelve `Content-Type: text/csv`
      y el archivo empieza con BOM (`﻿`) para compatibilidad con Excel.
- [ ] `GET /api/admin/exportar/citas?desde=...&hasta=...` filtra correctamente
      por rango de fechas.
- [ ] Sin parámetros, `exportar/citas` usa los últimos 30 días como rango por defecto.
- [ ] `/admin/dashboard` renderiza las 4 tarjetas de resumen.
- [ ] Las gráficas SVG muestran barras para citas por semana y pacientes por mes.
- [ ] Los botones de descarga generan archivos CSV válidos (abrir en Excel o
      LibreOffice para verificar).
- [ ] La tasa de asistencia es `null` / `'—'` cuando no hay citas con estado
      `completada` o `no_asistio` (no debe aparecer `NaN%` ni `Infinity%`).
- [ ] La tabla de resumen por profesional calcula la tasa de asistencia individual
      correctamente; muestra `—` cuando `citas_mes = 0`.
- [ ] La navegación `/admin` redirige a `/admin/dashboard`.
- [ ] El enlace "Dashboard" en el sidebar queda marcado como activo en esta página.
