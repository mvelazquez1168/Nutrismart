/**
 * Rutas de laboratorios — CLI-04.
 *
 * El sistema captura y presenta; no interpreta. Marcar un valor como
 * `alterado` es aritmética contra un rango declarado por la clínica,
 * no un diagnóstico. La interpretación de hallazgos es IA-01.
 */
import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth.js'
import { esUuid } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'
import { almacen } from '../almacen/index.js'
import { obtenerArchivo } from '../archivos/repositorio.js'
import { parsearCsv } from '../laboratorios/csv.js'
import {
  obtenerCatalogo,
  obtenerCatalogoSimple,
  listarEstudios,
  crearEstudio,
  PacienteNoVisibleError,
  SnapshotAjenoError,
} from '../laboratorios/repositorio.js'

interface ParamsId {
  id: string
}

interface QueryCatalogo {
  sexo?: string
}

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}

function noEncontradoPaciente() {
  return { error: 'paciente_no_encontrado', message: 'No se encontró el paciente' }
}

const SEXOS = ['masculino', 'femenino', 'intersexual']

export async function registerLaboratoriosRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* GET /api/biomarcadores                                            */
  /* ---------------------------------------------------------------- */
  app.get<{ Querystring: QueryCatalogo }>(
    '/api/biomarcadores',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      // Con `sexo` se devuelven los rangos que aplicarían a un paciente
      // así; sin él, los generales de la clínica.
      const sexo = request.query.sexo?.trim().toLowerCase()
      if (sexo && !SEXOS.includes(sexo)) {
        return reply
          .code(400)
          .send({ error: 'sexo_invalido', message: `sexo debe ser uno de: ${SEXOS.join(', ')}` })
      }

      return obtenerCatalogo(tenantId, sexo ?? null)
    },
  )

  /* ---------------------------------------------------------------- */
  /* POST /api/archivos/:id/previsualizar-csv                          */
  /* ---------------------------------------------------------------- */
  app.post<{ Params: ParamsId }>(
    '/api/archivos/:id/previsualizar-csv',
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

      if (meta.mime !== 'text/csv') {
        return reply.code(400).send({
          error: 'no_es_csv',
          message: 'Solo se pueden previsualizar archivos CSV. Un PDF se adjunta y se captura a mano.',
          mime: meta.mime,
        })
      }

      const contenido = await almacen.leer(meta.rutaRelativa)
      const catalogo = await obtenerCatalogoSimple()

      // NO persiste nada. Lo que el parser dedujo pasa por una pantalla
      // de revisión antes de convertirse en un dato clínico.
      return parsearCsv(contenido, catalogo)
    },
  )

  /* ---------------------------------------------------------------- */
  /* GET /api/pacientes/:id/laboratorios                               */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: ParamsId }>(
    '/api/pacientes/:id/laboratorios',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradoPaciente())

      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const estudios = await listarEstudios(tenantId, alcance.restringirA, id)
      if (estudios === null) return reply.code(404).send(noEncontradoPaciente())

      return estudios
    },
  )

  /* ---------------------------------------------------------------- */
  /* POST /api/pacientes/:id/laboratorios                              */
  /* ---------------------------------------------------------------- */
  app.post<{ Params: ParamsId }>(
    '/api/pacientes/:id/laboratorios',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradoPaciente())

      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const errores: { campo: string; mensaje: string }[] = []
      const b = (request.body ?? {}) as Record<string, unknown>

      // --- fecha de la muestra ---
      const fechaRaw = typeof b['fecha'] === 'string' ? b['fecha'].trim() : ''
      let fecha = ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaRaw)) {
        errores.push({ campo: 'fecha', mensaje: 'Indica la fecha de la muestra (AAAA-MM-DD)' })
      } else if (fechaRaw > new Date().toISOString().slice(0, 10)) {
        errores.push({ campo: 'fecha', mensaje: 'La fecha de la muestra no puede ser futura' })
      } else {
        fecha = fechaRaw
      }

      // --- resultados ---
      const catalogo = await obtenerCatalogoSimple()
      const codigosValidos = new Set(catalogo.map((c) => c.codigo))
      const resultados: { codigo: string; valor: number }[] = []
      const vistos = new Set<string>()

      const crudos = Array.isArray(b['resultados']) ? (b['resultados'] as unknown[]) : []
      for (const [i, bruto] of crudos.entries()) {
        if (typeof bruto !== 'object' || bruto === null) continue
        const fila = bruto as Record<string, unknown>
        const codigo = typeof fila['codigo'] === 'string' ? fila['codigo'].trim() : ''
        const valor = Number(fila['valor'])

        if (!codigosValidos.has(codigo)) {
          errores.push({ campo: `resultados.${i}.codigo`, mensaje: `Biomarcador desconocido: "${codigo}"` })
          continue
        }
        if (!Number.isFinite(valor)) {
          errores.push({ campo: `resultados.${i}.valor`, mensaje: 'El valor debe ser numérico' })
          continue
        }
        if (vistos.has(codigo)) {
          errores.push({ campo: `resultados.${i}.codigo`, mensaje: 'Biomarcador repetido' })
          continue
        }
        vistos.add(codigo)
        resultados.push({ codigo, valor })
      }

      const archivoId = typeof b['archivoId'] === 'string' ? b['archivoId'].trim() : null
      if (archivoId && !esUuid(archivoId)) {
        errores.push({ campo: 'archivoId', mensaje: 'archivoId inválido' })
      }

      const snapshotId = typeof b['snapshotId'] === 'string' ? b['snapshotId'].trim() : null
      if (snapshotId && !esUuid(snapshotId)) {
        errores.push({ campo: 'snapshotId', mensaje: 'snapshotId inválido' })
      }

      // Un estudio sin valores y sin adjunto no aporta nada: sería una
      // fila que dice que hubo un laboratorio, sin el laboratorio.
      if (resultados.length === 0 && !archivoId) {
        errores.push({
          campo: 'resultados',
          mensaje: 'Registra al menos un valor o adjunta el informe',
        })
      }

      if (errores.length > 0) {
        return reply.code(400).send({ error: 'validacion', errores })
      }

      // El adjunto debe existir y ser visible: enlazar el informe de
      // otra clínica sería una fuga por la puerta de atrás.
      if (archivoId) {
        const meta = await obtenerArchivo(tenantId, alcance.restringirA, archivoId)
        if (!meta) {
          return reply
            .code(400)
            .send({ error: 'archivo_no_encontrado', message: 'El adjunto no existe o no es tuyo' })
        }
      }

      const texto = (clave: string): string | null => {
        const v = b[clave]
        return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
      }

      try {
        const estudioId = await crearEstudio(tenantId, alcance.restringirA, id, alcance.profesionalId, {
          fecha,
          laboratorio: texto('laboratorio'),
          notas: texto('notas'),
          archivoId,
          snapshotId,
          resultados,
        })
        return reply.code(201).send({ id: estudioId, fecha, resultados: resultados.length })
      } catch (error) {
        if (error instanceof PacienteNoVisibleError) {
          return reply.code(404).send(noEncontradoPaciente())
        }
        if (error instanceof SnapshotAjenoError) {
          return reply.code(400).send({
            error: 'snapshot_ajeno',
            message: 'El punto de control indicado no pertenece a este paciente',
          })
        }
        throw error
      }
    },
  )
}
