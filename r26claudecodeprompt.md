# R26 — RPM-01 Bienestar y medidas corporales + RPM-02 Panel de monitoreo del profesional

## Contexto obligatorio — leer antes de tocar cualquier archivo

- Monorepo: `apps/api` (Fastify), `apps/web-patient` (Vite + React, puerto 5175), `apps/web-professional` (Vite + React, puerto 5173)
- Columnas reales: `paciente.nombre` (no `nombre_completo`), `paciente.correo`, `paciente.estado`, `paciente.sexo_biologico`, `clinica.nombre_comercial`
- `clinica_id` del paciente: `SELECT clinica_id FROM paciente WHERE keycloak_user_id = request.user.sub`
- `clinica_id` del profesional: `request.auth.tenantId`
- `profesional_id` del profesional: `SELECT id FROM profesional WHERE keycloak_user_id = $1 AND clinica_id = $2`
- Colores vía CSS vars o Tailwind design tokens — nunca hex hardcodeado
- Nunca DELETE físico — soft-delete con `activo = false`
- Gráficas solo SVG — sin recharts ni ninguna librería de charting externa
- Framework API: **Fastify** — nunca Express
- Nunca `to_char()` en campos TIMESTAMPTZ que vayan a JSON — devolver el valor crudo del driver de `pg`
- Todo `ORDER BY fecha` que decida cuál es el primero o el último incluye `id` como tiebreaker: `ORDER BY fecha DESC, id DESC`
- `ORDER BY` sobre enums usa `CASE WHEN` — nunca sobre el nombre textual del valor
- Tablas ya existentes: `registro_metrica`, `registro_comida`, `configuracion_paciente`, `paciente`, `profesional`, `clinica`

---

## Paso 0 — Verificar prerequisitos y número de migración

```sql
-- 1. Tablas que este prompt necesita
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('registro_metrica', 'configuracion_paciente', 'recurso_pac');
```

Si alguna falta, detener y avisar: "Ejecuta r24 y r25 primero."

```sql
-- 2. Siguiente número de migración
SELECT migration_name
FROM schema_migrations
ORDER BY migration_name DESC
LIMIT 1;
```

Usar el número siguiente (N) y N+1 como prefijos. En los pasos siguientes se escribe `0NN` y `0NN1` — sustituir por los números reales.

---

## Paso 1 — Migration 0NN: registro_bienestar

Crear `apps/api/src/db/migrations/0NN_registro_bienestar.sql`:

```sql
-- Check-in diario de bienestar del paciente
CREATE TABLE registro_bienestar (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id  UUID        NOT NULL REFERENCES clinica(id),
  paciente_id UUID        NOT NULL REFERENCES paciente(id),
  fecha       DATE        NOT NULL DEFAULT CURRENT_DATE,
  estado      SMALLINT    NOT NULL CHECK (estado BETWEEN 1 AND 5),
  -- 1=Muy mal  2=Mal  3=Regular  4=Bien  5=Excelente
  sintomas    TEXT[]      NOT NULL DEFAULT '{}',
  nota        TEXT        CHECK (nota IS NULL OR char_length(nota) <= 500),
  activo      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_bienestar_dia UNIQUE (paciente_id, fecha)
  -- Un solo check-in por día; UPSERT para editar si cambia de idea
);

CREATE INDEX idx_bienestar_paciente
  ON registro_bienestar (clinica_id, paciente_id, fecha DESC);
```

---

## Paso 2 — Migration 0NN1: registro_medida_corporal

Crear `apps/api/src/db/migrations/0NN1_registro_medida_corporal.sql`:

```sql
-- Medidas corporales (cintura, cadera, etc.) — distintas de métricas clínicas
CREATE TABLE registro_medida_corporal (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id  UUID         NOT NULL REFERENCES clinica(id),
  paciente_id UUID         NOT NULL REFERENCES paciente(id),
  fecha       DATE         NOT NULL DEFAULT CURRENT_DATE,
  cintura_cm  NUMERIC(5,1) CHECK (cintura_cm > 0),
  cadera_cm   NUMERIC(5,1) CHECK (cadera_cm > 0),
  pecho_cm    NUMERIC(5,1) CHECK (pecho_cm > 0),
  brazo_cm    NUMERIC(5,1) CHECK (brazo_cm > 0),
  muslo_cm    NUMERIC(5,1) CHECK (muslo_cm > 0),
  cuello_cm   NUMERIC(5,1) CHECK (cuello_cm > 0),
  fuente      TEXT         NOT NULL DEFAULT 'paciente'
                CHECK (fuente IN ('paciente', 'consulta')),
  activo      BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_medidas_dia UNIQUE (paciente_id, fecha, fuente)
  -- El paciente puede registrar el mismo día que el profesional toma medidas en consulta
);

CREATE INDEX idx_medida_paciente
  ON registro_medida_corporal (clinica_id, paciente_id, fecha DESC);
```

---

## Paso 3 — API: bienestar del paciente

Crear `apps/api/src/paciente/bienestar.ts`:

