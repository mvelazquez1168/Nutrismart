# R17 — PAC epic: PAC-01 Invitación/Onboarding + PAC-02 Dashboard del Paciente

> **Contexto de sesión**
> Stack: Postgres en puerto 5434 · API en 4001 (host) → 4000 (contenedor) · web-professional en 5173
> Multitenancy: `clinica_id` **siempre** de `request.auth.tenantId`; jamás del body ni query string.
> Token JWT: `{ tenantId, sub, roles[] }` donde `sub` es el Keycloak user ID.
> Soft-delete: nunca DELETE físico; siempre `activo = false` o `estado = 'archivado'`.
> Design tokens: `--primary` #0E7C66 · `--primary-dk` #0A5C4C · `--primary-tint` #E7F1EE · `--accent` #C2410C · `--bg` #FBFCFC · `--ink` #1F2937 · `--muted` #6B7280 · `--line` #E3EAE8

---

## Objetivo de esta rebanada

Construir la **aplicación móvil del paciente** (`apps/web-patient`) desde cero y el flujo completo de invitación: el profesional envía una invitación → el paciente abre el enlace mágico → crea su cuenta en Keycloak → queda vinculado al registro de `paciente` en la base de datos → ve su dashboard personal.

**PAC-03** (mensajería desde la vista del paciente) y **PAC-04** (seguimiento de plan y acuerdos) se difieren a r18.

Al terminar esta rebanada deben funcionar:
- `POST /api/pacientes/:id/invitar` — el profesional genera y envía invitación
- `GET /api/invitacion/:token` — el paciente consulta el estado del token
- `POST /api/invitacion/:token/vincular` — vincula el JWT del paciente con su registro
- `GET /api/paciente/yo` — perfil del paciente autenticado
- `GET /api/paciente/dashboard` — resumen agregado del paciente
- Página `/activar?token=XXX` en `apps/web-patient`
- Página `/dashboard` en `apps/web-patient`

---

## Paso 1 — Revisar el estado del repo y determinar número de migración

Antes de escribir nada, ejecuta:

```bash
ls apps/api/src/migrations/ | sort
```

Identifica el número más alto. La migración de esta rebanada usa el siguiente número disponible. El prompt asume que será `019`, pero ajusta si corresponde (por ejemplo `020` si r15/r16 ya corrieron). **Usa el número correcto; no asumas.**

Verifica también que `apps/web-professional` exista y compile:

```bash
cd apps/web-professional && npx tsc --noEmit 2>&1 | head -20
```

Si hay errores de TypeScript preexistentes, anótalos pero no los corrijas ahora; continúa con r17.

---

## Paso 2 — Migración `019_pac_invitacion.sql`

Crea `apps/api/src/migrations/019_pac_invitacion.sql`:

```sql
-- PAC-01: tabla de invitaciones del paciente
-- El token se genera con crypto.randomBytes(32).toString('hex') en la API
-- y se almacena como texto plano (64 hex chars). No se hashea porque
-- es de un solo uso, expira en 7 días y se invalida después de usarse.

CREATE TYPE estado_invitacion AS ENUM ('pendiente', 'aceptada', 'expirada');

CREATE TABLE invitacion_paciente (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id     UUID          NOT NULL REFERENCES clinica(id),
  paciente_id    UUID          NOT NULL REFERENCES paciente(id),
  profesional_id UUID          NOT NULL REFERENCES profesional(id),
  token          TEXT          NOT NULL,
  estado         estado_invitacion NOT NULL DEFAULT 'pendiente',
  email_enviado  BOOLEAN       NOT NULL DEFAULT false,
  expires_at     TIMESTAMPTZ   NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  usado_en       TIMESTAMPTZ,
  CONSTRAINT uq_token UNIQUE (token)
);

-- Índice para lookup rápido por paciente (el profesional quiere ver
-- si ya hay invitación pendiente antes de enviar otra)
CREATE INDEX idx_invitacion_paciente
  ON invitacion_paciente (clinica_id, paciente_id, estado);

-- El campo keycloak_user_id ya debe existir en la tabla paciente
-- (fue añadido en una migración anterior). Verifica antes de ejecutar:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='paciente' AND column_name='keycloak_user_id';
-- Si no existe, descomenta la siguiente línea:
-- ALTER TABLE paciente ADD COLUMN IF NOT EXISTS keycloak_user_id TEXT;
```

Ejecuta la migración:

```bash
cd apps/api && node -e "
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = fs.readFileSync('src/migrations/019_pac_invitacion.sql', 'utf8');
pool.query(sql).then(() => { console.log('OK'); pool.end(); }).catch(e => { console.error(e.message); pool.end(); });
"
```

---

## Paso 3 — API: rutas de invitación

### 3a. Lógica de email (`apps/api/src/pac/email.ts`)

```typescript
import nodemailer from 'nodemailer';

export async function enviarInvitacion(opts: {
  emailPaciente: string;
  nombrePaciente: string;
  nombreClinica: string;
  token: string;
}): Promise<void> {
  const baseUrl = process.env.PAC_APP_URL ?? 'http://localhost:5174';
  const link = `${baseUrl}/activar?token=${opts.token}`;

  if (!process.env.SMTP_HOST) {
    // Modo desarrollo: imprime el enlace en consola y sale.
    console.log('──────────────────────────────────────────');
    console.log('[PAC] SMTP no configurado — modo consola');
    console.log(`[PAC] Invitación para: ${opts.emailPaciente}`);
    console.log(`[PAC] Enlace de activación: ${link}`);
    console.log('──────────────────────────────────────────');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? 'noreply@nutrismart.app',
    to: opts.emailPaciente,
    subject: `Tu invitación a NutriSmart — ${opts.nombreClinica}`,
    text: `Hola ${opts.nombrePaciente},\n\nTu nutricionista te invita a NutriSmart. Entra en:\n${link}\n\nEl enlace expira en 7 días.`,
    html: `
      <p>Hola <strong>${opts.nombrePaciente}</strong>,</p>
      <p>Tu nutricionista de <strong>${opts.nombreClinica}</strong> te ha invitado a NutriSmart.</p>
      <p>
        <a href="${link}" style="
          background:#0E7C66;color:#fff;padding:12px 24px;
          border-radius:8px;text-decoration:none;font-weight:600;
          display:inline-block;margin:16px 0;">
          Activar mi cuenta
        </a>
      </p>
      <p style="color:#6B7280;font-size:14px;">El enlace expira en 7 días. Si no esperabas esta invitación, ignora este correo.</p>
    `,
  });
}
```

