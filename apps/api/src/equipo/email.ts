/**
 * Correo de alta a un profesional — GAM-02.
 *
 * Lo que este correo NO puede prometer: una contraseña. El alta en la
 * clínica y la cuenta de acceso son dos cosas distintas —la primera vive
 * aquí, la segunda en Keycloak— y decirle a alguien «ya puedes entrar»
 * cuando todavía no tiene usuario es hacerle perder la tarde.
 *
 * Sin `RESEND_API_KEY` el aviso sale por consola y el proceso sigue,
 * como en las Rebanadas 17, 21 y 27.
 */
import { Resend } from 'resend'
import { config } from '../config.js'

const cliente = config.resend ? new Resend(config.resend.apiKey) : null

function esc(t: string): string {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function enviarBienvenidaProfesional(datos: {
  nombre: string
  correo: string
  clinica: string
}): Promise<void> {
  const asunto = `Te han dado de alta en ${datos.clinica}`
  const texto =
    `Hola ${datos.nombre}:\n\n` +
    `Te han dado de alta como profesional en ${datos.clinica}, dentro de NutriSmart.\n\n` +
    `Todavía te falta la cuenta de acceso: pídesela al administrador de tu clínica. ` +
    `Cuando entres por primera vez con ella, tu usuario quedará vinculado a esta ficha.\n`

  if (!cliente) {
    console.log(`[equipo] (sin Resend) para ${datos.correo}: ${asunto}`)
    return
  }

  try {
    const r = await cliente.emails.send({
      from: config.resend!.from,
      to: datos.correo,
      subject: asunto,
      text: texto,
      html:
        `<p>Hola <strong>${esc(datos.nombre)}</strong>:</p>` +
        `<p>Te han dado de alta como profesional en <strong>${esc(datos.clinica)}</strong>, dentro de NutriSmart.</p>` +
        `<p>Todavía te falta la cuenta de acceso: pídesela al administrador de tu clínica. ` +
        `Cuando entres por primera vez con ella, tu usuario quedará vinculado a esta ficha.</p>`,
    })
    if (r.error) console.error(`[equipo] Resend rechazó el envío: ${r.error.message}`)
  } catch (e) {
    console.error('[equipo] fallo al enviar la bienvenida:', e)
  }
}
