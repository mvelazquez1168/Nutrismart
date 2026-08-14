/**
 * Calculadora nutricional — EVAL-06.
 *
 * Todo se resuelve en el cliente: son fórmulas cerradas sobre datos que
 * la pantalla ya tiene. Un viaje al servidor no añadiría nada y le
 * quitaría al profesional el resultado inmediato mientras ajusta.
 *
 * Las ecuaciones son ESTIMACIONES poblacionales. Todas dependen del
 * sexo, y sin él devuelven null en vez de elegir uno por defecto: la
 * diferencia entre las constantes de hombre y mujer en Mifflin es de
 * 166 kcal, que no es un matiz.
 */

export type SexoCalculo = 'masculino' | 'femenino'

/** Convierte el sexo del expediente al que aceptan las fórmulas. */
export function sexoParaCalculo(sexo: string | null): SexoCalculo | null {
  return sexo === 'masculino' || sexo === 'femenino' ? sexo : null
}

/* ------------------------------------------------------------------ */
/* Tasa metabólica basal                                               */
/* ------------------------------------------------------------------ */

export const FORMULAS_TMB = [
  {
    clave: 'mifflin',
    etiqueta: 'Mifflin-St Jeor',
    descripcion: 'La más usada en adultos sanos',
  },
  {
    clave: 'harris',
    etiqueta: 'Harris-Benedict',
    descripcion: 'Clásica; tiende a sobrestimar',
  },
  {
    clave: 'katch',
    etiqueta: 'Katch-McArdle',
    descripcion: 'Necesita masa libre de grasa',
  },
] as const

export type FormulaTmb = (typeof FORMULAS_TMB)[number]['clave']

export function mifflinStJeor(
  peso: number,
  talla: number,
  edad: number,
  sexo: SexoCalculo,
): number {
  const base = 10 * peso + 6.25 * talla - 5 * edad
  return sexo === 'masculino' ? base + 5 : base - 161
}

export function harrisBenedict(
  peso: number,
  talla: number,
  edad: number,
  sexo: SexoCalculo,
): number {
  return sexo === 'masculino'
    ? 88.362 + 13.397 * peso + 4.799 * talla - 5.677 * edad
    : 447.593 + 9.247 * peso + 3.098 * talla - 4.33 * edad
}

/**
 * Katch-McArdle parte de la masa libre de grasa, así que NO usa sexo ni
 * edad: la composición corporal ya los recoge. Es la más fiel cuando
 * hay bioimpedancia o pliegues, y la única inservible sin ellos.
 */
export function katchMcArdle(masaLibreGrasa: number): number {
  return 370 + 21.6 * masaLibreGrasa
}

export function calcularTmb(opciones: {
  formula: FormulaTmb
  peso: number | null
  talla: number | null
  edad: number | null
  sexo: SexoCalculo | null
  masaLibreGrasa: number | null
}): number | null {
  const { formula, peso, talla, edad, sexo, masaLibreGrasa } = opciones

  if (formula === 'katch') {
    if (masaLibreGrasa === null || masaLibreGrasa <= 0) return null
    return Math.round(katchMcArdle(masaLibreGrasa))
  }

  if (peso === null || talla === null || edad === null || sexo === null) return null
  if (peso <= 0 || talla <= 0 || edad <= 0) return null

  const tmb = formula === 'mifflin'
    ? mifflinStJeor(peso, talla, edad, sexo)
    : harrisBenedict(peso, talla, edad, sexo)

  return Math.round(tmb)
}

/* ------------------------------------------------------------------ */
/* Gasto total                                                         */
/* ------------------------------------------------------------------ */

export const FACTORES_ACTIVIDAD = [
  { clave: 'sedentario', etiqueta: 'Sedentario', faf: 1.2, descripcion: 'Trabajo de oficina' },
  { clave: 'leve', etiqueta: 'Leve', faf: 1.375, descripcion: 'Ejercicio 1-3 días' },
  { clave: 'moderado', etiqueta: 'Moderado', faf: 1.55, descripcion: 'Ejercicio 3-5 días' },
  { clave: 'intenso', etiqueta: 'Intenso', faf: 1.725, descripcion: 'Ejercicio 6-7 días' },
  { clave: 'muy_intenso', etiqueta: 'Muy intenso', faf: 1.9, descripcion: 'Trabajo físico' },
] as const

