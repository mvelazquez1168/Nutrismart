/**
 * Acceso a datos del expediente y el timeline.
 *
 * Como en pacientes: `tenantId` es el primer parametro de toda funcion y
 * entra en el WHERE. No es comodidad, es el limite entre clinicas.
 *
 * El IMC se calcula aqui y nunca se almacena. Va como una metrica mas
 * con codigo 'imc', derivada del peso y la talla DEL MISMO snapshot: si
 * ese dia no se midio la talla, su IMC es null y la serie muestra el
 * hueco en vez de arrastrar una talla vieja.
 */
import type { PoolClient } from 'pg'
import { pool } from '../db.js'
import type { DatosSnapshot, MetricaCatalogo } from './validacion.js'

/** Definicion sintetica: el IMC no esta en metrica_catalogo porque no se captura. */
export const IMC: MetricaCatalogo = {
  codigo: 'imc',
  nombre: 'IMC',
  unidad: 'kg/m²',
  decimales: 1,
  minPlausible: null,
  maxPlausible: null,
}

export type Tendencia = 'sube' | 'baja' | 'igual' | null

export interface MetricaValor {
  codigo: string
  nombre: string
  unidad: string
  valor: number
  fecha?: string
  anterior: number | null
  delta: number | null
  tendencia: Tendencia
}

export interface SnapshotResumen {
  id: string
  fecha: string
  estado: string
  profesional: string | null
  nota: string | null
  metricas: MetricaValor[]
  corrigeA: string | null
  corregidoPor: SnapshotResumen | null
  /** Enganches de CLI-04 y CLI-05; hoy siempre null. */
  labs: null
  estrategia: null
}

/* ------------------------------------------------------------------ */
/* Catalogo                                                            */
/* ------------------------------------------------------------------ */

interface FilaCatalogo {
  codigo: string
  nombre: string
  unidad: string
  decimales: number
  min_plausible: string | null
  max_plausible: string | null
}

export async function obtenerCatalogo(): Promise<MetricaCatalogo[]> {
  const { rows } = await pool.query<FilaCatalogo>(
    `select codigo, nombre, unidad, decimales, min_plausible, max_plausible
     from metrica_catalogo where activo = true order by orden asc`,
  )
  return rows.map((r) => ({
    codigo: r.codigo,
    nombre: r.nombre,
    unidad: r.unidad,
    decimales: r.decimales,
    // numeric llega como string desde pg para no perder precision.
    minPlausible: r.min_plausible === null ? null : Number(r.min_plausible),
    maxPlausible: r.max_plausible === null ? null : Number(r.max_plausible),
  }))
}

function tendenciaDe(delta: number | null): Tendencia {
  if (delta === null) return null
  if (delta > 0) return 'sube'
  if (delta < 0) return 'baja'
  return 'igual'
}

/* ------------------------------------------------------------------ */
/* SQL compartido                                                      */
/* ------------------------------------------------------------------ */

/**
 * Valores de un paciente, con el IMC anadido como metrica derivada.
 * `$3` decide si se limita a los snapshots cerrados.
 *
 * Los 'corregido' quedan fuera de la cadena de comparacion: han sido
 * reemplazados, asi que comparar contra ellos daria una tendencia
 * contra un dato que ya nadie considera vigente.
 */
const CTE_VALORES = `
  with cadena as (
    select s.id, s.fecha, s.created_at
    from clinical_snapshot s
    where s.paciente_id = $1
      and s.clinica_id  = $2
      and s.estado <> 'corregido'
      and ($3::boolean is not true or s.estado = 'cerrado')
  ),
  reales as (
    select c.id as snapshot_id, c.fecha, c.created_at,
           m.metrica_codigo as codigo, m.valor
    from cadena c
    join snapshot_metrica m on m.snapshot_id = c.id
  ),
  imc as (
    select pe.snapshot_id, pe.fecha, pe.created_at,
           'imc'::text as codigo,
           round(pe.valor / power(ta.valor / 100.0, 2), 1) as valor
    from reales pe
    join reales ta
      on ta.snapshot_id = pe.snapshot_id
     and ta.codigo = 'talla'
     and ta.valor > 0
    where pe.codigo = 'peso'
  ),
  todo as (
    select * from reales
    union all
    select * from imc
  ),
  con_delta as (
    select
      snapshot_id, fecha, codigo, valor,
      lag(valor) over (partition by codigo order by fecha asc, created_at asc) as anterior
    from todo
  )
`

/* ------------------------------------------------------------------ */
/* Expediente (vista derivada)                                         */
/* ------------------------------------------------------------------ */

