/**
 * IA clinica — IA-01 (interpretacion de laboratorios) e IA-02 (SOAP).
 *
 * Toda salida de estas rutas es una SUGERENCIA. Se guarda marcada como
 * generada por IA, es editable, y la interfaz la rotula. La regla del
 * proyecto: la IA asiste, el profesional decide.
 *
 * Cuando la IA no esta disponible —sin clave, sin red, con el limite
 * agotado— estas rutas responden 503 y NADA MAS deja de funcionar. El
 * expediente, la agenda y los informes no dependen de este modulo.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { esUuid } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'
import { pacienteVisible } from './consultas.js'
import { listarEstudios } from '../laboratorios/repositorio.js'
import { IaNoDisponibleError, llamarClaude } from '../ia/cliente.js'
import {
  partirSOAP,
  promptGenerarSOAP,
  promptInterpretacionLabs,
  type Marcador,
} from '../ia/prompts.js'

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}
const NO_ENCONTRADO = { error: 'no_encontrado', message: 'No se encontró el recurso' }

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t.slice(0, max)
}

/** Traduce el fallo del cliente a la respuesta del contrato. */
function respuesta503(e: IaNoDisponibleError) {
  return {
    error: 'ia_no_disponible',
    message: 'El servicio de IA no está disponible ahora mismo. Vuelve a intentarlo.',
    // El tipo sirve para que la interfaz distinga "falta configurar" de
    // "se agoto el limite" sin exponer detalles del proveedor.
    tipo: e.tipo,
  }
}

interface FilaPaciente {
  paciente_id: string
  nombre: string
  edad: number | null
  sexo: string | null
  motivo: string | null
}

async function datosPaciente(
  pacienteId: string,
  tenantId: string,
): Promise<FilaPaciente | undefined> {
  const { rows } = await pool.query<FilaPaciente>(
    `select id as paciente_id, nombre,
            case when fecha_nacimiento is null then null
                 else extract(year from age(fecha_nacimiento))::int end as edad,
            sexo_biologico::text as sexo,
            motivo_consulta as motivo
       from paciente where id = $1 and clinica_id = $2`,
    [pacienteId, tenantId],
  )
  return rows[0]
}

