# R20 — AGE epic: Agenda y gestión de citas

> **Contexto de sesión — leer antes de escribir una sola línea**
>
> **Framework API: Fastify** (no Express). Replica el patrón de plugin que ya usan las rutas existentes.
> **Multitenancy:** `clinica_id` siempre de `request.auth.tenantId` — nunca del body ni query string.
> **Token JWT profesional:** `{ tenantId, sub, roles[] }` — `sub` es Keycloak user ID; se resuelve a `profesional.id` via `keycloak_user_id`.
> **Columnas reales verificadas:** `paciente.correo` · `paciente.estado` · `paciente.sexo_biologico` · `clinica.nombre_comercial` · `cita.inicio` timestamptz (columna confirmada en r17).
> **Sin recharts** — SVG puro con design tokens.
> **Design tokens vía CSS vars:** `--primary` #0E7C66 · `--primary-dk` #0A5C4C · `--primary-tint` #E7F1EE · `--accent` #C2410C · `--bg` #FBFCFC · `--ink` #1F2937 · `--muted` #6B7280 · `--line` #E3EAE8.
> **Soft-delete:** nunca DELETE físico — `estado = 'cancelada'`.

---

## Objetivo de esta rebanada

Construir el módulo de agenda completo:

- **AGE-01** — Gestión de citas del profesional: crear, editar, cancelar, ver calendario semanal
- **AGE-02** — Vista de agenda del paciente: próxima cita con cuenta regresiva, historial de consultas

Al terminar deben funcionar:
- `POST /api/citas` — crear cita
- `GET /api/citas?semana=YYYY-WW` — agenda semanal del profesional autenticado
- `GET /api/citas/:id` — detalle de cita
- `PATCH /api/citas/:id` — actualizar (reprogramar, cambiar estado, agregar notas)
- `DELETE /api/citas/:id` — soft-delete (marca como cancelada)
- `GET /api/citas/paciente/:pacienteId` — historial de citas de un paciente
- `GET /api/paciente/citas` — próxima cita + historial desde la app del paciente
- Vista calendario semanal en `apps/web-professional`
- Tarjeta de próxima cita actualizada en `apps/web-patient`

---

## Paso 1 — Verificar estado de la tabla `cita`

```bash
# Conectar al DB y verificar
docker exec -it nutrismart-db psql -U nutrismart -c "
  SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
   WHERE table_name = 'cita'
   ORDER BY ordinal_position;
"
```

**Si la tabla ya existe**, anota todas las columnas que tiene y adapta la migración para agregar solo las que falten con `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. No recrear la tabla.

**Si no existe**, crea la migración completa (Paso 2).

---

## Paso 2 — Migración `021_agenda.sql`

Verifica el número correcto con `ls apps/api/src/migrations/ | sort | tail -5` antes de escribir el archivo.

```sql
-- AGE-01/02: gestión de citas
-- Si la tabla cita ya existe (de una migración anterior), esta migración
-- debe usar ADD COLUMN IF NOT EXISTS para agregar solo lo que falte.
-- Verifica antes de ejecutar.

CREATE TYPE tipo_cita AS ENUM ('inicial', 'seguimiento', 'control', 'urgencia');
CREATE TYPE estado_cita AS ENUM ('programada', 'confirmada', 'realizada', 'cancelada', 'no_asistio');

CREATE TABLE cita (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id       UUID         NOT NULL REFERENCES clinica(id),
  paciente_id      UUID         NOT NULL REFERENCES paciente(id),
  profesional_id   UUID         NOT NULL REFERENCES profesional(id),

  -- inicio y fin como timestamptz (incluyen fecha y hora en un solo campo)
  -- El frontend siempre envía ISO 8601 con offset; se almacena en UTC.
  inicio           TIMESTAMPTZ  NOT NULL,
  fin              TIMESTAMPTZ  NOT NULL,

  tipo             tipo_cita    NOT NULL DEFAULT 'seguimiento',
  estado           estado_cita  NOT NULL DEFAULT 'programada',

  -- Motivo de consulta y notas clínicas post-cita
  motivo           TEXT,
  notas_clinicas   TEXT,

  -- Si la cita deriva de un seguimiento programado, link a la consulta anterior
  consulta_origen_id UUID       REFERENCES consulta(id),

  -- Recordatorios enviados
  recordatorio_24h   BOOLEAN    NOT NULL DEFAULT false,
  recordatorio_1h    BOOLEAN    NOT NULL DEFAULT false,

  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Una cita no puede empezar después de terminar
  CONSTRAINT chk_cita_orden CHECK (fin > inicio),
  -- Duración razonable: entre 10 min y 4 horas
  CONSTRAINT chk_cita_duracion CHECK (
    EXTRACT(EPOCH FROM (fin - inicio)) BETWEEN 600 AND 14400
  )
);

-- Índice principal para la vista semanal del profesional
CREATE INDEX idx_cita_profesional_semana
  ON cita (clinica_id, profesional_id, inicio)
  WHERE estado NOT IN ('cancelada');

-- Índice para el historial del paciente
CREATE INDEX idx_cita_paciente
  ON cita (clinica_id, paciente_id, inicio DESC)
  WHERE estado NOT IN ('cancelada');