```typescript
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

const SINTOMAS_VALIDOS = [
  'dolor_cabeza', 'fatiga', 'nausea', 'dolor_estomago',
  'ansiedad', 'insomnio', 'estrenimiento', 'diarrea',
  'inflamacion', 'antojos',
] as const

export async function bienestarRoutes(app: FastifyInstance, pool: Pool) {

  // GET /api/paciente/bienestar/hoy  →  entrada de hoy o null
  app.get('/api/paciente/bienestar/hoy', { onRequest: [app.authenticate] }, async (req, reply) => {
    const sub = (req as any).user.sub
    const { rows: [pac] } = await pool.query(
      `SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1`, [sub]
    )
    if (!pac) return reply.code(404).send({ error: 'Paciente no encontrado' })

    const { rows } = await pool.query(
      `SELECT id, fecha, estado, sintomas, nota, updated_at
       FROM registro_bienestar
       WHERE paciente_id = $1 AND clinica_id = $2
         AND fecha = CURRENT_DATE AND activo = true`,
      [pac.id, pac.clinica_id]
    )
    return rows[0] ?? null
  })

  // GET /api/paciente/bienestar?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
  app.get('/api/paciente/bienestar', { onRequest: [app.authenticate] }, async (req, reply) => {
    const sub = (req as any).user.sub
    const { desde, hasta } = req.query as { desde?: string; hasta?: string }

    const { rows: [pac] } = await pool.query(
      `SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1`, [sub]
    )
    if (!pac) return reply.code(404).send({ error: 'Paciente no encontrado' })

    const { rows } = await pool.query(
      `SELECT id, fecha, estado, sintomas, nota
       FROM registro_bienestar
       WHERE paciente_id = $1 AND clinica_id = $2 AND activo = true
         AND ($3::date IS NULL OR fecha >= $3)
         AND ($4::date IS NULL OR fecha <= $4)
       ORDER BY fecha DESC, id DESC
       LIMIT 90`,
      [pac.id, pac.clinica_id, desde ?? null, hasta ?? null]
    )
    return rows
  })

  // POST /api/paciente/bienestar  →  UPSERT del día actual
  app.post('/api/paciente/bienestar', { onRequest: [app.authenticate] }, async (req, reply) => {
    const sub = (req as any).user.sub
    const { estado, sintomas = [], nota } =
      req.body as { estado: number; sintomas?: string[]; nota?: string }

    if (!Number.isInteger(estado) || estado < 1 || estado > 5)
      return reply.code(400).send({ error: 'estado debe ser entero entre 1 y 5' })

    const sintomasInvalidos = sintomas.filter(s => !SINTOMAS_VALIDOS.includes(s as any))
    if (sintomasInvalidos.length)
      return reply.code(400).send({ error: `Síntomas no válidos: ${sintomasInvalidos.join(', ')}` })

    const { rows: [pac] } = await pool.query(
      `SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1`, [sub]
    )
    if (!pac) return reply.code(404).send({ error: 'Paciente no encontrado' })

    const { rows } = await pool.query(
      `INSERT INTO registro_bienestar
         (clinica_id, paciente_id, fecha, estado, sintomas, nota)
       VALUES ($1, $2, CURRENT_DATE, $3, $4, $5)
       ON CONFLICT (paciente_id, fecha) DO UPDATE
         SET estado     = EXCLUDED.estado,
             sintomas   = EXCLUDED.sintomas,
             nota       = EXCLUDED.nota,
             updated_at = now()
       RETURNING *`,
      [pac.clinica_id, pac.id, estado, sintomas, nota ?? null]
    )
    return reply.code(201).send(rows[0])
  })
}
```

Registrar en `apps/api/src/server.ts`:

```typescript
import { bienestarRoutes } from './paciente/bienestar.js'
await app.register(bienestarRoutes, { pool })
```

---

## Paso 4 — API: medidas corporales del paciente

Crear `apps/api/src/paciente/medidas.ts`:

```typescript
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

interface MedidasBody {
  fecha?: string
  cintura_cm?: number; cadera_cm?: number; pecho_cm?: number
  brazo_cm?: number; muslo_cm?: number; cuello_cm?: number
  fuente?: 'paciente' | 'consulta'
}

export async function medidasRoutes(app: FastifyInstance, pool: Pool) {

  // GET /api/paciente/medidas/ultimas  →  última medición con todos sus campos
  app.get('/api/paciente/medidas/ultimas', { onRequest: [app.authenticate] }, async (req, reply) => {
    const sub = (req as any).user.sub
    const { rows: [pac] } = await pool.query(
      `SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1`, [sub]
    )
    if (!pac) return reply.code(404).send({ error: 'Paciente no encontrado' })

    const { rows } = await pool.query(
      `SELECT fecha, cintura_cm, cadera_cm, pecho_cm, brazo_cm, muslo_cm, cuello_cm, fuente
       FROM registro_medida_corporal
       WHERE paciente_id = $1 AND clinica_id = $2 AND activo = true
       ORDER BY fecha DESC, id DESC
       LIMIT 1`,
      [pac.id, pac.clinica_id]
    )
    return rows[0] ?? null
  })

  // GET /api/paciente/medidas?meses=3  →  historial reciente
  app.get('/api/paciente/medidas', { onRequest: [app.authenticate] }, async (req, reply) => {
    const sub = (req as any).user.sub
    const meses = Math.min(12, parseInt((req.query as any).meses ?? '3', 10))

    const { rows: [pac] } = await pool.query(
      `SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1`, [sub]
    )
    if (!pac) return reply.code(404).send({ error: 'Paciente no encontrado' })

    const { rows } = await pool.query(
      `SELECT fecha, cintura_cm, cadera_cm, pecho_cm, brazo_cm, muslo_cm, cuello_cm, fuente
       FROM registro_medida_corporal
       WHERE paciente_id = $1 AND clinica_id = $2 AND activo = true
         AND fecha >= CURRENT_DATE - ($3 || ' months')::interval
       ORDER BY fecha DESC, id DESC`,
      [pac.id, pac.clinica_id, meses]
    )
    return rows
  })

  // POST /api/paciente/medidas  →  UPSERT para la fecha indicada (default hoy)
  app.post('/api/paciente/medidas', { onRequest: [app.authenticate] }, async (req, reply) => {
    const sub = (req as any).user.sub
    const body = req.body as MedidasBody
    const fuente = body.fuente ?? 'paciente'

    if (!['paciente', 'consulta'].includes(fuente))
      return reply.code(400).send({ error: 'fuente inválido' })

    const campos = ['cintura_cm', 'cadera_cm', 'pecho_cm', 'brazo_cm', 'muslo_cm', 'cuello_cm'] as const
    const hayAlgunaMediada = campos.some(c => body[c] != null)
    if (!hayAlgunaMediada)
      return reply.code(400).send({ error: 'Envía al menos una medida' })

    // Validar que todos los valores enviados sean positivos
    for (const c of campos) {
      if (body[c] != null && (body[c]! <= 0 || body[c]! > 300))
        return reply.code(400).send({ error: `${c} fuera de rango` })
    }

    const { rows: [pac] } = await pool.query(
      `SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1`, [sub]
    )
    if (!pac) return reply.code(404).send({ error: 'Paciente no encontrado' })

    const fechaSQL = body.fecha ?? 'CURRENT_DATE'  // si viene fecha la usamos, sino hoy

    const { rows } = await pool.query(
      `INSERT INTO registro_medida_corporal
         (clinica_id, paciente_id, fecha, cintura_cm, cadera_cm, pecho_cm,
          brazo_cm, muslo_cm, cuello_cm, fuente)
       VALUES ($1, $2, ${body.fecha ? '$9' : 'CURRENT_DATE'}, $3, $4, $5, $6, $7, $8, ${body.fecha ? '$10' : '$9'})
       ON CONFLICT (paciente_id, fecha, fuente) DO UPDATE
         SET cintura_cm = COALESCE(EXCLUDED.cintura_cm, registro_medida_corporal.cintura_cm),
             cadera_cm  = COALESCE(EXCLUDED.cadera_cm,  registro_medida_corporal.cadera_cm),
             pecho_cm   = COALESCE(EXCLUDED.pecho_cm,   registro_medida_corporal.pecho_cm),
             brazo_cm   = COALESCE(EXCLUDED.brazo_cm,   registro_medida_corporal.brazo_cm),
             muslo_cm   = COALESCE(EXCLUDED.muslo_cm,   registro_medida_corporal.muslo_cm),
             cuello_cm  = COALESCE(EXCLUDED.cuello_cm,  registro_medida_corporal.cuello_cm)
       RETURNING *`,
      body.fecha
        ? [pac.clinica_id, pac.id,
           body.cintura_cm ?? null, body.cadera_cm ?? null, body.pecho_cm ?? null,
           body.brazo_cm ?? null, body.muslo_cm ?? null, body.cuello_cm ?? null,
           body.fecha, fuente]
        : [pac.clinica_id, pac.id,
           body.cintura_cm ?? null, body.cadera_cm ?? null, body.pecho_cm ?? null,
           body.brazo_cm ?? null, body.muslo_cm ?? null, body.cuello_cm ?? null,
           fuente]
    )
    return reply.code(201).send(rows[0])
  })
}
```