Si `nodemailer` no está instalado, ejecuta:

```bash
cd apps/api && npm install nodemailer @types/nodemailer
```

### 3b. Rutas (`apps/api/src/pac/invitacion.routes.ts`)

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireProfesional } from '../middleware/roles'; // rol: profesional
import { requirePaciente } from '../middleware/roles';   // rol: paciente
import crypto from 'crypto';
import { db } from '../db';
import { enviarInvitacion } from './email';

const router = Router();

// ────────────────────────────────────────────────────────────────────────────
// POST /api/pacientes/:id/invitar
// Profesional genera o reenvía invitación para un paciente de su clínica.
// ────────────────────────────────────────────────────────────────────────────
router.post(
  '/pacientes/:id/invitar',
  requireAuth,
  requireProfesional,
  async (req, res) => {
    const clinicaId = req.auth.tenantId;
    const pacienteId = req.params.id;
    const profesionalId = req.auth.profesionalId; // resuelto por middleware

    // Verificar que el paciente pertenece a la clínica
    const { rows: [paciente] } = await db.query(
      `SELECT p.id, p.nombre, p.email, p.keycloak_user_id, c.nombre AS nombre_clinica
         FROM paciente p
         JOIN clinica c ON c.id = $1
        WHERE p.id = $2 AND p.clinica_id = $1 AND p.activo = true`,
      [clinicaId, pacienteId]
    );
    if (!paciente) return res.status(404).json({ error: 'Paciente no encontrado' });

    // Si el paciente ya tiene cuenta vinculada, no tiene caso invitar
    if (paciente.keycloak_user_id) {
      return res.status(409).json({ error: 'El paciente ya tiene cuenta activa en NutriSmart' });
    }

    // Si no hay email, no se puede invitar
    if (!paciente.email) {
      return res.status(422).json({ error: 'El paciente no tiene email registrado. Actualiza su perfil antes de invitar.' });
    }

    // Invalidar cualquier invitación pendiente anterior para este paciente
    await db.query(
      `UPDATE invitacion_paciente
          SET estado = 'expirada'
        WHERE clinica_id = $1 AND paciente_id = $2 AND estado = 'pendiente'`,
      [clinicaId, pacienteId]
    );

    // Generar token
    const token = crypto.randomBytes(32).toString('hex');

    const { rows: [inv] } = await db.query(
      `INSERT INTO invitacion_paciente
         (clinica_id, paciente_id, profesional_id, token)
       VALUES ($1, $2, $3, $4)
       RETURNING id, token, expires_at`,
      [clinicaId, pacienteId, profesionalId, token]
    );

    // Enviar email (o loguear en consola si no hay SMTP)
    let emailEnviado = false;
    try {
      await enviarInvitacion({
        emailPaciente: paciente.email,
        nombrePaciente: paciente.nombre,
        nombreClinica: paciente.nombre_clinica,
        token,
      });
      emailEnviado = true;
      await db.query(
        `UPDATE invitacion_paciente SET email_enviado = true WHERE id = $1`,
        [inv.id]
      );
    } catch (err) {
      console.error('[PAC] Error enviando email de invitación:', err);
      // No falla la petición — la invitación se creó; el profesional puede copiar el enlace.
    }

    return res.status(201).json({
      mensaje: emailEnviado
        ? `Invitación enviada a ${paciente.email}`
        : 'Invitación creada (sin SMTP configurado — el enlace se imprimió en consola de la API)',
      token: inv.token, // devolver token para que el profesional pueda copiarlo en dev
      expiresAt: inv.expires_at,
    });
  }
);

