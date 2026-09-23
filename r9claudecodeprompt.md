Lee docs/REBANADA-09.md antes de empezar. Sigue el orden exacto indicado al final
de ese documento y adapta nombres al código real del proyecto.

────────────────────────────────────────────────────────────
ANTES DE ESCRIBIR CUALQUIER CÓDIGO — leer estas referencias
────────────────────────────────────────────────────────────

1. Lee apps/api/src/server.ts para confirmar nombre del archivo principal y
   cómo se registran las rutas (importación + app.register o router.use).
2. Lee una ruta existente (por ejemplo sociodemografico.ts o laboratorios.ts)
   para confirmar:
   - Cómo se extrae tenantId del token (campo exacto)
   - Cómo se valida el rol con requireAuth
   - Cómo funciona resolverAlcance
   - Qué columna de profesional vincula con el sub del token (para resolver
     profesional_id desde el JWT — puede ser keycloak_user_id u otra)
3. Lee apps/web-professional/src/pages/PacienteFicha.tsx para ver cómo están
   implementadas las pestañas existentes (Laboratorios, Sociodemografía) y
   replicar el mismo patrón de tabs.
4. Lee apps/web-professional/src/components/AgendaHoy.tsx o cualquier componente
   que use badges de estado, para copiar los colores de estado ya definidos.

────────────────────────────────────────────────────────────
PASO 1 — MIGRACIÓN
────────────────────────────────────────────────────────────

Archivo: apps/api/migrations/011_plan_alimentario.sql

IMPORTANTE: verifica en migrate.ts si los archivos se envuelven en transacción
automática. Si es así, no incluyas BEGIN/COMMIT propios.

```sql
-- migration: 011_plan_alimentario

CREATE TYPE estado_plan AS ENUM ('borrador', 'activo', 'archivado');
CREATE TYPE tipo_comida  AS ENUM (
  'desayuno', 'media_manana', 'almuerzo', 'merienda', 'cena', 'extra'
);

CREATE TABLE plan_alimentario (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      UUID        NOT NULL REFERENCES clinica(id),
  paciente_id     UUID        NOT NULL REFERENCES paciente(id),
  profesional_id  UUID        NOT NULL REFERENCES profesional(id),
  nombre          TEXT        NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 120),
  objetivo        TEXT        CHECK (char_length(objetivo) <= 500),
  fecha_inicio    DATE,
  fecha_fin       DATE,
  estado          estado_plan NOT NULL DEFAULT 'borrador',
  notas           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Solo un plan activo por paciente en la misma clínica
CREATE UNIQUE INDEX idx_plan_activo_por_paciente
  ON plan_alimentario (clinica_id, paciente_id)
  WHERE estado = 'activo';

CREATE TRIGGER trg_plan_alimentario_updated_at
  BEFORE UPDATE ON plan_alimentario
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE plan_comida (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         UUID         NOT NULL REFERENCES plan_alimentario(id) ON DELETE CASCADE,
  dia_semana      SMALLINT     NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
  tipo_comida     tipo_comida  NOT NULL,
  descripcion     TEXT         NOT NULL CHECK (char_length(descripcion) <= 1000),
  calorias_kcal   SMALLINT     CHECK (calorias_kcal > 0),
  proteinas_g     NUMERIC(5,1) CHECK (proteinas_g >= 0),
  carbohidratos_g NUMERIC(5,1) CHECK (carbohidratos_g >= 0),
  grasas_g        NUMERIC(5,1) CHECK (grasas_g >= 0),
  notas           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  UNIQUE (plan_id, dia_semana, tipo_comida)
);

CREATE TRIGGER trg_plan_comida_updated_at
  BEFORE UPDATE ON plan_comida
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Ejecuta npm run migrate en apps/api y confirma que ambas tablas aparecen
en information_schema.tables antes de continuar.

────────────────────────────────────────────────────────────
PASO 2 — RUTA API
────────────────────────────────────────────────────────────

Crea apps/api/src/routes/planes.ts.

Sigue el mismo patrón de autenticación y resolverAlcance que las rutas
existentes. clinica_id SIEMPRE del token (nunca de query string).

Para resolver profesional_id al crear un plan, busca en rutas existentes
la consulta que convierte request.auth.sub (Keycloak user ID) al UUID
interno de profesional. Usa ese mismo patrón.

```typescript
import { FastifyInstance } from 'fastify';
// Adapta imports según el proyecto real: requireAuth, resolverAlcance, db, etc.

