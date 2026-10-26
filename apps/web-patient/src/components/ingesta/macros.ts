/**
 * Los tres macronutrientes, en un solo sitio — R52.
 *
 * Color, etiqueta y equivalencia energética juntos porque las cuatro
 * pantallas del módulo los recorren igual: las barras del encabezado,
 * los chips de cada alimento, los tiles del detalle y el donut. Tenerlos
 * sueltos en cada componente fue como empezó, y el orden salía distinto
 * en cada sitio.
 *
 * Los colores salen de `tokens.css` (`--macro-*`). Son fijos: no se
 * re-tematizan con la marca, igual que los estados clínicos.
 */
/*
 * Tres nombres por macro, y no por gusto: las barras del encabezado
 * tienen 60 px de etiqueta y «Carbohidratos» no cabe, los tiles del
 * detalle sí tienen sitio y ahí abreviar queda a medias, y los chips de
 * cada alimento solo admiten una letra.
 */
export const MACROS = [
  {
    clave: 'cho',
    etiqueta: 'Carbos',
    largo: 'Carbohidratos',
    corto: 'C',
    color: 'var(--macro-cho)',
    kcalPorG: 4,
  },
  {
    clave: 'prot',
    etiqueta: 'Proteína',
    largo: 'Proteína',
    corto: 'P',
    color: 'var(--macro-prot)',
    kcalPorG: 4,
  },
  {
    clave: 'grasa',
    etiqueta: 'Grasa',
    largo: 'Grasa',
    corto: 'G',
    color: 'var(--macro-grasa)',
    kcalPorG: 9,
  },
] as const

export type ClaveMacro = (typeof MACROS)[number]['clave']

/** Los cuatro números que describen una cantidad de comida. */
export interface Aporte {
  kcal: number
  cho: number
  prot: number
  grasa: number
}

export const APORTE_CERO: Aporte = { kcal: 0, cho: 0, prot: 0, grasa: 0 }

/** Redondeo a un decimal: la precisión de las columnas de la base. */
export function r1(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * Gramos de macro por cada 100 g de alimento, escalados a la cantidad
 * elegida.
 *
 * `gramos` son los del plato: unidad.gramosEquivalentes × cantidad. El
 * servidor hace exactamente esta cuenta al guardar (`routes/alimentos.ts`),
 * así que lo que la pantalla promete y lo que queda apuntado coinciden.
 */
export function calcularAporte(
  por100g: { kcal: number; cho: number; prot: number; grasa: number },
  gramos: number,
): Aporte {
  const f = gramos / 100
  return {
    kcal: r1(por100g.kcal * f),
    cho: r1(por100g.cho * f),
    prot: r1(por100g.prot * f),
    grasa: r1(por100g.grasa * f),
  }
}

/**
 * Reparto calórico entre macros, en tanto por uno.
 *
 * Se calcula sobre las kcal que aportan los macros (4/4/9) y no sobre
 * las kcal de la ficha: las dos cifras no siempre cuadran —la fibra, el
 * alcohol y el redondeo de las tablas nutricionales— y un donut cuyos
 * tres sectores no cierran el círculo se lee como un error de la app.
 */
export function repartoCalorico(a: Aporte): { clave: ClaveMacro; fraccion: number }[] {
  const kcalPorMacro = MACROS.map((m) => {
    const gramos = m.clave === 'cho' ? a.cho : m.clave === 'prot' ? a.prot : a.grasa
    return { clave: m.clave, kcal: gramos * m.kcalPorG }
  })
  const total = kcalPorMacro.reduce((t, m) => t + m.kcal, 0)
  if (total <= 0) return MACROS.map((m) => ({ clave: m.clave, fraccion: 0 }))
  return kcalPorMacro.map((m) => ({ clave: m.clave, fraccion: m.kcal / total }))
}

/** «1.5» y no «1.50»; «2» y no «2.0». */
export function formatCantidad(n: number): string {
  return Number.isInteger(n) ? String(n) : String(r1(n))
}
