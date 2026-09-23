# R23 — PAC-05 Metas y progreso + PAC-06 Tareas del paciente

## Contexto obligatorio — leer antes de tocar cualquier archivo

- Monorepo: `apps/api` (Fastify), `apps/web-patient` (Vite + React, puerto 5175), `apps/web-professional` (Vite + React, puerto 5173)
- Columnas reales: `paciente.correo`, `paciente.nombre_completo`, `paciente.estado`, `paciente.sexo_biologico`, `clinica.nombre_comercial`
- `clinica_id` del paciente: `SELECT clinica_id FROM paciente WHERE keycloak_user_id = request.user.sub`
- `clinica_id` del profesional: `request.auth.tenantId`
- `profesional_id` del profesional: `SELECT id FROM profesional WHERE keycloak_user_id = request.user.sub`
- Colores vía CSS vars o Tailwind — nunca hex hardcodeado
- Nunca DELETE físico — soft-delete con `estado = 'archivada'`
- Gráficas solo SVG — sin recharts ni ninguna librería de charting
- Framework API: **Fastify**
- Tablas de r22 ya existentes: `registro_comida`, `registro_metrica`
- El plan nutricional del paciente vive en `conclusion_valoracion.plan_nutricional` (JSONB) de la última consulta finalizada. Los campos relevantes son: `kcal_objetivo`, `proteinas_g`, `carbohidratos_g`, `grasas_g`, `peso_objetivo`, `fecha_objetivo_peso`

---

## Paso 0 — Verificar prerequisitos

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('registro_comida', 'registro_metrica', 'conclusion_valoracion', 'profesional');
```

Si alguna falta, detener y avisar: "Ejecuta r22 primero."

---

## Paso 1 — Migration 024: tareas del paciente

Crear `apps/api/src/db/migrations/024_tarea_paciente.sql`:

```sql
CREATE TYPE prioridad_tarea AS ENUM ('alta', 'normal', 'baja');
CREATE TYPE estado_tarea    AS ENUM ('pendiente', 'completada', 'archivada');

CREATE TABLE tarea_paciente (
  id             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id     UUID           NOT NULL REFERENCES clinica(id),
  paciente_id    UUID           NOT NULL REFERENCES paciente(id),
  profesional_id UUID           NOT NULL REFERENCES profesional(id),
  consulta_id    UUID           REFERENCES consulta(id),   -- opcional; vincula la tarea a una consulta
  titulo         TEXT           NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 200),
  descripcion    TEXT,
  fecha_limite   DATE,
  prioridad      prioridad_tarea NOT NULL DEFAULT 'normal',
  estado         estado_tarea    NOT NULL DEFAULT 'pendiente',
  completada_en  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- Índice para la vista del paciente: tareas pendientes ordenadas por límite
CREATE INDEX idx_tarea_pendiente
  ON tarea_paciente (clinica_id, paciente_id, fecha_limite NULLS LAST)
  WHERE estado = 'pendiente';

-- Índice para la vista del profesional: todas las tareas de sus pacientes
CREATE INDEX idx_tarea_profesional
  ON tarea_paciente (clinica_id, profesional_id, estado, created_at DESC);