-- Evitar solapamientos: no puede haber dos citas del mismo profesional que se solapen.
-- Se implementa en la lógica de la API (no en DB) para dar un mensaje claro al usuario.
-- Un índice de exclusión (GIST) sería más robusto pero requiere btree_gist extension.
-- Se documenta como mejora futura en docs/AGENDA.md.
```

Ejecuta:

```bash
cd apps/api && node -e "
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = fs.readFileSync('src/migrations/021_agenda.sql', 'utf8');
pool.query(sql)
  .then(() => { console.log('OK'); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
"
```

---

## Paso 3 — API: rutas de citas (Fastify)

Crea `apps/api/src/agenda/citas.routes.ts`. Antes de escribirlo, lee un archivo de rutas existente para replicar el patrón exacto de plugin registration y preHandler de auth.

```typescript
import { FastifyInstance } from 'fastify';
import { db } from '../db';

export async function citasRoutes(fastify: FastifyInstance) {

  // Helper: resolver profesional.id desde JWT sub
  async function resolverProfesional(sub: string, clinicaId: string) {
    const { rows: [p] } = await db.query(
      `SELECT id FROM profesional WHERE keycloak_user_id = $1 AND clinica_id = $2`,
      [sub, clinicaId]
    );
    return p?.id ?? null;
  }

  // Helper: verificar que dos rangos de tiempo no se solapan
  async function verificarSolapamiento(
    profesionalId: string,
    clinicaId: string,
    inicio: string,
    fin: string,
    excludeId?: string
  ): Promise<boolean> {
    const exclude = excludeId ? `AND id != $5` : '';
    const params: unknown[] = [profesionalId, clinicaId, inicio, fin];
    if (excludeId) params.push(excludeId);

    const { rows } = await db.query(
      `SELECT id FROM cita
        WHERE profesional_id = $1
          AND clinica_id = $2
          AND estado NOT IN ('cancelada', 'no_asistio')
          AND inicio < $4::timestamptz
          AND fin   > $3::timestamptz
          ${exclude}`,
      params
    );
    return rows.length > 0;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/citas
  // Crear una nueva cita. Valida solapamiento.
  // ──────────────────────────────────────────────────────────────────────────
  fastify.post('/citas', {
    preHandler: [fastify.authenticate, fastify.requireProfesional],
  }, async (request, reply) => {
    const clinicaId    = request.auth.tenantId;
    const profesionalId = await resolverProfesional(request.auth.sub, clinicaId);
    if (!profesionalId) return reply.status(403).send({ error: 'Profesional no encontrado' });

    const { pacienteId, inicio, fin, tipo, motivo } = request.body as {
      pacienteId: string; inicio: string; fin: string;
      tipo?: string; motivo?: string;
    };

    if (!pacienteId || !inicio || !fin) {
      return reply.status(400).send({ error: 'pacienteId, inicio y fin son obligatorios' });
    }

    // Validar que el paciente pertenece a la clínica
    const { rows: [paciente] } = await db.query(
      `SELECT id, nombre, correo FROM paciente
        WHERE id = $1 AND clinica_id = $2 AND estado != 'archivado'`,
      [pacienteId, clinicaId]
    );
    if (!paciente) return reply.status(404).send({ error: 'Paciente no encontrado' });

    // Validar orden y duración
    const inicioDate = new Date(inicio);
    const finDate    = new Date(fin);
    const diffSeg    = (finDate.getTime() - inicioDate.getTime()) / 1000;
    if (finDate <= inicioDate) {
      return reply.status(400).send({ error: 'La hora de fin debe ser posterior al inicio' });
    }
    if (diffSeg < 600 || diffSeg > 14400) {
      return reply.status(400).send({ error: 'La duración debe estar entre 10 minutos y 4 horas' });
    }

    // Validar solapamiento
    const solapa = await verificarSolapamiento(profesionalId, clinicaId, inicio, fin);
    if (solapa) {
      return reply.status(409).send({
        error: 'Ya existe una cita programada en ese horario. Elige otro horario.'
      });
    }

    const { rows: [cita] } = await db.query(
      `INSERT INTO cita
         (clinica_id, paciente_id, profesional_id, inicio, fin, tipo, motivo)
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7)
       RETURNING *`,
      [clinicaId, pacienteId, profesionalId, inicio, fin, tipo ?? 'seguimiento', motivo ?? null]
    );

    // Notificación al paciente si tiene cuenta vinculada
    if (paciente.correo) {
      await db.query(
        `INSERT INTO notificacion
           (clinica_id, destinatario_id, destinatario_tipo, tipo, titulo, contenido, enlace)
         SELECT $1, p.id, 'paciente', 'cita_proxima',
                'Nueva cita programada',
                'Tienes una cita el ' || TO_CHAR($3::timestamptz AT TIME ZONE 'America/Mexico_City', 'DD/MM/YYYY HH24:MI'),
                '/dashboard'
           FROM paciente p
          WHERE p.id = $2 AND p.keycloak_user_id IS NOT NULL`,
        [clinicaId, pacienteId, inicio]
      ).catch(() => {}); // No falla si el paciente no tiene cuenta aún

    }

    return reply.status(201).send(cita);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/citas?semana=YYYY-WW&profesionalId=UUID
  // Agenda semanal. Si no se pasa profesionalId, usa el del usuario autenticado.
  // semana=2026-W33 → lunes de esa semana a domingo.
  // ──────────────────────────────────────────────────────────────────────────
  fastify.get('/citas', {
    preHandler: [fastify.authenticate, fastify.requireProfesional],
  }, async (request, reply) => {
    const clinicaId = request.auth.tenantId;
    const { semana, profesionalId: qProfId } = request.query as {
      semana?: string; profesionalId?: string;
    };

    // Resolver el profesionalId del filtro
    const miProfId = await resolverProfesional(request.auth.sub, clinicaId);
    const filtroId = qProfId ?? miProfId;
    if (!filtroId) return reply.status(403).send({ error: 'Profesional no encontrado' });

    // Calcular rango de la semana
    let inicioSemana: Date;
    let finSemana: Date;

    if (semana && /^\d{4}-W\d{2}$/.test(semana)) {
      // Parsear formato ISO week (YYYY-WNN)
      const [anio, ww] = semana.split('-W').map(Number);
      // Lunes de la semana ISO
      const d = new Date(anio, 0, 1 + (ww - 1) * 7);
      const dia = d.getDay();
      const diff = d.getDate() - dia + (dia === 0 ? -6 : 1);
      inicioSemana = new Date(d.setDate(diff));
      inicioSemana.setHours(0, 0, 0, 0);
    } else {
      // Semana actual
      const hoy = new Date();
      const dia = hoy.getDay();
      const diff = hoy.getDate() - dia + (dia === 0 ? -6 : 1);
      inicioSemana = new Date(hoy.setDate(diff));
      inicioSemana.setHours(0, 0, 0, 0);
    }
    finSemana = new Date(inicioSemana);
    finSemana.setDate(inicioSemana.getDate() + 7);

    const { rows: citas } = await db.query(
      `SELECT c.id, c.inicio, c.fin, c.tipo, c.estado, c.motivo, c.notas_clinicas,
              p.id AS paciente_id, p.nombre AS paciente_nombre,
              p.correo AS paciente_correo
         FROM cita c
         JOIN paciente p ON p.id = c.paciente_id
        WHERE c.clinica_id    = $1
          AND c.profesional_id = $2
          AND c.inicio >= $3::timestamptz
          AND c.inicio <  $4::timestamptz
        ORDER BY c.inicio ASC`,
      [clinicaId, filtroId, inicioSemana.toISOString(), finSemana.toISOString()]
    );

    return reply.send({
      semanaInicio: inicioSemana.toISOString(),
      semanaFin:    finSemana.toISOString(),
      citas,
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/citas/:id
  // ──────────────────────────────────────────────────────────────────────────
  fastify.get('/citas/:id', {
    preHandler: [fastify.authenticate, fastify.requireProfesional],
  }, async (request, reply) => {
    const clinicaId = request.auth.tenantId;
    const { id } = request.params as { id: string };

    const { rows: [cita] } = await db.query(
      `SELECT c.*, p.nombre AS paciente_nombre, p.correo AS paciente_correo
         FROM cita c
         JOIN paciente p ON p.id = c.paciente_id
        WHERE c.id = $1 AND c.clinica_id = $2`,
      [id, clinicaId]
    );
    if (!cita) return reply.status(404).send({ error: 'Cita no encontrada' });
    return reply.send(cita);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PATCH /api/citas/:id
  // Reprogramar, actualizar estado o agregar notas clínicas.
  // ──────────────────────────────────────────────────────────────────────────
  fastify.patch('/citas/:id', {
    preHandler: [fastify.authenticate, fastify.requireProfesional],
  }, async (request, reply) => {
    const clinicaId    = request.auth.tenantId;
    const profesionalId = await resolverProfesional(request.auth.sub, clinicaId);
    const { id } = request.params as { id: string };

    const { rows: [cita] } = await db.query(
      `SELECT * FROM cita WHERE id = $1 AND clinica_id = $2`,
      [id, clinicaId]
    );
    if (!cita) return reply.status(404).send({ error: 'Cita no encontrada' });
    if (cita.estado === 'cancelada') {
      return reply.status(409).send({ error: 'No se puede modificar una cita cancelada' });
    }

    const { inicio, fin, tipo, estado, motivo, notasClinicas } = request.body as {
      inicio?: string; fin?: string; tipo?: string; estado?: string;
      motivo?: string; notasClinicas?: string;
    };

    const nuevoInicio = inicio ?? cita.inicio;
    const nuevoFin    = fin    ?? cita.fin;

    // Si cambia el horario, re-validar solapamiento
    if (inicio || fin) {
      const solapa = await verificarSolapamiento(
        cita.profesional_id, clinicaId, nuevoInicio, nuevoFin, id
      );
      if (solapa) {
        return reply.status(409).send({ error: 'El nuevo horario se solapa con otra cita' });
      }
    }

    // Estados permitidos según el flujo clínico
    const estadosPermitidos = ['programada', 'confirmada', 'realizada', 'cancelada', 'no_asistio'];
    if (estado && !estadosPermitidos.includes(estado)) {
      return reply.status(400).send({ error: `Estado inválido: ${estado}` });
    }

    const { rows: [actualizada] } = await db.query(
      `UPDATE cita SET
         inicio          = COALESCE($1::timestamptz, inicio),
         fin             = COALESCE($2::timestamptz, fin),
         tipo            = COALESCE($3::tipo_cita, tipo),
         estado          = COALESCE($4::estado_cita, estado),
         motivo          = COALESCE($5, motivo),
         notas_clinicas  = COALESCE($6, notas_clinicas),
         updated_at      = now()
       WHERE id = $7 AND clinica_id = $8
       RETURNING *`,
      [inicio ?? null, fin ?? null, tipo ?? null, estado ?? null,
       motivo ?? null, notasClinicas ?? null, id, clinicaId]
    );

    return reply.send(actualizada);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // DELETE /api/citas/:id → soft-delete (estado = 'cancelada')
  // ──────────────────────────────────────────────────────────────────────────
  fastify.delete('/citas/:id', {
    preHandler: [fastify.authenticate, fastify.requireProfesional],
  }, async (request, reply) => {
    const clinicaId = request.auth.tenantId;
    const { id } = request.params as { id: string };

    const { rows: [cita] } = await db.query(
      `UPDATE cita
          SET estado = 'cancelada', updated_at = now()
        WHERE id = $1 AND clinica_id = $2
          AND estado != 'cancelada'
       RETURNING id, estado`,
      [id, clinicaId]
    );
    if (!cita) return reply.status(404).send({ error: 'Cita no encontrada o ya cancelada' });

    return reply.send({ mensaje: 'Cita cancelada', id: cita.id });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/citas/paciente/:pacienteId
  // Historial completo de citas de un paciente (vista del profesional).
  // ──────────────────────────────────────────────────────────────────────────
  fastify.get('/citas/paciente/:pacienteId', {
    preHandler: [fastify.authenticate, fastify.requireProfesional],
  }, async (request, reply) => {
    const clinicaId = request.auth.tenantId;
    const { pacienteId } = request.params as { pacienteId: string };

    const { rows: citas } = await db.query(
      `SELECT c.id, c.inicio, c.fin, c.tipo, c.estado, c.motivo,
              c.notas_clinicas, c.consulta_origen_id
         FROM cita c
        WHERE c.clinica_id  = $1
          AND c.paciente_id = $2
        ORDER BY c.inicio DESC`,
      [clinicaId, pacienteId]
    );

    return reply.send(citas);
  });
}
```

### Ruta del paciente — agregar en `apps/api/src/pac/paciente.routes.ts`

```typescript
// GET /api/paciente/citas
// Próxima cita + últimas 5 realizadas (para el historial en la app del paciente)
fastify.get('/paciente/citas', {
  preHandler: [fastify.authenticate],
}, async (request, reply) => {
  const { rows: [paciente] } = await db.query(
    `SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1`,
    [request.user.sub]
  );
  if (!paciente) return reply.status(404).send({ error: 'Paciente no encontrado' });

  const [{ rows: [proxima] }, { rows: historial }] = await Promise.all([
    db.query(
      `SELECT c.id, c.inicio, c.fin, c.tipo, c.estado, c.motivo,
              p.nombre AS nombre_profesional
         FROM cita c
         JOIN profesional p ON p.id = c.profesional_id
        WHERE c.clinica_id  = $1
          AND c.paciente_id = $2
          AND c.inicio >= now()
          AND c.estado NOT IN ('cancelada', 'no_asistio')
        ORDER BY c.inicio ASC LIMIT 1`,
      [paciente.clinica_id, paciente.id]
    ),
    db.query(
      `SELECT c.id, c.inicio, c.fin, c.tipo, c.estado
         FROM cita c
        WHERE c.clinica_id  = $1
          AND c.paciente_id = $2
          AND c.estado = 'realizada'
        ORDER BY c.inicio DESC LIMIT 5`,
      [paciente.clinica_id, paciente.id]
    ),
  ]);

  return reply.send({ proxima: proxima ?? null, historial });
});
```

---

## Paso 4 — Registrar las rutas en el servidor

En el archivo principal de Fastify, agrega:

```typescript
import { citasRoutes } from './agenda/citas.routes';

await fastify.register(citasRoutes, { prefix: '/api' });
```

---

## Paso 5 — Vista de agenda en `apps/web-professional`

### 5a. Hook `apps/web-professional/src/hooks/useAgenda.ts`

```typescript
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth'; // hook existente del proyecto

export interface CitaAPI {
  id: string;
  inicio: string;
  fin: string;
  tipo: string;
  estado: string;
  motivo: string | null;
  notas_clinicas: string | null;
  paciente_id: string;
  paciente_nombre: string;
  paciente_correo: string;
}

function getISOWeek(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const wn = 1 + Math.round(
    ((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
  );
  return `${d.getFullYear()}-W${String(wn).padStart(2, '0')}`;
}

export function useAgenda() {
  const { token } = useAuth();
  const [semana, setSemana] = useState(() => getISOWeek(new Date()));
  const [citas, setCitas]   = useState<CitaAPI[]>([]);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    if (!token) return;
    setCargando(true);
    try {
      const res = await fetch(`/api/citas?semana=${semana}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error cargando agenda');
      const data = await res.json();
      setCitas(data.citas);
    } catch (e) {
      console.error(e);
    } finally {
      setCargando(false);
    }
  }, [token, semana]);

  useEffect(() => { cargar(); }, [cargar]);

  const semanaAnterior = () => {
    const [anio, ww] = semana.split('-W').map(Number);
    const d = new Date(anio, 0, 1 + (ww - 2) * 7);
    setSemana(getISOWeek(d));
  };

  const semanaSiguiente = () => {
    const [anio, ww] = semana.split('-W').map(Number);
    const d = new Date(anio, 0, 1 + ww * 7);
    setSemana(getISOWeek(d));
  };

  return { citas, cargando, semana, semanaAnterior, semanaSiguiente, recargar: cargar };
}
```

### 5b. Componente `AgendaSemanal`

Crea `apps/web-professional/src/components/agenda/AgendaSemanal.tsx`:

```tsx
import { useState } from 'react';
import { useAgenda, CitaAPI } from '../../hooks/useAgenda';
import ModalCita from './ModalCita';
import FormNuevaCita from './FormNuevaCita';

const HORAS = Array.from({ length: 13 }, (_, i) => i + 7); // 07:00 – 19:00
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

// Calcula el lunes de la semana YYYY-WNN
function lunesDeSemana(semana: string): Date {
  const [anio, ww] = semana.split('-W').map(Number);
  const d = new Date(anio, 0, 1 + (ww - 1) * 7);
  const dia = d.getDay();
  const diff = d.getDate() - dia + (dia === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

const COLORES_ESTADO: Record<string, string> = {
  programada:  'bg-primary-tint border-primary text-primary',
  confirmada:  'bg-blue-50 border-blue-400 text-blue-700',
  realizada:   'bg-gray-50 border-gray-300 text-muted',
  cancelada:   'bg-red-50 border-red-200 text-red-400 line-through',
  no_asistio:  'bg-orange-50 border-orange-300 text-orange-600',
};

export default function AgendaSemanal() {
  const { citas, cargando, semana, semanaAnterior, semanaSiguiente, recargar } = useAgenda();
  const [citaSeleccionada, setCitaSeleccionada] = useState<CitaAPI | null>(null);
  const [mostrarNueva, setMostrarNueva] = useState(false);
  const [slotNuevo, setSlotNuevo] = useState<{ fecha: Date; hora: number } | null>(null);

  const lunes = lunesDeSemana(semana);
  const dias  = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lunes);
    d.setDate(lunes.getDate() + i);
    return d;
  });

  // Asignar citas a su slot (día × hora)
  function citasEnSlot(dia: Date, hora: number): CitaAPI[] {
    return citas.filter((c) => {
      const inicio = new Date(c.inicio);
      return (
        inicio.toDateString() === dia.toDateString() &&
        inicio.getHours() === hora
      );
    });
  }

  function alturaBloque(cita: CitaAPI): number {
    // Cada hora = 56px; proporcional a la duración
    const minutos = (new Date(cita.fin).getTime() - new Date(cita.inicio).getTime()) / 60000;
    return Math.max(24, (minutos / 60) * 56 - 4);
  }

  return (
    <div className="bg-white rounded-2xl border border-line shadow-sm overflow-hidden">
      {/* Cabecera */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-line">
        <div className="flex items-center gap-2">
          <button onClick={semanaAnterior}
            className="p-1.5 rounded-lg hover:bg-primary-tint text-muted hover:text-primary transition-colors">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-none stroke-current" strokeWidth={2}>
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-ink">
            Semana {semana.split('-W')[1]} ·{' '}
            {lunes.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} –{' '}
            {dias[6].toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          <button onClick={semanaSiguiente}
            className="p-1.5 rounded-lg hover:bg-primary-tint text-muted hover:text-primary transition-colors">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-none stroke-current" strokeWidth={2}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
        <button
          onClick={() => setMostrarNueva(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-dk transition-colors">
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth={2}>
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Nueva cita
        </button>
      </div>

      {/* Grilla */}
      <div className="overflow-x-auto">
        <div className="min-w-[700px]">
          {/* Cabecera de días */}
          <div className="grid grid-cols-8 border-b border-line">
            <div className="h-10" /> {/* columna horas */}
            {dias.map((dia, i) => {
              const esHoy = dia.toDateString() === new Date().toDateString();
              return (
                <div key={i} className={`h-10 flex flex-col items-center justify-center text-xs border-l border-line ${esHoy ? 'bg-primary-tint' : ''}`}>
                  <span className="text-muted">{DIAS_SEMANA[i]}</span>
                  <span className={`font-semibold ${esHoy ? 'text-primary' : 'text-ink'}`}>
                    {dia.getDate()}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Filas de horas */}
          {cargando ? (
            <div className="h-64 flex items-center justify-center text-muted text-sm">
              Cargando agenda…
            </div>
          ) : (
            HORAS.map((hora) => (
              <div key={hora} className="grid grid-cols-8 border-b border-line" style={{ minHeight: 56 }}>
                <div className="flex items-start justify-end pr-2 pt-1">
                  <span className="text-xs text-muted">{String(hora).padStart(2, '0')}:00</span>
                </div>
                {dias.map((dia, di) => {
                  const esHoy = dia.toDateString() === new Date().toDateString();
                  const slotCitas = citasEnSlot(dia, hora);
                  return (
                    <div
                      key={di}
                      onClick={() => setSlotNuevo({ fecha: dia, hora })}
                      className={`relative border-l border-line cursor-pointer hover:bg-primary-tint/30 transition-colors ${esHoy ? 'bg-primary-tint/10' : ''}`}
                    >
                      {slotCitas.map((c) => (
                        <button
                          key={c.id}
                          onClick={(e) => { e.stopPropagation(); setCitaSeleccionada(c); }}
                          style={{ height: alturaBloque(c) }}
                          className={`absolute inset-x-0.5 top-0.5 rounded border-l-2 px-1.5 text-left text-[11px] font-medium overflow-hidden transition-opacity hover:opacity-80 ${COLORES_ESTADO[c.estado] ?? 'bg-gray-100 border-gray-300'}`}
                        >
                          <p className="truncate leading-tight">{c.paciente_nombre}</p>
                          <p className="truncate text-[10px] opacity-70 capitalize">{c.tipo}</p>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modal detalle de cita */}
      {citaSeleccionada && (
        <ModalCita
          cita={citaSeleccionada}
          onClose={() => setCitaSeleccionada(null)}
          onActualizar={recargar}
        />
      )}

      {/* Modal nueva cita */}
      {(mostrarNueva || slotNuevo) && (
        <FormNuevaCita
          slotInicial={slotNuevo}
          onClose={() => { setMostrarNueva(false); setSlotNuevo(null); }}
          onCreada={() => { setMostrarNueva(false); setSlotNuevo(null); recargar(); }}
        />
      )}
    </div>
  );
}
```

### 5c. `ModalCita` — ver y editar una cita existente

Crea `apps/web-professional/src/components/agenda/ModalCita.tsx`:

```tsx
import { useState } from 'react';
import { CitaAPI } from '../../hooks/useAgenda';
import { useAuth } from '../../hooks/useAuth';

const ESTADOS = [
  { value: 'programada',  label: 'Programada' },
  { value: 'confirmada',  label: 'Confirmada' },
  { value: 'realizada',   label: 'Realizada' },
  { value: 'no_asistio',  label: 'No asistió' },
  { value: 'cancelada',   label: 'Cancelar' },
];

export default function ModalCita({
  cita,
  onClose,
  onActualizar,
}: {
  cita: CitaAPI;
  onClose: () => void;
  onActualizar: () => void;
}) {
  const { token } = useAuth();
  const [estado, setEstado] = useState(cita.estado);
  const [notas, setNotas]   = useState(cita.notas_clinicas ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const fmtFecha = (iso: string) =>
    new Date(iso).toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  const fmtHora = (iso: string) =>
    new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  async function guardar() {
    setGuardando(true); setError('');
    try {
      const res = await fetch(`/api/citas/${cita.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado, notasClinicas: notas }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onActualizar();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function cancelar() {
    if (!confirm('¿Cancelar esta cita?')) return;
    setGuardando(true);
    try {
      await fetch(`/api/citas/${cita.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      onActualizar();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-line">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-semibold text-ink text-lg">{cita.paciente_nombre}</h2>
              <p className="text-muted text-sm capitalize">{cita.tipo}</p>
            </div>
            <button onClick={onClose} className="text-muted hover:text-ink">
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-none stroke-current" strokeWidth={2}>
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="mt-3 text-sm text-ink space-y-1">
            <p>{fmtFecha(cita.inicio)}</p>
            <p className="text-muted">{fmtHora(cita.inicio)} – {fmtHora(cita.fin)}</p>
            {cita.motivo && <p className="text-muted">{cita.motivo}</p>}
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted mb-1.5 block">Estado</label>
            <div className="flex flex-wrap gap-2">
              {ESTADOS.map((e) => (
                <button key={e.value}
                  onClick={() => setEstado(e.value)}
                  disabled={cita.estado === 'cancelada'}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    estado === e.value
                      ? 'bg-primary text-white border-primary'
                      : 'border-line text-muted hover:border-primary hover:text-primary'
                  } disabled:opacity-40`}>
                  {e.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted mb-1.5 block">Notas clínicas</label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={3}
              placeholder="Observaciones post-consulta…"
              disabled={cita.estado === 'cancelada'}
              className="w-full rounded-xl border border-line px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary resize-none disabled:bg-gray-50 disabled:text-muted"
            />
          </div>

          {error && <p className="text-accent text-sm">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={guardar}
              disabled={guardando || cita.estado === 'cancelada'}
              className="flex-1 py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-dk transition-colors disabled:opacity-50">
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </button>
            {cita.estado !== 'cancelada' && (
              <button
                onClick={cancelar}
                disabled={guardando}
                className="px-4 py-2.5 border border-line text-muted text-sm rounded-xl hover:border-accent hover:text-accent transition-colors disabled:opacity-50">
                Cancelar cita
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

### 5d. `FormNuevaCita` — crear cita desde slot o botón

Crea `apps/web-professional/src/components/agenda/FormNuevaCita.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';

interface Paciente { id: string; nombre: string; correo: string; }

export default function FormNuevaCita({
  slotInicial,
  onClose,
  onCreada,
}: {
  slotInicial: { fecha: Date; hora: number } | null;
  onClose: () => void;
  onCreada: () => void;
}) {
  const { token } = useAuth();
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [busqueda, setBusqueda]   = useState('');
  const [pacienteId, setPacienteId] = useState('');
  const [tipo, setTipo] = useState('seguimiento');
  const [motivo, setMotivo] = useState('');
  const [duracion, setDuracion] = useState(60); // minutos

  // Fecha/hora desde el slot clicado o ahora
  const fechaBase = slotInicial?.fecha ?? new Date();
  const horaBase  = slotInicial?.hora  ?? (new Date().getHours() + 1);
  const [fechaStr, setFechaStr] = useState(fechaBase.toISOString().slice(0, 10));
  const [horaStr, setHoraStr]   = useState(`${String(horaBase).padStart(2, '0')}:00`);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  // Buscar pacientes
  useEffect(() => {
    if (!token || busqueda.length < 2) { setPacientes([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/pacientes?q=${encodeURIComponent(busqueda)}&limit=8`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setPacientes(data.pacientes ?? data ?? []);
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda, token]);

  async function crear() {
    if (!pacienteId || !fechaStr || !horaStr) {
      setError('Selecciona paciente, fecha y hora'); return;
    }
    setGuardando(true); setError('');
    try {
      const inicio = new Date(`${fechaStr}T${horaStr}:00`).toISOString();
      const fin    = new Date(new Date(inicio).getTime() + duracion * 60000).toISOString();

      const res = await fetch('/api/citas', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pacienteId, inicio, fin, tipo, motivo }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onCreada();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-line flex items-center justify-between">
          <h2 className="font-semibold text-ink">Nueva cita</h2>
          <button onClick={onClose} className="text-muted hover:text-ink">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-none stroke-current" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Paciente */}
          <div className="relative">
            <label className="text-xs font-medium text-muted mb-1.5 block">Paciente</label>
            <input
              value={busqueda}
              onChange={(e) => { setBusqueda(e.target.value); setPacienteId(''); }}
              placeholder="Buscar por nombre…"
              className="w-full border border-line rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
            {pacientes.length > 0 && !pacienteId && (
              <ul className="absolute z-10 w-full bg-white border border-line rounded-xl shadow-lg mt-1 max-h-40 overflow-y-auto">
                {pacientes.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => { setPacienteId(p.id); setBusqueda(p.nombre); setPacientes([]); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-primary-tint transition-colors">
                      <p className="font-medium text-ink">{p.nombre}</p>
                      <p className="text-xs text-muted">{p.correo}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Fecha y hora */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted mb-1.5 block">Fecha</label>
              <input type="date" value={fechaStr} onChange={(e) => setFechaStr(e.target.value)}
                className="w-full border border-line rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted mb-1.5 block">Hora</label>
              <input type="time" value={horaStr} onChange={(e) => setHoraStr(e.target.value)}
                className="w-full border border-line rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary" />
            </div>
          </div>

          {/* Duración y tipo */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted mb-1.5 block">Duración</label>
              <select value={duracion} onChange={(e) => setDuracion(Number(e.target.value))}
                className="w-full border border-line rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary">
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>1 hora</option>
                <option value={90}>1 h 30 min</option>
                <option value={120}>2 horas</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted mb-1.5 block">Tipo</label>
              <select value={tipo} onChange={(e) => setTipo(e.target.value)}
                className="w-full border border-line rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary">
                <option value="inicial">Inicial</option>
                <option value="seguimiento">Seguimiento</option>
                <option value="control">Control</option>
                <option value="urgencia">Urgencia</option>
              </select>
            </div>
          </div>

          {/* Motivo */}
          <div>
            <label className="text-xs font-medium text-muted mb-1.5 block">Motivo (opcional)</label>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej. Control de peso mensual"
              className="w-full border border-line rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary" />
          </div>

          {error && <p className="text-accent text-sm">{error}</p>}

          <button onClick={crear} disabled={guardando || !pacienteId}
            className="w-full py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-dk transition-colors disabled:opacity-50">
            {guardando ? 'Creando…' : 'Crear cita'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## Paso 6 — Integrar `AgendaSemanal` en el routing de `web-professional`

Localiza el archivo de rutas de la app profesional (probablemente `App.tsx` o el router principal) y agrega una ruta `/agenda`:

```tsx
import AgendaSemanal from './components/agenda/AgendaSemanal';

// Dentro de las rutas:
<Route path="/agenda" element={<AgendaSemanal />} />
```

Agrega también el ítem en la navegación lateral (sidebar) del profesional. Busca el componente de nav/sidebar existente y agrega:

```tsx
{ to: '/agenda', label: 'Agenda', icon: <IconCalendar /> }
```

---

## Paso 7 — Actualizar tarjeta de próxima cita en `apps/web-patient`

La tarjeta de "Próxima cita" en el Dashboard del paciente ya existe pero saca los datos del endpoint `/api/paciente/dashboard`. Actualízala para usar el nuevo endpoint `/api/paciente/citas` que es más completo.

En `apps/web-patient/src/pages/Dashboard.tsx`, reemplaza la query de `proximaCita` del dashboard con una llamada al nuevo endpoint. Agrega también un componente de cuenta regresiva:

```tsx
function CuentaRegresiva({ inicio }: { inicio: string }) {
  const ahora   = new Date();
  const citaDate = new Date(inicio);
  const diffMs  = citaDate.getTime() - ahora.getTime();

  if (diffMs < 0) return null;

  const dias    = Math.floor(diffMs / 86400000);
  const horas   = Math.floor((diffMs % 86400000) / 3600000);
  const minutos = Math.floor((diffMs % 3600000) / 60000);

  if (dias > 0) return <span className="text-xs text-primary font-medium">En {dias} día{dias > 1 ? 's' : ''}</span>;
  if (horas > 0) return <span className="text-xs text-accent font-medium">En {horas} h {minutos} min</span>;
  return <span className="text-xs text-accent font-semibold animate-pulse">¡Hoy! En {minutos} min</span>;
}
```

---

## Paso 8 — Registrar ruta del paciente en el servidor

En `apps/api/src/pac/paciente.routes.ts`, agrega el endpoint `GET /api/paciente/citas` del Paso 3 al plugin existente del paciente.

---

## Paso 9 — Verificación manual

### 9.1 API

```bash
# Obtener token del profesional desde DevTools → copiar header Authorization
TOKEN="pega_tu_jwt_aqui"

# Crear cita de prueba
curl -s -X POST http://localhost:4001/api/citas \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pacienteId": "UUID-DE-PACIENTE-REAL",
    "inicio": "2026-08-18T10:00:00-06:00",
    "fin": "2026-08-18T11:00:00-06:00",
    "tipo": "seguimiento",
    "motivo": "Control mensual"
  }' | jq .

# Ver agenda de la semana actual
curl -s "http://localhost:4001/api/citas?semana=2026-W34" \
  -H "Authorization: Bearer $TOKEN" | jq .citas[].paciente_nombre

# Intentar solapamiento → debe retornar 409
curl -s -X POST http://localhost:4001/api/citas \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pacienteId": "OTRO-UUID",
    "inicio": "2026-08-18T10:30:00-06:00",
    "fin": "2026-08-18T11:30:00-06:00",
    "tipo": "inicial"
  }' | jq .error
```

### 9.2 Frontend profesional

1. Navega a `/agenda` → debe verse la grilla semanal con las citas creadas
2. Haz clic en un slot vacío → debe abrirse `FormNuevaCita` con la fecha/hora pre-llenada
3. Busca un paciente por nombre → el autocomplete muestra resultados
4. Crea la cita → aparece en la grilla sin recargar la página
5. Haz clic en una cita existente → `ModalCita` muestra detalle
6. Cambia el estado a "Realizada" y agrega notas → guardar → cita se actualiza en la grilla
7. Cancela una cita → desaparece de la grilla (sigue en DB con estado='cancelada')

### 9.3 App del paciente

8. Abre `http://localhost:5175/dashboard`
9. La tarjeta "Próxima cita" muestra la cita que se creó en 9.1
10. Si la cita es hoy o mañana, la cuenta regresiva es visible

### 9.4 Verificación de seguridad

11. Intenta `GET /api/citas` con token de paciente → 403
12. Intenta crear una cita con `pacienteId` de otra clínica → 404
13. Cancela una cita ya cancelada → 404

### 9.5 Historias verificadas

| ID      | Historia                                              | Componente / ruta                        |
|---------|-------------------------------------------------------|------------------------------------------|
| AGE-01-01 | Profesional crea cita desde calendario              | `FormNuevaCita` + `POST /api/citas`      |
| AGE-01-02 | Click en slot pre-llena fecha y hora                | `slotNuevo` prop en `AgendaSemanal`      |
| AGE-01-03 | Sistema rechaza solapamiento con mensaje claro      | Validación en API → 409                  |
| AGE-01-04 | Profesional navega entre semanas                    | `semanaAnterior` / `semanaSiguiente`     |
| AGE-01-05 | Profesional cambia estado de cita                   | `ModalCita` + `PATCH /api/citas/:id`     |
| AGE-01-06 | Cancelar cita → soft-delete                         | `DELETE /api/citas/:id`                  |
| AGE-01-07 | Notas clínicas post-consulta                        | Campo `notas_clinicas` en `ModalCita`    |
| AGE-02-01 | Paciente ve próxima cita en dashboard               | `GET /api/paciente/citas`                |
| AGE-02-02 | Cuenta regresiva en tiempo real                     | `CuentaRegresiva` component              |
| AGE-02-03 | Notificación al paciente al crear cita              | INSERT notificacion en POST /api/citas   |

---

## Notas para r21

- **Recordatorios automáticos**: la tabla `cita` tiene `recordatorio_24h` y `recordatorio_1h`. En r21 se puede agregar un job programado (pg_cron o worker) que evalúe citas próximas y envíe notificaciones via Resend o la tabla `notificacion`. Se diseñó el campo ahora para no migrar después.
- **Vista mensual**: el calendario semanal es suficiente para el MVP. Una vista mensual (tipo Google Calendar) puede ser r22.
- **Vincular cita con consulta EVAL**: cuando el profesional finaliza una `consulta` (bloque EVAL), debería marcar la `cita` correspondiente como `realizada` automáticamente. El campo `consulta_origen_id` en `cita` está preparado para este link.
- **r15 y r16**: siguen pendientes de ejecución (EVAL-05 conclusiones + calculadora, EVAL-08 seguimiento inteligente). Son prompts ya escritos — ejecutarlos antes de r21 desbloquea el módulo EVAL completo.
