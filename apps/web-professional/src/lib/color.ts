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

/** Los cuatro valores que BrandContext escribe en :root. */
export interface PaletaMarca {
  primary: string
  primaryHover: string
  primaryTint: string
  ring: string
}

export function derivarPaleta(colorPrimario: string): PaletaMarca {
  return {
    primary: colorPrimario,
    primaryHover: ajustarLuz(colorPrimario, -0.12),
    primaryTint: conLuz(colorPrimario, 0.93),
    ring: rgba(colorPrimario, 0.35),
  }
}
