/**
 * Los fondos que puede elegir el paciente — PAC-09.
 *
 * Aquí solo hay CLAVES y ETIQUETAS. Ni un color.
 *
 * Los colores viven en `packages/design-system/tokens.css`, en bloques
 * `[data-fondo="…"]`, con el mismo mecanismo que las paletas de marca.
 * Es lo que exige la regla del proyecto —«white-label por tokens: nunca
 * hardcodees colores»— y tiene una consecuencia práctica: el selector de
 * abajo se pinta leyendo las variables del propio tema, así que si
 * mañana se retoca un verde, el selector lo refleja solo.
 *
 * El fondo NO toca `--primary`. La marca es de la clínica y el fondo es
 * del paciente: si el fondo pisara la marca, elegir «Calma» convertiría
 * una clínica esmeralda en una azul.
 */
export const FONDOS = [
  { clave: 'neutro', etiqueta: 'Natural' },
  { clave: 'verde', etiqueta: 'Verde salud' },
  { clave: 'azul', etiqueta: 'Calma' },
  { clave: 'morado', etiqueta: 'Bienestar' },
  { clave: 'salmon', etiqueta: 'Energía' },
  { clave: 'cafe', etiqueta: 'Tierra' },
  { clave: 'noche', etiqueta: 'Oscuro' },
] as const

export type Fondo = (typeof FONDOS)[number]['clave']

export const ES_FONDO = (v: string): v is Fondo =>
  FONDOS.some((f) => f.clave === v)

/**
 * Aplica el tema al documento.
 *
 * Un atributo en `<html>`, exactamente como `data-brand`. Toda la app
 * cambia sin que ninguna pantalla tenga que enterarse: las siete usan
 * `bg-background`, y el tema redefine ese token.
 */
export function aplicarFondo(fondo: Fondo): void {
  document.documentElement.setAttribute('data-fondo', fondo)
}
