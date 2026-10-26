/**
 * Comprobación de las plantillas de correo — R54.
 *
 *   npm run verificar:correos -w @nutrismart/api
 *
 * Dos cosas, ninguna de ellas manda un correo:
 *
 *   1. **Comprueba lo que se puede comprobar a ciegas.** Que el escape
 *      funciona, que una marca distinta pinta un color distinto, que
 *      una fila vacía no deja una caja con la etiqueta colgando, que un
 *      `javascript:` en un enlace no llega al HTML.
 *   2. **Escribe los correos a disco**, en `tmp/correos/`, para poder
 *      abrirlos en un navegador y ver cómo quedan.
 *
 * Corre SIN `RESEND_API_KEY` y sin tocar la base: las marcas son de
 * mentira y las fechas están fijadas. Lo que no puede comprobar es lo
 * único que de verdad importa —que Outlook lo pinte bien—, y para eso
 * hay que mandarse uno a uno mismo.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { boton, caja, envoltorio, esc, escUrl, nota, parrafo, titulo } from './layout.js'
import type { Marca } from './marca.js'

const VERDE: Marca = {
  nombreClinica: 'Clínica Nutrición Vida',
  colorPrimario: '#0E7C66',
  logoUrl: null,
  zonaHoraria: 'America/Costa_Rica',
}

const MORADA: Marca = {
  nombreClinica: 'Centro <Salud> & Bienestar',
  colorPrimario: '#7C3AED',
  logoUrl: 'https://ejemplo.test/api/brand/logo?clinica=abc',
  zonaHoraria: 'America/Mexico_City',
}

let fallos = 0
function comprobar(que: string, condicion: boolean): void {
  console.log(`  ${condicion ? 'OK   ' : 'FALLO'} ${que}`)
  if (!condicion) fallos++
}

console.log('\n── Escape ──')
const conMarcado = esc('<script>alert(1)</script> "Ana" & Pepe')
comprobar('el marcado se escapa', !conMarcado.includes('<script>'))
comprobar('las comillas se escapan', conMarcado.includes('&quot;'))
comprobar('el ampersand se escapa', conMarcado.includes('&amp;'))

console.log('\n── Enlaces ──')
comprobar('javascript: se descarta', escUrl('javascript:alert(1)') === '#')
comprobar('data: se descarta', escUrl('data:text/html,<h1>x</h1>') === '#')
comprobar('una ruta rota se descarta', escUrl('no-es-una-url') === '#')
comprobar('https pasa', escUrl('https://app.test/citas').startsWith('https://app.test/citas'))

console.log('\n── Marca ──')
const htmlVerde = envoltorio(VERDE, titulo('Hola'))
const htmlMorado = envoltorio(MORADA, titulo('Hola'))
comprobar('el color primario llega al HTML', htmlVerde.includes('#0E7C66'))
comprobar('una marca distinta pinta otro color', htmlMorado.includes('#7C3AED'))
comprobar('sin logo se enseña el nombre', htmlVerde.includes('Clínica Nutrición Vida'))
comprobar('con logo se enseña la imagen', htmlMorado.includes('<img src="https://ejemplo.test'))
comprobar(
  'el nombre de la clínica también se escapa',
  htmlMorado.includes('&lt;Salud&gt;') && !htmlMorado.includes('<Salud>'),
)

console.log('\n── Caja de datos ──')
const cajaConHueco = caja(
  [
    { etiqueta: 'Paciente', valor: 'Ana Rodríguez' },
    { etiqueta: 'Motivo', valor: '' },
  ],
  VERDE,
)
comprobar('la fila con valor vacío se descarta', !cajaConHueco.includes('Motivo'))
comprobar('la fila con valor se queda', cajaConHueco.includes('Ana Rodríguez'))
comprobar('una caja entera vacía no deja tabla', caja([{ etiqueta: 'X', valor: '  ' }], VERDE) === '')

console.log('\n── Compatibilidad ──')
const completo = envoltorio(
  VERDE,
  [
    titulo('Tu cita está agendada'),
    parrafo('Hola <strong>Ana</strong>, tu cita quedó registrada:'),
    caja([{ etiqueta: 'Fecha', valor: 'lunes 3 de noviembre', destacado: true }], VERDE),
    boton('https://app.test/citas', 'Ver mi cita', VERDE.colorPrimario),
    nota('Si no puedes asistir, avisa con antelación.'),
  ].join('\n'),
)
comprobar('no hay <style> (Outlook lo descarta)', !completo.includes('<style'))
comprobar('no hay flexbox ni grid', !/display:\s*(flex|grid)/.test(completo))
comprobar('el maquetado va en tablas', completo.includes('role="presentation"'))
comprobar('hay viewport para el móvil', completo.includes('name="viewport"'))

/* ---- A disco, para mirarlos ---- */

const dir = resolve(process.cwd(), 'tmp', 'correos')
mkdirSync(dir, { recursive: true })
const guardar = (nombre: string, html: string) => {
  writeFileSync(resolve(dir, `${nombre}.html`), html, 'utf8')
  console.log(`  escrito  tmp/correos/${nombre}.html`)
}

console.log('\n── Ejemplos a disco ──')
guardar('cita-verde', completo)
guardar(
  'cita-morada',
  envoltorio(
    MORADA,
    [
      titulo('Tu cita cambió de fecha'),
      parrafo('Hola <strong>Ana</strong>, tu cita se movió:'),
      caja(
        [
          { etiqueta: 'Profesional', valor: 'Dra. Ana Rodríguez' },
          { etiqueta: 'Antes', valor: 'lunes 3 de noviembre a las 09:00' },
          { etiqueta: 'Ahora', valor: 'miércoles 5 de noviembre a las 11:30', destacado: true },
        ],
        MORADA,
      ),
      boton('https://app.test/citas', 'Ver mi cita', MORADA.colorPrimario),
    ].join('\n'),
  ),
)

console.log(
  fallos === 0
    ? '\n✓ Las plantillas pasan las comprobaciones.\n'
    : `\n✗ ${fallos} comprobación(es) fallaron.\n`,
)
process.exit(fallos === 0 ? 0 : 1)