export async function registerIaRoutes(app: FastifyInstance): Promise<void> {
  /* ================================================================ */
  /* IA-01 · Interpretacion de laboratorios                            */
  /* ================================================================ */

  /**
   * Resuelve el estudio y comprueba que el profesional puede verlo.
   * Devuelve null cuando no existe, no es de esta clinica o el paciente
   * queda fuera de su alcance: los tres casos se responden igual, porque
   * distinguirlos revelaria la existencia de estudios ajenos.
   */
  async function estudioVisible(
    estudioId: string,
    tenantId: string,
    restringirA: string | null,
  ): Promise<{ pacienteId: string; fecha: string } | null> {
    if (!esUuid(estudioId)) return null
    const { rows } = await pool.query<{ paciente_id: string; fecha: string }>(
      `select paciente_id, to_char(fecha,'YYYY-MM-DD') as fecha
         from lab_estudio
        where id = $1 and clinica_id = $2 and estado = 'vigente'`,
      [estudioId, tenantId],
    )
    const fila = rows[0]
    if (!fila) return null
    if (!(await pacienteVisible(fila.paciente_id, tenantId, restringirA))) return null
    return { pacienteId: fila.paciente_id, fecha: fila.fecha }
  }

  app.post<{ Params: { estudioId: string } }>(
    '/api/labs/:estudioId/interpretar',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { estudioId } = request.params
      const est = await estudioVisible(estudioId, tenantId, alcance.restringirA)
      if (!est) return reply.code(404).send(NO_ENCONTRADO)

      const pac = await datosPaciente(est.pacienteId, tenantId)
      if (!pac) return reply.code(404).send(NO_ENCONTRADO)

      // Se reutiliza la lectura de la Rebanada 5 en vez de rehacer la
      // resolucion de rangos: el rango por sexo gana sobre el general y
      // duplicar esa regla aqui la dejaria desincronizada.
      const estudios = await listarEstudios(tenantId, alcance.restringirA, est.pacienteId)
      const estudio = estudios?.find((e) => e.id === estudioId)
      if (!estudio) return reply.code(404).send(NO_ENCONTRADO)

      if (estudio.resultados.length === 0) {
        return reply.code(400).send({
          error: 'estudio_sin_resultados',
          message: 'Este estudio no tiene resultados que interpretar',
        })
      }

      const marcadores: Marcador[] = estudio.resultados.map((r) => ({
        nombre: r.nombre,
        valor: r.valor,
        unidad: r.unidad,
        minimo: r.rango?.minimo ?? null,
        maximo: r.rango?.maximo ?? null,
        estado: r.estado,
        anterior: r.anterior,
      }))

      const prompt = promptInterpretacionLabs({
        pacienteNombre: pac.nombre.trim(),
        pacienteEdad: pac.edad,
        pacienteSexo: pac.sexo,
        fechaEstudio: estudio.fecha,
        marcadores,
      })

      try {
        const salida = await llamarClaude(prompt, {
          clinicaId: tenantId,
          profesionalId: alcance.profesionalId,
          funcion: 'interpretacion_labs',
        })

        const { rows } = await pool.query(
          `insert into interpretacion_ia
             (clinica_id, estudio_id, paciente_id, profesional_id, modelo,
              prompt_usado, interpretacion, tokens_entrada, tokens_salida)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           returning id, to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at`,
          [
            tenantId,
            estudioId,
            est.pacienteId,
            alcance.profesionalId,
            salida.modelo,
            salida.promptUsado,
            salida.texto,
            salida.tokensEntrada,
            salida.tokensSalida,
          ],
        )

        return reply.code(201).send({
          id: rows[0]!['id'],
          interpretacion: salida.texto,
          modelo: salida.modelo,
          tokensEntrada: salida.tokensEntrada,
          tokensSalida: salida.tokensSalida,
          revisada: false,
          createdAt: rows[0]!['created_at'],
        })
      } catch (e) {
        if (e instanceof IaNoDisponibleError) return reply.code(503).send(respuesta503(e))
        throw e
      }
    },
  )

  app.get<{ Params: { estudioId: string } }>(
    '/api/labs/:estudioId/interpretacion',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { estudioId } = request.params
      if (!(await estudioVisible(estudioId, tenantId, alcance.restringirA))) {
        return reply.code(404).send(NO_ENCONTRADO)
      }

      const { rows } = await pool.query(
        `select i.id, i.interpretacion, i.modelo, i.tokens_entrada, i.tokens_salida,
                i.revisada,
                to_char(i.revisada_en,'YYYY-MM-DD"T"HH24:MI:SSOF') as revisada_en,
                rev.nombre as revisada_por,
                to_char(i.created_at,'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at,
                autor.nombre as profesional
           from interpretacion_ia i
           left join profesional autor on autor.id = i.profesional_id
           left join profesional rev   on rev.id   = i.revisada_por
          where i.estudio_id = $1 and i.clinica_id = $2
          order by i.created_at desc
          limit 1`,
        [estudioId, tenantId],
      )

      const f = rows[0]
      if (!f) {
        return reply
          .code(404)
          .send({ error: 'sin_interpretacion', message: 'Este estudio aún no se ha interpretado' })
      }

      return reply.send({
        id: f['id'],
        interpretacion: f['interpretacion'],
        modelo: f['modelo'],
        tokensEntrada: num(f['tokens_entrada']),
        tokensSalida: num(f['tokens_salida']),
        revisada: f['revisada'],
        revisadaEn: f['revisada_en'],
        revisadaPor: f['revisada_por'],
        profesional: f['profesional'],
        createdAt: f['created_at'],
      })
    },
  )

  app.put<{ Params: { estudioId: string; intId: string } }>(
    '/api/labs/:estudioId/interpretacion/:intId/revisar',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { estudioId, intId } = request.params
      if (!esUuid(intId)) return reply.code(404).send(NO_ENCONTRADO)
      if (!(await estudioVisible(estudioId, tenantId, alcance.restringirA))) {
        return reply.code(404).send(NO_ENCONTRADO)
      }

      // Revisar es idempotente pero NO se re-firma: se conserva quien la
      // avalo primero. Marcarla de nuevo borraria esa firma.
      const { rows } = await pool.query(
        `update interpretacion_ia
            set revisada = true,
                revisada_en = coalesce(revisada_en, now()),
                revisada_por = coalesce(revisada_por, $3)
          where id = $1 and clinica_id = $2 and estudio_id = $4
          returning revisada, to_char(revisada_en,'YYYY-MM-DD"T"HH24:MI:SSOF') as revisada_en`,
        [intId, tenantId, alcance.profesionalId, estudioId],
      )
      if (!rows[0]) return reply.code(404).send(NO_ENCONTRADO)

      return reply.send({ revisada: true, revisadaEn: rows[0]['revisada_en'] })
    },
  )

  /* ================================================================ */
  /* IA-02 · Notas SOAP                                                */
  /* ================================================================ */

  app.post<{
    Params: { id: string }
    Body: { motivoConsulta?: unknown; observacionesProfesional?: unknown; consultaId?: unknown }
  }>('/api/pacientes/:id/soap/generar', { preHandler: requireAuth }, async (request, reply) => {
    const { tenantId, sub, roles } = request.auth
    const alcance = await resolverAlcance(tenantId, sub, roles)
    if (!alcance) return reply.code(403).send(sinProfesional())

    const { id } = request.params
    if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
      return reply.code(404).send(NO_ENCONTRADO)
    }
    const pac = await datosPaciente(id, tenantId)
    if (!pac) return reply.code(404).send(NO_ENCONTRADO)

    const cuerpo = request.body ?? {}

    // Se reune lo que haya. Cada bloque es opcional: una consulta con
    // solo el peso registrado tambien merece un borrador.
    const [antrop, labs, hist, diet, plan] = await Promise.all([
      pool.query(
        `select peso_kg, talla_cm, imc, pct_grasa, masa_libre_grasa_kg, angulo_fase
           from medicion_antropometrica
          where paciente_id = $1 and clinica_id = $2
          order by fecha_medicion desc, created_at desc limit 1`,
        [id, tenantId],
      ),
      pool.query(
        `select b.nombre, r.valor, b.unidad
           from lab_resultado r
           join lab_estudio e on e.id = r.estudio_id
           join biomarcador b on b.codigo = r.biomarcador_codigo
          where e.paciente_id = $1 and e.clinica_id = $2 and e.estado = 'vigente'
            and e.fecha >= current_date - interval '90 days'
          order by e.fecha desc limit 20`,
        [id, tenantId],
      ),
      pool.query(
        `select tipo_actividad, sesiones_semana, fuma, alcohol, apf, app
           from historial_clinico where paciente_id = $1 and clinica_id = $2`,
        [id, tenantId],
      ),
      pool.query(
        `select kcal_estimadas, proteina_g, cho_g, grasa_g, hidratacion_litros
           from evaluacion_dietetica where paciente_id = $1 and clinica_id = $2`,
        [id, tenantId],
      ),
      pool.query(
        `select nombre, objetivo from plan_alimentario
          where paciente_id = $1 and clinica_id = $2 and estado = 'activo' limit 1`,
        [id, tenantId],
      ),
    ])

    const a = antrop.rows[0]
    const h = hist.rows[0]
    const d = diet.rows[0]
    const p = plan.rows[0]

    const composicion = a
      ? [
          a['pct_grasa'] !== null ? `grasa ${a['pct_grasa']} %` : null,
          a['masa_libre_grasa_kg'] !== null ? `masa libre de grasa ${a['masa_libre_grasa_kg']} kg` : null,
          a['angulo_fase'] !== null ? `ángulo de fase ${a['angulo_fase']}°` : null,
        ]
          .filter(Boolean)
          .join(', ')
      : ''

    const prompt = promptGenerarSOAP({
      pacienteNombre: pac.nombre.trim(),
      pacienteEdad: pac.edad,
      pacienteSexo: pac.sexo,
      motivoConsulta: texto(cuerpo.motivoConsulta, 500) ?? pac.motivo,
      pesoKg: num(a?.['peso_kg']),
      tallaCm: num(a?.['talla_cm']),
      imc: num(a?.['imc']),
      composicionCorporal: composicion || null,
      laboratoriosRelevantes:
        labs.rows.length > 0
          ? labs.rows.map((r) => `${r['nombre']} ${r['valor']} ${r['unidad']}`).join('; ')
          : null,
      historialClinico: h
        ? [
            h['tipo_actividad'] ? `actividad ${h['tipo_actividad']}` : null,
            h['fuma'] === true ? 'fuma' : null,
            h['alcohol'] === true ? 'consume alcohol' : null,
            Array.isArray(h['app']) && h['app'].length > 0
              ? `antecedentes personales: ${(h['app'] as { condicion: string }[])
                  .map((x) => x.condicion)
                  .join(', ')}`
              : null,
          ]
            .filter(Boolean)
            .join('; ') || null
        : null,
      consumoDietetico: d
        ? `ingesta estimada ${d['kcal_estimadas'] ?? '—'} kcal, proteína ${d['proteina_g'] ?? '—'} g`
        : null,
      planPrescrito: p ? `${p['nombre']}${p['objetivo'] ? ` — ${p['objetivo']}` : ''}` : null,
      observacionesProfesional: texto(cuerpo.observacionesProfesional, 1000),
    })

    try {
      const salida = await llamarClaude(prompt, {
        clinicaId: tenantId,
        profesionalId: alcance.profesionalId,
        funcion: 'nota_soap',
      })

      // El borrador NO se guarda. Una nota SOAP en el expediente la firma
      // una persona; guardar automaticamente lo que dijo el modelo la
      // convertiria en historia clinica sin que nadie la haya leido.
      return reply.send({
        borrador: partirSOAP(salida.texto),
        textoCompleto: salida.texto,
        modelo: salida.modelo,
        tokensSalida: salida.tokensSalida,
      })
    } catch (e) {
      if (e instanceof IaNoDisponibleError) return reply.code(503).send(respuesta503(e))
      throw e
    }
  })

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/pacientes/:id/soap',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send(NO_ENCONTRADO)
      }

      const b = request.body ?? {}
      const s = texto(b['subjetivo'], 8000)
      const o = texto(b['objetivo'], 8000)
      const an = texto(b['analisis'], 8000)
      const pl = texto(b['planSoap'], 8000)

      if (s === null && o === null && an === null && pl === null) {
        return reply.code(400).send({
          error: 'validacion',
          message: 'La nota necesita al menos una de las cuatro secciones',
        })
      }

      const consultaId = typeof b['consultaId'] === 'string' && esUuid(b['consultaId'])
        ? b['consultaId']
        : null

      const { rows } = await pool.query(
        `insert into nota_soap
           (clinica_id, paciente_id, profesional_id, consulta_id,
            subjetivo, objetivo, analisis, plan_soap, generada_ia)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         returning id, to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at`,
        [
          tenantId,
          id,
          alcance.profesionalId,
          consultaId,
          s,
          o,
          an,
          pl,
          b['generadaIa'] === true,
        ],
      )

      return reply.code(201).send({
        id: rows[0]!['id'],
        subjetivo: s,
        objetivo: o,
        analisis: an,
        planSoap: pl,
        generadaIa: b['generadaIa'] === true,
        revisada: false,
        createdAt: rows[0]!['created_at'],
      })
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/pacientes/:id/soap',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send(NO_ENCONTRADO)
      }

      const { rows } = await pool.query(
        `select n.id, left(coalesce(n.subjetivo, n.analisis, n.objetivo, n.plan_soap, ''), 120) as extracto,
                n.generada_ia, n.revisada, prof.nombre as profesional,
                to_char(n.created_at,'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at
           from nota_soap n
           left join profesional prof on prof.id = n.profesional_id
          where n.paciente_id = $1 and n.clinica_id = $2
          order by n.created_at desc
          limit 20`,
        [id, tenantId],
      )

      return reply.send(
        rows.map((f) => ({
          id: f['id'],
          extracto: f['extracto'],
          generadaIa: f['generada_ia'],
          revisada: f['revisada'],
          profesional: f['profesional'],
          createdAt: f['created_at'],
        })),
      )
    },
  )

  app.get<{ Params: { id: string; soapId: string } }>(
    '/api/pacientes/:id/soap/:soapId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id, soapId } = request.params
      if (!esUuid(soapId)) return reply.code(404).send(NO_ENCONTRADO)
      if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send(NO_ENCONTRADO)
      }

      const { rows } = await pool.query(
        `select n.id, n.subjetivo, n.objetivo, n.analisis, n.plan_soap,
                n.generada_ia, n.revisada, n.profesional_id,
                prof.nombre as profesional,
                to_char(n.revisada_en,'YYYY-MM-DD"T"HH24:MI:SSOF') as revisada_en,
                to_char(n.created_at,'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at
           from nota_soap n
           left join profesional prof on prof.id = n.profesional_id
          where n.id = $1 and n.paciente_id = $2 and n.clinica_id = $3`,
        [soapId, id, tenantId],
      )
      const f = rows[0]
      if (!f) return reply.code(404).send(NO_ENCONTRADO)

      return reply.send({
        id: f['id'],
        subjetivo: f['subjetivo'],
        objetivo: f['objetivo'],
        analisis: f['analisis'],
        planSoap: f['plan_soap'],
        generadaIa: f['generada_ia'],
        revisada: f['revisada'],
        revisadaEn: f['revisada_en'],
        profesional: f['profesional'],
        // Permite a la interfaz ocultar el boton de editar sin tener que
        // provocar un 403 para descubrirlo.
        esAutor: f['profesional_id'] === alcance.profesionalId,
        createdAt: f['created_at'],
      })
    },
  )

  app.put<{ Params: { id: string; soapId: string }; Body: Record<string, unknown> }>(
    '/api/pacientes/:id/soap/:soapId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id, soapId } = request.params
      if (!esUuid(soapId)) return reply.code(404).send(NO_ENCONTRADO)
      if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send(NO_ENCONTRADO)
      }

      const b = request.body ?? {}
      const trae = (k: string) => Object.prototype.hasOwnProperty.call(b, k)

      // Aqui SI se exige autoria, al reves que en la conclusion de la
      // Rebanada 15. Una nota SOAP es un texto firmado por una persona
      // concreta; que un companero la reescriba dejaria la firma de uno
      // sobre las palabras de otro. Para aportar su lectura, escribe la
      // suya.
      const { rows } = await pool.query(
        `update nota_soap
            set subjetivo = case when $4 then $5 else subjetivo end,
                objetivo  = case when $6 then $7 else objetivo end,
                analisis  = case when $8 then $9 else analisis end,
                plan_soap = case when $10 then $11 else plan_soap end
          where id = $1 and clinica_id = $2 and paciente_id = $12
            and profesional_id = $3
          returning id, subjetivo, objetivo, analisis, plan_soap, revisada`,
        [
          soapId,
          tenantId,
          alcance.profesionalId,
          trae('subjetivo'),
          texto(b['subjetivo'], 8000),
          trae('objetivo'),
          texto(b['objetivo'], 8000),
          trae('analisis'),
          texto(b['analisis'], 8000),
          trae('planSoap'),
          texto(b['planSoap'], 8000),
          id,
        ],
      )

      if (!rows[0]) {
        // Existe pero es de otro: 404 igual que si no existiera. El
        // profesional ya sabe que la nota existe —la esta viendo—, asi
        // que aqui el mensaje si puede explicar el motivo.
        const ajena = await pool.query(
          `select 1 from nota_soap where id = $1 and clinica_id = $2 and paciente_id = $3`,
          [soapId, tenantId, id],
        )
        if (ajena.rows[0]) {
          return reply.code(403).send({
            error: 'nota_ajena',
            message: 'Solo quien escribió la nota puede editarla',
          })
        }
        return reply.code(404).send(NO_ENCONTRADO)
      }

      const f = rows[0]
      return reply.send({
        id: f['id'],
        subjetivo: f['subjetivo'],
        objetivo: f['objetivo'],
        analisis: f['analisis'],
        planSoap: f['plan_soap'],
        revisada: f['revisada'],
      })
    },
  )

  app.put<{ Params: { id: string; soapId: string } }>(
    '/api/pacientes/:id/soap/:soapId/revisar',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id, soapId } = request.params
      if (!esUuid(soapId)) return reply.code(404).send(NO_ENCONTRADO)
      if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send(NO_ENCONTRADO)
      }

      const { rows } = await pool.query(
        `update nota_soap
            set revisada = true,
                revisada_en = coalesce(revisada_en, now()),
                revisada_por = coalesce(revisada_por, $3)
          where id = $1 and clinica_id = $2 and paciente_id = $4
          returning to_char(revisada_en,'YYYY-MM-DD"T"HH24:MI:SSOF') as revisada_en`,
        [soapId, tenantId, alcance.profesionalId, id],
      )
      if (!rows[0]) return reply.code(404).send(NO_ENCONTRADO)

      return reply.send({ revisada: true, revisadaEn: rows[0]['revisada_en'] })
    },
  )
}
