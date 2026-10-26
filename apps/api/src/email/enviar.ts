/**
 * El único sitio que habla con Resend — R54.
 *
 * Antes había cuatro clientes de Resend construidos por separado —uno
 * en `pac/email.ts`, otro en `equipo/email.ts`, otro en
 * `agenda/email-recordatorio.ts` y otro en `rpm/email-alerta.ts`— con
 * su propio manejo de «no hay clave» y su propio formato de log. Cuatro
 * sitios que arreglar cada vez que cambia algo del envío.
 *
 * El comportamiento sin `RESEND_API_KEY` se conserva tal cual, porque
 * es una decisión del proyecto y no un descuido: el aviso sale por
 * consola y **el proceso sigue**. Un fallo de correo no detiene nada;
 * en desarrollo no hay clave y todo tiene que funcionar igual, y en
 * producción una invitación que no se envía se puede copiar y entregar
 * por otra vía.
 */
import { Resend } from 'resend'
import { config } from '../config.js'

/**
 * Tres desenlaces y no un booleano.
 *
 * «No hay correo configurado» y «el envío falló» piden cosas distintas
 * a quien llama —y al profesional que lo lee en pantalla—. Decir lo
 * primero cuando pasó lo segundo le hace buscar el problema donde no
 * está. Viene de `pac/email.ts`, donde ya se había aprendido.
 */
export type ResultadoEnvio = 'enviado' | 'sin_configurar' | 'fallo'

const cliente = config.resend ? new Resend(config.resend.apiKey) : null

export const correoConfigurado = (): boolean => cliente !== null

export interface Correo {
  para: string
  asunto: string
  html: string
  /**
   * La versión en texto plano.
   *
   * No es opcional por capricho: un correo solo-HTML puntúa peor en los
   * filtros de spam, y hay quien lee el correo en texto. Además es lo
   * que se imprime en consola cuando no hay clave, así que escribirla
   * obliga a que el modo desarrollo enseñe algo útil.
   */
  texto: string
  /** Para los logs. Ej. 'cita-confirmada'. */
  tipo: string
}

export async function enviarCorreo(correo: Correo): Promise<ResultadoEnvio> {
  if (!cliente) {
    console.log('─'.repeat(64))
    console.log(`[email] RESEND_API_KEY sin configurar — modo consola (${correo.tipo})`)
    console.log(`[email] Para: ${correo.para}`)
    console.log(`[email] Asunto: ${correo.asunto}`)
    console.log(correo.texto)
    console.log('─'.repeat(64))
    return 'sin_configurar'
  }

  try {
    const { error } = await cliente.emails.send({
      from: config.resend!.from,
      to: correo.para,
      subject: correo.asunto,
      text: correo.texto,
      html: correo.html,
    })

    if (error) {
      console.error(`[email] Resend rechazó ${correo.tipo}:`, error.name, error.message)
      return 'fallo'
    }
    return 'enviado'
  } catch (e) {
    // La red se cae, Resend tarda, el DNS falla. Se registra y se
    // devuelve 'fallo': que esta función LANCE obligaría a envolver en
    // try/catch cada uno de los sitios que manda un correo, y basta
    // olvidarse en uno para tumbar una operación clínica por un aviso.
    console.error(`[email] excepción enviando ${correo.tipo}:`, e)
    return 'fallo'
  }
}
