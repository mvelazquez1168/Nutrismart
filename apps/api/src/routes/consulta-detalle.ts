/**
 * Detalle completo de una consulta — R43.
 *
 * Un único GET que reúne todo lo que se registró en una consulta, para
 * leerlo de un tirón en el panel lateral del expediente. Existe porque
 * la alternativa —cuatro peticiones desde el navegador al abrir el
 * panel— multiplica latencias y deja la pantalla rellenándose a trozos.
 *
 * Es de SOLO LECTURA: no hay PUT hermano. Lo que se escribe sigue
 * escribiéndose por su sección (antropometría, conclusión, plan), que es
 * donde vive la validación de cada una.
 *
 * El plan alimentario es el único que no cuelga de la consulta: la tabla
 * `plan_alimentario` no tiene `consulta_id`. Se deduce por fechas —ver
 * `SQL_PLAN_VIGENTE`— y por eso el campo se llama «vigente» y no «de
 * esta consulta».
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { esUuid } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'
import { aConsulta } from './consultas.js'
import { CAMPOS as CAMPOS_MEDICION, aMedicion } from './antropometria.js'
import { CAMPOS as CAMPOS_CONCLUSION, aConclusion } from './conclusion.js'

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}
function noEncontradaConsulta() {
  return { error: 'consulta_no_encontrada', message: 'No se encontró la consulta' }
}

/**
 * La consulta con su profesional, acotada por clínica y alcance.
 *
 * El `join paciente` no sobra aunque ya se filtre por `c.paciente_id`:
 * es el que ata la visibilidad al nutricionista del paciente (CLI-02).
 */
const SQL_CONSULTA = `
  select
    c.id, c.tipo::text as tipo, c.numero_consulta, c.estado::text as estado,
    to_char(c.fecha_consulta, 'YYYY-MM-DD') as fecha_consulta,
    c.secciones_completas, c.paciente_id, c.created_at, c.updated_at,
    pr.nombre as profesional_nombre
  from consulta c
  join paciente p on p.id = c.paciente_id
  join profesional pr on pr.id = c.profesional_id
  where c.id = $1 and c.paciente_id = $2 and c.clinica_id = $3
    and ($4::uuid is null or p.nutricionista_id = $4)
`

/**
 * El plan que regía el día de la consulta.
 *
 * Se deduce por fechas porque no hay vínculo en el modelo. Dos
 * decisiones que conviene no revisar a la ligera:
 *
 *  - Los BORRADORES quedan fuera. Un borrador nunca se le entregó al
 *    paciente, así que presentarlo como «lo que seguía ese día» sería
 *    poner en el expediente algo que no ocurrió.
 *  - Un plan sin fecha de inicio (o sin fin) se considera vigente por
 *    ese extremo: el campo es opcional en la base y descartarlo
 *    dejaría la sección vacía en vez de enseñar el único plan que hay.
 *
 * Si dos encajan, gana el de inicio más reciente —es el que estaba
 * vigente de verdad—; a igualdad de fechas, el que está ACTIVO, porque
 * un archivado fue sustituido por otro y el activo es el que el paciente
 * sigue. Solo después se desempata por antigüedad.
 */
const SQL_PLAN_VIGENTE = `
  select
    pa.id, pa.nombre, pa.objetivo,
    to_char(pa.fecha_inicio, 'YYYY-MM-DD') as fecha_inicio,
    to_char(pa.fecha_fin,    'YYYY-MM-DD') as fecha_fin,
    pa.estado::text as estado, pa.notas
  from plan_alimentario pa
  where pa.clinica_id = $1 and pa.paciente_id = $2
    and pa.estado <> 'borrador'
    and (pa.fecha_inicio is null or pa.fecha_inicio <= $3::date)
    and (pa.fecha_fin    is null or pa.fecha_fin    >= $3::date)
  order by pa.fecha_inicio desc nulls last, (pa.estado = 'activo') desc, pa.created_at desc
  limit 1
`

/* El ORDER BY va contra la columna enum, no contra el alias ::text: así
   los tiempos salen en orden cronológico y no alfabético (ver planes.ts). */
const SQL_COMIDAS = `
  select pc.tipo_comida::text as tipo_comida, pc.patron, pc.ejemplo_menu
  from plan_comida pc
  where pc.plan_id = $1
  order by pc.tipo_comida
`

interface FilaPlan {
  id: string
  nombre: string
  objetivo: string | null
  fecha_inicio: string | null
  fecha_fin: string | null
  estado: string
  notas: string | null
}

interface FilaComida {
  tipo_comida: string
  patron: string | null
  ejemplo_menu: string | null
}

export async function registerConsultaDetalleRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* GET /api/pacientes/:id/consultas/:consultaId/detalle               */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: { id: string; consultaId: string } }>(
    '/api/pacientes/:id/consultas/:consultaId/detalle',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id, consultaId } = request.params
      if (!esUuid(id) || !esUuid(consultaId)) {
        return reply.code(404).send(noEncontradaConsulta())
      }

      const { rows: consultas } = await pool.query(SQL_CONSULTA, [
        consultaId,
        id,
        tenantId,
        alcance.restringirA,
      ])
      const fila = consultas[0] as Record<string, unknown> | undefined
      if (!fila) return reply.code(404).send(noEncontradaConsulta())

      const consulta = aConsulta(fila)

      // Las tres secciones son independientes: en paralelo. Ninguna es
      // obligatoria —una consulta a medias existe— así que la ausencia
      // es null y no un 404.
      const [medicion, conclusion, plan] = await Promise.all([
        pool.query(
          `select ${CAMPOS_MEDICION} from medicion_antropometrica
            where clinica_id = $1 and paciente_id = $2 and consulta_id = $3`,
          [tenantId, id, consultaId],
        ),
        pool.query(`select ${CAMPOS_CONCLUSION} from conclusion_valoracion where consulta_id = $1`, [
          consultaId,
        ]),
        pool.query<FilaPlan>(SQL_PLAN_VIGENTE, [tenantId, id, consulta.fechaConsulta]),
      ])

      const filaPlan = plan.rows[0]
      let planVigente: unknown = null
      if (filaPlan) {
        const { rows: comidas } = await pool.query<FilaComida>(SQL_COMIDAS, [filaPlan.id])
        planVigente = {
          id: filaPlan.id,
          nombre: filaPlan.nombre,
          objetivo: filaPlan.objetivo,
          fechaInicio: filaPlan.fecha_inicio,
          fechaFin: filaPlan.fecha_fin,
          estado: filaPlan.estado,
          notas: filaPlan.notas,
          comidas: comidas.map((c) => ({
            tipoComida: c.tipo_comida,
            patron: c.patron,
            ejemploMenu: c.ejemplo_menu,
          })),
        }
      }

      return reply.send({
        consulta,
        antropometria: medicion.rows[0]
          ? aMedicion(medicion.rows[0] as Record<string, unknown>)
          : null,
        conclusion: conclusion.rows[0]
          ? aConclusion(conclusion.rows[0] as Record<string, unknown>)
          : null,
        plan: planVigente,
      })
    },
  )
}
