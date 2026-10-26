/**
 * La paleta de color que elige el paciente — R53.
 *
 * ## Por qué sobrescribe a la marca de la clínica
 *
 * `asegurarMarca()` (lib/marca.ts) ya pinta `--primary` y `--nav` con el
 * `color_primario` de `brand_config`. Esta paleta se aplica DESPUÉS y
 * gana, pero solo en la app del paciente: es su teléfono y es él quien
 * mira la pantalla todos los días. La app profesional sigue siendo la de
 * la clínica sin excepción.
 *
 * Sin elección del paciente —`paleta_color` por defecto es 'verde', que
 * es el color de fábrica de NutriSmart— no se toca nada y manda la
 * marca. Es decir: la clínica pone el color de salida, el paciente puede
 * cambiarlo para sí.
 *
 * ## Por qué diez cerradas y no un selector libre
 *
 * Todo el texto sobre `--primary` es blanco (`--on-primary`). Con un
 * color arbitrario el paciente puede elegir amarillo y dejar la app
 * ilegible. Estas diez están contrastadas.
 */

export interface Paleta {
  primary: string
  hover: string
  tint: string
}

export const PALETAS = {
  verde: { primary: '#0E7C66', hover: '#0A5C4C', tint: '#E7F1EE' },
  'azul-oceano': { primary: '#2563EB', hover: '#1D4ED8', tint: '#EFF6FF' },
  'azul-cielo': { primary: '#0284C7', hover: '#0369A1', tint: '#E0F2FE' },
  turquesa: { primary: '#0891B2', hover: '#0E7490', tint: '#ECFEFF' },
  indigo: { primary: '#4F46E5', hover: '#4338CA', tint: '#EEF2FF' },
  violeta: { primary: '#7C3AED', hover: '#6D28D9', tint: '#F5F3FF' },
  rosa: { primary: '#DB2777', hover: '#BE185D', tint: '#FDF2F8' },
  naranja: { primary: '#EA580C', hover: '#C2410C', tint: '#FFF7ED' },
  rojo: { primary: '#DC2626', hover: '#B91C1C', tint: '#FEF2F2' },
  gris: { primary: '#475569', hover: '#334155', tint: '#F8FAFC' },
} as const satisfies Record<string, Paleta>

export type ClavePaleta = keyof typeof PALETAS

export const PALETAS_LISTA: { clave: ClavePaleta; etiqueta: string }[] = [
  { clave: 'verde', etiqueta: 'Verde' },
  { clave: 'azul-oceano', etiqueta: 'Azul océano' },
  { clave: 'azul-cielo', etiqueta: 'Azul cielo' },
  { clave: 'turquesa', etiqueta: 'Turquesa' },
  { clave: 'indigo', etiqueta: 'Índigo' },
  { clave: 'violeta', etiqueta: 'Violeta' },
  { clave: 'rosa', etiqueta: 'Rosa' },
  { clave: 'naranja', etiqueta: 'Naranja' },
  { clave: 'rojo', etiqueta: 'Rojo' },
  { clave: 'gris', etiqueta: 'Gris' },
]

export const ES_PALETA = (v: unknown): v is ClavePaleta =>
  typeof v === 'string' && v in PALETAS

const CLAVE_CACHE = 'nutrismart_paleta'

/**
 * «Verde» significa «no he elegido».
 *
 * Es el valor por defecto de la columna (migración 059) y es además el
 * verde de fábrica de NutriSmart. Tratarlo como una elección rompería
 * el white-label: una clínica con marca morada vería a todos sus
 * pacientes en verde desde el primer día, sin que nadie hubiera tocado
 * nada.
 *
 * El precio es un caso raro y asumido: un paciente de una clínica
 * morada no puede elegir exactamente este verde —le quedaría el morado
 * de su clínica—. A cambio, el white-label, que es regla no negociable,
 * sigue en pie.
 */
const SIN_ELEGIR: ClavePaleta = 'verde'

/**
 * Si el paciente eligió color, `aplicarMarca()` deja de pisar
 * `--primary`.
 *
 * Las dos funciones escriben la misma variable en `<html>` y llegan de
 * peticiones distintas: sin esto gana la que conteste más tarde, que es
 * una carrera y se nota como un parpadeo de color al abrir la app.
 */
let eleccionExplicita = false

export function hayPaletaElegida(): boolean {
  return eleccionExplicita
}

/**
 * El degradado de la barra inferior.
 *
 * `--nav` lo fija también `aplicarMarca()`. Se vuelve a escribir aquí
 * porque si solo se cambiara `--primary`, la barra se quedaría del color
 * de la clínica y la pantalla tendría dos colores de acción distintos.
 */
export function aplicarPaleta(clave: ClavePaleta): void {
  if (clave !== SIN_ELEGIR) eleccionExplicita = true
  const p = PALETAS[clave] ?? PALETAS.verde
  const root = document.documentElement
  root.style.setProperty('--primary', p.primary)
  root.style.setProperty('--primary-hover', p.hover)
  root.style.setProperty('--primary-tint', p.tint)
  root.style.setProperty('--nav', p.primary)
  root.style.setProperty('--ring', `${p.primary}59`)
}

/**
 * Lo elegido la última vez, antes de que conteste el servidor.
 *
 * Sin esto la app arranca verde y da un salto de color en cuanto llega
 * el perfil. Es el mismo problema que resuelve `aplicarFondo` al
 * arrancar, y la misma solución.
 */
export function aplicarPaletaCacheada(): void {
  try {
    const v = localStorage.getItem(CLAVE_CACHE)
    if (ES_PALETA(v)) aplicarPaleta(v)
  } catch {
    /* modo privado de Safari: sin caché, se ve el salto y ya está */
  }
}

/**
 * Aplica la paleta del perfil, si el paciente llegó a elegir una.
 *
 * Es el único punto por el que debería entrar una paleta venida del
 * servidor: encapsula la regla de que «verde» es «sin elegir» para que
 * no haya que repetirla en cada sitio que publique el perfil.
 */
export function aplicarPaletaDelPerfil(paleta: string): void {
  if (!ES_PALETA(paleta) || paleta === SIN_ELEGIR) return
  aplicarPaleta(paleta)
  recordarPaleta(paleta)
}

/**
 * Deshace la elección y deja paso otra vez a la marca de la clínica.
 *
 * Quitar las propiedades en línea no basta por sí solo —habría que
 * volver a aplicar la marca, y de eso se encarga quien llama—, pero sin
 * quitarlas el color elegido se quedaría pegado: `setProperty` en
 * `<html>` gana a cualquier regla de la hoja de estilos.
 */
export function restablecerPaleta(): void {
  eleccionExplicita = false
  const root = document.documentElement
  for (const v of ['--primary', '--primary-hover', '--primary-tint', '--nav', '--ring']) {
    root.style.removeProperty(v)
  }
  try {
    localStorage.removeItem(CLAVE_CACHE)
  } catch {
    /* sin caché que limpiar */
  }
}

export function recordarPaleta(clave: ClavePaleta): void {
  try {
    localStorage.setItem(CLAVE_CACHE, clave)
  } catch {
    /* igual que arriba: no poder cachear no es un error que contar */
  }
}
