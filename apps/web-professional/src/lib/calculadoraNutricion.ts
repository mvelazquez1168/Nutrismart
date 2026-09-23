/**
 * Calculadora de requerimiento energético y distribución de dieta — R39.
 *
 * Dos bloques de cálculo, todos en el cliente sobre datos que la pantalla
 * ya tiene:
 *   A. Evaluación antropométrica + requerimiento energético (GEB/GET).
 *   B. Distribución de dieta por listas de intercambio (ADA, INCIENSA).
 *
 * Todas las ecuaciones son ESTIMACIONES poblacionales. Dependen del sexo
 * y devuelven null antes que elegir uno por defecto.
 *
 * Nota sobre la Colombiana: su tabla de referencia (R39 §B4) trae solo
 * kilocalorías por grupo, sin la composición CHO/Prot/Grasa que exigen
 * los cortes y las columnas de macros. Queda marcada `completo: false`:
 * se listan sus grupos y kilocalorías, sin cortes ni columnas de macros.
 */

export type Genero = 'masculino' | 'femenino'

export function generoDeSexo(sexo: string | null): Genero | null {
  return sexo === 'masculino' || sexo === 'femenino' ? sexo : null
}

const r1 = (n: number) => Math.round(n * 10) / 10
const r0 = (n: number) => Math.round(n)

/* ================================================================== */
/* Sección A — Antropometría y requerimiento energético               */
/* ================================================================== */

/** Estimación de talla (cm) desde altura de rodilla (cm) cuando no se mide. */
export function tallaDesdeRodilla(alturaRodilla: number, edad: number, genero: Genero): number {
  return genero === 'masculino'
    ? r1(62 + 2.1 * alturaRodilla - 0.16 * edad)
    : r1(58.28 + 2.2 * alturaRodilla - 0.1 * edad)
}

/* ---- Estructura corporal ---- */

export type Estructura = 'pequena' | 'mediana' | 'grande'

export const ETIQUETA_ESTRUCTURA: Record<Estructura, string> = {
  pequena: 'Pequeña',
  mediana: 'Mediana',
  grande: 'Grande',
}

/** índice = talla / circunferencia de muñeca. */
export function indiceEstructura(tallaCm: number, munecaCm: number): number {
  return r1(tallaCm / munecaCm)
}

/**
 * Un índice ALTO significa muñeca fina para la talla → estructura
 * pequeña. Umbrales distintos por sexo (R39 §A3).
 */
export function clasificarEstructura(indice: number, genero: Genero): Estructura {
  if (genero === 'masculino') {
    if (indice > 10.4) return 'pequena'
    if (indice >= 9.6) return 'mediana'
    return 'grande'
  }
  if (indice > 11.0) return 'pequena'
  if (indice >= 10.1) return 'mediana'
  return 'grande'
}

/* ---- IMC ---- */

export function imc(pesoKg: number, tallaCm: number): number {
  const m = tallaCm / 100
  return r1(pesoKg / (m * m))
}

/** Clasificación de IMC en adultos (OMS 2013). */
export function clasificarImc(valor: number): string {
  if (valor < 16) return 'Delgadez severa'
  if (valor < 17) return 'Delgadez moderada'
  if (valor < 18.5) return 'Delgadez aceptable'
  if (valor < 25) return 'Normal'
  if (valor < 30) return 'Preobeso'
  if (valor < 35) return 'Obeso I'
  if (valor < 40) return 'Obeso II'
  return 'Obeso III'
}

/* ---- Peso ideal — cuatro métodos en paralelo (R39 §A5) ---- */

export interface PiPorEstructura {
  pequena: number
  mediana: number
  grande: number
}

/** ADA por estructura corporal: mediana ± 10 %. */
export function piADA(tallaCm: number, genero: Genero): PiPorEstructura {
  const mediana =
    genero === 'masculino'
      ? ((tallaCm - 152) / 2.5) * 2.7 + 48.2
      : ((tallaCm - 152) / 2.5) * 2.3 + 45.5
  return {
    pequena: r1(mediana - mediana * 0.1),
    mediana: r1(mediana),
    grande: r1(mediana + mediana * 0.1),
  }
}

/** FEC / IMC: talla² × {20.5, 22.5, 25.0}. */
export function piFecImc(tallaM: number): PiPorEstructura {
  const t2 = tallaM * tallaM
  return { pequena: r1(t2 * 20.5), mediana: r1(t2 * 22.5), grande: r1(t2 * 25.0) }
}

/** IMC adulto mayor: talla² × 25.5 (promedio de IMC 23–28). */
export function piAdultoMayor(tallaM: number): number {
  return r1(tallaM * tallaM * 25.5)
}