export function calcularGastoTotal(tmb: number | null, faf: number | null): number | null {
  if (tmb === null || faf === null) return null
  return Math.round(tmb * faf)
}

/* ------------------------------------------------------------------ */
/* Pesos de referencia                                                 */
/* ------------------------------------------------------------------ */

/** Hamwi: 48 kg (hombre) o 45,4 kg (mujer) a 152 cm, más lo que sume la talla. */
export function pesoIdealHamwi(talla: number, sexo: SexoCalculo): number {
  const extra = talla - 152
  const base = sexo === 'masculino' ? 48 + 1.1 * extra : 45.4 + 0.9 * extra
  return Math.round(base * 10) / 10
}

/**
 * Peso ajustado, solo cuando el real supera al ideal en más de un 20 %.
 *
 * Por debajo de ese umbral no se usa: calcular requerimientos sobre un
 * peso ajustado que casi coincide con el real solo introduce un número
 * más que explicar.
 */
export function pesoAjustado(pesoReal: number, pesoIdeal: number): number | null {
  if (pesoReal <= pesoIdeal * 1.2) return null
  return Math.round((pesoIdeal + 0.25 * (pesoReal - pesoIdeal)) * 10) / 10
}

/* ------------------------------------------------------------------ */
/* Reparto de macronutrientes                                          */
/* ------------------------------------------------------------------ */

export const REPARTOS = [
  { clave: 'equilibrada', etiqueta: 'Equilibrada', proteina: 20, cho: 50, grasa: 30 },
  { clave: 'alta_proteina', etiqueta: 'Alta en proteína', proteina: 30, cho: 40, grasa: 30 },
  { clave: 'baja_hc', etiqueta: 'Baja en carbohidratos', proteina: 30, cho: 30, grasa: 40 },
  { clave: 'mediterranea', etiqueta: 'Mediterránea', proteina: 20, cho: 45, grasa: 35 },
] as const

export function macrosEnGramos(kcal: number, pctProteina: number, pctCho: number, pctGrasa: number) {
  const g = (pct: number, kcalPorGramo: number) =>
    Math.round(((kcal * pct) / 100 / kcalPorGramo) * 10) / 10
  return {
    proteinaG: g(pctProteina, 4),
    choG: g(pctCho, 4),
    grasaG: g(pctGrasa, 9),
  }
}

/**
 * Reparte el ajuste de un porcentaje entre los otros dos para que la
 * suma siga siendo 100.
 *
 * Se reparte en PROPORCIÓN a lo que cada uno tenía, no a partes
 * iguales: mover la proteína de 20 a 30 en un reparto 20/50/30 debe
 * quitar más a los carbohidratos que a la grasa, que es lo que el
 * profesional espera ver.
 */
export function ajustarReparto(
  actual: { proteina: number; cho: number; grasa: number },
  campo: 'proteina' | 'cho' | 'grasa',
  valor: number,
): { proteina: number; cho: number; grasa: number } {
  const nuevo = Math.max(0, Math.min(100, Math.round(valor)))
  const otros = (['proteina', 'cho', 'grasa'] as const).filter((k) => k !== campo)
  const restante = 100 - nuevo
  const sumaOtros = otros.reduce((t, k) => t + actual[k], 0)

  const resultado = { ...actual, [campo]: nuevo } as {
    proteina: number
    cho: number
    grasa: number
  }

  if (sumaOtros === 0) {
    // Sin nada que repartir proporcionalmente, se parte por la mitad.
    const mitad = Math.floor(restante / 2)
    resultado[otros[0] as 'proteina'] = mitad
    resultado[otros[1] as 'cho'] = restante - mitad
    return resultado
  }

  const primero = Math.round((actual[otros[0] as 'proteina'] / sumaOtros) * restante)
  resultado[otros[0] as 'proteina'] = primero
  // El segundo absorbe el redondeo para que la suma sea exactamente 100.
  resultado[otros[1] as 'cho'] = restante - primero
  return resultado
}

