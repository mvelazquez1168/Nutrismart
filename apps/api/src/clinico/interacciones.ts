/**
 * Interacciones fármaco–nutriente — apoyo a EVAL-03.
 *
 * QUÉ ES ESTO, con precisión: una lista curada y corta de interacciones
 * bien documentadas, para que no se pasen por alto. NO es un
 * comprobador de interacciones.
 *
 * La distinción no es retórica. Un comprobador que conoce seis
 * principios activos y responde «sin interacciones» ante los otros mil
 * es peor que no tener nada, porque convierte su propia ignorancia en
 * una afirmación tranquilizadora. Por eso la API devuelve también los
 * medicamentos que NO reconoció: quien lee la pantalla tiene que poder
 * ver el alcance real de la comprobación.
 *
 * Encaja con la regla del proyecto para la IA —asiste, el profesional
 * decide— aunque aquí no haya modelo de por medio: es una ayuda de
 * memoria, y se presenta como tal.
 *
 * Ampliar esta lista es añadir entradas; sustituirla por una base de
 * datos farmacológica de verdad es otra épica.
 */

export type Severidad = 'info' | 'advertencia' | 'importante'

export interface Interaccion {
  /** Lo que el profesional escribió. */
  medicamento: string
  /** Principio activo con el que se emparejó. */
  principio: string
  nutrientes: string[]
  tipo: 'absorcion_reducida' | 'deplecion' | 'interferencia' | 'multiple'
  recomendacion: string
  severidad: Severidad
}

interface Regla {
  principio: string
  /** Coincidencias por subcadena, ya normalizadas. */
  alias: string[]
  nutrientes: string[]
  tipo: Interaccion['tipo']
  recomendacion: string
  severidad: Severidad
}

const REGLAS: Regla[] = [
  {
    principio: 'Metformina',
    alias: ['metformina', 'metformin'],
    nutrientes: ['Vitamina B12'],
    tipo: 'absorcion_reducida',
    recomendacion:
      'El uso prolongado puede reducir la absorción de B12. Conviene vigilar los niveles en tratamientos de más de un año.',
    severidad: 'advertencia',
  },
  {
    principio: 'Levotiroxina',
    alias: ['levotiroxina', 'levothyroxine', 'eutirox', 'synthroid'],
    nutrientes: ['Calcio', 'Hierro'],
    tipo: 'absorcion_reducida',
    recomendacion:
      'Tomar en ayunas, 30-60 minutos antes del desayuno. Separar al menos 4 horas de lácteos, calcio y suplementos de hierro.',
    severidad: 'advertencia',
  },
  {
    principio: 'Warfarina',
    alias: ['warfarina', 'warfarin', 'coumadin', 'acenocumarol'],
    nutrientes: ['Vitamina K'],
    tipo: 'interferencia',
    recomendacion:
      'Mantener un consumo CONSTANTE de vitamina K (hoja verde). El problema no es comerla, es cambiar bruscamente la cantidad: cualquier ajuste del plan debe coordinarse con quien controla la anticoagulación.',
    severidad: 'importante',
  },
  {
    principio: 'Atorvastatina y otras estatinas',
    alias: ['atorvastatina', 'simvastatina', 'rosuvastatina', 'estatina', 'statin'],
    nutrientes: ['Coenzima Q10'],
    tipo: 'deplecion',
    recomendacion:
      'Pueden reducir la coenzima Q10 endógena. Relevante si aparecen mialgias; la suplementación es una decisión clínica, no automática.',
    severidad: 'info',
  },
  {
    principio: 'Omeprazol y otros inhibidores de la bomba de protones',
    alias: ['omeprazol', 'esomeprazol', 'pantoprazol', 'lansoprazol', 'prazol'],
    nutrientes: ['Vitamina B12', 'Magnesio', 'Hierro', 'Calcio'],
    tipo: 'absorcion_reducida',
    recomendacion:
      'Con uso crónico (más de un año) conviene vigilar B12 y magnesio. La menor acidez reduce también la absorción de hierro y calcio.',
    severidad: 'advertencia',
  },
  {
    principio: 'Corticosteroides',
    alias: ['prednisona', 'prednisolona', 'dexametasona', 'corticoide', 'hidrocortisona'],
    nutrientes: ['Calcio', 'Vitamina D', 'Potasio'],
    tipo: 'multiple',
    recomendacion:
      'Aumentan la pérdida de calcio y potasio y elevan la glucemia. Asegurar calcio y vitamina D, y vigilar el potasio en tratamientos prolongados.',
    severidad: 'advertencia',
  },
  {
    principio: 'Diuréticos de asa',
    alias: ['furosemida', 'torasemida', 'bumetanida'],
    nutrientes: ['Potasio', 'Magnesio', 'Sodio'],
    tipo: 'deplecion',
    recomendacion:
      'Aumentan la excreción de potasio y magnesio. Vigilar electrolitos y valorar fuentes dietéticas de potasio.',
    severidad: 'advertencia',
  },
  {
    principio: 'Isoniazida',
    alias: ['isoniazida', 'isoniacida'],
    nutrientes: ['Vitamina B6'],
    tipo: 'deplecion',
    recomendacion:
      'Antagoniza la vitamina B6; la suplementación suele acompañar al tratamiento para prevenir neuropatía.',
    severidad: 'advertencia',
  },
]

/**
 * Normaliza para comparar: minúsculas y sin diacríticos.
 *
 * Un profesional escribe «Levotiroxina» o «levotiroxina»; comparar en
 * crudo fallaría por la mayúscula y el aviso no saldría.
 */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

export interface ResultadoInteracciones {
  interacciones: Interaccion[]
  /**
   * Medicamentos que la lista no reconoce.
   *
   * Se devuelven a propósito: sin esto, «no se detectaron
   * interacciones» sonaría a comprobación completa cuando puede
   * significar que no se conoce ninguno de los fármacos del paciente.
   */
  noReconocidos: string[]
  /** Cuántos principios activos cubre la lista hoy. */
  cobertura: number
}

export function revisarInteracciones(medicamentos: string[]): ResultadoInteracciones {
  const interacciones: Interaccion[] = []
  const noReconocidos: string[] = []

  for (const medicamento of medicamentos) {
    const nombre = normalizar(medicamento)
    if (nombre === '') continue

    const regla = REGLAS.find((r) => r.alias.some((a) => nombre.includes(a)))
    if (!regla) {
      noReconocidos.push(medicamento)
      continue
    }

    interacciones.push({
      medicamento,
      principio: regla.principio,
      nutrientes: regla.nutrientes,
      tipo: regla.tipo,
      recomendacion: regla.recomendacion,
      severidad: regla.severidad,
    })
  }

  // Lo importante primero: si hay varias, la que exige coordinación con
  // otro profesional no puede quedar debajo de una informativa.
  const orden: Record<Severidad, number> = { importante: 0, advertencia: 1, info: 2 }
  interacciones.sort((a, b) => orden[a.severidad] - orden[b.severidad])

  return { interacciones, noReconocidos, cobertura: REGLAS.length }
}
