/**
 * Comprobacion de R43: la convencion de los parentesis y la lectura del PDF.
 *
 * `npm run verificar:labs-pdf -w @nutrismart/api`
 *
 * ## Por que no llama a la IA
 *
 * Misma razon que `verificar:calculo`: la respuesta del modelo se SIMULA. Cada
 * caso trae el JSON que deberia devolver, y la prueba ejecuta de ahi en
 * adelante.
 *
 *   - **Corre sin ANTHROPIC_API_KEY y sin gastar saldo.** Una comprobacion que
 *     cuesta dinero se deja de correr.
 *   - **Es determinista.** Si fallara porque el modelo leyo el informe de otra
 *     manera, el resultado no diria nada sobre lo que se comprueba, que es el
 *     trato que se le da a su respuesta.
 *
 * Lo que el modelo hace —reconocer que «Glicemia en ayunas» es el codigo del
 * catalogo— no se comprueba aqui, y no se intenta. Lo que se comprueba es que
 * un codigo inventado NO entre como valor, que un «< 5» no se convierta en
 * numero y que un repetido no pise al anterior.
 *
 * ## El PDF es de verdad
 *
 * El bloque de extraccion genera un PDF con Chromium —puppeteer, que ya se usa
 * para exportar el expediente— y le pasa `extraerTextoPdf`. Un PDF de juguete
 * escrito a mano no probaria nada: lo que puede romperse es la libreria.
 *
 * Si Chromium no esta disponible, ese bloque se SALTA con aviso y los otros
 * dos siguen corriendo. Lo contrario —fallar— haria que un entorno sin
 * navegador pareciera un error de este codigo.
 */
import { alimentosEntreParentesis, textoAAnalizar } from '../dietetico/parentesis.js'
import { extraerTextoPdf, interpretarLectura } from './pdf.js'
import type { BiomarcadorConocido } from './csv.js'
import { obtenerCatalogoSimple } from './repositorio.js'
import { pool } from '../db.js'

let fallos = 0

function comprobar(ok: boolean, titulo: string, detalle: string): void {
  if (!ok) fallos++
  console.log('  %s %s', ok ? 'OK  ' : 'FALLA', titulo)
  if (!ok) console.log('        %s', detalle)
}

/* ------------------------------------------------------------------ */
/* 1. La convencion de los parentesis                                  */
/* ------------------------------------------------------------------ */

interface CasoParentesis {
  titulo: string
  texto: string
  tipo: string
  /**
   * Lo que se manda a identificar.
   *
   * `'TEXTO'` = el texto entero, tal cual (Recordatorio 24 h).
   * `null` = **no se analiza** (Consumo Usual sin parentesis, R45).
   */
  esperado: string | null | 'TEXTO'
  porque: string
}

const CASOS_PARENTESIS: CasoParentesis[] = [
  {
    titulo: 'CONSUMO USUAL sin parentesis: NO se analiza (R45)',
    texto: '250 ml de leche descremada y 1 taza de arroz cocido',
    tipo: 'consumo_usual',
    esperado: null,
    porque:
      'R43 analizaba el texto entero; se revirtio porque el relato entraba al modelo y salian raciones que nadie escribio',
  },
  {
    titulo: 'un alimento marcado: solo ese',
    texto: 'Desayuna tarde porque entra a las 6, casi siempre (1 taza de cafe con leche)',
    tipo: 'consumo_usual',
    esperado: '1 taza de cafe con leche',
    porque: 'el relato no es un alimento y el modelo lo convertia en raciones',
  },
  {
    titulo: 'dos alimentos marcados: los dos, separados por coma',
    texto: 'casi siempre (1 taza de cafe con leche) y (2 rebanadas de pan) antes de salir',
    tipo: 'consumo_usual',
    esperado: '1 taza de cafe con leche, 2 rebanadas de pan',
    porque: 'la fase 1 parte por comas: unirlos asi es la forma que ya sabe leer',
  },
  {
    titulo: 'parentesis sin cerrar: vale hasta el final',
    texto: 'a veces (2 rebanadas de pan',
    tipo: 'consumo_usual',
    esperado: '2 rebanadas de pan',
    porque: 'es lo que queda al guardar a medio escribir; descartarlo perderia el alimento',
  },
  {
    titulo: 'parentesis vacio: tampoco se analiza',
    texto: 'no recuerda () bien',
    tipo: 'consumo_usual',
    esperado: null,
    porque: 'un grupo vacio no marca ningun alimento, asi que no hay nada que buscar',
  },
  {
    titulo: 'RECORDATORIO 24 H: no recorta aunque haya parentesis',
    texto: '2 tazas de cafe (sin azucar), 2 tostadas con mantequilla',
    tipo: 'recordatorio_24h',
    esperado: 'TEXTO',
    porque:
      'ahi un parentesis es una aclaracion; recortar dejaria «sin azucar» como el unico alimento',
  },
  {
    titulo: 'RECORDATORIO 24 H sin parentesis: se analiza entero',
    texto: '2 tazas de cafe con leche, 2 tostadas',
    tipo: 'recordatorio_24h',
    esperado: 'TEXTO',
    porque: 'la regla de los parentesis es solo de Consumo Usual',
  },
]

