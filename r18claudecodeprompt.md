# R18 — PAC epic: PAC-03 Mensajería del paciente + PAC-04 Seguimiento de acuerdos y plan

> **Contexto de sesión — leer antes de escribir una sola línea**
>
> **Framework API: Fastify** (no Express). Todos los handlers van en plugins async de Fastify.
> Revisa un archivo de rutas existente en `apps/api/src/` antes de escribir la primera ruta
> y replica exactamente el patrón de registro (plugin, prefix, preHandler) que ya usa el proyecto.
>
> **Auth del paciente:** el token NO trae `tenant_id`. La clínica se resuelve desde la DB:
> `SELECT clinica_id FROM paciente WHERE keycloak_user_id = request.user.sub`.
> No exigir rol Keycloak — la autorización la da la fila; si no existe → 404.
>
> **Columnas reales (verificadas en r17):**
> - `paciente.correo` · `paciente.estado` · `paciente.sexo_biologico`
> - `clinica.nombre_comercial`
> - `cita.inicio` (timestamptz, no fecha+hora separados)
> - `keycloak_user_id` existe desde migración 019
>
> **Stack frontend paciente:** Vite + React 18 + Tailwind v3 · puerto 5174
> keycloak-js con PKCE S256 ya instalado · sin recharts (SVG puro)
> Design tokens vía CSS vars: `--primary` #0E7C66 · `--accent` #C2410C · `--bg` #FBFCFC · `--ink` #1F2937 · `--muted` #6B7280 · `--line` #E3EAE8
> Los colores de clínica vienen de la API — nunca hardcodear hex.
>
> **Tablas ya existentes desde epicas anteriores:**
> - `conversacion` + `mensaje` (r11/COM) — PAC-03 las reutiliza sin migración nueva
> - `conclusion_valoracion` con campo `acuerdos JSONB` (r15/EVAL)
>
> Multitenancy: `clinica_id` siempre de la DB, nunca del token del paciente.
> Soft-delete: nunca DELETE físico.

---

## Objetivo de esta rebanada

Completar la experiencia del paciente con dos capacidades:

**PAC-03 — Mensajería:** el paciente puede leer y responder mensajes de su nutricionista desde la app. Reutiliza las tablas `conversacion` y `mensaje` de r11 (ya probadas desde el lado del profesional).

**PAC-04 — Seguimiento de acuerdos y plan:** el paciente puede ver su plan nutricional detallado y marcar acuerdos como cumplidos. Los cumplimientos se guardan en una tabla nueva con timestamp para tener historial clínico.

Al terminar deben funcionar:
- `GET /api/paciente/conversacion` — obtener (o crear) la conversación del paciente
- `GET /api/paciente/conversacion/mensajes` — listar mensajes con marca de leído
- `POST /api/paciente/conversacion/mensajes` — enviar mensaje como paciente
- `GET /api/paciente/plan` — plan nutricional activo con acuerdos y detalle de macros
- `POST /api/paciente/acuerdos/:id/cumplir` — marcar un acuerdo como cumplido
- Página `/mensajes` en `apps/web-patient`
- Página `/plan` en `apps/web-patient`
- Barra de navegación inferior compartida entre todas las páginas del paciente

---

## Paso 1 — Verificar número de migración y tablas existentes

```bash
ls apps/api/src/migrations/ | sort | tail -5
```

La migración de esta rebanada usa el siguiente número disponible. El prompt asume `020` — ajusta si r15, r16 u otras corrieron entre tanto.

Verifica que las tablas de r11 existen:

```sql
-- Conectar: psql postgresql://nutrismart:changeme@localhost:5434/nutrismart
SELECT table_name FROM information_schema.tables
 WHERE table_name IN ('conversacion', 'mensaje', 'conclusion_valoracion')
   AND table_schema = 'public';
```

Deben aparecer las tres. Si falta `conversacion` o `mensaje`, r11 no se ejecutó — detente y avisa.

---

## Paso 2 — Migración `020_pac_cumplimiento.sql`

Los acuerdos viven en `conclusion_valoracion.acuerdos JSONB` como `[{ texto, cumplido }]`.
No modificamos ese JSONB desde el lado del paciente — es propiedad del profesional.
En su lugar creamos una tabla de cumplimientos con historial: el profesional sigue viendo el acuerdo como "pendiente" en su vista hasta que él mismo lo marque; el paciente registra su avance aquí.