// ────────────────────────────────────────────────────────────────────────────
// GET /api/invitacion/:token
// Ruta PÚBLICA — el paciente consulta si el token es válido antes de
// redirigirlo a Keycloak. No requiere autenticación.
// ────────────────────────────────────────────────────────────────────────────
router.get('/invitacion/:token', async (req, res) => {
  const { rows: [inv] } = await db.query(
    `SELECT i.id, i.estado, i.expires_at,
            p.nombre AS nombre_paciente, p.email AS email_paciente,
            c.nombre AS nombre_clinica
       FROM invitacion_paciente i
       JOIN paciente p ON p.id = i.paciente_id
       JOIN clinica  c ON c.id = i.clinica_id
      WHERE i.token = $1`,
    [req.params.token]
  );

  if (!inv) return res.status(404).json({ error: 'Enlace no válido o ya utilizado' });

  // Expiración lógica por tiempo (además del enum)
  if (inv.estado === 'pendiente' && new Date(inv.expires_at) < new Date()) {
    await db.query(
      `UPDATE invitacion_paciente SET estado = 'expirada' WHERE token = $1`,
      [req.params.token]
    );
    inv.estado = 'expirada';
  }

  if (inv.estado !== 'pendiente') {
    return res.status(410).json({
      error: inv.estado === 'aceptada'
        ? 'Este enlace ya fue utilizado. Inicia sesión directamente.'
        : 'Este enlace ha expirado. Solicita una nueva invitación a tu nutricionista.',
    });
  }

  return res.json({
    nombrePaciente: inv.nombre_paciente,
    emailPaciente: inv.email_paciente,
    nombreClinica: inv.nombre_clinica,
    expiresAt: inv.expires_at,
  });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/invitacion/:token/vincular
// El paciente YA está autenticado en Keycloak (viene con JWT de rol paciente).
// Vincula su keycloak_user_id con el registro de paciente.
// ────────────────────────────────────────────────────────────────────────────
router.post(
  '/invitacion/:token/vincular',
  requireAuth,
  requirePaciente,
  async (req, res) => {
    const keycloakUserId = req.auth.sub; // UUID del usuario en Keycloak

    const { rows: [inv] } = await db.query(
      `SELECT i.id, i.paciente_id, i.clinica_id, i.estado, i.expires_at
         FROM invitacion_paciente i
        WHERE i.token = $1`,
      [req.params.token]
    );

    if (!inv) return res.status(404).json({ error: 'Token no válido' });

    if (inv.estado !== 'pendiente' || new Date(inv.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Token expirado o ya utilizado' });
    }

    // Verificar que nadie más ya tiene ese keycloak_user_id
    const { rows: [existente] } = await db.query(
      `SELECT id FROM paciente WHERE keycloak_user_id = $1 AND clinica_id = $2`,
      [keycloakUserId, inv.clinica_id]
    );
    if (existente && existente.id !== inv.paciente_id) {
      return res.status(409).json({ error: 'Esta cuenta de Keycloak ya está vinculada a otro paciente' });
    }

    // Transacción: vincular + marcar invitación como aceptada
    await db.query('BEGIN');
    try {
      await db.query(
        `UPDATE paciente
            SET keycloak_user_id = $1, updated_at = now()
          WHERE id = $2 AND clinica_id = $3`,
        [keycloakUserId, inv.paciente_id, inv.clinica_id]
      );
      await db.query(
        `UPDATE invitacion_paciente
            SET estado = 'aceptada', usado_en = now()
          WHERE id = $1`,
        [inv.id]
      );
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }

    return res.json({ mensaje: 'Cuenta vinculada correctamente. Ya puedes acceder a tu dashboard.' });
  }
);

export default router;
```

### 3c. Rutas del paciente autenticado (`apps/api/src/pac/paciente.routes.ts`)

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requirePaciente } from '../middleware/roles';
import { db } from '../db';

const router = Router();

// ────────────────────────────────────────────────────────────────────────────
// GET /api/paciente/yo
// Perfil del paciente autenticado. Resuelve paciente.id a partir de
// keycloak_user_id (= req.auth.sub).
// ────────────────────────────────────────────────────────────────────────────
router.get('/paciente/yo', requireAuth, requirePaciente, async (req, res) => {
  const { rows: [paciente] } = await db.query(
    `SELECT p.id, p.nombre, p.email, p.fecha_nacimiento, p.sexo,
            p.telefono, p.foto_url,
            c.nombre AS nombre_clinica, c.logo_url AS logo_clinica
       FROM paciente p
       JOIN clinica c ON c.id = p.clinica_id
      WHERE p.keycloak_user_id = $1 AND p.activo = true`,
    [req.auth.sub]
  );
  if (!paciente) {
    return res.status(404).json({
      error: 'Tu cuenta aún no está vinculada a un registro de paciente. Usa el enlace de invitación de tu nutricionista.'
    });
  }
  return res.json(paciente);
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/paciente/dashboard
// Agrega datos de distintas tablas para la vista resumen del paciente.
// ────────────────────────────────────────────────────────────────────────────
router.get('/paciente/dashboard', requireAuth, requirePaciente, async (req, res) => {
  // 1. Resolver paciente
  const { rows: [paciente] } = await db.query(
    `SELECT id, clinica_id, nombre
       FROM paciente
      WHERE keycloak_user_id = $1 AND activo = true`,
    [req.auth.sub]
  );
  if (!paciente) return res.status(404).json({ error: 'Paciente no encontrado' });

  const pacienteId = paciente.id;
  const clinicaId = paciente.clinica_id;

  // 2. Ejecutar consultas en paralelo
  const [
    { rows: [ultimoPeso] },
    { rows: [proximaCita] },
    { rows: [planActivo] },
    { rows: [{ count: mensajesNoLeidos }] },
    { rows: acuerdosPendientes },
    { rows: ultimasConsultas },
  ] = await Promise.all([
    // Último peso registrado
    db.query(
      `SELECT peso_kg, fecha_medicion
         FROM medicion_antropometrica
        WHERE clinica_id = $1 AND paciente_id = $2
        ORDER BY fecha_medicion DESC
        LIMIT 1`,
      [clinicaId, pacienteId]
    ),

    // Próxima cita (tabla cita si existe, sino null)
    // Si la tabla cita no existe aún, esta query devuelve vacío y lo manejamos.
    db.query(
      `SELECT fecha, hora, profesional_id, estado
         FROM cita
        WHERE clinica_id = $1 AND paciente_id = $2
          AND fecha >= CURRENT_DATE
          AND estado NOT IN ('cancelada', 'no_asistio')
        ORDER BY fecha ASC, hora ASC
        LIMIT 1`,
      [clinicaId, pacienteId]
    ).catch(() => ({ rows: [] })), // tabla puede no existir aún

    // Plan activo (última consulta finalizada con plan prescrito)
    db.query(
      `SELECT cv.kcal_prescritas, cv.pct_proteina, cv.pct_cho, cv.pct_grasa,
              cv.diagnostico_principal, con.fecha_consulta
         FROM conclusion_valoracion cv
         JOIN consulta con ON con.id = cv.consulta_id
        WHERE con.clinica_id = $1 AND con.paciente_id = $2
          AND con.estado = 'finalizada'
        ORDER BY con.fecha_consulta DESC
        LIMIT 1`,
      [clinicaId, pacienteId]
    ).catch(() => ({ rows: [] })),

    // Mensajes no leídos del paciente
    db.query(
      `SELECT COALESCE(SUM(mensajes_no_leidos_pac), 0) AS count
         FROM conversacion
        WHERE clinica_id = $1 AND paciente_id = $2 AND activa = true`,
      [clinicaId, pacienteId]
    ).catch(() => ({ rows: [{ count: 0 }] })),

    // Acuerdos pendientes de la última consulta finalizada
    db.query(
      `SELECT a.texto, a.cumplido
         FROM conclusion_valoracion cv
         JOIN consulta con ON con.id = cv.consulta_id
         CROSS JOIN LATERAL jsonb_to_recordset(cv.acuerdos) AS a(texto TEXT, cumplido BOOLEAN)
        WHERE con.clinica_id = $1 AND con.paciente_id = $2
          AND con.estado = 'finalizada'
        ORDER BY con.fecha_consulta DESC
        LIMIT 10`,
      [clinicaId, pacienteId]
    ).catch(() => ({ rows: [] })),

    // Historial de peso: últimas 8 mediciones para mini-gráfico
    db.query(
      `SELECT peso_kg, fecha_medicion
         FROM medicion_antropometrica
        WHERE clinica_id = $1 AND paciente_id = $2
          AND peso_kg IS NOT NULL
        ORDER BY fecha_medicion DESC
        LIMIT 8`,
      [clinicaId, pacienteId]
    ),
  ]);

  return res.json({
    paciente: { id: pacienteId, nombre: paciente.nombre },
    ultimoPeso: ultimoPeso ?? null,
    proximaCita: proximaCita ?? null,
    planActivo: planActivo ?? null,
    mensajesNoLeidos: Number(mensajesNoLeidos ?? 0),
    acuerdosPendientes: acuerdosPendientes.filter((a) => !a.cumplido),
    historialPeso: ultimasConsultas.reverse(), // cronológico para gráfico
  });
});

export default router;
```

### 3d. Middleware de rol paciente

En `apps/api/src/middleware/roles.ts`, si no existe `requirePaciente`, agrégalo:

```typescript
export function requirePaciente(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.roles?.includes('paciente')) {
    return res.status(403).json({ error: 'Acceso reservado a pacientes' });
  }
  next();
}
```

### 3e. Registrar rutas en `apps/api/src/index.ts`

```typescript
import invitacionRoutes from './pac/invitacion.routes';
import pacienteRoutes from './pac/paciente.routes';

// Dentro de la función donde se registran routes:
app.use('/api', invitacionRoutes);
app.use('/api', pacienteRoutes);
```

---

## Paso 4 — Scaffold de `apps/web-patient`

### 4a. Crear la aplicación

```bash
cd apps
npm create vite@latest web-patient -- --template react-ts
cd web-patient
npm install
npm install react-router-dom@6 tailwindcss@3 postcss autoprefixer
npx tailwindcss init -p
```

### 4b. `apps/web-patient/tailwind.config.js`

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary:    '#0E7C66',
        'primary-dk': '#0A5C4C',
        'primary-tint': '#E7F1EE',
        accent:     '#C2410C',
        bg:         '#FBFCFC',
        ink:        '#1F2937',
        muted:      '#6B7280',
        line:       '#E3EAE8',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
      },
    },
  },
  plugins: [],
};
```

### 4c. `apps/web-patient/src/index.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

