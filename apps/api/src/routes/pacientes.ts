/**
 * GET /api/pacientes?search=&estadoClinico=
 *
 * Contrato en docs/REBANADA-01.md.
 *
 * Aislamiento entre inquilinos: clinica_id sale SIEMPRE de request.auth,
 * nunca de la query string. Si el tenant fuese un parametro de entrada,
 * cambiarlo en la URL leeria los pacientes de otra clinica.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'

/** Valores del enum estado_clinico en la migracion 001. */
const ESTADOS_CLINICOS = ['normal', 'alerta', 'critico'] as const
type EstadoClinico = (typeof ESTADOS_CLINICOS)[number]

interface Query {
  search?: string
  estadoClinico?: string
}

interface PacienteRow {
  id: string
  nombre: string
  edad: number | null
  estadoClinico: string
  ultimaVisita: string | null
  nutricionista: string | null
}

const SQL = `
  select
    p.id,
    p.nombre,
    case
      when p.fecha_nacimiento is null then null
      else extract(year from age(p.fecha_nacimiento))::int
    end                                        as edad,
    p.estado_clinico::text                     as "estadoClinico",
    to_char(p.ultima_visita, 'YYYY-MM-DD')     as "ultimaVisita",
    prof.nombre                                as nutricionista
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
  order by p.nombre asc
`

function parseEstadoClinico(raw: string | undefined): EstadoClinico | null {
  if (raw === undefined || raw.trim() === '') return null
  const valor = raw.trim().toLowerCase()
  // Se valida contra la lista en vez de pasarlo tal cual a Postgres: un
  // valor fuera del enum provocaria un error 500 en lugar de un 400 claro.
  return (ESTADOS_CLINICOS as readonly string[]).includes(valor) ? (valor as EstadoClinico) : null
}

export async function registerPacientesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Query }>(
    '/api/pacientes',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId } = request.auth

      const searchRaw = request.query.search?.trim()
      const search = searchRaw ? searchRaw : null

      const estadoRaw = request.query.estadoClinico
      const estadoClinico = parseEstadoClinico(estadoRaw)

      if (estadoRaw !== undefined && estadoRaw.trim() !== '' && estadoClinico === null) {
        return reply.code(400).send({
          error: 'estado_clinico_invalido',
          message: `estadoClinico debe ser uno de: ${ESTADOS_CLINICOS.join(', ')}`,
        })
      }

      const { rows } = await pool.query<PacienteRow>(SQL, [tenantId, search, estadoClinico])
      return rows
    },
  )
}