export function piLorentz(tallaCm: number, genero: Genero): number {
  const divisor = genero === 'masculino' ? 4 : 2.5
  return r1(tallaCm - 100 - (tallaCm - 150) / divisor)
}

/** Solo cuando hay altura de rodilla y circunferencia braquial (encamado). */
export function piEncamado(
  alturaRodilla: number,
  circunfBraquial: number,
  genero: Genero,
): number {
  return genero === 'masculino'
    ? r1(alturaRodilla * 1.1 + circunfBraquial * 3.07 - 75.81)
    : r1(alturaRodilla * 1.09 + circunfBraquial * 2.68 - 65.51)
}

/* ---- Pesos derivados (R39 §A6) ---- */

export function pesoAjustado(pesoActual: number, pi: number): number {
  return r1((pesoActual - pi) / 4 + pi)
}

export function pesoMetaPorImc(imcDeseado: number, tallaM: number): number {
  return r1(imcDeseado * tallaM * tallaM)
}

/* ---- GEB / TMB (R39 §A7) ---- */

export type MetodoGeb = 'schofield' | 'mifflin' | 'fao_oms' | 'harris' | 'cunningham'

/**
 * Métodos de GEB ofrecidos por la calculadora.
 *
 * FAO/OMS solo aparece hasta los 18 años: el panel la filtra por edad,
 * porque es la única con bandas pediátricas y para un adulto sobra.
 *
 * Cunningham (R42) es distinta de las demás en algo más que la fórmula:
 * no se multiplica por un factor de actividad, sino que suma el gasto
 * del ejercicio actividad por actividad. Ver `requiereMlg` y la sección
 * GEE del panel.
 */
export const METODOS_GEB = [
  { clave: 'schofield', etiqueta: 'Schofield' },
  { clave: 'mifflin', etiqueta: 'Mifflin St. Jeor' },
  { clave: 'fao_oms', etiqueta: 'FAO/OMS' },
  { clave: 'harris', etiqueta: 'Harris-Benedict' },
  { clave: 'cunningham', etiqueta: 'Cunningham' },
] as const

/** Métodos que parten de la composición corporal, no del peso total. */
export function requiereMlg(metodo: MetodoGeb): boolean {
  return metodo === 'cunningham'
}

/**
 * Cunningham NO usa factor de actividad.
 *
 * Los demás métodos estiman el gasto total multiplicando el basal por un
 * factor; Cunningham lo construye sumando: GET = GER × 1.1 + GEE. Por eso
 * el panel esconde FA/FT/FE cuando está activo — dejarlos visibles
 * invitaría a aplicar dos veces la misma corrección.
 */
export function usaFactoresActividad(metodo: MetodoGeb): boolean {
  return metodo !== 'cunningham'
}

/**
 * Schofield (GEB) por banda de edad. P = kg, T = cm.
 *
 * Ojo con el coeficiente de talla de la mujer adulta: 2.83, no 23.8.
 * La ecuación publicada es `13.623·P + 283·T + 98.2` con la talla en
 * METROS; pasarla a centímetros divide ese 283 entre 100. La R39 lo
 * transcribió como 23.8 y devolvía 4843 kcal para una mujer de 60 kg y
 * 165 cm —tres veces y media lo real—, corregido en la R42. El contraste
 * rápido: Harris-Benedict da 1384 kcal para ese mismo caso.
 */
export function gebSchofield(pesoKg: number, tallaCm: number, edad: number, genero: Genero): number {
  const P = pesoKg
  const T = tallaCm
  const h = genero === 'masculino'
  let v: number
  if (edad < 3) v = h ? 0.167 * P + 15.174 * T - 617.6 : 16.252 * P + 10.232 * T - 413.5
  else if (edad < 10) v = h ? 19.59 * P + 1.303 * T + 414.9 : 16.969 * P + 1.618 * T + 371.2
  else if (edad < 18) v = h ? 16.25 * P + 1.372 * T + 515.5 : 8.365 * P + 4.65 * T + 200
  else v = h ? 15.057 * P + 1.0004 * T + 705.8 : 13.623 * P + 2.83 * T + 98.2
  return r0(v)
}

/** Mifflin-St Jeor (TMB). P = kg, T = cm, E = edad. */
export function tmbMifflin(pesoKg: number, tallaCm: number, edad: number, genero: Genero): number {
  const base = 10 * pesoKg + 6.25 * tallaCm - 5 * edad
  return r0(genero === 'masculino' ? base + 5 : base - 161)
}

