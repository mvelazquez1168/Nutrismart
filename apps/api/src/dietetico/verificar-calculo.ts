/**
 * Comprobacion de la FASE 2: la aritmetica del calculo en dos fases.
 *
 * `npm run verificar:calculo -w @nutrismart/api`
 *
 * ## Por que no llama a la IA
 *
 * La fase 1 se simula: cada caso trae el JSON que el modelo deberia devolver
 * —alimento elegido, cantidad y unidad— y la prueba ejecuta de ahi en adelante.
 * Es deliberado y es lo que la hace util:
 *
 *   - **Corre sin ANTHROPIC_API_KEY y sin gastar saldo.** Una comprobacion que
 *     cuesta dinero se deja de correr.
 *   - **Es determinista.** Si fallara por una eleccion distinta del modelo, el
 *     resultado no diria nada sobre la aritmetica, que es lo que se comprueba.
 *
 * Lo que la fase 1 hace —emparejar «leche descremada» con la fila «leche 0%
 * grasa»— no se puede comprobar asi, y no se intenta. Lo que se comprueba es
 * que, dada esa eleccion, el numero sea el correcto.
 *
 * ## De donde salen los valores esperados
 *
 * Calculados a mano desde el documento de intercambios, no tomados de lo que el
 * codigo devuelve: una prueba que compara el codigo contra si mismo pasa
 * siempre. El alimento se busca por su nombre EN LA BASE, asi que la prueba
 * tambien falla si alguien cambia la fila sembrada.
 */
import { leerGrupos } from './intercambios.js'
import { leerCatalogo, type AlimentoIdentificado } from './identificacion.js'
import { calcular, PORCIONES_MAX } from './calculo.js'
import { pool } from '../db.js'

const CLINICA = '11111111-1111-1111-1111-111111111111'

interface Caso {
  /** Lo que escribiria el profesional. */
  descripcion: string
  /** La fila que la fase 1 deberia elegir, por su nombre en la base. */
  alimento: string
  /** Lo que la fase 1 deberia extraer del texto. */
  cantidad: number | null
  unidad: string | null
  esperado:
    | { porciones: number; cho_g: number; chon_g: number; grasa_g: number; kcal: number }
    | 'unidades_incompatibles'
    | 'porciones_absurdas'
  porque: string
}

const CASOS: Caso[] = [
  /* ── Los cinco casos del requerimiento ───────────────────────────── */
  {
    descripcion: '250 ml de leche descremada',
    // El requerimiento nombra la fila «Leche liquida con y sin lactosa 0%
    // grasa»; la sembrada en la migracion 048 es «leche 0% grasa». Es la misma
    // fila del documento con el nombre que tiene en esta base.
    alimento: 'leche 0% grasa',
    cantidad: 250,
    unidad: 'ml',
    esperado: { porciones: 1.04, cho_g: 12.48, chon_g: 8.32, grasa_g: 1.56, kcal: 104 },
    porque: '250 ml / (1 tz = 240 ml) = 1.04 porciones de lacteo descremado',
  },
  {
    descripcion: '1 huevo',
    alimento: 'huevo entero',
    cantidad: 1,
    unidad: null,
    esperado: { porciones: 1, cho_g: 0, chon_g: 7, grasa_g: 5, kcal: 75 },
    porque: 'una cuenta contra una cuenta: 1 unidad / 1 unidad = 1 proteina semimagra',
  },
  {
    descripcion: '1 taza de arroz cocido',
    alimento: 'arroz blanco',
    cantidad: 1,
    unidad: 'taza',
    esperado: { porciones: 2, cho_g: 30, chon_g: 6, grasa_g: 2, kcal: 160 },
    porque:
      '240 ml / (½ tz = 120 ml) = 2 harinas. La fila tambien da 90 g, y se usa la lectura volumetrica porque el profesional escribio volumen',
  },
  {
    descripcion: '½ taza de frijoles',
    alimento: 'frijoles',
    cantidad: 0.5,
    unidad: 'taza',
    esperado: { porciones: 1, cho_g: 15, chon_g: 10, grasa_g: 3, kcal: 125 },
    porque: '1 porcion = 1 harina + 1 proteina magra: 15+0 CHO, 3+7 CHON, 80+45 kcal',
  },
  {
    descripcion: '3 cucharadas de leche en polvo descremada',
    alimento: 'leche en polvo descremada',
    cantidad: 3,
    unidad: 'cucharadas',
    esperado: { porciones: 1, cho_g: 12, chon_g: 8, grasa_g: 1.5, kcal: 100 },
    porque: '45 ml / (3 cdas = 45 ml) = 1 lacteo descremado',
  },

  /* ── Los dos rechazos, que son la razon de ser de la fase 2 ───────── */
  {
    descripcion: '250 ml de huevo',
    alimento: 'huevo entero',
    cantidad: 250,
    unidad: 'ml',
    esperado: 'unidades_incompatibles',
    porque:
      'volumen contra una cuenta: dividir daria 250 porciones. Es el caso que pide volver a preguntarle al modelo por otra fila',
  },
  {
    descripcion: '1 libra de pollo',
    alimento: 'pollo sin piel',
    cantidad: 1,
    unidad: 'libra',
    esperado: 'porciones_absurdas',
    porque: `453.59 g / 30 g = 15.12 porciones, por encima del tope de ${PORCIONES_MAX} para un alimento simple`,
  },

  /* ── Lo que no se debe romper al cambiar la arquitectura ─────────── */
  {
    descripcion: '180 g de arroz blanco',
    alimento: 'arroz blanco',
    cantidad: 180,
    unidad: 'g',
    esperado: { porciones: 2, cho_g: 30, chon_g: 6, grasa_g: 2, kcal: 160 },
    porque:
      'gramos contra gramos: 180 / 90 = 2. La misma fila que el caso de la taza, leida por su otra cantidad',
  },
  {
    descripcion: '2 rebanadas de pan cuadrado light',
    alimento: 'pan cuadrado light',
    cantidad: 2,
    unidad: 'rebanadas',
    esperado: { porciones: 1, cho_g: 15, chon_g: 3, grasa_g: 1, kcal: 80 },
    porque: 'la porcion de referencia son DOS rebanadas: 2/2 = 1 harina, no 2',
  },
  {
    descripcion: 'leche 0% grasa, sin cantidad',
    alimento: 'leche 0% grasa',
    cantidad: null,
    unidad: null,
    esperado: { porciones: 1, cho_g: 12, chon_g: 8, grasa_g: 1.5, kcal: 100 },
    porque: 'sin cantidad se asume una porcion, y la suposicion viaja marcada',
  },
]

