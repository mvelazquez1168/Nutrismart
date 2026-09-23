# R27 — RPM-03 Sistema de alertas configurables

## Contexto obligatorio — leer antes de tocar cualquier archivo

- Monorepo: `apps/api` (Fastify), `apps/web-patient` (Vite + React, puerto 5175), `apps/web-professional` (Vite + React, puerto 5173)
- Columnas reales: `paciente.nombre` (no `nombre_completo`), `paciente.correo`, `paciente.estado`, `clinica.nombre_comercial`
- `clinica_id` del paciente: `SELECT clinica_id FROM paciente WHERE keycloak_user_id = request.user.sub`
- `clinica_id` del profesional: `request.auth.tenantId`
- `profesional_id` del profesional: `SELECT id FROM profesional WHERE keycloak_user_id = $1 AND clinica_id = $2`
- Colores vía CSS vars o Tailwind design tokens — nunca hex hardcodeado
- Nunca DELETE físico — soft-delete con `activo = false`
- Gráficas solo SVG — sin recharts ni ninguna librería de charting externa
- Framework API: **Fastify** — nunca Express
- Nunca `to_char()` en campos TIMESTAMPTZ que vayan a JSON — devolver el valor crudo del driver de `pg`
- Todo `ORDER BY fecha` que decida cuál es el primero o el último incluye `id` como tiebreaker
- Recordatorios: usar `node-cron`; tabla de registro con `ON CONFLICT DO NOTHING` para idempotencia
- Email: Resend (`RESEND_API_KEY`); si la variable no está definida, `console.log` y continuar
- Tablas ya existentes: `registro_metrica`, `registro_bienestar`, `registro_medida_corporal`, `paciente`, `profesional`, `clinica`

---

## Paso 0 — Verificar prerequisitos y número de migración

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('registro_bienestar', 'registro_medida_corporal');
```

Si alguna falta, detener y avisar: "Ejecuta r26 primero."

```sql
SELECT migration_name FROM schema_migrations ORDER BY migration_name DESC LIMIT 1;
```

Usar el número siguiente (N) y N+1 como prefijos. En los pasos siguientes se escribe `0NN` y `0NN1`.

---

## Paso 1 — Migration 0NN: configuración de alertas

Crear `apps/api/src/db/migrations/0NN_alerta_config.sql`:

```sql
-- Tipos de condición que se pueden monitorear
CREATE TYPE alerta_metrica AS ENUM (
  'peso',             -- valor numérico
  'glucosa',          -- valor numérico
  'presion_sistolica',
  'presion_diastolica',
  'bienestar',        -- escala 1-5
  'dias_sin_diario',  -- contador de días
  'dias_sin_registro' -- días sin cualquier registro
);

CREATE TYPE alerta_operador AS ENUM (
  'mayor_que',
  'menor_que',
  'mayor_igual_que',
  'menor_igual_que'
);

-- El profesional configura umbrales por paciente y métrica
CREATE TABLE alerta_config (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      UUID            NOT NULL REFERENCES clinica(id),
  profesional_id  UUID            NOT NULL REFERENCES profesional(id),
  paciente_id     UUID            NOT NULL REFERENCES paciente(id),
  metrica         alerta_metrica  NOT NULL,
  operador        alerta_operador NOT NULL,
  umbral          NUMERIC(8,2)    NOT NULL,
  mensaje         TEXT,           -- mensaje personalizado para la alerta
  activo          BOOLEAN         NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  CONSTRAINT uq_alerta_config UNIQUE (paciente_id, metrica, operador)
  -- Una sola regla por (paciente, métrica, operador) — simplifica la gestión
);

CREATE INDEX idx_alerta_config_clinica
  ON alerta_config (clinica_id, activo)
  WHERE activo = true;

CREATE INDEX idx_alerta_config_paciente
  ON alerta_config (paciente_id)
  WHERE activo = true;
```

---

## Paso 2 — Migration 0NN1: alertas generadas

Crear `apps/api/src/db/migrations/0NN1_alerta_rpm.sql`:

```sql
CREATE TYPE alerta_estado AS ENUM ('activa', 'reconocida', 'resuelta');

