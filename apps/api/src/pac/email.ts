/**
 * Correo de invitación al paciente — PAC-01, con la marca de la clínica
 * desde R54.
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
 *
 * ── Qué cambió en R54 ───────────────────────────────────────────────
 *
 * El HTML lo arma `email/layout.ts` con el color y el logo de la
 * clínica, en vez del verde `#0E7C66` que había escrito a mano aquí. El
 * envío lo hace `email/enviar.ts`: este módulo ya no construye su
 * propio cliente de Resend ni tiene su propia copia de `esc()`.
 *
 * Hace falta `clinicaId` para leer la marca. Es lo único que cambió en
 * la firma.
 */
import { config } from '../config.js'
import { enviarCorreo, type ResultadoEnvio } from '../email/enviar.js'
import { boton, envoltorio, esc, nota, parrafo, titulo } from '../email/layout.js'
import { obtenerMarca } from '../email/marca.js'

export type { ResultadoEnvio }

export interface DatosInvitacion {
  clinicaId: string
  correoPaciente: string
  nombrePaciente: string
  token: string
}

export async function enviarInvitacion(datos: DatosInvitacion): Promise<ResultadoEnvio> {
  const enlace = `${config.pacAppUrl}/activar?token=${datos.token}`
  const marca = await obtenerMarca(datos.clinicaId)

  const cuerpo = [
    titulo(`${marca.nombreClinica} te invita a NutriSmart`),
    parrafo(
      `Hola <strong>${esc(datos.nombrePaciente)}</strong>, tu nutricionista de ` +
        `<strong>${esc(marca.nombreClinica)}</strong> te ha invitado a la aplicación de seguimiento.`,
    ),
    parrafo('Desde ahí vas a poder:'),
    `<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.7;color:#333333;">
      <li>Ver tus citas y confirmarlas</li>
      <li>Consultar tu plan y tus acuerdos</li>
      <li>Apuntar lo que comes y tus medidas</li>
    </ul>`,
    boton(enlace, 'Activar mi cuenta', marca.colorPrimario),
    nota('El enlace caduca en 7 días y es personal. Si no esperabas esta invitación, ignora este correo.'),
  ].join('\n')

  const resultado = await enviarCorreo({
    para: datos.correoPaciente,
    asunto: `Tu invitación a NutriSmart — ${marca.nombreClinica}`,
    html: envoltorio(marca, cuerpo),
    texto:
      `Hola ${datos.nombrePaciente},\n\n` +
      `Tu nutricionista de ${marca.nombreClinica} te invita a NutriSmart. Entra en:\n${enlace}\n\n` +
      `El enlace caduca en 7 días. Si no esperabas esta invitación, ignora este correo.`,
    tipo: 'invitacion-paciente',
  })

  // El enlace a consola también cuando el envío falla: la invitación ya
  // existe en la base y el profesional puede entregarlo por otra vía.
  // Es el plan B inmediato, y sin esto habría que ir a buscarlo a la
  // base de datos.
  if (resultado === 'fallo') {
    console.log(`[PAC] Enlace de activación: ${enlace}`)
  }

  return resultado
}
