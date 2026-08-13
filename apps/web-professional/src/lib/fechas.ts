/**
 * Fechas y horas en el huso del NAVEGADOR.
 *
 * La API entrega los instantes en UTC crudo (`2026-08-15T21:00:00.000Z`)
 * a propósito: el servidor no conoce el huso del profesional, así que
 * formatear allí produciría "21:00" para una cita que en su agenda son
 * las 15:00. Toda la conversión ocurre aquí.
 *
 * Ojo con la distinción:
 *  · Los INSTANTES (inicio, fin de cita) son timestamptz y se convierten.
 *  · Las FECHAS SIN HORA (fecha de un control, nacimiento) llegan como
 *    'YYYY-MM-DD' y NO se pasan por Date: interpretarlas como UTC las
 *    mostraría un día antes en husos al oeste de Greenwich.
 */

const LOCALE = 'es-CR'

/** '2026-08-15T21:00:00.000Z' -> '15:00' en hora local. */
export function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
}

/** Rango de una cita: '15:00 – 16:00'. */
export function rangoHoras(inicio: string, fin: string): string {
  return `${hora(inicio)} – ${hora(fin)}`
}

/** 'sábado, 15 de agosto de 2026' en hora local. */
export function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Clave de agrupación por día, en hora LOCAL.
 *
 * No vale `iso.slice(0,10)`: una cita de las 19:00 en Costa Rica es el
 * día siguiente en UTC, y agrupar por la cadena cruda la colocaría bajo
 * la fecha equivocada.
 */
export function claveDia(iso: string): string {
  const d = new Date(iso)
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

/** Valor para un <input type="datetime-local">, que trabaja en hora local sin offset. */
export function paraInputLocal(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * Lo que escribe el usuario en un datetime-local -> ISO con instante.
 *
 * `new Date('2026-08-15T15:00')` sin offset se interpreta en hora LOCAL,
 * que es justo lo que el usuario quiso decir. toISOString() lo convierte
 * al instante UTC que espera la API.
 */
export function desdeInputLocal(valor: string): string {
  return new Date(valor).toISOString()
}

/** Ahora mismo, con el formato del input. */
export function ahoraInputLocal(): string {
  return paraInputLocal(new Date().toISOString())
}

/** 'YYYY-MM-DD' local, para los filtros de rango por día. */
export function hoyLocal(): string {
  return claveDia(new Date().toISOString())
}

/** Suma días a un 'YYYY-MM-DD' sin pasar por UTC. */
export function sumarDias(fechaLocal: string, dias: number): string {
  const [a, m, d] = fechaLocal.split('-').map(Number)
  const fecha = new Date(a ?? 1970, (m ?? 1) - 1, d ?? 1)
  fecha.setDate(fecha.getDate() + dias)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}`
}

/**
 * 'YYYY-MM-DD' local -> instante ISO del inicio de ese día en local.
 * Es lo que la API espera en `desde` y `hasta`.
 */
export function inicioDelDiaISO(fechaLocal: string): string {
  const [a, m, d] = fechaLocal.split('-').map(Number)
  return new Date(a ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).toISOString()
}

/** Etiqueta corta para las cabeceras de día: 'Hoy', 'Mañana' o la fecha. */
export function etiquetaDia(claveLocal: string): string {
  const hoy = hoyLocal()
  if (claveLocal === hoy) return 'Hoy'
  if (claveLocal === sumarDias(hoy, 1)) return 'Mañana'

  const [a, m, d] = claveLocal.split('-').map(Number)
  return new Date(a ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}