/** FAO/OMS (GEB) por banda de edad. P = kg (sin talla). */
export function gebFaoOms(pesoKg: number, edad: number, genero: Genero): number {
  const P = pesoKg
  const h = genero === 'masculino'
  let v: number
  if (edad < 3) v = h ? 60.9 * P - 54 : 61 * P - 51
  else if (edad < 10) v = h ? 22.7 * P + 495 : 22.5 * P + 499
  else if (edad < 18) v = h ? 17.5 * P + 651 : 12.2 * P + 746
  else if (edad < 30) v = h ? 15.3 * P + 679 : 14.7 * P + 496
  else if (edad < 60) v = h ? 11.6 * P + 879 : 8.7 * P + 829
  else v = h ? 13.5 * P + 487 : 10.5 * P + 596
  return r0(v)
}

/** Harris-Benedict (GEB), revisión clásica. P = kg, T = cm, E = edad. */
export function gebHarrisBenedict(
  pesoKg: number,
  tallaCm: number,
  edad: number,
  genero: Genero,
): number {
  return r0(
    genero === 'masculino'
      ? 88.362 + 13.397 * pesoKg + 4.799 * tallaCm - 5.677 * edad
      : 447.593 + 9.247 * pesoKg + 3.098 * tallaCm - 4.33 * edad,
  )
}

/**
 * Cunningham (GER) a partir de la masa libre de grasa.
 *
 * No usa sexo, edad ni talla: la composición corporal ya los recoge. Es
 * la referencia en población deportista, y la única de la lista que no
 * se puede calcular sin bioimpedancia o pliegues.
 */
export function gerCunningham(mlgKg: number): number {
  return r0(500 + 22 * mlgKg)
}

export function calcularGeb(opciones: {
  metodo: MetodoGeb
  peso: number | null
  talla: number | null
  edad: number | null
  genero: Genero | null
  /** Masa libre de grasa (kg). Solo la usa Cunningham. */
  mlg?: number | null
}): number | null {
  const { metodo, peso, talla, edad, genero, mlg = null } = opciones

  // Cunningham va primero: es la única que no necesita peso, edad ni
  // género, y exigírselos la dejaría en null con todos sus datos puestos.
  if (metodo === 'cunningham') {
    if (mlg === null || mlg <= 0) return null
    return gerCunningham(mlg)
  }

  if (peso === null || edad === null || genero === null || peso <= 0 || edad <= 0) return null
  if (metodo === 'fao_oms') return gebFaoOms(peso, edad, genero)
  if (talla === null || talla <= 0) return null
  if (metodo === 'harris') return gebHarrisBenedict(peso, talla, edad, genero)
  return metodo === 'schofield'
    ? gebSchofield(peso, talla, edad, genero)
    : tmbMifflin(peso, talla, edad, genero)
}

/**
 * VET (GET) unificado: GEB × (FA + FT + FE − 2).
 *
 * El −2 descuenta el metabolismo basal de más que se contaría al sumar
 * tres factores ~1. Con FT = FE = 1 se reduce a GEB × FA, es decir el
 * clásico GEB × PAL; con fiebre o estrés (FT o FE > 1) sube por encima.
 * Es el único total: no hay una línea aparte "GEB × PAL".
 */
export function vetConFactores(geb: number, fa: number, ft: number, fe: number): number {
  return r0(geb * (fa + ft + fe - 2))
}

/* ================================================================== */
/* Sección A-bis — Gasto por ejercicio y disponibilidad (R42)          */
/* ================================================================== */

/**
 * Una actividad física del día.
 *
 * `kg` viaja por entrada y no se lee del peso del paciente en el momento
 * del cálculo: una tabla guardada hace tres meses tiene que seguir
 * sumando lo que sumaba, aunque el paciente pese otra cosa hoy.
 */
export interface EntradaGEE {
  id: string
  actividad: string
  mets: number
  kg: number
  minutos: number
  /** Derivado; se persiste para que el histórico no dependa de la fórmula. */
  gee: number
}

/** METS de referencia (compendio de actividad física). */
export const CATALOGO_ACTIVIDADES = [
  { etiqueta: 'Caminar liviano (< 4 km/h)', mets: 2.5 },
  { etiqueta: 'Caminar moderado (4–6 km/h)', mets: 3.5 },
  { etiqueta: 'Caminar rápido (> 6 km/h)', mets: 4.5 },
  { etiqueta: 'Trotar / jogging', mets: 7.0 },
  { etiqueta: 'Correr (ritmo moderado)', mets: 9.0 },
  { etiqueta: 'Correr (ritmo intenso)', mets: 11.5 },
  { etiqueta: 'Ciclismo recreativo', mets: 4.0 },
  { etiqueta: 'Ciclismo moderado', mets: 8.0 },
  { etiqueta: 'Natación recreativa', mets: 6.0 },
  { etiqueta: 'Natación competitiva', mets: 10.0 },
  { etiqueta: 'Aeróbicos / baile aeróbico', mets: 6.5 },
  { etiqueta: 'Yoga', mets: 3.0 },
  { etiqueta: 'Pilates', mets: 3.5 },
  { etiqueta: 'Pesas / entrenamiento de fuerza', mets: 5.0 },
  { etiqueta: 'HIIT / entrenamiento funcional', mets: 8.5 },
  { etiqueta: 'Fútbol', mets: 7.0 },
  { etiqueta: 'Baloncesto', mets: 6.5 },
  { etiqueta: 'Tenis', mets: 7.0 },
] as const