:root {
  --primary: #0E7C66;
  --primary-dk: #0A5C4C;
  --primary-tint: #E7F1EE;
  --accent: #C2410C;
  --bg: #FBFCFC;
  --ink: #1F2937;
  --muted: #6B7280;
  --line: #E3EAE8;
}

html, body { background: var(--bg); color: var(--ink); }
```

### 4d. Variables de entorno — `apps/web-patient/.env`

```env
VITE_API_URL=http://localhost:4001
VITE_KEYCLOAK_URL=http://localhost:8080
VITE_KEYCLOAK_REALM=nutrismart
VITE_KEYCLOAK_CLIENT_ID=nutrismart-patient
```

### 4e. Cliente Keycloak del paciente

Antes de arrancar el frontend, verifica que el cliente `nutrismart-patient` exista en el realm. En consola de Keycloak (`http://localhost:8080/admin`):
- Clients → buscar `nutrismart-patient`
- Si no existe, créalo: Client type = OpenID Connect, Client ID = `nutrismart-patient`, Valid redirect URIs = `http://localhost:5174/*`, Web origins = `http://localhost:5174`
- Roles: crear el rol `paciente` en este cliente.

La app detectará al vuelo si el cliente no existe (Keycloak devolverá error de configuración) y mostrará un mensaje claro.

### 4f. Hook de autenticación `apps/web-patient/src/hooks/useAuth.ts`

```typescript
import { useState, useEffect, useCallback } from 'react';

interface AuthState {
  token: string | null;
  loading: boolean;
  error: string | null;
}

const KEYCLOAK_URL   = import.meta.env.VITE_KEYCLOAK_URL;
const REALM          = import.meta.env.VITE_KEYCLOAK_REALM;
const CLIENT_ID      = import.meta.env.VITE_KEYCLOAK_CLIENT_ID;

// URL base del authorization server
export const authBaseUrl = `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect`;

export function buildLoginUrl(returnTo: string): string {
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    response_type: 'code',
    scope:         'openid profile email',
    redirect_uri:  returnTo,
  });
  return `${authBaseUrl}/auth?${params.toString()}`;
}

// Hook minimalista de token. En producción usar keycloak-js;
// aquí guardamos el token en sessionStorage para esta sesión.
export function useAuth() {
  const [state, setState] = useState<AuthState>({
    token:   sessionStorage.getItem('pac_token'),
    loading: false,
    error:   null,
  });

  const setToken = useCallback((token: string | null) => {
    if (token) sessionStorage.setItem('pac_token', token);
    else       sessionStorage.removeItem('pac_token');
    setState((s) => ({ ...s, token }));
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem('pac_token');
    window.location.href = `${authBaseUrl}/logout?client_id=${CLIENT_ID}&post_logout_redirect_uri=${encodeURIComponent(window.location.origin)}`;
  }, []);

  return { ...state, setToken, logout };
}
```

