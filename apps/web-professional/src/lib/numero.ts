/**
 * Lógica de los campos numéricos — R46.
 *
 * Vive aparte del componente (`components/InputNumero.tsx`) porque es
 * pura y así se puede ejecutar sin navegador: `docs/PRUEBAS.md` la
 * comprueba caso a caso.
 *
 * Tres piezas, y el reparto entre ellas es lo importante:
 *   · `limpiar`    — en cada tecla. Filtra, pero DEJA PASAR los estados
 *                    a medias («5.», «-», ''). No acota ni redondea.
 *   · `mover`      — al pulsar una flecha. Acota, porque el valor que
 *                    produce está terminado.
 *   · `normalizar` — al perder el foco. Redondea y acota.
 *
 * Acotar mientras se escribe es hostil: en un campo de 0 a 21, el «1» de
 * quien va a escribir «10» se convertiría en otra cosa.
 */

/** Límites y formato de un campo. */
export interface Rango {
  min?: number | undefined
  max?: number | undefined
  decimales?: boolean | undefined
}

/**
 * Filtra lo escrito dejando pasar los valores a medias.
 *
 * Devuelve siempre algo que se puede seguir escribiendo. Es lo que
 * `type="number"` NO hace: ante «5.» su `value` es la cadena vacía, y un
 * campo controlado que recibe '' reescribe el nodo, mueve el caret y en
 * una tablet cierra el teclado.
 */
export function limpiar(
  texto: string,
  { decimales, negativos }: { decimales: boolean; negativos: boolean },
): string {
  // La coma es el separador decimal del teclado español; se acepta y se
  // guarda como punto, que es lo que entiende Number(). En un campo sin
  // decimales el filtro de abajo se lleva el punto igualmente.
  const t = texto.replace(/\s/g, '').replace(/,/g, '.')
  const signo = negativos && t.startsWith('-') ? '-' : ''
  let cuerpo = (signo ? t.slice(1) : t).replace(decimales ? /[^0-9.]/g : /[^0-9]/g, '')
  if (decimales) {
    // Un solo separador: los siguientes se descartan.
    const i = cuerpo.indexOf('.')
    if (i !== -1) cuerpo = cuerpo.slice(0, i + 1) + cuerpo.slice(i + 1).replace(/\./g, '')
  }
  return signo + cuerpo
}

/** Redondea si el campo es entero y mete el número entre min y max. */
export function acotar(n: number, { min, max, decimales = false }: Rango): number {
  let v = decimales ? n : Math.round(n)
  if (min !== undefined && v < min) v = min
  if (max !== undefined && v > max) v = max
  // Los pasos decimales arrastran error binario (0.1 + 0.2 = 0.30000000000000004).
  return decimales ? Math.round(v * 1e6) / 1e6 : v
}

/**
 * El valor tras pulsar una flecha.
 *
 * Desde vacío se parte de 0 y se acota, así que con min 1 tanto «▲» como
 * «▼» dan 1 en vez de plantar un 0 que el campo no admite.
 */
export function mover(valor: string, signo: 1 | -1, paso: number, rango: Rango): string {
  const actual = Number(valor)
  const base = valor.trim() !== '' && Number.isFinite(actual) ? actual : 0
  return String(acotar(base + signo * paso, rango))
}

/**
 * El valor al perder el foco: ya no se está escribiendo, así que «5.»
 * pasa a 5 y un 500 con máximo 21 baja a 21.
 *
 * '' y '-' se quedan en '': son «sin dato», no cero. Acotarlos al mínimo
 * rellenaría el campo con un número que nadie escribió.
 */
export function normalizar(valor: string, rango: Rango): string {
  const t = valor.trim()
  if (t === '' || t === '-') return ''
  const n = Number(t)
  if (!Number.isFinite(n)) return ''
  return String(acotar(n, rango))
}
