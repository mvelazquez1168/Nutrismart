/**
 * Comprobacion del sistema de intercambios contra la tabla sembrada.
 *
 * `npm run verificar:intercambios -w @nutrismart/api`
 *
 * Los valores esperados estan calculados **a mano desde el documento**, no
 * tomados de lo que el codigo devuelve: una prueba que compara el codigo contra
 * si mismo pasa siempre.
 *
 * Existe como herramienta y no como prueba automatica porque el proyecto no
 * tiene corredor de pruebas todavia. Para datos de referencia clinica vale
 * igual: once casos que se pueden correr en dos segundos despues de tocar la
 * tabla, incluido el que importa mas — que «pizza con piña» NO encuentre
 * «piña», porque un acierto plausible no se ve y un no-encontrado si.
 */
import { resolverAlimento, leerGrupos } from './intercambios.js'
import { pool } from '../db.js'

const CLINICA = '11111111-1111-1111-1111-111111111111'

interface Caso {
  alimento: string
  cantidad: string | null
  esperado: { cho_g: number; chon_g: number; grasa_g: number; kcal: number } | 'no_encontrado'
  porque: string
}

const CASOS: Caso[] = [
  {
    alimento: 'arroz blanco',
    cantidad: '1/2 taza',
    esperado: { cho_g: 15, chon_g: 3, grasa_g: 1, kcal: 80 },
    porque: '1 harina exacta: la porcion de referencia es 1/2 tz',
  },
  {
    alimento: 'arroz blanco',
    cantidad: '1 taza',
    esperado: { cho_g: 30, chon_g: 6, grasa_g: 2, kcal: 160 },
    porque: 'el doble de la referencia -> factor 2',
  },
  {
    alimento: 'arroz blanco',
    cantidad: '180 g',
    esperado: { cho_g: 30, chon_g: 6, grasa_g: 2, kcal: 160 },
    porque: 'gramos contra gramos: 180 / 90 = 2',
  },
  {
    alimento: 'frijoles',
    cantidad: '1/2 taza',
    esperado: { cho_g: 15, chon_g: 10, grasa_g: 3, kcal: 125 },
    porque: '1 harina + 1 proteina magra: 15+0 CHO, 3+7 CHON, 1+2 grasa, 80+45 kcal',
  },
  {
    alimento: 'edamame',
    cantidad: '1/2 tz',
    esperado: { cho_g: 7.5, chon_g: 8.5, grasa_g: 2.5, kcal: 85 },
    porque: '0.5 harina + 1 proteina magra: la fraccion decimal se respeta',
  },
  {
    alimento: 'yogurt regular azucarado',
    cantidad: '1/2 tz',
    esperado: { cho_g: 87, chon_g: 8, grasa_g: 1.5, kcal: 400 },
    porque: '1 lacteo descremado + 5 azucares: 12+75 CHO, 100+300 kcal',
  },
  {
    alimento: 'pan de hamburguesa Konig',
    cantidad: '1 unidad',
    esperado: { cho_g: 22.5, chon_g: 4.5, grasa_g: 1.5, kcal: 120 },
    porque: '1.5 harinas: el decimal del documento no se redondea a 1 ni a 2',
  },
  {
    alimento: 'huevo',
    cantidad: '1 unidad',
    esperado: { cho_g: 0, chon_g: 7, grasa_g: 5, kcal: 75 },
    porque: '«huevo» encuentra «huevo entero» por parecido',
  },
  {
    alimento: 'gallo pinto',
    cantidad: '1/2 tz',
    esperado: { cho_g: 15, chon_g: 3, grasa_g: 1, kcal: 80 },
    porque: 'un alimento que el documento junta con «/» tiene fila propia',
  },
  {
    alimento: 'marañón',
    cantidad: '1 unidad mediana',
    esperado: { cho_g: 15, chon_g: 0, grasa_g: 0, kcal: 60 },
    porque: 'desambiguado: «marañón» resuelve a la fruta por parecido',
  },
  {
    alimento: 'pizza con piña',
    cantidad: '2 porciones',
    esperado: 'no_encontrado',
    porque: 'no esta en el documento: no se inventa un numero',
  },
]

const grupos = await leerGrupos(CLINICA)
let fallos = 0

for (const c of CASOS) {
  const r = await resolverAlimento(CLINICA, c.alimento, c.cantidad, grupos)

  if (c.esperado === 'no_encontrado') {
    const ok = !r.encontrado
    if (!ok) fallos++
    console.log(
      (ok ? 'OK    ' : 'FALLA ') +
        String(c.alimento).padEnd(26) +
        String(c.cantidad ?? '(sin cantidad)').padEnd(18) +
        '-> ' +
        (r.encontrado
          ? 'encontro "' + r.equivalencia?.alimento + '" y NO deberia'
          : 'no_encontrado (correcto)'),
    )
    continue
  }

  const m = r.macros
  const e = c.esperado
  const ok =
    r.encontrado &&
    Math.abs(m.cho_g - e.cho_g) < 0.05 &&
    Math.abs(m.chon_g - e.chon_g) < 0.05 &&
    Math.abs(m.grasa_g - e.grasa_g) < 0.05 &&
    Math.abs(m.kcal - e.kcal) < 0.05
  if (!ok) fallos++
  const pad = (v: unknown, n: number) => String(v).padEnd(n)
  console.log(
    (ok ? 'OK    ' : 'FALLA ') +
      pad(c.alimento, 26) +
      pad(c.cantidad ?? '(sin cantidad)', 18) +
      '-> CHO ' + pad(m.cho_g, 6) + 'CHON ' + pad(m.chon_g, 6) +
      'GRASA ' + pad(m.grasa_g, 6) + 'KCAL ' + pad(m.kcal, 7) +
      '[' + (r.equivalencia?.alimento ?? '-') + ' x' + r.factor + ']',
  )
  if (!ok) {
    console.log('       esperado: CHO %s CHON %s GRASA %s KCAL %s — %s',
      e.cho_g, e.chon_g, e.grasa_g, e.kcal, c.porque)
  }
}

console.log('')
console.log(fallos === 0 ? 'TODOS LOS CASOS PASAN' : fallos + ' CASO(S) FALLAN')
await pool.end()
process.exit(fallos === 0 ? 0 : 1)
