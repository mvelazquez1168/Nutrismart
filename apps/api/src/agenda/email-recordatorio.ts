/**
 * Correo de recordatorio de cita — AGE-03.
 *
 * Mismo planteamiento que la invitación de la Rebanada 17: sin clave, el
 * aviso sale por consola y el proceso sigue. Un fallo de correo no debe
 * detener nada — y aquí menos: el temporizador corre cada quince minutos
 * y una excepción sin capturar se lo lleva por delante.
 */
import { Resend } from 'resend'
import { config } from '../config.js'

export interface ResultadoEnvio {
  ok: boolean
  error?: string
}

/** El nombre del paciente y el de la clínica los escribe una persona. */
function esc(t: string): string {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const cliente = config.resend ? new Resend(config.resend.apiKey) : null

const TIPO: Record<string, string> = {
  primera_vez: 'primera consulta',
  seguimiento: 'seguimiento',
  control: 'control',
  urgencia: 'urgencia',
}

export interface DatosRecordatorio {
  correoPaciente: string
  nombrePaciente: string
  nombreClinica: string
  /** Instante ISO de la cita. */
  inicio: string
  tipoCita: string
  antelacion: '24h' | '1h'
}

export async function enviarRecordatorioCita(datos: DatosRecordatorio): Promise<ResultadoEnvio> {
  const cuando = new Date(datos.inicio)

  // El huso se fija a America/Costa_Rica, que es donde está la clínica
  // piloto. Formatear en el huso del SERVIDOR daría una hora distinta
  // según dónde corra el contenedor, y una hora equivocada en un
  // recordatorio es peor que no mandarlo.
  const opciones: Intl.DateTimeFormatOptions = { timeZone: 'America/Costa_Rica' }
  const fecha = cuando.toLocaleDateString('es-CR', {
    ...opciones,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const hora = cuando.toLocaleTimeString('es-CR', {
    ...opciones,
    hour: '2-digit',
    minute: '2-digit',
  })

  const enlace = `${config.pacAppUrl}/citas`
  const tipo = TIPO[datos.tipoCita] ?? datos.tipoCita
  const asunto =
    datos.antelacion === '24h'
      ? `Recordatorio: tu cita es mañana — ${datos.nombreClinica}`
      : `Tu cita es en una hora — ${datos.nombreClinica}`

  if (!cliente) {
    console.log('─'.repeat(60))
    console.log('[AGE] RESEND_API_KEY no configurada — modo consola')
    console.log(`[AGE] Recordatorio (${datos.antelacion}) para ${datos.correoPaciente}`)
    console.log(`[AGE] Cita de ${tipo}: ${fecha} a las ${hora}`)
    console.log('─'.repeat(60))
    return { ok: false, error: 'sin_configurar' }
  }

  const { error } = await cliente.emails.send({
    from: config.resend!.from,
    to: datos.correoPaciente,
    subject: asunto,
    text:
      `Hola ${datos.nombrePaciente},\n\n` +
      `Te recordamos tu cita de ${tipo} en ${datos.nombreClinica}:\n` +
      `${fecha} a las ${hora}.\n\n` +
      `Puedes verla y confirmar tu asistencia en: ${enlace}\n\n` +
      `Si no puedes asistir, avisa a tu nutricionista con antelación.`,
    html: `
      <p>Hola <strong>${esc(datos.nombrePaciente)}</strong>,</p>
      <p>Te recordamos tu cita de <strong>${esc(tipo)}</strong> en <strong>${esc(datos.nombreClinica)}</strong>:</p>
      <p style="font-size:20px;font-weight:600;color:#0E7C66;">${esc(fecha)} — ${esc(hora)}</p>
      <p>
        <a href="${enlace}" style="background:#0E7C66;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;margin:16px 0;">
          Ver mi cita
        </a>
      </p>
      <p style="color:#6B7280;font-size:14px;">Si no puedes asistir, avisa a tu nutricionista con antelación.</p>
    `,
  })

  if (error) {
    console.error('[AGE] Resend rechazó el recordatorio:', error.name, error.message)
    return { ok: false, error: `${error.name}: ${error.message}`.slice(0, 500) }
  }

  return { ok: true }
}
