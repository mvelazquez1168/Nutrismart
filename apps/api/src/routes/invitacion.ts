/**
 * Invitación del paciente — PAC-01.
 *
 * Tres rutas con tres niveles de acceso distintos:
 *   - crear invitación: profesional de la clínica
 *   - consultar el token: PÚBLICA (el paciente aún no tiene cuenta)
 *   - vincular: paciente autenticado, sin claim de clínica
 *
 * La clínica NUNCA llega del cliente. Al crear sale del token del
 * profesional; al vincular sale de la fila de la invitación.
 */
import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth, requireAuthPaciente } from '../auth.js'
import { resolverAlcance } from '../pacientes/acceso.js'
import { pacienteVisible } from './consultas.js'
import { enviarInvitacion, type ResultadoEnvio } from '../pac/email.js'
import { config } from '../config.js'

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}

/** Token de 256 bits. Se compara por igualdad exacta contra un índice único. */
function nuevoToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export async function registerInvitacionRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* POST /api/pacientes/:id/invitar                                   */
  /* ---------------------------------------------------------------- */
  app.post<{ Params: { id: string } }>(
    '/api/pacientes/:id/invitar',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply
          .code(404)
          .send({ error: 'paciente_no_encontrado', message: 'No se encontró el paciente' })
      }

      const { rows: pac } = await pool.query<{
        nombre: string
        correo: string | null
        keycloak_user_id: string | null
        clinica: string
      }>(
        `select p.nombre, p.correo, p.keycloak_user_id,
                coalesce(c.nombre_comercial, c.nombre_fiscal) as clinica
           from paciente p
           join clinica c on c.id = p.clinica_id
          where p.id = $1 and p.clinica_id = $2 and p.estado = 'activo'`,
        [id, tenantId],
      )
      const p = pac[0]
      if (!p) {
        return reply.code(404).send({
          error: 'paciente_no_encontrado',
          message: 'No se encontró un paciente activo con ese identificador',
        })
      }

      if (p.keycloak_user_id) {
        return reply.code(409).send({
          error: 'ya_vinculado',
          message: 'Este paciente ya tiene cuenta activa en NutriSmart',
        })
      }
      if (!p.correo) {
        return reply.code(422).send({
          error: 'sin_correo',
          message: 'El paciente no tiene correo registrado. Añádelo antes de invitar.',
        })
      }

      const token = nuevoToken()

      // Caducar la anterior y crear la nueva en la MISMA transacción: el
      // índice único de "una pendiente por paciente" rechazaría el insert
      // si el update no se hubiera aplicado, y dos pulsaciones seguidas
      // del botón no pueden dejar dos enlaces vivos.
      const cliente = await pool.connect()
      let invitacion: { id: string; expira_en: string }
      try {
        await cliente.query('begin')
        await cliente.query(
          `update invitacion_paciente set estado = 'expirada'
            where clinica_id = $1 and paciente_id = $2 and estado = 'pendiente'`,
          [tenantId, id],
        )
        const { rows } = await cliente.query(
          `insert into invitacion_paciente (clinica_id, paciente_id, profesional_id, token)
           values ($1,$2,$3,$4)
           returning id, to_char(expira_en at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as expira_en`,
          [tenantId, id, alcance.profesionalId, token],
        )
        await cliente.query('commit')
        invitacion = rows[0] as { id: string; expira_en: string }
      } catch (e) {
        await cliente.query('rollback')
        throw e
      } finally {
        cliente.release()
      }

      // El correo va DESPUÉS de confirmar. Si falla, la invitación ya
      // existe y el profesional puede entregar el enlace a mano; al
      // revés habría enlaces enviados que no existen en la base.
      let envio: ResultadoEnvio = 'fallo'
      try {
        envio = await enviarInvitacion({
          correoPaciente: p.correo,
          nombrePaciente: p.nombre,
          nombreClinica: p.clinica,
          token,
        })
        if (envio === 'enviado') {
          await pool.query(`update invitacion_paciente set email_enviado = true where id = $1`, [
            invitacion.id,
          ])
        }
      } catch (e) {
        request.log.error({ e }, 'pac: fallo al enviar la invitación')
      }

      const MENSAJE: Record<ResultadoEnvio, string> = {
        enviado: `Invitación enviada a ${p.correo}`,
        sin_configurar:
          'Invitación creada. No hay correo configurado: entrega el enlace tú mismo.',
        fallo: 'Invitación creada, pero el correo no salió. Entrega el enlace tú mismo.',
      }

      return reply.code(201).send({
        mensaje: MENSAJE[envio],
        emailEnviado: envio === 'enviado',
        // El enlace se devuelve siempre a quien acaba de crearlo. Ya está
        // autorizado a invitar a este paciente, y sin esto una caída del
        // correo deja la invitación inservible.
        enlace: `${config.pacAppUrl}/activar?token=${token}`,
        expiraEn: invitacion.expira_en,
      })
    },
  )

  /* ---------------------------------------------------------------- */
  /* GET /api/invitacion/:token — PÚBLICA                              */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: { token: string } }>(
    '/api/invitacion/:token',
    async (request, reply) => {
      const { token } = request.params

      const { rows } = await pool.query<{
        estado: string
        caducado: boolean
        nombre_paciente: string
        clinica: string
        expira_en: string
      }>(
        `select i.estado::text as estado,
                (i.expira_en < now()) as caducado,
                p.nombre as nombre_paciente,
                coalesce(c.nombre_comercial, c.nombre_fiscal) as clinica,
                to_char(i.expira_en at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as expira_en
           from invitacion_paciente i
           join paciente p on p.id = i.paciente_id
           join clinica  c on c.id = i.clinica_id
          where i.token = $1`,
        [token],
      )
      const inv = rows[0]
      if (!inv) {
        return reply
          .code(404)
          .send({ error: 'enlace_invalido', message: 'Este enlace no es válido' })
      }

      // La caducidad se materializa al consultarla. El estado guardado
      // puede decir 'pendiente' mientras la fecha ya pasó: manda la fecha.
      if (inv.estado === 'pendiente' && inv.caducado) {
        await pool.query(
          `update invitacion_paciente set estado = 'expirada' where token = $1 and estado = 'pendiente'`,
          [token],
        )
        inv.estado = 'expirada'
      }

      if (inv.estado !== 'pendiente') {
        return reply.code(410).send({
          error: inv.estado === 'aceptada' ? 'ya_usado' : 'caducado',
          message:
            inv.estado === 'aceptada'
              ? 'Este enlace ya se usó. Entra directamente con tu cuenta.'
              : 'Este enlace ha caducado. Pídele a tu nutricionista que te envíe otro.',
        })
      }

      // No se devuelve el correo del paciente. Esta ruta es pública y la
      // pantalla no lo necesita: publicarlo solo añadiría un dato
      // personal más a un extremo sin autenticar.
      return reply.send({
        nombrePaciente: inv.nombre_paciente,
        nombreClinica: inv.clinica,
        expiraEn: inv.expira_en,
      })
    },
  )

  /* ---------------------------------------------------------------- */
  /* POST /api/invitacion/:token/vincular                              */
  /* ---------------------------------------------------------------- */
  app.post<{ Params: { token: string } }>(
    '/api/invitacion/:token/vincular',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const { sub } = request.authPac
      const { token } = request.params

      const cliente = await pool.connect()
      try {
        await cliente.query('begin')

        // `for update` sobre la invitación: dos pestañas abiertas con el
        // mismo enlace no pueden vincular dos veces.
        const { rows } = await cliente.query<{
          id: string
          paciente_id: string
          clinica_id: string
          estado: string
          caducado: boolean
        }>(
          `select id, paciente_id, clinica_id, estado::text as estado,
                  (expira_en < now()) as caducado
             from invitacion_paciente where token = $1 for update`,
          [token],
        )
        const inv = rows[0]

        if (!inv) {
          await cliente.query('rollback')
          return reply
            .code(404)
            .send({ error: 'enlace_invalido', message: 'Este enlace no es válido' })
        }
        if (inv.estado !== 'pendiente' || inv.caducado) {
          await cliente.query('rollback')
          return reply.code(410).send({
            error: 'caducado',
            message: 'Este enlace ya se usó o ha caducado. Pide uno nuevo.',
          })
        }

        // Si esta cuenta ya está vinculada a OTRO expediente, se para
        // aquí: el índice único lo impediría igual, pero con un error de
        // base que no explica nada.
        const { rows: yaVinculado } = await cliente.query<{ id: string }>(
          `select id from paciente where keycloak_user_id = $1`,
          [sub],
        )
        const otro = yaVinculado[0]
        if (otro && otro.id !== inv.paciente_id) {
          await cliente.query('rollback')
          return reply.code(409).send({
            error: 'cuenta_ya_vinculada',
            message: 'Esta cuenta ya está vinculada a otro expediente',
          })
        }

        await cliente.query(
          `update paciente set keycloak_user_id = $1, updated_at = now()
            where id = $2 and clinica_id = $3`,
          [sub, inv.paciente_id, inv.clinica_id],
        )
        await cliente.query(
          `update invitacion_paciente set estado = 'aceptada', usado_en = now() where id = $1`,
          [inv.id],
        )
        await cliente.query('commit')
      } catch (e) {
        await cliente.query('rollback')
        throw e
      } finally {
        cliente.release()
      }

      return reply.send({
        mensaje: 'Cuenta vinculada. Ya puedes entrar a tu espacio.',
      })
    },
  )
}