console.log('')
console.log('1. Convencion de los parentesis (dietetico/parentesis.ts)')
console.log('')

for (const c of CASOS_PARENTESIS) {
  const obtenido = textoAAnalizar(c.texto, c.tipo)
  const esperado = c.esperado === 'TEXTO' ? c.texto : c.esperado
  const muestra = obtenido === null ? 'NO SE ANALIZA' : `«${obtenido}»`
  comprobar(
    obtenido === esperado,
    `${c.titulo} — ${muestra}`,
    `esperado ${esperado === null ? 'null (no analizar)' : `«${esperado}»`} — ${c.porque}`,
  )
}

// El recorte crudo, aparte del despacho por tipo: null distingue «no hay
// marcas» de «hay marcas vacias», y es lo que decide la compatibilidad.
comprobar(
  alimentosEntreParentesis('sin marcas') === null,
  'alimentosEntreParentesis devuelve null sin marcas',
  'un string vacio haria que se analizara la nada',
)
comprobar(
  alimentosEntreParentesis('(a) (b) (c)') === 'a, b, c',
  'alimentosEntreParentesis une los grupos por comas',
  'obtenido: ' + String(alimentosEntreParentesis('(a) (b) (c)')),
)

/* ------------------------------------------------------------------ */
/* 2. Extraccion del texto de un PDF de verdad                         */
/* ------------------------------------------------------------------ */

console.log('')
console.log('2. Extraccion del texto del PDF (laboratorios/pdf.ts)')
console.log('')

const HTML_INFORME = `<!doctype html><html><body style="font-family: sans-serif">
<h1>Laboratorio Clinico Vida</h1>
<p>Paciente: Maria Rodriguez — Fecha de toma: 2026-10-15</p>
<table>
  <tr><td>Glucosa en ayunas</td><td>95</td><td>mg/dL</td></tr>
  <tr><td>Colesterol total</td><td>212</td><td>mg/dL</td></tr>
  <tr><td>Hemoglobina glicosilada</td><td>5.8</td><td>%</td></tr>
  <tr><td>Ferritina</td><td>45.2</td><td>ng/mL</td></tr>
</table>
</body></html>`

async function generarPdfDePrueba(): Promise<Buffer | null> {
  try {
    const puppeteer = await import('puppeteer')
    const navegador = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })
    try {
      const pagina = await navegador.newPage()
      await pagina.setContent(HTML_INFORME, { waitUntil: 'load' })
      const bytes = await pagina.pdf({ format: 'a4', printBackground: true })
      return Buffer.from(bytes)
    } finally {
      await navegador.close()
    }
  } catch (e) {
    console.log('  AVISO Chromium no esta disponible; se salta este bloque.')
    console.log('        %s', e instanceof Error ? e.message : String(e))
    return null
  }
}

const pdf = await generarPdfDePrueba()
if (pdf) {
  const texto = await extraerTextoPdf(pdf)
  console.log('  (texto extraido: %d caracteres)', texto.length)

  for (const buscado of ['Glucosa en ayunas', '95', 'Colesterol total', '212', '5.8', 'Ferritina']) {
    comprobar(
      texto.includes(buscado),
      `el texto contiene «${buscado}»`,
      'no aparece en lo extraido: ' + texto.slice(0, 200),
    )
  }

  // El tope de los 50 caracteres es lo que distingue un informe de un
  // escaneado. Un informe de verdad lo pasa de sobra.
  comprobar(
    texto.length >= 50,
    'el informe pasa el minimo de 50 caracteres',
    `solo ${texto.length}: se trataria como escaneado`,
  )
}

/* ------------------------------------------------------------------ */
/* 3. El trato que se le da a la respuesta del modelo                  */
/* ------------------------------------------------------------------ */

console.log('')
console.log('3. Lectura de la respuesta del modelo (interpretarLectura)')
console.log('')

/**
 * El catalogo de la base si esta disponible; si no, uno minimo.
 *
 * Correr contra la base es mejor —falla tambien si alguien cambia un codigo
 * sembrado—, pero esta comprobacion no debe exigir Postgres levantado para
 * decir si el parseo trata bien un codigo inventado.
 */
async function catalogoDePrueba(): Promise<{ catalogo: BiomarcadorConocido[]; deLaBase: boolean }> {
  try {
    const catalogo = await obtenerCatalogoSimple()
    if (catalogo.length > 0) return { catalogo, deLaBase: true }
  } catch (e) {
    console.log('  AVISO sin base de datos; se usa un catalogo minimo.')
    console.log('        %s', e instanceof Error ? e.message : String(e))
  }
  return {
    catalogo: [
      { codigo: 'GLU', nombre: 'Glucosa en ayunas', unidad: 'mg/dL' },
      { codigo: 'COL_TOT', nombre: 'Colesterol total', unidad: 'mg/dL' },
    ],
    deLaBase: false,
  }
}

const { catalogo, deLaBase } = await catalogoDePrueba()
console.log('  (catalogo: %d biomarcadores, %s)', catalogo.length, deLaBase ? 'de la base' : 'minimo')