> **Nota sobre el INSERT dinámico**: Si la lógica del UPSERT con fecha opcional resulta difícil de mantener, simplificarlo usando dos variantes de la query — una con `$fecha` y otra sin — en lugar de interpolación de string. Lo importante es que quede correcto.

Registrar en `apps/api/src/server.ts`:

```typescript
import { medidasRoutes } from './paciente/medidas.js'
await app.register(medidasRoutes, { pool })
```

---

## Paso 5 — API profesional: panel de monitoreo RPM

Crear `apps/api/src/profesional/rpm.ts`:

```typescript
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

export async function rpmRoutes(app: FastifyInstance, pool: Pool) {

  // GET /api/profesional/rpm/pacientes
  // Devuelve todos los pacientes activos con sus últimas métricas + sparkline de peso
  app.get('/api/profesional/rpm/pacientes', { onRequest: [app.authenticate] }, async (req, reply) => {
    const clinicaId = (req as any).auth.tenantId

    // 1. Pacientes activos con su configuración visual
    const { rows: pacientes } = await pool.query(
      `SELECT p.id, p.nombre, p.correo,
              COALESCE(c.foto_url, NULL)            AS foto_url,
              COALESCE(c.fondo, 'neutro')           AS fondo,
              COALESCE(c.nombre_preferido, p.nombre) AS nombre_preferido
       FROM paciente p
       LEFT JOIN configuracion_paciente c ON c.paciente_id = p.id AND c.clinica_id = p.clinica_id
       WHERE p.clinica_id = $1 AND p.estado = 'activo'
       ORDER BY p.nombre`,
      [clinicaId]
    )
    if (!pacientes.length) return []

    const pacienteIds = pacientes.map(p => p.id)

    // 2. Última métrica por tipo para cada paciente (DISTINCT ON)
    const { rows: ultimasMetricas } = await pool.query(
      `SELECT DISTINCT ON (paciente_id, tipo)
              paciente_id, tipo, valor, sistolica, diastolica, unidad, fecha
       FROM registro_metrica
       WHERE clinica_id = $1 AND paciente_id = ANY($2)
         AND activo = true
       ORDER BY paciente_id, tipo, fecha DESC, id DESC`,
      [clinicaId, pacienteIds]
    )

    // 3. Sparkline de peso: últimas 14 entradas por paciente
    const { rows: sparklinePesos } = await pool.query(
      `SELECT paciente_id, fecha, valor
       FROM (
         SELECT paciente_id, fecha, valor,
                ROW_NUMBER() OVER (PARTITION BY paciente_id ORDER BY fecha DESC, id DESC) AS rn
         FROM registro_metrica
         WHERE clinica_id = $1 AND paciente_id = ANY($2)
           AND tipo = 'peso' AND activo = true
           AND fecha >= CURRENT_DATE - INTERVAL '30 days'
       ) sub
       WHERE rn <= 14
       ORDER BY paciente_id, fecha`,
      [clinicaId, pacienteIds]
    )

    // 4. Último bienestar por paciente
    const { rows: ultimoBienestar } = await pool.query(
      `SELECT DISTINCT ON (paciente_id)
              paciente_id, estado, fecha
       FROM registro_bienestar
       WHERE clinica_id = $1 AND paciente_id = ANY($2) AND activo = true
       ORDER BY paciente_id, fecha DESC, id DESC`,
      [clinicaId, pacienteIds]
    )

    // 5. Días desde el último registro de comida por paciente
    const { rows: ultimaComida } = await pool.query(
      `SELECT DISTINCT ON (paciente_id)
              paciente_id, fecha
       FROM registro_comida
       WHERE clinica_id = $1 AND paciente_id = ANY($2) AND activo = true
       ORDER BY paciente_id, fecha DESC, id DESC`,
      [clinicaId, pacienteIds]
    )

    // 6. Días desde el último registro de bienestar por paciente (ya tenemos ultimoBienestar)

    // Ensamblar la respuesta
    const metricasPorPaciente: Record<string, Record<string, any>> = {}
    for (const m of ultimasMetricas) {
      if (!metricasPorPaciente[m.paciente_id]) metricasPorPaciente[m.paciente_id] = {}
      metricasPorPaciente[m.paciente_id][m.tipo] = m
    }

    const sparklinePorPaciente: Record<string, { fecha: string; valor: number }[]> = {}
    for (const s of sparklinePesos) {
      if (!sparklinePorPaciente[s.paciente_id]) sparklinePorPaciente[s.paciente_id] = []
      sparklinePorPaciente[s.paciente_id].push({ fecha: s.fecha, valor: parseFloat(s.valor) })
    }

    const bienestarPorPaciente: Record<string, any> = {}
    for (const b of ultimoBienestar) bienestarPorPaciente[b.paciente_id] = b

    const comidaPorPaciente: Record<string, string> = {}
    for (const c of ultimaComida) comidaPorPaciente[c.paciente_id] = c.fecha

    const hoy = new Date()
    const diasDesde = (fechaStr: string | undefined) => {
      if (!fechaStr) return null
      const diff = hoy.getTime() - new Date(fechaStr).getTime()
      return Math.floor(diff / 86_400_000)
    }

    return pacientes.map(p => {
      const metricas = metricasPorPaciente[p.id] ?? {}
      const ultimaComidaFecha = comidaPorPaciente[p.id]
      const bienStar = bienestarPorPaciente[p.id]

      return {
        id:               p.id,
        nombre:           p.nombre_preferido,
        foto_url:         p.foto_url,
        fondo:            p.fondo,
        ultimo_peso:      metricas['peso']     ?? null,
        ultima_glucosa:   metricas['glucosa']  ?? null,
        ultima_presion:   metricas['presion_arterial'] ?? null,
        ultimo_bienestar: bienStar ?? null,
        dias_sin_diario:  diasDesde(ultimaComidaFecha),
        dias_sin_bienestar: diasDesde(bienStar?.fecha),
        sparkline_peso:   sparklinePorPaciente[p.id] ?? [],
        alertas_activas:  0,  // será alimentado desde r27
      }
    })
  })

  // GET /api/profesional/rpm/pacientes/:id
  // Detalle completo: series de tiempo para gráficas
  app.get('/api/profesional/rpm/pacientes/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const clinicaId = (req as any).auth.tenantId
    const { id: pacienteId } = req.params as { id: string }
    const meses = Math.min(12, parseInt((req.query as any).meses ?? '3', 10))

    // Verificar que el paciente pertenece a la clínica
    const { rows: [pac] } = await pool.query(
      `SELECT id, nombre FROM paciente WHERE id = $1 AND clinica_id = $2 AND estado = 'activo'`,
      [pacienteId, clinicaId]
    )
    if (!pac) return reply.code(404).send({ error: 'Paciente no encontrado' })

    const desde = `CURRENT_DATE - INTERVAL '${meses} months'`

    const [metricas, bienestar, medidas, comidas] = await Promise.all([
      pool.query(
        `SELECT tipo, valor, sistolica, diastolica, unidad, fecha
         FROM registro_metrica
         WHERE paciente_id = $1 AND clinica_id = $2 AND activo = true
           AND fecha >= ${desde}
         ORDER BY tipo, fecha, id`,
        [pacienteId, clinicaId]
      ),
      pool.query(
        `SELECT estado, sintomas, nota, fecha
         FROM registro_bienestar
         WHERE paciente_id = $1 AND clinica_id = $2 AND activo = true
           AND fecha >= ${desde}
         ORDER BY fecha, id`,
        [pacienteId, clinicaId]
      ),
      pool.query(
        `SELECT cintura_cm, cadera_cm, pecho_cm, brazo_cm, muslo_cm, cuello_cm, fuente, fecha
         FROM registro_medida_corporal
         WHERE paciente_id = $1 AND clinica_id = $2 AND activo = true
           AND fecha >= ${desde}
         ORDER BY fecha, id`,
        [pacienteId, clinicaId]
      ),
      pool.query(
        `SELECT fecha,
                SUM(kcal) AS kcal_total,
                COUNT(*) AS comidas_registradas
         FROM registro_comida
         WHERE paciente_id = $1 AND clinica_id = $2 AND activo = true
           AND fecha >= ${desde}
         GROUP BY fecha
         ORDER BY fecha`,
        [pacienteId, clinicaId]
      ),
    ])

    return {
      paciente:     pac,
      metricas:     metricas.rows,
      bienestar:    bienestar.rows,
      medidas:      medidas.rows,
      diario_resumen: comidas.rows,
    }
  })
}
```

