/**
 * Acceso a datos de la agenda.
 *
 * Como en el resto: `tenantId` y `restringirA` son parametros
 * obligatorios de cada firma, no filtros opcionales que alguien pueda
 * olvidar. `restringirA` null significa "administrador, ve toda la
 * clinica"; con valor, solo lo suyo.
 */
import type { PoolClient } from 'pg'
import { pool } from '../db.js'
import type { CitaEstado, DatosCita } from './validacion.js'

export interface Cita {
  id: string
  inicio: string
  fin: string
  duracionMinutos: number
  tipo: string
  estado: string
  notas: string | null
  snapshotId: string | null
  paciente: { id: string; nombre: string }
  profesional: string | null
}

export class CitaSolapadaError extends Error {
  constructor(readonly choque: { id: string; inicio: string; fin: string } | null) {
    super('cita_solapada')
  }
}
/**
 * Solo se edita una cita `programada`. Una completada registra lo que
 * ocurrio y una cancelada, lo que no ocurrio: ambas son historia, y
 * moverles la hora despues reescribiria los hechos. Es la misma regla
 * que hace inmutable un snapshot cerrado.
 *
 * Lleva el estado actual en el mensaje para que la API pueda explicar
 * cual de los dos casos es.
 */
export class CitaNoEditableError extends Error {}
export class TransicionInvalidaError extends Error {}
export class PacienteNoVisibleError extends Error {}
export class ControlYaRegistradoError extends Error {}
export class CitaNoCompletadaError extends Error {}
export class BorradorAbiertoError extends Error {}

/** 23P01 = exclusion_violation. */
function esSolape(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23P01'
}

/** 23505 sobre el indice parcial de borradores. */
function esBorradorDuplicado(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const e = error as { code?: string; constraint?: string }
  return e.code === '23505' && e.constraint === 'idx_snapshot_un_borrador'
}

/**
 * inicio y fin viajan SIN to_char.
 *
 * 'OF' emite el offset en dos digitos ("+00") cuando son horas enteras,
 * y eso no es ISO 8601 valido: el propio formulario de edicion fallaria
 * al reenviar sin tocar la fecha que acaba de recibir. Dejando pasar el
 * timestamptz, pg devuelve un Date y Fastify lo serializa en ISO
 * completo, que cualquier cliente sabe leer.
 */
const CAMPOS = `
  c.id,
  c.inicio,
  c.fin,
  c.duracion_minutos as "duracionMinutos",
  c.tipo::text       as tipo,
  c.estado::text     as estado,
  c.notas,
  c.snapshot_id      as "snapshotId",
  p.id               as "pacienteId",
  p.nombre           as "pacienteNombre",
  prof.nombre        as profesional
`

interface FilaCita {
  id: string
  inicio: string
  fin: string
  duracionMinutos: number
  tipo: string
  estado: string
  notas: string | null
  snapshotId: string | null
  pacienteId: string
  pacienteNombre: string
  profesional: string | null
}

function aCita(f: FilaCita): Cita {
  return {
    id: f.id,
    inicio: f.inicio,
    fin: f.fin,
    duracionMinutos: f.duracionMinutos,
    tipo: f.tipo,
    estado: f.estado,
    notas: f.notas,
    snapshotId: f.snapshotId,
    paciente: { id: f.pacienteId, nombre: f.pacienteNombre },
    profesional: f.profesional,
  }
}

/* ------------------------------------------------------------------ */
/* Listado                                                             */
/* ------------------------------------------------------------------ */

export interface FiltrosAgenda {
  desde: string
  hasta: string
  estado: CitaEstado | null
  pacienteId: string | null
  /** Filtro elegido por el usuario; se aplica ADEMÁS de `restringirA`. */
  profesionalId: string | null
}

export async function listarCitas(
  tenantId: string,
  restringirA: string | null,
  filtros: FiltrosAgenda,
): Promise<Cita[]> {
  const { rows } = await pool.query<FilaCita>(
    `select ${CAMPOS}
     from cita c
     join paciente    p    on p.id = c.paciente_id
     left join profesional prof on prof.id = c.profesional_id
     where c.clinica_id = $1
       and ($2::uuid is null or c.profesional_id = $2)
       and c.inicio >= $3::timestamptz
       and c.inicio <  $4::timestamptz
       and ($5::text is null or c.estado::text = $5)
       and ($6::uuid is null or c.paciente_id = $6)
       and ($7::uuid is null or c.profesional_id = $7)
     order by c.inicio asc`,
    [
      tenantId,
      // El alcance ($2) y el filtro elegido ($7) son condiciones
      // SEPARADAS y ambas se aplican: un nutricionista que pidiera
      // ?profesionalId=<otro> seguiría viendo solo lo suyo, no lo ajeno.
      restringirA,
      filtros.desde,
      filtros.hasta,
      filtros.estado,
      filtros.pacienteId,
      filtros.profesionalId,
    ],
  )
  return rows.map(aCita)
}

