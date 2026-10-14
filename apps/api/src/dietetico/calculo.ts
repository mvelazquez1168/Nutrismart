/**
 * FASE 2 — el servidor hace toda la aritmetica.
 *
 * Entra lo que el modelo identifico (fase 1) y la fila del catalogo que eligio;
 * sale un numero de porciones y los macros, calculados contra las filas de
 * `grupo_intercambio`. El modelo no participa de nada de lo que pasa aca.
 *
 * ## Las tres cosas que este modulo se niega a hacer
 *
 * 1. **Dividir sistemas distintos.** Mililitros entre unidades no es una
 *    division, es un error de 250 veces (ver `unidades.ts`). Se devuelve
 *    `unidades_incompatibles` para que la fase 1 busque otra fila.
 *
 * 2. **Devolver un numero absurdo.** Un resultado de 40 porciones de un
 *    alimento simple casi siempre significa que la unidad se leyo mal, no que
 *    alguien comio cuarenta porciones. Se rechaza y se registra.
 *
 * 3. **Suponer en silencio.** Cuando no hay cantidad se asume una porcion, como
 *    hacia el calculo anterior, pero la suposicion viaja marcada hasta la
 *    pantalla: una suposicion silenciosa en un calculo clinico es
 *    indistinguible de una medicion.
 */
import {
  macrosDePorciones,
  type GrupoIntercambio,
  type Macros,
} from './intercambios.js'
import type { AlimentoIdentificado, EntradaCatalogo } from './identificacion.js'
import { compatibles, elegirReferencia, lecturasReferencia, medir, type Medida } from './unidades.js'

/**
 * Tope de sensatez para un alimento simple.
 *
 * Quince porciones de un alimento simple son 450 g de pollo o 15 tazas de
 * arroz. Existe, pero es raro; y lo que produce estos numeros casi siempre es
 * una unidad mal emparejada que paso la comprobacion de sistema. Rechazar pide
 * al profesional una frase mas precisa; aceptar le da un total equivocado que
 * nadie va a recalcular.
 */
export const PORCIONES_MAX = 15

/**
 * El mensaje unico de los dos fallos terminales.
 *
 * Son el mismo problema visto de dos maneras —la cantidad escrita no se puede
 * comparar con la unidad de la fila que se encontro— y la salida es la misma:
 * escribir la cantidad de otro modo. Dos redacciones distintas para una sola
 * accion solo obligan al profesional a decidir cual le toca.
 */
export const MENSAJE_INCALCULABLE =
  'No se pudo calcular — la cantidad ingresada parece incompatible con la unidad del alimento encontrado. Intente especificar más (ej: \'1 taza de leche descremada\').'

export type Calculo =
  | {
      estado: 'ok'
      porciones: number
      porcionesSupuestas: boolean
      usuario: Medida | null
      referencia: Medida
      macros: Macros
    }
  | { estado: 'unidades_incompatibles'; usuario: Medida; referencia: Medida[] }
  | { estado: 'porciones_absurdas'; porciones: number; usuario: Medida; referencia: Medida }
  | { estado: 'cantidad_invalida' }