Registrar en `apps/api/src/server.ts`:

```typescript
import { rpmRoutes } from './profesional/rpm.js'
await app.register(rpmRoutes, { pool })
```

---

## Paso 6 — Frontend web-patient: pestaña Bienestar

### 6a — Constantes compartidas

Crear `apps/web-patient/src/lib/bienestar.ts`:

```typescript
export const ESTADOS_BIENESTAR = [
  { valor: 1, emoji: '😔', label: 'Muy mal'    },
  { valor: 2, emoji: '😕', label: 'Mal'        },
  { valor: 3, emoji: '😐', label: 'Regular'    },
  { valor: 4, emoji: '🙂', label: 'Bien'       },
  { valor: 5, emoji: '😄', label: 'Excelente'  },
] as const

export const SINTOMAS_CONFIG = [
  { key: 'dolor_cabeza',  label: 'Dolor de cabeza' },
  { key: 'fatiga',        label: 'Fatiga'           },
  { key: 'nausea',        label: 'Náusea'           },
  { key: 'dolor_estomago',label: 'Dolor de estómago'},
  { key: 'ansiedad',      label: 'Ansiedad'         },
  { key: 'insomnio',      label: 'Insomnio'         },
  { key: 'estrenimiento', label: 'Estreñimiento'    },
  { key: 'diarrea',       label: 'Diarrea'          },
  { key: 'inflamacion',   label: 'Inflamación'      },
  { key: 'antojos',       label: 'Antojos'          },
] as const

export type SintomaKey = typeof SINTOMAS_CONFIG[number]['key']
```

### 6b — Componente BienestarTab

Crear `apps/web-patient/src/components/BienestarTab.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'
import { ESTADOS_BIENESTAR, SINTOMAS_CONFIG } from '../lib/bienestar'
import type { SintomaKey } from '../lib/bienestar'

interface RegistroBienestar {
  id: string
  fecha: string
  estado: number
  sintomas: string[]
  nota: string | null
}

export function BienestarTab() {
  const [hoy, setHoy] = useState<RegistroBienestar | null>(null)
  const [historial, setHistorial] = useState<RegistroBienestar[]>([])
  const [loading, setLoading] = useState(true)

  // Estado del formulario
  const [estadoSel, setEstadoSel] = useState<number | null>(null)
  const [sintomasSel, setSintomasSel] = useState<SintomaKey[]>([])
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)

  const cargar = async () => {
    setLoading(true)
    try {
      const [rHoy, rHistorial] = await Promise.all([
        apiFetch('/api/paciente/bienestar/hoy').then(r => r.json()),
        apiFetch('/api/paciente/bienestar').then(r => r.json()),
      ])
      setHoy(rHoy)
      setHistorial(rHistorial)
      if (rHoy) {
        setEstadoSel(rHoy.estado)
        setSintomasSel(rHoy.sintomas ?? [])
        setNota(rHoy.nota ?? '')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const toggleSintoma = (key: SintomaKey) => {
    setSintomasSel(prev =>
      prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key]
    )
  }

  const guardar = async () => {
    if (estadoSel == null) return
    setGuardando(true)
    try {
      await apiFetch('/api/paciente/bienestar', {
        method: 'POST',
        body: JSON.stringify({ estado: estadoSel, sintomas: sintomasSel, nota: nota.trim() || undefined }),
      })
      setGuardado(true)
      await cargar()
      setTimeout(() => setGuardado(false), 2000)
    } finally {
      setGuardando(false)
    }
  }

  if (loading) return (
    <div className="flex justify-center py-12">
      <span className="text-sm text-[var(--color-text-muted)]">Cargando…</span>
    </div>
  )

  return (
    <div className="space-y-5 px-4 py-4">

      {/* Formulario de hoy */}
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4 space-y-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">
          ¿Cómo te sientes hoy?
        </h2>

        {/* Selector de estado (emojis) */}
        <div className="flex justify-between">
          {ESTADOS_BIENESTAR.map(e => (
            <button
              key={e.valor}
              onClick={() => setEstadoSel(e.valor)}
              aria-label={e.label}
              aria-pressed={estadoSel === e.valor}
              className="flex flex-col items-center gap-1"
            >
              <span
                className={`text-3xl transition-all duration-150
                            ${estadoSel === e.valor
                              ? 'scale-125 drop-shadow-lg'
                              : 'opacity-50 grayscale'}`}
              >
                {e.emoji}
              </span>
              <span className={`text-[10px] font-medium
                               ${estadoSel === e.valor
                                 ? 'text-[var(--color-primary)]'
                                 : 'text-[var(--color-text-muted)]'}`}>
                {e.label}
              </span>
            </button>
          ))}
        </div>

        {/* Síntomas (solo si el estado ≤ 3) */}
        {estadoSel != null && estadoSel <= 3 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--color-text-muted)]">
              ¿Qué síntomas tienes? (opcional)
            </p>
            <div className="flex flex-wrap gap-2">
              {SINTOMAS_CONFIG.map(s => (
                <button
                  key={s.key}
                  onClick={() => toggleSintoma(s.key)}
                  aria-pressed={sintomasSel.includes(s.key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors
                              ${sintomasSel.includes(s.key)
                                ? 'bg-[var(--color-primary)] text-white'
                                : 'bg-[var(--color-bg-alt)] text-[var(--color-text-muted)]'}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Nota opcional */}
        {estadoSel != null && (
          <textarea
            value={nota}
            onChange={e => setNota(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Nota opcional…"
            className="w-full resize-none rounded-lg border border-[var(--color-border)]
                       bg-[var(--color-bg-alt)] px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
        )}

        <button
          onClick={guardar}
          disabled={estadoSel == null || guardando}
          className="w-full rounded-xl bg-[var(--color-primary)] py-3 text-sm
                     font-semibold text-white disabled:opacity-50"
        >
          {guardado ? '✓ Guardado' : guardando ? 'Guardando…' : hoy ? 'Actualizar' : 'Registrar'}
        </button>
      </section>

      {/* Historial — últimos 14 días como tira de puntos */}
      {historial.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Últimos días
          </h3>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {historial.slice(0, 14).map(r => {
              const estado = ESTADOS_BIENESTAR.find(e => e.valor === r.estado)
              return (
                <div key={r.id} className="flex flex-col items-center gap-1 flex-shrink-0">
                  <span className="text-xl">{estado?.emoji ?? '—'}</span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {new Date(r.fecha).toLocaleDateString('es-MX', { weekday: 'short' })}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

    </div>
  )
}
```

