/**
 * Aviso por correo de las alertas nuevas — RPM-03.
 *
 * Va al PROFESIONAL, no al paciente. Decirle a alguien por correo «tu
 * glucosa está alta» sin nadie que lo interprete es alarmar sin ayudar;
 * quien decide qué significa y qué se hace es el profesional. Es la
 * regla del proyecto: la máquina asiste, el profesional decide.
 *
 * Sin `RESEND_API_KEY` el aviso sale por consola y el proceso sigue.
 * Igual que en las Rebanadas 17 y 21: un fallo de correo no detiene
 * nada, y aquí menos, que corre dentro de un temporizador.
 */
import { Resend } from 'resend'
import { pool } from '../db.js'
import { config } from '../config.js'

const cliente = config.resend ? new Resend(config.resend.apiKey) : null

export const correoConfigurado = (): boolean => cliente !== null

function esc(t: string): string {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface Pendiente {
  id: string
  mensaje: string
  paciente: string
  destinatario: string | null
  clinica: string
}

/**
 * Envía las alertas que aún no se han avisado y las marca.
 *
 * Se marca ANTES de enviar, con un UPDATE que devuelve solo las filas
 * que consiguió marcar. Si el envío falla después, se pierde ese aviso
 * concreto — preferible a la alternativa: marcarlo después significa que
 * un fallo entre el envío y el UPDATE reenvía el mismo correo en cada
 * ciclo. Es el mismo criterio de la Rebanada 21 con los recordatorios.
 */
export async function enviarAlertasPendientes(): Promise<number> {
  const { rows } = await pool.query<Pendiente>(
    `update alerta_rpm a
        set email_enviado = true, updated_at = now()
       from paciente p, profesional pr, clinica c
      where a.id in (
              select id from alerta_rpm
               where email_enviado = false and estado = 'activa'
               order by created_at
               limit 50
              for update skip locked
            )
        and p.id = a.paciente_id
        and pr.id = a.profesional_id
        and c.id = a.clinica_id
      returning a.id, a.mensaje,
                p.nombre as paciente,
                pr.correo as destinatario,
                coalesce(c.nombre_comercial, c.nombre_fiscal) as clinica`,
  )

  let enviados = 0

  for (const a of rows) {
    if (!a.destinatario) {
      console.warn(`[alertas] ${a.paciente}: el profesional no tiene correo, aviso omitido`)
      continue
    }

    const asunto = `Alerta de seguimiento · ${a.paciente}`
    const texto = `${a.paciente}\n\n${a.mensaje}\n\nEntra a NutriSmart para verlo en su expediente.`

    if (!cliente) {
      console.log(`[alertas] (sin Resend) para ${a.destinatario}: ${asunto} — ${a.mensaje}`)
      enviados++
      continue
    }

    try {
      const r = await cliente.emails.send({
        from: config.resend!.from,
        to: a.destinatario,
        subject: asunto,
        text: texto,
        html:
          `<p><strong>${esc(a.paciente)}</strong></p>` +
          `<p>${esc(a.mensaje)}</p>` +
          `<p style="color:#6B7280;font-size:13px">Aviso automático de ${esc(a.clinica)}. ` +
          `Entra a NutriSmart para verlo en su expediente.</p>`,
      })
      if (r.error) {
        console.error(`[alertas] Resend rechazó el envío: ${r.error.message}`)
      } else {
        enviados++
      }
    } catch (e) {
      console.error('[alertas] fallo al enviar:', e)
    }
  }

  return enviados
}