/** Dos decimales, el mismo criterio que el resto del sistema de intercambios. */
function redondear(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Una preparacion compuesta es la que toca mas de un grupo.
 *
 * Es lo que distingue el pan figazza —3 harinas + 1 proteina + 1 grasa, una
 * receta— de un alimento simple como el pollo. El tope de sensatez se aplica
 * solo a los simples porque en una preparacion las porciones por referencia ya
 * son varias y el umbral se alcanza con cantidades normales.
 *
 * Los frijoles (1 harina + 1 proteina magra) caen del lado «compuesto» aunque
 * sean un alimento simple, y por eso se saltan el tope. El error va hacia
 * aceptar: perder la comprobacion en unas pocas filas es preferible a rechazar
 * un calculo correcto, que es lo que el profesional no puede arreglar.
 */
export function esCompuesta(entrada: EntradaCatalogo): boolean {
  const distintos = new Set(entrada.porciones.map((p) => String(p.grupo_id).toLowerCase()))
  return distintos.size > 1
}

/**
 * Las porciones y los macros de un alimento identificado.
 *
 * La porcion de referencia sale de `entrada` —la fila de la base—, no de lo que
 * el modelo dijo que decia la fila. Ver `cotejarReferencia` para la
 * comprobacion de que las dos coinciden.
 */
export function calcular(
  identificado: AlimentoIdentificado,
  entrada: EntradaCatalogo,
  grupos: Map<string, GrupoIntercambio>,
): Calculo {
  const lecturas = lecturasReferencia(entrada.cantidadDescripcion, entrada.cantidadG)
  if (lecturas.length === 0) {
    // La fila no da ninguna cantidad legible. No deberia pasar —la columna es
    // `not null`— pero si pasa, suponer una porcion es lo unico honesto.
    return {
      estado: 'ok',
      porciones: 1,
      porcionesSupuestas: true,
      usuario: null,
      referencia: { sistema: 'unidades', base: 1, unidad: null },
      macros: macrosDePorciones(entrada.porciones, 1, grupos),
    }
  }

  // Sin cantidad no hay division posible: se asume una porcion y se marca.
  if (identificado.cantidad_usuario === null) {
    return {
      estado: 'ok',
      porciones: 1,
      porcionesSupuestas: true,
      usuario: null,
      referencia: lecturas[0]!,
      macros: macrosDePorciones(entrada.porciones, 1, grupos),
    }
  }

  const usuario = medir(identificado.cantidad_usuario, identificado.unidad_usuario)
  if (usuario === null) return { estado: 'cantidad_invalida' }

  const referencia = elegirReferencia(usuario, lecturas)
  if (referencia === null) {
    return { estado: 'unidades_incompatibles', usuario, referencia: lecturas }
  }

  const porciones = redondear(usuario.base / referencia.base)

  if (!esCompuesta(entrada) && porciones > PORCIONES_MAX) {
    return { estado: 'porciones_absurdas', porciones, usuario, referencia }
  }

  return {
    estado: 'ok',
    porciones,
    porcionesSupuestas: false,
    usuario,
    referencia,
    macros: macrosDePorciones(entrada.porciones, porciones, grupos),
  }
}

/**
 * Cotejo entre lo que el modelo dijo de la fila y lo que la fila dice.
 *
 * No cambia ningun calculo —los numeros ya salieron de la base— y existe para
 * que una deriva del modelo deje rastro en vez de pasar inadvertida: si empieza
 * a reportar porciones de referencia que no son las de la tabla, lo esta
 * adivinando en lugar de copiarlo, y eso se ve en los registros antes de que
 * alguien lo note en una consulta.
 */
export function cotejarReferencia(
  identificado: AlimentoIdentificado,
  entrada: EntradaCatalogo,
): string[] {
  const avisos: string[] = []

  if (
    identificado.alimento_encontrado !== null &&
    identificado.alimento_encontrado.toLowerCase() !== entrada.alimento.toLowerCase()
  ) {
    avisos.push(
      `nombre: el modelo dijo "${identificado.alimento_encontrado}" y la fila ${entrada.indice} es "${entrada.alimento}"`,
    )
  }

  const dicho = medir(
    identificado.cantidad_porcion_referencia,
    identificado.unidad_porcion_referencia,
  )
  if (dicho !== null) {
    const lecturas = lecturasReferencia(entrada.cantidadDescripcion, entrada.cantidadG)
    const igual = lecturas.some(
      (l) => compatibles(l, dicho) && Math.abs(l.base - dicho.base) < 0.01,
    )
    if (!igual) {
      avisos.push(
        `porcion: el modelo dijo ${identificado.cantidad_porcion_referencia} ${identificado.unidad_porcion_referencia ?? '(sin unidad)'} y la fila dice "${entrada.cantidadDescripcion}"`,
      )
    }
  }

  const dela = new Set(entrada.porciones.map((p) => String(p.grupo_id).toLowerCase()))
  for (const g of identificado.grupos) {
    if (!dela.has(g.grupo.toLowerCase())) {
      avisos.push(`grupo: el modelo nombro "${g.grupo}", que la fila no usa`)
    }
  }

  return avisos
}