---

## Paso 7 — Frontend web-patient: pestaña Cuerpo (medidas corporales)

Crear `apps/web-patient/src/components/CuerpoTab.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

interface Medidas {
  fecha: string
  cintura_cm: number | null; cadera_cm: number | null; pecho_cm: number | null
  brazo_cm: number | null;   muslo_cm: number | null;  cuello_cm: number | null
  fuente: string
}

const CAMPOS: { key: keyof Omit<Medidas, 'fecha' | 'fuente'>; label: string; posX: number; posY: number }[] = [
  { key: 'cuello_cm',  label: 'Cuello',  posX: 0.50, posY: 0.14 },
  { key: 'pecho_cm',   label: 'Pecho',   posX: 0.50, posY: 0.26 },
  { key: 'brazo_cm',   label: 'Brazo',   posX: 0.22, posY: 0.30 },
  { key: 'cintura_cm', label: 'Cintura', posX: 0.50, posY: 0.40 },
  { key: 'cadera_cm',  label: 'Cadera',  posX: 0.50, posY: 0.51 },
  { key: 'muslo_cm',   label: 'Muslo',   posX: 0.38, posY: 0.65 },
]

export function CuerpoTab() {
  const [ultimas, setUltimas] = useState<Medidas | null>(null)
  const [form, setForm] = useState<Partial<Record<keyof Omit<Medidas,'fecha'|'fuente'>, string>>>({})
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiFetch('/api/paciente/medidas/ultimas')
      setUltimas(r.ok ? await r.json() : null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const setValor = (key: string, val: string) =>
    setForm(prev => ({ ...prev, [key]: val }))

  const guardar = async () => {
    const body: Record<string, number> = {}
    for (const c of CAMPOS) {
      const v = parseFloat(form[c.key] ?? '')
      if (!isNaN(v) && v > 0) body[c.key] = v
    }
    if (!Object.keys(body).length) {
      setError('Ingresa al menos una medida.')
      return
    }
    setGuardando(true); setError('')
    try {
      await apiFetch('/api/paciente/medidas', { method: 'POST', body: JSON.stringify(body) })
      setGuardado(true)
      setForm({})
      await cargar()
      setTimeout(() => setGuardado(false), 2000)
    } catch {
      setError('Error al guardar. Intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  if (loading) return (
    <div className="flex justify-center py-12">
      <span className="text-sm text-[var(--color-text-muted)]">Cargando…</span>
    </div>
  )

  return (
    <div className="space-y-5 px-4 py-4">

      {/* Silueta SVG con etiquetas */}
      <div className="relative mx-auto" style={{ maxWidth: 220, aspectRatio: '1 / 2.2' }}>
        {/* Silueta corporal simplificada — líneas que forman una figura humana */}
        <svg viewBox="0 0 100 220" fill="none" xmlns="http://www.w3.org/2000/svg"
             className="w-full h-full">
          {/* Cabeza */}
          <circle cx="50" cy="18" r="12" stroke="var(--color-border)" strokeWidth="2"/>
          {/* Cuello */}
          <path d="M44 30 L44 38 M56 30 L56 38" stroke="var(--color-border)" strokeWidth="2"/>
          {/* Hombros */}
          <path d="M20 44 Q28 38 44 38 L56 38 Q72 38 80 44"
                stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round"/>
          {/* Brazos */}
          <path d="M20 44 L14 80 Q12 86 16 90" stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round"/>
          <path d="M80 44 L86 80 Q88 86 84 90" stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round"/>
          {/* Torso */}
          <path d="M44 38 L40 88 L44 102 L56 102 L60 88 L56 38"
                stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round"/>
          {/* Cadera */}
          <path d="M40 102 Q30 106 32 118 L44 130 L56 130 L68 118 Q70 106 60 102"
                stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round"/>
          {/* Piernas */}
          <path d="M44 130 L42 175 L46 185" stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round"/>
          <path d="M56 130 L58 175 L54 185" stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round"/>
          {/* Pies */}
          <path d="M42 185 Q38 188 34 186" stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round"/>
          <path d="M58 185 Q62 188 66 186" stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round"/>

          {/* Puntos de medición — colorear si hay dato guardado */}
          {CAMPOS.map(c => {
            const tieneValor = ultimas && ultimas[c.key] != null
            const cx = c.posX * 100
            const cy = c.posY * 220
            return (
              <g key={c.key}>
                <circle cx={cx} cy={cy} r="3.5"
                        fill={tieneValor ? 'var(--color-primary)' : 'var(--color-border)'}/>
                {tieneValor && (
                  <text x={cx + 5} y={cy + 4} fontSize="7"
                        fill="var(--color-primary)" fontWeight="600">
                    {ultimas![c.key]}cm
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Formulario de medidas */}
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4 space-y-3">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Registrar medidas</h2>
        <div className="grid grid-cols-2 gap-3">
          {CAMPOS.map(c => (
            <div key={c.key} className="space-y-1">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">
                {c.label} {ultimas?.[c.key] != null && (
                  <span className="text-[var(--color-primary)]">({ultimas[c.key]} cm)</span>
                )}
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  inputMode="decimal"
                  value={form[c.key] ?? ''}
                  onChange={e => setValor(c.key, e.target.value)}
                  placeholder="cm"
                  min="1" max="300" step="0.1"
                  className="w-full rounded-lg border border-[var(--color-border)]
                             bg-[var(--color-bg-alt)] px-2 py-1.5 text-sm
                             focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
                <span className="text-xs text-[var(--color-text-muted)] flex-shrink-0">cm</span>
              </div>
            </div>
          ))}
        </div>

        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}

        <button
          onClick={guardar}
          disabled={guardando}
          className="w-full rounded-xl bg-[var(--color-primary)] py-3 text-sm
                     font-semibold text-white disabled:opacity-50"
        >
          {guardado ? '✓ Guardado' : guardando ? 'Guardando…' : 'Guardar medidas'}
        </button>
      </section>

    </div>
  )
}
```