/** El JSON que la fase 1 devolveria para un caso, ya con su indice resuelto. */
function comoLoDariaElModelo(c: Caso, indice: number): AlimentoIdentificado {
  return {
    descripcion_usuario: c.descripcion,
    alimento_encontrado: c.alimento,
    cantidad_usuario: c.cantidad,
    unidad_usuario: c.unidad,
    equivalencia_id: indice,
    // Se dejan en null a proposito: la fase 2 no los usa —toma la porcion de
    // referencia de la base— y ponerlos aqui esconderia si los usara.
    cantidad_porcion_referencia: null,
    unidad_porcion_referencia: null,
    grupos: [],
    encontrado: true,
    nota: null,
  }
}

const [catalogo, grupos] = await Promise.all([leerCatalogo(CLINICA), leerGrupos(CLINICA)])
const porNombre = new Map(catalogo.map((e) => [e.alimento.toLowerCase(), e]))

let fallos = 0
const pad = (v: unknown, n: number) => String(v).padEnd(n)

for (const c of CASOS) {
  const entrada = porNombre.get(c.alimento.toLowerCase())
  if (!entrada) {
    fallos++
    console.log('FALLA ' + pad(c.descripcion, 42) + '-> la fila "' + c.alimento + '" no esta en la base')
    continue
  }

  const r = calcular(comoLoDariaElModelo(c, entrada.indice), entrada, grupos)

  if (c.esperado === 'unidades_incompatibles' || c.esperado === 'porciones_absurdas') {
    const ok = r.estado === c.esperado
    if (!ok) fallos++
    console.log(
      (ok ? 'OK    ' : 'FALLA ') +
        pad(c.descripcion, 42) +
        '-> ' +
        (ok
          ? c.esperado + ' (correcto)'
          : 'dio "' + r.estado + '"' +
            (r.estado === 'ok' ? ' con ' + r.porciones + ' porciones' : '') +
            ', se esperaba "' + c.esperado + '"'),
    )
    if (!ok) console.log('       ' + c.porque)
    continue
  }

  if (r.estado !== 'ok') {
    fallos++
    console.log('FALLA ' + pad(c.descripcion, 42) + '-> "' + r.estado + '" y deberia calcular')
    console.log('       ' + c.porque)
    continue
  }

  const e = c.esperado
  const m = r.macros
  const cerca = (a: number, b: number) => Math.abs(a - b) < 0.05
  const ok =
    cerca(r.porciones, e.porciones) &&
    cerca(m.cho_g, e.cho_g) &&
    cerca(m.chon_g, e.chon_g) &&
    cerca(m.grasa_g, e.grasa_g) &&
    cerca(m.kcal, e.kcal)
  if (!ok) fallos++

  console.log(
    (ok ? 'OK    ' : 'FALLA ') +
      pad(c.descripcion, 42) +
      '-> ' + pad(r.porciones + ' porc', 11) +
      'CHO ' + pad(m.cho_g, 7) +
      'CHON ' + pad(m.chon_g, 7) +
      'GRASA ' + pad(m.grasa_g, 7) +
      'KCAL ' + pad(m.kcal, 7) +
      '[' + entrada.alimento + ' / ' + entrada.cantidadDescripcion +
      (r.porcionesSupuestas ? ' — porciones SUPUESTAS' : '') + ']',
  )
  if (!ok) {
    console.log(
      '       esperado: %s porc, CHO %s CHON %s GRASA %s KCAL %s — %s',
      e.porciones, e.cho_g, e.chon_g, e.grasa_g, e.kcal, c.porque,
    )
  }
}

console.log('')
console.log(fallos === 0 ? 'TODOS LOS CASOS PASAN' : fallos + ' CASO(S) FALLAN')
await pool.end()
process.exit(fallos === 0 ? 0 : 1)
