/**
 * Los avisos de agenda y cumpleaños — R54.
 *
 * Cada función hace lo mismo: lee la marca de la clínica, arma el
 * correo en HTML y en texto, y lo manda. Nada de esto lanza: todas
 * devuelven `ResultadoEnvio` y quien llama puede ignorarlo.
 *
 * ## El HTML y el texto se escriben juntos
 *
 * Podrían estar en un `plantillas.ts` aparte, pero entonces las dos
 * versiones del mismo correo viven en archivos distintos y se van
 * separando: se corrige una frase en el HTML y el texto sigue diciendo
 * lo de antes. Aquí están una debajo de la otra.
 *
 * ## Quién recibe qué
 *
 * El paciente recibe lo que le afecta a él —su cita— y el profesional
 * lo que le cambia la agenda. Un mismo hecho manda dos correos
 * distintos, con el detalle que le importa a cada uno: al paciente le
 * importa el nutricionista, al nutricionista le importa el paciente.
 */
import { enviarCorreo, type ResultadoEnvio } from './enviar.js'
import { boton, caja, envoltorio, esc, nota, parrafo, titulo } from './layout.js'
import { obtenerMarca, type Marca } from './marca.js'
import { config } from '../config.js'

/* ------------------------------------------------------------------ */
/* Fechas                                                              */
/* ------------------------------------------------------------------ */

/** Los tipos de cita, en palabras. Los mismos de `email-recordatorio`. */
const TIPO_CITA: Record<string, string> = {
  primera_vez: 'primera consulta',
  seguimiento: 'seguimiento',
  control: 'control',
  urgencia: 'urgencia',
}

export function tipoEnPalabras(tipo: string): string {
  return TIPO_CITA[tipo] ?? tipo
}

interface Momento {
  fecha: string
  hora: string
  completo: string
}