```sql
-- PAC-04: historial de cumplimiento de acuerdos por el paciente
-- Cada fila = un acuerdo cumplido (o revertido) en un momento dado.
-- No se modifica conclusion_valoracion.acuerdos — ese campo pertenece
-- al profesional y representa el plan pactado, no el seguimiento.

CREATE TABLE cumplimiento_acuerdo (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id        UUID        NOT NULL REFERENCES clinica(id),
  paciente_id       UUID        NOT NULL REFERENCES paciente(id),
  consulta_id       UUID        NOT NULL REFERENCES consulta(id),
  -- Posición (0-based) del acuerdo dentro del array acuerdos de conclusion_valoracion.
  -- Más estable que el texto (que puede editarse) y evita duplicar el copy.
  acuerdo_index     INT         NOT NULL,
  cumplido          BOOLEAN     NOT NULL DEFAULT true,
  registrado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  nota_paciente     TEXT,
  CONSTRAINT uq_cumplimiento UNIQUE (paciente_id, consulta_id, acuerdo_index)
  -- UNIQUE permite hacer UPSERT: el paciente puede marcar/desmarcar el mismo acuerdo.
);

CREATE INDEX idx_cumplimiento_pac
  ON cumplimiento_acuerdo (clinica_id, paciente_id, consulta_id);
```

Ejecuta la migración:

```bash
cd apps/api && node -e "
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = fs.readFileSync('src/migrations/020_pac_cumplimiento.sql', 'utf8');
pool.query(sql)
  .then(() => { console.log('OK'); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
"
```

---

## Paso 3 — API: rutas de mensajería del paciente (Fastify)

Crea `apps/api/src/pac/mensajeria-pac.routes.ts`.

**Antes de escribir el plugin**, abre un archivo de rutas existente del proyecto (por ejemplo `apps/api/src/pac/invitacion.routes.ts` creado en r17) y replica su estructura exacta: cómo se declara el plugin, cómo se registra el preHandler de auth, cómo se usa `request.user.sub`. No cambies el patrón — solo agrega rutas nuevas.

