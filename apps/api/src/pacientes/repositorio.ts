/**
 * Acceso a datos de pacientes.
 *
 * Regla sin excepciones: TODA funcion recibe `tenantId` como primer
 * parametro y lo aplica en el WHERE. No es una comodidad, es el limite
 * de aislamiento entre clinicas — por eso es obligatorio en la firma y
 * no un filtro opcional que alguien pueda olvidar.
 */
import type { PoolClient } from 'pg'
import { pool } from '../db.js'
import type { DatosPaciente } from './validacion.js'

export interface PacienteLista {
  id: string
  nombre: string
  edad: number | null
  estado: string
  estadoClinico: string
  ultimaVisita: string | null
  nutricionista: string | null
}

export interface PacienteDetalle {
  tieneCuenta: boolean
  id: string
  numeroExpediente: number | null
  nombre: string
  edad: number | null
  fechaNacimiento: string | null
  sexoBiologico: string | null
  documento: { tipo: string | null; numero: string | null }
  telefono: string | null
  correo: string | null
  estado: string
  estadoClinico: string
  motivoConsulta: string | null
  diagnosticos: { descripcion: string }[]
  alergias: { descripcion: string }[]
  nutricionista: string | null
  baja: { motivo: string | null; fecha: string } | null
}

/* ------------------------------------------------------------------ */
/* Listado                                                             */
/* ------------------------------------------------------------------ */

const SQL_LISTA = `
  select
    p.id,
    p.nombre,
    case
      when p.fecha_nacimiento is null then null
      else extract(year from age(p.fecha_nacimiento))::int
    end                                    as edad,
    p.estado::text                         as estado,
    p.estado_clinico::text                 as "estadoClinico",
    to_char(p.ultima_visita, 'YYYY-MM-DD') as "ultimaVisita",
    prof.nombre                            as nutricionista
  from paciente p
  left join profesional prof
    on prof.id = p.nutricionista_id
   and prof.clinica_id = p.clinica_id
  where p.clinica_id = $1
    and p.estado <> 'baja'
    and (
      $2::text is null
      or p.nombre           ilike '%' || $2 || '%'
      or p.documento_numero ilike '%' || $2 || '%'
    )
    and ($3::text is null or p.estado_clinico::text = $3)
    and ($4::uuid is null or p.nutricionista_id = $4)
  order by p.nombre asc
`

export async function listar(
  tenantId: string,
  restringirA: string | null,
  search: string | null,
  estadoClinico: string | null,
): Promise<PacienteLista[]> {
  const { rows } = await pool.query<PacienteLista>(SQL_LISTA, [
    tenantId,
    search,
    estadoClinico,
    restringirA,
  ])
  return rows
}

/* ------------------------------------------------------------------ */
/* Detalle                                                             */
/* ------------------------------------------------------------------ */

const SQL_DETALLE = `
  select
    p.id,
    p.numero_expediente                        as "numeroExpediente",
    p.nombre,
    case
      when p.fecha_nacimiento is null then null
      else extract(year from age(p.fecha_nacimiento))::int
    end                                        as edad,
    to_char(p.fecha_nacimiento, 'YYYY-MM-DD')  as "fechaNacimiento",
    p.sexo_biologico::text                     as "sexoBiologico",
    p.documento_tipo::text                     as "documentoTipo",
    p.documento_numero                         as "documentoNumero",
    p.telefono,
    p.correo,
    (p.keycloak_user_id is not null)           as "tieneCuenta",
    p.estado::text                             as estado,
    p.estado_clinico::text                     as "estadoClinico",
    p.motivo_consulta                          as "motivoConsulta",
    p.baja_motivo                              as "bajaMotivo",
    to_char(p.baja_fecha, 'YYYY-MM-DD"T"HH24:MI:SSOF') as "bajaFecha",
    prof.nombre                                as nutricionista
  from paciente p
  left join profesional prof
    on prof.id = p.nutricionista_id
   and prof.clinica_id = p.clinica_id
  where p.id = $1
    and p.clinica_id = $2
    and ($3::uuid is null or p.nutricionista_id = $3)
  limit 1
`