/** Formatea un instante en la zona horaria de la clínica. */
export function momento(iso: string | Date, zona: string): Momento {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const base: Intl.DateTimeFormatOptions = { timeZone: zona }
  const fecha = d.toLocaleDateString('es-CR', {
    ...base,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const hora = d.toLocaleTimeString('es-CR', { ...base, hour: '2-digit', minute: '2-digit' })
  return { fecha, hora, completo: `${fecha} a las ${hora}` }
}

/* ------------------------------------------------------------------ */
/* Datos comunes                                                       */
/* ------------------------------------------------------------------ */

export interface DatosCita {
  clinicaId: string
  pacienteCorreo: string | null
  pacienteNombre: string
  profesionalCorreo: string | null
  profesionalNombre: string
  /** ISO. */
  inicio: string
  tipo: string
  /** ISO. Solo en un reagendamiento. */
  inicioAnterior?: string
  motivo?: string | null
}

const urlCitasPaciente = () => `${config.pacAppUrl}/citas`
const urlAgendaProfesional = () => `${config.frontendProUrl}/agenda`

/**
 * Sin dirección no hay correo, y no es un error.
 *
 * `paciente.correo` es opcional en el expediente: hay pacientes que no
 * lo dan. Tratarlo como fallo llenaría los logs de ruido por algo que
 * es normal.
 */
function sinDestinatario(correo: string | null | undefined): correo is null {
  return typeof correo !== 'string' || correo.trim() === ''
}

/* ------------------------------------------------------------------ */
/* Paciente                                                            */
/* ------------------------------------------------------------------ */

export async function avisarCitaAgendada(d: DatosCita): Promise<ResultadoEnvio> {
  if (sinDestinatario(d.pacienteCorreo)) return 'sin_configurar'
  const marca = await obtenerMarca(d.clinicaId)
  const m = momento(d.inicio, marca.zonaHoraria)
  const tipo = tipoEnPalabras(d.tipo)

  const cuerpo = [
    titulo('Tu cita está agendada'),
    parrafo(`Hola <strong>${esc(d.pacienteNombre)}</strong>, tu cita quedó registrada:`),
    caja(
      [
        { etiqueta: 'Profesional', valor: d.profesionalNombre },
        { etiqueta: 'Tipo', valor: tipo },
        { etiqueta: 'Fecha', valor: m.fecha, destacado: true },
        { etiqueta: 'Hora', valor: m.hora, destacado: true },
      ],
      marca,
    ),
    boton(urlCitasPaciente(), 'Ver mi cita', marca.colorPrimario),
    nota('Si no puedes asistir, avisa a tu nutricionista con antelación.'),
  ].join('\n')

  return enviarCorreo({
    para: d.pacienteCorreo,
    asunto: `Cita agendada: ${m.fecha} — ${marca.nombreClinica}`,
    html: envoltorio(marca, cuerpo),
    texto:
      `Hola ${d.pacienteNombre},\n\n` +
      `Tu cita de ${tipo} en ${marca.nombreClinica} quedó agendada:\n` +
      `${m.completo}\n` +
      `Profesional: ${d.profesionalNombre}\n\n` +
      `Puedes verla en: ${urlCitasPaciente()}\n\n` +
      `Si no puedes asistir, avisa a tu nutricionista con antelación.`,
    tipo: 'cita-agendada',
  })
}

export async function avisarCitaCancelada(d: DatosCita): Promise<ResultadoEnvio> {
  if (sinDestinatario(d.pacienteCorreo)) return 'sin_configurar'
  const marca = await obtenerMarca(d.clinicaId)
  const m = momento(d.inicio, marca.zonaHoraria)

  const cuerpo = [
    titulo('Tu cita ha sido cancelada'),
    parrafo(
      `Hola <strong>${esc(d.pacienteNombre)}</strong>, te avisamos de que esta cita ya no se mantiene:`,
    ),
    caja(
      [
        { etiqueta: 'Profesional', valor: d.profesionalNombre },
        { etiqueta: 'Fecha', valor: m.fecha },
        { etiqueta: 'Hora', valor: m.hora },
        { etiqueta: 'Motivo', valor: d.motivo ?? '' },
      ],
      marca,
    ),
    parrafo('Habla con tu clínica para buscar una fecha nueva.'),
    boton(urlCitasPaciente(), 'Ver mis citas', marca.colorPrimario),
  ].join('\n')

  return enviarCorreo({
    para: d.pacienteCorreo,
    asunto: `Cita cancelada: ${m.fecha} — ${marca.nombreClinica}`,
    html: envoltorio(marca, cuerpo),
    texto:
      `Hola ${d.pacienteNombre},\n\n` +
      `Tu cita en ${marca.nombreClinica} del ${m.completo} ha sido cancelada.\n` +
      `Profesional: ${d.profesionalNombre}\n` +
      (d.motivo ? `Motivo: ${d.motivo}\n` : '') +
      `\nHabla con tu clínica para buscar una fecha nueva.\n` +
      `Tus citas: ${urlCitasPaciente()}`,
    tipo: 'cita-cancelada',
  })
}

export async function avisarCitaReagendada(d: DatosCita): Promise<ResultadoEnvio> {
  if (sinDestinatario(d.pacienteCorreo)) return 'sin_configurar'
  if (!d.inicioAnterior) return 'fallo'
  const marca = await obtenerMarca(d.clinicaId)
  const antes = momento(d.inicioAnterior, marca.zonaHoraria)
  const ahora = momento(d.inicio, marca.zonaHoraria)

  const cuerpo = [
    titulo('Tu cita cambió de fecha'),
    parrafo(`Hola <strong>${esc(d.pacienteNombre)}</strong>, tu cita se movió:`),
    caja(
      [
        { etiqueta: 'Profesional', valor: d.profesionalNombre },
        { etiqueta: 'Antes', valor: antes.completo },
        { etiqueta: 'Ahora', valor: ahora.completo, destacado: true },
      ],
      marca,
    ),
    boton(urlCitasPaciente(), 'Ver mi cita', marca.colorPrimario),
    nota('Si la nueva fecha no te sirve, avisa a tu nutricionista.'),
  ].join('\n')

  return enviarCorreo({
    para: d.pacienteCorreo,
    asunto: `Tu cita cambió al ${ahora.fecha} — ${marca.nombreClinica}`,
    html: envoltorio(marca, cuerpo),
    texto:
      `Hola ${d.pacienteNombre},\n\n` +
      `Tu cita en ${marca.nombreClinica} cambió de fecha.\n` +
      `Antes: ${antes.completo}\n` +
      `Ahora: ${ahora.completo}\n` +
      `Profesional: ${d.profesionalNombre}\n\n` +
      `Puedes verla en: ${urlCitasPaciente()}\n\n` +
      `Si la nueva fecha no te sirve, avisa a tu nutricionista.`,
    tipo: 'cita-reagendada',
  })
}

/**
 * Felicitación de cumpleaños.
 *
 * Es el único correo de esta tanda que no responde a una acción: nadie
 * lo pidió. Por eso no lleva nada que empuje a hacer algo —ni un botón
 * a la app, ni una oferta— más allá de la felicitación. Un correo de
 * cumpleaños que acaba vendiendo consultas es un correo comercial con
 * tarta.
 */
export async function felicitarCumpleanos(d: {
  clinicaId: string
  correo: string | null
  nombre: string
}): Promise<ResultadoEnvio> {
  if (sinDestinatario(d.correo)) return 'sin_configurar'
  const marca = await obtenerMarca(d.clinicaId)
  const nombrePila = d.nombre.trim().split(/\s+/)[0] ?? d.nombre

  const cuerpo = [
    titulo(`¡Feliz cumpleaños, ${nombrePila}!`),
    parrafo(
      `En <strong>${esc(marca.nombreClinica)}</strong> te deseamos un día estupendo y un año lleno de salud.`,
    ),
    parrafo('Gracias por confiarnos tu bienestar.'),
  ].join('\n')

  return enviarCorreo({
    para: d.correo,
    asunto: `¡Feliz cumpleaños, ${nombrePila}!`,
    html: envoltorio(marca, cuerpo),
    texto:
      `¡Feliz cumpleaños, ${nombrePila}!\n\n` +
      `En ${marca.nombreClinica} te deseamos un día estupendo y un año lleno de salud.\n` +
      `Gracias por confiarnos tu bienestar.`,
    tipo: 'cumpleanos',
  })
}

/* ------------------------------------------------------------------ */
/* Profesional                                                         */
/* ------------------------------------------------------------------ */

export type CambioAgenda = 'agendada' | 'cancelada' | 'reagendada'

export async function avisarAgendaProfesional(
  d: DatosCita & { cambio: CambioAgenda },
): Promise<ResultadoEnvio> {
  if (sinDestinatario(d.profesionalCorreo)) return 'sin_configurar'
  const marca = await obtenerMarca(d.clinicaId)
  const m = momento(d.inicio, marca.zonaHoraria)
  const antes = d.inicioAnterior ? momento(d.inicioAnterior, marca.zonaHoraria) : null

  const titulos: Record<CambioAgenda, string> = {
    agendada: 'Nueva cita en tu agenda',
    cancelada: 'Se canceló una cita',
    reagendada: 'Una cita cambió de fecha',
  }

  const filas = [
    { etiqueta: 'Paciente', valor: d.pacienteNombre },
    { etiqueta: 'Tipo', valor: tipoEnPalabras(d.tipo) },
    ...(antes ? [{ etiqueta: 'Antes', valor: antes.completo }] : []),
    {
      etiqueta: d.cambio === 'cancelada' ? 'Fecha cancelada' : antes ? 'Ahora' : 'Fecha',
      valor: m.completo,
      destacado: d.cambio !== 'cancelada',
    },
    { etiqueta: 'Motivo', valor: d.cambio === 'cancelada' ? (d.motivo ?? '') : '' },
  ]

  const cuerpo = [
    titulo(titulos[d.cambio]),
    parrafo(`Hola <strong>${esc(d.profesionalNombre)}</strong>, hay un cambio en tu agenda:`),
    caja(filas, marca),
    boton(urlAgendaProfesional(), 'Abrir mi agenda', marca.colorPrimario),
  ].join('\n')

  const resumen =
    d.cambio === 'reagendada' && antes
      ? `Antes: ${antes.completo}\nAhora: ${m.completo}`
      : `Fecha: ${m.completo}`

  return enviarCorreo({
    para: d.profesionalCorreo,
    asunto: `${titulos[d.cambio]}: ${d.pacienteNombre} — ${m.fecha}`,
    html: envoltorio(marca, cuerpo),
    texto:
      `Hola ${d.profesionalNombre},\n\n` +
      `${titulos[d.cambio]}.\n` +
      `Paciente: ${d.pacienteNombre}\n` +
      `${resumen}\n` +
      (d.cambio === 'cancelada' && d.motivo ? `Motivo: ${d.motivo}\n` : '') +
      `\nTu agenda: ${urlAgendaProfesional()}`,
    tipo: `agenda-${d.cambio}`,
  })
}

/* ------------------------------------------------------------------ */
/* Disparo en segundo plano                                            */
/* ------------------------------------------------------------------ */

/**
 * Lanza un aviso sin que su resultado afecte a la petición en curso.
 *
 * Esta es la regla de R54 en una función: **un fallo de correo no debe
 * hacer fallar la operación principal**. Agendar una cita que queda
 * guardada pero devuelve 500 porque Resend tardó es mucho peor que una
 * cita agendada sin aviso.
 *
 * El `void` y el `.catch` son los dos necesarios: sin el catch, una
 * promesa rechazada sin manejar tumba el proceso de Node.
 */
export function enSegundoPlano(
  promesa: Promise<ResultadoEnvio>,
  contexto: string,
  log?: { error: (o: unknown, m: string) => void },
): void {
  void promesa.catch((e) => {
    if (log) log.error({ err: e }, `[email] ${contexto}`)
    else console.error(`[email] ${contexto}:`, e)
  })
}
