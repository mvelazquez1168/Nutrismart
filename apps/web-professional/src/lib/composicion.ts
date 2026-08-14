/**
 * Composición corporal a partir de pliegues cutáneos — EVAL-01.
 *
 * Las ecuaciones estiman primero la DENSIDAD corporal y de ahí sacan el
 * porcentaje de grasa con Siri (1961). Los coeficientes dependen del
 * sexo y de la edad, así que sin esos dos datos no hay estimación: se
 * devuelve null en vez de un número inventado con valores por defecto.
 *
 * Referencias:
 *  · Durnin & Womersley (1974) — 4 pliegues, densidad por regresión
 *    logarítmica. Es la de uso general en consulta.
 *  · Jackson & Pollock (1978, 1980) — 3 pliegues, ecuación cuadrática,
 *    con sitios distintos según el sexo.
 *
 * Son ESTIMACIONES poblacionales. La interfaz las marca como calculadas
 * y el profesional puede sobrescribir el valor: si el aparato de
 * bioimpedancia o su propio criterio dicen otra cosa, manda eso.
 */

export type Sexo = 'masculino' | 'femenino' | 'intersexual' | null

/** Todos los pliegues en milímetros. */
export interface Pliegues {
  tricipital?: number | null
  bicipital?: number | null
  subescapular?: number | null
  suprailiaco?: number | null
  abdominal?: number | null
  muslo?: number | null
  pierna?: number | null
  pectoral?: number | null
}

export const SITIOS_PLIEGUE = [
  { clave: 'tricipital', etiqueta: 'Tricipital' },
  { clave: 'bicipital', etiqueta: 'Bicipital' },
  { clave: 'subescapular', etiqueta: 'Subescapular' },
  { clave: 'suprailiaco', etiqueta: 'Suprailíaco' },
  { clave: 'abdominal', etiqueta: 'Abdominal' },
  { clave: 'muslo', etiqueta: 'Muslo' },
  { clave: 'pierna', etiqueta: 'Pierna' },
  { clave: 'pectoral', etiqueta: 'Pectoral' },
] as const

export const FORMULAS = [
  { clave: 'durnin_womersley', etiqueta: 'Durnin-Womersley (4 pliegues)' },
  { clave: 'jackson_pollock', etiqueta: 'Jackson-Pollock (3 pliegues)' },
] as const

export type Formula = (typeof FORMULAS)[number]['clave']

/** Siri (1961): de densidad corporal a porcentaje de grasa. */
function siri(densidad: number): number | null {
  if (!Number.isFinite(densidad) || densidad <= 0) return null
  const pct = 495 / densidad - 450
  // Fuera de este margen la ecuación ya no describe a nadie: casi
  // siempre significa un pliegue mal tecleado.
  if (pct < 2 || pct > 70) return null
  return Math.round(pct * 100) / 100
}

function suma(valores: (number | null | undefined)[]): number | null {
  if (valores.some((v) => v === null || v === undefined || !Number.isFinite(v) || v <= 0)) return null
  return valores.reduce<number>((t, v) => t + (v as number), 0)
}

/**
 * Durnin-Womersley: bicipital + tricipital + subescapular + suprailíaco.
 *
 * Los coeficientes vienen por tramos de edad. El tramo se elige por
 * comparación explícita y no interpolando: la publicación los da así.
 */
export function porPliegesDurninWomersley(
  pliegues: Pliegues,
  edad: number | null,
  sexo: Sexo,
): number | null {
  if (edad === null || sexo === null || sexo === 'intersexual') return null

  const total = suma([
    pliegues.bicipital,
    pliegues.tricipital,
    pliegues.subescapular,
    pliegues.suprailiaco,
  ])
  if (total === null) return null

  const hombre = sexo === 'masculino'
  let c: number
  let m: number

  if (edad < 20) {
    ;[c, m] = hombre ? [1.162, 0.063] : [1.1549, 0.0678]
  } else if (edad < 30) {
    ;[c, m] = hombre ? [1.1631, 0.0632] : [1.1599, 0.0717]
  } else if (edad < 40) {
    ;[c, m] = hombre ? [1.1422, 0.0544] : [1.1423, 0.0632]
  } else if (edad < 50) {
    ;[c, m] = hombre ? [1.162, 0.07] : [1.1333, 0.0612]
  } else {
    ;[c, m] = hombre ? [1.1715, 0.0779] : [1.1339, 0.0645]
  }

  return siri(c - m * Math.log10(total))
}