```typescript
// Patrón aproximado — ajusta al que ya usa el proyecto:
import { FastifyInstance } from 'fastify';
import { db } from '../db';

export async function mensajeriaPacRoutes(fastify: FastifyInstance) {

  // Helper: resolver paciente desde el JWT sub
  async function resolverPaciente(sub: string) {
    const { rows: [p] } = await db.query(
      `SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1`,
      [sub]
    );
    return p ?? null; // null → el handler devuelve 404
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/paciente/conversacion
  // Devuelve la conversación activa del paciente con su profesional.
  // Si no existe aún (el profesional no inició conversación), la crea.
  // Un paciente tiene exactamente un profesional principal → la del profesional
  // que lo invitó (guardado en invitacion_paciente.profesional_id).
  // ──────────────────────────────────────────────────────────────────────────
  fastify.get('/paciente/conversacion', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const paciente = await resolverPaciente(request.user.sub);
    if (!paciente) return reply.status(404).send({ error: 'Paciente no encontrado' });

    // Buscar conversación existente
    let { rows: [conv] } = await db.query(
      `SELECT c.id, c.profesional_id, c.mensajes_no_leidos_pac,
              p.nombre AS nombre_profesional
         FROM conversacion c
         JOIN profesional p ON p.id = c.profesional_id
        WHERE c.clinica_id = $1 AND c.paciente_id = $2 AND c.activa = true
        ORDER BY c.ultimo_mensaje_at DESC NULLS LAST
        LIMIT 1`,
      [paciente.clinica_id, paciente.id]
    );

    // Si no existe, crearla usando el profesional de la invitación aceptada
    if (!conv) {
      const { rows: [inv] } = await db.query(
        `SELECT profesional_id FROM invitacion_paciente
          WHERE paciente_id = $1 AND estado = 'aceptada'
          ORDER BY usado_en DESC LIMIT 1`,
        [paciente.id]
      );
      if (!inv) {
        return reply.status(404).send({
          error: 'No hay conversación disponible. Tu nutricionista la iniciará pronto.'
        });
      }

      const { rows: [nueva] } = await db.query(
        `INSERT INTO conversacion (clinica_id, paciente_id, profesional_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [paciente.clinica_id, paciente.id, inv.profesional_id]
      );

      // Si ON CONFLICT eliminó el insert, buscar la existente
      const { rows: [convExistente] } = await db.query(
        `SELECT c.id, c.profesional_id, c.mensajes_no_leidos_pac,
                p.nombre AS nombre_profesional
           FROM conversacion c
           JOIN profesional p ON p.id = c.profesional_id
          WHERE c.clinica_id = $1 AND c.paciente_id = $2 AND c.activa = true
          LIMIT 1`,
        [paciente.clinica_id, paciente.id]
      );
      conv = convExistente ?? { id: nueva?.id, profesional_id: inv.profesional_id, mensajes_no_leidos_pac: 0 };
    }

    return reply.send(conv);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/paciente/conversacion/mensajes?desde=ISO_TIMESTAMP
  // Lista mensajes y marca como leídos los del profesional.
  // ──────────────────────────────────────────────────────────────────────────
  fastify.get('/paciente/conversacion/mensajes', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const paciente = await resolverPaciente(request.user.sub);
    if (!paciente) return reply.status(404).send({ error: 'Paciente no encontrado' });

    const { desde } = request.query as { desde?: string };

    const { rows: [conv] } = await db.query(
      `SELECT id FROM conversacion
        WHERE clinica_id = $1 AND paciente_id = $2 AND activa = true
        LIMIT 1`,
      [paciente.clinica_id, paciente.id]
    );
    if (!conv) return reply.send([]);

    // Marcar como leídos los mensajes del profesional no leídos aún
    await db.query(
      `UPDATE mensaje
          SET leido = true, leido_en = now()
        WHERE conversacion_id = $1
          AND autor_tipo = 'profesional'
          AND leido = false`,
      [conv.id]
    );

    // Resetear contador
    await db.query(
      `UPDATE conversacion
          SET mensajes_no_leidos_pac = 0
        WHERE id = $1`,
      [conv.id]
    );

    const filtroDesde = desde ? `AND m.created_at > $3` : '';
    const params: unknown[] = [conv.id, 50];
    if (desde) params.push(desde);

    const { rows: mensajes } = await db.query(
      `SELECT m.id, m.autor_tipo, m.autor_id, m.contenido,
              m.leido, m.created_at
         FROM mensaje m
        WHERE m.conversacion_id = $1
          ${filtroDesde}
        ORDER BY m.created_at ASC
        LIMIT $2`,
      params
    );

    return reply.send(mensajes);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/paciente/conversacion/mensajes
  // El paciente envía un mensaje. Crea notificación para el profesional.
  // ──────────────────────────────────────────────────────────────────────────
  fastify.post('/paciente/conversacion/mensajes', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const paciente = await resolverPaciente(request.user.sub);
    if (!paciente) return reply.status(404).send({ error: 'Paciente no encontrado' });

    const { contenido } = request.body as { contenido?: string };
    if (!contenido?.trim() || contenido.length > 4000) {
      return reply.status(400).send({ error: 'El mensaje debe tener entre 1 y 4000 caracteres' });
    }

    const { rows: [conv] } = await db.query(
      `SELECT id, profesional_id FROM conversacion
        WHERE clinica_id = $1 AND paciente_id = $2 AND activa = true
        LIMIT 1`,
      [paciente.clinica_id, paciente.id]
    );
    if (!conv) return reply.status(404).send({ error: 'Conversación no encontrada' });

    await db.query('BEGIN');
    try {
      const { rows: [msg] } = await db.query(
        `INSERT INTO mensaje (conversacion_id, autor_tipo, autor_id, contenido)
         VALUES ($1, 'paciente', $2, $3)
         RETURNING id, autor_tipo, contenido, created_at`,
        [conv.id, paciente.id, contenido.trim()]
      );

      await db.query(
        `UPDATE conversacion
            SET ultimo_mensaje_at = now(),
                mensajes_no_leidos_prof = mensajes_no_leidos_prof + 1
          WHERE id = $1`,
        [conv.id]
      );

      // Notificación para el profesional
      await db.query(
        `INSERT INTO notificacion
           (clinica_id, destinatario_id, destinatario_tipo, tipo, titulo, contenido, enlace)
         VALUES ($1, $2, 'profesional', 'mensaje_nuevo',
                 'Nuevo mensaje de paciente',
                 LEFT($3, 80),
                 '/mensajes')`,
        [paciente.clinica_id, conv.profesional_id, contenido.trim()]
      );

      await db.query('COMMIT');
      return reply.status(201).send(msg);
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  });
}
```

---

## Paso 4 — API: rutas de plan y acuerdos del paciente (Fastify)

Crea `apps/api/src/pac/plan-pac.routes.ts`:

```typescript
import { FastifyInstance } from 'fastify';
import { db } from '../db';

