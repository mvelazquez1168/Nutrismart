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
import { leerPdfDeLaboratorio } from '../laboratorios/pdf.js'
import { llamarClaude } from '../ia/cliente.js'
import {
  obtenerCatalogo,
  obtenerCatalogoSimple,
  obtenerCatalogoVisible,
  serieAnalitica,
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
          message:
            'Esta previsualización solo acepta CSV. Un PDF se lee por `previsualizar-pdf`; una imagen se captura a mano.',
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
  /* POST /api/archivos/:id/previsualizar-pdf                          */
  /* ---------------------------------------------------------------- */
  /**
   * Lee el PDF del informe con IA — R43.
   *
   * Hermano de `previsualizar-csv`: misma forma de respuesta, misma regla de
   * que NO persiste nada y que lo devuelto pasa por la pantalla de revisión.
   * Lo que cambia es de dónde salen las filas —un modelo leyendo texto, no un
   * parser leyendo columnas—, y por eso la respuesta llega siempre con sus
   * avisos: aquí el profesional tiene más que revisar, no menos.
   *
   * **Un fallo de lectura no es un error de la petición.** El informe ya está
   * adjunto y la captura manual sigue disponible; responder 503 dejaría al
   * modal sin saber si continuar. Los fallos viajan como avisos (ver
   * `laboratorios/pdf.ts`).
   */
  app.post<{ Params: ParamsId }>(
    '/api/archivos/:id/previsualizar-pdf',
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

      if (meta.mime !== 'application/pdf') {
        return reply.code(400).send({
          error: 'no_es_pdf',
          message: 'Esta lectura solo acepta archivos PDF.',
          mime: meta.mime,
        })
      }

      const contenido = await almacen.leer(meta.rutaRelativa)
      const catalogo = await obtenerCatalogoSimple()

      return leerPdfDeLaboratorio(
        contenido,
        catalogo,
        async (prompt) =>
          (
            await llamarClaude(prompt, {
              clinicaId: tenantId,
              profesionalId: alcance.profesionalId,
              funcion: 'lectura_pdf_lab',
            })
          ).texto,
        request.log,
      )
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
  /* GET /api/pacientes/:id/analitica — R49                            */
  /* ---------------------------------------------------------------- */
  /**
   * La serie historica de cada analito catalogado del paciente.
   *
   * Aparte del listado de estudios, no derivado de el: aquel esta organizado
   * por ESTUDIO —lo que trajo cada informe— y este por ANALITO —como ha ido
   * evolucionando cada uno—. Son las dos preguntas de una consulta de
   * seguimiento y ninguna de las dos se contesta bien con la forma de la otra.
   */
  app.get<{ Params: ParamsId }>(
    '/api/pacientes/:id/analitica',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradoPaciente())

      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const series = await serieAnalitica(tenantId, alcance.restringirA, id)
      if (series === null) return reply.code(404).send(noEncontradoPaciente())

      return series
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

      /* --- resultados --- R49: catalogado, cualitativo o libre --- */
      const catalogo = await obtenerCatalogoVisible(tenantId)
      const resultados: {
        codigo: string | null
        nombreLibre: string | null
        valor: number | null
        valorTexto: string | null
        refMinimo: number | null
        refMaximo: number | null
      }[] = []
      const vistos = new Set<string>()
      /*
       * Los nombres libres se comparan NORMALIZADOS — sin mayusculas ni
       * espacios de sobra. El indice unico de la base solo cubre los
       * catalogados (ver migracion 053), asi que «IgG» e «  igg » entrarian
       * las dos y el estudio tendria el mismo analito repetido.
       */
      const libresVistos = new Set<string>()

      const crudos = Array.isArray(b['resultados']) ? (b['resultados'] as unknown[]) : []
      for (const [i, bruto] of crudos.entries()) {
        if (typeof bruto !== 'object' || bruto === null) continue
        const fila = bruto as Record<string, unknown>
        const codigo = typeof fila['codigo'] === 'string' ? fila['codigo'].trim() : ''
        const nombreLibre =
          typeof fila['nombre_libre'] === 'string' ? fila['nombre_libre'].trim() : ''
        const valorTexto =
          typeof fila['valor_texto'] === 'string' ? fila['valor_texto'].trim() : ''
        const valor = Number(fila['valor'])
        const hayValor = Number.isFinite(valor)

        if (codigo === '' && nombreLibre === '') {
          errores.push({
            campo: `resultados.${i}`,
            mensaje: 'Indica el código del analito o un nombre libre',
          })
          continue
        }

        /* ---- Analito SIN catalogar: se guarda tal cual lo escribieron ---- */
        if (codigo === '') {
          if (!hayValor && valorTexto === '') {
            errores.push({
              campo: `resultados.${i}.valor`,
              mensaje: `Indica un valor para "${nombreLibre}"`,
            })
            continue
          }
          const clave = nombreLibre.toLowerCase().replace(/\s+/g, ' ')
          if (libresVistos.has(clave)) {
            errores.push({
              campo: `resultados.${i}.nombre_libre`,
              mensaje: `"${nombreLibre}" aparece dos veces`,
            })
            continue
          }
          libresVistos.add(clave)
          /*
           * **Sin rango de referencia.** Un analito que no esta en ningun
           * catalogo no tiene con que compararse, y aceptar un min/max suelto
           * dejaria un intervalo que nadie puede auditar. El valor numerico si
           * se guarda cuando lo es: sirve para verlo en el estudio.
           */
          resultados.push({
            codigo: null,
            nombreLibre,
            valor: hayValor ? valor : null,
            valorTexto: valorTexto === '' ? null : valorTexto,
            refMinimo: null,
            refMaximo: null,
          })
          continue
        }

        /* ---- Analito del catalogo ---- */
        const meta = catalogo.get(codigo)
        if (!meta) {
          errores.push({ campo: `resultados.${i}.codigo`, mensaje: `Biomarcador desconocido: "${codigo}"` })
          continue
        }
        if (vistos.has(codigo)) {
          errores.push({ campo: `resultados.${i}.codigo`, mensaje: 'Biomarcador repetido' })
          continue
        }

        /*
         * **Un cualitativo guarda texto, y solo texto.**
         *
         * Un VIH «No Reactiva» convertido a numero es una afirmacion clinica
         * falsa, asi que el `valor` que llegue se ignora a proposito — y las
         * referencias tambien: no hay intervalo que comparar contra un texto.
         */
        if (meta.es_cualitativo) {
          if (valorTexto === '') {
            errores.push({
              campo: `resultados.${i}.valor_texto`,
              mensaje: `"${codigo}" es un resultado cualitativo: indica el texto (ej. "No Reactiva")`,
            })
            continue
          }
          vistos.add(codigo)
          resultados.push({
            codigo,
            nombreLibre: null,
            valor: null,
            valorTexto,
            refMinimo: null,
            refMaximo: null,
          })
          continue
        }

        if (!hayValor) {
          errores.push({ campo: `resultados.${i}.valor`, mensaje: 'El valor debe ser numérico' })
          continue
        }
        /*
         * Las referencias que venian en el informe — R44.
         *
         * Opcionales y saneadas aparte del valor: un rango ilegible NO
         * invalida la medicion, solo deja el resultado sin referencia propia
         * —y entonces manda el catalogo de la clinica—. Rechazar el estudio
         * entero por un rango mal leido perderia el valor, que es el dato.
         *
         * Un rango invertido se descarta COMPLETO, no a medias: medio rango
         * del informe y medio del catalogo no es el criterio de nadie.
         */
        const refMinimo =
          typeof fila['refMinimo'] === 'number' && Number.isFinite(fila['refMinimo'])
            ? (fila['refMinimo'] as number)
            : null
        const refMaximo =
          typeof fila['refMaximo'] === 'number' && Number.isFinite(fila['refMaximo'])
            ? (fila['refMaximo'] as number)
            : null
        const invertido = refMinimo !== null && refMaximo !== null && refMinimo > refMaximo

        vistos.add(codigo)
        resultados.push({
          codigo,
          nombreLibre: null,
          valor,
          valorTexto: null,
          refMinimo: invertido ? null : refMinimo,
          refMaximo: invertido ? null : refMaximo,
        })
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
