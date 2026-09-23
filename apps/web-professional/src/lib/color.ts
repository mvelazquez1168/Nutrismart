/**
 * Derivación de la paleta de marca a partir de un solo color.
 *
 * El administrador elige UN color. Pedirle tres coordinados es pedirle
 * que haga de diseñador, y el resultado habitual son combinaciones
 * ilegibles. De ese color salen el hover, el tinte de fondo y el halo
 * de foco.
 *
 * Se opera en HSL y no en RGB porque restar a cada canal desatura: un
 * verde intenso con un 12 % menos de cada componente sale gris verdoso,
 * no verde oscuro.
 *
 * Vive aparte de BrandContext para poder ejercitarse sin un DOM.
 */

export interface Hsl {
  /** 0..1 */
  h: number
  /** 0..1 */
  s: number
  /** 0..1 */
  l: number
}

export const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function esHex(valor: string): boolean {
  return HEX_RE.test(valor)
}

export function aHsl(hex: string): Hsl {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2

  if (max === min) return { h: 0, s: 0, l }

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6

  return { h, s, l }
}

function canal(p: number, q: number, t: number): number {
  let x = t
  if (x < 0) x += 1
  if (x > 1) x -= 1
  if (x < 1 / 6) return p + (q - p) * 6 * x
  if (x < 1 / 2) return q
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
  return p
}

export function aHex({ h, s, l }: Hsl): string {
  let r: number
  let g: number
  let b: number

  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = canal(p, q, h + 1 / 3)
    g = canal(p, q, h)
    b = canal(p, q, h - 1 / 3)
  }

  const dos = (n: number) =>
    Math.round(Math.min(1, Math.max(0, n)) * 255)
      .toString(16)
      .padStart(2, '0')

  return `#${dos(r)}${dos(g)}${dos(b)}`
}

/** Mueve la luminosidad manteniendo tono y saturación. */
export function ajustarLuz(hex: string, delta: number): string {
  const hsl = aHsl(hex)
  return aHex({ ...hsl, l: Math.min(1, Math.max(0, hsl.l + delta)) })
}

/**
 * Lleva el color a una luminosidad concreta, para el tinte de fondo.
 *
 * La saturación se recorta: un tinte muy claro pero saturado chilla
 * detrás de un texto, y el tinte es justo eso — fondo del elemento
 * activo del menú y de los badges.
 */
export function conLuz(hex: string, luz: number, saturacionMaxima = 0.45): string {
  const hsl = aHsl(hex)
  return aHex({ h: hsl.h, s: Math.min(hsl.s, saturacionMaxima), l: luz })
}

export function rgba(hex: string, alfa: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alfa})`
}

/**
 * Luminancia relativa (WCAG 2.1) y contraste. No se usan en tiempo de
 * ejecución para bloquear nada —la clínica manda sobre su marca— pero
 * permiten comprobar que la derivación no produce combinaciones
 * ilegibles para ningún color de partida.
 */
export function luminancia(hex: string): number {
  const canalLineal = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const r = canalLineal(parseInt(hex.slice(1, 3), 16))
  const g = canalLineal(parseInt(hex.slice(3, 5), 16))
  const b = canalLineal(parseInt(hex.slice(5, 7), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contraste(hexA: string, hexB: string): number {
  const a = luminancia(hexA)
  const b = luminancia(hexB)
  const claro = Math.max(a, b)
  const oscuro = Math.min(a, b)
  return (claro + 0.05) / (oscuro + 0.05)
}

/**
 * Fondo de la navegación: el color de marca, oscurecido lo justo.
 *
 * ── El problema ─────────────────────────────────────────────────────
 *
 * Desde que las barras se visten con el color de la clínica, ese color
 * pasa a ser el fondo de la navegación entera y el texto blanco encima
 * deja de ser gratis. Tres de las ocho paletas del propio design system
 * no llegan al 4.5:1 que pide WCAG AA para texto normal: teal-fresco
 * (3.68:1), esmeralda (3.77:1) y ámbar (3.19:1). Y la clínica puede
 * inyectar cualquier color, así que la lista no se cierra nunca.
 *
 * ── Por qué se toca el fondo y no la tinta ──────────────────────────
 *
 * Hay dos formas de arreglarlo: oscurecer el texto donde el blanco no
 * llega, o oscurecer el fondo hasta que llegue. Se elige la segunda.
 * Una barra de navegación que cambia de color de letra según la clínica
 * se lee como un fallo, y el texto blanco sobre color es lo que
 * cualquiera espera de una barra. Oscurecer el fondo mantiene el blanco
 * en todas partes y el tono de la marca intacto.
 *
 * ── Cómo ────────────────────────────────────────────────────────────
 *
 * Se escala hacia el negro en pasos del 2 % hasta alcanzar el contraste.
 * Escalar los tres canales por el mismo factor conserva el TONO exacto
 * —lo que define el tono son las proporciones entre canales, y una
 * multiplicación no las cambia—, a diferencia de restar una cantidad
 * fija a cada uno, que desatura. Termina siempre: en el peor caso llega
 * al negro, que contrasta 21:1.
 *
 * En la práctica apenas se nota. Cinco de las ocho paletas salen
 * intactas; teal pasa de #0891B2 a #07809D. Solo un color de partida muy
 * claro cambia de verdad —un amarillo #FFE066 acaba en un oliva—, y ahí
 * no hay alternativa: sobre amarillo claro el blanco no se lee.
 */
const CONTRASTE_MINIMO = 4.5

function escalar(hex: string, k: number): string {
  const dos = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0')
  const r = parseInt(hex.slice(1, 3), 16) * k
  const g = parseInt(hex.slice(3, 5), 16) * k
  const b = parseInt(hex.slice(5, 7), 16) * k
  return `#${dos(r)}${dos(g)}${dos(b)}`
}

export function fondoNav(colorPrimario: string): string {
  for (let k = 1; k > 0.04; k -= 0.02) {
    const candidato = escalar(colorPrimario, k)
    if (contraste('#FFFFFF', candidato) >= CONTRASTE_MINIMO) return candidato
  }
  return '#000000'
}

/** Los valores que BrandContext escribe en :root. */
export interface PaletaMarca {
  primary: string
  primaryHover: string
  primaryTint: string
  ring: string
  /** Fondo de las barras de navegación. Ver fondoNav(). */
  nav: string
}

export function derivarPaleta(colorPrimario: string): PaletaMarca {
  return {
    primary: colorPrimario,
    primaryHover: ajustarLuz(colorPrimario, -0.12),
    primaryTint: conLuz(colorPrimario, 0.93),
    ring: rgba(colorPrimario, 0.35),
    nav: fondoNav(colorPrimario),
  }
}
