# R22 — PAC-03 Diario de comidas + PAC-04 Registro de métricas

## Contexto obligatorio — leer antes de tocar cualquier archivo

- Monorepo: `apps/api` (Fastify), `apps/web-patient` (Vite + React, puerto 5175)
- Columnas reales: `paciente.correo`, `paciente.nombre_completo`, `paciente.estado`, `paciente.sexo_biologico`, `clinica.nombre_comercial`
- `clinica_id` del paciente autenticado: **siempre** `SELECT clinica_id FROM paciente WHERE keycloak_user_id = request.user.sub`; nunca de query string ni body
- Colores vía CSS vars o clases Tailwind derivadas de tokens — nunca hex hardcodeado
- Nunca DELETE físico — soft-delete con `activo = false`
- Gráficas solo SVG — sin recharts ni ninguna librería externa de charting
- Framework API: **Fastify** (no Express)
- El plan nutricional del paciente vive en `conclusion_valoracion.plan_nutricional` de la última consulta finalizada; el endpoint `GET /api/paciente/plan` (R18) ya lo devuelve — reutilizarlo
- La navegación inferior del paciente actualmente tiene 3 tabs: Inicio · Mi plan · Mensajes

---

## Paso 0 — Verificar prerequisitos

```sql
-- Confirmar que R17/R18 dejaron las tablas base intactas
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('paciente', 'consulta', 'conclusion_valoracion', 'conversacion');
```

Si alguna falta, detener y avisar.

---

## Paso 1 — Migration 022: diario de comidas

Crear `apps/api/src/db/migrations/022_diario_comidas.sql`:

```sql
CREATE TYPE tipo_comida AS ENUM (
  'desayuno',
  'colacion_matutina',
  'almuerzo',
  'colacion_vespertina',
  'cena',
  'otro'
);

CREATE TABLE registro_comida (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id       UUID        NOT NULL REFERENCES clinica(id),
  paciente_id      UUID        NOT NULL REFERENCES paciente(id),
  fecha            DATE        NOT NULL DEFAULT CURRENT_DATE,
  tipo_comida      tipo_comida NOT NULL,
  descripcion      TEXT        NOT NULL CHECK (char_length(descripcion) BETWEEN 1 AND 1000),
  kcal             NUMERIC(7,1),
  proteina_g       NUMERIC(6,1),
  carbohidratos_g  NUMERIC(6,1),
  grasas_g         NUMERIC(6,1),
  activo           BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un slot por comida por día — el paciente edita, no acumula filas
  CONSTRAINT uq_slot_comida UNIQUE (paciente_id, fecha, tipo_comida)
);

CREATE INDEX idx_registro_comida_paciente
  ON registro_comida (clinica_id, paciente_id, fecha DESC)
  WHERE activo = true;
```

Ejecutar contra la base de datos del proyecto.

---

## Paso 2 — Migration 023: registro de métricas

Crear `apps/api/src/db/migrations/023_registro_metrica.sql`:

```sql
CREATE TYPE tipo_metrica AS ENUM ('peso', 'presion_arterial', 'glucosa', 'otro');

CREATE TABLE registro_metrica (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id       UUID         NOT NULL REFERENCES clinica(id),
  paciente_id      UUID         NOT NULL REFERENCES paciente(id),
  tipo             tipo_metrica NOT NULL,
  -- Peso y glucosa usan `valor`; presión arterial usa sistolica + diastolica
  valor            NUMERIC(8,2),
  sistolica        NUMERIC(5,1),
  diastolica       NUMERIC(5,1),
  unidad           TEXT         NOT NULL, -- 'kg', 'mmHg', 'mg/dL', etc.
  fecha            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  nota             TEXT,
  activo           BOOLEAN      NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT chk_presion CHECK (
    tipo != 'presion_arterial'
    OR (sistolica IS NOT NULL AND diastolica IS NOT NULL)
  ),
  CONSTRAINT chk_valor CHECK (
    tipo = 'presion_arterial' OR valor IS NOT NULL
  )
);

CREATE INDEX idx_registro_metrica_paciente
  ON registro_metrica (clinica_id, paciente_id, tipo, fecha DESC)
  WHERE activo = true;
```

Ejecutar contra la base de datos.

---

## Paso 3 — API PAC-03: diario de comidas

Crear `apps/api/src/pac/diario.routes.ts` con las siguientes rutas Fastify. Registrar el plugin en el archivo principal de rutas del módulo PAC.

### Helper para obtener el paciente autenticado

```typescript
// Reutilizar o extraer si ya existe en el módulo PAC
async function getPacienteAuth(pool: Pool, sub: string) {
  const { rows: [pac] } = await pool.query<{ id: string; clinica_id: string }>(
    'SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1 AND estado = \'activo\'',
    [sub]
  );
  return pac ?? null;
}
```

### GET /api/paciente/diario

Devuelve el diario de un día completo más los targets del plan nutricional activo.

