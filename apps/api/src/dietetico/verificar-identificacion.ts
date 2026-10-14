/**
 * Comprobacion de la FASE 1 contra la IA real: que fila del catalogo elige.
 *
 * `npm run verificar:identificacion -w @nutrismart/api`
 *
 * ## Cuesta dinero, y por eso esta aparte
 *
 * `verificar:calculo` comprueba la aritmetica sin gastar saldo y se puede correr
 * siempre. Esta comprueba lo otro —que el modelo empareje «leche descremada»
 * con la fila «leche 0% grasa»— y para eso hay que llamarlo: son cinco llamadas
 * con el catalogo entero en cada prompt. Correrla despues de tocar el prompt de
 * la fase 1 o el catalogo; no en cada guardado.
 *
 * ## Que se comprueba y que no
 *
 * Que la fila elegida sea la esperada y que la cantidad y la unidad salgan
 * partidas del texto. Los macros NO se comprueban aca: los calcula la fase 2 y
 * su prueba es la otra. Si esta pasa y aquella pasa, el camino completo esta
 * cubierto.
 *
 * Un fallo aqui no es necesariamente un defecto: el modelo puede elegir una
 * fila distinta y defendible. Lo que el fallo dice es «mira esto», no
 * «arreglalo».
 */
import { leerCatalogo, construirPromptIdentificacion, parsearIdentificacion } from './identificacion.js'
import { medir } from './unidades.js'
import { llamarClaude, IaNoDisponibleError } from '../ia/cliente.js'
import { pool } from '../db.js'

const CLINICA = '11111111-1111-1111-1111-111111111111'

interface Caso {
  texto: string
  /** El nombre de la fila que deberia elegir, como esta en la base. */
  fila: string
  cantidad: number | null
  /** La unidad normalizada que deberia extraer. null = sin unidad (una cuenta). */
  unidad: string | null
}

const CASOS: Caso[] = [
  { texto: '250 ml de leche descremada', fila: 'leche 0% grasa', cantidad: 250, unidad: 'ml' },
  { texto: '1 huevo', fila: 'huevo entero', cantidad: 1, unidad: null },
  { texto: '1 taza de arroz cocido', fila: 'arroz blanco', cantidad: 1, unidad: 'taza' },
  { texto: '1/2 taza de frijoles', fila: 'frijoles', cantidad: 0.5, unidad: 'taza' },
  {
    texto: '3 cucharadas de leche en polvo descremada',
    fila: 'leche en polvo descremada',
    cantidad: 3,
    unidad: 'cucharada',
  },
]

const catalogo = await leerCatalogo(CLINICA)
console.log('Catalogo: %d filas visibles para la clinica de pruebas.\n', catalogo.length)

let fallos = 0
let tokensEntrada = 0
let tokensSalida = 0

for (const c of CASOS) {
  let texto: string
  try {
    const r = await llamarClaude(construirPromptIdentificacion(c.texto, catalogo), {
      clinicaId: CLINICA,
      profesionalId: null,
      funcion: 'identificacion_dietetica',
    })
    texto = r.texto
    tokensEntrada += r.tokensEntrada
    tokensSalida += r.tokensSalida
  } catch (e) {
    fallos++
    const motivo = e instanceof IaNoDisponibleError ? e.tipo : String(e)
    console.log('FALLA %s -> la IA no respondio (%s)', c.texto, motivo)
    continue
  }

  const identificados = parsearIdentificacion(texto)
  const i = identificados[0]
  if (!i) {
    fallos++
    console.log('FALLA %s -> el modelo no devolvio ningun alimento', c.texto)
    continue
  }

  const fila = catalogo.find((e) => e.indice === i.equivalencia_id)
  /*
   * **La unidad se compara por lo que MIDE, no por como se escribe.**
   *
   * El modelo devuelve «cucharadas», «cucharada» o «cdas» segun el dia, y las
   * tres valen 15 ml: la fase 2 calcula lo mismo con cualquiera de ellas. Una
   * comparacion de cadenas marcaba esto como fallo, y un fallo que no cambia
   * ningun numero entrena a ignorar la prueba.
   */
  const mismaUnidad = (() => {
    const a = medir(1, i.unidad_usuario)
    const b = medir(1, c.unidad)
    if (a === null || b === null) return a === b
    return a.sistema === b.sistema && Math.abs(a.base - b.base) < 0.01
  })()
  const ok =
    fila?.alimento.toLowerCase() === c.fila.toLowerCase() &&
    (c.cantidad === null
      ? i.cantidad_usuario === null
      : i.cantidad_usuario !== null && Math.abs(i.cantidad_usuario - c.cantidad) < 0.01) &&
    mismaUnidad
  if (!ok) fallos++

  console.log(
    (ok ? 'OK    ' : 'FALLA ') +
      c.texto.padEnd(42) +
      '-> ' +
      (fila?.alimento ?? '(id ' + i.equivalencia_id + ' inexistente)').padEnd(28) +
      'cant=' + String(i.cantidad_usuario).padEnd(6) +
      'unid=' + String(i.unidad_usuario).padEnd(12) +
      (i.encontrado ? '' : ' [encontrado: false]'),
  )
  if (!ok) {
    console.log(
      '       esperado: fila "%s", cantidad %s, unidad %s%s',
      c.fila, c.cantidad, c.unidad,
      i.nota === null ? '' : ' — nota del modelo: ' + i.nota,
    )
  }

  // Lo que el modelo dijo de la porcion de referencia no entra en ningun
  // calculo (la fase 2 la toma de la base), pero se imprime: es la senal de si
  // esta copiando la fila o adivinandola.
  if (fila) {
    console.log(
      '       porcion segun el modelo: %s %s — la fila dice "%s"',
      i.cantidad_porcion_referencia, i.unidad_porcion_referencia ?? '(sin unidad)',
      fila.cantidadDescripcion,
    )
  }
}

console.log('')
console.log('Consumo: %d tokens de entrada, %d de salida.', tokensEntrada, tokensSalida)
console.log(fallos === 0 ? 'TODOS LOS CASOS PASAN' : fallos + ' CASO(S) FALLAN')
await pool.end()
process.exit(fallos === 0 ? 0 : 1)