export async function planPacRoutes(fastify: FastifyInstance) {

  async function resolverPaciente(sub: string) {
    const { rows: [p] } = await db.query(
      `SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1`,
      [sub]
    );
    return p ?? null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/paciente/plan
  // Plan activo: última consulta finalizada con sus acuerdos y estado de
  // cumplimiento registrado por el paciente.
  // ──────────────────────────────────────────────────────────────────────────
  fastify.get('/paciente/plan', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const paciente = await resolverPaciente(request.user.sub);
    if (!paciente) return reply.status(404).send({ error: 'Paciente no encontrado' });

    // Plan nutricional de la última consulta finalizada
    const { rows: [plan] } = await db.query(
      `SELECT cv.id AS conclusion_id,
              con.id AS consulta_id,
              con.fecha_consulta,
              con.numero_consulta,
              cv.kcal_prescritas,
              cv.pct_proteina,
              cv.pct_cho,
              cv.pct_grasa,
              cv.proteina_g,
              cv.cho_g,
              cv.grasa_g,
              cv.restricciones,
              cv.suplementos,
              cv.acuerdos,
              p.nombre AS nombre_profesional
         FROM conclusion_valoracion cv
         JOIN consulta con ON con.id = cv.consulta_id
         JOIN profesional p ON p.id = con.profesional_id
        WHERE con.clinica_id = $1
          AND con.paciente_id = $2
          AND con.estado = 'finalizada'
        ORDER BY con.fecha_consulta DESC
        LIMIT 1`,
      [paciente.clinica_id, paciente.id]
    );

    if (!plan) {
      return reply.send({ plan: null, mensaje: 'Tu nutricionista aún no ha generado un plan para ti.' });
    }

    // Cumplimientos registrados por el paciente para esta consulta
    const { rows: cumplimientos } = await db.query(
      `SELECT acuerdo_index, cumplido, registrado_en, nota_paciente
         FROM cumplimiento_acuerdo
        WHERE paciente_id = $1 AND consulta_id = $2`,
      [paciente.id, plan.consulta_id]
    );

    // Enriquecer acuerdos con estado de cumplimiento
    const acuerdos = (plan.acuerdos as { texto: string; cumplido: boolean }[]).map(
      (a, idx) => {
        const c = cumplimientos.find((c) => c.acuerdo_index === idx);
        return {
          index: idx,
          texto: a.texto,
          cumplidoProfesional: a.cumplido,       // lo que marcó el profesional
          cumplidoPaciente: c?.cumplido ?? false, // lo que reporta el paciente
          registradoEn: c?.registrado_en ?? null,
          notaPaciente: c?.nota_paciente ?? null,
        };
      }
    );

    return reply.send({
      plan: {
        consultaId:        plan.consulta_id,
        fechaConsulta:     plan.fecha_consulta,
        numeroConsulta:    plan.numero_consulta,
        nombreProfesional: plan.nombre_profesional,
        kcalPrescritas:    plan.kcal_prescritas,
        pctProteina:       plan.pct_proteina,
        pctCho:            plan.pct_cho,
        pctGrasa:          plan.pct_grasa,
        proteinaG:         plan.proteina_g,
        choG:              plan.cho_g,
        grasaG:            plan.grasa_g,
        restricciones:     plan.restricciones ?? [],
        suplementos:       plan.suplementos ?? null,
        acuerdos,
      },
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/paciente/acuerdos/:consultaId/:index/cumplir
  // El paciente marca (o desmarca) un acuerdo como cumplido.
  // UPSERT por (paciente_id, consulta_id, acuerdo_index).
  // ──────────────────────────────────────────────────────────────────────────
  fastify.post('/paciente/acuerdos/:consultaId/:index/cumplir', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const paciente = await resolverPaciente(request.user.sub);
    if (!paciente) return reply.status(404).send({ error: 'Paciente no encontrado' });

    const { consultaId, index } = request.params as { consultaId: string; index: string };
    const idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0) return reply.status(400).send({ error: 'Índice inválido' });

    const { cumplido = true, nota } = request.body as { cumplido?: boolean; nota?: string };

    // Verificar que la consulta pertenece al paciente
    const { rows: [consulta] } = await db.query(
      `SELECT id FROM consulta
        WHERE id = $1 AND clinica_id = $2 AND paciente_id = $3 AND estado = 'finalizada'`,
      [consultaId, paciente.clinica_id, paciente.id]
    );
    if (!consulta) return reply.status(404).send({ error: 'Consulta no encontrada' });

    // Verificar que el índice existe en el array de acuerdos
    const { rows: [cv] } = await db.query(
      `SELECT jsonb_array_length(acuerdos) AS total
         FROM conclusion_valoracion WHERE consulta_id = $1`,
      [consultaId]
    );
    if (!cv || idx >= cv.total) {
      return reply.status(404).send({ error: 'Acuerdo no encontrado' });
    }

    // UPSERT — el paciente puede cambiar de opinión
    const { rows: [resultado] } = await db.query(
      `INSERT INTO cumplimiento_acuerdo
         (clinica_id, paciente_id, consulta_id, acuerdo_index, cumplido, nota_paciente)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (paciente_id, consulta_id, acuerdo_index)
       DO UPDATE SET
         cumplido      = EXCLUDED.cumplido,
         nota_paciente = EXCLUDED.nota_paciente,
         registrado_en = now()
       RETURNING cumplido, registrado_en`,
      [paciente.clinica_id, paciente.id, consultaId, idx, cumplido, nota ?? null]
    );

    return reply.send(resultado);
  });
}
```

---

## Paso 5 — Registrar las nuevas rutas en el servidor Fastify

En el archivo principal de la API (probablemente `apps/api/src/app.ts` o `apps/api/src/index.ts`), registra los dos nuevos plugins. Replica exactamente el patrón que usan los plugins existentes de r17 (`invitacion.routes.ts`, `paciente.routes.ts`):

```typescript
import { mensajeriaPacRoutes } from './pac/mensajeria-pac.routes';
import { planPacRoutes } from './pac/plan-pac.routes';

// Dentro del bloque de registro de rutas:
await fastify.register(mensajeriaPacRoutes, { prefix: '/api' });
await fastify.register(planPacRoutes, { prefix: '/api' });
```

---

## Paso 6 — Navegación inferior compartida en `apps/web-patient`

Crea `apps/web-patient/src/components/NavBar.tsx`:

```tsx
import { NavLink } from 'react-router-dom';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

export default function NavBar({ mensajesNoLeidos = 0 }: { mensajesNoLeidos?: number }) {
  const items: NavItem[] = [
    { to: '/dashboard', label: 'Inicio',   icon: <IconHome /> },
    { to: '/plan',      label: 'Mi plan',  icon: <IconPlan /> },
    { to: '/mensajes',  label: 'Mensajes', icon: <IconChat /> },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-line safe-area-bottom">
      <div className="flex">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 pt-3 text-xs font-medium transition-colors relative ${
                isActive ? 'text-primary' : 'text-muted'
              }`
            }
          >
            <span className="relative">
              {item.icon}
              {item.label === 'Mensajes' && mensajesNoLeidos > 0 && (
                <span className="absolute -top-1 -right-1 bg-accent text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {mensajesNoLeidos > 9 ? '9+' : mensajesNoLeidos}
                </span>
              )}
            </span>
            <span className="mt-1">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

const IconHome = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-none stroke-current" strokeWidth={2}>
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);
const IconPlan = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-none stroke-current" strokeWidth={2}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);
const IconChat = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-none stroke-current" strokeWidth={2}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
```

Agrega `safe-area-bottom` en `tailwind.config.js` para respeto del notch en iPhone:

```js
// En extend.padding o como utilidad custom:
extend: {
  padding: {
    'safe-bottom': 'env(safe-area-inset-bottom)',
  },
},
```

Y en `index.css`:

```css
.safe-area-bottom {
  padding-bottom: env(safe-area-inset-bottom);
}
```

---

## Paso 7 — Página `/mensajes` (PAC-03)

Crea `apps/web-patient/src/pages/Mensajes.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import NavBar from '../components/NavBar';

interface Mensaje {
  id: string;
  autor_tipo: 'profesional' | 'paciente';
  contenido: string;
  created_at: string;
}

export default function Mensajes() {
  const { token, logout } = useAuth();
  const navigate = useNavigate();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [profesional, setProfesional] = useState('Tu nutricionista');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const anclaRef = useRef<HTMLDivElement>(null);
  const ultimoRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) { navigate('/activar'); return; }
    cargarConversacion();
  }, [token]);

  async function cargarConversacion() {
    try {
      const conv = await api.getConversacion(token!);
      if (conv.nombre_profesional) setProfesional(conv.nombre_profesional);
      await cargarMensajes();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function cargarMensajes(desde?: string) {
    try {
      const nuevos = await api.getMensajes(token!, desde);
      if (nuevos.length === 0) return;
      setMensajes((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        return [...prev, ...nuevos.filter((m) => !ids.has(m.id))];
      });
      ultimoRef.current = nuevos[nuevos.length - 1].created_at;
      setTimeout(() => anclaRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch {}
  }

  // Polling cada 5 segundos
  useEffect(() => {
    if (!token) return;
    const intervalo = setInterval(() => {
      cargarMensajes(ultimoRef.current ?? undefined);
    }, 5000);
    return () => clearInterval(intervalo);
  }, [token]);

  async function handleEnviar() {
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    try {
      await api.enviarMensaje(token!, texto.trim());
      setTexto('');
      await cargarMensajes(ultimoRef.current ?? undefined);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  const formatHora = (iso: string) =>
    new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  return (
    <main className="min-h-screen bg-bg flex flex-col">
      {/* Header */}
      <header className="bg-primary px-4 pt-12 pb-4 text-white flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="text-white/70">
          <svg viewBox="0 0 24 24" className="w-6 h-6 fill-none stroke-current" strokeWidth={2}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div>
          <h1 className="font-semibold">{profesional}</h1>
          <p className="text-primary-tint text-xs">Nutricionista</p>
        </div>
      </header>

      {/* Hilo de mensajes */}
      <section className="flex-1 overflow-y-auto px-4 py-4 space-y-3 pb-40">
        {mensajes.length === 0 && !error && (
          <p className="text-center text-muted text-sm mt-8">
            Aún no hay mensajes. Escribe el primero.
          </p>
        )}
        {error && (
          <p className="text-center text-accent text-sm mt-8">{error}</p>
        )}
        {mensajes.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.autor_tipo === 'paciente' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.autor_tipo === 'paciente'
                  ? 'bg-primary text-white rounded-br-sm'
                  : 'bg-white border border-line text-ink rounded-bl-sm shadow-sm'
              }`}
            >
              <p>{m.contenido}</p>
              <p className={`text-[10px] mt-1 text-right ${
                m.autor_tipo === 'paciente' ? 'text-white/60' : 'text-muted'
              }`}>
                {formatHora(m.created_at)}
              </p>
            </div>
          </div>
        ))}
        <div ref={anclaRef} />
      </section>

      {/* Input fijo sobre la navBar */}
      <div className="fixed bottom-16 left-0 right-0 bg-white border-t border-line px-3 py-2 flex items-end gap-2">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEnviar(); } }}
          placeholder="Escribe un mensaje…"
          rows={1}
          className="flex-1 resize-none rounded-xl border border-line px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary max-h-28 overflow-y-auto"
          style={{ height: 'auto' }}
        />
        <button
          onClick={handleEnviar}
          disabled={!texto.trim() || enviando}
          className="w-10 h-10 rounded-full bg-primary flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-opacity"
        >
          {enviando ? (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-none stroke-white" strokeWidth={2}>
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>

      <NavBar />
    </main>
  );
}
```

---

## Paso 8 — Página `/plan` (PAC-04)

Crea `apps/web-patient/src/pages/Plan.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api, PlanData } from '../lib/api';
import NavBar from '../components/NavBar';