const primero = catalogo[0]
const segundo = catalogo[1]
if (!primero || !segundo) {
  console.log('  FALLA el catalogo no tiene dos biomarcadores con los que probar')
  fallos++
} else {
  /* --- un codigo del catalogo entra con el nombre y la unidad del catalogo --- */
  {
    const r = interpretarLectura(
      JSON.stringify({ reconocidos: [{ codigo: primero.codigo, valor: 95 }] }),
      catalogo,
    )
    const fila = r.reconocidos[0]
    comprobar(
      r.reconocidos.length === 1 &&
        fila?.codigo === primero.codigo &&
        fila?.valor === 95 &&
        fila?.nombre === primero.nombre &&
        fila?.unidad === primero.unidad,
      'un codigo valido entra con el nombre y la unidad DEL CATALOGO',
      JSON.stringify(r.reconocidos),
    )
  }

  /* --- el caso que importa: un codigo que el catalogo no tiene --- */
  {
    const r = interpretarLectura(
      JSON.stringify({ reconocidos: [{ codigo: 'NO_EXISTE_XYZ', valor: 42 }] }),
      catalogo,
    )
    comprobar(
      r.reconocidos.length === 0 && r.noReconocidos.some((n) => n.etiqueta === 'NO_EXISTE_XYZ'),
      'un codigo INVENTADO no entra como valor: va a «no reconocidos»',
      JSON.stringify(r),
    )
  }

  /* --- «< 5» no es un numero medido --- */
  {
    const r = interpretarLectura(
      JSON.stringify({ reconocidos: [{ codigo: primero.codigo, valor: '< 5' }] }),
      catalogo,
    )
    comprobar(
      r.reconocidos.length === 0 && r.avisos.length > 0,
      'un valor «< 5» no entra como numero, y se avisa',
      JSON.stringify(r),
    )
  }

  /* --- la coma decimal sí se admite: es como lo escribe un informe local --- */
  {
    const r = interpretarLectura(
      JSON.stringify({ reconocidos: [{ codigo: primero.codigo, valor: '5,8' }] }),
      catalogo,
    )
    comprobar(
      r.reconocidos[0]?.valor === 5.8,
      'la coma decimal se lee como decimal (5,8 -> 5.8)',
      JSON.stringify(r.reconocidos),
    )
  }

  /* --- repetido: se queda el primero y se dice --- */
  {
    const r = interpretarLectura(
      JSON.stringify({
        reconocidos: [
          { codigo: primero.codigo, valor: 95 },
          { codigo: primero.codigo, valor: 180 },
        ],
      }),
      catalogo,
    )
    comprobar(
      r.reconocidos.length === 1 && r.reconocidos[0]?.valor === 95 && r.avisos.length > 0,
      'un analito repetido no pisa al anterior: se queda el primero y se avisa',
      JSON.stringify(r),
    )
  }

  /* --- un valor absurdo es un numero de pagina mal leido --- */
  {
    const r = interpretarLectura(
      JSON.stringify({ reconocidos: [{ codigo: segundo.codigo, valor: 99_999_999 }] }),
      catalogo,
    )
    comprobar(
      r.reconocidos.length === 0 && r.avisos.length > 0,
      'un valor absurdo queda fuera, con aviso',
      JSON.stringify(r),
    )
  }

  /* --- los no reconocidos del modelo llegan a la pantalla --- */
  {
    const r = interpretarLectura(
      JSON.stringify({
        reconocidos: [],
        no_reconocidos: [{ etiqueta: 'Ferritina', valor: '45.2' }],
      }),
      catalogo,
    )
    comprobar(
      r.noReconocidos.length === 1 &&
        r.noReconocidos[0]?.etiqueta === 'Ferritina' &&
        r.noReconocidos[0]?.valor === '45.2',
      'lo que el modelo no reconocio se enseña, no se descarta',
      JSON.stringify(r),
    )
  }

  /* --- cercas de markdown: el modelo las pone aunque se le pida que no --- */
  {
    const r = interpretarLectura(
      '```json\n' + JSON.stringify({ reconocidos: [{ codigo: primero.codigo, valor: 88 }] }) + '\n```',
      catalogo,
    )
    comprobar(
      r.reconocidos[0]?.valor === 88,
      'la respuesta entre cercas de markdown se lee igual',
      JSON.stringify(r),
    )
  }

  /* --- un JSON ilegible LANZA: quien llama lo convierte en aviso --- */
  {
    let lanzo = false
    try {
      interpretarLectura('lo siento, no puedo leer este informe', catalogo)
    } catch {
      lanzo = true
    }
    comprobar(
      lanzo,
      'una respuesta que no es JSON lanza (la ruta la traduce a aviso)',
      'devolvio un resultado vacio en lugar de lanzar: el fallo pasaria por «no habia valores»',
    )
  }
}

console.log('')
console.log(fallos === 0 ? 'TODOS LOS CASOS PASAN' : fallos + ' CASO(S) FALLAN')
await pool.end().catch(() => {})
process.exit(fallos === 0 ? 0 : 1)