> **Nota para el profesional que revise este código:** este hook usa `sessionStorage` como almacén temporal para el token. Es suficiente para el MVP; en producción se recomienda migrar a `keycloak-js` con PKCE. El token no persiste entre pestañas, lo que es comportamiento deliberado para la versión 1.

### 4g. Utilidad de API `apps/web-patient/src/lib/api.ts`

```typescript
const BASE = import.meta.env.VITE_API_URL;

async function apiFetch<T>(path: string, token: string | null, opts?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getInvitacion: (token: string) =>
    apiFetch<InvitacionInfo>(`/api/invitacion/${token}`, null),

  vincularInvitacion: (token: string, jwtToken: string) =>
    apiFetch<{ mensaje: string }>(`/api/invitacion/${token}/vincular`, jwtToken, { method: 'POST' }),

  getYo: (jwtToken: string) =>
    apiFetch<PacienteYo>(`/api/paciente/yo`, jwtToken),

  getDashboard: (jwtToken: string) =>
    apiFetch<DashboardData>(`/api/paciente/dashboard`, jwtToken),
};

// Tipos de respuesta
export interface InvitacionInfo {
  nombrePaciente: string;
  emailPaciente: string;
  nombreClinica: string;
  expiresAt: string;
}

export interface PacienteYo {
  id: string; nombre: string; email: string;
  fecha_nacimiento?: string; sexo?: string;
  telefono?: string; foto_url?: string;
  nombre_clinica: string; logo_clinica?: string;
}

export interface DashboardData {
  paciente: { id: string; nombre: string };
  ultimoPeso: { peso_kg: number; fecha_medicion: string } | null;
  proximaCita: { fecha: string; hora: string; estado: string } | null;
  planActivo: {
    kcal_prescritas: number; pct_proteina: number;
    pct_cho: number; pct_grasa: number;
    diagnostico_principal: string; fecha_consulta: string;
  } | null;
  mensajesNoLeidos: number;
  acuerdosPendientes: { texto: string; cumplido: boolean }[];
  historialPeso: { peso_kg: number; fecha_medicion: string }[];
}
```

---

## Paso 5 — Página de activación `/activar` (PAC-01)

Crea `apps/web-patient/src/pages/Activar.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, InvitacionInfo } from '../lib/api';
import { buildLoginUrl } from '../hooks/useAuth';

type Fase = 'cargando' | 'valida' | 'invalida' | 'completada';

export default function Activar() {
  const [params] = useSearchParams();
  const navigate  = useNavigate();
  const token     = params.get('token') ?? '';

  const [fase,  setFase]  = useState<Fase>('cargando');
  const [info,  setInfo]  = useState<InvitacionInfo | null>(null);
  const [error, setError] = useState('');

  // Caso 1: volvemos de Keycloak con el JWT en la URL (simplificado para el MVP).
  // En el flujo real se completa el intercambio de código PKCE en el backend.
  // Aquí detectamos ?jwt=XXX que la página de callback inserata tras el exchange.
  const jwtParam = params.get('jwt');

  useEffect(() => {
    if (jwtParam && token) {
      // Vincular automáticamente
      api.vincularInvitacion(token, jwtParam)
        .then(() => { setFase('completada'); })
        .catch((e) => { setError(e.message); setFase('invalida'); });
      return;
    }

    if (!token) { setError('Enlace incompleto. Verifica el correo.'); setFase('invalida'); return; }

    api.getInvitacion(token)
      .then((data) => { setInfo(data); setFase('valida'); })
      .catch((e)  => { setError(e.message); setFase('invalida'); });
  }, [token, jwtParam]);

  const handleCrearCuenta = () => {
    // Redirige al registro de Keycloak; al volver, la URL incluirá el code.
    // El intercambio de code → token se hace en /callback; aquí simplificamos
    // pasando redirect_uri = /activar?token=XXX para que el servidor lo complete.
    const returnUrl = `${window.location.origin}/activar?token=${token}`;
    window.location.href = buildLoginUrl(returnUrl);
  };

  const handleIrAlLogin = () => {
    window.location.href = buildLoginUrl(`${window.location.origin}/dashboard`);
  };

  return (
    <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / marca */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="text-3xl font-bold text-primary">Nutri</span>
            <span className="text-3xl font-bold text-ink">Smart</span>
          </div>
          <p className="text-muted text-sm">Tu app de nutrición personalizada</p>
        </div>

        {/* Tarjeta */}
        <div className="bg-white rounded-2xl shadow-md p-6 border border-line">

          {fase === 'cargando' && (
            <div className="text-center py-8">
              <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-muted text-sm">Verificando tu enlace…</p>
            </div>
          )}

          {fase === 'invalida' && (
            <>
              <div className="text-center mb-6">
                <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg viewBox="0 0 24 24" className="w-7 h-7 text-red-500 fill-none stroke-current" strokeWidth={2}>
                    <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                </div>
                <h1 className="text-lg font-semibold text-ink mb-1">Enlace no válido</h1>
                <p className="text-muted text-sm">{error}</p>
              </div>
              <button onClick={handleIrAlLogin}
                className="w-full py-3 rounded-xl border border-line text-ink text-sm font-medium hover:bg-primary-tint transition-colors">
                Ir al inicio de sesión
              </button>
            </>
          )}

          {fase === 'valida' && info && (
            <>
              <div className="text-center mb-6">
                <div className="w-14 h-14 bg-primary-tint rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg viewBox="0 0 24 24" className="w-7 h-7 text-primary fill-none stroke-current" strokeWidth={2}>
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <h1 className="text-lg font-semibold text-ink mb-1">¡Hola, {info.nombrePaciente}!</h1>
                <p className="text-muted text-sm">
                  Tu nutricionista de <strong>{info.nombreClinica}</strong> te invita a NutriSmart.
                </p>
              </div>

              <div className="bg-primary-tint rounded-xl p-4 mb-5 text-sm text-primary">
                <p className="font-medium mb-1">¿Qué es NutriSmart?</p>
                <p className="text-primary/80">Consulta tu plan nutricional, acuerdos, mensajes con tu nutricionista y el progreso de tus metas — todo en un lugar.</p>
              </div>

              <button onClick={handleCrearCuenta}
                className="w-full py-3 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-dk transition-colors mb-3">
                Crear mi cuenta
              </button>
              <button onClick={handleIrAlLogin}
                className="w-full py-3 rounded-xl border border-line text-ink text-sm font-medium hover:bg-primary-tint transition-colors">
                Ya tengo cuenta — Iniciar sesión
              </button>
            </>
          )}

          {fase === 'completada' && (
            <>
              <div className="text-center mb-6">
                <div className="w-14 h-14 bg-primary-tint rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg viewBox="0 0 24 24" className="w-7 h-7 text-primary fill-none stroke-current" strokeWidth={2}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h1 className="text-lg font-semibold text-ink mb-1">¡Cuenta activada!</h1>
                <p className="text-muted text-sm">Ya tienes acceso a tu espacio en NutriSmart.</p>
              </div>
              <button onClick={() => navigate('/dashboard')}
                className="w-full py-3 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-dk transition-colors">
                Ir a mi dashboard
              </button>
            </>
          )}

        </div>

        <p className="text-center text-xs text-muted mt-4">
          ¿Problemas? Escribe a tu nutricionista para que te reenvíe el enlace.
        </p>
      </div>
    </main>
  );
}
```

