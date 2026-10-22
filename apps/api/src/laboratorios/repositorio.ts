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
  /** true = el resultado es texto («No Reactiva»), no un numero — R49. */
  es_cualitativo: boolean
  activo: boolean
}

export interface ResultadoLab {
  /** null solo cuando el analito no esta catalogado (`nombreLibre`) — R49. */
  codigo: string | null
  nombre: string
  unidad: string
  /** null en los cualitativos y en los libres que llegaron como texto. */
  valor: number | null
  /** El resultado cualitativo, tal como lo escribio el profesional — R49. */
  valor_texto: string | null
  /** El analito que no esta en ningun catalogo — R49. */
  nombre_libre: string | null
  rango: { minimo: number | null; maximo: number | null } | null
  estado: EstadoResultado
  anterior: number | null
  delta: number | null
  tendencia: Tendencia
}

/* ------------------------------------------------------------------ */
/* Analitica: la serie historica por analito — R49                     */
/* ------------------------------------------------------------------ */

export interface PuntoSerie {
  fecha: string
  valor: number | null
  valor_texto: string | null
  estudio_id: string
}

export interface AnalitoHistorico {
  codigo: string
  nombre: string
  grupo: string
  unidad: string
  es_cualitativo: boolean
  refMin: number | null
  refMax: number | null
  serie: PuntoSerie[]
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

/**
 * El rango efectivo de un RESULTADO, con la referencia del informe primero — R44.
 *
 * Aparte de `SQL_RANGO_EFECTIVO` porque alli no hay resultado: el catalogo
 * describe el criterio de la clinica, y esta describe el de una medicion
 * concreta.
 *
 * **La prioridad es el informe.** `ref_minimo`/`ref_maximo` los declaro el
 * laboratorio que hizo ESA medicion, con su metodo y en su fecha; el catalogo
 * de la clinica es el criterio de quien no estaba ahi. Y hasta R44 el catalogo
 * estaba ademas vacio, asi que el expediente decia «Sin referencia» en todo.
 *
 * El `is not null` se comprueba sobre los DOS lados juntos, no uno por uno: un
 * informe que solo declara «< 200» da `ref_minimo` null y `ref_maximo` 200, y
 * eso ES su referencia. Mirando cada lado por separado, el minimo caeria al
 * del catalogo y saldria un rango mitad de un sitio y mitad de otro, que no es
 * el criterio de nadie.
 */
const SQL_RANGO_EFECTIVO_RESULTADO = `
  case
    when cd.ref_minimo is not null or cd.ref_maximo is not null then cd.ref_minimo
    when r_sexo.id is not null then r_sexo.minimo
    else r_gen.minimo
  end as minimo,
  case
    when cd.ref_minimo is not null or cd.ref_maximo is not null then cd.ref_maximo
    when r_sexo.id is not null then r_sexo.maximo
    else r_gen.maximo
  end as maximo,
  case
    when cd.ref_minimo is not null or cd.ref_maximo is not null then 'por_resultado'
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
  es_cualitativo: boolean
  activo: boolean
}

/**
 * Lo que una clinica ve del catalogo: lo global mas lo suyo — R49.
 *
 * `clinica_id is null` son los analitos estandar, iguales para todos. Con
 * valor, son los que esa clinica declaro. Lo de OTRA clinica no se ve, que
 * es la regla de aislamiento de siempre aplicada a una tabla que hasta R49
 * era enteramente global.
 */
const SQL_CATALOGO_VISIBLE = `(b.clinica_id is null or b.clinica_id = $1)`

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
           b.es_cualitativo, b.activo,
           ${SQL_RANGO_EFECTIVO}
    from biomarcador b
    ${JOIN_RANGOS.replace(/\$CLINICA/g, '$1').replace(/\$SEXO/g, '$2::sexo_biologico')}
    where b.activo = true and ${SQL_CATALOGO_VISIBLE}
    order by b.grupo asc, b.orden asc
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
    es_cualitativo: r.es_cualitativo === true,
    activo: r.activo === true,
  }))
}

/**
 * Lo justo para VALIDAR un POST: que el codigo exista y si es cualitativo.
 *
 * Aparte de `obtenerCatalogo` porque no necesita rangos ni sexo, y aparte de
 * `obtenerCatalogoSimple` porque ESTE si se acota por clinica: aceptar un
 * codigo de otra clinica dejaria entrar un resultado que su propio catalogo
 * no sabe nombrar.
 */
export async function obtenerCatalogoVisible(
  tenantId: string,
): Promise<Map<string, { es_cualitativo: boolean }>> {
  const { rows } = await pool.query<{ codigo: string; es_cualitativo: boolean }>(
    `select b.codigo, b.es_cualitativo
       from biomarcador b
      where b.activo = true and (b.clinica_id is null or b.clinica_id = $1)`,
    [tenantId],
  )
  return new Map(rows.map((r) => [r.codigo, { es_cualitativo: r.es_cualitativo === true }]))
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
  codigo: string | null
  nombre: string
  unidad: string
  valor: string | null
  valor_texto: string | null
  nombre_libre: string | null
  es_cualitativo: boolean
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
    /*
     * **`left join` al catalogo, no `join`** — R49.
     *
     * Un resultado libre (`nombre_libre`) no tiene codigo, y con el join
     * interno desaparecia de la respuesta: el profesional lo habria escrito,
     * se habria guardado, y no lo veria nunca. El nombre y la unidad caen al
     * del catalogo cuando lo hay, y al texto libre cuando no.
     *
     * El `lag` sigue particionando por codigo: dos analitos libres con el
     * mismo nombre no se comparan entre si —su codigo es null y en una
     * particion de nulls el orden no significa nada—, y eso es lo correcto:
     * «Inmunoglobulina IgG» escrito a mano en dos estudios distintos puede no
     * ser la misma medicion.
     */
    `with valores as (
       select e.id as estudio_id, e.fecha, e.created_at,
              r.biomarcador_codigo as codigo, r.valor, r.valor_texto, r.nombre_libre,
              r.ref_minimo, r.ref_maximo
       from lab_estudio e
       join lab_resultado r on r.estudio_id = e.id
       where e.paciente_id = $1 and e.clinica_id = $2 and e.estado = 'vigente'
     ),
     con_delta as (
       select *,
              case when codigo is null then null else
                lag(valor) over (partition by codigo order by fecha asc, created_at asc)
              end as anterior
       from valores
     )
     select cd.estudio_id, cd.codigo,
            coalesce(b.nombre, cd.nombre_libre) as nombre,
            coalesce(b.unidad, '') as unidad,
            cd.valor, cd.valor_texto, cd.nombre_libre,
            coalesce(b.es_cualitativo, false) as es_cualitativo,
            cd.anterior,
            ${SQL_RANGO_EFECTIVO_RESULTADO}
     from con_delta cd
     left join biomarcador b on b.codigo = cd.codigo
     ${JOIN_RANGOS.replace(/\$CLINICA/g, '$2').replace(/\$SEXO/g, '$3::sexo_biologico')}
     order by b.grupo asc nulls last, b.orden asc nulls last, cd.nombre_libre asc`,
    [pacienteId, tenantId, sexo],
  )

  const porEstudio = new Map<string, ResultadoLab[]>()
  for (const r of resultados) {
    const valor = r.valor === null ? null : Number(r.valor)
    const anterior = r.anterior === null ? null : Number(r.anterior)
    const delta =
      anterior === null || valor === null ? null : Number((valor - anterior).toFixed(4))
    const minimo = r.minimo === null ? null : Number(r.minimo)
    const maximo = r.maximo === null ? null : Number(r.maximo)
    /*
     * **Sin numero no hay estado** — R49.
     *
     * Un cualitativo («No Reactiva») y un libre sin valor numerico no se
     * pueden comparar con un intervalo. Decir «normal» ahi seria afirmar que
     * algo esta bien sin haberlo comprobado, que es justo lo que
     * `sin_referencia` existe para no hacer.
     */
    const hayRango = r.origen_rango !== 'ninguno' && valor !== null

    const lista = porEstudio.get(r.estudio_id) ?? []
    lista.push({
      codigo: r.codigo,
      nombre: r.nombre,
      unidad: r.unidad,
      valor,
      valor_texto: r.valor_texto,
      nombre_libre: r.nombre_libre,
      rango: hayRango ? { minimo, maximo } : null,
      estado: valor === null ? 'sin_referencia' : estadoDe(valor, minimo, maximo, hayRango),
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
  /**
   * Las referencias son OPCIONALES: solo llegan cuando el informe las traia
   * (R44). Una captura a mano no las tiene, y ahi manda el catalogo.
   */
  resultados: {
    /** null = analito sin catalogar; entonces `nombreLibre` manda — R49. */
    codigo: string | null
    nombreLibre: string | null
    /** null en los cualitativos y en los libres escritos como texto. */
    valor: number | null
    valorTexto: string | null
    refMinimo?: number | null
    refMaximo?: number | null
  }[]
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
      // R44: las referencias que declaraba el informe viajan con cada
      // resultado. `?? null` y no `?? 0`: un informe que no declara rango
      // deja los dos lados en null, y eso es lo que hace que el listado
      // caiga al catalogo en vez de inventar un intervalo que empieza en 0.
      await cliente.query(
        `insert into lab_resultado
           (clinica_id, estudio_id, biomarcador_codigo, nombre_libre,
            valor, valor_texto, ref_minimo, ref_maximo)
         select $2, $1, c, nl, v, vt, rmin, rmax
         from unnest($3::text[], $4::text[], $5::numeric[], $6::text[],
                     $7::numeric[], $8::numeric[])
              as t(c, nl, v, vt, rmin, rmax)`,
        [
          id,
          tenantId,
          datos.resultados.map((r) => r.codigo),
          datos.resultados.map((r) => r.nombreLibre),
          datos.resultados.map((r) => r.valor),
          datos.resultados.map((r) => r.valorTexto),
          datos.resultados.map((r) => r.refMinimo ?? null),
          datos.resultados.map((r) => r.refMaximo ?? null),
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

/* ------------------------------------------------------------------ */
/* Analitica: la serie historica por analito — R49                     */
/* ------------------------------------------------------------------ */

interface FilaSerie {
  codigo: string
  nombre: string
  grupo: string
  unidad: string
  es_cualitativo: boolean
  valor: string | null
  valor_texto: string | null
  fecha: string
  estudio_id: string
  minimo: string | null
  maximo: string | null
  origen_rango: string
}

/**
 * Toda la historia de cada analito CATALOGADO de un paciente.
 *
 * ## Por que solo los catalogados
 *
 * Una serie historica es una comparacion: el mismo analito, medido varias
 * veces. Un `nombre_libre` no garantiza eso — «IgG», «Inmunoglobulina G» e
 * «Ig G» escritos en tres estudios son tres cadenas distintas, y unirlas por
 * parecido de letras construiria una tendencia que nadie midio. Quedan fuera
 * a proposito, y siguen visibles en el detalle de su estudio.
 *
 * ## El rango que se devuelve
 *
 * Es el del ULTIMO punto, resuelto con el mismo algoritmo que el listado de
 * estudios (`SQL_RANGO_EFECTIVO_RESULTADO`): la referencia que declaro el
 * informe gana sobre el catalogo de la clinica. Es el criterio con el que se
 * esta valorando hoy, y es contra el que la pantalla pinta la banda.
 *
 * Devolver un rango por punto seria mas exacto y menos util: la grafica
 * dibuja UNA banda, y una banda que cambia de altura a mitad del recorrido no
 * se puede leer.
 */
export async function serieAnalitica(
  tenantId: string,
  restringirA: string | null,
  pacienteId: string,
): Promise<AnalitoHistorico[] | null> {
  const { rows: pac } = await pool.query<{ sexo: string | null }>(
    `select sexo_biologico::text as sexo from paciente
     where id = $1 and clinica_id = $2 and ($3::uuid is null or nutricionista_id = $3)`,
    [pacienteId, tenantId, restringirA],
  )
  if (!pac[0]) return null
  const sexo = pac[0].sexo

  const { rows } = await pool.query<FilaSerie>(
    `with cd as (
       select r.biomarcador_codigo as codigo,
              r.valor, r.valor_texto, r.ref_minimo, r.ref_maximo,
              e.id as estudio_id,
              to_char(e.fecha,'YYYY-MM-DD') as fecha,
              e.fecha as orden_fecha, e.created_at
         from lab_estudio e
         join lab_resultado r on r.estudio_id = e.id
        where e.paciente_id = $1 and e.clinica_id = $2 and e.estado = 'vigente'
          and r.biomarcador_codigo is not null
     )
     select cd.codigo, b.nombre, b.grupo, b.unidad, b.es_cualitativo,
            cd.valor, cd.valor_texto, cd.fecha, cd.estudio_id,
            ${SQL_RANGO_EFECTIVO_RESULTADO}
       from cd
       join biomarcador b on b.codigo = cd.codigo
       ${JOIN_RANGOS.replace(/\$CLINICA/g, '$2').replace(/\$SEXO/g, '$3::sexo_biologico')}
      where b.clinica_id is null or b.clinica_id = $2
      order by b.grupo asc, b.orden asc, cd.orden_fecha asc, cd.created_at asc`,
    [pacienteId, tenantId, sexo],
  )

  const porCodigo = new Map<string, AnalitoHistorico>()
  for (const r of rows) {
    const a = porCodigo.get(r.codigo) ?? {
      codigo: r.codigo,
      nombre: r.nombre,
      grupo: r.grupo,
      unidad: r.unidad,
      es_cualitativo: r.es_cualitativo === true,
      refMin: null,
      refMax: null,
      serie: [],
    }
    a.serie.push({
      fecha: r.fecha,
      valor: r.valor === null ? null : Number(r.valor),
      valor_texto: r.valor_texto,
      estudio_id: r.estudio_id,
    })
    // La consulta viene ordenada por fecha ascendente, asi que la ultima
    // vuelta de cada analito deja el rango del punto mas reciente.
    a.refMin = r.minimo === null ? null : Number(r.minimo)
    a.refMax = r.maximo === null ? null : Number(r.maximo)
    porCodigo.set(r.codigo, a)
  }

  return [...porCodigo.values()]
}