```typescript
fastify.get('/api/paciente/diario', {
  onRequest: [fastify.authenticate],
  schema: {
    querystring: {
      type: 'object',
      properties: { fecha: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
    },
  },
}, async (request, reply) => {
  const sub   = (request.user as { sub: string }).sub;
  const fecha = (request.query as { fecha?: string }).fecha
             ?? new Date().toISOString().slice(0, 10);

  const pac = await getPacienteAuth(pool, sub);
  if (!pac) return reply.status(404).send({ error: 'Paciente no encontrado' });

  // Registros del día
  const { rows: registros } = await pool.query(
    `SELECT id, tipo_comida, descripcion, kcal, proteina_g, carbohidratos_g, grasas_g, updated_at
     FROM   registro_comida
     WHERE  paciente_id = $1 AND clinica_id = $2 AND fecha = $3 AND activo = true
     ORDER  BY tipo_comida`,
    [pac.id, pac.clinica_id, fecha]
  );

  // Targets del plan nutricional (última consulta finalizada)
  const { rows: [plan] } = await pool.query(
    `SELECT cv.plan_nutricional
     FROM   conclusion_valoracion cv
     JOIN   consulta c ON c.id = cv.consulta_id
     WHERE  c.paciente_id = $1 AND c.clinica_id = $2
       AND  c.estado = 'finalizada'
     ORDER  BY c.created_at DESC
     LIMIT  1`,
    [pac.id, pac.clinica_id]
  );

  // Totales del día
  const totalKcal     = registros.reduce((s, r) => s + (r.kcal ?? 0), 0);
  const totalProteina = registros.reduce((s, r) => s + (r.proteina_g ?? 0), 0);
  const totalCarbs    = registros.reduce((s, r) => s + (r.carbohidratos_g ?? 0), 0);
  const totalGrasas   = registros.reduce((s, r) => s + (r.grasas_g ?? 0), 0);

  return reply.send({
    fecha,
    registros,
    totales: { kcal: totalKcal, proteina_g: totalProteina, carbohidratos_g: totalCarbs, grasas_g: totalGrasas },
    targets: plan?.plan_nutricional ?? null,
  });
});
```

### POST /api/paciente/diario

UPSERT de un slot de comida (editar si ya existe el mismo tipo en esa fecha).

```typescript
fastify.post('/api/paciente/diario', {
  onRequest: [fastify.authenticate],
  schema: {
    body: {
      type: 'object',
      required: ['tipo_comida', 'descripcion'],
      properties: {
        fecha:           { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        tipo_comida:     { type: 'string', enum: ['desayuno','colacion_matutina','almuerzo','colacion_vespertina','cena','otro'] },
        descripcion:     { type: 'string', minLength: 1, maxLength: 1000 },
        kcal:            { type: 'number', minimum: 0, maximum: 9999 },
        proteina_g:      { type: 'number', minimum: 0 },
        carbohidratos_g: { type: 'number', minimum: 0 },
        grasas_g:        { type: 'number', minimum: 0 },
      },
    },
  },
}, async (request, reply) => {
  const sub  = (request.user as { sub: string }).sub;
  const body = request.body as {
    fecha?: string; tipo_comida: string; descripcion: string;
    kcal?: number; proteina_g?: number; carbohidratos_g?: number; grasas_g?: number;
  };
  const fecha = body.fecha ?? new Date().toISOString().slice(0, 10);

  const pac = await getPacienteAuth(pool, sub);
  if (!pac) return reply.status(404).send({ error: 'Paciente no encontrado' });

  const { rows: [registro] } = await pool.query(
    `INSERT INTO registro_comida
       (clinica_id, paciente_id, fecha, tipo_comida, descripcion, kcal, proteina_g, carbohidratos_g, grasas_g)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (paciente_id, fecha, tipo_comida) DO UPDATE
       SET descripcion      = EXCLUDED.descripcion,
           kcal             = EXCLUDED.kcal,
           proteina_g       = EXCLUDED.proteina_g,
           carbohidratos_g  = EXCLUDED.carbohidratos_g,
           grasas_g         = EXCLUDED.grasas_g,
           activo           = true,
           updated_at       = now()
     RETURNING *`,
    [pac.clinica_id, pac.id, fecha, body.tipo_comida, body.descripcion,
     body.kcal ?? null, body.proteina_g ?? null, body.carbohidratos_g ?? null, body.grasas_g ?? null]
  );

  return reply.status(201).send(registro);
});
```

### DELETE /api/paciente/diario/:id

Soft-delete de un registro (limpiar un slot).

```typescript
fastify.delete('/api/paciente/diario/:id', {
  onRequest: [fastify.authenticate],
}, async (request, reply) => {
  const { id } = request.params as { id: string };
  const sub    = (request.user as { sub: string }).sub;

  const pac = await getPacienteAuth(pool, sub);
  if (!pac) return reply.status(404).send({ error: 'Paciente no encontrado' });

  const { rows: [r] } = await pool.query(
    `UPDATE registro_comida SET activo = false, updated_at = now()
     WHERE id = $1 AND paciente_id = $2 AND clinica_id = $3
     RETURNING id`,
    [id, pac.id, pac.clinica_id]
  );
  if (!r) return reply.status(404).send({ error: 'Registro no encontrado' });

  return reply.status(204).send();
});
```