---

## Paso 6 — Página de dashboard `/dashboard` (PAC-02)

Crea `apps/web-patient/src/pages/Dashboard.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, DashboardData, PacienteYo } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

export default function Dashboard() {
  const { token, logout } = useAuth();
  const navigate = useNavigate();

  const [yo,    setYo]    = useState<PacienteYo | null>(null);
  const [datos, setDatos] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) { navigate('/activar'); return; }
    Promise.all([api.getYo(token), api.getDashboard(token)])
      .then(([yo, datos]) => { setYo(yo); setDatos(datos); })
      .catch((e) => setError(e.message));
  }, [token, navigate]);

  if (error) {
    return (
      <main className="min-h-screen bg-bg flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-accent font-medium mb-3">{error}</p>
          <button onClick={logout} className="text-sm text-muted underline">Cerrar sesión</button>
        </div>
      </main>
    );
  }

  if (!datos || !yo) {
    return (
      <main className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg">
      {/* Header */}
      <header className="bg-primary px-4 pt-12 pb-6 text-white">
        <div className="flex items-center justify-between mb-1">
          <p className="text-primary-tint text-sm">{yo.nombre_clinica}</p>
          <button onClick={logout} className="text-primary-tint text-xs underline">Salir</button>
        </div>
        <h1 className="text-2xl font-bold">Hola, {yo.nombre.split(' ')[0]} 👋</h1>
        <p className="text-primary-tint text-sm mt-1">
          {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </header>

      <div className="px-4 -mt-4 space-y-4 pb-8">

        {/* Tarjeta: próxima cita */}
        {datos.proximaCita ? (
          <TarjetaSeccion titulo="Próxima cita" icono={<IconCalendar />}>
            <p className="font-semibold text-ink">
              {new Date(datos.proximaCita.fecha + 'T00:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <p className="text-muted text-sm">{datos.proximaCita.hora?.slice(0, 5)} h</p>
          </TarjetaSeccion>
        ) : (
          <TarjetaSeccion titulo="Próxima cita" icono={<IconCalendar />}>
            <p className="text-muted text-sm">Sin citas programadas</p>
          </TarjetaSeccion>
        )}

        {/* Tarjeta: peso actual + mini gráfico SVG */}
        <TarjetaSeccion titulo="Progreso de peso" icono={<IconScale />}>
          {datos.ultimoPeso ? (
            <>
              <p className="text-2xl font-bold text-ink">
                {datos.ultimoPeso.peso_kg} <span className="text-base font-normal text-muted">kg</span>
              </p>
              <p className="text-muted text-xs mb-3">
                Registrado: {new Date(datos.ultimoPeso.fecha_medicion + 'T00:00:00').toLocaleDateString('es-MX')}
              </p>
              {datos.historialPeso.length > 1 && (
                <MiniGraficoPeso datos={datos.historialPeso} />
              )}
            </>
          ) : (
            <p className="text-muted text-sm">Sin mediciones registradas aún</p>
          )}
        </TarjetaSeccion>

        {/* Tarjeta: plan activo */}
        {datos.planActivo && (
          <TarjetaSeccion titulo="Mi plan nutricional" icono={<IconPlan />}>
            {datos.planActivo.diagnostico_principal && (
              <p className="text-sm text-ink font-medium mb-2">{datos.planActivo.diagnostico_principal}</p>
            )}
            <p className="text-2xl font-bold text-primary mb-1">
              {datos.planActivo.kcal_prescritas} <span className="text-base font-normal text-muted">kcal/día</span>
            </p>
            <div className="flex gap-3 text-xs text-muted">
              <span>Proteína {datos.planActivo.pct_proteina}%</span>
              <span>CHO {datos.planActivo.pct_cho}%</span>
              <span>Grasas {datos.planActivo.pct_grasa}%</span>
            </div>
            {/* Barra macro visual */}
            <div className="mt-3 h-3 rounded-full overflow-hidden flex">
              <div className="bg-blue-400 h-full" style={{ width: `${datos.planActivo.pct_proteina}%` }} title="Proteína" />
              <div className="bg-amber-400 h-full" style={{ width: `${datos.planActivo.pct_cho}%` }} title="CHO" />
              <div className="bg-orange-400 h-full" style={{ width: `${datos.planActivo.pct_grasa}%` }} title="Grasas" />
            </div>
          </TarjetaSeccion>
        )}

        {/* Tarjeta: mis acuerdos */}
        {datos.acuerdosPendientes.length > 0 && (
          <TarjetaSeccion titulo="Mis acuerdos pendientes" icono={<IconCheck />}>
            <ul className="space-y-2">
              {datos.acuerdosPendientes.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-ink">
                  <span className="mt-0.5 w-4 h-4 rounded-full border-2 border-primary flex-shrink-0" />
                  {a.texto}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted mt-3">
              Comenta el avance con tu nutricionista en tu próxima consulta.
            </p>
          </TarjetaSeccion>
        )}

        {/* Tarjeta: mensajes */}
        <TarjetaSeccion titulo="Mensajes" icono={<IconChat />}>
          {datos.mensajesNoLeidos > 0 ? (
            <div className="flex items-center gap-2">
              <span className="bg-accent text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
                {datos.mensajesNoLeidos}
              </span>
              <p className="text-sm text-ink">
                {datos.mensajesNoLeidos === 1 ? 'mensaje sin leer' : 'mensajes sin leer'}
              </p>
            </div>
          ) : (
            <p className="text-muted text-sm">No hay mensajes nuevos</p>
          )}
          <p className="text-xs text-muted mt-2">(La mensajería completa estará disponible pronto)</p>
        </TarjetaSeccion>

      </div>
    </main>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Componentes auxiliares
// ────────────────────────────────────────────────────────────────────────────

function TarjetaSeccion({ titulo, icono, children }: {
  titulo: string; icono: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-line p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-primary">{icono}</span>
        <h2 className="text-sm font-semibold text-ink">{titulo}</h2>
      </div>
      {children}
    </div>
  );
}

function MiniGraficoPeso({ datos }: { datos: { peso_kg: number; fecha_medicion: string }[] }) {
  const W = 280, H = 60, PAD = 8;
  const pesos = datos.map((d) => d.peso_kg);
  const min = Math.min(...pesos);
  const max = Math.max(...pesos);
  const rng = max - min || 1;
  const pts = datos.map((d, i) => {
    const x = PAD + (i / (datos.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - (d.peso_kg - min) / rng) * (H - PAD * 2);
    return `${x},${y}`;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Tendencia de peso">
      <polyline points={pts.join(' ')} fill="none" stroke="#0E7C66" strokeWidth={2} strokeLinejoin="round" />
      {datos.map((d, i) => {
        const [x, y] = pts[i].split(',').map(Number);
        return <circle key={i} cx={x} cy={y} r={3} fill="#0E7C66" />;
      })}
    </svg>
  );
}

// Iconos inline SVG (sin dependencias)
const IconCalendar = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-none stroke-current" strokeWidth={2}>
    <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
const IconScale = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-none stroke-current" strokeWidth={2}>
    <circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" />
  </svg>
);
const IconPlan = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-none stroke-current" strokeWidth={2}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);
const IconCheck = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-none stroke-current" strokeWidth={2}>
    <polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);
const IconChat = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-none stroke-current" strokeWidth={2}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 0 0 0 2 2 0 0 1 2 2z" />
  </svg>
);
```

