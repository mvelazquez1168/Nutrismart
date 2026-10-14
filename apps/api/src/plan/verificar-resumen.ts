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
import {
  partirResumen,
  promptResumenClinico,
  limpiarBloquesCondicionales,
  type DatosResumenPlan,
} from '../ia/prompts.js'

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

console.log('\n== Los dos bloques que pueden no existir ==\n')

/*
 * `limpiarBloquesCondicionales` es la red que hace imposible —no improbable—
 * que una recomendacion que nadie escribio llegue al expediente. El prompt ya
 * no pide esos bloques; esto cubre el caso de que el modelo los devuelva igual.
 *
 * Es la misma linea que el resto del archivo: lo que no se puede comprobar
 * desde fuera lo tiene que garantizar el codigo.
 */
const DATOS_BASE: DatosResumenPlan = {
  pacienteNombre: 'Prueba',
  pacienteEdad: 40,
  pacienteSexo: 'femenino',
  planNombre: 'Plan',
  planObjetivo: 'Bajar de peso',
  planNotas: null,
  comidas: [],
  diagnostico: 'Obesidad grado I',
  objetivosConclusion: null,
  observacionesConclusion: null,
  justificacionConclusion: null,
  antropometria: 'IMC 32',
  laboratorios: null,
  antecedentes: null,
  recomendaciones: [],
  restricciones: [],
  suplementos: null,
  acuerdos: [],
  tareas: [],
  distribucionMacros: 'Valor calorico total: 1600 kcal/dia',
}

/*
 * Caso 13 — el modelo escribe los dos bloques que no se le pidieron.
 *
 * Es el caso que motivo todo esto: el contenido es plausible, es correcto, y
 * el profesional no lo escribio. Tiene que desaparecer antes de guardarse.
 */
{
  const salida = `OBJETIVOS:
Bajar de peso.

RECOMENDACIONES:
Mantener hidratacion de al menos 2 litros diarios.

TAREAS:
Registrar la ingesta diaria.`
  const b = limpiarBloquesCondicionales(partirResumen(salida), DATOS_BASE)
  comprobar('13. sin fuentes, los dos bloques se descartan', [b.recomendaciones, b.tareas], [null, null])
  comprobar('13. lo que si tenia fuente se conserva', b.objetivos, 'Bajar de peso.')
}

/* Caso 14 — con fuentes registradas, el bloque se respeta tal cual. */
{
  const datos: DatosResumenPlan = {
    ...DATOS_BASE,
    recomendaciones: ['Caminar 30 minutos cinco dias por semana'],
    tareas: ['Traer el control de glicemia'],
  }
  const salida = `RECOMENDACIONES:
Caminar 30 minutos, cinco dias por semana.

TAREAS:
Traer el control de glicemia de la proxima semana.`
  const b = limpiarBloquesCondicionales(partirResumen(salida), datos)
  contiene('14. la recomendacion registrada sobrevive', b.recomendaciones ?? '', 'Caminar 30 minutos')
  contiene('14. la tarea registrada sobrevive', b.tareas ?? '', 'control de glicemia')
}

/*
 * Caso 15 — «No registrado» en el cuerpo tambien se borra.
 *
 * Es lo que el modelo devuelve si decide seguir la regla de los huecos que
 * rige para los otros cuatro bloques. Aqui el bloque no lleva su ausencia
 * escrita: no existe.
 */
{
  const datos: DatosResumenPlan = { ...DATOS_BASE, recomendaciones: ['Comer despacio'] }
  const b = limpiarBloquesCondicionales(
    partirResumen('RECOMENDACIONES:\nNo registrado.\n\nTAREAS:\nNo registrado'),
    datos,
  )
  comprobar('15. «No registrado» no se guarda como cuerpo', [b.recomendaciones, b.tareas], [null, null])
}

/* Caso 16 — el prompt no pide los bloques sin fuentes, y si los que tienen. */
{
  const sinNada = promptResumenClinico(DATOS_BASE)
  comprobar('16. no pide RECOMENDACIONES sin fuentes', sinNada.includes('RECOMENDACIONES:\n'), false)
  comprobar('16. no pide TAREAS sin fuentes', sinNada.includes('TAREAS:\n'), false)
  comprobar('16. prohibe escribirlos', sinNada.includes('PROHIBIDO escribir'), true)

  const conAmbos = promptResumenClinico({
    ...DATOS_BASE,
    recomendaciones: ['Caminar'],
    tareas: ['Pesarse el lunes'],
  })
  comprobar('16. con fuentes si los pide', conAmbos.includes('RECOMENDACIONES:\n'), true)
  comprobar('16. y entonces no los prohibe', conAmbos.includes('PROHIBIDO escribir'), false)

  // Un solo bloque con fuentes: el otro sigue prohibido, y en singular.
  const soloTareas = promptResumenClinico({ ...DATOS_BASE, tareas: ['Pesarse el lunes'] })
  comprobar('16. mixto: pide TAREAS', soloTareas.includes('TAREAS:\n'), true)
  comprobar(
    '16. mixto: prohibe solo RECOMENDACIONES',
    soloTareas.includes('PROHIBIDO escribir «RECOMENDACIONES»'),
    true,
  )
}

/*
 * Caso 17 — la REGLA ABSOLUTA viaja palabra por palabra.
 *
 * Se comprueba el texto literal, con acentos, y no una parafrasis: el resto
 * del prompt va sin acentos por convencion del archivo, y una «normalizacion»
 * bienintencionada de esta frase la cambiaria sin que nadie lo note.
 */
{
  const p = promptResumenClinico(DATOS_BASE)
  comprobar(
    '17. la REGLA ABSOLUTA es literal',
    p.includes(
      'REGLA ABSOLUTA: Si una frase, recomendación, dato o conclusión no puede citarse textualmente de los campos de entrada, no existe y no debe aparecer en el resumen. Ni aunque sea clínicamente correcto. Ni aunque sea obvio. Ni aunque el profesional probablemente lo sepa.',
    ),
    true,
  )
  comprobar('17. el rol es sistema de formateo', p.includes('SISTEMA DE FORMATEO DE TEXTO'), true)
  comprobar(
    '17. estan los cuatro ejemplos prohibidos',
    [
      'Mantener hidratación de al menos 2 litros diarios',
      'Tomar la medicación en ayunas',
      'Continuar con la actividad física',
      'Registrar la ingesta diaria',
    ].every((f) => p.includes(f)),
    true,
  )
  comprobar(
    '17. estan los tres arranques prohibidos',
    ['«Se recomienda»', '«Se sugiere»', '«Es importante»'].every((f) => p.includes(f)),
    true,
  )
}

console.log(
  fallos === 0
    ? '\nTodo correcto: la aritmetica, el partido de bloques y los dos bloques condicionales coinciden con lo esperado.\n'
    : `\n${fallos} comprobacion(es) fallaron.\n`,
)
process.exit(fallos === 0 ? 0 : 1)