CREATE TABLE alerta_rpm (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      UUID          NOT NULL REFERENCES clinica(id),
  paciente_id     UUID          NOT NULL REFERENCES paciente(id),
  profesional_id  UUID          NOT NULL REFERENCES profesional(id),
  config_id       UUID          REFERENCES alerta_config(id),
  metrica         alerta_metrica NOT NULL,
  valor_observado NUMERIC(8,2),  -- el valor que disparó la alerta
  umbral          NUMERIC(8,2),
  mensaje         TEXT          NOT NULL,
  estado          alerta_estado  NOT NULL DEFAULT 'activa',
  reconocida_en   TIMESTAMPTZ,
  resuelta_en     TIMESTAMPTZ,
  email_enviado   BOOLEAN       NOT NULL DEFAULT false,
  fecha_deteccion DATE          NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT uq_alerta_dia UNIQUE (paciente_id, metrica, fecha_deteccion)
  -- Una sola alerta por (paciente, métrica, día) — evita spam si el cron corre varias veces
);

CREATE INDEX idx_alerta_activa
  ON alerta_rpm (clinica_id, estado, created_at DESC)
  WHERE estado = 'activa';

CREATE INDEX idx_alerta_paciente
  ON alerta_rpm (paciente_id, estado);
```

---

## Paso 3 — Motor de evaluación de alertas

Crear `apps/api/src/rpm/evaluar-alertas.ts`:

```typescript
import { Pool } from 'pg'

interface ConfigAlerta {
  id: string
  clinica_id: string
  profesional_id: string
  paciente_id: string
  metrica: string
  operador: string
  umbral: number
  mensaje: string | null
}

function cumpleCondicion(valor: number, operador: string, umbral: number): boolean {
  switch (operador) {
    case 'mayor_que':       return valor >  umbral
    case 'menor_que':       return valor <  umbral
    case 'mayor_igual_que': return valor >= umbral
    case 'menor_igual_que': return valor <= umbral
    default: return false
  }
}

function mensajePredefinido(metrica: string, operador: string, umbral: number, valor: number): string {
  const etiquetas: Record<string, string> = {
    peso: 'Peso', glucosa: 'Glucosa',
    presion_sistolica: 'Presión sistólica', presion_diastolica: 'Presión diastólica',
    bienestar: 'Bienestar', dias_sin_diario: 'Días sin diario', dias_sin_registro: 'Días sin registro',
  }
  const ops: Record<string, string> = {
    mayor_que: 'superó', menor_que: 'bajó de',
    mayor_igual_que: 'alcanzó', menor_igual_que: 'está en o por debajo de',
  }
  const unidades: Record<string, string> = {
    peso: 'kg', glucosa: 'mg/dL', presion_sistolica: 'mmHg', presion_diastolica: 'mmHg',
    bienestar: '/5', dias_sin_diario: 'días', dias_sin_registro: 'días',
  }
  return `${etiquetas[metrica] ?? metrica}: el paciente ${ops[operador] ?? operador} ${umbral} ${unidades[metrica] ?? ''} (valor actual: ${valor})`
}

