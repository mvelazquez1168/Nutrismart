/**
 * Correo de invitación al paciente — PAC-01, vía Resend.
 *
 * Sin `RESEND_API_KEY` el enlace se imprime en la consola de la API y la
 * invitación se crea igual. En desarrollo eso es lo único que hace
 * falta, y en producción un fallo de correo no debe impedir que el
 * profesional copie el enlace y lo entregue por otra vía.
 *
 * El resultado distingue tres desenlaces en vez de un booleano: "no hay
 * correo configurado" y "el envío falló" piden cosas distintas al
 * profesional, y decirle lo primero cuando pasó lo segundo le hace
 * buscar el problema donde no está.
 */
import { Resend } from 'resend'
import { config } from '../config.js'

export type ResultadoEnvio = 'enviado' | 'sin_configurar' | 'fallo'

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

const cliente = config.resend ? new Resend(config.resend.apiKey) : null

export interface DatosInvitacion {
  correoPaciente: string
  nombrePaciente: string
  nombreClinica: string
  token: string
}

export async function enviarInvitacion(datos: DatosInvitacion): Promise<ResultadoEnvio> {
  const enlace = `${config.pacAppUrl}/activar?token=${datos.token}`

  if (!cliente || !config.resend) {
    console.log('─'.repeat(60))
    console.log('[PAC] RESEND_API_KEY no configurada — modo consola')
    console.log(`[PAC] Invitación para: ${datos.correoPaciente}`)
    console.log(`[PAC] Enlace de activación: ${enlace}`)
    console.log('─'.repeat(60))
    return 'sin_configurar'
  }

  const { error } = await cliente.emails.send({
    from: config.resend.from,
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

  if (error) {
    // No se lanza: la invitación ya existe en la base y el profesional
    // tiene el enlace en la respuesta. Convertir esto en una excepción
    // haría que el botón pareciera haber fallado del todo cuando lo
    // único que falló fue el reparto.
    console.error('[PAC] Resend rechazó el envío:', error.name, error.message)
    // El enlace también a consola: es el plan B inmediato.
    console.log(`[PAC] Enlace de activación: ${enlace}`)
    return 'fallo'
  }

  return 'enviado'
}
