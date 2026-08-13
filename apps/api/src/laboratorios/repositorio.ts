/**
 * Laboratorios: catalogo con rangos, alta de estudios y lectura con
 * estado y tendencia.
 *
 * El ESTADO no se almacena. Se calcula al leer contra el rango vigente
 * de la clinica: guardado, quedaria obsoleto en cuanto alguien
 * corrigiera un rango y nadie recordaria recalcular el historico.
 */
import { pool } from '../db.js'
import type { BiomarcadorConocido } from './csv.js'

export type EstadoResultado = 'normal' | 'alterado' | 'sin_referencia'
export type Tendencia = 'sube' | 'baja' | 'igual' | null

export interface BiomarcadorConRango extends BiomarcadorConocido {
  decimales: number
  grupo: string
  minimo: number | null
  maximo: number | null
  /** De donde salio el rango: util para explicarlo en la interfaz. */
  origenRango: 'por_sexo' | 'general' | 'ninguno'
}

export interface ResultadoLab {
  codigo: string
  nombre: string
  unidad: string
  valor: number
  rango: { minimo: number | null; maximo: number | null } | null
  estado: EstadoResultado
  anterior: number | null
  delta: number | null
  tendencia: Tendencia
}

export interface Estudio {
  id: string
  fecha: string
  laboratorio: string | null
  notas: string | null
  snapshotId: string | null
  profesional: string | null
  archivo: { id: string; nombreOriginal: string; mime: string } | null
  resultados: ResultadoLab[]
}

export class PacienteNoVisibleError extends Error {}
export class SnapshotAjenoError extends Error {}

/* ------------------------------------------------------------------ */
/* Rango efectivo                                                      */
/* ------------------------------------------------------------------ */

/**
 * El rango del sexo del paciente gana; si no existe, se usa el general.
 *
 * Se toma el rango COMPLETO de una sola fila, nunca mezclando el
 * minimo de una con el maximo de otra: el HDL masculino declara solo
 * minimo (>=40) y combinarlo con el maximo de un rango general
 * inventaria un intervalo que nadie definio.
 */
const SQL_RANGO_EFECTIVO = `
  case when r_sexo.id is not null then r_sexo.minimo else r_gen.minimo end as minimo,
  case when r_sexo.id is not null then r_sexo.maximo else r_gen.maximo end as maximo,
  case
    when r_sexo.id is not null then 'por_sexo'
    when r_gen.id  is not null then 'general'
    else 'ninguno'
  end as origen_rango
`

const JOIN_RANGOS = `
  left join biomarcador_rango r_sexo
    on r_sexo.clinica_id = $CLINICA
   and r_sexo.biomarcador_codigo = b.codigo
   and r_sexo.sexo = $SEXO
  left join biomarcador_rango r_gen
    on r_gen.clinica_id = $CLINICA
   and r_gen.biomarcador_codigo = b.codigo
   and r_gen.sexo is null
`

function estadoDe(
  valor: number,
  minimo: number | null,
  maximo: number | null,
  hayRango: boolean,
): EstadoResultado {
  // Sin criterio no se puede afirmar que un valor sea normal. Decirlo
  // seria inventar una tranquilidad que nadie ha comprobado.
  if (!hayRango) return 'sin_referencia'
  if (minimo !== null && valor < minimo) return 'alterado'
  if (maximo !== null && valor > maximo) return 'alterado'
  return 'normal'
}

function tendenciaDe(delta: number | null): Tendencia {
  if (delta === null) return null
  if (delta > 0) return 'sube'
  if (delta < 0) return 'baja'
  return 'igual'
}

/* ------------------------------------------------------------------ */
/* Catalogo con rangos de la clinica                                   */
/* ------------------------------------------------------------------ */

interface FilaCatalogo {
  codigo: string
  nombre: string
  unidad: string
  decimales: number
  grupo: string
  minimo: string | null
  maximo: string | null
  origen_rango: string
}

/**
 * `sexo` opcional: sin el, se devuelven los rangos generales, que es lo
 * que necesita una pantalla de configuracion. Con el, los que aplican
 * a ese paciente.
 */