### GET /api/paciente/diario/semana

Resumen semanal: total de kcal por día para la mini gráfica.

```typescript
fastify.get('/api/paciente/diario/semana', {
  onRequest: [fastify.authenticate],
  schema: {
    querystring: {
      type: 'object',
      properties: { desde: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
    },
  },
}, async (request, reply) => {
  const sub   = (request.user as { sub: string }).sub;
  const desde = (request.query as { desde?: string }).desde
             ?? new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);

  const pac = await getPacienteAuth(pool, sub);
  if (!pac) return reply.status(404).send({ error: 'Paciente no encontrado' });

  const { rows } = await pool.query(
    `SELECT fecha::text, SUM(kcal) AS total_kcal, COUNT(*) AS num_registros
     FROM   registro_comida
     WHERE  paciente_id = $1 AND clinica_id = $2
       AND  fecha >= $3 AND activo = true
     GROUP  BY fecha
     ORDER  BY fecha`,
    [pac.id, pac.clinica_id, desde]
  );

  return reply.send(rows);
});
```

---

## Paso 4 — API PAC-04: registro de métricas

Crear `apps/api/src/pac/metricas.routes.ts`. Registrar en el módulo PAC.

### GET /api/paciente/metricas

Últimas N lecturas de un tipo de métrica.

```typescript
fastify.get('/api/paciente/metricas', {
  onRequest: [fastify.authenticate],
  schema: {
    querystring: {
      type: 'object',
      properties: {
        tipo:  { type: 'string', enum: ['peso','presion_arterial','glucosa','otro'] },
        limit: { type: 'integer', minimum: 1, maximum: 90, default: 30 },
      },
    },
  },
}, async (request, reply) => {
  const sub   = (request.user as { sub: string }).sub;
  const query = request.query as { tipo?: string; limit?: number };
  const pac   = await getPacienteAuth(pool, sub);
  if (!pac) return reply.status(404).send({ error: 'Paciente no encontrado' });

  const filtroTipo = query.tipo ? 'AND tipo = $4' : '';
  const params: unknown[] = [pac.id, pac.clinica_id, query.limit ?? 30];
  if (query.tipo) params.push(query.tipo);

  const { rows } = await pool.query(
    `SELECT id, tipo, valor, sistolica, diastolica, unidad, fecha, nota
     FROM   registro_metrica
     WHERE  paciente_id = $1 AND clinica_id = $2 AND activo = true ${filtroTipo}
     ORDER  BY fecha DESC
     LIMIT  $3`,
    params
  );

  return reply.send(rows);
});
```

### POST /api/paciente/metricas

```typescript
fastify.post('/api/paciente/metricas', {
  onRequest: [fastify.authenticate],
  schema: {
    body: {
      type: 'object',
      required: ['tipo', 'unidad'],
      properties: {
        tipo:       { type: 'string', enum: ['peso','presion_arterial','glucosa','otro'] },
        valor:      { type: 'number' },
        sistolica:  { type: 'number', minimum: 40, maximum: 300 },
        diastolica: { type: 'number', minimum: 20, maximum: 200 },
        unidad:     { type: 'string', maxLength: 20 },
        fecha:      { type: 'string' }, // ISO timestamp; si no viene, default now()
        nota:       { type: 'string', maxLength: 500 },
      },
    },
  },
}, async (request, reply) => {
  const sub  = (request.user as { sub: string }).sub;
  const body = request.body as {
    tipo: string; valor?: number; sistolica?: number; diastolica?: number;
    unidad: string; fecha?: string; nota?: string;
  };

  const pac = await getPacienteAuth(pool, sub);
  if (!pac) return reply.status(404).send({ error: 'Paciente no encontrado' });

  // Validar coherencia presión arterial
  if (body.tipo === 'presion_arterial') {
    if (!body.sistolica || !body.diastolica) {
      return reply.status(400).send({ error: 'Presión arterial requiere sistolica y diastolica' });
    }
  } else if (body.valor == null) {
    return reply.status(400).send({ error: 'Este tipo de métrica requiere el campo valor' });
  }

  const { rows: [registro] } = await pool.query(
    `INSERT INTO registro_metrica
       (clinica_id, paciente_id, tipo, valor, sistolica, diastolica, unidad, fecha, nota)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()), $9)
     RETURNING *`,
    [pac.clinica_id, pac.id, body.tipo, body.valor ?? null,
     body.sistolica ?? null, body.diastolica ?? null,
     body.unidad, body.fecha ?? null, body.nota ?? null]
  );

  return reply.status(201).send(registro);
});
```

### GET /api/paciente/metricas/resumen

Última lectura de cada tipo para mostrar en el dashboard.