export async function obtenerCita(
  tenantId: string,
  restringirA: string | null,
  citaId: string,
): Promise<Cita | null> {
  const { rows } = await pool.query<FilaCita>(
    `select ${CAMPOS}
     from cita c
     join paciente    p    on p.id = c.paciente_id
     left join profesional prof on prof.id = c.profesional_id
     where c.id = $1 and c.clinica_id = $2
       and ($3::uuid is null or c.profesional_id = $3)
     limit 1`,
    [citaId, tenantId, restringirA],
  )
  return rows[0] ? aCita(rows[0]) : null
}

/* ------------------------------------------------------------------ */
/* Solapes                                                             */
/* ------------------------------------------------------------------ */

/**
 * Busca con qué cita choca, DESPUÉS de que la base haya rechazado la
 * operación. Nunca antes: consultar primero y confiar en el resultado
 * es la carrera que la restricción de exclusión existe para cerrar.
 * Esto es solo para poder decirle al usuario con qué se topó.
 */
async function buscarChoque(
  ejecutor: PoolClient | typeof pool,
  profesionalId: string,
  inicioIso: string,
  duracionMinutos: number,
  excluirCitaId: string | null,
): Promise<{ id: string; inicio: string; fin: string } | null> {
  const { rows } = await ejecutor.query<{ id: string; inicio: string; fin: string }>(
    `select id, inicio, fin
     from cita
     where profesional_id = $1
       and estado <> 'cancelada'
       and ($4::uuid is null or id <> $4)
       and tstzrange(inicio, fin) &&
           tstzrange($2::timestamptz, $2::timestamptz + make_interval(mins => $3))
     order by inicio asc
     limit 1`,
    [profesionalId, inicioIso, duracionMinutos, excluirCitaId],
  )
  return rows[0] ?? null
}

/* ------------------------------------------------------------------ */
/* Alta                                                                */
/* ------------------------------------------------------------------ */

export async function crearCita(
  tenantId: string,
  restringirA: string | null,
  profesionalId: string,
  datos: DatosCita,
): Promise<string> {
  // El paciente tiene que existir, estar en esta clínica, ser visible
  // para quien agenda y no estar archivado: agendar a un paciente dado
  // de baja es casi siempre un error de selección.
  const { rows: pac } = await pool.query<{ id: string }>(
    `select id from paciente
     where id = $1 and clinica_id = $2 and estado <> 'baja'
       and ($3::uuid is null or nutricionista_id = $3)`,
    [datos.pacienteId, tenantId, restringirA],
  )
  if (!pac[0]) throw new PacienteNoVisibleError()

  try {
    const { rows } = await pool.query<{ id: string }>(
      `insert into cita (clinica_id, paciente_id, profesional_id, inicio, duracion_minutos, tipo, notas)
       values ($1, $2, $3, $4::timestamptz, $5, $6::cita_tipo, $7)
       returning id`,
      [
        tenantId,
        datos.pacienteId,
        profesionalId,
        datos.inicio,
        datos.duracionMinutos,
        datos.tipo,
        datos.notas,
      ],
    )
    const id = rows[0]?.id
    if (!id) throw new Error('El insert de cita no devolvio id')
    return id
  } catch (error) {
    if (esSolape(error)) {
      const choque = await buscarChoque(
        pool,
        profesionalId,
        datos.inicio,
        datos.duracionMinutos,
        null,
      )
      throw new CitaSolapadaError(choque)
    }
    throw error
  }
}

/* ------------------------------------------------------------------ */
/* Edicion                                                             */
/* ------------------------------------------------------------------ */