---

## Paso 8 — Integrar las nuevas pestañas en MisRegistros

Editar `apps/web-patient/src/pages/MisRegistrosPage.tsx` (o como se llame la página que agrupa Diario, Métricas, Progreso):

Las sub-pestañas pasan de 3 a 5: **Diario | Bienestar | Cuerpo | Métricas | Progreso**

El selector de pestañas debe ser scrollable horizontalmente en móvil:

```tsx
import { BienestarTab } from '../components/BienestarTab'
import { CuerpoTab }    from '../components/CuerpoTab'

// Sub-tabs
const TABS = [
  { key: 'diario',    label: 'Diario'    },
  { key: 'bienestar', label: 'Bienestar' },
  { key: 'cuerpo',    label: 'Cuerpo'    },
  { key: 'metricas',  label: 'Métricas'  },
  { key: 'progreso',  label: 'Progreso'  },
]

// Selector scrollable
<div className="flex gap-1 overflow-x-auto px-4 py-2 scrollbar-hide border-b border-[var(--color-border)]">
  {TABS.map(t => (
    <button
      key={t.key}
      onClick={() => setTabActiva(t.key)}
      className={`flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors
                  ${tabActiva === t.key
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-alt)]'}`}
    >
      {t.label}
    </button>
  ))}
</div>

// Contenido
{tabActiva === 'bienestar' && <BienestarTab />}
{tabActiva === 'cuerpo'    && <CuerpoTab />}
```

Añadir también una tarjeta de "check-in pendiente" en **InicioPage** si `hoy` de bienestar es null:

```tsx
// En InicioPage, después de las tarjetas existentes:
{!bienestarHoy && (
  <Link to="/registros?tab=bienestar"
        className="flex items-center gap-3 rounded-xl border border-[var(--color-primary-light)]
                   bg-[var(--color-primary-light)]/10 px-4 py-3">
    <span className="text-2xl">🙂</span>
    <div>
      <p className="text-sm font-medium text-[var(--color-text)]">¿Cómo te sientes hoy?</p>
      <p className="text-xs text-[var(--color-text-muted)]">Registra tu bienestar diario</p>
    </div>
    <svg className="ml-auto" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M6 3l5 5-5 5" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  </Link>
)}
```

---

## Paso 9 — Frontend web-professional: página de monitoreo RPM

### 9a — Componente SparklineInline

Crear `apps/web-professional/src/components/SparklineInline.tsx`:

```tsx
interface Props {
  valores: number[]
  width?: number
  height?: number
  color?: string
}