---

## Paso 7 — Enrutamiento y entrada de la app

### `apps/web-patient/src/App.tsx`

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Activar    from './pages/Activar';
import Dashboard  from './pages/Dashboard';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/activar"   element={<Activar />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*"          element={<Navigate to="/activar" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

### `apps/web-patient/src/main.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

### `apps/web-patient/vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true, // accesible desde red local (para pruebas en móvil)
    proxy: {
      '/api': {
        target: 'http://localhost:4001',
        changeOrigin: true,
      },
    },
  },
});
```

---

## Paso 8 — Botón "Invitar paciente" en `apps/web-professional`

Agrega el botón de invitación en la vista de detalle del paciente. Localiza el componente de perfil del paciente (probablemente `PacienteDetalle.tsx` o similar) y agrega:

```tsx
// En el componente de detalle del paciente, cerca de los datos de contacto:

const [invitando, setInvitando] = useState(false);
const [resultadoInvit, setResultadoInvit] = useState<'exito' | 'error' | null>(null);
const [msgInvit, setMsgInvit] = useState('');

async function handleInvitar() {
  setInvitando(true);
  setResultadoInvit(null);
  try {
    const res = await fetch(`/api/pacientes/${pacienteId}/invitar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setResultadoInvit('exito');
    setMsgInvit(data.mensaje);
  } catch (e: any) {
    setResultadoInvit('error');
    setMsgInvit(e.message);
  } finally {
    setInvitando(false);
  }
}

// En el JSX — condicional: solo mostrar si el paciente NO tiene keycloak_user_id
{!paciente.keycloak_user_id && (
  <div className="mt-4">
    <button
      onClick={handleInvitar}
      disabled={invitando}
      className="flex items-center gap-2 px-4 py-2 rounded-lg border border-primary text-primary text-sm font-medium hover:bg-primary-tint transition-colors disabled:opacity-50"
    >
      {invitando ? (
        <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      ) : (
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth={2}>
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.28h3a2 2 0 0 1 2 1.72..." />
        </svg>
      )}
      Invitar a NutriSmart
    </button>
    {resultadoInvit === 'exito' && (
      <p className="mt-2 text-sm text-primary">{msgInvit}</p>
    )}
    {resultadoInvit === 'error' && (
      <p className="mt-2 text-sm text-accent">{msgInvit}</p>
    )}
  </div>
)}

{paciente.keycloak_user_id && (
  <p className="mt-2 text-xs text-muted flex items-center gap-1">
    <span className="w-2 h-2 rounded-full bg-green-400" />
    El paciente tiene cuenta activa en NutriSmart
  </p>
)}
```

> Si el campo `keycloak_user_id` no viene en el DTO del paciente desde la API, agrégalo al SELECT de la ruta GET `/api/pacientes/:id` existente.

---

## Paso 9 — Verificación manual (recorrido completo)

### 9.1 Arrancar servicios

```bash
# Terminal 1: API
cd apps/api && npm run dev

# Terminal 2: web-professional
cd apps/web-professional && npm run dev

# Terminal 3: web-patient
cd apps/web-patient && npm run dev
```

Verifica que los tres arranquen sin errores.

### 9.2 Flujo de invitación

1. En `web-professional` (puerto 5173), abre la ficha de un paciente que tenga email pero NO tenga cuenta.
2. Haz clic en "Invitar a NutriSmart".
3. Si no hay SMTP: verifica que el token aparezca en la **consola de la API** y en el cuerpo de respuesta del botón.
4. Copia la URL: `http://localhost:5174/activar?token=<TOKEN>`.
5. Ábrela en otra pestaña → debe mostrar la pantalla de bienvenida con el nombre del paciente y la clínica.

### 9.3 Flujo de activación

6. Haz clic en "Crear mi cuenta" → redirige a Keycloak (puede ser un usuario de prueba existente en el realm).
7. Tras autenticarte, la app debe mostrar la pantalla "¡Cuenta activada!".
8. En la consola de la API verifica que `UPDATE paciente SET keycloak_user_id = ...` se ejecutó.

```sql
-- Verificar en Postgres (puerto 5434):
SELECT id, nombre, email, keycloak_user_id FROM paciente WHERE email = 'tu-email-de-prueba';
```

### 9.4 Dashboard del paciente

9. Desde la pantalla "¡Cuenta activada!", haz clic en "Ir a mi dashboard".
10. Verifica que se muestren: nombre, clínica, último peso (si existe), plan activo (si existe), acuerdos pendientes.
11. Prueba `GET http://localhost:4001/api/paciente/dashboard` con el token JWT del paciente → respuesta 200 con los datos.

### 9.5 Verificación de seguridad

12. Intenta `GET /api/paciente/dashboard` con token de **profesional** → debe retornar 403.
13. Intenta `POST /api/invitacion/:token/vincular` con token de **profesional** → debe retornar 403.
14. Intenta `GET /api/pacientes/:id/invitar` (GET en vez de POST) → debe retornar 404 (no existe la ruta GET).
15. Genera una invitación para un paciente de otra clínica → verifica que la API retorna 404.

### 9.6 Historia de usuario CA verificadas

| ID     | Historia                                      | Ruta / componente                   |
|--------|-----------------------------------------------|-------------------------------------|
| PAC-01-01 | Profesional envía invitación por email      | `POST /api/pacientes/:id/invitar`   |
| PAC-01-02 | Paciente abre enlace y ve datos de clínica  | `/activar` + `GET /api/invitacion/:token` |
| PAC-01-03 | Paciente crea cuenta en Keycloak            | Redirección a Keycloak estándar     |
| PAC-01-04 | Cuenta queda vinculada al registro          | `POST /api/invitacion/:token/vincular` |
| PAC-01-05 | Token expirado muestra mensaje claro        | Lógica de expiración en GET y vinculación |
| PAC-01-06 | Reenviar invitación invalida la anterior    | UPDATE estado='expirada' antes del INSERT |
| PAC-02-01 | Dashboard muestra próxima cita              | `GET /api/paciente/dashboard`       |
| PAC-02-02 | Dashboard muestra último peso + gráfico     | `MiniGraficoPeso` SVG               |
| PAC-02-03 | Dashboard muestra plan nutricional activo   | `TarjetaSeccion` plan               |
| PAC-02-04 | Dashboard muestra acuerdos pendientes       | LATERAL jsonb_to_recordset          |
| PAC-02-05 | Dashboard muestra mensajes no leídos        | SUM(mensajes_no_leidos_pac)         |

---

## Notas de arquitectura para r18

Las siguientes historias **se difieren deliberadamente** a r18:
- **PAC-03**: Mensajería completa desde la app del paciente (hilo de conversación, envío de mensajes). La tarjeta "Mensajes" en el dashboard es un placeholder que muestra el conteo.
- **PAC-04**: Seguimiento de plan y acuerdos (marcar acuerdos como cumplidos, ver distribución de macros detallada, registrar síntomas de seguimiento).
- **PKCE completo**: El intercambio de authorization code → token en el backend (actualmente simplificado en `Activar.tsx`). En producción, el backend debe manejar el callback de Keycloak para evitar exponer el token en URL.
- **Push notifications**: Requiere service worker + web push — se evalúa para r19.

El campo `keycloak_user_id` en la tabla `paciente` ya debe existir desde la migración inicial. Si no, la migración 019 incluye la línea comentada para agregarlo — descoméntala antes de ejecutar.
