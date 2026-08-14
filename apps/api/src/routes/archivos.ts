/**
 * Subida y descarga de archivos clínicos.
 *
 * Es la mayor superficie de ataque de la API: recibe bytes arbitrarios
 * de un cliente y luego se los devuelve a un navegador. Las tres reglas
 * que lo sostienen:
 *
 *  1. El tipo lo decide el CONTENIDO, nunca la extensión ni la cabecera.
 *  2. El nombre original jamás toca el disco.
 *  3. Todo se devuelve como descarga, nunca para que el navegador lo
 *     interprete.
 */
import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth.js'
import { esUuid } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'
import { almacen, detectarTipo, TAMANO_MAXIMO_BYTES } from '../almacen/index.js'
import { cabeceraDescarga } from '../almacen/descarga.js'
import { registrarArchivo, obtenerArchivo } from '../archivos/repositorio.js'

interface ParamsId {
  id: string
}

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}

/** Recorta un nombre desmedido conservando algo legible. */
function nombreSeguro(nombre: string | undefined): string {
  const limpio = (nombre ?? 'archivo').replace(/[\r\n\t]/g, ' ').trim()
  return limpio.slice(0, 200) || 'archivo'
}

export async function registerArchivosRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* POST /api/archivos                                                */
  /* ---------------------------------------------------------------- */
  app.post('/api/archivos', { preHandler: requireAuth }, async (request, reply) => {
    const { tenantId, sub, roles } = request.auth
    const alcance = await resolverAlcance(tenantId, sub, roles)
    if (!alcance) return reply.code(403).send(sinProfesional())

    if (!request.isMultipart()) {
      return reply.code(415).send({
        error: 'no_multipart',
        message: 'La subida debe enviarse como multipart/form-data',
      })
    }

    const parte = await request.file()
    if (!parte) {
      return reply.code(400).send({ error: 'sin_archivo', message: 'No se recibió ningún archivo' })
    }

    let contenido: Buffer
    try {
      contenido = await parte.toBuffer()
    } catch (error) {
      // @fastify/multipart aborta la lectura al superar el límite, en
      // lugar de leer 2 GB en memoria para luego rechazarlos.
      if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({
          error: 'archivo_demasiado_grande',
          message: `El archivo supera el máximo de ${TAMANO_MAXIMO_BYTES / 1024 / 1024} MB`,
        })
      }
      throw error
    }

    // El tipo real, contra el que dice el cliente. Si no está en la
    // lista blanca, no se guarda nada.
    const mime = detectarTipo(contenido, parte.mimetype)
    if (!mime) {
      return reply.code(415).send({
        error: 'tipo_no_permitido',
        message:
          'Solo se admiten PDF, CSV, PNG y JPEG. El contenido del archivo no corresponde a ninguno.',
        declarado: parte.mimetype,
      })
    }

    const guardado = await almacen.guardar(tenantId, contenido, mime)

    try {
      const meta = await registrarArchivo(tenantId, alcance.profesionalId, {
        nombreOriginal: nombreSeguro(parte.filename),
        mime: guardado.mime,
        tamanoBytes: guardado.tamanoBytes,
        sha256: guardado.sha256,
        rutaRelativa: guardado.rutaRelativa,
      })

      return reply.code(201).send({
        id: meta.id,
        nombreOriginal: meta.nombreOriginal,
        mime: meta.mime,
        tamanoBytes: meta.tamanoBytes,
        sha256: meta.sha256,
      })
    } catch (error) {
      // El binario ya está en disco pero la fila no entró: sin esto
      // quedaría un archivo huérfano que nadie sabe borrar.
      await almacen.eliminar(guardado.rutaRelativa)
      throw error
    }
  })

  /* ---------------------------------------------------------------- */
  /* GET /api/archivos/:id                                             */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: ParamsId }>(
    '/api/archivos/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const { id } = request.params

      const noEncontrado = { error: 'archivo_no_encontrado', message: 'No se encontró el archivo' }
      if (!esUuid(id)) return reply.code(404).send(noEncontrado)

      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const meta = await obtenerArchivo(tenantId, alcance.restringirA, id)
      if (!meta) return reply.code(404).send(noEncontrado)

      const contenido = await almacen.leer(meta.rutaRelativa)

      return reply
        .header('Content-Type', meta.mime)
        // Descarga, nunca interpretación: un HTML servido desde nuestro
        // origen sería XSS con la sesión del profesional ya abierta.
        .header('Content-Disposition', cabeceraDescarga(meta.nombreOriginal))
        // Sin esto, algunos navegadores adivinan el tipo e ignoran el
        // que enviamos, deshaciendo la protección anterior.
        .header('X-Content-Type-Options', 'nosniff')
        // Documento clínico: fuera de cachés compartidas.
        .header('Cache-Control', 'private, no-store')
        .send(contenido)
    },
  )
}
