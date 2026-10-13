/**
 * Comprobacion de la aritmetica y del partido de bloques del resumen
 * clinico — R49. `npm run verificar:resumen`.
 *
 * No toca la base ni llama al modelo: comprueba las dos piezas puras,
 * que son justo las dos donde un error no se veria.
 *
 *  · `calcularMacros` / `textoDistribucion` — los numeros del bloque 5.
 *    Cada caso trae los porcentajes calculados a mano con 4/4/9 kcal por
 *    gramo. Si el codigo y el papel no coinciden, falla aqui.
 *
 *  · `partirResumen` — el reparto del texto del modelo en seis bloques.
 *    Lo que se prueba sobre todo es que NO parta de mas: una linea del
 *    cuerpo que empiece con una palabra de encabezado no debe abrir una
 *    seccion nueva.
 */
import { calcularMacros, textoDistribucion } from './resumenClinico.js'
import { partirResumen } from '../ia/prompts.js'

let fallos = 0

function comprobar(nombre: string, obtenido: unknown, esperado: unknown): void {
  const a = JSON.stringify(obtenido)
  const b = JSON.stringify(esperado)
  if (a === b) {
    console.log(`  ok   ${nombre}`)
  } else {
    fallos += 1
    console.log(`  FALLA ${nombre}`)
    console.log(`        esperado: ${b}`)
    console.log(`        obtenido: ${a}`)
  }
}

function contiene(nombre: string, texto: string, trozo: string): void {
  if (texto.includes(trozo)) {
    console.log(`  ok   ${nombre}`)
  } else {
    fallos += 1
    console.log(`  FALLA ${nombre}`)
    console.log(`        el texto no contiene: ${trozo}`)
    console.log(`        texto: ${texto.replace(/\n/g, ' | ')}`)
  }
}

console.log('\n== Los macros del plan: gramos y porcentaje del VCT ==\n')

/*
 * Caso 1 — la prescripcion completa.
 * 2000 kcal, 250 g CHO, 100 g proteina, 67 g grasa.
 *   CHO:     250 x 4 = 1000 kcal  → 1000/2000 = 50 %
 *   Proteina: 100 x 4 =  400 kcal →  400/2000 = 20 %
 *   Grasa:     67 x 9 =  603 kcal →  603/2000 = 30,15 % → 30 %
 */
{
  const m = calcularMacros(
    { kcal_prescritas: 2000, cho_g: 250, proteina_g: 100, grasa_g: 67 },
    null,
  )
  comprobar('1. kcal', m.kcal, 2000)
  comprobar('1. gramos', [m.choG, m.protG, m.grasaG], [250, 100, 67])
  comprobar('1. porcentajes del VCT', [m.choPct, m.protPct, m.grasaPct], [50, 20, 30])
  comprobar('1. fuente', m.fuente, 'conclusion')
  contiene('1. el texto dice el VCT', textoDistribucion(m), 'Carbohidratos: 250 g (50 % del VCT)')
}

/*
 * Caso 2 — gramos sin kilocalorias: el total se deriva.
 * 200 g CHO, 80 g proteina, 60 g grasa
 *   = 800 + 320 + 540 = 1660 kcal
 *   CHO:      800/1660 = 48,19 % → 48 %
 *   Proteina: 320/1660 = 19,28 % → 19 %
 *   Grasa:    540/1660 = 32,53 % → 33 %
 */
{
  const m = calcularMacros({ cho_g: 200, proteina_g: 80, grasa_g: 60 }, null)
  comprobar('2. kcal derivadas de los gramos', m.kcal, 1660)
  comprobar('2. porcentajes', [m.choPct, m.protPct, m.grasaPct], [48, 19, 33])
}

/*
 * Caso 3 — nada registrado.
 *
 * Lo importante no es el null: es que el texto NO diga «0 kcal». Un plan
 * de cero kilocalorias es una prescripcion de ayuno, y eso es lo que
 * leeria el profesional si la ausencia se rellenara con ceros.
 */
{
  const m = calcularMacros(undefined, null)
  comprobar('3. fuente ausente', m.fuente, 'ausente')
  comprobar('3. todo en null', [m.kcal, m.choG, m.choPct], [null, null, null])
  const t = textoDistribucion(m)
  contiene('3. el texto dice que no se registro', t, 'No se registro la prescripcion')
  if (t.includes('0 kcal')) {
    fallos += 1
    console.log('  FALLA 3. el texto de la ausencia menciona «0 kcal»')
  } else {
    console.log('  ok   3. el texto de la ausencia no inventa un cero')
  }
}

/*
 * Caso 4 — respaldo en la calculadora (R39).
 * 1800 kcal, 180 g CHO, 135 g proteina, 60 g grasa
 *   CHO:      720/1800 = 40 %
 *   Proteina: 540/1800 = 30 %
 *   Grasa:    540/1800 = 30 %
 */
{
  const m = calcularMacros(undefined, {
    metaCalorica: 1800,
    distribucionMacros: { choG: 180, protG: 135, grasaG: 60 },
  })
  comprobar('4. fuente calculadora', m.fuente, 'calculadora')
  comprobar('4. porcentajes', [m.choPct, m.protPct, m.grasaPct], [40, 30, 30])
  contiene('4. el texto declara la fuente', textoDistribucion(m), 'calculadora nutricional')
}

/* Caso 5 — con las dos fuentes, gana la prescripcion de la consulta. */
{
  const m = calcularMacros({ kcal_prescritas: 2200, cho_g: 275, proteina_g: 110, grasa_g: 73 }, {
    metaCalorica: 1800,
    distribucionMacros: { choG: 180, protG: 135, grasaG: 60 },
  })
  comprobar('5. gana la conclusion', [m.fuente, m.kcal], ['conclusion', 2200])
}