/* ------------------------------------------------------------------ */
/* Intercambios                                                        */
/* ------------------------------------------------------------------ */

/**
 * Reparto orientativo por listas de intercambio.
 *
 * Las proporciones de la especificación de partida sumaban 0,80, de modo
 * que los intercambios solo cubrían el 80 % de la meta calórica y el
 * profesional habría prescrito, sin verlo, una quinta parte menos de lo
 * que calculó. Aquí se normalizan a 100 % conservando su peso relativo.
 *
 * Sigue siendo una aproximación: un menú por intercambios se ajusta a
 * mano, y esto es solo el punto de partida.
 */
const PROPORCIONES = {
  almidones: 0.3,
  carnes: 0.2,
  vegetales: 0.05,
  frutas: 0.07,
  leche: 0.08,
  grasas: 0.1,
} as const

/** Kilocalorías por intercambio, valores estándar de las listas. */
const KCAL_INTERCAMBIO = {
  almidones: 80,
  carnes: 55,
  vegetales: 25,
  frutas: 60,
  leche: 90,
  grasas: 45,
} as const

export const ETIQUETA_INTERCAMBIO: Record<string, string> = {
  almidones: 'Almidones',
  carnes: 'Carnes y sustitutos',
  vegetales: 'Vegetales',
  frutas: 'Frutas',
  leche: 'Leche',
  grasas: 'Grasas',
}

export function calcularIntercambios(kcal: number): Record<string, number> {
  const total = Object.values(PROPORCIONES).reduce((t, v) => t + v, 0)
  const salida: Record<string, number> = {}
  for (const [grupo, proporcion] of Object.entries(PROPORCIONES)) {
    const normalizada = proporcion / total
    salida[grupo] = Math.round(
      (kcal * normalizada) / KCAL_INTERCAMBIO[grupo as keyof typeof KCAL_INTERCAMBIO],
    )
  }
  return salida
}

/** Kilocalorías que suman los intercambios, para contrastar. */
export function kcalDeIntercambios(intercambios: Record<string, number>): number {
  return Object.entries(intercambios).reduce(
    (t, [grupo, n]) => t + n * (KCAL_INTERCAMBIO[grupo as keyof typeof KCAL_INTERCAMBIO] ?? 0),
    0,
  )
}

/* ------------------------------------------------------------------ */
/* Conversores                                                         */
/* ------------------------------------------------------------------ */

/**
 * Regla de las 7700 kcal: el equivalente energético aproximado de un
 * kilo de tejido adiposo.
 *
 * Es una aproximación lineal que no contempla la adaptación metabólica,
 * así que sirve para dar una escala temporal, no para prometer una
 * fecha.
 */
export function proyeccionPeso(ajusteDiario: number): {
  diasPorKilo: number | null
  kgPorSemana: number
} {
  if (ajusteDiario === 0) return { diasPorKilo: null, kgPorSemana: 0 }
  const diasPorKilo = Math.abs(7700 / ajusteDiario)
  return {
    diasPorKilo: Math.round(diasPorKilo * 10) / 10,
    kgPorSemana: Math.round((7 / diasPorKilo) * (ajusteDiario < 0 ? -1 : 1) * 100) / 100,
  }
}

/** La OMS recomienda no superar 25 g de azúcares libres al día. */
export function azucarACucharaditas(gramosDia: number) {
  return {
    cucharaditas: Math.round((gramosDia / 5) * 10) / 10,
    kcal: Math.round(gramosDia * 4),
    excedeRecomendacion: gramosDia > 25,
  }
}

/** 1 g de sal ≈ 400 mg de sodio. La OMS recomienda < 2000 mg/día. */
export function sodioASal(mgSodioDia: number) {
  return {
    gramosSal: Math.round((mgSodioDia / 400) * 10) / 10,
    excedeRecomendacion: mgSodioDia > 2000,
  }
}