export async function obtenerCatalogo(
  tenantId: string,
  sexo: string | null = null,
): Promise<BiomarcadorConRango[]> {
  const sql = `
    select b.codigo, b.nombre, b.unidad, b.decimales, b.grupo,
           ${SQL_RANGO_EFECTIVO}
    from biomarcador b
    ${JOIN_RANGOS.replace(/\$CLINICA/g, '$1').replace(/\$SEXO/g, '$2::sexo_biologico')}
    where b.activo = true
    order by b.orden asc
  `
  const { rows } = await pool.query<FilaCatalogo>(sql, [tenantId, sexo])

  return rows.map((r) => ({
    codigo: r.codigo,
    nombre: r.nombre,
    unidad: r.unidad,
    decimales: r.decimales,
    grupo: r.grupo,
    minimo: r.minimo === null ? null : Number(r.minimo),
    maximo: r.maximo === null ? null : Number(r.maximo),
    origenRango: r.origen_rango as BiomarcadorConRango['origenRango'],
  }))
}

/** Solo codigo/nombre/unidad, para el parseo de CSV. */
export async function obtenerCatalogoSimple(): Promise<BiomarcadorConocido[]> {
  const { rows } = await pool.query<BiomarcadorConocido>(
    `select codigo, nombre, unidad from biomarcador where activo = true order by orden asc`,
  )
  return rows
}

/* ------------------------------------------------------------------ */
/* Listado de estudios                                                 */
/* ------------------------------------------------------------------ */

interface FilaEstudio {
  id: string
  fecha: string
  laboratorio: string | null
  notas: string | null
  snapshot_id: string | null
  profesional: string | null
  archivo_id: string | null
  archivo_nombre: string | null
  archivo_mime: string | null
}

interface FilaResultado {
  estudio_id: string
  codigo: string
  nombre: string
  unidad: string
  valor: string
  anterior: string | null
  minimo: string | null
  maximo: string | null
  origen_rango: string
}

export async function listarEstudios(
  tenantId: string,
  restringirA: string | null,
  pacienteId: string,
): Promise<Estudio[] | null> {
  const { rows: pac } = await pool.query<{ sexo: string | null }>(
    `select sexo_biologico::text as sexo from paciente
     where id = $1 and clinica_id = $2 and ($3::uuid is null or nutricionista_id = $3)`,
    [pacienteId, tenantId, restringirA],
  )
  if (!pac[0]) return null
  const sexo = pac[0].sexo

  const { rows: estudios } = await pool.query<FilaEstudio>(
    `select e.id,
            to_char(e.fecha, 'YYYY-MM-DD') as fecha,
            e.laboratorio, e.notas, e.snapshot_id,
            prof.nombre  as profesional,
            a.id         as archivo_id,
            a.nombre_original as archivo_nombre,
            a.mime       as archivo_mime
     from lab_estudio e
     left join profesional prof on prof.id = e.profesional_id
     left join archivo a on a.id = e.archivo_id
     where e.paciente_id = $1 and e.clinica_id = $2 and e.estado = 'vigente'
     order by e.fecha desc, e.created_at desc`,
    [pacienteId, tenantId],
  )

  // La tendencia se calcula sobre los estudios VIGENTES ordenados por
  // fecha de muestra. Un estudio anulado no debe servir de comparacion.
  const { rows: resultados } = await pool.query<FilaResultado>(
    `with valores as (
       select e.id as estudio_id, e.fecha, e.created_at, r.biomarcador_codigo as codigo, r.valor
       from lab_estudio e
       join lab_resultado r on r.estudio_id = e.id
       where e.paciente_id = $1 and e.clinica_id = $2 and e.estado = 'vigente'
     ),
     con_delta as (
       select *,
              lag(valor) over (partition by codigo order by fecha asc, created_at asc) as anterior
       from valores
     )
     select cd.estudio_id, cd.codigo, b.nombre, b.unidad, cd.valor, cd.anterior,
            ${SQL_RANGO_EFECTIVO}
     from con_delta cd
     join biomarcador b on b.codigo = cd.codigo
     ${JOIN_RANGOS.replace(/\$CLINICA/g, '$2').replace(/\$SEXO/g, '$3::sexo_biologico')}
     order by b.orden asc`,
    [pacienteId, tenantId, sexo],
  )

  const porEstudio = new Map<string, ResultadoLab[]>()
  for (const r of resultados) {
    const valor = Number(r.valor)
    const anterior = r.anterior === null ? null : Number(r.anterior)
    const delta = anterior === null ? null : Number((valor - anterior).toFixed(4))
    const minimo = r.minimo === null ? null : Number(r.minimo)
    const maximo = r.maximo === null ? null : Number(r.maximo)
    const hayRango = r.origen_rango !== 'ninguno'

    const lista = porEstudio.get(r.estudio_id) ?? []
    lista.push({
      codigo: r.codigo,
      nombre: r.nombre,
      unidad: r.unidad,
      valor,
      rango: hayRango ? { minimo, maximo } : null,
      estado: estadoDe(valor, minimo, maximo, hayRango),
      anterior,
      delta,
      tendencia: tendenciaDe(delta),
    })
    porEstudio.set(r.estudio_id, lista)
  }

  return estudios.map((e) => ({
    id: e.id,
    fecha: e.fecha,
    laboratorio: e.laboratorio,
    notas: e.notas,
    snapshotId: e.snapshot_id,
    profesional: e.profesional,
    archivo:
      e.archivo_id && e.archivo_nombre && e.archivo_mime
        ? { id: e.archivo_id, nombreOriginal: e.archivo_nombre, mime: e.archivo_mime }
        : null,
    resultados: porEstudio.get(e.id) ?? [],
  }))
}