```typescript
fastify.get('/api/paciente/metricas/resumen', {
  onRequest: [fastify.authenticate],
}, async (request, reply) => {
  const sub = (request.user as { sub: string }).sub;
  const pac = await getPacienteAuth(pool, sub);
  if (!pac) return reply.status(404).send({ error: 'Paciente no encontrado' });

  const { rows } = await pool.query(
    `SELECT DISTINCT ON (tipo)
       tipo, valor, sistolica, diastolica, unidad, fecha, nota
     FROM   registro_metrica
     WHERE  paciente_id = $1 AND clinica_id = $2 AND activo = true
     ORDER  BY tipo, fecha DESC`,
    [pac.id, pac.clinica_id]
  );

  // Indexar por tipo para acceso rápido en el frontend
  const resumen = Object.fromEntries(rows.map(r => [r.tipo, r]));
  return reply.send(resumen);
});
```

---

## Paso 5 — Actualizar la barra de navegación del paciente

Leer `apps/web-patient/src/components/NavBar.tsx` para ver la estructura actual (3 tabs: Inicio · Mi plan · Mensajes). Agregar el cuarto tab **Mis registros**:

```tsx
const TABS = [
  { to: '/inicio',      label: 'Inicio',        icon: HomeIcon      },
  { to: '/plan',        label: 'Mi plan',        icon: ClipboardIcon },
  { to: '/registros',   label: 'Mis registros',  icon: PencilIcon    },
  { to: '/mensajes',    label: 'Mensajes',       icon: MessageIcon   },
];
```

Ajustar el ancho de cada tab para que los 4 quepan cómodamente en 390 px.

---

## Paso 6 — Página "Mis registros" — tab router

Crear `apps/web-patient/src/pages/MisRegistros.tsx`:

```tsx
import { useState } from 'react';
import { DiarioComidas } from '../features/registros/DiarioComidas';
import { RegistroMetricas } from '../features/registros/RegistroMetricas';

const TABS = ['Comidas', 'Métricas'] as const;
type Tab = typeof TABS[number];

export function MisRegistros() {
  const [tab, setTab] = useState<Tab>('Comidas');

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tabs */}
      <div className="flex border-b border-border bg-surface sticky top-0 z-10">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'flex-1 py-3 text-sm font-semibold transition-colors',
              tab === t
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted hover:text-foreground',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'Comidas'   && <DiarioComidas />}
        {tab === 'Métricas'  && <RegistroMetricas />}
      </div>
    </div>
  );
}
```

Agregar la ruta `/registros` en el router principal de la app del paciente.

---

## Paso 7 — Componente: Diario de comidas