export function SparklineInline({ valores, width = 80, height = 28, color = 'var(--color-primary)' }: Props) {
  if (valores.length < 2)
    return <span className="text-xs text-[var(--color-text-muted)]">—</span>

  const min = Math.min(...valores)
  const max = Math.max(...valores)
  const rango = max - min || 1

  const pts = valores.map((v, i) => {
    const x = (i / (valores.length - 1)) * width
    // Dejar 2px de margen arriba y abajo
    const y = 2 + (height - 4) - ((v - min) / rango) * (height - 4)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const ultimo = valores[valores.length - 1]
  const penultimo = valores[valores.length - 2]
  const tendencia = ultimo > penultimo ? '↑' : ultimo < penultimo ? '↓' : '→'
  const colorTendencia =
    ultimo > penultimo ? 'var(--color-danger)' :
    ultimo < penultimo ? 'var(--color-success)' :
    'var(--color-text-muted)'

  return (
    <div className="flex items-center gap-2">
      <svg width={width} height={height}
           viewBox={`0 0 ${width} ${height}`}
           aria-hidden="true" className="flex-shrink-0">
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Último punto destacado */}
        {(() => {
          const lastX = width
          const lastY = 2 + (height - 4) - ((ultimo - min) / rango) * (height - 4)
          return <circle cx={lastX} cy={lastY} r="2.5" fill={color}/>
        })()}
      </svg>
      <span className="text-xs font-medium" style={{ color: colorTendencia }}>
        {tendencia}
      </span>
    </div>
  )
}
```

### 9b — Página RPMPage

Crear `apps/web-professional/src/pages/RPMPage.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { SparklineInline } from '../components/SparklineInline'
import { Avatar } from '../components/Avatar'  // reutilizar si existe, o copiar de web-patient

const BIENESTAR_EMOJI: Record<number, string> = { 1:'😔', 2:'😕', 3:'😐', 4:'🙂', 5:'😄' }

interface PacienteRPM {
  id: string
  nombre: string
  foto_url: string | null
  fondo: string
  ultimo_peso: { valor: number; unidad: string; fecha: string } | null
  ultimo_bienestar: { estado: number; fecha: string } | null
  dias_sin_diario: number | null
  dias_sin_bienestar: number | null
  sparkline_peso: { fecha: string; valor: number }[]
  alertas_activas: number
}

function semaforo(dias: number | null): string {
  if (dias == null) return 'text-[var(--color-text-muted)]'
  if (dias <= 1) return 'text-[var(--color-success)]'
  if (dias <= 4) return 'text-[var(--color-accent)]'
  return 'text-[var(--color-danger)]'
}

export default function RPMPage() {
  const navigate = useNavigate()
  const [pacientes, setPacientes] = useState<PacienteRPM[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('')

  useEffect(() => {
    apiFetch('/api/profesional/rpm/pacientes')
      .then(r => r.json())
      .then(setPacientes)
      .finally(() => setLoading(false))
  }, [])

  const filtrados = pacientes.filter(p =>
    p.nombre.toLowerCase().includes(filtro.toLowerCase())
  )

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text)]">Monitoreo de pacientes</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            {pacientes.length} pacientes activos
          </p>
        </div>
        <input
          type="search"
          value={filtro}
          onChange={e => setFiltro(e.target.value)}
          placeholder="Buscar paciente…"
          className="w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-alt)]
                     px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]">
        {loading ? (
          <div className="flex justify-center py-16">
            <span className="text-sm text-[var(--color-text-muted)]">Cargando…</span>
          </div>
        ) : filtrados.length === 0 ? (
          <div className="flex flex-col items-center py-16 gap-2">
            <p className="text-sm text-[var(--color-text-muted)]">
              {filtro ? 'Sin resultados para la búsqueda.' : 'No hay pacientes activos.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--color-border)] bg-[var(--color-bg-alt)]">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-[var(--color-text-muted)]">Paciente</th>
                  <th className="px-4 py-3 text-left font-medium text-[var(--color-text-muted)]">Peso</th>
                  <th className="px-4 py-3 text-left font-medium text-[var(--color-text-muted)]">Tendencia</th>
                  <th className="px-4 py-3 text-center font-medium text-[var(--color-text-muted)]">Bienestar</th>
                  <th className="px-4 py-3 text-center font-medium text-[var(--color-text-muted)]">Diario</th>
                  <th className="px-4 py-3 text-center font-medium text-[var(--color-text-muted)]">Alertas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {filtrados.map(p => (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/rpm/${p.id}`)}
                    className="hover:bg-[var(--color-bg-alt)] cursor-pointer transition-colors"
                  >
                    {/* Paciente */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full flex items-center justify-center
                                        text-xs font-semibold text-white flex-shrink-0"
                             style={{ backgroundColor: `var(--color-primary)` }}>
                          {p.nombre.split(' ').slice(0,2).map(n => n[0]).join('').toUpperCase()}
                        </div>
                        <span className="font-medium text-[var(--color-text)]">{p.nombre}</span>
                      </div>
                    </td>

                    {/* Último peso */}
                    <td className="px-4 py-3">
                      {p.ultimo_peso ? (
                        <div>
                          <p className="font-medium text-[var(--color-text)]">
                            {p.ultimo_peso.valor} {p.ultimo_peso.unidad}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {new Date(p.ultimo_peso.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                          </p>
                        </div>
                      ) : (
                        <span className="text-[var(--color-text-muted)]">—</span>
                      )}
                    </td>

                    {/* Sparkline */}
                    <td className="px-4 py-3">
                      <SparklineInline valores={p.sparkline_peso.map(s => s.valor)} />
                    </td>

                    {/* Bienestar */}
                    <td className="px-4 py-3 text-center">
                      {p.ultimo_bienestar ? (
                        <div className="flex flex-col items-center">
                          <span className="text-xl">
                            {BIENESTAR_EMOJI[p.ultimo_bienestar.estado] ?? '?'}
                          </span>
                          <span className={`text-xs ${semaforo(p.dias_sin_bienestar)}`}>
                            {p.dias_sin_bienestar === 0
                              ? 'Hoy'
                              : p.dias_sin_bienestar === 1
                                ? 'Ayer'
                                : `hace ${p.dias_sin_bienestar}d`}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[var(--color-text-muted)]">—</span>
                      )}
                    </td>

                    {/* Días sin diario */}
                    <td className="px-4 py-3 text-center">
                      {p.dias_sin_diario != null ? (
                        <span className={`font-medium ${semaforo(p.dias_sin_diario)}`}>
                          {p.dias_sin_diario === 0
                            ? 'Hoy'
                            : p.dias_sin_diario === 1
                              ? 'Ayer'
                              : `${p.dias_sin_diario}d`}
                        </span>
                      ) : (
                        <span className="text-[var(--color-text-muted)]">—</span>
                      )}
                    </td>

                    {/* Alertas */}
                    <td className="px-4 py-3 text-center">
                      {p.alertas_activas > 0 ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center
                                         rounded-full bg-[var(--color-danger)] text-white text-xs font-bold">
                          {p.alertas_activas}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--color-success)]">✓</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
```

### 9c — Página de detalle RPM del paciente

Crear `apps/web-professional/src/pages/RPMDetallePage.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { SparklineInline } from '../components/SparklineInline'

const BIENESTAR_EMOJI: Record<number, string> = { 1:'😔', 2:'😕', 3:'😐', 4:'🙂', 5:'😄' }

interface RpmDetalle {
  paciente: { id: string; nombre: string }
  metricas: { tipo: string; valor: number; sistolica?: number; diastolica?: number; unidad: string; fecha: string }[]
  bienestar: { estado: number; sintomas: string[]; nota: string | null; fecha: string }[]
  medidas: { cintura_cm: number | null; cadera_cm: number | null; fecha: string; fuente: string }[]
  diario_resumen: { fecha: string; kcal_total: number | null; comidas_registradas: number }[]
}

export default function RPMDetallePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<RpmDetalle | null>(null)
  const [loading, setLoading] = useState(true)
  const [meses, setMeses] = useState(3)

  useEffect(() => {
    setLoading(true)
    apiFetch(`/api/profesional/rpm/pacientes/${id}?meses=${meses}`)
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [id, meses])

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <span className="text-sm text-[var(--color-text-muted)]">Cargando…</span>
    </div>
  )
  if (!data) return null

  const pesos  = data.metricas.filter(m => m.tipo === 'peso').sort((a, b) => a.fecha.localeCompare(b.fecha))
  const bienestarValues = data.bienestar.sort((a, b) => a.fecha.localeCompare(b.fecha))

  // Gráfica de pesos — SVG line chart básico
  const chartW = 400, chartH = 100
  const pesoMin = Math.min(...pesos.map(p => p.valor))
  const pesoMax = Math.max(...pesos.map(p => p.valor))
  const pesoRango = pesoMax - pesoMin || 1
  const pesosPts = pesos.map((p, i) => {
    const x = (i / Math.max(pesos.length - 1, 1)) * chartW
    const y = chartH - ((p.valor - pesoMin) / pesoRango) * (chartH - 10) - 5
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/rpm')}
                className="rounded-full p-2 hover:bg-[var(--color-bg-alt)]
                           text-[var(--color-text-muted)]">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M13 4L7 10l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">{data.paciente.nombre}</h1>

        {/* Selector de período */}
        <div className="ml-auto flex gap-1">
          {[3, 6, 12].map(m => (
            <button
              key={m}
              onClick={() => setMeses(m)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors
                          ${meses === m
                            ? 'bg-[var(--color-primary)] text-white'
                            : 'bg-[var(--color-bg-alt)] text-[var(--color-text-muted)]'}`}
            >
              {m}m
            </button>
          ))}
        </div>
      </div>

      {/* Gráfica de peso */}
      {pesos.length >= 2 && (
        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Evolución del peso</h2>
            <span className="text-xs text-[var(--color-text-muted)]">
              {pesos[0].valor} → {pesos[pesos.length-1].valor} {pesos[0].unidad}
            </span>
          </div>
          <div className="overflow-x-auto">
            <svg width={chartW} height={chartH + 20} viewBox={`0 0 ${chartW} ${chartH + 20}`}>
              {/* Línea de datos */}
              <polyline
                points={pesosPts}
                fill="none"
                stroke="var(--color-primary)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Puntos */}
              {pesos.map((p, i) => {
                const x = (i / Math.max(pesos.length - 1, 1)) * chartW
                const y = chartH - ((p.valor - pesoMin) / pesoRango) * (chartH - 10) - 5
                return (
                  <g key={i}>
                    <circle cx={x} cy={y} r="3" fill="var(--color-primary)"/>
                    {i % Math.ceil(pesos.length / 5) === 0 && (
                      <text x={x} y={chartH + 14} textAnchor="middle"
                            fontSize="9" fill="var(--color-text-muted)">
                        {new Date(p.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'numeric' })}
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>
          </div>
        </section>
      )}

      {/* Bienestar reciente */}
      {bienestarValues.length > 0 && (
        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4 space-y-3">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Bienestar</h2>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {[...bienestarValues].reverse().slice(0, 30).map((b, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5 flex-shrink-0">
                <span className="text-lg">{BIENESTAR_EMOJI[b.estado] ?? '?'}</span>
                <span className="text-[9px] text-[var(--color-text-muted)]">
                  {new Date(b.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Resumen diario */}
      {data.diario_resumen.length > 0 && (
        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4 space-y-3">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Adherencia al diario</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            {data.diario_resumen.length} días registrados en los últimos {meses} meses
          </p>
          {/* Mini heatmap de días registrados */}
          <div className="flex flex-wrap gap-1">
            {data.diario_resumen.slice(-60).map((d, i) => (
              <div
                key={i}
                title={`${d.fecha}: ${d.kcal_total ?? '?'} kcal`}
                className="h-4 w-4 rounded-sm"
                style={{
                  backgroundColor: d.kcal_total
                    ? 'var(--color-primary)'
                    : 'var(--color-border)',
                  opacity: d.kcal_total ? Math.min(1, d.kcal_total / 2000) + 0.3 : 1,
                }}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
```

### 9d — Registrar rutas en web-professional

En `apps/web-professional/src/App.tsx`:

```tsx
import RPMPage       from './pages/RPMPage'
import RPMDetallePage from './pages/RPMDetallePage'
// ...
<Route path="/rpm"     element={<RPMPage />} />
<Route path="/rpm/:id" element={<RPMDetallePage />} />
```

Añadir el ítem "Monitoreo" en el Sidebar con icono de gráfica:

```tsx
{
  to: '/rpm',
  label: 'Monitoreo',
  icon: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 14l4-5 4 3 4-7 2 9" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
}
```

---

## Paso 10 — Verificación

```bash
# 1. Verificar migraciones
psql $DATABASE_URL -c "
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('registro_bienestar','registro_medida_corporal')
  ORDER BY table_name;"

# 2. Smoke test endpoints del paciente
curl -H "Authorization: Bearer $PATIENT_TOKEN" \
  http://localhost:4001/api/paciente/bienestar/hoy
# → null (primera vez)

curl -X POST -H "Authorization: Bearer $PATIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"estado":4,"sintomas":[],"nota":"Me siento bien"}' \
  http://localhost:4001/api/paciente/bienestar
# → 201 con el registro

curl -H "Authorization: Bearer $PATIENT_TOKEN" \
  http://localhost:4001/api/paciente/bienestar/hoy
# → el registro recién creado

curl -X POST -H "Authorization: Bearer $PATIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cintura_cm":82.5,"cadera_cm":98}' \
  http://localhost:4001/api/paciente/medidas
# → 201

curl -H "Authorization: Bearer $PATIENT_TOKEN" \
  http://localhost:4001/api/paciente/medidas/ultimas
# → la medida recién creada

# 3. Smoke test endpoint del profesional
curl -H "Authorization: Bearer $PRO_TOKEN" \
  http://localhost:4001/api/profesional/rpm/pacientes
# → array de pacientes con sparkline_peso y ultimo_bienestar

# 4. TypeScript sin errores
cd apps/api && npx tsc --noEmit
cd apps/web-patient && npx tsc --noEmit
cd apps/web-professional && npx tsc --noEmit
```

---

## Resumen de cambios

| Capa | Archivo | Cambio |
|------|---------|--------|
| Migración | `0NN_registro_bienestar.sql` | Tabla: `registro_bienestar` con UNIQUE por (paciente, día) |
| Migración | `0NN1_registro_medida_corporal.sql` | Tabla: `registro_medida_corporal` con fuente paciente/consulta |
| API | `src/paciente/bienestar.ts` | GET hoy, GET historial, POST UPSERT |
| API | `src/paciente/medidas.ts` | GET últimas, GET historial, POST UPSERT |
| API | `src/profesional/rpm.ts` | GET panel todos los pacientes + GET detalle individual |
| PWA | `src/lib/bienestar.ts` | Constantes de emojis y síntomas |
| PWA | `src/components/BienestarTab.tsx` | Check-in diario + historial en tira |
| PWA | `src/components/CuerpoTab.tsx` | Silueta SVG + formulario de medidas |
| PWA | `src/pages/MisRegistrosPage.tsx` | 5 sub-tabs con scroll horizontal |
| PWA | `src/pages/InicioPage.tsx` | Tarjeta "¿Cómo te sientes?" si sin check-in |
| Pro | `src/components/SparklineInline.tsx` | SVG sparkline con indicador de tendencia |
| Pro | `src/pages/RPMPage.tsx` | Tabla de monitoreo con semáforo de adherencia |
| Pro | `src/pages/RPMDetallePage.tsx` | Gráfica de peso + bienestar + heatmap de diario |
| Pro | `src/App.tsx` | Rutas `/rpm` y `/rpm/:id` |
| Pro | Sidebar | Ítem "Monitoreo" |