export interface Expediente {
  paciente: { id: string; nombre: string; edad: number | null }
  metricas: MetricaValor[]
  diagnosticos: { descripcion: string }[]
  alergias: { descripcion: string }[]
  antecedentes: { tipo: string; descripcion: string }[]
  ultimoSnapshot: { id: string; fecha: string } | null
}

interface FilaVigente {
  codigo: string
  valor: string
  fecha: string
  anterior: string | null
  snapshot_id: string
}

export async function obtenerExpediente(
  tenantId: string,
  pacienteId: string,
  restringirA: string | null,
  catalogo: MetricaCatalogo[],
): Promise<Expediente | null> {
  const { rows: pac } = await pool.query<{ id: string; nombre: string; edad: number | null }>(
    `select id, nombre,
            case when fecha_nacimiento is null then null
                 else extract(year from age(fecha_nacimiento))::int end as edad
     from paciente
     where id = $1 and clinica_id = $2
       and ($3::uuid is null or nutricionista_id = $3)
     limit 1`,
    [pacienteId, tenantId, restringirA],
  )
  const p = pac[0]
  if (!p) return null

  // El estado actual es el ULTIMO valor cerrado de cada metrica, que no
  // tiene por que venir del mismo snapshot: si en el ultimo control no
  // se midio la cintura, sigue vigente la del control anterior.
  const { rows: vigentes } = await pool.query<FilaVigente>(
    `${CTE_VALORES},
     ranked as (
       select *, row_number() over (partition by codigo order by fecha desc) as rn
       from con_delta
     )
     select codigo, valor, to_char(fecha, 'YYYY-MM-DD') as fecha, anterior, snapshot_id
     from ranked where rn = 1`,
    [pacienteId, tenantId, true],
  )

  const porCodigo = new Map([...catalogo, IMC].map((m) => [m.codigo, m]))
  const orden = new Map([...catalogo, IMC].map((m, i) => [m.codigo, i]))

  const metricas: MetricaValor[] = vigentes
    .map((v) => {
      const def = porCodigo.get(v.codigo)
      const valor = Number(v.valor)
      const anterior = v.anterior === null ? null : Number(v.anterior)
      const delta = anterior === null ? null : Number((valor - anterior).toFixed(2))
      return {
        codigo: v.codigo,
        nombre: def?.nombre ?? v.codigo,
        unidad: def?.unidad ?? '',
        valor,
        fecha: v.fecha,
        anterior,
        delta,
        tendencia: tendenciaDe(delta),
      }
    })
    .sort((a, b) => (orden.get(a.codigo) ?? 99) - (orden.get(b.codigo) ?? 99))

  const [diag, alerg, ante, ultimo] = await Promise.all([
    pool.query<{ descripcion: string }>(
      `select descripcion from paciente_diagnostico
       where paciente_id = $1 and clinica_id = $2 and activo = true
       order by created_at asc`,
      [pacienteId, tenantId],
    ),
    pool.query<{ descripcion: string }>(
      `select descripcion from paciente_alergia
       where paciente_id = $1 and clinica_id = $2 and activo = true
       order by created_at asc`,
      [pacienteId, tenantId],
    ),
    pool.query<{ tipo: string; descripcion: string }>(
      `select tipo::text as tipo, descripcion from paciente_antecedente
       where paciente_id = $1 and clinica_id = $2 and activo = true
       order by tipo asc, created_at asc`,
      [pacienteId, tenantId],
    ),
    pool.query<{ id: string; fecha: string }>(
      `select id, to_char(fecha, 'YYYY-MM-DD') as fecha
       from clinical_snapshot
       where paciente_id = $1 and clinica_id = $2 and estado = 'cerrado'
       order by fecha desc, created_at desc limit 1`,
      [pacienteId, tenantId],
    ),
  ])

  return {
    paciente: p,
    metricas,
    diagnosticos: diag.rows,
    alergias: alerg.rows,
    antecedentes: ante.rows,
    ultimoSnapshot: ultimo.rows[0] ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

interface FilaSnapshot {
  id: string
  fecha: string
  estado: string
  profesional: string | null
  nota: string | null
  corrige_a_id: string | null
}

interface FilaMetricaSnap {
  snapshot_id: string
  codigo: string
  valor: string
  anterior: string | null
}

const SQL_SNAPSHOTS = `
  select
    s.id,
    to_char(s.fecha, 'YYYY-MM-DD') as fecha,
    s.estado::text                 as estado,
    prof.nombre                    as profesional,
    n.texto                        as nota,
    s.corrige_a_id
  from clinical_snapshot s
  left join profesional  prof on prof.id = s.profesional_id
  left join clinical_note n    on n.snapshot_id = s.id
  where s.paciente_id = $1 and s.clinica_id = $2
  order by s.fecha desc, s.created_at desc
`

/** Metricas de los snapshots 'corregido': se muestran, pero sin tendencia. */
const SQL_METRICAS_CORREGIDOS = `
  select m.snapshot_id, m.metrica_codigo as codigo, m.valor, null::numeric as anterior
  from clinical_snapshot s
  join snapshot_metrica m on m.snapshot_id = s.id
  where s.paciente_id = $1 and s.clinica_id = $2 and s.estado = 'corregido'
`

export async function obtenerTimeline(
  tenantId: string,
  pacienteId: string,
  catalogo: MetricaCatalogo[],
): Promise<SnapshotResumen[]> {
  const [snaps, conDelta, corregidos] = await Promise.all([
    pool.query<FilaSnapshot>(SQL_SNAPSHOTS, [pacienteId, tenantId]),
    pool.query<FilaMetricaSnap>(
      `${CTE_VALORES} select snapshot_id, codigo, valor, anterior from con_delta`,
      [pacienteId, tenantId, false],
    ),
    pool.query<FilaMetricaSnap>(SQL_METRICAS_CORREGIDOS, [pacienteId, tenantId]),
  ])

  const porCodigo = new Map([...catalogo, IMC].map((m) => [m.codigo, m]))
  const orden = new Map([...catalogo, IMC].map((m, i) => [m.codigo, i]))

  const porSnapshot = new Map<string, MetricaValor[]>()
  for (const f of [...conDelta.rows, ...corregidos.rows]) {
    const def = porCodigo.get(f.codigo)
    const valor = Number(f.valor)
    const anterior = f.anterior === null ? null : Number(f.anterior)
    const delta = anterior === null ? null : Number((valor - anterior).toFixed(2))

    const lista = porSnapshot.get(f.snapshot_id) ?? []
    lista.push({
      codigo: f.codigo,
      nombre: def?.nombre ?? f.codigo,
      unidad: def?.unidad ?? '',
      valor,
      anterior,
      delta,
      tendencia: tendenciaDe(delta),
    })
    porSnapshot.set(f.snapshot_id, lista)
  }

  for (const lista of porSnapshot.values()) {
    lista.sort((a, b) => (orden.get(a.codigo) ?? 99) - (orden.get(b.codigo) ?? 99))
  }

  const construir = (f: FilaSnapshot): SnapshotResumen => ({
    id: f.id,
    fecha: f.fecha,
    estado: f.estado,
    profesional: f.profesional,
    nota: f.nota,
    metricas: porSnapshot.get(f.id) ?? [],
    corrigeA: f.corrige_a_id,
    corregidoPor: null,
    labs: null,
    estrategia: null,
  })

  // Los corregidos no aparecen sueltos: se anidan bajo la version que
  // los reemplaza, para que la linea temporal se lea de un vistazo sin
  // ocultar historia.
  const todos = new Map(snaps.rows.map((f) => [f.id, construir(f)]))
  const raiz: SnapshotResumen[] = []

  for (const f of snaps.rows) {
    const actual = todos.get(f.id)
    if (!actual) continue

    if (f.corrige_a_id) {
      const original = todos.get(f.corrige_a_id)
      if (original) {
        actual.corregidoPor = original
        raiz.push(actual)
        continue
      }
    }
    // Un snapshot en estado 'corregido' ya viaja anidado en su reemplazo.
    if (f.estado !== 'corregido') raiz.push(actual)
  }

  return raiz
}

/* ------------------------------------------------------------------ */
/* Ciclo de vida del snapshot                                          */
/* ------------------------------------------------------------------ */

export class BorradorAbiertoError extends Error {}
export class SnapshotNoEditableError extends Error {}
export class SnapshotNoCerradoError extends Error {}

function esBorradorDuplicado(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const e = error as { code?: string; constraint?: string }
  return e.code === '23505' && e.constraint === 'idx_snapshot_un_borrador'
}

async function escribirContenido(
  cliente: PoolClient,
  tenantId: string,
  snapshotId: string,
  profesionalId: string | null,
  datos: DatosSnapshot,
): Promise<void> {
  const codigos = Object.keys(datos.metricas)

  // Un borrador NO es un registro clinico cerrado: editarlo es editar,
  // no destruir historia. Por eso aqui si se reemplazan las filas.
  await cliente.query(`delete from snapshot_metrica where snapshot_id = $1 and clinica_id = $2`, [
    snapshotId,
    tenantId,
  ])

  if (codigos.length > 0) {
    await cliente.query(
      `insert into snapshot_metrica (clinica_id, snapshot_id, metrica_codigo, valor)
       select $2, $1, c, v
       from unnest($3::text[], $4::numeric[]) as t(c, v)`,
      [snapshotId, tenantId, codigos, codigos.map((c) => datos.metricas[c])],
    )
  }

  await cliente.query(`delete from clinical_note where snapshot_id = $1 and clinica_id = $2`, [
    snapshotId,
    tenantId,
  ])

  if (datos.nota) {
    await cliente.query(
      `insert into clinical_note (clinica_id, snapshot_id, profesional_id, texto)
       values ($1, $2, $3, $4)`,
      [tenantId, snapshotId, profesionalId, datos.nota],
    )
  }
}

export async function crearSnapshot(
  tenantId: string,
  pacienteId: string,
  restringirA: string | null,
  profesionalId: string | null,
  datos: DatosSnapshot,
): Promise<string | null> {
  const cliente = await pool.connect()
  try {
    await cliente.query('begin')

    const { rows: pac } = await cliente.query<{ id: string }>(
      `select id from paciente
       where id = $1 and clinica_id = $2
         and ($3::uuid is null or nutricionista_id = $3)`,
      [pacienteId, tenantId, restringirA],
    )
    if (!pac[0]) {
      await cliente.query('rollback')
      return null
    }

    const { rows } = await cliente.query<{ id: string }>(
      `insert into clinical_snapshot (clinica_id, paciente_id, profesional_id, fecha)
       values ($1, $2, $3, $4::date) returning id`,
      [tenantId, pacienteId, profesionalId, datos.fecha],
    )
    const id = rows[0]?.id
    if (!id) throw new Error('El insert de snapshot no devolvio id')

    await escribirContenido(cliente, tenantId, id, profesionalId, datos)
    await cliente.query('commit')
    return id
  } catch (error) {
    await cliente.query('rollback')
    if (esBorradorDuplicado(error)) throw new BorradorAbiertoError()
    throw error
  } finally {
    cliente.release()
  }
}

/**
 * Fragmento que ata un snapshot a la visibilidad de su PACIENTE. Las
 * rutas /api/snapshots/:id no reciben el paciente, asi que la regla de
 * CLI-02 tiene que resolverse aqui o se saltaria por completo.
 */
const VISIBLE_POR_PACIENTE = `
  and ($3::uuid is null or exists (
        select 1 from paciente p
        where p.id = clinical_snapshot.paciente_id
          and p.nutricionista_id = $3))
`

/** Devuelve el snapshot con su paciente, o null si no existe o no es visible. */
export async function obtenerSnapshotBase(
  tenantId: string,
  snapshotId: string,
  restringirA: string | null,
): Promise<{ id: string; pacienteId: string; estado: string; fecha: string } | null> {
  const { rows } = await pool.query<{
    id: string
    paciente_id: string
    estado: string
    fecha: string
  }>(
    `select id, paciente_id, estado::text as estado, to_char(fecha,'YYYY-MM-DD') as fecha
     from clinical_snapshot
     where id = $1 and clinica_id = $2 ${VISIBLE_POR_PACIENTE}
     limit 1`,
    [snapshotId, tenantId, restringirA],
  )
  const r = rows[0]
  return r ? { id: r.id, pacienteId: r.paciente_id, estado: r.estado, fecha: r.fecha } : null
}

export async function actualizarSnapshot(
  tenantId: string,
  snapshotId: string,
  restringirA: string | null,
  profesionalId: string | null,
  datos: DatosSnapshot,
): Promise<void> {
  const cliente = await pool.connect()
  try {
    await cliente.query('begin')

    // La inmutabilidad se comprueba EN LA BASE con FOR UPDATE, no solo
    // leyendo antes: entre el read y el write podria haberse cerrado.
    const { rows } = await cliente.query<{ estado: string }>(
      `select estado::text as estado from clinical_snapshot
       where id = $1 and clinica_id = $2 ${VISIBLE_POR_PACIENTE}
       for update`,
      [snapshotId, tenantId, restringirA],
    )
    const estado = rows[0]?.estado
    if (!estado) {
      await cliente.query('rollback')
      throw new SnapshotNoEditableError('no_encontrado')
    }
    if (estado !== 'borrador') {
      await cliente.query('rollback')
      throw new SnapshotNoEditableError(estado)
    }

    await cliente.query(`update clinical_snapshot set fecha = $3::date where id = $1 and clinica_id = $2`, [
      snapshotId,
      tenantId,
      datos.fecha,
    ])
    await escribirContenido(cliente, tenantId, snapshotId, profesionalId, datos)
    await cliente.query('commit')
  } catch (error) {
    if (!(error instanceof SnapshotNoEditableError)) await cliente.query('rollback')
    throw error
  } finally {
    cliente.release()
  }
}

/**
 * Cierra el snapshot y sincroniza paciente.ultima_visita.
 * Idempotente: si ya estaba cerrado, no se toca cerrado_at.
 */
export async function cerrarSnapshot(
  tenantId: string,
  snapshotId: string,
  restringirA: string | null,
): Promise<{ estado: string; fecha: string } | null> {
  const cliente = await pool.connect()
  try {
    await cliente.query('begin')

    const { rows } = await cliente.query<{
      estado: string
      fecha: string
      paciente_id: string
    }>(
      `update clinical_snapshot set
         estado     = 'cerrado',
         cerrado_at = case when estado = 'borrador' then now() else cerrado_at end
       where id = $1 and clinica_id = $2 and estado <> 'corregido'
         and ($3::uuid is null or exists (
               select 1 from paciente p
               where p.id = clinical_snapshot.paciente_id
                 and p.nutricionista_id = $3))
       returning estado::text as estado, to_char(fecha,'YYYY-MM-DD') as fecha, paciente_id`,
      [snapshotId, tenantId, restringirA],
    )
    const r = rows[0]
    if (!r) {
      await cliente.query('rollback')
      return null
    }

    // greatest ignora el null inicial y evita retroceder la fecha si se
    // cierra un control antiguo despues de uno mas reciente.
    await cliente.query(
      `update paciente
       set ultima_visita = greatest(coalesce(ultima_visita, $3::date), $3::date)
       where id = $1 and clinica_id = $2`,
      [r.paciente_id, tenantId, r.fecha],
    )

    await cliente.query('commit')
    return { estado: r.estado, fecha: r.fecha }
  } catch (error) {
    await cliente.query('rollback')
    throw error
  } finally {
    cliente.release()
  }
}

/**
 * Crea una version correctiva de un snapshot cerrado, copiando su
 * contenido. El original pasa a 'corregido' y sigue consultable.
 */
export async function corregirSnapshot(
  tenantId: string,
  snapshotId: string,
  restringirA: string | null,
  profesionalId: string | null,
): Promise<string> {
  const cliente = await pool.connect()
  try {
    await cliente.query('begin')

    const { rows } = await cliente.query<{
      estado: string
      paciente_id: string
      fecha: string
    }>(
      `select estado::text as estado, paciente_id, to_char(fecha,'YYYY-MM-DD') as fecha
       from clinical_snapshot
       where id = $1 and clinica_id = $2 ${VISIBLE_POR_PACIENTE}
       for update`,
      [snapshotId, tenantId, restringirA],
    )
    const original = rows[0]
    if (!original) {
      await cliente.query('rollback')
      throw new SnapshotNoCerradoError('no_encontrado')
    }
    if (original.estado !== 'cerrado') {
      await cliente.query('rollback')
      throw new SnapshotNoCerradoError(original.estado)
    }

    const { rows: nuevo } = await cliente.query<{ id: string }>(
      `insert into clinical_snapshot (clinica_id, paciente_id, profesional_id, fecha, corrige_a_id)
       values ($1, $2, $3, $4::date, $5) returning id`,
      [tenantId, original.paciente_id, profesionalId, original.fecha, snapshotId],
    )
    const nuevoId = nuevo[0]?.id
    if (!nuevoId) throw new Error('El insert de la correccion no devolvio id')

    await cliente.query(
      `insert into snapshot_metrica (clinica_id, snapshot_id, metrica_codigo, valor)
       select clinica_id, $2, metrica_codigo, valor
       from snapshot_metrica where snapshot_id = $1`,
      [snapshotId, nuevoId],
    )
    await cliente.query(
      `insert into clinical_note (clinica_id, snapshot_id, profesional_id, texto)
       select clinica_id, $2, profesional_id, texto
       from clinical_note where snapshot_id = $1`,
      [snapshotId, nuevoId],
    )

    await cliente.query(`update clinical_snapshot set estado = 'corregido' where id = $1`, [
      snapshotId,
    ])

    await cliente.query('commit')
    return nuevoId
  } catch (error) {
    if (!(error instanceof SnapshotNoCerradoError)) await cliente.query('rollback')
    if (esBorradorDuplicado(error)) throw new BorradorAbiertoError()
    throw error
  } finally {
    cliente.release()
  }
}