export async function evaluarAlertas(pool: Pool): Promise<number> {
  // 1. Obtener todas las configuraciones activas
  const { rows: configs } = await pool.query<ConfigAlerta>(
    `SELECT id, clinica_id, profesional_id, paciente_id,
            metrica, operador, umbral::float, mensaje
     FROM alerta_config
     WHERE activo = true`
  )
  if (!configs.length) return 0

  let alertasGeneradas = 0

  for (const cfg of configs) {
    let valorObservado: number | null = null

    try {
      // Obtener el valor actual según la métrica
      if (['peso', 'glucosa', 'presion_sistolica', 'presion_diastolica'].includes(cfg.metrica)) {
        const tipoSQL = cfg.metrica === 'presion_sistolica' ? 'presion_arterial'
                      : cfg.metrica === 'presion_diastolica' ? 'presion_arterial'
                      : cfg.metrica

        const campoSQL = cfg.metrica === 'presion_sistolica' ? 'sistolica'
                       : cfg.metrica === 'presion_diastolica' ? 'diastolica'
                       : 'valor'

        const { rows } = await pool.query(
          `SELECT ${campoSQL}::float AS valor
           FROM registro_metrica
           WHERE paciente_id = $1 AND clinica_id = $2 AND tipo = $3 AND activo = true
           ORDER BY fecha DESC, id DESC
           LIMIT 1`,
          [cfg.paciente_id, cfg.clinica_id, tipoSQL]
        )
        valorObservado = rows[0]?.valor ?? null

      } else if (cfg.metrica === 'bienestar') {
        const { rows } = await pool.query(
          `SELECT estado::float AS valor
           FROM registro_bienestar
           WHERE paciente_id = $1 AND clinica_id = $2 AND activo = true
           ORDER BY fecha DESC, id DESC
           LIMIT 1`,
          [cfg.paciente_id, cfg.clinica_id]
        )
        valorObservado = rows[0]?.valor ?? null

      } else if (cfg.metrica === 'dias_sin_diario') {
        const { rows } = await pool.query(
          `SELECT EXTRACT(DAY FROM now() - MAX(fecha)::timestamp)::float AS valor
           FROM registro_comida
           WHERE paciente_id = $1 AND clinica_id = $2 AND activo = true`,
          [cfg.paciente_id, cfg.clinica_id]
        )
        valorObservado = rows[0]?.valor ?? null

      } else if (cfg.metrica === 'dias_sin_registro') {
        // Días desde cualquier tipo de registro (comida, métrica o bienestar)
        const { rows } = await pool.query(
          `SELECT EXTRACT(DAY FROM now() - MAX(ultima)::timestamp)::float AS valor
           FROM (
             SELECT MAX(fecha::timestamp) AS ultima FROM registro_comida
               WHERE paciente_id = $1 AND clinica_id = $2 AND activo = true
             UNION ALL
             SELECT MAX(fecha::timestamp) FROM registro_metrica
               WHERE paciente_id = $1 AND clinica_id = $2 AND activo = true
             UNION ALL
             SELECT MAX(fecha::timestamp) FROM registro_bienestar
               WHERE paciente_id = $1 AND clinica_id = $2 AND activo = true
           ) sub`,
          [cfg.paciente_id, cfg.clinica_id]
        )
        valorObservado = rows[0]?.valor ?? null
      }

      if (valorObservado == null) continue
      if (!cumpleCondicion(valorObservado, cfg.operador, cfg.umbral)) continue

      // La condición se cumple — insertar alerta con ON CONFLICT DO NOTHING
      const mensaje = cfg.mensaje ?? mensajePredefinido(cfg.metrica, cfg.operador, cfg.umbral, valorObservado)

      const { rowCount } = await pool.query(
        `INSERT INTO alerta_rpm
           (clinica_id, paciente_id, profesional_id, config_id,
            metrica, valor_observado, umbral, mensaje, fecha_deteccion)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE)
         ON CONFLICT (paciente_id, metrica, fecha_deteccion) DO NOTHING`,
        [cfg.clinica_id, cfg.paciente_id, cfg.profesional_id, cfg.id,
         cfg.metrica, valorObservado, cfg.umbral, mensaje]
      )
      if (rowCount && rowCount > 0) alertasGeneradas++

    } catch (err) {
      console.error(`[alertas] Error evaluando config ${cfg.id}:`, err)
    }
  }

  return alertasGeneradas
}
```

---

## Paso 4 — Envío de email para alertas nuevas

Crear `apps/api/src/rpm/email-alerta.ts`:

```typescript
import { Pool } from 'pg'