/** Opción del selector para escribir los METS a mano. */
export const ACTIVIDAD_LIBRE = 'Actividad libre (ingresar METS)'

/**
 * GEE = 0.0175 × kg × minutos × METS.
 *
 * El 0.0175 es kcal por kg y por minuto a 1 MET (equivale a 3.5 ml
 * O₂/kg/min convertidos a energía).
 */
export function calcularGEE(kg: number, minutos: number, mets: number): number {
  return r1(0.0175 * kg * minutos * mets)
}

/**
 * GET por el camino de Cunningham: GER × 1.1 + GEE total.
 *
 * El ×1.1 es el efecto termogénico de los alimentos (~10 %). No hay
 * factor de actividad: el ejercicio ya está contado, actividad por
 * actividad, en el GEE.
 */
export function getCunningham(ger: number, geeTotal: number): number {
  return r0(ger * 1.1 + geeTotal)
}

/**
 * Disponibilidad energética: la energía que queda para sostener al
 * cuerpo una vez descontado el ejercicio, por kilo de masa magra.
 *
 * (GET − GEE) / MLG. Es el indicador que define el RED-S, y por eso se
 * mide contra la MLG y no contra el peso total.
 */
export function disponibilidadEnergetica(
  get: number,
  geeTotal: number,
  mlgKg: number,
): number | null {
  if (mlgKg <= 0) return null
  return r1((get - geeTotal) / mlgKg)
}

export type NivelDE = 'severa' | 'baja' | 'optima' | 'excedente'

export interface LecturaDE {
  nivel: NivelDE
  etiqueta: string
  /** Token del design system, no un color suelto. */
  color: string
  descripcion: string
}

/**
 * Lectura de la disponibilidad energética, en kcal/kg MLG/día.
 *
 * Los cortes (30 y 45) son los de la literatura de RED-S. El color sale
 * de los estados clínicos del design system: son los mismos tres que usa
 * el resto de la aplicación para «crítico», «revisar» y «normal».
 */
export function interpretarDE(de: number): LecturaDE {
  if (de < 30) {
    return {
      nivel: 'severa',
      etiqueta: 'Deficiencia energética severa',
      color: 'var(--status-critical)',
      descripcion:
        'Riesgo de Deficiencia Energética Relativa en el Deporte (RED-S). Revisar la ingesta calórica con urgencia.',
    }
  }
  if (de < 45) {
    return {
      nivel: 'baja',
      etiqueta: 'Deficiencia energética leve / moderada',
      color: 'var(--status-alert)',
      descripcion:
        'Por debajo de la disponibilidad óptima. Vigilar fatiga, alteraciones hormonales y salud ósea.',
    }
  }
  if (de <= 60) {
    return {
      nivel: 'optima',
      etiqueta: 'Disponibilidad energética óptima',
      color: 'var(--status-normal)',
      descripcion:
        'Rango recomendado (45–60 kcal/kg MLG/día): sostiene las funciones fisiológicas y el rendimiento.',
    }
  }
  return {
    nivel: 'excedente',
    etiqueta: 'Excedente energético',
    color: 'var(--muted)',
    descripcion:
      'Por encima de 60 kcal/kg MLG/día. Valorar si el objetivo clínico lo justifica.',
  }
}

/* ================================================================== */
/* Sección B — Distribución de dieta por intercambios                 */
/* ================================================================== */

export type MetodoDietaClave = 'ADA' | 'INCIENSA' | 'Colombiana'

/** Macro que cierra un bloque de corte. */
export type Cierre = 'cho' | 'prot' | 'grasa'

export interface GrupoDieta {
  clave: string
  etiqueta: string
  cho: number
  prot: number
  grasa: number
  kcal: number
  /** Columnas extra (solo Colombiana): grasas por tipo y colesterol. */
  sat?: number
  mono?: number
  poli?: number
  colest?: number
  /** Si está, el grupo pertenece al bloque de cierre de ese macro. */
  cierre?: Cierre
}

export interface BloqueCorte {
  cierre: Cierre
  etiqueta: string
  divisor: number
}

export interface MetodoDieta {
  clave: MetodoDietaClave
  etiqueta: string
  /** false = sin composición de macros; no se calculan cortes ni columnas. */
  completo: boolean
  /** true = muestra además Sat/Mono/Poli/Colesterol (Colombiana). */
  columnasExtra?: boolean
  grupos: GrupoDieta[]
  cortes: BloqueCorte[]
}

