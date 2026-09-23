# R17-PATCH — Reemplazar nodemailer por Resend

> Ejecutar después de que r17 termine. Solo toca el módulo de email; todo lo demás de r17 queda intacto.

---

## Paso 1 — Instalar SDK de Resend

```bash
cd apps/api && npm install resend
```

## Paso 2 — Reemplazar `apps/api/src/pac/email.ts`

Sobreescribe el archivo completo:

```typescript
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// En producción, reemplaza el from por tu dominio verificado en resend.com
// p.ej. 'NutriSmart <noreply@nutrismart.app>'
// Mientras no hay dominio verificado, usa el sandbox de Resend:
const FROM_ADDRESS = process.env.RESEND_FROM ?? 'NutriSmart <onboarding@resend.dev>';

export async function enviarInvitacion(opts: {
  emailPaciente: string;
  nombrePaciente: string;
  nombreClinica: string;
  token: string;
}): Promise<void> {
  const baseUrl = process.env.PAC_APP_URL ?? 'http://localhost:5174';
  const link = `${baseUrl}/activar?token=${opts.token}`;

  if (!process.env.RESEND_API_KEY) {
    // Modo desarrollo sin API key: imprime el enlace en consola
    console.log('──────────────────────────────────────────');
    console.log('[PAC] RESEND_API_KEY no configurada — modo consola');
    console.log(`[PAC] Invitación para: ${opts.emailPaciente}`);
    console.log(`[PAC] Enlace de activación: ${link}`);
    console.log('──────────────────────────────────────────');
    return;
  }

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to:   opts.emailPaciente,
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
      <p style="color:#6B7280;font-size:14px;">
        El enlace expira en 7 días. Si no esperabas esta invitación, ignora este correo.
      </p>
    `,
  });

  if (error) {
    // Loguear pero no lanzar — la invitación ya fue creada en DB.
    // El profesional puede copiar el token del response del botón.
    console.error('[PAC] Error Resend:', error);
    throw new Error(`No se pudo enviar el email: ${error.message}`);
  }
}
```

## Paso 3 — Agregar variables al `.env` de la API

En `apps/api/.env` agrega:

```env
RESEND_API_KEY=tu_api_key_aqui
RESEND_FROM=NutriSmart <noreply@nutrismart.app>   # ver nota abajo
PAC_APP_URL=http://localhost:5174
```

> **Nota sobre el dominio remitente:**
> VetlineAI usa `vetlineai.com` como dominio verificado en Resend. NutriSmart necesita su propio dominio verificado — no puede compartir el de VetlineAI.
>
> Opciones:
> - **Dominio propio** (`nutrismart.app` o el que tengas): agrégalo en resend.com → Domains → Add Domain, configura los registros DNS que Resend indica, y úsalo en `RESEND_FROM`.
> - **Sandbox de Resend mientras tanto**: deja `RESEND_FROM` vacío en `.env` y el código usará `onboarding@resend.dev` automáticamente — solo funciona enviando a emails verificados en tu cuenta de Resend (útil para pruebas internas).
> - **Mismo dominio, subdominio diferente**: si NutriSmart comparte infraestructura con VetlineAI, puedes verificar `mail.nutrismart.app` o similar sin tocar `vetlineai.com`.

## Paso 4 — Eliminar nodemailer (opcional, no urgente)

```bash
cd apps/api && npm uninstall nodemailer @types/nodemailer
```

Solo si no hay otro módulo en el proyecto que lo use. Si no estás seguro, déjalo instalado — no hace daño.

## Paso 5 — Verificación

Reinicia la API y prueba el botón "Invitar a NutriSmart" desde web-professional:

- **Sin `RESEND_API_KEY`**: debe imprimir el enlace en consola (sin error en UI).
- **Con `RESEND_API_KEY`**: el email llega a Resend → verifica en el dashboard de resend.com → Logs.
- En ambos casos el response del botón debe incluir el `token` para copiarlo manualmente en dev.