// Ambas listas filtran activo = true: lo retirado se conserva como
// historico pero no forma parte del cuadro vigente del paciente.
const SQL_DIAGNOSTICOS = `
  select descripcion from paciente_diagnostico
  where paciente_id = $1 and clinica_id = $2 and activo = true
  order by created_at asc, descripcion asc
`

const SQL_ALERGIAS = `
  select descripcion from paciente_alergia
  where paciente_id = $1 and clinica_id = $2 and activo = true
  order by created_at asc, descripcion asc
`

interface FilaDetalle {
  tieneCuenta: boolean
  id: string
  numeroExpediente: string | number | null
  nombre: string
  edad: number | null
  fechaNacimiento: string | null
  sexoBiologico: string | null
  documentoTipo: string | null
  documentoNumero: string | null
  telefono: string | null
  correo: string | null
  estado: string
  estadoClinico: string
  motivoConsulta: string | null
  bajaMotivo: string | null
  bajaFecha: string | null
  nutricionista: string | null
}

/**
 * Devuelve null si no existe, si pertenece a otra clinica O si no es
 * visible para el solicitante. Quien llama responde 404 en los tres
 * casos: distinguirlos revelaria la existencia de pacientes ajenos.
 */
export async function obtenerDetalle(
  tenantId: string,
  pacienteId: string,
  restringirA: string | null,
  cliente?: PoolClient,
): Promise<PacienteDetalle | null> {
  const ejecutor = cliente ?? pool

  const { rows } = await ejecutor.query<FilaDetalle>(SQL_DETALLE, [
    pacienteId,
    tenantId,
    restringirA,
  ])
  const p = rows[0]
  if (!p) return null

  const [diag, alerg] = await Promise.all([
    ejecutor.query<{ descripcion: string }>(SQL_DIAGNOSTICOS, [pacienteId, tenantId]),
    ejecutor.query<{ descripcion: string }>(SQL_ALERGIAS, [pacienteId, tenantId]),
  ])

  return {
    id: p.id,
    // bigint llega como string desde pg para no perder precision.
    numeroExpediente: p.numeroExpediente === null ? null : Number(p.numeroExpediente),
    nombre: p.nombre,
    edad: p.edad,
    fechaNacimiento: p.fechaNacimiento,
    sexoBiologico: p.sexoBiologico,
    documento: { tipo: p.documentoTipo, numero: p.documentoNumero },
    telefono: p.telefono,
    correo: p.correo,
    tieneCuenta: p.tieneCuenta,
    estado: p.estado,
    estadoClinico: p.estadoClinico,
    motivoConsulta: p.motivoConsulta,
    diagnosticos: diag.rows,
    alergias: alerg.rows,
    nutricionista: p.nutricionista,
    baja: p.bajaFecha ? { motivo: p.bajaMotivo, fecha: p.bajaFecha } : null,
  }
}

/* ------------------------------------------------------------------ */
/* Profesional autenticado                                             */
/* ------------------------------------------------------------------ */

export interface ProfesionalResumen {
  id: string
  nombre: string
  rol: string
}

/**
 * Profesionales activos de la clinica. Alimenta el filtro por
 * profesional de la agenda, que solo tiene sentido para un
 * admin_clinica: un nutricionista solo puede verse a si mismo.
 *
 * No lleva `restringirA`: son los compañeros de la clinica, no datos
 * clinicos, y el nombre de un colega no es informacion protegida.
 */
export async function listarProfesionales(tenantId: string): Promise<ProfesionalResumen[]> {
  const { rows } = await pool.query<ProfesionalResumen>(
    `select id, nombre, rol::text as rol
     from profesional
     where clinica_id = $1 and estado <> 'inactivo'
     order by nombre asc`,
    [tenantId],
  )
  return rows
}