const CORTES_75 = (etiquetaHarina: string, divisorCarne: number): BloqueCorte[] => [
  { cierre: 'cho', etiqueta: `Corte de ${etiquetaHarina}`, divisor: 15 },
  { cierre: 'prot', etiqueta: 'Corte de carnes', divisor: divisorCarne },
  { cierre: 'grasa', etiqueta: 'Corte de grasas', divisor: 5 },
]

const ADA: MetodoDieta = {
  clave: 'ADA',
  etiqueta: 'ADA',
  completo: true,
  cortes: CORTES_75('cereales', 7),
  grupos: [
    { clave: 'leche_descremada', etiqueta: 'Leche descremada', cho: 12, prot: 8, grasa: 1, kcal: 100 },
    { clave: 'leche_semidescremada', etiqueta: 'Leche semidescremada', cho: 12, prot: 8, grasa: 5, kcal: 120 },
    { clave: 'leche_entera', etiqueta: 'Leche entera', cho: 12, prot: 8, grasa: 8, kcal: 160 },
    { clave: 'vegetales', etiqueta: 'Vegetales', cho: 5, prot: 2, grasa: 0, kcal: 25 },
    { clave: 'frutas', etiqueta: 'Frutas', cho: 15, prot: 0, grasa: 0, kcal: 60 },
    { clave: 'azucares', etiqueta: 'Azúcares', cho: 5, prot: 0, grasa: 0, kcal: 20 },
    { clave: 'cereales', etiqueta: 'Cereales', cho: 15, prot: 3, grasa: 1, kcal: 80, cierre: 'cho' },
    { clave: 'carnes_magras', etiqueta: 'Carnes magras', cho: 0, prot: 7, grasa: 2, kcal: 45, cierre: 'prot' },
    { clave: 'carnes_semimagras', etiqueta: 'Carnes semimagras', cho: 0, prot: 7, grasa: 5, kcal: 75, cierre: 'prot' },
    { clave: 'carnes_alta', etiqueta: 'Carnes alta grasa', cho: 0, prot: 7, grasa: 8, kcal: 100, cierre: 'prot' },
    { clave: 'grasas', etiqueta: 'Grasas', cho: 0, prot: 0, grasa: 5, kcal: 45, cierre: 'grasa' },
  ],
}

const INCIENSA: MetodoDieta = {
  clave: 'INCIENSA',
  etiqueta: 'INCIENSA 2013',
  completo: true,
  cortes: CORTES_75('harinas', 7),
  grupos: [
    { clave: 'lacteo_entero', etiqueta: 'Lácteo entero', cho: 12, prot: 8, grasa: 0, kcal: 150 },
    { clave: 'lacteo_descremado', etiqueta: 'Lácteo descremado', cho: 12, prot: 8, grasa: 0.7, kcal: 90 },
    { clave: 'lacteo_semidescremado', etiqueta: 'Lácteo semidescremado', cho: 12, prot: 8, grasa: 1.3, kcal: 120 },
    { clave: 'frutas', etiqueta: 'Frutas', cho: 15, prot: 0, grasa: 0, kcal: 60 },
    { clave: 'vegetales', etiqueta: 'Vegetales', cho: 0, prot: 2, grasa: 0, kcal: 25 },
    { clave: 'leguminosas', etiqueta: 'Leguminosas', cho: 20, prot: 7, grasa: 0.3, kcal: 120 },
    { clave: 'azucares', etiqueta: 'Azúcares', cho: 5, prot: 0, grasa: 0, kcal: 20 },
    { clave: 'harinas', etiqueta: 'Harinas', cho: 15, prot: 3, grasa: 1.2, kcal: 80, cierre: 'cho' },
    { clave: 'carne_baja', etiqueta: 'Carne baja grasa', cho: 0, prot: 7, grasa: 2.6, kcal: 51, cierre: 'prot' },
    { clave: 'carne_media', etiqueta: 'Carne media grasa', cho: 0, prot: 7, grasa: 5.6, kcal: 78, cierre: 'prot' },
    { clave: 'carne_alta', etiqueta: 'Carne alta grasa', cho: 0, prot: 7, grasa: 7.6, kcal: 96, cierre: 'prot' },
    { clave: 'grasa_saturada', etiqueta: 'Grasa saturada', cho: 0, prot: 0, grasa: 5, kcal: 45, cierre: 'grasa' },
    { clave: 'grasa_mono', etiqueta: 'Grasa monoinsaturada', cho: 0, prot: 0, grasa: 5, kcal: 45, cierre: 'grasa' },
    { clave: 'grasa_poli', etiqueta: 'Grasa poliinsaturada', cho: 0, prot: 0, grasa: 5, kcal: 45, cierre: 'grasa' },
  ],
}

