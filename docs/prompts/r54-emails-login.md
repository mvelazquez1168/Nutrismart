# R54 — Emails transaccionales + Login integrado

## ⚠️ SEGURIDAD PERMANENTE
- **Nunca copiar credenciales en el chat.** Solo referenciar nombres de variables.
- ECR registry: `344872152822.dkr.ecr.us-east-1.amazonaws.com` (verifica siempre)
- Cada comando debe llevar etiqueta: **PowerShell (local Windows)** o **Servidor (SSH)**

---

## 0. Pre-vuelo

Antes de tocar código, verifica el estado del repo:

```bash
git log --oneline -8
git branch -a | grep -E "r52|r53|main"
```

- Si `r52` no está en main → OK, continúa igualmente (R54 es independiente)
- Si `r53` (`r53-personalizacion`) no está en main → OK igual
- Crea rama nueva desde el estado actual de `main` (o desde la rama más avanzada si main está desactualizado):

```bash
git checkout main   # o la rama más actualizada disponible
git pull
git checkout -b r54-emails-login
```

---

## 1. Relevamiento antes de codificar

Ejecuta estos comandos y lee los resultados antes de escribir una sola línea de código:

```bash
# 1a. ¿Existe configuración de email (Resend SDK u otro)?
grep -r "resend\|nodemailer\|sendgrid\|ses\|mailgun\|email" apps/api/src --include="*.ts" -l
grep -r "RESEND\|SMTP\|MAIL\|SENDGRID" apps/api/.env* .env* 2>/dev/null | head -20

# 1b. ¿Cómo se crean/cancelan/reagendan citas hoy?
grep -r "cita\|appointment" apps/api/src/routes --include="*.ts" -l
cat apps/api/src/routes/citas.ts 2>/dev/null || find apps/api/src -name "*cita*" -o -name "*appointment*" | head -20

# 1c. ¿Existe algún sistema de eventos/hooks interno (EventEmitter, queues, etc)?
grep -r "EventEmitter\|emit\|queue\|bull\|pg-boss\|pgboss" apps/api/src --include="*.ts" -l

# 1d. ¿Cómo se crea un profesional / invitación hoy?
grep -r "invitacion\|invitation\|createProfesional\|addProfesional" apps/api/src --include="*.ts" -l

# 1e. ¿Hay tabla brand_config ya poblada con color_primario / color_secundario / logo_url?
# (Ejecutar en DB o buscar en schema):
grep -r "brand_config\|color_primario\|logo_url" apps/api/src --include="*.ts" | head -20

# 1f. ¿Cómo es el componente de login actual?
find apps/web-professional/src apps/web-patient/src -name "*login*" -o -name "*Login*" | head -20
# Lee el archivo principal:
cat apps/web-professional/src/pages/LoginPage.tsx 2>/dev/null || \
  find apps/web-professional/src -name "*Login*" -exec cat {} \;

# 1g. ¿Qué flujo de auth usa hoy? ¿keycloak-js, @react-keycloak/web, redirect manual?
grep -r "keycloak\|Keycloak" apps/web-professional/src --include="*.tsx" --include="*.ts" -l
grep -r "keycloak\|Keycloak" apps/web-patient/src --include="*.tsx" --include="*.ts" -l
```

Con los resultados en mano, adapta el plan. Las secciones siguientes asumen el caso base; ajusta donde la realidad difiera.

---

## 2. Sistema de emails

### 2a. Dependencias

```bash
cd apps/api
npm install resend
```

> El proyecto ya usa Resend — dominio `nutrismart.solutechit.com` verificado. Si el SDK ya está instalado, sáltate este paso.

### 2b. Variables de entorno

Agrega a `apps/api/.env.example`:

```
# Resend (proveedor de email transaccional — dominio nutrismart.solutechit.com ya verificado)
RESEND_API_KEY=
RESEND_FROM_ADDRESS=noreply@nutrismart.solutechit.com
RESEND_FROM_NAME=NutriSmart

# URL base de las apps (para links en emails)
PATIENT_APP_URL=https://paciente.nutrismart.solutechit.com
PROFESSIONAL_APP_URL=https://nutrismart.solutechit.com
```

**NO pongas valores reales en `.env.example`.** Solo esqueleto.

### 2c. Módulo email service

Crea `apps/api/src/services/email.service.ts`:

```typescript
import { Resend } from 'resend';

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY no configurado');
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

export interface BrandConfig {
  colorPrimario: string;   // e.g. '#0E7C66'
  colorSecundario?: string;
  logoUrl?: string;
  nombreClinica: string;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}) {
  if (!process.env.RESEND_API_KEY) {
    // En desarrollo sin Resend configurado, loguea sin lanzar error
    console.warn('[email] RESEND_API_KEY no configurado — email no enviado:', opts.subject, '->', opts.to);
    return;
  }
  const fromName = process.env.RESEND_FROM_NAME ?? 'NutriSmart';
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? 'noreply@nutrismart.solutechit.com';

  const { error } = await getResend().emails.send({
    from: `${fromName} <${fromAddress}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });

  if (error) throw new Error(`[resend] ${error.message}`);
}
```

### 2d. Plantillas HTML branded

Crea `apps/api/src/services/email.templates.ts`:

> **Diseño**: Los emails deben verse bien en Gmail, Outlook y Apple Mail. Usa tablas HTML, estilos inline (sin `<style>` externo), fuente Arial/sans-serif. El logo se muestra si hay `logoUrl`; si no, solo el nombre de la clínica.

```typescript
import type { BrandConfig } from './email.service';

function baseLayout(brand: BrandConfig, body: string): string {
  const primary = brand.colorPrimario || '#0E7C66';
  const logoHtml = brand.logoUrl
    ? `<img src="${brand.logoUrl}" alt="${brand.nombreClinica}" style="max-height:48px;max-width:160px;object-fit:contain;" />`
    : `<span style="font-size:20px;font-weight:700;color:#ffffff;">${brand.nombreClinica}</span>`;

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:${primary};padding:24px 32px;text-align:center;">
            ${logoHtml}
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 32px 24px;">
            ${body}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f9f9f9;padding:16px 32px;text-align:center;border-top:1px solid #eeeeee;">
            <p style="margin:0;color:#888888;font-size:12px;">
              Este correo fue enviado por ${brand.nombreClinica} a través de NutriSmart.<br>
              Si tienes dudas, contacta directamente a tu clínica.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(href: string, label: string, color: string): string {
  return `<p style="text-align:center;margin:24px 0;">
    <a href="${href}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:700;font-size:15px;">${label}</a>
  </p>`;
}

function heading(text: string): string {
  return `<h2 style="margin:0 0 16px;font-size:22px;color:#1a1a1a;">${text}</h2>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;color:#333333;line-height:1.6;">${text}</p>`;
}

function detailBox(rows: { label: string; value: string }[], accentColor: string): string {
  const rowsHtml = rows.map(r => `
    <tr>
      <td style="padding:8px 12px;color:#666666;font-size:13px;width:40%;">${r.label}</td>
      <td style="padding:8px 12px;color:#1a1a1a;font-size:14px;font-weight:600;">${r.value}</td>
    </tr>`).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${accentColor};border-radius:6px;margin:16px 0;overflow:hidden;">
    ${rowsHtml}
  </table>`;
}

// ─── PACIENTE ───────────────────────────────────────────────

export function tplConfirmacionCita(brand: BrandConfig, data: {
  pacienteNombre: string;
  profesionalNombre: string;
  fecha: string;  // ej. "lunes 28 de octubre de 2026"
  hora: string;   // ej. "10:30 AM"
  appUrl: string;
}): string {
  const body = `
    ${heading('¡Tu cita está confirmada! ✅')}
    ${paragraph(`Hola <strong>${data.pacienteNombre}</strong>, tu cita ha sido confirmada con los siguientes detalles:`)}
    ${detailBox([
      { label: 'Profesional', value: data.profesionalNombre },
      { label: 'Fecha', value: data.fecha },
      { label: 'Hora', value: data.hora },
    ], brand.colorPrimario)}
    ${button(data.appUrl, 'Ver mis citas', brand.colorPrimario)}
    ${paragraph('Si necesitas cancelar o reagendar, puedes hacerlo desde la app.')}
  `;
  return baseLayout(brand, body);
}

export function tplCancelacionCita(brand: BrandConfig, data: {
  pacienteNombre: string;
  profesionalNombre: string;
  fecha: string;
  hora: string;
  appUrl: string;
  motivo?: string;
}): string {
  const body = `
    ${heading('Tu cita ha sido cancelada')}
    ${paragraph(`Hola <strong>${data.pacienteNombre}</strong>, te informamos que la siguiente cita ha sido cancelada:`)}
    ${detailBox([
      { label: 'Profesional', value: data.profesionalNombre },
      { label: 'Fecha', value: data.fecha },
      { label: 'Hora', value: data.hora },
      ...(data.motivo ? [{ label: 'Motivo', value: data.motivo }] : []),
    ], brand.colorPrimario)}
    ${button(data.appUrl, 'Agendar nueva cita', brand.colorPrimario)}
  `;
  return baseLayout(brand, body);
}

export function tplReagendamientoCita(brand: BrandConfig, data: {
  pacienteNombre: string;
  profesionalNombre: string;
  fechaAnterior: string;
  horaAnterior: string;
  fechaNueva: string;
  horaNueva: string;
  appUrl: string;
}): string {
  const body = `
    ${heading('Tu cita ha sido reagendada 📅')}
    ${paragraph(`Hola <strong>${data.pacienteNombre}</strong>, tu cita ha sido movida a una nueva fecha:`)}
    ${detailBox([
      { label: 'Profesional', value: data.profesionalNombre },
      { label: 'Fecha anterior', value: `${data.fechaAnterior} ${data.horaAnterior}` },
      { label: 'Nueva fecha', value: `<strong>${data.fechaNueva} ${data.horaNueva}</strong>` },
    ], brand.colorPrimario)}
    ${button(data.appUrl, 'Ver mis citas', brand.colorPrimario)}
  `;
  return baseLayout(brand, body);
}

export function tplCumpleanos(brand: BrandConfig, data: {
  pacienteNombre: string;
  appUrl: string;
}): string {
  const body = `
    ${heading(`¡Feliz cumpleaños, ${data.pacienteNombre}! 🎂`)}
    ${paragraph(`Todo el equipo de <strong>${brand.nombreClinica}</strong> te desea un maravilloso día y te agradece por confiar en nosotros para cuidar tu salud.`)}
    ${paragraph('Recuerda que tu bienestar es nuestra prioridad. ¡Que tengas un excelente año!')}
    ${button(data.appUrl, 'Visitar mi app', brand.colorPrimario)}
  `;
  return baseLayout(brand, body);
}

export function tplInvitacionApp(brand: BrandConfig, data: {
  pacienteNombre: string;
  profesionalNombre: string;
  appUrl: string;   // URL de registro/onboarding del paciente
}): string {
  const body = `
    ${heading(`${brand.nombreClinica} te invita a NutriSmart 🥦`)}
    ${paragraph(`Hola <strong>${data.pacienteNombre}</strong>, <strong>${data.profesionalNombre}</strong> te ha invitado a usar la app de seguimiento nutricional de <strong>${brand.nombreClinica}</strong>.`)}
    ${paragraph('Con NutriSmart podrás:')}
    <ul style="color:#333333;font-size:14px;line-height:1.8;margin:0 0 16px;padding-left:20px;">
      <li>Ver y gestionar tus citas</li>
      <li>Acceder a tu plan nutricional</li>
      <li>Registrar tu progreso y métricas</li>
    </ul>
    ${button(data.appUrl, 'Activar mi cuenta', brand.colorPrimario)}
    ${paragraph('<small style="color:#999;">Este enlace es personal. Si no esperabas este correo, puedes ignorarlo.</small>')}
  `;
  return baseLayout(brand, body);
}

// ─── PROFESIONAL ─────────────────────────────────────────────

export function tplInvitacionProfesional(brand: BrandConfig, data: {
  profesionalNombre: string;
  adminNombre: string;
  rol: string;       // ej. "Nutricionista"
  appUrl: string;    // URL de registro/onboarding del profesional
}): string {
  const body = `
    ${heading(`Has sido invitado a ${brand.nombreClinica}`)}
    ${paragraph(`Hola <strong>${data.profesionalNombre}</strong>, <strong>${data.adminNombre}</strong> te ha invitado a unirte a <strong>${brand.nombreClinica}</strong> como <strong>${data.rol}</strong> en NutriSmart.`)}
    ${button(data.appUrl, 'Aceptar invitación', brand.colorPrimario)}
    ${paragraph('<small style="color:#999;">Si no reconoces esta invitación, puedes ignorar este correo.</small>')}
  `;
  return baseLayout(brand, body);
}

export function tplCitaProfesional(brand: BrandConfig, data: {
  profesionalNombre: string;
  pacienteNombre: string;
  fecha: string;
  hora: string;
  tipo: 'agendada' | 'cancelada' | 'reagendada';
  fechaAnterior?: string;
  horaAnterior?: string;
  appUrl: string;
}): string {
  const titulos: Record<typeof data.tipo, string> = {
    agendada: 'Nueva cita agendada 📋',
    cancelada: 'Cita cancelada',
    reagendada: 'Cita reagendada 📅',
  };
  const body = `
    ${heading(titulos[data.tipo])}
    ${paragraph(`Hola <strong>${data.profesionalNombre}</strong>, tienes un cambio en tu agenda:`)}
    ${detailBox([
      { label: 'Paciente', value: data.pacienteNombre },
      ...(data.tipo === 'reagendada' && data.fechaAnterior
        ? [{ label: 'Fecha anterior', value: `${data.fechaAnterior} ${data.horaAnterior}` }]
        : []),
      { label: data.tipo === 'cancelada' ? 'Fecha cancelada' : 'Nueva fecha', value: `${data.fecha} ${data.hora}` },
    ], brand.colorPrimario)}
    ${button(data.appUrl, 'Ver mi agenda', brand.colorPrimario)}
  `;
  return baseLayout(brand, body);
}
```

---

## 3. Servicio de notificaciones

Crea `apps/api/src/services/notificaciones.service.ts`:

Este módulo centraliza el envío de cada tipo de notificación. Obtiene el `brand_config` de la clínica y despacha el email correcto.

```typescript
import { sendEmail } from './email.service';
import * as tpl from './email.templates';
import type { BrandConfig } from './email.service';

// Ajusta este import según dónde viva tu acceso a DB (pool, prisma, etc.)
import { db } from '../db';   // o el nombre real de tu módulo de DB

async function getBrand(clinicaId: string): Promise<BrandConfig> {
  // brand_config tiene logo_url, color_primario, color_secundario desde R6
  const row = await db.query(
    `SELECT c.nombre, bc.color_primario, bc.color_secundario, bc.logo_url
       FROM clinicas c
       LEFT JOIN brand_config bc ON bc.clinica_id = c.id
      WHERE c.id = $1`,
    [clinicaId]
  );
  const r = row.rows[0];
  return {
    nombreClinica: r?.nombre ?? 'NutriSmart',
    colorPrimario: r?.color_primario ?? '#0E7C66',
    colorSecundario: r?.color_secundario,
    logoUrl: r?.logo_url,
  };
}

const PATIENT_APP = process.env.PATIENT_APP_URL ?? 'https://paciente.nutrismart.solutechit.com';
const PRO_APP = process.env.PROFESSIONAL_APP_URL ?? 'https://nutrismart.solutechit.com';

// Helper para formatear fecha
function formatFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/Mexico_City',
  });
}
function formatHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City',
  });
}

// ── Paciente ──────────────────────────────────────────────────────────────────

export async function notificarConfirmacionCita(cita: {
  clinicaId: string;
  pacienteEmail: string;
  pacienteNombre: string;
  profesionalNombre: string;
  fechaHoraInicio: string;
}) {
  const brand = await getBrand(cita.clinicaId);
  await sendEmail({
    to: cita.pacienteEmail,
    subject: `Cita confirmada — ${brand.nombreClinica}`,
    html: tpl.tplConfirmacionCita(brand, {
      pacienteNombre: cita.pacienteNombre,
      profesionalNombre: cita.profesionalNombre,
      fecha: formatFecha(cita.fechaHoraInicio),
      hora: formatHora(cita.fechaHoraInicio),
      appUrl: PATIENT_APP,
    }),
  });
}

export async function notificarCancelacionCita(cita: {
  clinicaId: string;
  pacienteEmail: string;
  pacienteNombre: string;
  profesionalNombre: string;
  fechaHoraInicio: string;
  motivo?: string;
}) {
  const brand = await getBrand(cita.clinicaId);
  await sendEmail({
    to: cita.pacienteEmail,
    subject: `Cita cancelada — ${brand.nombreClinica}`,
    html: tpl.tplCancelacionCita(brand, {
      pacienteNombre: cita.pacienteNombre,
      profesionalNombre: cita.profesionalNombre,
      fecha: formatFecha(cita.fechaHoraInicio),
      hora: formatHora(cita.fechaHoraInicio),
      motivo: cita.motivo,
      appUrl: PATIENT_APP,
    }),
  });
}

export async function notificarReagendamiento(cita: {
  clinicaId: string;
  pacienteEmail: string;
  pacienteNombre: string;
  profesionalNombre: string;
  fechaAnterior: string;
  fechaNueva: string;
}) {
  const brand = await getBrand(cita.clinicaId);
  await sendEmail({
    to: cita.pacienteEmail,
    subject: `Cita reagendada — ${brand.nombreClinica}`,
    html: tpl.tplReagendamientoCita(brand, {
      pacienteNombre: cita.pacienteNombre,
      profesionalNombre: cita.profesionalNombre,
      fechaAnterior: formatFecha(cita.fechaAnterior),
      horaAnterior: formatHora(cita.fechaAnterior),
      fechaNueva: formatFecha(cita.fechaNueva),
      horaNueva: formatHora(cita.fechaNueva),
      appUrl: PATIENT_APP,
    }),
  });
}

export async function notificarCumpleanos(paciente: {
  clinicaId: string;
  email: string;
  nombre: string;
}) {
  const brand = await getBrand(paciente.clinicaId);
  await sendEmail({
    to: paciente.email,
    subject: `¡Feliz cumpleaños de parte de ${brand.nombreClinica}! 🎂`,
    html: tpl.tplCumpleanos(brand, {
      pacienteNombre: paciente.nombre,
      appUrl: PATIENT_APP,
    }),
  });
}

export async function notificarInvitacionPaciente(data: {
  clinicaId: string;
  pacienteEmail: string;
  pacienteNombre: string;
  profesionalNombre: string;
  tokenInvitacion: string;  // token único para el onboarding
}) {
  const brand = await getBrand(data.clinicaId);
  const url = `${PATIENT_APP}/activar?token=${data.tokenInvitacion}`;
  await sendEmail({
    to: data.pacienteEmail,
    subject: `${brand.nombreClinica} te invita a NutriSmart`,
    html: tpl.tplInvitacionApp(brand, {
      pacienteNombre: data.pacienteNombre,
      profesionalNombre: data.profesionalNombre,
      appUrl: url,
    }),
  });
}

// ── Profesional ───────────────────────────────────────────────────────────────

export async function notificarInvitacionProfesional(data: {
  clinicaId: string;
  profesionalEmail: string;
  profesionalNombre: string;
  adminNombre: string;
  rol: string;
  tokenInvitacion: string;
}) {
  const brand = await getBrand(data.clinicaId);
  const url = `${PRO_APP}/activar?token=${data.tokenInvitacion}`;
  await sendEmail({
    to: data.profesionalEmail,
    subject: `Invitación a ${brand.nombreClinica} en NutriSmart`,
    html: tpl.tplInvitacionProfesional(brand, {
      profesionalNombre: data.profesionalNombre,
      adminNombre: data.adminNombre,
      rol: data.rol,
      appUrl: url,
    }),
  });
}

export async function notificarCitaProfesional(cita: {
  clinicaId: string;
  profesionalEmail: string;
  profesionalNombre: string;
  pacienteNombre: string;
  tipo: 'agendada' | 'cancelada' | 'reagendada';
  fechaHoraInicio: string;
  fechaHoraAnterior?: string;
}) {
  const brand = await getBrand(cita.clinicaId);
  const subjects: Record<typeof cita.tipo, string> = {
    agendada: `Nueva cita agendada — ${brand.nombreClinica}`,
    cancelada: `Cita cancelada — ${brand.nombreClinica}`,
    reagendada: `Cita reagendada — ${brand.nombreClinica}`,
  };
  await sendEmail({
    to: cita.profesionalEmail,
    subject: subjects[cita.tipo],
    html: tpl.tplCitaProfesional(brand, {
      profesionalNombre: cita.profesionalNombre,
      pacienteNombre: cita.pacienteNombre,
      tipo: cita.tipo,
      fecha: formatFecha(cita.fechaHoraInicio),
      hora: formatHora(cita.fechaHoraInicio),
      ...(cita.fechaHoraAnterior ? {
        fechaAnterior: formatFecha(cita.fechaHoraAnterior),
        horaAnterior: formatHora(cita.fechaHoraAnterior),
      } : {}),
      appUrl: PRO_APP,
    }),
  });
}
```

---

## 4. Integrar notificaciones en los endpoints existentes

Del relevamiento (sección 1) habrás identificado dónde se crean/cancelan/reagendan citas y dónde se crean/invitan profesionales. **Busca esos handlers y agrega las llamadas al servicio de notificaciones.**

Patrón general — agrega después del `INSERT`/`UPDATE` exitoso, sin bloquear la respuesta:

```typescript
import * as notif from '../services/notificaciones.service';

// En el handler de crear cita, después de INSERT exitoso:
notif.notificarConfirmacionCita({
  clinicaId: cita.clinica_id,
  pacienteEmail: paciente.email,
  pacienteNombre: `${paciente.nombre} ${paciente.apellido}`,
  profesionalNombre: `${profesional.nombre} ${profesional.apellido}`,
  fechaHoraInicio: cita.fecha_hora_inicio,
}).catch(err => console.error('[email] confirmación cita:', err));

// La misma idea para cancelación, reagendamiento, etc.
```

El `.catch(err => console.error(...))` es intencional: un fallo de email no debe hacer fallar la operación principal.

### Cumpleaños (cron diario)

Necesitas un job que corra cada día y envíe emails a pacientes que cumplen años hoy. Busca si existe algún scheduler en el proyecto (`node-cron`, `pg-boss`, `cron` npm, etc.).

Si no existe nada, agrega `node-cron` como solución mínima:

```bash
cd apps/api
npm install node-cron @types/node-cron
```

Crea `apps/api/src/jobs/cumpleanos.job.ts`:

```typescript
import cron from 'node-cron';
import { db } from '../db';
import { notificarCumpleanos } from '../services/notificaciones.service';

export function startCumpleanosJob() {
  // Corre cada día a las 8:00 AM (UTC-6 = 14:00 UTC)
  cron.schedule('0 14 * * *', async () => {
    console.log('[cron] Revisando cumpleaños...');
    try {
      // Ajusta el query según tu esquema: fecha_nacimiento en paciente
      const hoy = new Date();
      const result = await db.query(
        `SELECT p.id, p.nombre, p.apellido, p.email, cp.clinica_id
           FROM pacientes p
           JOIN configuracion_paciente cp ON cp.paciente_id = p.id
          WHERE EXTRACT(MONTH FROM p.fecha_nacimiento) = $1
            AND EXTRACT(DAY FROM p.fecha_nacimiento) = $2
            AND p.email IS NOT NULL`,
        [hoy.getMonth() + 1, hoy.getDate()]
      );
      for (const row of result.rows) {
        await notificarCumpleanos({
          clinicaId: row.clinica_id,
          email: row.email,
          nombre: `${row.nombre} ${row.apellido}`,
        }).catch(err => console.error('[email] cumpleaños:', err));
      }
      console.log(`[cron] Cumpleaños: ${result.rowCount} emails enviados`);
    } catch (err) {
      console.error('[cron] Error en job cumpleaños:', err);
    }
  });
}
```

Agrega `startCumpleanosJob()` en el arranque de la API (donde esté el `fastify.listen` o similar).

---

## 5. Login integrado — Keycloak custom theme

### ⚠️ Decisión arquitectónica importante — lee antes de codificar

Hay tres enfoques para "integrar" el login de Keycloak en la pantalla actual:

**Opción A (RECOMENDADA): Custom Keycloak theme**
- Se crea un tema en Keycloak que imita exactamente el diseño de NutriSmart
- El flujo PKCE se mantiene intacto: la app redirige a Keycloak pero el usuario ve una pantalla visualmente idéntica
- La app NUNCA ve las contraseñas — Keycloak las maneja
- Compatible con todos los browsers
- "Olvidé mi contraseña" funciona nativo de Keycloak
- **Esta es la opción que implementaremos**

**Opción B: Direct Access Grants (DAG) — NO implementar**
- La app recolecta usuario/password y los manda a Keycloak via API
- Elimina PKCE: la app actúa como intermediario y VE las contraseñas
- Riesgo de seguridad real — Keycloak lo deshabilita por defecto
- Puede generar problemas con auditores y certificaciones

**Opción C: iframe de Keycloak — NO implementar**
- Safari bloquea cookies de terceros en iframes
- Soporte inconsistente entre browsers

### 5a. Crear custom theme en Keycloak

El servidor corre Keycloak. Necesitas crear una carpeta de tema:

**Servidor (SSH)**:
```bash
# Identifica dónde está Keycloak corriendo
docker ps | grep keycloak

# Entra al container de Keycloak
docker exec -it <nombre-container-keycloak> /bin/bash

# Dentro del container, verifica la estructura de themes
ls /opt/keycloak/themes/
# Deberías ver: base, keycloak, keycloak.v2 (o similar)
exit

# Fuera del container, crea la carpeta del tema en el host
# (ajusta el path según tu docker-compose / bind mount)
mkdir -p /opt/nutrismart/keycloak-themes/nutrismart/login
```

Crea los siguientes archivos en `apps/api/keycloak-theme/nutrismart/login/` (en el repo, para que sea reproducible):

**`apps/api/keycloak-theme/nutrismart/theme.properties`**:
```properties
parent=keycloak
import=common/keycloak

styles=css/login.css
```

**`apps/api/keycloak-theme/nutrismart/login/login.ftl`**:

Este archivo es una plantilla FreeMarker que extiende el login base de Keycloak. Crea una pantalla que imite el diseño actual de NutriSmart (fondo verde a la izquierda, formulario a la derecha):

```html
<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??; section>

<#if section = "header">
  <#-- vacío: el logo va en el body -->

<#elseif section = "form">
<div class="ns-split">
  <div class="ns-left">
    <img src="${url.resourcesPath}/img/logo-white.svg" alt="NutriSmart" class="ns-logo" />
    <h1 class="ns-tagline">Tu aliado en nutrición</h1>
  </div>
  <div class="ns-right">
    <div class="ns-card">
      <h2 class="ns-title">Iniciar sesión</h2>
      <form id="kc-form-login" onsubmit="return true;" action="${url.loginAction}" method="post">
        <div class="ns-field">
          <label for="username" class="ns-label">
            ${msg("email")}
          </label>
          <input
            tabindex="1"
            id="username"
            class="ns-input"
            name="username"
            value="${(login.username!'')}"
            type="email"
            autofocus
            autocomplete="email"
            aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
          />
        </div>
        <div class="ns-field">
          <label for="password" class="ns-label">
            ${msg("password")}
          </label>
          <input
            tabindex="2"
            id="password"
            class="ns-input"
            name="password"
            type="password"
            autocomplete="current-password"
            aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
          />
        </div>

        <#if messagesPerField.existsError('username','password')>
        <div class="ns-error">
          ${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}
        </div>
        </#if>

        <#if realm.resetPasswordAllowed>
        <div class="ns-forgot">
          <a href="${url.loginResetCredentialsUrl}">¿Olvidaste tu contraseña?</a>
        </div>
        </#if>

        <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>/>
        <input
          tabindex="3"
          class="ns-btn"
          name="login"
          id="kc-login"
          type="submit"
          value="${msg("doLogIn")}"
        />
      </form>
    </div>
  </div>
</div>
</#if>

</@layout.registrationLayout>
```

**`apps/api/keycloak-theme/nutrismart/login/resources/css/login.css`**:

```css
/* Reset del tema base */
body { margin: 0; padding: 0; font-family: 'Inter', Arial, sans-serif; }
#kc-header, #kc-header-wrapper, .login-pf-header { display: none !important; }
.login-pf { background: #f4f4f4; }
.login-pf-page { padding: 0; }

/* Layout split igual al diseño actual */
.ns-split {
  display: flex;
  min-height: 100vh;
}
.ns-left {
  flex: 0 0 42%;
  background: #0E7C66;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px;
}
.ns-right {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  padding: 48px 24px;
}
.ns-logo { max-width: 180px; margin-bottom: 24px; }
.ns-tagline { color: rgba(255,255,255,0.85); font-size: 18px; font-weight: 400; text-align: center; margin: 0; }
.ns-card { width: 100%; max-width: 400px; }
.ns-title { font-size: 26px; font-weight: 700; color: #1a1a1a; margin: 0 0 28px; }
.ns-field { margin-bottom: 18px; }
.ns-label { display: block; font-size: 13px; color: #555; margin-bottom: 6px; font-weight: 500; }
.ns-input {
  width: 100%; box-sizing: border-box;
  padding: 10px 14px; border: 1px solid #d1d5db;
  border-radius: 6px; font-size: 15px; color: #1a1a1a;
  transition: border-color 0.15s;
  outline: none;
}
.ns-input:focus { border-color: #0E7C66; box-shadow: 0 0 0 3px rgba(14,124,102,0.12); }
.ns-error { color: #dc2626; font-size: 13px; margin-bottom: 12px; }
.ns-forgot { text-align: right; margin-bottom: 20px; }
.ns-forgot a { color: #0E7C66; font-size: 13px; text-decoration: none; }
.ns-forgot a:hover { text-decoration: underline; }
.ns-btn {
  width: 100%; padding: 12px;
  background: #0E7C66; color: #ffffff;
  border: none; border-radius: 6px;
  font-size: 15px; font-weight: 600;
  cursor: pointer; transition: background 0.15s;
}
.ns-btn:hover { background: #0A5C4C; }

@media (max-width: 700px) {
  .ns-split { flex-direction: column; }
  .ns-left { min-height: 180px; flex: none; padding: 32px 24px; }
}
```

> **Nota sobre logo**: Copia el archivo SVG del logo blanco de NutriSmart a `apps/api/keycloak-theme/nutrismart/login/resources/img/logo-white.svg`. Si no existe una versión blanca, adapta el CSS para mostrar solo el texto.

### 5b. Habilitar el tema en Keycloak

**Servidor (SSH)**:
```bash
# Copia el tema al container de Keycloak
# (ajusta según docker-compose; probablemente hay un bind mount /opt/nutrismart/keycloak-themes)
cp -r apps/api/keycloak-theme/nutrismart /opt/nutrismart/keycloak-themes/

# Reinicia Keycloak para que detecte el nuevo tema
docker restart <nombre-container-keycloak>
```

Luego en la consola de administración de Keycloak (`/auth/admin`):
1. Selecciona realm `nutrismart`
2. Realm Settings → Themes → Login Theme → selecciona `nutrismart`
3. Guarda

### 5c. "Olvidé mi contraseña"

Con la opción A (custom theme) esto ya está incluido en el `login.ftl` mediante:
```
<#if realm.resetPasswordAllowed>
  <a href="${url.loginResetCredentialsUrl}">¿Olvidaste tu contraseña?</a>
</#if>
```

Asegúrate de que en Keycloak Admin → Realm Settings → Login esté activado `Forgot password`. Si ya estaba activo, no hay nada más que hacer.

La pantalla de recuperación también heredará el tema `nutrismart` automáticamente. Crea `apps/api/keycloak-theme/nutrismart/login/login-reset-password.ftl` si quieres personalizar aún más ese paso (opcional; el tema base ya provee uno funcional).

### 5d. Actualizar LoginPage en web-professional (si aplica)

Si el componente actual de `LoginPage` tiene un botón "Iniciar sesión" que redirige a Keycloak, no necesitas cambiarlo — el redirect irá a la nueva pantalla temática de Keycloak que se ve idéntica al diseño actual. 

Sin embargo, si el componente actual **solo** muestra un botón sin el split-screen verde+blanco, actualiza `LoginPage.tsx` para mostrar ese split-screen mientras el redirect ocurre (spinner o carga automática). Esto crea continuidad visual.

Si ya hay un split-screen con botón, simplemente quita el botón y reemplaza por redirect automático al cargar (o al intentar acceder a ruta protegida) — el usuario ve el split-screen en Keycloak sin transición perceptible.

---

## 6. Migración DB (si aplica)

Del relevamiento, verifica si necesitas alguna columna nueva. Dos probables:

```sql
-- Solo si no existe: token de invitación para pacientes
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS token_invitacion UUID;
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS token_invitacion_expires TIMESTAMPTZ;

-- Solo si no existe: token de invitación para profesionales
ALTER TABLE profesionales ADD COLUMN IF NOT EXISTS token_invitacion UUID;
ALTER TABLE profesionales ADD COLUMN IF NOT EXISTS token_invitacion_expires TIMESTAMPTZ;
```

Si estas columnas ya existen (o usas otro mecanismo), sáltate la migración. **No crees una migración vacía.**

Si hay migración nueva, sigue el patrón de migraciones del proyecto (nombra con el siguiente número disponible después de 060, o el que corresponda según lo que encuentres en `/apps/api/migrations/`).

---

## 7. TypeScript / build

```bash
cd apps/api
npx tsc --noEmit
```

Corrige todos los errores antes de continuar.

```bash
cd apps/web-professional
npx tsc --noEmit 2>/dev/null || true   # solo si hay cambios en web-professional
```

---

## 8. Commit

```bash
git add -A
git commit -m "R54: emails transaccionales branded + Keycloak custom theme login

- Servicio email con nodemailer + plantillas HTML inline (compatible Gmail/Outlook)
- 5 notificaciones paciente: confirmación, cancelación, reagendamiento, cumpleaños, invitación app
- 3 notificaciones profesional: invitación clínica, cita agendada/cancelada/reagendada
- Plantillas branded: usa color_primario y logo_url de brand_config por clínica
- Job diario cumpleaños (node-cron, 08:00 hora local)
- Keycloak custom theme 'nutrismart': split-screen verde+blanco idéntico al diseño actual
- Login con formulario propio en Keycloak (PKCE intacto, sin Direct Access Grants)
- 'Olvidé mi contraseña' via flujo nativo de Keycloak (resetPasswordAllowed)
- Variables de entorno documentadas en .env.example

Pendiente de configurar en producción: SMTP_HOST/USER/PASS en .env del servidor"
```

---

## 9. Reporte final

Al terminar, reporta:
1. ¿Existía algún email service previo? ¿Lo reemplazaste o extendiste?
2. ¿En qué endpoints inyectaste las llamadas a notificaciones? (lista los archivos modificados)
3. ¿Fue necesaria alguna migración DB nueva? Si sí, ¿cuál número?
4. ¿El tema Keycloak quedó copiado manualmente al servidor o hay un paso extra en el deploy?
5. ¿Encontraste alguna dificultad en el relevamiento que cambie el diseño propuesto?
6. ¿Hay algún decision pendiente para Miguel? (ej. ¿usar Resend/SendGrid en lugar de SMTP propio?)

---

## 10. Configurar en producción (para después del deploy)

> **Importante**: Los siguientes pasos se harán DESPUÉS de que Miguel haga el deploy con PowerShell + deploy.sh. No son parte del commit.

**Servidor (SSH)** — agregar al `.env` del servidor los valores reales de Resend:
```
RESEND_API_KEY=<API key del dashboard de Resend — cuenta solutechit>
RESEND_FROM_ADDRESS=noreply@nutrismart.solutechit.com
RESEND_FROM_NAME=NutriSmart
PATIENT_APP_URL=https://paciente.nutrismart.solutechit.com
PROFESSIONAL_APP_URL=https://nutrismart.solutechit.com
```

El dominio `nutrismart.solutechit.com` ya está verificado en Resend — no hay nada más que configurar en el DNS.

Y copiar el tema Keycloak:
```bash
# Servidor (SSH)
cp -r /opt/nutrismart/apps/api/keycloak-theme/nutrismart /opt/nutrismart/keycloak-themes/
docker restart <keycloak-container>
```