export default function Plan() {
  const { token, logout } = useAuth();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [sin_plan, setSinPlan] = useState(false);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!token) { navigate('/activar'); return; }
    api.getPlan(token)
      .then(({ plan, mensaje }) => {
        if (plan) setPlan(plan);
        else setSinPlan(true);
      })
      .catch(() => setSinPlan(true))
      .finally(() => setCargando(false));
  }, [token]);

  async function toggleAcuerdo(idx: number, cumplido: boolean) {
    if (!plan || !token) return;
    try {
      await api.cumplirAcuerdo(token, plan.consultaId, idx, !cumplido);
      // Actualizar estado local
      setPlan((p) => p ? ({
        ...p,
        acuerdos: p.acuerdos.map((a) =>
          a.index === idx ? { ...a, cumplidoPaciente: !cumplido } : a
        ),
      }) : null);
    } catch {}
  }

  if (cargando) {
    return (
      <main className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg pb-20">
      <header className="bg-primary px-4 pt-12 pb-6 text-white">
        <h1 className="text-xl font-bold">Mi plan nutricional</h1>
        {plan && (
          <p className="text-primary-tint text-sm mt-1">
            {plan.nombreProfesional} · Consulta #{plan.numeroConsulta}
          </p>
        )}
      </header>

      <div className="px-4 -mt-4 space-y-4">

        {sin_plan && (
          <div className="bg-white rounded-2xl shadow-sm border border-line p-6 text-center mt-4">
            <p className="text-ink font-medium mb-1">Aún no tienes un plan</p>
            <p className="text-muted text-sm">Tu nutricionista lo generará después de tu primera consulta.</p>
          </div>
        )}

        {plan && (
          <>
            {/* Calorías y macros */}
            <div className="bg-white rounded-2xl shadow-sm border border-line p-4">
              <h2 className="text-sm font-semibold text-ink mb-3">Distribución energética</h2>
              <p className="text-3xl font-bold text-primary mb-1">
                {plan.kcalPrescritas} <span className="text-lg font-normal text-muted">kcal/día</span>
              </p>

              {/* Barra macro */}
              <div className="h-3 rounded-full overflow-hidden flex my-3">
                <div className="bg-blue-400 h-full transition-all" style={{ width: `${plan.pctProteina}%` }} />
                <div className="bg-amber-400 h-full transition-all" style={{ width: `${plan.pctCho}%` }} />
                <div className="bg-orange-400 h-full transition-all" style={{ width: `${plan.pctGrasa}%` }} />
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <MacroChip label="Proteína" pct={plan.pctProteina} g={plan.proteinaG} color="bg-blue-400" />
                <MacroChip label="Carbohidratos" pct={plan.pctCho} g={plan.choG} color="bg-amber-400" />
                <MacroChip label="Grasas" pct={plan.pctGrasa} g={plan.grasaG} color="bg-orange-400" />
              </div>
            </div>

            {/* Restricciones */}
            {plan.restricciones.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-line p-4">
                <h2 className="text-sm font-semibold text-ink mb-2">Restricciones alimentarias</h2>
                <div className="flex flex-wrap gap-2">
                  {plan.restricciones.map((r: string, i: number) => (
                    <span key={i} className="bg-red-50 text-accent text-xs px-3 py-1 rounded-full border border-red-100">
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Suplementos */}
            {plan.suplementos && (
              <div className="bg-white rounded-2xl shadow-sm border border-line p-4">
                <h2 className="text-sm font-semibold text-ink mb-2">Suplementos recomendados</h2>
                <p className="text-sm text-ink">{plan.suplementos}</p>
              </div>
            )}

            {/* Acuerdos */}
            {plan.acuerdos.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-line p-4">
                <h2 className="text-sm font-semibold text-ink mb-1">Mis acuerdos</h2>
                <p className="text-xs text-muted mb-3">
                  Toca para marcar los que has cumplido. Tu nutricionista verá tu progreso.
                </p>
                <ul className="space-y-3">
                  {plan.acuerdos.map((a) => (
                    <li key={a.index}>
                      <button
                        onClick={() => toggleAcuerdo(a.index, a.cumplidoPaciente)}
                        className="flex items-start gap-3 w-full text-left group"
                      >
                        <span className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                          a.cumplidoPaciente
                            ? 'bg-primary border-primary'
                            : 'border-muted group-hover:border-primary'
                        }`}>
                          {a.cumplidoPaciente && (
                            <svg viewBox="0 0 24 24" className="w-3 h-3 stroke-white fill-none" strokeWidth={3}>
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </span>
                        <span className={`text-sm leading-relaxed ${
                          a.cumplidoPaciente ? 'line-through text-muted' : 'text-ink'
                        }`}>
                          {a.texto}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted mt-4">
                  {plan.acuerdos.filter((a) => a.cumplidoPaciente).length} de {plan.acuerdos.length} cumplidos
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <NavBar />
    </main>
  );
}

function MacroChip({ label, pct, g, color }: { label: string; pct: number; g: number | null; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`w-3 h-3 rounded-full ${color}`} />
      <span className="text-muted">{label}</span>
      <span className="font-semibold text-ink">{pct}%</span>
      {g != null && <span className="text-muted">{g}g</span>}
    </div>
  );
}
```

---

## Paso 9 — Extender `apps/web-patient/src/lib/api.ts`

Agrega los nuevos métodos y tipos al archivo existente:

```typescript
// Nuevos tipos
export interface ConversacionInfo {
  id: string;
  profesional_id: string;
  nombre_profesional: string;
  mensajes_no_leidos_pac: number;
}

export interface MensajePac {
  id: string;
  autor_tipo: 'profesional' | 'paciente';
  contenido: string;
  created_at: string;
}

export interface AcuerdoPac {
  index: number;
  texto: string;
  cumplidoProfesional: boolean;
  cumplidoPaciente: boolean;
  registradoEn: string | null;
  notaPaciente: string | null;
}

export interface PlanData {
  consultaId: string;
  fechaConsulta: string;
  numeroConsulta: number;
  nombreProfesional: string;
  kcalPrescritas: number;
  pctProteina: number;
  pctCho: number;
  pctGrasa: number;
  proteinaG: number | null;
  choG: number | null;
  grasaG: number | null;
  restricciones: string[];
  suplementos: string | null;
  acuerdos: AcuerdoPac[];
}

// Nuevos métodos en el objeto `api`:
// (agregar dentro de export const api = { ... })

getConversacion: (jwtToken: string) =>
  apiFetch<ConversacionInfo>('/api/paciente/conversacion', jwtToken),

getMensajes: (jwtToken: string, desde?: string) =>
  apiFetch<MensajePac[]>(
    `/api/paciente/conversacion/mensajes${desde ? `?desde=${encodeURIComponent(desde)}` : ''}`,
    jwtToken
  ),

enviarMensaje: (jwtToken: string, contenido: string) =>
  apiFetch<MensajePac>('/api/paciente/conversacion/mensajes', jwtToken, {
    method: 'POST',
    body: JSON.stringify({ contenido }),
  }),

getPlan: (jwtToken: string) =>
  apiFetch<{ plan: PlanData | null; mensaje?: string }>('/api/paciente/plan', jwtToken),

cumplirAcuerdo: (jwtToken: string, consultaId: string, index: number, cumplido: boolean) =>
  apiFetch<{ cumplido: boolean; registrado_en: string }>(
    `/api/paciente/acuerdos/${consultaId}/${index}/cumplir`,
    jwtToken,
    { method: 'POST', body: JSON.stringify({ cumplido }) }
  ),
```

---

## Paso 10 — Actualizar enrutamiento y dashboard

### `apps/web-patient/src/App.tsx`

Agrega las nuevas páginas:

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Activar   from './pages/Activar';
import Dashboard from './pages/Dashboard';
import Mensajes  from './pages/Mensajes';
import Plan      from './pages/Plan';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/activar"   element={<Activar />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/mensajes"  element={<Mensajes />} />
        <Route path="/plan"      element={<Plan />} />
        <Route path="*"          element={<Navigate to="/activar" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

### Agregar `NavBar` al Dashboard existente

En `apps/web-patient/src/pages/Dashboard.tsx`, agrega `NavBar` al final del JSX y ajusta el `pb` del contenedor principal para que el contenido no quede tapado:

```tsx
import NavBar from '../components/NavBar';

// En el return, agrega antes del </main>:
<NavBar mensajesNoLeidos={datos.mensajesNoLeidos} />

// Y asegúrate de que el div de contenido tenga pb-20 o más:
// <div className="px-4 -mt-4 space-y-4 pb-24">
```

---

## Paso 11 — Verificación manual

### 11.1 Arrancar servicios

```bash
# API y web-patient (web-professional opcional para esta prueba)
cd apps/api && npm run dev
cd apps/web-patient && npm run dev
```

### 11.2 Mensajería (PAC-03)

1. Inicia sesión como paciente en `http://localhost:5174`.
2. Navega a `/mensajes`.
3. Envía un mensaje → debe aparecer como burbuja verde (derecha).
4. En `apps/web-professional`, abre la bandeja de mensajes del mismo paciente → debe verse el mensaje.
5. El profesional responde → en la app del paciente debe aparecer en ≤ 5 segundos (polling).
6. Verifica en DB:
```sql
SELECT m.contenido, m.autor_tipo, m.leido
  FROM mensaje m
  JOIN conversacion c ON c.id = m.conversacion_id
  JOIN paciente p ON p.id = c.paciente_id
 ORDER BY m.created_at DESC LIMIT 5;
```

### 11.3 Plan y acuerdos (PAC-04)

7. Navega a `/plan` → debe mostrar el plan de la última consulta finalizada.
8. Toca un acuerdo → el círculo se rellena verde y el texto queda tachado.
9. Recarga la página → el estado debe persistir (viene de la DB).
10. Toca de nuevo el acuerdo → debe desmarcarse (UPSERT con `cumplido = false`).
11. Verifica en DB:
```sql
SELECT ca.acuerdo_index, ca.cumplido, ca.registrado_en
  FROM cumplimiento_acuerdo ca
  JOIN paciente p ON p.id = ca.paciente_id
 ORDER BY ca.registrado_en DESC LIMIT 5;
```

### 11.4 Verificación de seguridad

12. Intenta `GET /api/paciente/conversacion/mensajes` con token de profesional → debe retornar 404 (no hay fila de paciente con ese `keycloak_user_id`).
13. Intenta `POST /api/paciente/acuerdos/:consultaId/:index/cumplir` con un `consultaId` de otro paciente → debe retornar 404.
14. Envía un mensaje con 4001 caracteres → debe retornar 400.

### 11.5 Historias de usuario CA verificadas

| ID        | Historia                                              | Ruta / componente                              |
|-----------|-------------------------------------------------------|------------------------------------------------|
| PAC-03-01 | Paciente ve hilo de mensajes con su nutricionista     | `GET /api/paciente/conversacion/mensajes`      |
| PAC-03-02 | Paciente envía mensaje                                | `POST /api/paciente/conversacion/mensajes`     |
| PAC-03-03 | Mensajes nuevos del profesional aparecen en ≤ 5s     | Polling en `Mensajes.tsx`                      |
| PAC-03-04 | Mensajes leídos se marcan al abrir el hilo            | UPDATE leido en GET mensajes                   |
| PAC-03-05 | Profesional recibe notificación de mensaje nuevo      | INSERT notificacion en POST mensaje            |
| PAC-04-01 | Paciente ve su plan con kcal y macros                 | `GET /api/paciente/plan`                       |
| PAC-04-02 | Paciente ve restricciones y suplementos               | TarjetaSeccion restricciones/suplementos       |
| PAC-04-03 | Paciente puede marcar acuerdos como cumplidos         | `POST /api/paciente/acuerdos/:id/:idx/cumplir` |
| PAC-04-04 | Estado de acuerdos persiste entre sesiones            | UPSERT en cumplimiento_acuerdo                 |
| PAC-04-05 | Paciente puede desmarcar un acuerdo                   | UPSERT con cumplido=false                      |
| PAC-04-06 | NavBar con badge de mensajes no leídos                | `NavBar` con prop mensajesNoLeidos             |

---

## Notas para r19

- **Dockerfile de `web-patient`**: el servicio está comentado en `docker-compose.dev.yml` porque el Dockerfile no existe aún. Crear `apps/web-patient/Dockerfile` (mismo patrón que `apps/web-professional/Dockerfile`: build Vite → nginx) y descomentar el servicio. El puerto 5174 está ocupado por `vetplatform-frontend-1` según el docker-compose — usar un puerto libre (5175 o el que corresponda).
- **r17-patch-resend**: si aún no se aplicó, r19 debe hacerlo antes de cualquier otra cosa — el módulo de email sigue usando nodemailer.
- **Flujo Keycloak paciente**: el cliente `nutrismart-patient` sigue pendiente de creación manual. Documentado en `docs/REBANADA-17.md § El paso que falta`.