/* ------------------------------------------------------------------ */
/* Alta                                                                */
/* ------------------------------------------------------------------ */

export interface DatosEstudio {
  fecha: string
  laboratorio: string | null
  notas: string | null
  archivoId: string | null
  snapshotId: string | null
  resultados: { codigo: string; valor: number }[]
}

export async function crearEstudio(
  tenantId: string,
  restringirA: string | null,
  pacienteId: string,
  profesionalId: string,
  datos: DatosEstudio,
): Promise<string> {
  const cliente = await pool.connect()
  try {
    await cliente.query('begin')

    const { rows: pac } = await cliente.query<{ id: string }>(
      `select id from paciente
       where id = $1 and clinica_id = $2 and ($3::uuid is null or nutricionista_id = $3)`,
      [pacienteId, tenantId, restringirA],
    )
    if (!pac[0]) {
      await cliente.query('rollback')
      throw new PacienteNoVisibleError()
    }

    // Un snapshot de OTRO paciente colgaria el laboratorio del
    // expediente equivocado. La base no puede impedirlo con una clave
    // ajena, asi que se comprueba aqui.
    if (datos.snapshotId) {
      const { rows } = await cliente.query<{ id: string }>(
        `select id from clinical_snapshot
         where id = $1 and clinica_id = $2 and paciente_id = $3`,
        [datos.snapshotId, tenantId, pacienteId],
      )
      if (!rows[0]) {
        await cliente.query('rollback')
        throw new SnapshotAjenoError()
      }
    }

    const { rows } = await cliente.query<{ id: string }>(
      `insert into lab_estudio
         (clinica_id, paciente_id, profesional_id, snapshot_id, fecha, laboratorio, archivo_id, notas)
       values ($1, $2, $3, $4, $5::date, $6, $7, $8)
       returning id`,
      [
        tenantId,
        pacienteId,
        profesionalId,
        datos.snapshotId,
        datos.fecha,
        datos.laboratorio,
        datos.archivoId,
        datos.notas,
      ],
    )
    const id = rows[0]?.id
    if (!id) throw new Error('El insert de lab_estudio no devolvio id')

    if (datos.resultados.length > 0) {
      await cliente.query(
        `insert into lab_resultado (clinica_id, estudio_id, biomarcador_codigo, valor)
         select $2, $1, c, v
         from unnest($3::text[], $4::numeric[]) as t(c, v)`,
        [
          id,
          tenantId,
          datos.resultados.map((r) => r.codigo),
          datos.resultados.map((r) => r.valor),
        ],
      )
    }

    await cliente.query('commit')
    return id
  } catch (error) {
    if (!(error instanceof PacienteNoVisibleError) && !(error instanceof SnapshotAjenoError)) {
      await cliente.query('rollback')
    }
    throw error
  } finally {
    cliente.release()
  }
}
