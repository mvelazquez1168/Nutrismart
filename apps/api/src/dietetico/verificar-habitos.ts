/**
 * Comprueba el upsert de habitos alimentarios — R50.
 * `npm run verificar:habitos`
 *
 * ## Por que lee el archivo fuente en vez de repetir el SQL
 *
 * La sentencia del `PUT /api/pacientes/:id/dietetico` tiene veintiocho
 * parametros posicionales. Un desalineo entre la lista de columnas y la
 * lista de valores no lo ve el compilador: los tipos encajan igual, y el
 * fallo aparece recien al guardar, como un 500 o —peor— como un dato en
 * la columna equivocada.
 *
 * Copiar la sentencia aqui comprobaria la copia, no el codigo. Asi que se
 * EXTRAE del archivo de la ruta y se ejecuta tal cual, dentro de una
 * transaccion que se deshace al final: no queda nada escrito.
 *
 * Lo que esto atrapa: nombres de columna inventados, parametros de mas o
 * de menos, casts que faltan, y los CHECK de la migracion 050.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { pool } from '../db.js'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RUTA = resolve(AQUI, '../routes/dietetico.ts')

let fallos = 0

function ok(texto: string): void {
  console.log(`  ok   ${texto}`)
}

function falla(texto: string, detalle?: unknown): void {
  fallos += 1
  console.log(`  FALLA ${texto}`)
  if (detalle !== undefined) console.log(`        ${String(detalle)}`)
}

/** Saca del archivo el `insert into evaluacion_dietetica … returning …`. */
function extraerSentencia(): string {
  const fuente = readFileSync(RUTA, 'utf8')

  const campos = /const CAMPOS = `([\s\S]*?)`/.exec(fuente)
  if (!campos?.[1]) throw new Error('no se encontro la constante CAMPOS')

  const inicio = fuente.indexOf('`insert into evaluacion_dietetica')
  if (inicio === -1) throw new Error('no se encontro el insert')
  const fin = fuente.indexOf('`', inicio + 1)
  if (fin === -1) throw new Error('el literal del insert no cierra')

  return fuente
    .slice(inicio + 1, fin)
    .replace('${CAMPOS}', campos[1])
}