```

Ejecutar contra la base de datos.

---

## Paso 2 — API PAC-05: datos de progreso

Crear `apps/api/src/pac/progreso.routes.ts`. Registrar en el módulo PAC.

### GET /api/paciente/progreso

Devuelve en una sola llamada todo lo necesario para la pantalla de progreso: objetivo de peso, tendencia de peso semanal, kcal promedio semanal, y resumen de métricas adicionales.

```typescript
fastify.get('/api/paciente/progreso', {
  onRequest: [fastify.authenticate],
  schema: {
    querystring: {
      type: 'object',
      properties: {
        meses: { type: 'integer', minimum: 1, maximum: 24, default: 6 },
      },
    },
  },
}, async (request, reply) => {
  const sub   = (request.user as { sub: string }).sub;
  const meses = (request.query as { meses?: number }).meses ?? 6;

  const { rows: [pac] } = await pool.query<{ id: string; clinica_id: string }>(
    "SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1 AND estado = 'activo'",
    [sub]
  );
  if (!pac) return reply.status(404).send({ error: 'Paciente no encontrado' });

  const desde = new Date();
  desde.setMonth(desde.getMonth() - meses);
  const desdeStr = desde.toISOString().slice(0, 10);

  // ── Plan nutricional activo ───────────────────────────────────────────────
  const { rows: [planRow] } = await pool.query(
    `SELECT cv.plan_nutricional
     FROM   conclusion_valoracion cv
     JOIN   consulta c ON c.id = cv.consulta_id
     WHERE  c.paciente_id = $1 AND c.clinica_id = $2 AND c.estado = 'finalizada'
     ORDER  BY c.created_at DESC
     LIMIT  1`,
    [pac.id, pac.clinica_id]
  );
  const plan = planRow?.plan_nutricional ?? null;

  // ── Tendencia de peso (promedio semanal) ──────────────────────────────────
  const { rows: tendenciaPeso } = await pool.query(
    `SELECT DATE_TRUNC('week', fecha)::date::text AS semana,
            ROUND(AVG(valor)::numeric, 1)         AS peso_promedio,
            ROUND(MIN(valor)::numeric, 1)         AS peso_min,
            ROUND(MAX(valor)::numeric, 1)         AS peso_max,
            COUNT(*)::int                          AS num_registros
     FROM   registro_metrica
     WHERE  paciente_id = $1 AND clinica_id = $2
       AND  tipo = 'peso' AND activo = true
       AND  fecha >= $3
     GROUP  BY semana
     ORDER  BY semana`,
    [pac.id, pac.clinica_id, desdeStr]
  );

  // ── Kcal promedio semanal (de comidas registradas) ────────────────────────
  const { rows: tendenciaKcal } = await pool.query(
    `SELECT DATE_TRUNC('week', fecha)::date::text AS semana,
            ROUND(SUM(kcal)::numeric / NULLIF(COUNT(DISTINCT fecha), 0), 0) AS kcal_dia_promedio,
            COUNT(DISTINCT fecha)::int AS dias_con_registro
     FROM   registro_comida
     WHERE  paciente_id = $1 AND clinica_id = $2 AND activo = true
       AND  fecha >= $3 AND kcal IS NOT NULL
     GROUP  BY semana
     ORDER  BY semana`,
    [pac.id, pac.clinica_id, desdeStr]
  );

  // ── Lectura inicial y actual de peso (para calcular avance) ──────────────
  const { rows: extremosPeso } = await pool.query(
    `SELECT
       FIRST_VALUE(valor) OVER (ORDER BY fecha ASC)  AS peso_inicial,
       FIRST_VALUE(valor) OVER (ORDER BY fecha DESC) AS peso_actual,
       FIRST_VALUE(fecha::text) OVER (ORDER BY fecha ASC) AS fecha_inicial
     FROM registro_metrica
     WHERE paciente_id = $1 AND clinica_id = $2 AND tipo = 'peso' AND activo = true
     LIMIT 1`,
    [pac.id, pac.clinica_id]
  );

  // ── Otras métricas: última lectura de cada tipo ───────────────────────────
  const { rows: otrasMetricas } = await pool.query(
    `SELECT DISTINCT ON (tipo) tipo, valor, sistolica, diastolica, unidad, fecha::text
     FROM   registro_metrica
     WHERE  paciente_id = $1 AND clinica_id = $2 AND activo = true
       AND  tipo != 'peso'
     ORDER  BY tipo, fecha DESC`,
    [pac.id, pac.clinica_id]
  );

  const ep = extremosPeso[0] ?? null;

  return reply.send({
    plan,
    pesoInicial: ep ? parseFloat(ep.peso_inicial) : null,
    pesoActual:  ep ? parseFloat(ep.peso_actual)  : null,
    fechaInicial: ep?.fecha_inicial ?? null,
    pesoObjetivo: plan?.peso_objetivo ?? null,
    fechaObjetivoPeso: plan?.fecha_objetivo_peso ?? null,
    tendenciaPeso,
    tendenciaKcal,
    otrasMetricas,
    periodoMeses: meses,
  });
});
```

---

## Paso 3 — API PAC-06: tareas del paciente (lado paciente)

Agregar a `apps/api/src/pac/tareas.routes.ts`. Registrar en el módulo PAC.

### GET /api/paciente/tareas

```typescript
fastify.get('/api/paciente/tareas', {
  onRequest: [fastify.authenticate],
  schema: {
    querystring: {
      type: 'object',
      properties: {
        estado: { type: 'string', enum: ['pendiente', 'completada', 'todas'], default: 'pendiente' },
      },
    },
  },
}, async (request, reply) => {
  const sub    = (request.user as { sub: string }).sub;
  const estado = (request.query as { estado?: string }).estado ?? 'pendiente';

  const { rows: [pac] } = await pool.query<{ id: string; clinica_id: string }>(
    "SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1 AND estado = 'activo'",
    [sub]
  );
  if (!pac) return reply.status(404).send({ error: 'Paciente no encontrado' });

  const filtroEstado = estado === 'todas'
    ? "AND t.estado != 'archivada'"
    : "AND t.estado = $3";
  const params: unknown[] = [pac.id, pac.clinica_id];
  if (estado !== 'todas') params.push(estado);

  const { rows } = await pool.query(
    `SELECT t.id, t.titulo, t.descripcion, t.fecha_limite,
            t.prioridad, t.estado, t.completada_en, t.created_at,
            p.nombre_completo AS profesional_nombre
     FROM   tarea_paciente t
     JOIN   profesional p ON p.id = t.profesional_id
     WHERE  t.paciente_id = $1 AND t.clinica_id = $2 ${filtroEstado}
     ORDER  BY
       CASE t.prioridad WHEN 'alta' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
       t.fecha_limite NULLS LAST,
       t.created_at DESC`,
    params
  );

  return reply.send(rows);
});
```

### PATCH /api/paciente/tareas/:id/completar

```typescript
fastify.patch('/api/paciente/tareas/:id/completar', {
  onRequest: [fastify.authenticate],
}, async (request, reply) => {
  const { id } = request.params as { id: string };
  const sub    = (request.user as { sub: string }).sub;

  const { rows: [pac] } = await pool.query<{ id: string; clinica_id: string }>(
    "SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1",
    [sub]
  );
  if (!pac) return reply.status(404).send({ error: 'Paciente no encontrado' });

  const { rows: [tarea] } = await pool.query(
    `UPDATE tarea_paciente
     SET    estado = 'completada', completada_en = now(), updated_at = now()
     WHERE  id = $1 AND paciente_id = $2 AND clinica_id = $3 AND estado = 'pendiente'
     RETURNING id, estado, completada_en`,
    [id, pac.id, pac.clinica_id]
  );

  if (!tarea) return reply.status(404).send({ error: 'Tarea no encontrada o ya completada' });
  return reply.send(tarea);
});
```

### PATCH /api/paciente/tareas/:id/descompletar

Para deshacer un completado accidental (solo si fue completada recientemente — menos de 24 h).

```typescript
fastify.patch('/api/paciente/tareas/:id/descompletar', {
  onRequest: [fastify.authenticate],
}, async (request, reply) => {
  const { id } = request.params as { id: string };
  const sub    = (request.user as { sub: string }).sub;

  const { rows: [pac] } = await pool.query<{ id: string; clinica_id: string }>(
    "SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1",
    [sub]
  );
  if (!pac) return reply.status(404).send({ error: 'Paciente no encontrado' });

  const { rows: [tarea] } = await pool.query(
    `UPDATE tarea_paciente
     SET    estado = 'pendiente', completada_en = null, updated_at = now()
     WHERE  id = $1 AND paciente_id = $2 AND clinica_id = $3
       AND  estado = 'completada'
       AND  completada_en > now() - INTERVAL '24 hours'
     RETURNING id, estado`,
    [id, pac.id, pac.clinica_id]
  );

  if (!tarea) return reply.status(404).send({ error: 'Tarea no encontrada o no reversible' });
  return reply.send(tarea);
});
```

---

## Paso 4 — API PAC-06: tareas del paciente (lado profesional)

Agregar a `apps/api/src/profesional/tareas.routes.ts`. Registrar en el módulo profesional.

### POST /api/profesional/pacientes/:pacienteId/tareas

```typescript
fastify.post('/api/profesional/pacientes/:pacienteId/tareas', {
  onRequest: [fastify.authenticate],
  schema: {
    body: {
      type: 'object',
      required: ['titulo'],
      properties: {
        titulo:       { type: 'string', minLength: 1, maxLength: 200 },
        descripcion:  { type: 'string', maxLength: 1000 },
        fecha_limite: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        prioridad:    { type: 'string', enum: ['alta', 'normal', 'baja'] },
        consulta_id:  { type: 'string', format: 'uuid' },
      },
    },
  },
}, async (request, reply) => {
  const clinicaId     = (request.auth as { tenantId: string }).tenantId;
  const { pacienteId } = request.params as { pacienteId: string };
  const body           = request.body as {
    titulo: string; descripcion?: string; fecha_limite?: string;
    prioridad?: string; consulta_id?: string;
  };
  const sub = (request.user as { sub: string }).sub;

  // Obtener profesional_id del JWT
  const { rows: [prof] } = await pool.query<{ id: string }>(
    'SELECT id FROM profesional WHERE keycloak_user_id = $1 AND clinica_id = $2',
    [sub, clinicaId]
  );
  if (!prof) return reply.status(403).send({ error: 'Profesional no encontrado' });

  // Verificar que el paciente pertenece a esta clínica
  const { rows: [pac] } = await pool.query(
    'SELECT id FROM paciente WHERE id = $1 AND clinica_id = $2',
    [pacienteId, clinicaId]
  );
  if (!pac) return reply.status(404).send({ error: 'Paciente no encontrado' });

  const { rows: [tarea] } = await pool.query(
    `INSERT INTO tarea_paciente
       (clinica_id, paciente_id, profesional_id, consulta_id, titulo, descripcion, fecha_limite, prioridad)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [clinicaId, pac.id, prof.id, body.consulta_id ?? null,
     body.titulo, body.descripcion ?? null, body.fecha_limite ?? null,
     body.prioridad ?? 'normal']
  );

  return reply.status(201).send(tarea);
});
```

### GET /api/profesional/pacientes/:pacienteId/tareas

```typescript
fastify.get('/api/profesional/pacientes/:pacienteId/tareas', {
  onRequest: [fastify.authenticate],
}, async (request, reply) => {
  const clinicaId      = (request.auth as { tenantId: string }).tenantId;
  const { pacienteId } = request.params as { pacienteId: string };

  const { rows } = await pool.query(
    `SELECT t.*, p.nombre_completo AS profesional_nombre
     FROM   tarea_paciente t
     JOIN   profesional p ON p.id = t.profesional_id
     WHERE  t.paciente_id = $1 AND t.clinica_id = $2 AND t.estado != 'archivada'
     ORDER  BY
       CASE t.estado WHEN 'pendiente' THEN 0 ELSE 1 END,
       CASE t.prioridad WHEN 'alta' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
       t.fecha_limite NULLS LAST`,
    [pacienteId, clinicaId]
  );

  return reply.send(rows);
});
```

### PATCH /api/profesional/tareas/:id

Editar o archivar una tarea (soft-delete = archivar).

```typescript
fastify.patch('/api/profesional/tareas/:id', {
  onRequest: [fastify.authenticate],
  schema: {
    body: {
      type: 'object',
      properties: {
        titulo:       { type: 'string', minLength: 1, maxLength: 200 },
        descripcion:  { type: 'string' },
        fecha_limite: { type: ['string', 'null'] },
        prioridad:    { type: 'string', enum: ['alta', 'normal', 'baja'] },
        estado:       { type: 'string', enum: ['pendiente', 'archivada'] },
      },
    },
  },
}, async (request, reply) => {
  const clinicaId = (request.auth as { tenantId: string }).tenantId;
  const { id }    = request.params as { id: string };
  const body      = request.body as Record<string, unknown>;

  const sets: string[] = ['updated_at = now()'];
  const vals: unknown[] = [];
  let   idx = 1;

  for (const campo of ['titulo', 'descripcion', 'fecha_limite', 'prioridad', 'estado']) {
    if (campo in body) { sets.push(`${campo} = $${idx++}`); vals.push(body[campo]); }
  }

  vals.push(id, clinicaId);
  const { rows: [tarea] } = await pool.query(
    `UPDATE tarea_paciente SET ${sets.join(', ')}
     WHERE id = $${idx++} AND clinica_id = $${idx}
     RETURNING *`,
    vals
  );

  if (!tarea) return reply.status(404).send({ error: 'Tarea no encontrada' });
  return reply.send(tarea);
});
```

---

## Paso 5 — Frontend PAC-05: pantalla "Mi progreso"

Agregar un tercer sub-tab **Progreso** dentro de `MisRegistros.tsx` (junto a Comidas y Métricas):

```typescript
const TABS = ['Comidas', 'Métricas', 'Progreso'] as const;
```

Crear `apps/web-patient/src/features/registros/MiProgreso.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';

type Periodo = 3 | 6 | 12;

interface DatosProgreso {
  plan: { kcal_objetivo?: number; peso_objetivo?: number; fecha_objetivo_peso?: string } | null;
  pesoInicial: number | null;
  pesoActual: number | null;
  fechaInicial: string | null;
  pesoObjetivo: number | null;
  tendenciaPeso: { semana: string; peso_promedio: number; num_registros: number }[];
  tendenciaKcal: { semana: string; kcal_dia_promedio: number; dias_con_registro: number }[];
  otrasMetricas: { tipo: string; valor?: number; sistolica?: number; diastolica?: number; unidad: string; fecha: string }[];
}

export function MiProgreso() {
  const { token }               = useAuth();
  const [meses, setMeses]       = useState<Periodo>(6);
  const [datos, setDatos]       = useState<DatosProgreso | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    setCargando(true);
    fetch(`/api/paciente/progreso?meses=${meses}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(setDatos)
      .finally(() => setCargando(false));
  }, [meses, token]);

  if (cargando) return <div className="p-4 space-y-4">{[...Array(4)].map((_, i) => <div key={i} className="h-32 bg-surface-dim rounded-2xl animate-pulse" />)}</div>;
  if (!datos)   return null;

  const { plan, pesoInicial, pesoActual, pesoObjetivo, tendenciaPeso, tendenciaKcal, otrasMetricas } = datos;

  // ── Cálculo de progreso hacia el objetivo de peso ─────────────────────────
  const hayDatosPeso = pesoInicial != null && pesoActual != null;
  const hayObjetivo  = pesoObjetivo != null;
  const deltaTotalNecesario = hayDatosPeso && hayObjetivo ? Math.abs(pesoInicial! - pesoObjetivo!) : 0;
  const deltaLogrado        = hayDatosPeso && hayObjetivo ? Math.abs(pesoInicial! - pesoActual!)   : 0;
  const pctPeso             = deltaTotalNecesario > 0 ? Math.min((deltaLogrado / deltaTotalNecesario) * 100, 100) : 0;
  const bajando             = hayObjetivo && hayDatosPeso && pesoObjetivo! < pesoInicial!;

  return (
    <div className="p-4 space-y-5 pb-8">

      {/* Selector de período */}
      <div className="flex gap-2">
        {([3, 6, 12] as Periodo[]).map(m => (
          <button key={m} onClick={() => setMeses(m)}
            className={`flex-1 py-1.5 rounded-lg text-sm font-semibold transition-colors ${meses === m ? 'bg-primary text-white' : 'bg-surface-dim text-muted'}`}>
            {m} meses
          </button>
        ))}
      </div>

      {/* Card: progreso hacia el objetivo de peso */}
      {hayDatosPeso && (
        <div className="bg-surface rounded-2xl border border-border p-4 space-y-4">
          <h3 className="text-sm font-bold">Progreso de peso</h3>

          {/* Gauge circular SVG */}
          <div className="flex items-center gap-4">
            <GaugePeso pct={pctPeso} pesoActual={pesoActual!} pesoObjetivo={pesoObjetivo} />
            <div className="flex-1 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Inicio</span>
                <span className="font-semibold">{pesoInicial!.toFixed(1)} kg</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Actual</span>
                <span className="font-semibold text-primary">{pesoActual!.toFixed(1)} kg</span>
              </div>
              {hayObjetivo && (
                <div className="flex justify-between">
                  <span className="text-muted">Objetivo</span>
                  <span className="font-semibold">{pesoObjetivo!.toFixed(1)} kg</span>
                </div>
              )}
              {hayDatosPeso && hayObjetivo && (
                <div className="flex justify-between pt-1 border-t border-border">
                  <span className="text-muted">{bajando ? 'Por bajar' : 'Por ganar'}</span>
                  <span className={`font-bold ${Math.abs(pesoActual! - pesoObjetivo!) < 0.5 ? 'text-primary' : ''}`}>
                    {Math.abs(pesoActual! - pesoObjetivo!).toFixed(1)} kg
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Gráfica de tendencia de peso semanal */}
      {tendenciaPeso.length > 1 && (
        <div className="bg-surface rounded-2xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-bold">Peso semanal</h3>
          <GraficaLinea
            datos={tendenciaPeso}
            campoY="peso_promedio"
            etiquetaY="kg"
            lineaObjetivo={pesoObjetivo ?? undefined}
            etiquetaObjetivo="Meta"
          />
          <p className="text-xs text-muted text-center">
            Promedio por semana · {tendenciaPeso.length} semanas registradas
          </p>
        </div>
      )}

      {/* Gráfica de kcal semanal vs objetivo */}
      {tendenciaKcal.length > 1 && (
        <div className="bg-surface rounded-2xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-bold">Calorías diarias (promedio semanal)</h3>
          <GraficaBarras
            datos={tendenciaKcal}
            campoY="kcal_dia_promedio"
            lineaObjetivo={plan?.kcal_objetivo}
            etiquetaObjetivo={plan?.kcal_objetivo ? `Obj: ${plan.kcal_objetivo} kcal` : undefined}
          />
          <p className="text-xs text-muted text-center">Promedio del período con datos registrados</p>
        </div>
      )}

      {/* Otras métricas recientes */}
      {otrasMetricas.length > 0 && (
        <div className="bg-surface rounded-2xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-bold">Últimas mediciones</h3>
          {otrasMetricas.map(m => (
            <div key={m.tipo} className="flex justify-between items-center py-1 border-b border-border last:border-0">
              <span className="text-sm text-muted capitalize">{m.tipo.replace('_', ' ')}</span>
              <div className="text-right">
                <span className="text-sm font-semibold">
                  {m.tipo === 'presion_arterial' ? `${m.sistolica}/${m.diastolica}` : m.valor?.toFixed(1)}
                  {' '}{m.unidad}
                </span>
                <p className="text-[10px] text-muted">
                  {new Date(m.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Estado vacío: sin datos de peso */}
      {!hayDatosPeso && tendenciaPeso.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center px-4">
          <span className="text-5xl mb-4">📊</span>
          <p className="text-sm font-semibold text-foreground mb-1">Aún no hay datos de progreso</p>
          <p className="text-xs text-muted">Registra tu peso en la pestaña Métricas para ver tu evolución aquí.</p>
        </div>
      )}
    </div>
  );
}

// ─── Gauge circular ────────────────────────────────────────────────────────────
function GaugePeso({ pct, pesoActual, pesoObjetivo }: { pct: number; pesoActual: number; pesoObjetivo: number | null }) {
  const R = 42; const CX = 56; const CY = 56;
  const circum  = 2 * Math.PI * R;
  const arcoLen = (pct / 100) * circum * 0.75; // 270° de arco
  const offset  = circum * 0.125;              // comenzar desde las 7:30

  return (
    <svg width="112" height="112" viewBox="0 0 112 112">
      {/* Pista */}
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--color-border, #E5E7EB)"
        strokeWidth="10" strokeDasharray={`${circum * 0.75} ${circum * 0.25}`}
        strokeDashoffset={-offset} strokeLinecap="round" transform={`rotate(135 ${CX} ${CY})`} />
      {/* Progreso */}
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--color-primary, #0E7C66)"
        strokeWidth="10" strokeDasharray={`${arcoLen} ${circum - arcoLen}`}
        strokeDashoffset={-offset} strokeLinecap="round" transform={`rotate(135 ${CX} ${CY})`} />
      {/* Texto central */}
      <text x={CX} y={CY - 4} textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">
        {pesoActual.toFixed(1)}
      </text>
      <text x={CX} y={CY + 12} textAnchor="middle" fontSize="9" fill="#6B7280">kg</text>
      {pesoObjetivo && (
        <text x={CX} y={CY + 24} textAnchor="middle" fontSize="8" fill="#6B7280">
          meta {pesoObjetivo.toFixed(1)}
        </text>
      )}
    </svg>
  );
}

// ─── Gráfica de línea SVG ──────────────────────────────────────────────────────
function GraficaLinea({ datos, campoY, etiquetaY, lineaObjetivo, etiquetaObjetivo }: {
  datos: Record<string, number>[];
  campoY: string;
  etiquetaY: string;
  lineaObjetivo?: number;
  etiquetaObjetivo?: string;
}) {
  const W = 320; const H = 120; const PADX = 12; const PADY = 16;
  const valores = datos.map(d => d[campoY] as number);
  const allVals = lineaObjetivo != null ? [...valores, lineaObjetivo] : valores;
  const min = Math.min(...allVals); const max = Math.max(...allVals);
  const range = max - min || 1;

  const toX = (i: number) => PADX + (i / (valores.length - 1)) * (W - PADX * 2);
  const toY = (v: number) => PADY + ((max - v) / range) * (H - PADY * 2);

  const pts = valores.map((v, i) => ({ x: toX(i), y: toY(v), v }));
  const d   = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const dArea = `${d} L${pts[pts.length-1].x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      {/* Área */}
      <path d={dArea} fill="var(--color-primary, #0E7C66)" opacity="0.08" />
      {/* Línea objetivo */}
      {lineaObjetivo != null && (
        <>
          <line x1={PADX} y1={toY(lineaObjetivo)} x2={W - PADX} y2={toY(lineaObjetivo)}
            stroke="var(--color-danger, #E53E3E)" strokeWidth="1" strokeDasharray="4 3" />
          {etiquetaObjetivo && (
            <text x={W - PADX - 2} y={toY(lineaObjetivo) - 4} textAnchor="end" fontSize="8" fill="#E53E3E">{etiquetaObjetivo}</text>
          )}
        </>
      )}
      {/* Línea */}
      <path d={d} fill="none" stroke="var(--color-primary, #0E7C66)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Puntos */}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--color-primary, #0E7C66)" />
      ))}
      {/* Eje Y: min y max */}
      <text x={PADX} y={H - 4} fontSize="8" fill="#6B7280">{min.toFixed(1)} {etiquetaY}</text>
      <text x={PADX} y={12}     fontSize="8" fill="#6B7280">{max.toFixed(1)} {etiquetaY}</text>
    </svg>
  );
}

// ─── Gráfica de barras SVG ────────────────────────────────────────────────────
function GraficaBarras({ datos, campoY, lineaObjetivo, etiquetaObjetivo }: {
  datos: Record<string, number>[];
  campoY: string;
  lineaObjetivo?: number;
  etiquetaObjetivo?: string;
}) {
  const W = 320; const H = 100; const PADX = 8; const PADY = 12;
  const valores  = datos.map(d => d[campoY] as number);
  const allVals  = lineaObjetivo != null ? [...valores, lineaObjetivo] : valores;
  const maxVal   = Math.max(...allVals, 1);
  const barW     = Math.max(((W - PADX * 2) / valores.length) - 3, 4);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      {valores.map((v, i) => {
        const x  = PADX + i * ((W - PADX * 2) / valores.length);
        const h  = ((v / maxVal) * (H - PADY * 2));
        const y  = H - PADY - h;
        const sobre = lineaObjetivo != null && v > lineaObjetivo;
        return (
          <rect key={i} x={x} y={y} width={barW} height={h} rx="2"
            fill={sobre ? 'var(--color-accent, #F5A623)' : 'var(--color-primary, #0E7C66)'}
            opacity="0.85" />
        );
      })}
      {lineaObjetivo != null && (() => {
        const yObj = H - PADY - ((lineaObjetivo / maxVal) * (H - PADY * 2));
        return (
          <>
            <line x1={PADX} y1={yObj} x2={W - PADX} y2={yObj}
              stroke="var(--color-danger, #E53E3E)" strokeWidth="1" strokeDasharray="4 3" />
            {etiquetaObjetivo && (
              <text x={W - PADX - 2} y={yObj - 3} textAnchor="end" fontSize="8" fill="#E53E3E">{etiquetaObjetivo}</text>
            )}
          </>
        );
      })()}
    </svg>
  );
}
```

---

## Paso 6 — Frontend PAC-06: lista de tareas del paciente

Crear `apps/web-patient/src/features/tareas/MisTareas.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';

type EstadoFiltro = 'pendiente' | 'completada';

interface Tarea {
  id: string;
  titulo: string;
  descripcion?: string;
  fecha_limite?: string;
  prioridad: 'alta' | 'normal' | 'baja';
  estado: 'pendiente' | 'completada';
  completada_en?: string;
  profesional_nombre: string;
}

const PRIORIDAD_COLOR: Record<string, string> = {
  alta:   'bg-danger/10 text-danger border-danger/20',
  normal: 'bg-primary-tint text-primary border-primary/20',
  baja:   'bg-surface-dim text-muted border-border',
};

export function MisTareas() {
  const { token }                 = useAuth();
  const [filtro, setFiltro]       = useState<EstadoFiltro>('pendiente');
  const [tareas, setTareas]       = useState<Tarea[]>([]);
  const [cargando, setCargando]   = useState(false);
  const [procesando, setProcesando] = useState<string | null>(null);

  const fetchTareas = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/paciente/tareas?estado=${filtro}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setTareas(await res.json());
    } finally {
      setCargando(false);
    }
  }, [filtro, token]);

  useEffect(() => { fetchTareas(); }, [fetchTareas]);

  const completar = async (id: string) => {
    setProcesando(id);
    try {
      await fetch(`/api/paciente/tareas/${id}/completar`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchTareas();
    } finally {
      setProcesando(null);
    }
  };

  const descompletar = async (id: string) => {
    setProcesando(id);
    try {
      await fetch(`/api/paciente/tareas/${id}/descompletar`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchTareas();
    } finally {
      setProcesando(null);
    }
  };

  const hoy = new Date().toISOString().slice(0, 10);

  const estaVencida = (t: Tarea) =>
    t.estado === 'pendiente' && t.fecha_limite && t.fecha_limite < hoy;

  return (
    <div className="p-4 space-y-4">
      {/* Filtro pendiente / completadas */}
      <div className="flex gap-2">
        {(['pendiente', 'completada'] as EstadoFiltro[]).map(f => (
          <button key={f} onClick={() => setFiltro(f)}
            className={`flex-1 py-1.5 rounded-lg text-sm font-semibold capitalize transition-colors ${filtro === f ? 'bg-primary text-white' : 'bg-surface-dim text-muted'}`}>
            {f === 'pendiente' ? 'Pendientes' : 'Completadas'}
          </button>
        ))}
      </div>

      {/* Lista */}
      {cargando
        ? [...Array(3)].map((_, i) => <div key={i} className="h-20 bg-surface-dim rounded-2xl animate-pulse" />)
        : tareas.length === 0
          ? (
            <div className="flex flex-col items-center py-16 text-center px-4">
              <span className="text-5xl mb-4">{filtro === 'pendiente' ? '✅' : '📋'}</span>
              <p className="text-sm font-semibold">
                {filtro === 'pendiente' ? '¡Sin tareas pendientes!' : 'Aún no has completado tareas'}
              </p>
              <p className="text-xs text-muted mt-1">
                {filtro === 'pendiente'
                  ? 'Tu nutricionista te asignará tareas desde las consultas'
                  : 'Las tareas que completes aparecerán aquí'}
              </p>
            </div>
          )
          : tareas.map(tarea => (
            <div key={tarea.id}
              className={[
                'bg-surface rounded-2xl border p-4 space-y-2',
                estaVencida(tarea) ? 'border-danger/40 bg-danger/5' : 'border-border',
                tarea.estado === 'completada' ? 'opacity-70' : '',
              ].join(' ')}
            >
              <div className="flex items-start gap-3">
                {/* Checkbox */}
                <button
                  onClick={() => tarea.estado === 'pendiente' ? completar(tarea.id) : descompletar(tarea.id)}
                  disabled={procesando === tarea.id}
                  className={[
                    'mt-0.5 w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all',
                    tarea.estado === 'completada'
                      ? 'bg-primary border-primary text-white'
                      : 'border-border hover:border-primary',
                    procesando === tarea.id ? 'opacity-50' : '',
                  ].join(' ')}
                >
                  {tarea.estado === 'completada' && <span className="text-xs font-bold">✓</span>}
                </button>

                {/* Contenido */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold leading-snug ${tarea.estado === 'completada' ? 'line-through text-muted' : 'text-foreground'}`}>
                    {tarea.titulo}
                  </p>
                  {tarea.descripcion && (
                    <p className="text-xs text-muted mt-0.5 leading-relaxed">{tarea.descripcion}</p>
                  )}

                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {/* Prioridad */}
                    {tarea.prioridad !== 'normal' && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${PRIORIDAD_COLOR[tarea.prioridad]}`}>
                        {tarea.prioridad === 'alta' ? '↑ Alta' : '↓ Baja'}
                      </span>
                    )}

                    {/* Fecha límite */}
                    {tarea.fecha_limite && (
                      <span className={`text-[10px] font-medium ${estaVencida(tarea) ? 'text-danger' : 'text-muted'}`}>
                        {estaVencida(tarea) ? '⚠ Venció' : '📅'}{' '}
                        {new Date(tarea.fecha_limite + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                      </span>
                    )}

                    {/* Asignada por */}
                    <span className="text-[10px] text-muted">
                      {tarea.profesional_nombre.split(' ').slice(0, 2).join(' ')}
                    </span>

                    {/* Completada en */}
                    {tarea.completada_en && (
                      <span className="text-[10px] text-primary">
                        ✓ {new Date(tarea.completada_en).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
      }
    </div>
  );
}
```

---

## Paso 7 — Integrar tareas en el Dashboard del paciente (Inicio)

Leer `apps/web-patient/src/pages/Inicio.tsx`. Agregar una card de tareas pendientes justo debajo de la cita próxima (o al inicio del scroll si no hay cita):

```tsx
// Hook para contar tareas pendientes (llamada ligera)
const [tareasCount, setTareasCount] = useState(0);
useEffect(() => {
  fetch('/api/paciente/tareas?estado=pendiente', {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(r => r.json())
    .then((t: unknown[]) => setTareasCount(t.length))
    .catch(() => {});
}, [token]);

// JSX de la card — solo si hay tareas pendientes
{tareasCount > 0 && (
  <button
    onClick={() => navigate('/tareas')}
    className="w-full bg-surface rounded-2xl border border-border p-4 flex items-center justify-between text-left hover:border-primary transition-colors"
  >
    <div className="flex items-center gap-3">
      <span className="text-2xl">📋</span>
      <div>
        <p className="text-sm font-semibold">
          {tareasCount} {tareasCount === 1 ? 'tarea pendiente' : 'tareas pendientes'}
        </p>
        <p className="text-xs text-muted">Asignadas por tu nutricionista</p>
      </div>
    </div>
    <span className="text-muted">›</span>
  </button>
)}
```

Agregar la ruta `/tareas` en el router que renderiza `<MisTareas />`.

> La lista de tareas NO requiere un tab en la nav inferior — se accede desde el dashboard para no saturar la barra de navegación.

---

## Paso 8 — Vista del profesional: gestión de tareas por paciente

Leer el expediente del paciente en `apps/web-professional` para identificar dónde agregar una sección de tareas. Dentro del expediente del paciente, agregar una tab o sección **"Tareas"** con:

**Lista de tareas asignadas**:
- Tabla compacta: título · prioridad chip · fecha límite · estado badge · acciones
- Botón "+ Nueva tarea" en el header de la sección
- Tareas completadas aparecen con fila opacada y texto tachado

**Formulario de nueva tarea** (inline collapsible o modal pequeño):

```tsx
function FormNuevaTarea({ pacienteId, token, clinicaId, onCreada }: {
  pacienteId: string; token: string; clinicaId: string;
  onCreada: () => void;
}) {
  const [titulo, setTitulo]       = useState('');
  const [desc, setDesc]           = useState('');
  const [limite, setLimite]       = useState('');
  const [prioridad, setPrioridad] = useState<'alta' | 'normal' | 'baja'>('normal');
  const [enviando, setEnviando]   = useState(false);
  const [abierto, setAbierto]     = useState(false);

  const crear = async () => {
    if (!titulo.trim()) return;
    setEnviando(true);
    try {
      await fetch(`/api/profesional/pacientes/${pacienteId}/tareas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          titulo: titulo.trim(),
          descripcion: desc.trim() || undefined,
          fecha_limite: limite || undefined,
          prioridad,
        }),
      });
      setTitulo(''); setDesc(''); setLimite(''); setPrioridad('normal'); setAbierto(false);
      onCreada();
    } finally {
      setEnviando(false);
    }
  };

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)}
        className="flex items-center gap-2 text-sm font-semibold text-primary hover:opacity-80">
        <span>+</span> Nueva tarea
      </button>
    );
  }

  return (
    <div className="bg-surface-dim rounded-xl border border-border p-4 space-y-3">
      <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Título de la tarea *"
        className="w-full border border-border rounded-lg p-2 text-sm focus:outline-none focus:border-primary" />
      <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2}
        placeholder="Descripción opcional"
        className="w-full border border-border rounded-lg p-2 text-sm resize-none focus:outline-none focus:border-primary" />
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-xs text-muted">Fecha límite</label>
          <input type="date" value={limite} onChange={e => setLimite(e.target.value)}
            className="w-full border border-border rounded-lg p-2 text-sm mt-0.5 focus:outline-none focus:border-primary" />
        </div>
        <div className="flex-1">
          <label className="text-xs text-muted">Prioridad</label>
          <select value={prioridad} onChange={e => setPrioridad(e.target.value as 'alta' | 'normal' | 'baja')}
            className="w-full border border-border rounded-lg p-2 text-sm mt-0.5 focus:outline-none focus:border-primary">
            <option value="alta">Alta</option>
            <option value="normal">Normal</option>
            <option value="baja">Baja</option>
          </select>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={() => setAbierto(false)} className="flex-1 py-2 border border-border rounded-lg text-sm text-muted">Cancelar</button>
        <button onClick={crear} disabled={!titulo.trim() || enviando}
          className="flex-1 py-2 bg-primary text-white rounded-lg text-sm font-semibold disabled:opacity-50">
          {enviando ? 'Creando…' : 'Crear tarea'}
        </button>
      </div>
    </div>
  );
}
```

---

## Paso 9 — Verificación

```bash
# 1. Migration aplicada
docker compose -f infra/docker-compose.dev.yml exec api \
  psql $DATABASE_URL -c "\d tarea_paciente"