export async function actualizarCita(
  tenantId: string,
  restringirA: string | null,
  citaId: string,
  datos: DatosCita,
): Promise<boolean> {
  const { rows } = await pool.query<{ estado: string; profesional_id: string }>(
    `select estado::text as estado, profesional_id from cita
     where id = $1 and clinica_id = $2 and ($3::uuid is null or profesional_id = $3)`,
    [citaId, tenantId, restringirA],
  )
  const actual = rows[0]
  if (!actual) return false

  if (actual.estado !== 'programada') throw new CitaNoEditableError(actual.estado)

  try {
    await pool.query(
      `update cita set
         inicio           = $3::timestamptz,
         duracion_minutos = $4,
         tipo             = $5::cita_tipo,
         notas            = $6
       where id = $1 and clinica_id = $2`,
      [citaId, tenantId, datos.inicio, datos.duracionMinutos, datos.tipo, datos.notas],
    )
    return true
  } catch (error) {
    if (esSolape(error)) {
      const choque = await buscarChoque(
        pool,
        actual.profesional_id,
        datos.inicio,
        datos.duracionMinutos,
        citaId,
      )
      throw new CitaSolapadaError(choque)
    }
    throw error
  }
}

/* ------------------------------------------------------------------ */
/* Cambio de estado                                                    */
/* ------------------------------------------------------------------ */

const TRANSICIONES: Record<string, CitaEstado[]> = {
  programada: ['completada', 'cancelada'],
  completada: [],
  cancelada: [],
}

/**
 * Solo se avanza desde 'programada'. Reabrir una cita cerrada
 * falsearía el registro de lo que ocurrió; si hace falta otra
 * consulta, se agenda una nueva.
 */
export async function cambiarEstado(
  tenantId: string,
  restringirA: string | null,
  citaId: string,
  nuevo: CitaEstado,
): Promise<boolean> {
  const { rows } = await pool.query<{ estado: string }>(
    `select estado::text as estado from cita
     where id = $1 and clinica_id = $2 and ($3::uuid is null or profesional_id = $3)`,
    [citaId, tenantId, restringirA],
  )
  const actual = rows[0]?.estado
  if (!actual) return false

  // Idempotente: pedir el estado que ya tiene no es un error.
  if (actual === nuevo) return true

  if (!(TRANSICIONES[actual] ?? []).includes(nuevo)) throw new TransicionInvalidaError(actual)

  await pool.query(`update cita set estado = $3::cita_estado where id = $1 and clinica_id = $2`, [
    citaId,
    tenantId,
    nuevo,
  ])
  return true
}

/* ------------------------------------------------------------------ */
/* Control clinico desde la cita                                       */
/* ------------------------------------------------------------------ */

/**
 * Crea un snapshot en borrador con la fecha de la cita y lo enlaza.
 *
 * Ambas cosas en UNA transacción: si el enlace fallara por separado,
 * quedaría un borrador huérfano ocupando el único hueco de borrador de
 * ese paciente, y el siguiente intento fallaría sin motivo aparente.
 */
export async function registrarControl(
  tenantId: string,
  restringirA: string | null,
  citaId: string,
  profesionalId: string,
): Promise<string | null> {
  const cliente = await pool.connect()
  try {
    await cliente.query('begin')

    const { rows } = await cliente.query<{
      estado: string
      paciente_id: string
      snapshot_id: string | null
      fecha: string
    }>(
      `select estado::text as estado, paciente_id, snapshot_id,
              to_char(inicio, 'YYYY-MM-DD') as fecha
       from cita
       where id = $1 and clinica_id = $2 and ($3::uuid is null or profesional_id = $3)
       for update`,
      [citaId, tenantId, restringirA],
    )
    const cita = rows[0]
    if (!cita) {
      await cliente.query('rollback')
      return null
    }
    if (cita.estado !== 'completada') {
      await cliente.query('rollback')
      throw new CitaNoCompletadaError(cita.estado)
    }
    if (cita.snapshot_id) {
      await cliente.query('rollback')
      throw new ControlYaRegistradoError(cita.snapshot_id)
    }

    const { rows: snap } = await cliente.query<{ id: string }>(
      `insert into clinical_snapshot (clinica_id, paciente_id, profesional_id, fecha)
       values ($1, $2, $3, $4::date) returning id`,
      [tenantId, cita.paciente_id, profesionalId, cita.fecha],
    )
    const snapshotId = snap[0]?.id
    if (!snapshotId) throw new Error('El insert de snapshot no devolvio id')

    await cliente.query(`update cita set snapshot_id = $2 where id = $1`, [citaId, snapshotId])

    await cliente.query('commit')
    return snapshotId
  } catch (error) {
    if (
      !(error instanceof CitaNoCompletadaError) &&
      !(error instanceof ControlYaRegistradoError)
    ) {
      await cliente.query('rollback')
    }
    if (esBorradorDuplicado(error)) throw new BorradorAbiertoError()
    throw error
  } finally {
    cliente.release()
  }
}
