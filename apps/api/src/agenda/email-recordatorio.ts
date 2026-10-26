/**
 * Correo de recordatorio de cita — AGE-03, con la marca de la clínica
 * desde R54.
 *
 * Mismo planteamiento que la invitación de la Rebanada 17: sin clave, el
 * aviso sale por consola y el proceso sigue. Un fallo de correo no debe
 * detener nada — y aquí menos: el temporizador corre cada quince minutos
 * y una excepción sin capturar se lo lleva por delante.
 *
 * ── Qué cambió en R54 ───────────────────────────────────────────────
 *
 * El HTML lo arma `email/layout.ts` con el color y el logo de la
 * clínica; antes llevaba el verde `#0E7C66` escrito a mano. El envío y
 * el escape de texto salen de `email/`, así que aquí ya no hay cliente
 * de Resend propio ni copia de `esc()`.
 *
 * La hora se formatea en la zona horaria de la CLÍNICA, que ahora viene
 * con la marca. Antes estaba fijada a `America/Costa_Rica`: correcto
 * para la clínica piloto y equivocado en cuanto haya una segunda.
 */
import { config } from '../config.js'
import { enviarCorreo } from '../email/enviar.js'
import { boton, caja, envoltorio, esc, nota, parrafo, titulo } from '../email/layout.js'
import { obtenerMarca } from '../email/marca.js'
import { momento, tipoEnPalabras } from '../email/notificaciones.js'

export interface ResultadoEnvio {
  ok: boolean
  error?: string
}

export interface DatosRecordatorio {
  clinicaId: string
  correoPaciente: string
  nombrePaciente: string
  /** Instante ISO de la cita. */
  inicio: string
  tipoCita: string
  antelacion: '24h' | '1h'
}

export async function enviarRecordatorioCita(datos: DatosRecordatorio): Promise<ResultadoEnvio> {
  const marca = await obtenerMarca(datos.clinicaId)
  const m = momento(datos.inicio, marca.zonaHoraria)
  const tipo = tipoEnPalabras(datos.tipoCita)
  const enlace = `${config.pacAppUrl}/citas`

  const esManana = datos.antelacion === '24h'
  const asunto = esManana
    ? `Recordatorio: tu cita es mañana — ${marca.nombreClinica}`
    : `Tu cita es en una hora — ${marca.nombreClinica}`

  const cuerpo = [
    titulo(esManana ? 'Tu cita es mañana' : 'Tu cita es en una hora'),
    parrafo(
      `Hola <strong>${esc(datos.nombrePaciente)}</strong>, te recordamos tu cita de ` +
        `<strong>${esc(tipo)}</strong> en <strong>${esc(marca.nombreClinica)}</strong>:`,
    ),
    caja(
      [
        { etiqueta: 'Fecha', valor: m.fecha, destacado: true },
        { etiqueta: 'Hora', valor: m.hora, destacado: true },
      ],
      marca,
    ),
    boton(enlace, 'Ver mi cita', marca.colorPrimario),
    nota('Si no puedes asistir, avisa a tu nutricionista con antelación.'),
  ].join('\n')

  const r = await enviarCorreo({
    para: datos.correoPaciente,
    asunto,
    html: envoltorio(marca, cuerpo),
    texto:
      `Hola ${datos.nombrePaciente},\n\n` +
      `Te recordamos tu cita de ${tipo} en ${marca.nombreClinica}:\n` +
      `${m.completo}.\n\n` +
      `Puedes verla y confirmar tu asistencia en: ${enlace}\n\n` +
      `Si no puedes asistir, avisa a tu nutricionista con antelación.`,
    tipo: `recordatorio-${datos.antelacion}`,
  })

  // Se conserva la forma del resultado —{ ok, error }— porque
  // `recordatorios.ts` la anota en `recordatorio_cita.error`, y ahí
  // «sin_configurar» ya significaba algo.
  if (r === 'enviado') return { ok: true }
  return { ok: false, error: r === 'sin_configurar' ? 'sin_configurar' : 'fallo' }
}
