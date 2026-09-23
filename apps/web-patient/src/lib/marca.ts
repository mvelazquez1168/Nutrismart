/**
 * El color de la clínica, aplicado a toda la app del paciente.
 *
 * ── Por qué existe este archivo ─────────────────────────────────────
 *
 * El color ya se aplicaba, pero solo en Inicio: era la única pantalla
 * que pedía `/api/paciente/yo`. Mientras el primario se usaba en botones
 * y acentos sueltos, la diferencia pasaba desapercibida. Desde que la
 * barra de navegación se viste con él (APP-BRAND-01) deja de pasar: la
 * barra saldría con el color de la clínica en Inicio y con el verde por
 * defecto en Plan, Citas o Mensajes. Se aplica una vez, en cuanto hay
 * sesión, y vale para las ocho pantallas.
 *
 * El cálculo del fondo se repite aquí en lugar de compartirlo con la
 * app profesional: son dos bundles independientes, y subirlo al design
 * system obligaría a que el paquete dejara de ser CSS + preset y pasara
 * a compilar TypeScript. Cuando haya una tercera app que lo necesite,
 * ese será el momento.
 */
import { getYo } from './api'

function luminancia(hex: string): number {
  const canal = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const r = canal(parseInt(hex.slice(1, 3), 16))
  const g = canal(parseInt(hex.slice(3, 5), 16))
  const b = canal(parseInt(hex.slice(5, 7), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contraste(a: string, b: string): number {
  const la = luminancia(a)
  const lb = luminancia(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Fondo de la barra de navegación: el color de marca, oscurecido lo
 * justo para que el blanco de encima llegue a 4.5:1 (WCAG AA).
 *
 * Se oscurece el fondo en vez de la letra a propósito. La alternativa
 * —poner texto oscuro donde el blanco no llega— hace que la barra
 * cambie de color de letra según la clínica, y eso se lee como un
 * fallo. Tres de las ocho paletas del design system lo necesitan:
 * teal-fresco (3.68:1), esmeralda (3.77:1) y ámbar (3.19:1). Las otras
 * cinco salen intactas.
 *
 * Escalar los tres canales por el mismo factor conserva el tono exacto:
 * lo que define el tono son las proporciones entre canales, y una
 * multiplicación no las cambia. Restar una cantidad fija a cada uno, en
 * cambio, desatura.
 *
 * Es la misma regla que `fondoNav()` en `web-professional/lib/color.ts`.
 * Se repite aquí por lo dicho arriba: dos bundles independientes.
 */
const CONTRASTE_MINIMO = 4.5

function escalar(hex: string, k: number): string {
  const dos = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0')
  return `#${dos(parseInt(hex.slice(1, 3), 16) * k)}${dos(
    parseInt(hex.slice(3, 5), 16) * k,
  )}${dos(parseInt(hex.slice(5, 7), 16) * k)}`
}

export function fondoNav(colorPrimario: string): string {
  for (let k = 1; k > 0.04; k -= 0.02) {
    const candidato = escalar(colorPrimario, k)
    if (contraste('#FFFFFF', candidato) >= CONTRASTE_MINIMO) return candidato
  }
  return '#000000'
}

const HEX = /^#[0-9a-fA-F]{6}$/

/** Escribe las variables en `<html>`. Sin color válido, no toca nada. */
export function aplicarMarca(colorPrimario: string | null | undefined): void {
  if (!colorPrimario || !HEX.test(colorPrimario)) return
  const root = document.documentElement
  root.style.setProperty('--primary', colorPrimario)
  root.style.setProperty('--nav', fondoNav(colorPrimario))
}

/**
 * Una sola petición, aunque monten varias pantallas.
 *
 * Mismo patrón que `usePerfil`: la promesa se guarda a nivel de módulo.
 * Un fallo no se propaga — que la app se quede con el color por defecto
 * es un detalle visual, y no hay motivo para que tumbe una pantalla.
 */
let pedido: Promise<void> | null = null

export function asegurarMarca(): void {
  pedido ??= getYo()
    .then((yo) => aplicarMarca(yo.clinica.colorPrimario))
    .catch(() => undefined)
}
