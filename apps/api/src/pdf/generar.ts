/**
 * Conversión del HTML a PDF con Chromium — CLI-05.
 *
 * El navegador se lanza UNA vez y se reutiliza entre exportaciones.
 * Arrancar Chromium cuesta cerca de un segundo, y hacerlo en cada
 * petición convertiría una acción interactiva en una espera.
 *
 * Si Chromium no está disponible —una imagen sin sus librerías, un
 * entorno restringido— la exportación devuelve el HTML en lugar de
 * fallar: el profesional puede imprimirlo a PDF desde el navegador y
 * el expediente sale igual. Un documento clínico no debe quedar
 * retenido por un problema de infraestructura.
 */
import type { Browser } from 'puppeteer'
import { generarHTML } from './plantilla.js'
import type { DatosPDF, Seccion } from './datos.js'

export type Resultado =
  | { tipo: 'pdf'; contenido: Buffer; mime: 'application/pdf'; extension: 'pdf' }
  | { tipo: 'html'; contenido: Buffer; mime: 'text/html; charset=utf-8'; extension: 'html' }

let navegador: Browser | null = null
let arrancando: Promise<Browser> | null = null

async function obtenerNavegador(): Promise<Browser> {
  if (navegador?.connected) return navegador
  // Dos peticiones simultáneas con el navegador caído lanzarían dos
  // Chromium; la promesa compartida hace que la segunda espere a la
  // primera.
  arrancando ??= (async () => {
    const puppeteer = await import('puppeteer')
    const b = await puppeteer.default.launch({
      headless: true,
      // --no-sandbox es necesario dentro de un contenedor sin
      // privilegios. El HTML que se renderiza lo genera esta misma API
      // a partir de la base, no llega de fuera.
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })
    navegador = b
    arrancando = null
    return b
  })()
  return arrancando
}

/** Cierra el navegador al apagar el proceso. */
export async function cerrarNavegador(): Promise<void> {
  const b = navegador
  navegador = null
  if (b) await b.close().catch(() => {})
}

export async function generar(datos: DatosPDF, secciones: Seccion[]): Promise<Resultado> {
  const html = generarHTML(datos, secciones)

  let pagina
  try {
    const b = await obtenerNavegador()
    pagina = await b.newPage()

    // 'load' y no 'networkidle0': el documento es autocontenido —el
    // logo viaja como data: URI— así que no hay red que esperar y
    // networkidle0 solo añadiría medio segundo de espera inútil.
    await pagina.setContent(html, { waitUntil: 'load', timeout: 15_000 })

    const pdf = await pagina.pdf({
      format: 'A4',
      printBackground: true,
      // Margen solo arriba y abajo: las bandas de cabecera y pie van a
      // sangre, y un margen lateral las cortaría por dentro.
      margin: { top: '0', bottom: '14mm', left: '0', right: '0' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="width:100%;padding:0 32px;font-size:8px;color:#9AA6A1;
                    font-family:-apple-system,'Segoe UI',Arial,sans-serif;text-align:right;">
          Página <span class="pageNumber"></span> de <span class="totalPages"></span>
        </div>`,
    })

    return {
      tipo: 'pdf',
      contenido: Buffer.from(pdf),
      mime: 'application/pdf',
      extension: 'pdf',
    }
  } catch {
    // Si Chromium falló, puede haber quedado inservible: se descarta
    // para que la siguiente petición arranque uno limpio.
    await cerrarNavegador()
    return {
      tipo: 'html',
      contenido: Buffer.from(html, 'utf8'),
      mime: 'text/html; charset=utf-8',
      extension: 'html',
    }
  } finally {
    // La página se cierra siempre: sin esto cada exportación deja una
    // pestaña abierta y la memoria del proceso crece sin límite.
    await pagina?.close().catch(() => {})
  }
}