# 2. Profesional crea una tarea (reemplazar IDs y token reales)
curl -s -X POST http://localhost:4001/api/profesional/pacientes/<PACIENTE_ID>/tareas \
  -H "Authorization: Bearer <TOKEN_PROF>" \
  -H "Content-Type: application/json" \
  -d '{"titulo":"Caminar 30 minutos diarios","prioridad":"alta","fecha_limite":"2025-06-30"}'

# 3. Paciente consulta sus tareas
curl -s http://localhost:4001/api/paciente/tareas \
  -H "Authorization: Bearer <TOKEN_PACIENTE>" | jq '.[].titulo'

# 4. Paciente completa la tarea
curl -s -X PATCH http://localhost:4001/api/paciente/tareas/<ID>/completar \
  -H "Authorization: Bearer <TOKEN_PACIENTE>" | jq '.estado'
# Debe devolver "completada"

# 5. Datos de progreso
curl -s "http://localhost:4001/api/paciente/progreso?meses=3" \
  -H "Authorization: Bearer <TOKEN_PACIENTE>" | jq '{pesoActual, pesoObjetivo}'

# 6. App del paciente (http://localhost:5175):
#    - "Mis registros" → sub-tab "Progreso" muestra el gauge y las gráficas SVG
#    - Dashboard (Inicio) → card "N tareas pendientes" lleva a /tareas
#    - En /tareas: tarea creada aparece en Pendientes; marcar → pasa a Completadas
#    - Desmarcar funciona solo dentro de las primeras 24 h

# 7. App del profesional (http://localhost:5173):
#    - Expediente del paciente → sección/tab "Tareas"
#    - Formulario "+ Nueva tarea" → crear → aparece en la lista
#    - Archivar tarea: estado queda 'archivada', desaparece de la vista por defecto
```

---

## Notas para r24

- **PAC-07 Contador de porciones/gramos**: al registrar comidas, opción de desglosar por alimento individual con peso en gramos y porción; requiere integración con una tabla de alimentos (catálogo básico o libre búsqueda)
- **PAC-08 Foro de información personalizada**: sección de artículos/recursos que el profesional publica para sus pacientes; los pacientes los ven como una biblioteca de contenido
- El `peso_objetivo` y `fecha_objetivo_peso` deben existir en el JSONB de `conclusion_valoracion.plan_nutricional` — si el EVAL no los guarda todavía, el profesional puede actualizarlos desde el expediente del paciente en un campo de edición rápida