export async function planesRoutes(app: FastifyInstance) {

  // ── GET /api/pacientes/:pacienteId/planes ───────────────────────────────
  // Lista de planes (cabecera solamente, sin comidas)
  app.get('/api/pacientes/:pacienteId/planes', { preHandler: [requireAuth] },
    async (request, reply) => {
      const { pacienteId } = request.params as { pacienteId: string };
      const clinicaId = request.auth.tenantId;

      // Verificar acceso al paciente usando resolverAlcance
      const acceso = await resolverAlcance(request, pacienteId);
      if (!acceso) return reply.code(404).send({ error: 'Paciente no encontrado' });

      const rows = await db.query(
        `SELECT id, nombre, estado, fecha_inicio, fecha_fin, created_at
         FROM plan_alimentario
         WHERE clinica_id = $1 AND paciente_id = $2
         ORDER BY created_at DESC`,
        [clinicaId, pacienteId]
      );
      return reply.send(rows.rows);
    }
  );

  // ── POST /api/pacientes/:pacienteId/planes ──────────────────────────────
  // Crea plan en estado borrador
  app.post('/api/pacientes/:pacienteId/planes', { preHandler: [requireAuth] },
    async (request, reply) => {
      const { pacienteId } = request.params as { pacienteId: string };
      const clinicaId = request.auth.tenantId;
      const body = request.body as {
        nombre: string;
        objetivo?: string;
        fecha_inicio?: string;
        fecha_fin?: string;
        notas?: string;
      };

      // Verificar acceso al paciente
      const acceso = await resolverAlcance(request, pacienteId);
      if (!acceso) return reply.code(404).send({ error: 'Paciente no encontrado' });

      // Resolver profesional_id desde el sub del token
      // Usa el mismo patrón que las otras rutas del proyecto
      const prof = await db.query(
        `SELECT id FROM profesional WHERE keycloak_user_id = $1 AND clinica_id = $2`,
        [request.auth.sub, clinicaId]
      );
      if (!prof.rows.length) {
        return reply.code(403).send({ error: 'Profesional no encontrado' });
      }
      const profesionalId = prof.rows[0].id;

      const result = await db.query(
        `INSERT INTO plan_alimentario
           (clinica_id, paciente_id, profesional_id, nombre, objetivo,
            fecha_inicio, fecha_fin, notas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          clinicaId, pacienteId, profesionalId,
          body.nombre, body.objetivo ?? null,
          body.fecha_inicio ?? null, body.fecha_fin ?? null,
          body.notas ?? null
        ]
      );
      return reply.code(201).send(result.rows[0]);
    }
  );

  // ── GET /api/planes/:planId ─────────────────────────────────────────────
  // Plan completo con comidas agrupadas por día
  app.get('/api/planes/:planId', { preHandler: [requireAuth] },
    async (request, reply) => {
      const { planId } = request.params as { planId: string };
      const clinicaId = request.auth.tenantId;

      // Obtener plan verificando tenant
      const planRes = await db.query(
        `SELECT pa.*, p.activo as paciente_activo
         FROM plan_alimentario pa
         JOIN paciente p ON p.id = pa.paciente_id
         WHERE pa.id = $1 AND pa.clinica_id = $2`,
        [planId, clinicaId]
      );
      if (!planRes.rows.length) {
        return reply.code(404).send({ error: 'Plan no encontrado' });
      }
      const plan = planRes.rows[0];

      // Verificar acceso al paciente del plan
      const acceso = await resolverAlcance(request, plan.paciente_id);
      if (!acceso) return reply.code(404).send({ error: 'Plan no encontrado' });

      // Obtener comidas
      const comidasRes = await db.query(
        `SELECT id, dia_semana, tipo_comida, descripcion,
                calorias_kcal, proteinas_g, carbohidratos_g, grasas_g, notas
         FROM plan_comida
         WHERE plan_id = $1
         ORDER BY dia_semana, tipo_comida`,
        [planId]
      );

      // Agrupar comidas por día
      const dias: Record<number, typeof comidasRes.rows> = {};
      for (const c of comidasRes.rows) {
        if (!dias[c.dia_semana]) dias[c.dia_semana] = [];
        dias[c.dia_semana].push(c);
      }

      const { paciente_activo, ...planData } = plan;
      return reply.send({ ...planData, dias });
    }
  );

  // ── PUT /api/planes/:planId ─────────────────────────────────────────────
  // Actualizar cabecera (solo borrador o activo)
  app.put('/api/planes/:planId', { preHandler: [requireAuth] },
    async (request, reply) => {
      const { planId } = request.params as { planId: string };
      const clinicaId = request.auth.tenantId;
      const body = request.body as {
        nombre?: string;
        objetivo?: string;
        fecha_inicio?: string;
        fecha_fin?: string;
        notas?: string;
      };

      const planRes = await db.query(
        `SELECT * FROM plan_alimentario WHERE id = $1 AND clinica_id = $2`,
        [planId, clinicaId]
      );
      if (!planRes.rows.length) return reply.code(404).send({ error: 'Plan no encontrado' });
      const plan = planRes.rows[0];

      const acceso = await resolverAlcance(request, plan.paciente_id);
      if (!acceso) return reply.code(404).send({ error: 'Plan no encontrado' });

      if (plan.estado === 'archivado') {
        return reply.code(409).send({ error: 'No se puede editar un plan archivado' });
      }

      const result = await db.query(
        `UPDATE plan_alimentario
         SET nombre       = COALESCE($1, nombre),
             objetivo     = COALESCE($2, objetivo),
             fecha_inicio = COALESCE($3, fecha_inicio),
             fecha_fin    = COALESCE($4, fecha_fin),
             notas        = COALESCE($5, notas)
         WHERE id = $6
         RETURNING *`,
        [
          body.nombre ?? null, body.objetivo ?? null,
          body.fecha_inicio ?? null, body.fecha_fin ?? null,
          body.notas ?? null, planId
        ]
      );
      return reply.send(result.rows[0]);
    }
  );

  // ── PUT /api/planes/:planId/comidas ─────────────────────────────────────
  // Reemplaza TODAS las comidas del plan en una transacción
  app.put('/api/planes/:planId/comidas', { preHandler: [requireAuth] },
    async (request, reply) => {
      const { planId } = request.params as { planId: string };
      const clinicaId = request.auth.tenantId;
      const comidas = request.body as Array<{
        dia_semana: number;
        tipo_comida: string;
        descripcion: string;
        calorias_kcal?: number;
        proteinas_g?: number;
        carbohidratos_g?: number;
        grasas_g?: number;
        notas?: string;
      }>;

      const planRes = await db.query(
        `SELECT * FROM plan_alimentario WHERE id = $1 AND clinica_id = $2`,
        [planId, clinicaId]
      );
      if (!planRes.rows.length) return reply.code(404).send({ error: 'Plan no encontrado' });
      const plan = planRes.rows[0];

      const acceso = await resolverAlcance(request, plan.paciente_id);
      if (!acceso) return reply.code(404).send({ error: 'Plan no encontrado' });

      if (plan.estado === 'archivado') {
        return reply.code(409).send({ error: 'No se puede editar un plan archivado' });
      }

      // Validar que descripcion no esté vacía en ninguna comida
      for (const c of comidas) {
        if (!c.descripcion || c.descripcion.trim().length === 0) {
          return reply.code(400).send({ error: 'La descripción de cada comida es obligatoria' });
        }
      }

      // Transacción: borrar todo e insertar lo nuevo
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM plan_comida WHERE plan_id = $1', [planId]);

        for (const c of comidas) {
          await client.query(
            `INSERT INTO plan_comida
               (plan_id, dia_semana, tipo_comida, descripcion,
                calorias_kcal, proteinas_g, carbohidratos_g, grasas_g, notas)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              planId, c.dia_semana, c.tipo_comida, c.descripcion,
              c.calorias_kcal ?? null, c.proteinas_g ?? null,
              c.carbohidratos_g ?? null, c.grasas_g ?? null,
              c.notas ?? null
            ]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      return reply.send({ ok: true, comidas: comidas.length });
    }
  );

  // ── PUT /api/planes/:planId/activar ─────────────────────────────────────
  app.put('/api/planes/:planId/activar', { preHandler: [requireAuth] },
    async (request, reply) => {
      const { planId } = request.params as { planId: string };
      const clinicaId = request.auth.tenantId;

      const planRes = await db.query(
        `SELECT * FROM plan_alimentario WHERE id = $1 AND clinica_id = $2`,
        [planId, clinicaId]
      );
      if (!planRes.rows.length) return reply.code(404).send({ error: 'Plan no encontrado' });
      const plan = planRes.rows[0];

      const acceso = await resolverAlcance(request, plan.paciente_id);
      if (!acceso) return reply.code(404).send({ error: 'Plan no encontrado' });

      if (plan.estado === 'archivado') {
        return reply.code(409).send({ error: 'Un plan archivado no se puede activar' });
      }
      if (plan.estado === 'activo') {
        return reply.send(plan); // no-op
      }

      try {
        const result = await db.query(
          `UPDATE plan_alimentario SET estado = 'activo' WHERE id = $1 RETURNING *`,
          [planId]
        );
        return reply.send(result.rows[0]);
      } catch (err: any) {
        // Constraint: idx_plan_activo_por_paciente (unique violation = 23505)
        if (err.code === '23505') {
          return reply.code(409).send({
            error: 'El paciente ya tiene un plan activo. Archívalo antes de activar este.'
          });
        }
        throw err;
      }
    }
  );

  // ── PUT /api/planes/:planId/archivar ────────────────────────────────────
  app.put('/api/planes/:planId/archivar', { preHandler: [requireAuth] },
    async (request, reply) => {
      const { planId } = request.params as { planId: string };
      const clinicaId = request.auth.tenantId;

      const planRes = await db.query(
        `SELECT * FROM plan_alimentario WHERE id = $1 AND clinica_id = $2`,
        [planId, clinicaId]
      );
      if (!planRes.rows.length) return reply.code(404).send({ error: 'Plan no encontrado' });
      const plan = planRes.rows[0];

      const acceso = await resolverAlcance(request, plan.paciente_id);
      if (!acceso) return reply.code(404).send({ error: 'Plan no encontrado' });

      if (plan.estado === 'archivado') {
        return reply.code(409).send({ error: 'El plan ya está archivado' });
      }

      const result = await db.query(
        `UPDATE plan_alimentario SET estado = 'archivado' WHERE id = $1 RETURNING *`,
        [planId]
      );
      return reply.send(result.rows[0]);
    }
  );

  // ── DELETE /api/planes/:planId ──────────────────────────────────────────
  // Eliminación lógica: solo borradores → estado = archivado
  app.delete('/api/planes/:planId', { preHandler: [requireAuth] },
    async (request, reply) => {
      const { planId } = request.params as { planId: string };
      const clinicaId = request.auth.tenantId;

      const planRes = await db.query(
        `SELECT * FROM plan_alimentario WHERE id = $1 AND clinica_id = $2`,
        [planId, clinicaId]
      );
      if (!planRes.rows.length) return reply.code(404).send({ error: 'Plan no encontrado' });
      const plan = planRes.rows[0];

      const acceso = await resolverAlcance(request, plan.paciente_id);
      if (!acceso) return reply.code(404).send({ error: 'Plan no encontrado' });

      if (plan.estado !== 'borrador') {
        return reply.code(409).send({
          error: 'Solo se pueden eliminar planes en borrador. Archiva el plan si deseas desactivarlo.'
        });
      }

      await db.query(
        `UPDATE plan_alimentario SET estado = 'archivado' WHERE id = $1`,
        [planId]
      );
      return reply.code(204).send();
    }
  );
}
```

IMPORTANTE: adapta el código anterior para que use exactamente los mismos
patrones de importación, nombre de la instancia de db, firma de requireAuth
y resolverAlcance que usan las rutas existentes. No inventes patrones nuevos.

Si el proyecto usa un pool de pg directamente en lugar de db.connect() para
transacciones, busca en el código existente cómo se hacen transacciones
y replica ese mismo patrón.

────────────────────────────────────────────────────────────
PASO 3 — REGISTRAR RUTA
────────────────────────────────────────────────────────────

Lee apps/api/src/server.ts y registra planesRoutes siguiendo el mismo
patrón que las otras rutas. Importa del archivo que acabas de crear.

────────────────────────────────────────────────────────────
PASO 4 — PlanCard.tsx
────────────────────────────────────────────────────────────

Crea apps/web-professional/src/components/PlanCard.tsx

```tsx
interface Plan {
  id: string;
  nombre: string;
  estado: 'borrador' | 'activo' | 'archivado';
  fecha_inicio: string | null;
  created_at: string;
}