export async function enviarEmailsAlertasPendientes(pool: Pool): Promise<void> {
  // Alertas activas sin email enviado
  const { rows: alertas } = await pool.query(
    `SELECT a.id, a.mensaje, a.metrica, a.valor_observado,
            p.nombre AS paciente_nombre, p.correo AS paciente_correo,
            pr.nombre AS profesional_nombre, pr.correo AS profesional_correo,
            c.nombre_comercial AS clinica_nombre
     FROM alerta_rpm a
     JOIN paciente p    ON p.id = a.paciente_id
     JOIN profesional pr ON pr.id = a.profesional_id
     JOIN clinica c      ON c.id = a.clinica_id
     WHERE a.estado = 'activa' AND a.email_enviado = false`
  )
  if (!alertas.length) return

  const resendKey = process.env.RESEND_API_KEY

  for (const alerta of alertas) {
    const subject = `[NutriSmart] Alerta de monitoreo — ${alerta.paciente_nombre}`
    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#dc2626">⚠️ Alerta de monitoreo</h2>
        <p><strong>Clínica:</strong> ${alerta.clinica_nombre}</p>
        <p><strong>Paciente:</strong> ${alerta.paciente_nombre}</p>
        <hr/>
        <p style="font-size:16px">${alerta.mensaje}</p>
        <hr/>
        <p style="font-size:12px;color:#6b7280">
          Esta alerta fue generada automáticamente por NutriSmart.
          Puedes ajustar los umbrales desde el panel de monitoreo.
        </p>
      </div>
    `

    try {
      if (resendKey) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'NutriSmart <alertas@nutrismart.app>',
            to: alerta.profesional_correo,
            subject,
            html,
          }),
        })
      } else {
        console.log('[email-alerta]', { to: alerta.profesional_correo, subject, mensaje: alerta.mensaje })
      }

      // Marcar como enviado — aunque haya fallado el email, para no reintentar infinitamente
      await pool.query(
        `UPDATE alerta_rpm SET email_enviado = true, updated_at = now() WHERE id = $1`,
        [alerta.id]
      )
    } catch (err) {
      console.error(`[email-alerta] Error enviando alerta ${alerta.id}:`, err)
    }
  }
}
```

---

## Paso 5 — Cron de evaluación de alertas

En `apps/api/src/server.ts`, registrar el cron después de que el pool esté disponible. El cron de alertas corre una vez al día a las 8:00 AM hora local (además del cron de recordatorios existente de R21):

```typescript
import cron from 'node-cron'
import { evaluarAlertas } from './rpm/evaluar-alertas.js'
import { enviarEmailsAlertasPendientes } from './rpm/email-alerta.js'

// Evaluar alertas todos los días a las 8:00 AM
cron.schedule('0 8 * * *', async () => {
  try {
    const n = await evaluarAlertas(pool)
    if (n > 0) {
      console.log(`[alertas] ${n} alertas nuevas generadas`)
      await enviarEmailsAlertasPendientes(pool)
    }
  } catch (err) {
    console.error('[alertas] Error en cron:', err)
  }
})
```

---

## Paso 6 — API profesional: gestión de configuraciones de alerta

Crear `apps/api/src/profesional/alertas.ts`:

```typescript
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { evaluarAlertas } from '../rpm/evaluar-alertas.js'
import { enviarEmailsAlertasPendientes } from '../rpm/email-alerta.js'

const METRICAS_VALIDAS = [
  'peso', 'glucosa', 'presion_sistolica', 'presion_diastolica',
  'bienestar', 'dias_sin_diario', 'dias_sin_registro',
]
const OPERADORES_VALIDOS = ['mayor_que', 'menor_que', 'mayor_igual_que', 'menor_igual_que']

export async function alertasRoutes(app: FastifyInstance, pool: Pool) {

  async function resolveProId(sub: string, clinicaId: string): Promise<string> {
    const { rows } = await pool.query(
      `SELECT id FROM profesional WHERE keycloak_user_id = $1 AND clinica_id = $2`,
      [sub, clinicaId]
    )
    if (!rows.length) throw new Error('Profesional no encontrado')
    return rows[0].id
  }

  // GET /api/profesional/alertas/config?pacienteId=
  app.get('/api/profesional/alertas/config', { onRequest: [app.authenticate] }, async (req, reply) => {
    const clinicaId = (req as any).auth.tenantId
    const { pacienteId } = req.query as { pacienteId?: string }

    const { rows } = await pool.query(
      `SELECT ac.*, p.nombre AS paciente_nombre
       FROM alerta_config ac
       JOIN paciente p ON p.id = ac.paciente_id
       WHERE ac.clinica_id = $1 AND ac.activo = true
         AND ($2::uuid IS NULL OR ac.paciente_id = $2)
       ORDER BY p.nombre, ac.metrica`,
      [clinicaId, pacienteId ?? null]
    )
    return rows
  })

  // POST /api/profesional/alertas/config
  app.post('/api/profesional/alertas/config', { onRequest: [app.authenticate] }, async (req, reply) => {
    const sub = (req as any).user.sub
    const clinicaId = (req as any).auth.tenantId
    const proId = await resolveProId(sub, clinicaId)
    const { paciente_id, metrica, operador, umbral, mensaje } =
      req.body as { paciente_id: string; metrica: string; operador: string; umbral: number; mensaje?: string }

    if (!METRICAS_VALIDAS.includes(metrica))
      return reply.code(400).send({ error: `metrica inválida. Válidas: ${METRICAS_VALIDAS.join(', ')}` })
    if (!OPERADORES_VALIDOS.includes(operador))
      return reply.code(400).send({ error: `operador inválido. Válidos: ${OPERADORES_VALIDOS.join(', ')}` })
    if (typeof umbral !== 'number' || isNaN(umbral))
      return reply.code(400).send({ error: 'umbral debe ser un número' })

    // Verificar que el paciente pertenece a la clínica
    const { rows: [pac] } = await pool.query(
      `SELECT id FROM paciente WHERE id = $1 AND clinica_id = $2`,
      [paciente_id, clinicaId]
    )
    if (!pac) return reply.code(404).send({ error: 'Paciente no encontrado en esta clínica' })

    const { rows } = await pool.query(
      `INSERT INTO alerta_config
         (clinica_id, profesional_id, paciente_id, metrica, operador, umbral, mensaje)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (paciente_id, metrica, operador) DO UPDATE
         SET umbral = EXCLUDED.umbral,
             mensaje = EXCLUDED.mensaje,
             activo = true,
             updated_at = now()
       RETURNING *`,
      [clinicaId, proId, paciente_id, metrica, operador, umbral, mensaje ?? null]
    )
    return reply.code(201).send(rows[0])
  })

  // DELETE /api/profesional/alertas/config/:id  (soft-delete)
  app.delete('/api/profesional/alertas/config/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const clinicaId = (req as any).auth.tenantId
    const { id } = req.params as { id: string }

    const { rowCount } = await pool.query(
      `UPDATE alerta_config SET activo = false, updated_at = now()
       WHERE id = $1 AND clinica_id = $2`,
      [id, clinicaId]
    )
    if (!rowCount) return reply.code(404).send({ error: 'Configuración no encontrada' })
    return reply.code(204).send()
  })

  // GET /api/profesional/alertas/activas
  app.get('/api/profesional/alertas/activas', { onRequest: [app.authenticate] }, async (req, reply) => {
    const clinicaId = (req as any).auth.tenantId

    const { rows } = await pool.query(
      `SELECT a.id, a.metrica, a.valor_observado, a.umbral, a.mensaje,
              a.estado, a.fecha_deteccion, a.created_at,
              p.id AS paciente_id, p.nombre AS paciente_nombre
       FROM alerta_rpm a
       JOIN paciente p ON p.id = a.paciente_id
       WHERE a.clinica_id = $1 AND a.estado = 'activa'
       ORDER BY a.created_at DESC`,
      [clinicaId]
    )
    return rows
  })

  // PATCH /api/profesional/alertas/:id/reconocer
  app.patch('/api/profesional/alertas/:id/reconocer', { onRequest: [app.authenticate] }, async (req, reply) => {
    const clinicaId = (req as any).auth.tenantId
    const { id } = req.params as { id: string }

    const { rows } = await pool.query(
      `UPDATE alerta_rpm
       SET estado = 'reconocida', reconocida_en = now(), updated_at = now()
       WHERE id = $1 AND clinica_id = $2 AND estado = 'activa'
       RETURNING *`,
      [id, clinicaId]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Alerta no encontrada o ya reconocida' })
    return rows[0]
  })

  // PATCH /api/profesional/alertas/:id/resolver
  app.patch('/api/profesional/alertas/:id/resolver', { onRequest: [app.authenticate] }, async (req, reply) => {
    const clinicaId = (req as any).auth.tenantId
    const { id } = req.params as { id: string }

    const { rows } = await pool.query(
      `UPDATE alerta_rpm
       SET estado = 'resuelta', resuelta_en = now(), updated_at = now()
       WHERE id = $1 AND clinica_id = $2 AND estado IN ('activa','reconocida')
       RETURNING *`,
      [id, clinicaId]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Alerta no encontrada' })
    return rows[0]
  })

  // POST /api/profesional/alertas/evaluar-ahora  (disparo manual para pruebas)
  app.post('/api/profesional/alertas/evaluar-ahora', { onRequest: [app.authenticate] }, async (req, reply) => {
    const n = await evaluarAlertas(pool)
    await enviarEmailsAlertasPendientes(pool)
    return { alertas_generadas: n }
  })
}
```

Registrar en `apps/api/src/server.ts`:

```typescript
import { alertasRoutes } from './profesional/alertas.js'
await app.register(alertasRoutes, { pool })
```

---

## Paso 7 — Actualizar endpoint RPM para incluir conteo de alertas

En `apps/api/src/profesional/rpm.ts`, añadir el conteo de alertas activas al query del panel:

```typescript
// En el GET /api/profesional/rpm/pacientes, añadir después de ultimaComida:
const { rows: conteoAlertas } = await pool.query(
  `SELECT paciente_id, COUNT(*) AS total
   FROM alerta_rpm
   WHERE clinica_id = $1 AND paciente_id = ANY($2) AND estado = 'activa'
   GROUP BY paciente_id`,
  [clinicaId, pacienteIds]
)

const alertasPorPaciente: Record<string, number> = {}
for (const a of conteoAlertas) alertasPorPaciente[a.paciente_id] = parseInt(a.total)

// Y en el map final, reemplazar alertas_activas: 0 por:
alertas_activas: alertasPorPaciente[p.id] ?? 0,
```

---

## Paso 8 — Frontend web-professional: panel de alertas activas

### 8a — AlertasBadge en el Sidebar

El ítem "Monitoreo" del Sidebar muestra el total de alertas activas de la clínica como badge:

```tsx
// En el componente Sidebar, el ítem de Monitoreo:
import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'

function useAlertasCount() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    apiFetch('/api/profesional/alertas/activas')
      .then(r => r.json())
      .then((alertas: { id: string }[]) => setCount(alertas.length))
      .catch(() => {})
    // Refrescar cada 5 minutos
    const t = setInterval(() => {
      apiFetch('/api/profesional/alertas/activas')
        .then(r => r.json())
        .then((alertas: { id: string }[]) => setCount(alertas.length))
        .catch(() => {})
    }, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [])
  return count
}

// En el sidebar item de Monitoreo:
const alertasCount = useAlertasCount()
// <ítem>
//   Monitoreo
//   {alertasCount > 0 && (
//     <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full
//                      bg-[var(--color-danger)] text-[10px] font-bold text-white">
//       {alertasCount > 9 ? '9+' : alertasCount}
//     </span>
//   )}
// </ítem>
```

### 8b — Panel de alertas activas en RPMPage

Añadir un bloque de alertas arriba de la tabla de pacientes en `RPMPage.tsx`:

```tsx
// Dentro de RPMPage, añadir estado y carga de alertas:
const [alertas, setAlertas] = useState<AlertaRPM[]>([])

useEffect(() => {
  apiFetch('/api/profesional/alertas/activas')
    .then(r => r.json())
    .then(setAlertas)
}, [])

const reconocer = async (id: string) => {
  await apiFetch(`/api/profesional/alertas/${id}/reconocer`, { method: 'PATCH' })
  setAlertas(prev => prev.filter(a => a.id !== id))
  // Refrescar el conteo en la tabla
  apiFetch('/api/profesional/rpm/pacientes').then(r => r.json()).then(setPacientes)
}

// Justo encima de la tabla de pacientes:
{alertas.length > 0 && (
  <section className="space-y-2">
    <h2 className="text-sm font-semibold text-[var(--color-danger)] flex items-center gap-2">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 1L1 14h14L8 1z" stroke="currentColor" strokeWidth="1.5"
              strokeLinejoin="round"/>
        <path d="M8 6v4M8 11.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      {alertas.length} {alertas.length === 1 ? 'alerta activa' : 'alertas activas'}
    </h2>
    <div className="space-y-2">
      {alertas.map(a => (
        <div key={a.id}
             className="flex items-start justify-between gap-3 rounded-xl
                        border border-[var(--color-danger-light)]
                        bg-[var(--color-danger-light)]/10 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--color-text)]">
              {a.paciente_nombre}
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              {a.mensaje}
            </p>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
              {new Date(a.fecha_deteccion).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
            </p>
          </div>
          <button
            onClick={() => reconocer(a.id)}
            className="flex-shrink-0 rounded-lg border border-[var(--color-border)]
                       px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)]
                       hover:bg-[var(--color-bg-alt)]"
          >
            Reconocer
          </button>
        </div>
      ))}
    </div>
  </section>
)}
```

### 8c — Modal de configuración de alertas por paciente

Crear `apps/web-professional/src/components/ModalAlertaConfig.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { apiFetch } from '../../lib/api'

interface ConfigAlerta {
  id: string
  metrica: string
  operador: string
  umbral: number
  mensaje: string | null
}

interface Props {
  pacienteId: string
  pacienteNombre: string
  onClose: () => void
}

const METRICAS = [
  { value: 'peso',              label: 'Peso (kg)',              ejemplo: '> 80' },
  { value: 'glucosa',           label: 'Glucosa (mg/dL)',        ejemplo: '> 126' },
  { value: 'presion_sistolica', label: 'Presión sistólica',      ejemplo: '> 140' },
  { value: 'presion_diastolica',label: 'Presión diastólica',     ejemplo: '> 90' },
  { value: 'bienestar',         label: 'Bienestar (1-5)',        ejemplo: '< 2' },
  { value: 'dias_sin_diario',   label: 'Días sin diario',        ejemplo: '> 3' },
  { value: 'dias_sin_registro', label: 'Días sin cualquier reg.', ejemplo: '> 7' },
]

const OPERADORES = [
  { value: 'mayor_que',       label: 'Mayor que (>)'         },
  { value: 'menor_que',       label: 'Menor que (<)'         },
  { value: 'mayor_igual_que', label: 'Mayor o igual que (≥)' },
  { value: 'menor_igual_que', label: 'Menor o igual que (≤)' },
]

export function ModalAlertaConfig({ pacienteId, pacienteNombre, onClose }: Props) {
  const [configs, setConfigs] = useState<ConfigAlerta[]>([])
  const [loading, setLoading] = useState(true)

  // Form nueva alerta
  const [metrica,  setMetrica]  = useState('peso')
  const [operador, setOperador] = useState('mayor_que')
  const [umbral,   setUmbral]   = useState('')
  const [mensaje,  setMensaje]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  const cargar = async () => {
    const r = await apiFetch(`/api/profesional/alertas/config?pacienteId=${pacienteId}`)
    setConfigs(await r.json())
    setLoading(false)
  }
  useEffect(() => { cargar() }, [])

  const agregar = async () => {
    const u = parseFloat(umbral)
    if (isNaN(u)) { setError('El umbral debe ser un número.'); return }
    setSaving(true); setError('')
    try {
      await apiFetch('/api/profesional/alertas/config', {
        method: 'POST',
        body: JSON.stringify({
          paciente_id: pacienteId, metrica, operador, umbral: u,
          mensaje: mensaje.trim() || undefined,
        }),
      })
      setUmbral(''); setMensaje('')
      await cargar()
    } catch {
      setError('Error al guardar. Intenta de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  const eliminar = async (id: string) => {
    await apiFetch(`/api/profesional/alertas/config/${id}`, { method: 'DELETE' })
    setConfigs(prev => prev.filter(c => c.id !== id))
  }

  const metricaLabel = (key: string) => METRICAS.find(m => m.value === key)?.label ?? key
  const operadorLabel = (key: string) => {
    const ops: Record<string,string> = { mayor_que:'>',menor_que:'<',mayor_igual_que:'≥',menor_igual_que:'≤' }
    return ops[key] ?? key
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-[var(--color-bg)] shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">Alertas de monitoreo</h2>
            <p className="text-xs text-[var(--color-text-muted)]">{pacienteNombre}</p>
          </div>
          <button onClick={onClose}
                  className="rounded-full p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-alt)]">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Alertas existentes */}
          {!loading && configs.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Reglas activas
              </h3>
              <ul className="space-y-2">
                {configs.map(c => (
                  <li key={c.id}
                      className="flex items-center justify-between rounded-lg
                                 bg-[var(--color-bg-alt)] px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-[var(--color-text)]">
                        {metricaLabel(c.metrica)}{' '}
                        <span className="font-mono">{operadorLabel(c.operador)} {c.umbral}</span>
                      </p>
                      {c.mensaje && (
                        <p className="text-xs text-[var(--color-text-muted)]">{c.mensaje}</p>
                      )}
                    </div>
                    <button
                      onClick={() => eliminar(c.id)}
                      className="ml-3 flex-shrink-0 text-xs text-[var(--color-danger)] hover:underline"
                    >
                      Eliminar
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Formulario nueva alerta */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Nueva regla
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Métrica</label>
                <select value={metrica} onChange={e => setMetrica(e.target.value)}
                        className="w-full rounded-lg border border-[var(--color-border)]
                                   bg-[var(--color-bg-alt)] px-2 py-2 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]">
                  {METRICAS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">Condición</label>
                <select value={operador} onChange={e => setOperador(e.target.value)}
                        className="w-full rounded-lg border border-[var(--color-border)]
                                   bg-[var(--color-bg-alt)] px-2 py-2 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]">
                  {OPERADORES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">
                Umbral{' '}
                <span className="font-normal text-[var(--color-text-muted)]">
                  ({METRICAS.find(m => m.value === metrica)?.ejemplo})
                </span>
              </label>
              <input
                type="number" inputMode="decimal"
                value={umbral} onChange={e => setUmbral(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-[var(--color-border)]
                           bg-[var(--color-bg-alt)] px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">
                Mensaje personalizado <span className="font-normal">(opcional)</span>
              </label>
              <input
                type="text" value={mensaje} onChange={e => setMensaje(e.target.value)}
                placeholder="El paciente superó el umbral de peso…"
                maxLength={200}
                className="w-full rounded-lg border border-[var(--color-border)]
                           bg-[var(--color-bg-alt)] px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
            </div>

            {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}

            <button
              onClick={agregar}
              disabled={saving || !umbral}
              className="w-full rounded-lg bg-[var(--color-primary)] py-2.5 text-sm
                         font-medium text-white disabled:opacity-60"
            >
              {saving ? 'Guardando…' : 'Añadir regla'}
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
```

### 8d — Integrar el modal en RPMDetallePage

En `apps/web-professional/src/pages/RPMDetallePage.tsx`, añadir el botón de configuración y el modal:

```tsx
import { ModalAlertaConfig } from '../components/ModalAlertaConfig'

// Estado en el componente:
const [modalAlertasOpen, setModalAlertasOpen] = useState(false)

// Botón en el header junto al selector de período:
<button
  onClick={() => setModalAlertasOpen(true)}
  className="flex items-center gap-2 rounded-lg border border-[var(--color-border)]
             px-3 py-1.5 text-sm text-[var(--color-text-muted)]
             hover:bg-[var(--color-bg-alt)]"
>
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 1L1 14h14L8 1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d="M8 6v3M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
  Alertas
</button>

// Al final del return:
{modalAlertasOpen && (
  <ModalAlertaConfig
    pacienteId={id!}
    pacienteNombre={data.paciente.nombre}
    onClose={() => setModalAlertasOpen(false)}
  />
)}
```

---

## Paso 9 — Verificación

```bash
# 1. Verificar migraciones
psql $DATABASE_URL -c "
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('alerta_config', 'alerta_rpm')
  ORDER BY table_name;"

# 2. Crear una configuración de alerta (reemplazar IDs reales)
curl -X POST -H "Authorization: Bearer $PRO_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"paciente_id\":\"$PACIENTE_ID\",\"metrica\":\"dias_sin_diario\",\"operador\":\"mayor_que\",\"umbral\":3}" \
  http://localhost:4001/api/profesional/alertas/config
# → 201

# 3. Disparar la evaluación manualmente
curl -X POST -H "Authorization: Bearer $PRO_TOKEN" \
  http://localhost:4001/api/profesional/alertas/evaluar-ahora
# → {"alertas_generadas": N}

# 4. Ver alertas activas
curl -H "Authorization: Bearer $PRO_TOKEN" \
  http://localhost:4001/api/profesional/alertas/activas
# → array (vacío si el paciente ha registrado en los últimos 3 días)

# 5. TypeScript sin errores
cd apps/api && npx tsc --noEmit
cd apps/web-professional && npx tsc --noEmit

# 6. Verificar idempotencia: ejecutar evaluar-ahora dos veces con el mismo paciente
# La segunda llamada debe devolver {"alertas_generadas": 0} — ON CONFLICT DO NOTHING en acción
```

---

## Resumen de cambios

| Capa | Archivo | Cambio |
|------|---------|--------|
| Migración | `0NN_alerta_config.sql` | Tipos `alerta_metrica` + `alerta_operador`; tabla `alerta_config` |
| Migración | `0NN1_alerta_rpm.sql` | Tipo `alerta_estado`; tabla `alerta_rpm` |
| API | `src/rpm/evaluar-alertas.ts` | Motor de evaluación de umbrales — corre con el cron o manualmente |
| API | `src/rpm/email-alerta.ts` | Envío de email por Resend; fallback a console.log |
| API | `src/server.ts` | Cron diario 8:00 AM para evaluar + enviar emails de alerta |
| API | `src/profesional/alertas.ts` | CRUD configuraciones + reconocer/resolver alertas + disparo manual |
| API | `src/profesional/rpm.ts` | Conteo de alertas activas por paciente incluido en el panel |
| Pro | `src/components/ModalAlertaConfig.tsx` | Gestión de reglas de alerta por paciente |
| Pro | `src/pages/RPMPage.tsx` | Panel de alertas activas con botón "Reconocer" |
| Pro | `src/pages/RPMDetallePage.tsx` | Botón "Alertas" que abre el modal de configuración |
| Pro | Sidebar | Badge numérico de alertas activas en el ítem "Monitoreo" |