/**
 * Jackson-Pollock de 3 pliegues. Los sitios NO son los mismos según el
 * sexo: pectoral/abdominal/muslo en hombres, tricipital/suprailíaco/
 * muslo en mujeres.
 */
export function porPlieguesJacksonPollock(
  pliegues: Pliegues,
  edad: number | null,
  sexo: Sexo,
): number | null {
  if (edad === null || sexo === null || sexo === 'intersexual') return null

  const hombre = sexo === 'masculino'
  const total = hombre
    ? suma([pliegues.pectoral, pliegues.abdominal, pliegues.muslo])
    : suma([pliegues.tricipital, pliegues.suprailiaco, pliegues.muslo])
  if (total === null) return null

  const densidad = hombre
    ? 1.10938 - 0.0008267 * total + 0.0000016 * total * total - 0.0002574 * edad
    : 1.0994921 - 0.0009929 * total + 0.0000023 * total * total - 0.0001392 * edad

  return siri(densidad)
}

/** Sitios que pide cada fórmula, para pintar solo esos campos. */
export function sitiosDe(formula: Formula, sexo: Sexo): string[] {
  if (formula === 'durnin_womersley') {
    return ['bicipital', 'tricipital', 'subescapular', 'suprailiaco']
  }
  return sexo === 'masculino'
    ? ['pectoral', 'abdominal', 'muslo']
    : ['tricipital', 'suprailiaco', 'muslo']
}

export function calcularPctGrasa(
  formula: Formula,
  pliegues: Pliegues,
  edad: number | null,
  sexo: Sexo,
): number | null {
  return formula === 'durnin_womersley'
    ? porPliegesDurninWomersley(pliegues, edad, sexo)
    : porPlieguesJacksonPollock(pliegues, edad, sexo)
}

/* ------------------------------------------------------------------ */
/* Lectura de los índices                                              */
/* ------------------------------------------------------------------ */

export interface Lectura {
  etiqueta: string
  /** Token de estado clínico; nunca un color suelto. */
  token: 'normal' | 'alert' | 'critical' | null
}

/** Clasificación de IMC de la OMS. */
export function leerImc(imc: number | null): Lectura | null {
  if (imc === null) return null
  if (imc < 18.5) return { etiqueta: 'Bajo peso', token: 'alert' }
  if (imc < 25) return { etiqueta: 'Normal', token: 'normal' }
  if (imc < 30) return { etiqueta: 'Sobrepeso', token: 'alert' }
  if (imc < 35) return { etiqueta: 'Obesidad I', token: 'critical' }
  if (imc < 40) return { etiqueta: 'Obesidad II', token: 'critical' }
  return { etiqueta: 'Obesidad III', token: 'critical' }
}

/**
 * Índice cintura-cadera. Los umbrales de riesgo difieren por sexo
 * (OMS: 0,90 en hombres y 0,85 en mujeres), así que sin sexo registrado
 * no se emite juicio — igual que los rangos de laboratorio de la
 * Rebanada 5.
 */
export function leerIcc(icc: number | null, sexo: Sexo): Lectura | null {
  if (icc === null) return null
  if (sexo !== 'masculino' && sexo !== 'femenino') {
    return { etiqueta: 'Sin referencia para este paciente', token: null }
  }
  const umbral = sexo === 'masculino' ? 0.9 : 0.85
  return icc > umbral
    ? { etiqueta: 'Riesgo elevado', token: 'critical' }
    : { etiqueta: 'Dentro de rango', token: 'normal' }
}