/**
 * Colombiana (R39 §B4). Trae composición completa por grupo, incluidas
 * las columnas de grasas por tipo y colesterol. Carnes cierran con ÷14
 * (no ÷7 como ADA/INCIENSA), por eso el divisor va explícito en `cortes`.
 */
const COLOMBIANA: MetodoDieta = {
  clave: 'Colombiana',
  etiqueta: 'Colombiana',
  completo: true,
  columnasExtra: true,
  cortes: CORTES_75('harinas', 14),
  grupos: [
    { clave: 'leche_entera', etiqueta: 'Leche entera', cho: 10, prot: 8, grasa: 7, kcal: 135, sat: 4, mono: 2, poli: 0, colest: 35 },
    { clave: 'leche_semidescremada', etiqueta: 'Leche semidescremada', cho: 13, prot: 9, grasa: 5, kcal: 135, sat: 3, mono: 1.5, poli: 0.2, colest: 22 },
    { clave: 'leche_descremada', etiqueta: 'Leche descremada', cho: 19, prot: 13, grasa: 0.8, kcal: 135, sat: 0.5, mono: 0.2, poli: 0, colest: 8 },
    { clave: 'hortalizas', etiqueta: 'Hortalizas', cho: 7, prot: 2, grasa: 0, kcal: 35, sat: 0, mono: 0, poli: 0, colest: 0 },
    { clave: 'frutas', etiqueta: 'Frutas', cho: 10, prot: 0, grasa: 0, kcal: 40, sat: 0, mono: 0, poli: 0, colest: 0 },
    { clave: 'leguminosas', etiqueta: 'Leguminosas', cho: 32, prot: 13, grasa: 0, kcal: 180, sat: 0, mono: 0, poli: 0, colest: 0 },
    { clave: 'azucares', etiqueta: 'Azúcares', cho: 5, prot: 0, grasa: 0, kcal: 20, sat: 0, mono: 0, poli: 0, colest: 0 },
    { clave: 'gaseosas', etiqueta: 'Gaseosas', cho: 20, prot: 0, grasa: 0, kcal: 80, sat: 0, mono: 0, poli: 0, colest: 0 },
    { clave: 'alcoholicas', etiqueta: 'Alcohólicas', cho: 0, prot: 0, grasa: 0, kcal: 140, sat: 0, mono: 0, poli: 0, colest: 0 },
    { clave: 'cereales', etiqueta: 'Cereales', cho: 15, prot: 2, grasa: 0, kcal: 70, sat: 0, mono: 0, poli: 0, colest: 0, cierre: 'cho' },
    { clave: 'pan_galletas', etiqueta: 'Pan / Galletas', cho: 15, prot: 2, grasa: 0, kcal: 70, sat: 0, mono: 0, poli: 0, colest: 0, cierre: 'cho' },
    { clave: 'tuberculos', etiqueta: 'Tubérculos', cho: 15, prot: 2, grasa: 0, kcal: 70, sat: 0, mono: 0, poli: 0, colest: 0, cierre: 'cho' },
    { clave: 'res_magra', etiqueta: 'Res magra (100g)', cho: 0, prot: 22, grasa: 7, kcal: 150, sat: 2, mono: 3, poli: 0, colest: 60, cierre: 'prot' },
    { clave: 'res_semigrasa', etiqueta: 'Res semigrasa (65g)', cho: 0, prot: 12, grasa: 11, kcal: 150, sat: 5, mono: 5, poli: 0, colest: 44, cierre: 'prot' },
    { clave: 'res_grasa', etiqueta: 'Res grasa (50g)', cho: 0, prot: 8, grasa: 13, kcal: 150, sat: 5, mono: 6, poli: 0, colest: 37, cierre: 'prot' },
    { clave: 'pollo', etiqueta: 'Pollo (84g)', cho: 0, prot: 14, grasa: 10, kcal: 150, sat: 3, mono: 3, poli: 3, colest: 75, cierre: 'prot' },
    { clave: 'atun', etiqueta: 'Atún (56g)', cho: 0, prot: 14, grasa: 10, kcal: 150, sat: 3.5, mono: 2.5, poli: 2.5, colest: 35, cierre: 'prot' },
    { clave: 'huevo', etiqueta: 'Huevo (2u)', cho: 0, prot: 14, grasa: 10, kcal: 150, sat: 3, mono: 3.5, poli: 1, colest: 505, cierre: 'prot' },
    { clave: 'queso', etiqueta: 'Queso (77g)', cho: 0, prot: 14, grasa: 10, kcal: 150, sat: 6, mono: 2.5, poli: 0.5, colest: 55, cierre: 'prot' },
    { clave: 'aceite', etiqueta: 'Aceite (5ml)', cho: 0, prot: 0, grasa: 5, kcal: 45, sat: 0.5, mono: 1.5, poli: 2.5, colest: 0, cierre: 'grasa' },
    { clave: 'aceite_oliva', etiqueta: 'Aceite de oliva (5ml)', cho: 0, prot: 0, grasa: 5, kcal: 45, sat: 0.8, mono: 2.3, poli: 1.6, colest: 0, cierre: 'grasa' },
    { clave: 'margarina', etiqueta: 'Margarina (6g)', cho: 0, prot: 0, grasa: 5, kcal: 45, sat: 1, mono: 3, poli: 1, colest: 0, cierre: 'grasa' },
    { clave: 'mantequilla', etiqueta: 'Mantequilla (6g)', cho: 0, prot: 0, grasa: 5, kcal: 45, sat: 3, mono: 1.5, poli: 0.1, colest: 15, cierre: 'grasa' },
    { clave: 'manteca', etiqueta: 'Manteca (5g)', cho: 0, prot: 0, grasa: 5, kcal: 45, sat: 2, mono: 2.5, poli: 0.5, colest: 5, cierre: 'grasa' },
    { clave: 'aguacate', etiqueta: 'Aguacate (35g)', cho: 0, prot: 0, grasa: 5, kcal: 45, sat: 0.9, mono: 3.5, poli: 0.7, colest: 0, cierre: 'grasa' },
    { clave: 'mani', etiqueta: 'Maní (8g)', cho: 0, prot: 0, grasa: 5, kcal: 45, sat: 0.6, mono: 2, poli: 1.3, colest: 0, cierre: 'grasa' },
  ],
}