/** Resuelve el profesional del token DENTRO de esta clinica. null si no lo hay. */
export async function resolverProfesional(
  tenantId: string,
  sub: string,
): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from profesional
     where keycloak_user_id = $1 and clinica_id = $2 and estado <> 'inactivo'
     limit 1`,
    [sub, tenantId],
  )
  return rows[0]?.id ?? null
}

/* ------------------------------------------------------------------ */
/* Listas de diagnosticos y alergias                                   */
/* ------------------------------------------------------------------ */

/**
 * Reconcilia una lista (diagnosticos o alergias) sin borrar filas:
 *   1. lo que ya no viene  -> activo = false
 *   2. lo que vuelve       -> activo = true
 *   3. lo que es nuevo     -> insert
 *
 * CLAUDE.md lo exige ("nada se borra fisicamente") y ademas conserva
 * el created_at original de una alergia que se retira y se vuelve a
 * anadir, en vez de fabricar una fecha nueva.
 */
async function reconciliarLista(
  cliente: PoolClient,
  tabla: 'paciente_diagnostico' | 'paciente_alergia',
  tenantId: string,
  pacienteId: string,
  descripciones: string[],
): Promise<void> {
  await cliente.query(
    `update ${tabla} set activo = false
     where paciente_id = $1 and clinica_id = $2
       and descripcion <> all($3::text[]) and activo = true`,
    [pacienteId, tenantId, descripciones],
  )

  if (descripciones.length === 0) return

  await cliente.query(
    `update ${tabla} set activo = true
     where paciente_id = $1 and clinica_id = $2
       and descripcion = any($3::text[]) and activo = false`,
    [pacienteId, tenantId, descripciones],
  )

  await cliente.query(
    `insert into ${tabla} (clinica_id, paciente_id, descripcion)
     select $2, $1, d
     from unnest($3::text[]) as d
     where not exists (
       select 1 from ${tabla} x
       where x.paciente_id = $1 and x.clinica_id = $2 and x.descripcion = d
     )`,
    [pacienteId, tenantId, descripciones],
  )
}

/* ------------------------------------------------------------------ */
/* Alta                                                                */
/* ------------------------------------------------------------------ */

export class DocumentoDuplicadoError extends Error {}
export class ExpedienteEnCarreraError extends Error {}

const NOMBRE_CONSTRAINT_EXPEDIENTE = 'paciente_expediente_unico'

function esViolacionUnica(error: unknown): { constraint?: string; detail?: string } | null {
  if (typeof error !== 'object' || error === null) return null
  const e = error as { code?: string; constraint?: string; detail?: string }
  if (e.code !== '23505') return null
  return { ...(e.constraint ? { constraint: e.constraint } : {}), ...(e.detail ? { detail: e.detail } : {}) }
}

async function intentarCrear(
  tenantId: string,
  profesionalId: string,
  datos: DatosPaciente,
): Promise<{ id: string; numeroExpediente: number }> {
  const cliente = await pool.connect()
  try {
    await cliente.query('begin')

    // max+1 dentro de la transaccion. Por si sola NO evita la carrera
    // (en read committed ninguna transaccion ve la fila no confirmada
    // de la otra); quien la evita es el unique (clinica_id,
    // numero_expediente) de la migracion 003, que hace fallar a la
    // segunda. El reintento de arriba la resuelve.
    const { rows: numRows } = await cliente.query<{ siguiente: string }>(
      `select coalesce(max(numero_expediente), 0) + 1 as siguiente
       from paciente where clinica_id = $1`,
      [tenantId],
    )
    const numeroExpediente = Number(numRows[0]?.siguiente ?? 1)

    const { rows } = await cliente.query<{ id: string }>(
      `insert into paciente (
         clinica_id, nutricionista_id, numero_expediente, nombre,
         documento_tipo, documento_numero, fecha_nacimiento, sexo_biologico,
         telefono, correo, motivo_consulta
       ) values (
         $1, $2, $3, $4,
         $5::documento_tipo, $6, $7::date, $8::sexo_biologico,
         $9, $10, $11
       )
       returning id`,
      [
        tenantId,
        profesionalId,
        numeroExpediente,
        datos.nombre,
        datos.documentoTipo,
        datos.documentoNumero,
        datos.fechaNacimiento,
        datos.sexoBiologico,
        datos.telefono,
        datos.correo,
        datos.motivoConsulta,
      ],
    )

    const id = rows[0]?.id
    if (!id) throw new Error('El insert de paciente no devolvio id')

    await reconciliarLista(cliente, 'paciente_diagnostico', tenantId, id, datos.diagnosticos)
    await reconciliarLista(cliente, 'paciente_alergia', tenantId, id, datos.alergias)

    await cliente.query('commit')
    return { id, numeroExpediente }
  } catch (error) {
    await cliente.query('rollback')

    const unica = esViolacionUnica(error)
    if (unica) {
      if (unica.constraint === NOMBRE_CONSTRAINT_EXPEDIENTE) throw new ExpedienteEnCarreraError()
      if (unica.detail?.includes('documento_numero')) throw new DocumentoDuplicadoError()
    }
    throw error
  } finally {
    cliente.release()
  }
}

/**
 * Crea el paciente, reintentando si otra alta se llevo el numero de
 * expediente entre el max+1 y el insert.
 */
export async function crear(
  tenantId: string,
  profesionalId: string,
  datos: DatosPaciente,
  intentos = 5,
): Promise<{ id: string; numeroExpediente: number }> {
  for (let i = 1; i <= intentos; i++) {
    try {
      return await intentarCrear(tenantId, profesionalId, datos)
    } catch (error) {
      if (error instanceof ExpedienteEnCarreraError && i < intentos) continue
      throw error
    }
  }
  throw new ExpedienteEnCarreraError()
}

/* ------------------------------------------------------------------ */
/* Edicion                                                             */
/* ------------------------------------------------------------------ */

/** Devuelve null si el paciente no existe en esta clinica. */
export async function actualizar(
  tenantId: string,
  pacienteId: string,
  restringirA: string | null,
  datos: DatosPaciente,
): Promise<PacienteDetalle | null> {
  const cliente = await pool.connect()
  try {
    await cliente.query('begin')

    const { rowCount } = await cliente.query(
      `update paciente set
         nombre           = $3,
         documento_tipo   = $4::documento_tipo,
         documento_numero = $5,
         fecha_nacimiento = $6::date,
         sexo_biologico   = $7::sexo_biologico,
         telefono         = $8,
         correo           = $9,
         motivo_consulta  = $10
       where id = $1 and clinica_id = $2
         and ($11::uuid is null or nutricionista_id = $11)`,
      [
        pacienteId,
        tenantId,
        datos.nombre,
        datos.documentoTipo,
        datos.documentoNumero,
        datos.fechaNacimiento,
        datos.sexoBiologico,
        datos.telefono,
        datos.correo,
        datos.motivoConsulta,
        restringirA,
      ],
    )

    if (rowCount === 0) {
      await cliente.query('rollback')
      return null
    }

    await reconciliarLista(cliente, 'paciente_diagnostico', tenantId, pacienteId, datos.diagnosticos)
    await reconciliarLista(cliente, 'paciente_alergia', tenantId, pacienteId, datos.alergias)

    const detalle = await obtenerDetalle(tenantId, pacienteId, restringirA, cliente)
    await cliente.query('commit')
    return detalle
  } catch (error) {
    await cliente.query('rollback')
    if (esViolacionUnica(error)?.detail?.includes('documento_numero')) {
      throw new DocumentoDuplicadoError()
    }
    throw error
  } finally {
    cliente.release()
  }
}

/* ------------------------------------------------------------------ */
/* Baja logica                                                         */
/* ------------------------------------------------------------------ */

/**
 * Idempotente: si ya estaba en baja no se toca ni la fecha ni el
 * motivo originales. Un doble clic no debe reescribir cuando se
 * archivo al paciente.
 *
 * Nunca hay DELETE: la fila permanece por trazabilidad clinica y solo
 * deja de aparecer en la lista.
 */
export async function darDeBaja(
  tenantId: string,
  pacienteId: string,
  restringirA: string | null,
  motivo: string | null,
): Promise<{ estado: string; bajaFecha: string; bajaMotivo: string | null } | null> {
  const { rows } = await pool.query<{
    estado: string
    bajaFecha: string
    bajaMotivo: string | null
  }>(
    `update paciente set
       estado      = 'baja',
       baja_fecha  = case when estado = 'baja' then baja_fecha  else now() end,
       baja_motivo = case when estado = 'baja' then baja_motivo else $3   end
     where id = $1 and clinica_id = $2
       and ($4::uuid is null or nutricionista_id = $4)
     returning
       estado::text as estado,
       to_char(baja_fecha, 'YYYY-MM-DD"T"HH24:MI:SSOF') as "bajaFecha",
       baja_motivo as "bajaMotivo"`,
    [pacienteId, tenantId, motivo, restringirA],
  )
  return rows[0] ?? null
}
