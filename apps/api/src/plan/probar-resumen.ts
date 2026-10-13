/**
 * Prueba de punta a punta del resumen clinico contra la base de
 * desarrollo. `tsx src/plan/probar-resumen.ts`
 *
 * No es parte del cierre: se corre a mano cuando se toca el SQL de
 * `reunirContexto`. Lo que comprueba es exactamente lo que
 * `verificar-resumen.ts` no puede — que las consultas existan, que los
 * nombres de columna sean los de la base y que el insert entre.
 *
 * Elige un plan real del paciente con conclusion mas reciente, reune el
 * contexto, genera el resumen y lo lee de vuelta.
 */
import { pool } from '../db.js'
import { reunirContexto, generarResumen, leerUltimoResumen } from './resumenClinico.js'

async function main(): Promise<void> {
  const { rows } = await pool.query<{ plan_id: string; clinica_id: string; nombre: string }>(
    // El plan del paciente que tenga conclusion, si alguno la tiene; si
    // no, el plan mas reciente. Sin conclusion el camino sigue siendo
    // valido —es el del plan creado desde la ficha— y ejercita ademas la
    // rama de macros ausentes.
    `select pa.id as plan_id, pa.clinica_id, pa.nombre
       from plan_alimentario pa
       left join conclusion_valoracion cv
         on cv.paciente_id = pa.paciente_id and cv.clinica_id = pa.clinica_id
      order by (cv.id is not null) desc, pa.created_at desc
      limit 1`,
  )
  const p = rows[0]
  if (!p) {
    console.log('No hay ningun plan alimentario en la base. Nada que probar.')
    await pool.end()
    return
  }

  console.log(`Plan: ${p.nombre} (${p.plan_id})`)

  const ctx = await reunirContexto(p.plan_id, p.clinica_id)
  if (!ctx) {
    console.error('FALLA: reunirContexto devolvio null para un plan que existe.')
    process.exitCode = 1
    await pool.end()
    return
  }

  console.log(`  paciente: ${ctx.datos.pacienteNombre} (${ctx.datos.pacienteEdad ?? '?'} anos)`)
  console.log(`  consulta resuelta: ${ctx.consultaId ?? 'ninguna'}`)
  console.log(`  comidas del plan: ${ctx.datos.comidas.length}`)
  console.log(`  macros (${ctx.macros.fuente}):`)
  for (const l of ctx.datos.distribucionMacros.split('\n')) console.log(`    ${l}`)

  const r = await generarResumen(p.plan_id, p.clinica_id, null)
  console.log(`\n  generarResumen → ${r.estado}${r.motivo ? ` (${r.motivo})` : ''}`)

  const guardado = await leerUltimoResumen(p.plan_id, p.clinica_id)
  if (!guardado) {
    console.error('FALLA: no se pudo leer el resumen que se acaba de guardar.')
    process.exitCode = 1
  } else {
    console.log(`  guardado: ${guardado.id} · origen ${guardado.origen}`)
    for (const [clave, valor] of Object.entries(guardado.bloques)) {
      const estado = valor === null ? 'VACIO' : `${valor.length} caracteres`
      console.log(`    ${clave}: ${estado}`)
    }
  }

  await pool.end()
}

void main()