async function main(): Promise<void> {
  const sentencia = extraerSentencia()

  const huecos = new Set(sentencia.match(/\$\d+/g) ?? [])
  console.log(`\nSentencia extraida de routes/dietetico.ts: ${huecos.size} parametros\n`)

  // Un paciente y un profesional reales: las claves foraneas los exigen.
  const { rows: ctx } = await pool.query<{ clinica_id: string; paciente_id: string; profesional_id: string }>(
    `select p.clinica_id, p.id as paciente_id, pr.id as profesional_id
       from paciente p
       join profesional pr on pr.clinica_id = p.clinica_id
      limit 1`,
  )
  const c = ctx[0]
  if (!c) {
    console.log('No hay paciente con profesional en la base. Nada que comprobar.')
    await pool.end()
    return
  }

  // Los mismos valores que manda la ruta, en el mismo orden.
  const valores: unknown[] = [
    c.clinica_id,
    c.paciente_id,
    null, // consulta_id
    c.profesional_id,
    '[]', // recordatorio_24h
    '{}', // frecuencia_consumo
    2.5, // hidratacion_litros
    1800, // kcal_estimadas
    90, // proteina_g
    200, // cho_g
    60, // grasa_g
    25, // fibra_g
    'Nota de la comprobacion R50',
    // ---- Habitos (R50) ----
    '3-5',
    ['desayuno', 'almuerzo', 'cena'],
    'casa',
    'Su pareja',
    'regular',
    'Aceite de oliva',
    ['asado', 'vapor'],
    false, // agrega_sal
    true, // consume_azucar
    null, // usa_edulcorante — «no se pregunto»
    'Keto hace dos anos',
    true, // consume_agua
    '6 vasos',
    'Higado, le desagrada el sabor',
    'Pescado, arroz',
  ]

  if (huecos.size !== valores.length) {
    falla(
      `la sentencia espera ${huecos.size} parametros y la ruta manda ${valores.length}`,
      'si este numero no coincide, guardar el Dietetico responde 500',
    )
  } else {
    ok(`la sentencia y la lista de valores coinciden en ${valores.length} parametros`)
  }

  const cliente = await pool.connect()
  try {
    await cliente.query('begin')

    /* ---- 1. El upsert entra ---- */
    let fila: Record<string, unknown> | undefined
    await cliente.query('savepoint upsert')
    try {
      const r = await cliente.query(sentencia, valores)
      fila = r.rows[0] as Record<string, unknown> | undefined
      ok('el upsert se ejecuta y devuelve la fila')
    } catch (e) {
      // Sin volver al savepoint, la transaccion queda abortada y todas
      // las comprobaciones de abajo fallan por arrastre con un error que
      // no es el suyo. Fue el primer sintoma de esto: un «current
      // transaction is aborted» tapando el error de verdad.
      await cliente.query('rollback to savepoint upsert')
      falla('el upsert fallo', e instanceof Error ? e.message : e)
    }

    /* ---- 2. Los quince campos vuelven con lo que se mando ---- */
    if (fila) {
      const esperado: Record<string, unknown> = {
        tiempos_por_dia: '3-5',
        lugar_comidas: 'casa',
        quien_prepara: 'Su pareja',
        apetito: 'regular',
        grasas_cocinar: 'Aceite de oliva',
        agrega_sal: false,
        consume_azucar: true,
        usa_edulcorante: null,
        dietas_realizadas: 'Keto hace dos anos',
        consume_agua: true,
        cantidad_agua: '6 vasos',
        alimentos_no_consume: 'Higado, le desagrada el sabor',
        alimentos_preferidos: 'Pescado, arroz',
      }

      for (const [columna, valor] of Object.entries(esperado)) {
        if (fila[columna] === valor) ok(`vuelve ${columna}`)
        else falla(`${columna}: esperado ${String(valor)}, obtenido ${String(fila[columna])}`)
      }

      for (const [columna, valor] of [
        ['tiempos_realizados', ['desayuno', 'almuerzo', 'cena']],
        ['tipos_coccion', ['asado', 'vapor']],
      ] as [string, string[]][]) {
        const obtenido = fila[columna]
        if (JSON.stringify(obtenido) === JSON.stringify(valor)) ok(`vuelve ${columna}`)
        else falla(`${columna}: obtenido ${JSON.stringify(obtenido)}`)
      }

      /*
       * El null de `usa_edulcorante` es el que importa comprobar: es «no
       * se pregunto». Si en algun punto del camino se convirtiera en
       * false, el expediente diria que el paciente no usa edulcorante
       * porque nadie le pregunto.
       */
      if (fila['usa_edulcorante'] === null) ok('el «no se pregunto» sigue siendo null, no false')
    }

    /* ---- 3. Los CHECK de la migracion 050 rechazan lo que no existe ---- */
    for (const [que, indice, malo] of [
      ['un apetito inventado', 18, 'buenisimo'],
      ['un lugar inventado', 16, 'hotel'],
      ['un tiempo de comida inventado', 15, ['brunch']],
      ['una coccion inventada', 20, ['microondas']],
    ] as [string, number, unknown][]) {
      const copia = [...valores]
      copia[indice - 1] = malo
      await cliente.query('savepoint prueba')
      try {
        await cliente.query(sentencia, copia)
        falla(`${que} entro a la base`)
        await cliente.query('rollback to savepoint prueba')
      } catch {
        ok(`${que} lo rechaza la base`)
        await cliente.query('rollback to savepoint prueba')
      }
    }
  } finally {
    // Nada de esto queda escrito: es la fila real de un paciente real.
    await cliente.query('rollback')
    cliente.release()
  }

  console.log(
    fallos === 0
      ? '\nTodo correcto: la sentencia de la ruta entra, vuelve completa y la base rechaza lo invalido.\n'
      : `\n${fallos} comprobacion(es) fallaron.\n`,
  )
  await pool.end()
  process.exit(fallos === 0 ? 0 : 1)
}

void main()
