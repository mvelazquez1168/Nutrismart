/**
 * Correo de invitación al paciente — PAC-01.
 *
 * Sin SMTP configurado, el enlace se imprime en la consola de la API y
 * la invitación se crea igual. En desarrollo eso es lo único que hace
 * falta, y en producción un fallo de correo no debe impedir que el
 * profesional copie el enlace y lo entregue por otra vía.
 */
import nodemailer from 'nodemailer'
import { config } from '../config.js'

/**
 * Escapa el texto que entra en el HTML del correo.
 *
 * El nombre del paciente y el de la clínica los escribe una persona. Sin
 * escapar, un nombre con `<` rompe la maquetación del correo en el mejor
 * caso y mete marcado ajeno en el peor.
 */
function esc(t: string): string {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface DatosInvitacion {
  correoPaciente: string
  nombrePaciente: string
  nombreClinica: string
  token: string
}

/** Devuelve true si el correo salió de verdad. */
export async function enviarInvitacion(datos: DatosInvitacion): Promise<boolean> {
  const enlace = `${config.pacAppUrl}/activar?token=${datos.token}`

  if (!config.smtp) {
    console.log('─'.repeat(60))
    console.log('[PAC] SMTP no configurado — modo consola')
    console.log(`[PAC] Invitación para: ${datos.correoPaciente}`)
    console.log(`[PAC] Enlace de activación: ${enlace}`)
    console.log('─'.repeat(60))
    return false
  }

  const transporte = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    ...(config.smtp.user ? { auth: { user: config.smtp.user, pass: config.smtp.pass } } : {}),
  })

  await transporte.sendMail({
    from: config.smtp.from,
    to: datos.correoPaciente,
    subject: `Tu invitación a NutriSmart — ${datos.nombreClinica}`,
    text:
      `Hola ${datos.nombrePaciente},\n\n` +
      `Tu nutricionista de ${datos.nombreClinica} te invita a NutriSmart. Entra en:\n${enlace}\n\n` +
      `El enlace caduca en 7 días. Si no esperabas esta invitación, ignora este correo.`,
    html: `
      <p>Hola <strong>${esc(datos.nombrePaciente)}</strong>,</p>
      <p>Tu nutricionista de <strong>${esc(datos.nombreClinica)}</strong> te ha invitado a NutriSmart.</p>
      <p>
        <a href="${enlace}" style="background:#0E7C66;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;margin:16px 0;">
          Activar mi cuenta
        </a>
      </p>
      <p style="color:#6B7280;font-size:14px;">El enlace caduca en 7 días. Si no esperabas esta invitación, ignora este correo.</p>
    `,
  })

  return true
}