interface PlanCardProps {
  plan: Plan;
  seleccionado: boolean;
  onClick: () => void;
}

const BADGE: Record<Plan['estado'], string> = {
  borrador:   'bg-gray-100 text-gray-600',
  activo:     'bg-green-100 text-green-700',
  archivado:  'bg-slate-100 text-slate-500',
};

const LABEL: Record<Plan['estado'], string> = {
  borrador:  'Borrador',
  activo:    'Activo',
  archivado: 'Archivado',
};

export default function PlanCard({ plan, seleccionado, onClick }: PlanCardProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-colors ${
        seleccionado
          ? 'border-primary bg-primary/5'
          : 'border-gray-200 hover:border-gray-300 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-gray-800 line-clamp-2">{plan.nombre}</span>
        <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${BADGE[plan.estado]}`}>
          {LABEL[plan.estado]}
        </span>
      </div>
      {plan.fecha_inicio && (
        <p className="mt-1 text-xs text-gray-500">
          Desde {new Date(plan.fecha_inicio + 'T00:00:00').toLocaleDateString('es-CR')}
        </p>
      )}
    </button>
  );
}
```

────────────────────────────────────────────────────────────
PASO 5 — PlanGrilla.tsx
────────────────────────────────────────────────────────────

Crea apps/web-professional/src/components/PlanGrilla.tsx

```tsx
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const TIPOS: Array<{ key: string; label: string }> = [
  { key: 'desayuno',    label: 'Desayuno' },
  { key: 'media_manana', label: 'Med. mañana' },
  { key: 'almuerzo',    label: 'Almuerzo' },
  { key: 'merienda',   label: 'Merienda' },
  { key: 'cena',       label: 'Cena' },
  { key: 'extra',      label: 'Extra' },
];

interface Comida {
  id: string;
  dia_semana: number;
  tipo_comida: string;
  descripcion: string;
  calorias_kcal: number | null;
}

interface PlanGrillaProps {
  // dias: Record<"1"|"2"..., Comida[]> — tal como devuelve la API
  dias: Record<string, Comida[]>;
}

export default function PlanGrilla({ dias }: PlanGrillaProps) {
  // Construir mapa plano: "dia_tipo" → Comida
  const mapa: Record<string, Comida> = {};
  for (const [dia, comidas] of Object.entries(dias)) {
    for (const c of comidas) {
      mapa[`${dia}_${c.tipo_comida}`] = c;
    }
  }

  // Mostrar solo filas con al menos una comida en algún día
  const tiposVisibles = TIPOS.filter(t =>
    [1,2,3,4,5,6,7].some(d => mapa[`${d}_${t.key}`])
  );

  if (tiposVisibles.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic py-4">
        Este plan no tiene comidas cargadas todavía.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="text-left text-xs font-medium text-gray-500 py-2 pr-3 w-28">Comida</th>
            {DIAS.map(d => (
              <th key={d} className="text-center text-xs font-medium text-gray-500 py-2 px-2 min-w-[120px]">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tiposVisibles.map(tipo => (
            <tr key={tipo.key} className="border-t border-gray-100">
              <td className="text-xs font-medium text-gray-600 py-2 pr-3 align-top whitespace-nowrap">
                {tipo.label}
              </td>
              {[1,2,3,4,5,6,7].map(dia => {
                const c = mapa[`${dia}_${tipo.key}`];
                return (
                  <td key={dia} className="py-2 px-2 align-top">
                    {c ? (
                      <div className="bg-gray-50 rounded p-2">
                        <p className="text-xs text-gray-700 line-clamp-2">{c.descripcion}</p>
                        {c.calorias_kcal && (
                          <p className="text-xs text-gray-400 mt-1">{c.calorias_kcal} kcal</p>
                        )}
                      </div>
                    ) : (
                      <div className="h-12" />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

────────────────────────────────────────────────────────────
PASO 6 — PlanEditor.tsx
────────────────────────────────────────────────────────────

Crea apps/web-professional/src/components/PlanEditor.tsx

```tsx
import { useState } from 'react';
// Importa useAuth o el hook que el proyecto use para obtener el token
// Sigue el mismo patrón que otras páginas para hacer fetch autenticado

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const TIPOS: Array<{ key: string; label: string }> = [
  { key: 'desayuno',    label: 'Desayuno' },
  { key: 'media_manana', label: 'Med. mañana' },
  { key: 'almuerzo',    label: 'Almuerzo' },
  { key: 'merienda',   label: 'Merienda' },
  { key: 'cena',       label: 'Cena' },
  { key: 'extra',      label: 'Extra' },
];

interface CeldaEdicion {
  descripcion: string;
  calorias_kcal: string;
}

interface ComidaExistente {
  dia_semana: number;
  tipo_comida: string;
  descripcion: string;
  calorias_kcal: number | null;
}

interface PlanEditorProps {
  planId: string;
  diasIniciales: Record<string, ComidaExistente[]>;
  onGuardado: () => void;
  onCancelar: () => void;
}

// Convierte el mapa de días a un estado editable plano
function diasAEstado(dias: Record<string, ComidaExistente[]>): Record<string, CeldaEdicion> {
  const estado: Record<string, CeldaEdicion> = {};
  for (let d = 1; d <= 7; d++) {
    for (const t of TIPOS) {
      estado[`${d}_${t.key}`] = { descripcion: '', calorias_kcal: '' };
    }
  }
  for (const [dia, comidas] of Object.entries(dias)) {
    for (const c of comidas) {
      const key = `${dia}_${c.tipo_comida}`;
      estado[key] = {
        descripcion: c.descripcion,
        calorias_kcal: c.calorias_kcal != null ? String(c.calorias_kcal) : '',
      };
    }
  }
  return estado;
}

export default function PlanEditor({ planId, diasIniciales, onGuardado, onCancelar }: PlanEditorProps) {
  const [celdas, setCeldas] = useState<Record<string, CeldaEdicion>>(() =>
    diasAEstado(diasIniciales)
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  // Usa el mismo hook/patrón de fetch autenticado que otras páginas del proyecto
  const { getToken } = useAuth(); // adapta según el hook real

  const actualizar = (key: string, campo: keyof CeldaEdicion, valor: string) => {
    setCeldas(prev => ({ ...prev, [key]: { ...prev[key], [campo]: valor } }));
  };

  const guardar = async () => {
    setGuardando(true);
    setError('');
    try {
      // Construir array solo con celdas que tienen descripción
      const comidas = [];
      for (let d = 1; d <= 7; d++) {
        for (const t of TIPOS) {
          const c = celdas[`${d}_${t.key}`];
          if (c.descripcion.trim()) {
            comidas.push({
              dia_semana: d,
              tipo_comida: t.key,
              descripcion: c.descripcion.trim(),
              calorias_kcal: c.calorias_kcal ? parseInt(c.calorias_kcal) : undefined,
            });
          }
        }
      }

      const token = await getToken();
      const res = await fetch(`/api/planes/${planId}/comidas`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(comidas),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Error al guardar');
      }
      onGuardado();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  const BotonesAccion = () => (
    <div className="flex gap-2">
      <button
        onClick={guardar}
        disabled={guardando}
        className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-hover disabled:opacity-50"
      >
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
      <button
        onClick={onCancelar}
        disabled={guardando}
        className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:border-gray-300"
      >
        Cancelar
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <BotonesAccion />

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-left text-xs font-medium text-gray-500 py-2 pr-3 w-28">Comida</th>
              {DIAS.map(d => (
                <th key={d} className="text-center text-xs font-medium text-gray-500 py-2 px-2 min-w-[150px]">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIPOS.map(tipo => (
              <tr key={tipo.key} className="border-t border-gray-100">
                <td className="text-xs font-medium text-gray-600 py-2 pr-3 align-top whitespace-nowrap">
                  {tipo.label}
                </td>
                {[1,2,3,4,5,6,7].map(dia => {
                  const key = `${dia}_${tipo.key}`;
                  const c = celdas[key];
                  return (
                    <td key={dia} className="py-1 px-1 align-top">
                      <div className="space-y-1">
                        <textarea
                          rows={3}
                          value={c.descripcion}
                          onChange={e => actualizar(key, 'descripcion', e.target.value)}
                          placeholder="Descripción…"
                          maxLength={1000}
                          className="w-full text-xs border border-gray-200 rounded p-1.5 resize-none focus:outline-none focus:border-primary"
                        />
                        <input
                          type="number"
                          min={1}
                          value={c.calorias_kcal}
                          onChange={e => actualizar(key, 'calorias_kcal', e.target.value)}
                          placeholder="kcal"
                          className="w-full text-xs border border-gray-200 rounded p-1.5 focus:outline-none focus:border-primary"
                        />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <BotonesAccion />
    </div>
  );
}
```

NOTA: adapta `useAuth` y `getToken` al hook real del proyecto. Busca cómo
las otras páginas obtienen el token Bearer y usa el mismo mecanismo.

────────────────────────────────────────────────────────────
PASO 7 — PlanAlimentarioTab.tsx
────────────────────────────────────────────────────────────

Crea apps/web-professional/src/components/PlanAlimentarioTab.tsx

```tsx
import { useState, useEffect, useCallback } from 'react';
import PlanCard from './PlanCard';
import PlanGrilla from './PlanGrilla';
import PlanEditor from './PlanEditor';
// Adapta useAuth según el proyecto real

interface Plan {
  id: string;
  nombre: string;
  estado: 'borrador' | 'activo' | 'archivado';
  fecha_inicio: string | null;
  fecha_fin: string | null;
  objetivo: string | null;
  notas: string | null;
  created_at: string;
}

interface PlanDetalle extends Plan {
  dias: Record<string, any[]>;
}

interface PlanAlimentarioTabProps {
  pacienteId: string;
}

export default function PlanAlimentarioTab({ pacienteId }: PlanAlimentarioTabProps) {
  const { getToken } = useAuth(); // adapta
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [planSeleccionado, setPlanSeleccionado] = useState<PlanDetalle | null>(null);
  const [modoEdicion, setModoEdicion] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [accionando, setAccionando] = useState(false);
  const [mensajeAccion, setMensajeAccion] = useState('');

  // Estado para crear nuevo plan
  const [creando, setCreando] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoObjetivo, setNuevoObjetivo] = useState('');

  const authFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const token = await getToken();
    return fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {}),
      },
    });
  }, [getToken]);

  const cargarPlanes = useCallback(async () => {
    setCargando(true);
    try {
      const res = await authFetch(`/api/pacientes/${pacienteId}/planes`);
      if (!res.ok) throw new Error('Error al cargar planes');
      const data = await res.json();
      setPlanes(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [pacienteId, authFetch]);

  const cargarPlan = useCallback(async (planId: string) => {
    try {
      const res = await authFetch(`/api/planes/${planId}`);
      if (!res.ok) throw new Error('Error al cargar plan');
      const data = await res.json();
      setPlanSeleccionado(data);
      setModoEdicion(false);
    } catch (e: any) {
      setError(e.message);
    }
  }, [authFetch]);

  useEffect(() => { cargarPlanes(); }, [cargarPlanes]);

  const crearPlan = async () => {
    if (!nuevoNombre.trim()) return;
    setAccionando(true);
    try {
      const res = await authFetch(`/api/pacientes/${pacienteId}/planes`, {
        method: 'POST',
        body: JSON.stringify({
          nombre: nuevoNombre.trim(),
          objetivo: nuevoObjetivo.trim() || null,
        }),
      });
      if (!res.ok) throw new Error('Error al crear plan');
      const plan = await res.json();
      setCreando(false);
      setNuevoNombre('');
      setNuevoObjetivo('');
      await cargarPlanes();
      await cargarPlan(plan.id);
    } catch (e: any) {
      setMensajeAccion(e.message);
    } finally {
      setAccionando(false);
    }
  };

  const ejecutarAccion = async (accion: 'activar' | 'archivar' | 'eliminar') => {
    if (!planSeleccionado) return;
    setAccionando(true);
    setMensajeAccion('');
    try {
      let res: Response;
      if (accion === 'eliminar') {
        res = await authFetch(`/api/planes/${planSeleccionado.id}`, { method: 'DELETE' });
      } else {
        res = await authFetch(`/api/planes/${planSeleccionado.id}/${accion}`, { method: 'PUT' });
      }
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Error');
      }
      await cargarPlanes();
      if (accion === 'eliminar') {
        setPlanSeleccionado(null);
      } else {
        await cargarPlan(planSeleccionado.id);
      }
    } catch (e: any) {
      setMensajeAccion(e.message);
    } finally {
      setAccionando(false);
    }
  };

  return (
    <div className="flex gap-6 h-full">
      {/* Panel lateral — lista de planes */}
      <div className="w-64 shrink-0 space-y-3">
        <button
          onClick={() => { setCreando(true); setMensajeAccion(''); }}
          className="w-full py-2 px-3 border-2 border-dashed border-gray-300 text-gray-500 rounded-lg text-sm hover:border-primary hover:text-primary transition-colors"
        >
          + Nuevo plan
        </button>

        {/* Formulario de nuevo plan */}
        {creando && (
          <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-white">
            <input
              autoFocus
              type="text"
              placeholder="Nombre del plan"
              value={nuevoNombre}
              onChange={e => setNuevoNombre(e.target.value)}
              maxLength={120}
              className="w-full text-sm border border-gray-200 rounded p-2 focus:outline-none focus:border-primary"
            />
            <input
              type="text"
              placeholder="Objetivo (opcional)"
              value={nuevoObjetivo}
              onChange={e => setNuevoObjetivo(e.target.value)}
              maxLength={500}
              className="w-full text-sm border border-gray-200 rounded p-2 focus:outline-none focus:border-primary"
            />
            <div className="flex gap-2">
              <button
                onClick={crearPlan}
                disabled={accionando || !nuevoNombre.trim()}
                className="flex-1 py-1.5 bg-primary text-white rounded text-xs font-medium hover:bg-primary-hover disabled:opacity-50"
              >
                Crear
              </button>
              <button
                onClick={() => { setCreando(false); setNuevoNombre(''); setNuevoObjetivo(''); }}
                className="flex-1 py-1.5 border border-gray-200 text-gray-600 rounded text-xs hover:border-gray-300"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {cargando ? (
          <div className="space-y-2">
            {[1,2,3].map(i => (
              <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : planes.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">
            No hay planes registrados.
          </p>
        ) : (
          planes.map(p => (
            <PlanCard
              key={p.id}
              plan={p}
              seleccionado={planSeleccionado?.id === p.id}
              onClick={() => { cargarPlan(p.id); setMensajeAccion(''); }}
            />
          ))
        )}
      </div>

      {/* Panel principal */}
      <div className="flex-1 min-w-0">
        {!planSeleccionado ? (
          <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
            Selecciona un plan o crea uno nuevo.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Encabezado del plan */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{planSeleccionado.nombre}</h3>
                {planSeleccionado.objetivo && (
                  <p className="text-sm text-gray-500 mt-0.5">{planSeleccionado.objetivo}</p>
                )}
                {planSeleccionado.fecha_inicio && (
                  <p className="text-xs text-gray-400 mt-1">
                    Desde {new Date(planSeleccionado.fecha_inicio + 'T00:00:00').toLocaleDateString('es-CR')}
                    {planSeleccionado.fecha_fin &&
                      ` hasta ${new Date(planSeleccionado.fecha_fin + 'T00:00:00').toLocaleDateString('es-CR')}`
                    }
                  </p>
                )}
              </div>

              {/* Botones de acción según estado */}
              {!modoEdicion && (
                <div className="flex gap-2 shrink-0">
                  {planSeleccionado.estado === 'borrador' && (
                    <>
                      <button
                        onClick={() => ejecutarAccion('activar')}
                        disabled={accionando}
                        className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50"
                      >
                        Activar plan
                      </button>
                      <button
                        onClick={() => setModoEdicion(true)}
                        className="px-3 py-1.5 border border-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:border-gray-300"
                      >
                        Editar comidas
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('¿Eliminar este plan? Esta acción no se puede deshacer.')) {
                            ejecutarAccion('eliminar');
                          }
                        }}
                        disabled={accionando}
                        className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs font-medium hover:border-red-300 disabled:opacity-50"
                      >
                        Eliminar
                      </button>
                    </>
                  )}
                  {planSeleccionado.estado === 'activo' && (
                    <>
                      <button
                        onClick={() => ejecutarAccion('archivar')}
                        disabled={accionando}
                        className="px-3 py-1.5 border border-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:border-gray-300 disabled:opacity-50"
                      >
                        Archivar
                      </button>
                      <button
                        onClick={() => setModoEdicion(true)}
                        className="px-3 py-1.5 border border-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:border-gray-300"
                      >
                        Editar comidas
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Mensaje de error de acciones */}
            {mensajeAccion && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                {mensajeAccion}
              </div>
            )}

            {/* Grilla — lectura o edición */}
            {modoEdicion ? (
              <PlanEditor
                planId={planSeleccionado.id}
                diasIniciales={planSeleccionado.dias}
                onGuardado={async () => {
                  await cargarPlanes();
                  await cargarPlan(planSeleccionado.id);
                  setModoEdicion(false);
                }}
                onCancelar={() => setModoEdicion(false)}
              />
            ) : (
              <PlanGrilla dias={planSeleccionado.dias} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

────────────────────────────────────────────────────────────
PASO 8 — Integrar en PacienteFicha.tsx
────────────────────────────────────────────────────────────

Lee apps/web-professional/src/pages/PacienteFicha.tsx.

Sigue el mismo patrón de pestañas que ya existe para Laboratorios y
Sociodemografía. Agrega "Plan alimentario" como nueva pestaña:

1. Agrega la pestaña al array/enum de pestañas existente.
2. Importa PlanAlimentarioTab.
3. En el bloque condicional que renderiza el contenido de cada pestaña,
   agrega el caso para "Plan alimentario" que renderiza:
   <PlanAlimentarioTab pacienteId={paciente.id} />

────────────────────────────────────────────────────────────
PASO 9 — VERIFICACIÓN
────────────────────────────────────────────────────────────

1. npm run migrate en apps/api → confirmar que aparecen plan_alimentario
   y plan_comida en la base de datos sin error.

2. Compilar frontend sin errores TypeScript:
   cd apps/web-professional && npm run build

3. Pruebas manuales con el frontend levantado (http://localhost:5173):

   a) Abrir la ficha de cualquier paciente → debe aparecer la pestaña
      "Plan alimentario".

   b) Crear un nuevo plan → debe aparecer en la lista con badge "Borrador".

   c) Hacer clic en "Editar comidas" → rellenar desayuno y almuerzo del lunes
      → Guardar → la grilla debe mostrar las dos celdas.

   d) Hacer clic en "Activar plan" → badge cambia a verde "Activo".

   e) Crear un segundo plan para el mismo paciente → intentar activarlo →
      debe aparecer el mensaje:
      "El paciente ya tiene un plan activo. Archívalo antes de activar este."

   f) Archivar el plan activo → badge cambia a gris azulado "Archivado".
      Los botones de edición deben desaparecer.

4. Prueba de aislamiento de tenant: con usuario de otra clínica,
   GET /api/planes/:planId → debe responder 404.

────────────────────────────────────────────────────────────
PASO 10 — PRUEBAS.md Y COMMIT
────────────────────────────────────────────────────────────

Agrega al final de docs/PRUEBAS.md la sección "Rebanada 9 — Plan Alimentario"
con los casos CA-09-01 a CA-09-09 en formato PowerShell, siguiendo el estilo
de las secciones anteriores del archivo.

Ejemplo orientativo (adapta los valores de token y UUID reales):

```
## Rebanada 9 — Plan Alimentario

# CA-09-01: Crear plan en borrador
$plan = (Invoke-RestMethod -Uri "http://localhost:4001/api/pacientes/$pacienteId/planes" `
  -Method POST -Headers @{Authorization="Bearer $token"} `
  -ContentType "application/json" `
  -Body '{"nombre":"Plan test","objetivo":"Bajar 0.5 kg/semana"}')
$plan.estado  # borrador

# CA-09-02: Agregar comidas
Invoke-RestMethod -Uri "http://localhost:4001/api/planes/$($plan.id)/comidas" `
  -Method PUT -Headers @{Authorization="Bearer $token"} `
  -ContentType "application/json" `
  -Body '[{"dia_semana":1,"tipo_comida":"desayuno","descripcion":"Avena con frutas","calorias_kcal":320},{"dia_semana":1,"tipo_comida":"almuerzo","descripcion":"Arroz con pollo","calorias_kcal":580}]'
# ok: true, comidas: 2

# CA-09-03: Activar plan
Invoke-RestMethod -Uri "http://localhost:4001/api/planes/$($plan.id)/activar" `
  -Method PUT -Headers @{Authorization="Bearer $token"}
# estado: activo

# CA-09-04: Un solo plan activo (con otro plan en borrador ya existente)
# Intenta activar segundo plan → 409

# CA-09-05: Plan archivado es inmutable
# Archivar plan y luego intentar PUT /comidas → 409

# CA-09-06: Aislamiento de tenant
# GET /api/planes/:planId con token de otra clínica → 404

# CA-09-07: Eliminar solo borradores
# Intentar DELETE en plan activo → 409

# CA-09-08: Guardar plan vacío
Invoke-RestMethod -Uri "http://localhost:4001/api/planes/$($plan.id)/comidas" `
  -Method PUT -Headers @{Authorization="Bearer $token"} `
  -ContentType "application/json" -Body '[]'
# ok: true, comidas: 0

# CA-09-09: Macros opcionales
# Crear comida sin calorias_kcal → no error
```

Commit con este mensaje exacto:

R9: plan alimentario semanal por paciente (CLI-09)

- Migración 011: tablas plan_alimentario y plan_comida con ENUMs y constraints
- GET/POST /api/pacientes/:id/planes — listado y creación en borrador
- GET/PUT /api/planes/:planId — cabecera del plan
- PUT /api/planes/:planId/comidas — reemplazo completo en transacción
- PUT activar/archivar con constraint de un solo plan activo por paciente
- DELETE lógico solo para borradores (→ archivado)
- PlanCard, PlanGrilla, PlanEditor, PlanAlimentarioTab
- Nueva pestaña "Plan alimentario" en PacienteFicha
- Sección R9 en docs/PRUEBAS.md

git push origin main y reporta el hash del commit.