export const METODOS_DIETA: Record<MetodoDietaClave, MetodoDieta> = {
  ADA,
  INCIENSA,
  Colombiana: COLOMBIANA,
}

export const ORDEN_METODOS: MetodoDietaClave[] = ['ADA', 'INCIENSA', 'Colombiana']

/* ---- Macros meta (R39 §B1) ---- */

export interface MacrosMeta {
  choPct: number
  protPct: number
  grasaPct: number
  choKcal: number
  protKcal: number
  grasaKcal: number
  choG: number
  protG: number
  grasaG: number
  /** g por kg del peso a utilizar; null si no se dio peso. */
  choGKg: number | null
  protGKg: number | null
  grasaGKg: number | null
}

export function macrosMeta(
  metaKcal: number,
  choPct: number,
  protPct: number,
  grasaPct: number,
  pesoUtilizar: number | null,
): MacrosMeta {
  const choKcal = (metaKcal * choPct) / 100
  const protKcal = (metaKcal * protPct) / 100
  const grasaKcal = (metaKcal * grasaPct) / 100
  const choG = choKcal / 4
  const protG = protKcal / 4
  const grasaG = grasaKcal / 9
  const porKg = (g: number) => (pesoUtilizar && pesoUtilizar > 0 ? r1(g / pesoUtilizar) : null)
  return {
    choPct,
    protPct,
    grasaPct,
    choKcal: r0(choKcal),
    protKcal: r0(protKcal),
    grasaKcal: r0(grasaKcal),
    choG: r1(choG),
    protG: r1(protG),
    grasaG: r1(grasaG),
    choGKg: porKg(choG),
    protGKg: porKg(protG),
    grasaGKg: porKg(grasaG),
  }
}

/* ---- Distribución (R39 §B2/B3): cortes informativos, total digitado --- */

export interface FilaResultado {
  clave: string
  etiqueta: string
  cierre?: Cierre
  /** Porciones que digitó el profesional. */
  porciones: number
  cho: number
  prot: number
  grasa: number
  kcal: number
}

/** Sugerencia de porciones que cerraría el macro; solo informativa. */
export interface CorteHint {
  cierre: Cierre
  etiqueta: string
  valor: number
}

export interface ResultadoDistribucion {
  filas: FilaResultado[]
  cortes: CorteHint[]
  total: { cho: number; prot: number; grasa: number; kcal: number }
  /** % de adecuación = aportado / meta × 100. */
  adecuacion: { cho: number; prot: number; grasa: number; kcal: number }
}

/**
 * Calcula la distribución de un método:
 *  · cada fila multiplica las porciones DIGITADAS por su intercambio;
 *  · el total y la adecuación salen SIEMPRE de lo digitado;
 *  · los cortes son solo sugerencias: cada bloque descuenta lo aportado
 *    por los grupos que le preceden (entradas + cierres de macros
 *    anteriores) y divide lo que falta hasta la meta.
 */