Crear `apps/web-patient/src/features/registros/DiarioComidas.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';

const SLOTS: { key: string; label: string; emoji: string }[] = [
  { key: 'desayuno',          label: 'Desayuno',        emoji: '🌅' },
  { key: 'colacion_matutina', label: 'Colación matutina', emoji: '🍎' },
  { key: 'almuerzo',          label: 'Almuerzo',        emoji: '☀️' },
  { key: 'colacion_vespertina', label: 'Colación vespertina', emoji: '🍌' },
  { key: 'cena',              label: 'Cena',            emoji: '🌙' },
];

interface Registro {
  id: string;
  tipo_comida: string;
  descripcion: string;
  kcal?: number;
  proteina_g?: number;
  carbohidratos_g?: number;
  grasas_g?: number;
}

interface DatosDelDia {
  fecha: string;
  registros: Registro[];
  totales: { kcal: number; proteina_g: number; carbohidratos_g: number; grasas_g: number };
  targets: { kcal_objetivo?: number; proteinas_g?: number; carbohidratos_g?: number; grasas_g?: number } | null;
}

export function DiarioComidas() {
  const { token }             = useAuth();
  const [fecha, setFecha]     = useState(new Date().toISOString().slice(0, 10));
  const [datos, setDatos]     = useState<DatosDelDia | null>(null);
  const [editando, setEditando] = useState<string | null>(null); // tipo_comida
  const [cargando, setCargando] = useState(false);

  const fetchDia = async (f: string) => {
    setCargando(true);
    try {
      const res  = await fetch(`/api/paciente/diario?fecha=${f}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setDatos(data);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { fetchDia(fecha); }, [fecha]);

  const registroPorTipo = (tipo: string) =>
    datos?.registros.find(r => r.tipo_comida === tipo);

  // Progreso kcal vs target
  const kcalObj   = datos?.targets?.kcal_objetivo ?? 0;
  const kcalLog   = datos?.totales.kcal ?? 0;
  const pctKcal   = kcalObj > 0 ? Math.min((kcalLog / kcalObj) * 100, 100) : 0;
  const colorKcal = pctKcal >= 100 ? 'bg-danger' : pctKcal >= 75 ? 'bg-accent' : 'bg-primary';

  return (
    <div className="p-4 space-y-4">
      {/* Selector de fecha */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            const d = new Date(fecha); d.setDate(d.getDate() - 1);
            setFecha(d.toISOString().slice(0, 10));
          }}
          className="p-2 rounded-xl bg-surface-dim hover:bg-border transition-colors"
        >
          ‹
        </button>
        <span className="text-sm font-semibold">
          {fecha === new Date().toISOString().slice(0, 10)
            ? 'Hoy'
            : new Date(fecha + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })}
        </span>
        <button
          onClick={() => {
            const hoy = new Date().toISOString().slice(0, 10);
            if (fecha >= hoy) return;
            const d = new Date(fecha); d.setDate(d.getDate() + 1);
            setFecha(d.toISOString().slice(0, 10));
          }}
          className="p-2 rounded-xl bg-surface-dim hover:bg-border transition-colors disabled:opacity-30"
          disabled={fecha >= new Date().toISOString().slice(0, 10)}
        >
          ›
        </button>
      </div>

      {/* Progreso kcal */}
      {kcalObj > 0 && (
        <div className="bg-surface rounded-2xl border border-border p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-semibold">Calorías del día</span>
            <span className="text-muted">{Math.round(kcalLog)} / {kcalObj} kcal</span>
          </div>
          <div className="h-2 bg-surface-dim rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${colorKcal}`}
              style={{ width: `${pctKcal}%` }}
            />
          </div>
          {/* Macros en miniatura */}
          {(datos?.targets?.proteinas_g || datos?.targets?.carbohidratos_g || datos?.targets?.grasas_g) && (
            <div className="grid grid-cols-3 gap-2 pt-1">
              {[
                { label: 'Proteína', log: datos!.totales.proteina_g, obj: datos!.targets!.proteinas_g ?? 0, color: 'bg-blue-400' },
                { label: 'Carbos',   log: datos!.totales.carbohidratos_g, obj: datos!.targets!.carbohidratos_g ?? 0, color: 'bg-amber-400' },
                { label: 'Grasas',   log: datos!.totales.grasas_g, obj: datos!.targets!.grasas_g ?? 0, color: 'bg-purple-400' },
              ].map(m => (
                <div key={m.label} className="text-center">
                  <div className="h-1.5 bg-surface-dim rounded-full overflow-hidden mb-1">
                    <div className={`h-full rounded-full ${m.color}`} style={{ width: `${m.obj > 0 ? Math.min((m.log / m.obj) * 100, 100) : 0}%` }} />
                  </div>
                  <span className="text-[10px] text-muted">{m.label} {Math.round(m.log)}g</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Slots de comida */}
      {cargando
        ? <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-surface-dim rounded-2xl animate-pulse" />)}</div>
        : SLOTS.map(slot => {
          const reg = registroPorTipo(slot.key);
          return (
            <div key={slot.key} className="bg-surface rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{slot.emoji}</span>
                  <span className="text-sm font-semibold">{slot.label}</span>
                </div>
                {reg
                  ? <button onClick={() => setEditando(slot.key)} className="text-xs text-primary font-medium">Editar</button>
                  : <button onClick={() => setEditando(slot.key)} className="text-xs text-muted font-medium">+ Agregar</button>
                }
              </div>

              {reg
                ? (
                  <div>
                    <p className="text-sm text-foreground leading-snug">{reg.descripcion}</p>
                    {reg.kcal && <p className="text-xs text-muted mt-1">{reg.kcal} kcal</p>}
                  </div>
                )
                : <p className="text-sm text-muted">Sin registro</p>
              }
            </div>
          );
        })
      }

      {/* Bottom sheet para agregar/editar */}
      {editando && (
        <SlotBottomSheet
          tipo={editando}
          label={SLOTS.find(s => s.key === editando)?.label ?? ''}
          inicial={registroPorTipo(editando) ?? null}
          fecha={fecha}
          token={token}
          onGuardar={async () => { await fetchDia(fecha); setEditando(null); }}
          onEliminar={async (id) => {
            await fetch(`/api/paciente/diario/${id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            });
            await fetchDia(fecha);
            setEditando(null);
          }}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  );
}

// ─── Bottom Sheet ────────────────────────────────────────────────────────────
function SlotBottomSheet(props: {
  tipo: string; label: string;
  inicial: Registro | null;
  fecha: string; token: string;
  onGuardar: () => Promise<void>;
  onEliminar: (id: string) => Promise<void>;
  onCerrar: () => void;
}) {
  const [desc, setDesc]     = useState(props.inicial?.descripcion ?? '');
  const [kcal, setKcal]     = useState(props.inicial?.kcal?.toString() ?? '');
  const [prot, setProt]     = useState(props.inicial?.proteina_g?.toString() ?? '');
  const [carbs, setCarbs]   = useState(props.inicial?.carbohidratos_g?.toString() ?? '');
  const [grasas, setGrasas] = useState(props.inicial?.grasas_g?.toString() ?? '');
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    if (!desc.trim()) return;
    setGuardando(true);
    try {
      await fetch('/api/paciente/diario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${props.token}` },
        body: JSON.stringify({
          fecha: props.fecha,
          tipo_comida: props.tipo,
          descripcion: desc.trim(),
          kcal:            kcal    ? parseFloat(kcal)    : undefined,
          proteina_g:      prot    ? parseFloat(prot)    : undefined,
          carbohidratos_g: carbs   ? parseFloat(carbs)   : undefined,
          grasas_g:        grasas  ? parseFloat(grasas)  : undefined,
        }),
      });
      await props.onGuardar();
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={props.onCerrar} />
      <div className="relative bg-surface rounded-t-3xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="w-10 h-1 bg-border rounded-full mx-auto" />
        <h3 className="text-base font-bold">{props.label}</h3>

        <div>
          <label className="text-xs font-semibold text-muted mb-1 block">¿Qué comiste?</label>
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            rows={3}
            placeholder="Ej: Avena con leche, una manzana y café sin azúcar"
            className="w-full border border-border rounded-xl p-3 text-sm resize-none focus:outline-none focus:border-primary"
          />
        </div>

        {/* Macros opcionales */}
        <details>
          <summary className="text-xs font-semibold text-primary cursor-pointer">
            Agregar calorías y macros (opcional)
          </summary>
          <div className="grid grid-cols-2 gap-3 mt-3">
            {[
              { label: 'Kcal', value: kcal,   set: setKcal,   ph: '320' },
              { label: 'Proteína (g)', value: prot, set: setProt, ph: '25' },
              { label: 'Carbos (g)', value: carbs, set: setCarbs, ph: '45' },
              { label: 'Grasas (g)', value: grasas, set: setGrasas, ph: '8' },
            ].map(f => (
              <div key={f.label}>
                <label className="text-xs text-muted">{f.label}</label>
                <input
                  type="number" min="0" placeholder={f.ph} value={f.value}
                  onChange={e => f.set(e.target.value)}
                  className="w-full border border-border rounded-lg p-2 text-sm mt-0.5 focus:outline-none focus:border-primary"
                />
              </div>
            ))}
          </div>
        </details>

        <button
          onClick={guardar}
          disabled={!desc.trim() || guardando}
          className="w-full py-3 bg-primary text-white rounded-xl font-semibold text-sm disabled:opacity-50"
        >
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>

        {props.inicial && (
          <button
            onClick={() => props.onEliminar(props.inicial!.id)}
            className="w-full py-2 text-danger text-sm font-medium"
          >
            Borrar este registro
          </button>
        )}
      </div>
    </div>
  );
}
```

---

## Paso 8 — Componente: Registro de métricas

Crear `apps/web-patient/src/features/registros/RegistroMetricas.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';

type TipoMetrica = 'peso' | 'presion_arterial' | 'glucosa';

const METRICAS: { tipo: TipoMetrica; label: string; emoji: string; unidad: string }[] = [
  { tipo: 'peso',             label: 'Peso',            emoji: '⚖️',  unidad: 'kg'    },
  { tipo: 'presion_arterial', label: 'Presión arterial', emoji: '💓',  unidad: 'mmHg'  },
  { tipo: 'glucosa',          label: 'Glucosa',          emoji: '🩸',  unidad: 'mg/dL' },
];

interface UltimaMetrica {
  tipo: string; valor?: number; sistolica?: number; diastolica?: number;
  unidad: string; fecha: string;
}

export function RegistroMetricas() {
  const { token }             = useAuth();
  const [resumen, setResumen] = useState<Record<string, UltimaMetrica>>({});
  const [activo, setActivo]   = useState<TipoMetrica | null>(null);
  const [historial, setHistorial] = useState<UltimaMetrica[]>([]);

  const fetchResumen = async () => {
    const res = await fetch('/api/paciente/metricas/resumen', {
      headers: { Authorization: `Bearer ${token}` },
    });
    setResumen(await res.json());
  };

  const fetchHistorial = async (tipo: TipoMetrica) => {
    const res = await fetch(`/api/paciente/metricas?tipo=${tipo}&limit=20`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setHistorial(await res.json());
  };

  useEffect(() => { fetchResumen(); }, []);
  useEffect(() => {
    if (activo) fetchHistorial(activo);
    else setHistorial([]);
  }, [activo]);

  return (
    <div className="p-4 space-y-4">
      {/* Cards de métricas */}
      {METRICAS.map(m => {
        const ultima = resumen[m.tipo];
        const valor  = m.tipo === 'presion_arterial'
          ? (ultima ? `${ultima.sistolica}/${ultima.diastolica}` : '—')
          : (ultima?.valor?.toFixed(m.tipo === 'peso' ? 1 : 0) ?? '—');

        return (
          <div
            key={m.tipo}
            onClick={() => setActivo(activo === m.tipo ? null : m.tipo)}
            className={[
              'bg-surface rounded-2xl border p-4 cursor-pointer transition-all',
              activo === m.tipo ? 'border-primary shadow-sm' : 'border-border',
            ].join(' ')}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{m.emoji}</span>
                <div>
                  <p className="text-sm font-semibold">{m.label}</p>
                  {ultima
                    ? <p className="text-xs text-muted">
                        {new Date(ultima.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                      </p>
                    : <p className="text-xs text-muted">Sin registros</p>
                  }
                </div>
              </div>
              <div className="text-right">
                <span className="text-xl font-bold text-foreground">{valor}</span>
                {ultima && <span className="text-xs text-muted ml-1">{m.unidad}</span>}
              </div>
            </div>

            {/* Historial expandible + botón registrar */}
            {activo === m.tipo && (
              <div className="mt-4 space-y-3" onClick={e => e.stopPropagation()}>
                {/* Mini gráfica SVG de los últimos registros */}
                {historial.length > 1 && m.tipo !== 'presion_arterial' && (
                  <MiniGrafica datos={historial} campo="valor" />
                )}

                {/* Lista de últimas lecturas */}
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {historial.slice(0, 8).map(h => (
                    <div key={h.fecha} className="flex justify-between text-sm py-1 border-b border-border last:border-0">
                      <span className="text-muted text-xs">
                        {new Date(h.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="font-semibold">
                        {m.tipo === 'presion_arterial' ? `${h.sistolica}/${h.diastolica}` : h.valor?.toFixed(1)} {m.unidad}
                      </span>
                    </div>
                  ))}
                </div>

                <FormMetrica tipo={m.tipo} unidad={m.unidad} token={token}
                  onGuardar={async () => { await fetchResumen(); await fetchHistorial(m.tipo); }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Mini gráfica SVG ────────────────────────────────────────────────────────
function MiniGrafica({ datos, campo }: { datos: UltimaMetrica[]; campo: 'valor' }) {
  const valores = [...datos].reverse().map(d => d[campo] ?? 0);
  if (valores.length < 2) return null;

  const W = 300; const H = 60; const PAD = 8;
  const min = Math.min(...valores); const max = Math.max(...valores);
  const range = max - min || 1;
  const pts = valores.map((v, i) => ({
    x: PAD + (i / (valores.length - 1)) * (W - PAD * 2),
    y: H - PAD - ((v - min) / range) * (H - PAD * 2),
  }));
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14">
      <path d={d} fill="none" stroke="var(--color-primary, #0E7C66)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--color-primary, #0E7C66)" />
      ))}
    </svg>
  );
}

// ─── Formulario de nueva lectura ─────────────────────────────────────────────
function FormMetrica(props: { tipo: TipoMetrica; unidad: string; token: string; onGuardar: () => Promise<void> }) {
  const [valor, setValor]         = useState('');
  const [sistolica, setSistolica] = useState('');
  const [diastolica, setDiast]    = useState('');
  const [nota, setNota]           = useState('');
  const [guardando, setGuardando] = useState(false);

  const esPres = props.tipo === 'presion_arterial';
  const valido  = esPres ? (sistolica && diastolica) : !!valor;

  const guardar = async () => {
    if (!valido) return;
    setGuardando(true);
    try {
      await fetch('/api/paciente/metricas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${props.token}` },
        body: JSON.stringify({
          tipo: props.tipo,
          unidad: props.unidad,
          valor: esPres ? undefined : parseFloat(valor),
          sistolica: esPres ? parseFloat(sistolica) : undefined,
          diastolica: esPres ? parseFloat(diastolica) : undefined,
          nota: nota || undefined,
        }),
      });
      setValor(''); setSistolica(''); setDiast(''); setNota('');
      await props.onGuardar();
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="pt-2 space-y-3 border-t border-border">
      <p className="text-xs font-semibold text-muted">Nueva lectura</p>

      {esPres ? (
        <div className="flex items-center gap-2">
          <input type="number" placeholder="Sistólica" value={sistolica} onChange={e => setSistolica(e.target.value)}
            className="flex-1 border border-border rounded-lg p-2 text-sm text-center focus:outline-none focus:border-primary" />
          <span className="text-muted font-bold">/</span>
          <input type="number" placeholder="Diastólica" value={diastolica} onChange={e => setDiast(e.target.value)}
            className="flex-1 border border-border rounded-lg p-2 text-sm text-center focus:outline-none focus:border-primary" />
          <span className="text-xs text-muted">mmHg</span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input type="number" step="0.1" placeholder="0.0" value={valor} onChange={e => setValor(e.target.value)}
            className="flex-1 border border-border rounded-lg p-2 text-sm text-center focus:outline-none focus:border-primary" />
          <span className="text-xs text-muted w-12">{props.unidad}</span>
        </div>
      )}

      <input type="text" placeholder="Nota opcional" value={nota} onChange={e => setNota(e.target.value)}
        className="w-full border border-border rounded-lg p-2 text-sm focus:outline-none focus:border-primary" />

      <button onClick={guardar} disabled={!valido || guardando}
        className="w-full py-2.5 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-50">
        {guardando ? 'Guardando…' : 'Registrar'}
      </button>
    </div>
  );
}
```

---

## Paso 9 — Vista del profesional: diario y métricas del paciente

Leer el archivo del expediente del paciente en `apps/web-professional` (donde están las tabs de un paciente: Datos · Consultas · Plan, etc.) para identificar cómo agregar una tab nueva. Agregar la tab **"Seguimiento"** que muestre:

- **Diario de la última semana**: tabla por día con total de kcal y número de comidas registradas. Sin acceso de edición — solo lectura.
  - API a llamar: `GET /api/profesional/pacientes/:id/diario?desde=YYYY-MM-DD` — **nuevo endpoint** en el módulo profesional (no en el módulo paciente):

```typescript
// GET /api/profesional/pacientes/:id/diario — requiere request.auth.tenantId
fastify.get('/api/profesional/pacientes/:id/diario', {
  onRequest: [fastify.authenticate],
  schema: {
    querystring: {
      type: 'object',
      properties: { desde: { type: 'string' } },
    },
  },
}, async (request, reply) => {
  const clinicaId   = (request.auth as { tenantId: string }).tenantId;
  const { id }      = request.params as { id: string };
  const desde       = (request.query as { desde?: string }).desde
                   ?? new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `SELECT fecha::text, tipo_comida, descripcion, kcal, proteina_g, carbohidratos_g, grasas_g, updated_at
     FROM   registro_comida
     WHERE  paciente_id = $1 AND clinica_id = $2 AND fecha >= $3 AND activo = true
     ORDER  BY fecha DESC, tipo_comida`,
    [id, clinicaId, desde]
  );
  return reply.send(rows);
});
```

- **Últimas métricas**: tabla con tipo · valor · fecha de los últimos 10 registros de cada métrica. Endpoint:

```typescript
// GET /api/profesional/pacientes/:id/metricas
fastify.get('/api/profesional/pacientes/:id/metricas', {
  onRequest: [fastify.authenticate],
}, async (request, reply) => {
  const clinicaId = (request.auth as { tenantId: string }).tenantId;
  const { id }    = request.params as { id: string };

  const { rows } = await pool.query(
    `SELECT tipo, valor, sistolica, diastolica, unidad, fecha, nota
     FROM   registro_metrica
     WHERE  paciente_id = $1 AND clinica_id = $2 AND activo = true
     ORDER  BY fecha DESC
     LIMIT  40`,
    [id, clinicaId]
  );
  return reply.send(rows);
});
```

El componente de la tab "Seguimiento" en el frontend del profesional es de solo lectura — sin formularios de edición.

---

## Paso 10 — Integración con el Dashboard del paciente (PAC-02)

Leer `apps/web-patient/src/pages/Inicio.tsx` (o el equivalente del dashboard del paciente de R17). Agregar dos cards de resumen rápido:

**Card "Hoy registrado"**:
- Llama a `GET /api/paciente/diario` (sin fecha → hoy)
- Muestra: N de N comidas registradas hoy (p. ej. "3 de 5 comidas")
- Si hay target de kcal: barra de progreso pequeña con `X / Y kcal`
- Link "Ver diario completo →" → navega a `/registros`

**Card "Última métrica"**:
- Llama a `GET /api/paciente/metricas/resumen`
- Muestra el peso más reciente (si existe) con su fecha
- Link "Registrar peso →" → navega a `/registros` con tab Métricas abierta (pasando state `{ tab: 'Métricas' }` en el navigate)

---

## Paso 11 — Verificación

```bash
# 1. Migrations aplicadas
docker compose -f infra/docker-compose.dev.yml exec api \
  psql $DATABASE_URL -c "\dt registro_comida registro_metrica"

# 2. Registrar una comida
curl -s -X POST http://localhost:4001/api/paciente/diario \
  -H "Authorization: Bearer <TOKEN_PACIENTE>" \
  -H "Content-Type: application/json" \
  -d '{"tipo_comida":"desayuno","descripcion":"Avena con leche","kcal":320}'

# 3. Leer el diario de hoy
curl -s http://localhost:4001/api/paciente/diario \
  -H "Authorization: Bearer <TOKEN_PACIENTE>" | jq '.totales'

# 4. Registrar peso
curl -s -X POST http://localhost:4001/api/paciente/metricas \
  -H "Authorization: Bearer <TOKEN_PACIENTE>" \
  -H "Content-Type: application/json" \
  -d '{"tipo":"peso","valor":73.4,"unidad":"kg"}'

# 5. Resumen de métricas
curl -s http://localhost:4001/api/paciente/metricas/resumen \
  -H "Authorization: Bearer <TOKEN_PACIENTE>" | jq '.'

# 6. En la app del paciente (http://localhost:5175):
#    - Pestaña "Mis registros" aparece en la nav inferior
#    - Tab "Comidas" muestra los 5 slots; tap en "Desayuno" abre el bottom sheet
#    - Guardar → el slot se actualiza con la descripción y las kcal
#    - Tab "Métricas" → card "Peso" expandida → registrar → aparece en historial

# 7. En la app del profesional (http://localhost:5173):
#    - Expediente del paciente → tab "Seguimiento" muestra los registros del paciente (solo lectura)
```

---

## Notas para r23

- **PAC-05 Metas personales y progreso**: pantalla dedicada con gráficas de tendencia de peso a largo plazo (reutiliza `registro_metrica`) y progreso hacia la meta de peso del plan nutricional; requiere que `conclusion_valoracion.plan_nutricional` incluya el campo `peso_objetivo`
- **PAC-06 Tareas del paciente**: lista de tareas pendientes que el profesional asigna desde el EVAL (posiblemente ligadas a `acuerdos` de `conclusion_valoracion`); el paciente las marca como completadas
- La mini gráfica SVG de métricas de r22 será la base de las gráficas más completas de PAC-05