/*
 * Caso 6 — el porcentaje guardado NO se cree: se recalcula.
 *
 * La fila trae `pct_cho: 10` y 250 g de CHO sobre 2000 kcal, que son el
 * 50 %. El resumen tiene que mostrar 50, no 10: si los gramos y el
 * porcentaje se contradicen, el que se puede comprobar es el que sale de
 * los gramos.
 */
{
  const m = calcularMacros(
    { kcal_prescritas: 2000, cho_g: 250, proteina_g: 100, grasa_g: 67, pct_cho: 10 },
    null,
  )
  comprobar('6. el pct guardado no se usa', m.choPct, 50)
}

/*
 * Caso 7 — kcal en cero y ningun gramo.
 *
 * Cero no es un total valido: se trata como ausencia y no se reparte un
 * porcentaje sobre cero.
 */
{
  const m = calcularMacros({ kcal_prescritas: 0 }, null)
  comprobar('7. el cero no se toma como total', [m.kcal, m.choPct], [null, null])
}

console.log('\n== El partido del texto en bloques ==\n')

const SALIDA_TIPICA = `OBJETIVOS:
Reducir 4 kg de masa grasa en doce semanas.
Mantener la masa libre de grasa.

OBSERVACIONES CLINICAS:
IMC 31,2. HbA1c 6,1 %. Refiere somnolencia postprandial.

JUSTIFICACION:
Se prescribe un plan hipocalorico moderado por el exceso de adiposidad y
la glicemia alterada en ayunas.

PLAN ALIMENTARIO:
Desayuno: 2 harinas, 1 proteina magra, 1 fruta.
Almuerzo: 3 harinas, 2 proteinas, vegetales libres.

RECOMENDACIONES:
Hidratacion de 2 litros al dia. Caminata de 30 minutos, cinco dias.

TAREAS:
Registrar el consumo de agua durante dos semanas.
Traer el control de glicemia de la proxima semana.`

{
  const b = partirResumen(SALIDA_TIPICA)
  comprobar(
    '8. los seis bloques aparecen',
    Object.entries(b)
      .filter(([, v]) => v !== null)
      .map(([k]) => k),
    [
      'objetivos',
      'observacionesClinicas',
      'justificacion',
      'planAlimentario',
      'recomendaciones',
      'tareas',
    ],
  )
  comprobar(
    '8. el primer bloque no se come el segundo',
    b.objetivos,
    'Reducir 4 kg de masa grasa en doce semanas.\nMantener la masa libre de grasa.',
  )
  contiene('8. las tareas llegan completas', b.tareas ?? '', 'control de glicemia')
}

/* Caso 9 — acentos, markdown y numeracion en los encabezados. */
{
  const b = partirResumen(`## **1. Objetivos:**
Bajar de peso.

### OBSERVACIONES CLÍNICAS:
IMC elevado.

**Justificación:**
Por el IMC.

4. Plan alimentario:
Cinco tiempos.

**RECOMENDACIONES**:
Caminar.

Tareas:
Anotar el peso.`)
  comprobar(
    '9. se reconocen con acentos y adornos',
    [b.objetivos, b.observacionesClinicas, b.justificacion, b.planAlimentario, b.recomendaciones, b.tareas],
    ['Bajar de peso.', 'IMC elevado.', 'Por el IMC.', 'Cinco tiempos.', 'Caminar.', 'Anotar el peso.'],
  )
}

/*
 * Caso 10 — una linea del cuerpo que empieza con palabra de encabezado
 * pero SIN dos puntos no abre bloque.
 *
 * Sin esta regla, «Objetivos a corto plazo...» dentro de la
 * justificacion partiria el resumen por la mitad.
 */
{
  const b = partirResumen(`JUSTIFICACION:
Se eligio este reparto por la glicemia.
Objetivos a corto plazo se revisan en la proxima consulta.
Tareas pendientes de la consulta anterior: ninguna.`)
  comprobar('10. no abre bloque sin dos puntos', b.objetivos, null)
  contiene(
    '10. la linea queda dentro de la justificacion',
    b.justificacion ?? '',
    'Objetivos a corto plazo',
  )
}

/* Caso 11 — un bloque que el modelo no devolvio queda en null. */
{
  const b = partirResumen(`OBJETIVOS:
Bajar de peso.

TAREAS:
Caminar.`)
  comprobar('11. lo que falta queda en null', [b.justificacion, b.recomendaciones], [null, null])
  comprobar('11. lo que vino se conserva', [b.objetivos, b.tareas], ['Bajar de peso.', 'Caminar.'])
}

/*
 * Caso 12 — texto sin ningun encabezado.
 *
 * Todo en null y nada repartido a ojo: la pantalla muestra los siete
 * encabezados vacios, que es visible, en vez de poner el texto entero en
 * el primer bloque, que no lo es.
 */
{
  const b = partirResumen('El paciente necesita bajar de peso y moverse mas.')
  comprobar('12. sin encabezados, nada se reparte', Object.values(b), [
    null,
    null,
    null,
    null,
    null,
    null,
  ])
}

console.log(
  fallos === 0
    ? '\nTodo correcto: la aritmetica y el partido de bloques coinciden con lo calculado a mano.\n'
    : `\n${fallos} comprobacion(es) fallaron.\n`,
)
process.exit(fallos === 0 ? 0 : 1)