export function calcularDistribucion(
  metodo: MetodoDieta,
  metaG: { cho: number; prot: number; grasa: number; kcal: number },
  porciones: Record<string, number>,
): ResultadoDistribucion {
  const p = (clave: string) => Math.max(0, porciones[clave] ?? 0)

  const filas: FilaResultado[] = metodo.grupos.map((g) => {
    const n = p(g.clave)
    return {
      clave: g.clave,
      etiqueta: g.etiqueta,
      cierre: g.cierre,
      porciones: n,
      cho: r1(n * g.cho),
      prot: r1(n * g.prot),
      grasa: r1(n * g.grasa),
      kcal: r0(n * g.kcal),
    }
  })

  const total = filas.reduce(
    (t, f) => ({
      cho: t.cho + f.cho,
      prot: t.prot + f.prot,
      grasa: t.grasa + f.grasa,
      kcal: t.kcal + f.kcal,
    }),
    { cho: 0, prot: 0, grasa: 0, kcal: 0 },
  )

  const orden: Cierre[] = ['cho', 'prot', 'grasa']
  const cortes: CorteHint[] = []
  if (metodo.completo) {
    for (const bloque of metodo.cortes) {
      const anteriores = new Set<Cierre>(orden.slice(0, orden.indexOf(bloque.cierre)))
      let restado = 0
      for (const g of metodo.grupos) {
        if (g.cierre === undefined || anteriores.has(g.cierre)) {
          restado += p(g.clave) * g[bloque.cierre]
        }
      }
      const valor = bloque.divisor > 0 ? (metaG[bloque.cierre] - restado) / bloque.divisor : 0
      cortes.push({ cierre: bloque.cierre, etiqueta: bloque.etiqueta, valor: r1(valor) })
    }
  }

  const pct = (a: number, m: number) => (m > 0 ? r0((a / m) * 100) : 0)
  return {
    filas,
    cortes,
    total: { cho: r1(total.cho), prot: r1(total.prot), grasa: r1(total.grasa), kcal: r0(total.kcal) },
    adecuacion: {
      cho: pct(total.cho, metaG.cho),
      prot: pct(total.prot, metaG.prot),
      grasa: pct(total.grasa, metaG.grasa),
      kcal: pct(total.kcal, metaG.kcal),
    },
  }
}

/** Porciones digitadas por grupo (>0), para el retorno `listasIntercambio`. */
export function porcionesDeResultado(r: ResultadoDistribucion): Record<string, number> {
  const salida: Record<string, number> = {}
  for (const f of r.filas) if (f.porciones > 0) salida[f.clave] = f.porciones
  return salida
}

/* ---- Cálculo de sal (INCIENSA, R39 §B3) ---- */

export interface ResultadoSal {
  naLibre: number
  naCl: number
  cdtasSal: number
}

/**
 * Na libre = Na recomendado − Na aportado por la dieta (mg).
 * NaCl = Na libre × 2.54 (mg). Cucharaditas = NaCl / 5000.
 */
export function calcularSal(naRecomendado: number, naAportado: number): ResultadoSal {
  const naLibre = naRecomendado - naAportado
  const naCl = naLibre * 2.54
  return { naLibre: r0(naLibre), naCl: r0(naCl), cdtasSal: r1(naCl / 5000) }
}

/** Micronutrientes que la vista Colombiana lista como recordatorio (R39 §B4). */
export const MICRONUTRIENTES_COLOMBIANA = [
  'Colesterol',
  'Sodio',
  'Potasio',
  'Calcio',
  'Fósforo',
  'Líquido',
] as const

/* ---- Retorno de la calculadora (compartido con API y encabezado) ---- */

export interface LineaIntercambio {
  /** Nombre del grupo tal como se muestra (ej: «Leche descremada»). */
  grupo: string
  porciones: number
}

/**
 * Lo que la calculadora devuelve al formulario y persiste el backend.
 * `listasIntercambio` trae solo las líneas con porciones > 0.
 */
export interface DatosCalculadora {
  metaCalorica: number
  metodoDieta: MetodoDietaClave
  distribucionMacros: {
    choPct: number
    protPct: number
    grasaPct: number
    choG: number
    protG: number
    grasaG: number
    choGkg: number
    protGkg: number
    grasaGkg: number
  }
  listasIntercambio: LineaIntercambio[]

  /* ---- Cunningham y gasto por ejercicio (R42) ---------------------
   *
   * Todos opcionales: los bloques guardados antes de la R42 no los
   * traen, y una conclusión vieja tiene que seguir abriéndose. Los
   * cuatro últimos solo se rellenan cuando el método es Cunningham.
   */

  /** Método de GEB/GER con el que se calculó. Ausente = anterior a R42. */
  metodoGer?: MetodoGeb
  /** Masa libre de grasa usada (kg). La necesita Cunningham. */
  mlgKg?: number | null
  geeEntradas?: EntradaGEE[]
  geeTotal?: number | null
  getCunningham?: number | null
  disponibilidadEnergetica?: number | null
}
