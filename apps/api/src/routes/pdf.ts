/**
 * Exportación del expediente a PDF — CLI-05.
 *
 * El profesional elige qué secciones salen. Lo que no pide no se
 * consulta siquiera: si la sociodemografía no va en el documento,
 * tampoco tiene por qué salir de la base.
 *
 * Cada exportación deja traza en `pdf_export`. Un expediente que sale
 * de la clínica —hacia el paciente, otro profesional o una
 * aseguradora— tiene que poder reconstruirse: qué llevaba, con qué
 * recomendaciones y bajo la firma de quién.
 *
 * Visibilidad: misma doble acotación que el resto y **404** cuando el
 * paciente no es visible.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { esUuid } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'
import { cabeceraDescarga, nombreArchivoSeguro } from '../almacen/descarga.js'
import { recopilarDatos, SECCIONES_VALIDAS, type Seccion } from '../pdf/datos.js'
import { generar } from '../pdf/generar.js'

const MAX_NOTAS = 3000

function noEncontradoPaciente() {
  return { error: 'paciente_no_encontrado', message: 'No se encontró el paciente' }
}

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}

/** 'María Fernández' + hoy → 'Expediente_Maria_Fernandez_2026-08-14'. */
function nombreDocumento(paciente: string, extension: string): string {
  const base = paciente
    .normalize('NFD')
    // Se quitan los diacríticos del nombre del ARCHIVO, no del
    // contenido: un sistema de ficheros ajeno puede no manejarlos, y
    // el nombre solo tiene que ser reconocible.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const fecha = new Date().toISOString().slice(0, 10)
  return nombreArchivoSeguro(`Expediente_${base || 'paciente'}_${fecha}.${extension}`)
}

export async function registerPdfRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* POST /api/pacientes/:id/pdf                                       */
  /* ---------------------------------------------------------------- */
  app.post<{ Params: { id: string } }>(
    '/api/pacientes/:id/pdf',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradoPaciente())

      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const cuerpo = (request.body ?? {}) as { secciones?: unknown; notasProfesional?: unknown }

      // Una sección desconocida se descarta en vez de dar 400: el juego
      // va a crecer, y un cliente algo desactualizado debe seguir
      // exportando lo que sí entiende.
      const pedidas = Array.isArray(cuerpo.secciones) ? cuerpo.secciones : []
      const secciones = SECCIONES_VALIDAS.filter((s) => pedidas.includes(s))
      if (secciones.length === 0) {
        return reply.code(400).send({
          error: 'sin_secciones',
          message: `Indica al menos una sección: ${SECCIONES_VALIDAS.join(', ')}`,
        })
      }

      const notasCrudas =
        typeof cuerpo.notasProfesional === 'string' ? cuerpo.notasProfesional.trim() : ''
      if (notasCrudas.length > MAX_NOTAS) {
        return reply.code(400).send({
          error: 'validacion',
          message: `Las recomendaciones no pueden superar ${MAX_NOTAS} caracteres`,
          errores: [{ campo: 'notasProfesional', mensaje: `Máximo ${MAX_NOTAS} caracteres` }],
        })
      }

      const datos = await recopilarDatos({
        tenantId,
        restringirA: alcance.restringirA,
        pacienteId: id,
        profesionalId: alcance.profesionalId,
        secciones: secciones as Seccion[],
        notasProfesional: notasCrudas,
      })
      // null = el paciente no existe o no es visible para quien pide.
      if (!datos) return reply.code(404).send(noEncontradoPaciente())

      const resultado = await generar(datos, secciones as Seccion[])
      const nombre = nombreDocumento(datos.paciente.nombre, resultado.extension)

      // La traza se guarda ANTES de responder: si el registro falla,
      // preferimos no entregar el documento a entregarlo sin dejar
      // constancia de que salió.
      await pool.query(
        `insert into pdf_export
           (clinica_id, paciente_id, profesional_id, secciones,
            archivo_nombre, archivo_tamano, notas_profesional)
         values ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
        [
          tenantId,
          id,
          alcance.profesionalId,
          JSON.stringify(secciones),
          nombre,
          resultado.contenido.byteLength,
          notasCrudas === '' ? null : notasCrudas,
        ],
      )

      return reply
        .header('Content-Type', resultado.mime)
        .header('Content-Disposition', cabeceraDescarga(nombre))
        // El navegador no debe adivinar el tipo de algo que va a abrir.
        .header('X-Content-Type-Options', 'nosniff')
        // Documento clínico: fuera de cachés compartidas.
        .header('Cache-Control', 'private, no-store')
        // Le dice al cliente si recibió un PDF o el HTML de reserva, sin
        // tener que interpretar el Content-Type.
        .header('X-Formato-Exportacion', resultado.tipo)
        .send(resultado.contenido)
    },
  )

  /* ---------------------------------------------------------------- */
  /* GET /api/pacientes/:id/pdf/historial                              */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: { id: string } }>(
    '/api/pacientes/:id/pdf/historial',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradoPaciente())

      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      // La visibilidad se comprueba sobre el paciente, no sobre el
      // historial: si no puede verlo, tampoco puede saber cuántas veces
      // se exportó su expediente.
      const visible = await pool.query(
        `select 1 from paciente
          where id = $1 and clinica_id = $2
            and ($3::uuid is null or nutricionista_id = $3)`,
        [id, tenantId, alcance.restringirA],
      )
      if (visible.rowCount === 0) return reply.code(404).send(noEncontradoPaciente())

      const { rows } = await pool.query(
        `select e.id, e.secciones, e.archivo_nombre, e.archivo_tamano,
                e.enviado_paciente, e.enviado_en, e.notas_profesional, e.created_at,
                p.nombre as profesional
           from pdf_export e
           join profesional p on p.id = e.profesional_id
          where e.clinica_id = $1 and e.paciente_id = $2
          order by e.created_at desc
          limit 20`,
        [tenantId, id],
      )

      return reply.send(
        rows.map((r) => ({
          id: r['id'],
          secciones: r['secciones'],
          archivoNombre: r['archivo_nombre'],
          archivoTamano: r['archivo_tamano'],
          enviadoPaciente: r['enviado_paciente'],
          enviadoEn: r['enviado_en'],
          notasProfesional: r['notas_profesional'],
          profesional: r['profesional'],
          createdAt: r['created_at'],
        })),
      )
    },
  )
}
