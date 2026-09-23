/**
 * Plan alimentario — CLI-09 / R38.
 *
 * Un plan es un PATRÓN DIARIO: seis tiempos de comida fijos, cada uno con
 * un «patrón» (qué grupos de alimentos lo componen) y un «ejemplo de
 * menú» concreto. No hay dimensión semanal ni macros por comida.
 *
 * Ciclo de vida: `borrador` → `activo` → `archivado`. Solo puede haber
 * UN plan activo por paciente, y lo garantiza un índice parcial en la
 * base, no una comprobación de la API: dos peticiones concurrentes
 * pasarían las dos por cualquier `select` previo.
 *
 * Nada se borra. "Eliminar" un borrador lo archiva, igual que la baja
 * de un paciente.
 *
 * Visibilidad: doble acotación —clínica del token y alcance del
 * solicitante— y **404** cuando el plan o su paciente no son visibles.
 * Nunca 403: distinguir "no existe" de "existe pero no es tuyo"
 * confirmaría la existencia de pacientes ajenos.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { esUuid, type ErrorCampo } from '../pacientes/validacion.js'
import { resolverAlcance, type Alcance } from '../pacientes/acceso.js'

const TIPOS_COMIDA = [
  'desayuno',
  'merienda_am',
  'almuerzo',
  'merienda_pm',
  'cena',
  'colacion_nocturna',
] as const

/* ------------------------------------------------------------------ */
/* Consultas                                                           */
/* ------------------------------------------------------------------ */

/*
 * Las fechas SIN hora salen con to_char.
 *
 * `pg` devuelve un `date` como Date a medianoche UTC, y el serializador
 * lo emite como instante: en husos al oeste de Greenwich se muestra el
 * día anterior. Es el tropiezo que ya documentó la Rebanada 3.
 */
const CAMPOS_PLAN = `
  pa.id,
  pa.nombre,
  pa.objetivo,
  to_char(pa.fecha_inicio, 'YYYY-MM-DD') as fecha_inicio,
  to_char(pa.fecha_fin,    'YYYY-MM-DD') as fecha_fin,
  pa.estado::text as estado,
  pa.notas,
  pa.created_at,
  pa.updated_at
`

/**
 * Un plan visible para el solicitante, o null.
 *
 * La visibilidad se resuelve DENTRO de la consulta: el plan se ata al
 * paciente y el paciente al nutricionista. Sin este join, un
 * nutricionista podría leer el plan de un paciente ajeno con solo
 * conocer su id.
 */
const SQL_PLAN = `
  select ${CAMPOS_PLAN}, pa.paciente_id
    from plan_alimentario pa
    join paciente p on p.id = pa.paciente_id
   where pa.id = $1
     and pa.clinica_id = $2
     and ($3::uuid is null or p.nutricionista_id = $3)
`

const SQL_PACIENTE_VISIBLE = `
  select 1 from paciente
   where id = $1 and clinica_id = $2
     and ($3::uuid is null or nutricionista_id = $3)
`

/*
 * El ORDER BY va contra `pc.tipo_comida`, la columna, NO contra el
 * alias de salida.
 *
 * Sin el prefijo, Postgres resuelve el nombre contra la columna
 * proyectada —que es `::text`— y ordena alfabéticamente. Con el enum
 * ordena por el orden en que se declararon los valores, que es el
 * cronológico del día.
 */
const SQL_COMIDAS = `
  select pc.id, pc.tipo_comida::text as tipo_comida, pc.patron, pc.ejemplo_menu
    from plan_comida pc
   where pc.plan_id = $1
   order by pc.tipo_comida
`

interface FilaPlan extends Record<string, unknown> {
  id: string
  paciente_id: string
  nombre: string
  objetivo: string | null
  fecha_inicio: string | null
  fecha_fin: string | null
  estado: 'borrador' | 'activo' | 'archivado'
  notas: string | null
  created_at: Date
  updated_at: Date
}

function aPlan(f: FilaPlan) {
  return {
    id: f.id,
    nombre: f.nombre,
    objetivo: f.objetivo,
    fechaInicio: f.fecha_inicio,
    fechaFin: f.fecha_fin,
    estado: f.estado,
    notas: f.notas,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
  }
}

function aComida(c: Record<string, unknown>) {
  return {
    id: c['id'] as string,
    tipoComida: c['tipo_comida'] as string,
    patron: (c['patron'] as string | null) ?? null,
    ejemploMenu: (c['ejemplo_menu'] as string | null) ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Validación                                                          */
/* ------------------------------------------------------------------ */

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

interface CabeceraPlan {
  nombre?: string
  objetivo?: string | null
  fechaInicio?: string | null
  fechaFin?: string | null
  notas?: string | null
}

/**
 * Distingue "no viene" de "viene vacío".
 *
 * Con COALESCE en el UPDATE —como se especificó primero— un campo
 * ausente y uno puesto a null son lo mismo, así que el objetivo de un
 * plan no se puede borrar nunca: se queda para siempre con el primer
 * texto que se escribió. Aquí `undefined` no toca el campo y `null` o
 * cadena vacía lo limpian.
 */
function validarCabecera(cuerpo: unknown, exigirNombre: boolean): {
  ok: true
  datos: CabeceraPlan
} | { ok: false; errores: ErrorCampo[] } {
  const errores: ErrorCampo[] = []
  const c = (cuerpo ?? {}) as Record<string, unknown>
  const datos: CabeceraPlan = {}

  if (c['nombre'] !== undefined || exigirNombre) {
    const v = typeof c['nombre'] === 'string' ? c['nombre'].trim() : ''
    if (v.length === 0 || v.length > 120) {
      errores.push({ campo: 'nombre', mensaje: 'Debe tener entre 1 y 120 caracteres' })
    } else {
      datos.nombre = v
    }
  }

  function textoOpcional(campo: keyof CabeceraPlan, maximo: number) {
    const v = c[campo]
    if (v === undefined) return
    if (v === null || v === '') {
      ;(datos[campo] as string | null) = null
      return
    }
    if (typeof v !== 'string') {
      errores.push({ campo, mensaje: 'Debe ser texto' })
      return
    }
    const limpio = v.trim()
    if (limpio.length > maximo) {
      errores.push({ campo, mensaje: `No puede superar ${maximo} caracteres` })
      return
    }
    ;(datos[campo] as string | null) = limpio === '' ? null : limpio
  }

  function fecha(campo: 'fechaInicio' | 'fechaFin') {
    const v = c[campo]
    if (v === undefined) return
    if (v === null || v === '') {
      datos[campo] = null
      return
    }
    if (typeof v !== 'string' || !FECHA_RE.test(v)) {
      errores.push({ campo, mensaje: 'Debe tener el formato AAAA-MM-DD' })
      return
    }
    datos[campo] = v
  }

  textoOpcional('objetivo', 500)
  textoOpcional('notas', 10_000)
  fecha('fechaInicio')
  fecha('fechaFin')

  // Solo se comprueba si vienen las dos: si una no cambia, la coherencia
  // la garantiza el CHECK de la base contra el valor ya guardado.
  if (
    datos.fechaInicio &&
    datos.fechaFin &&
    datos.fechaFin < datos.fechaInicio
  ) {
    errores.push({ campo: 'fechaFin', mensaje: 'No puede ser anterior a la fecha de inicio' })
  }

  if (errores.length > 0) return { ok: false, errores }
  return { ok: true, datos }
}

interface ComidaEntrada {
  tipoComida: string
  patron: string | null
  ejemploMenu: string | null
}

function validarComidas(
  cuerpo: unknown,
): { ok: true; comidas: ComidaEntrada[] } | { ok: false; errores: ErrorCampo[] } {
  const errores: ErrorCampo[] = []

  if (!Array.isArray(cuerpo)) {
    return {
      ok: false,
      errores: [{ campo: 'comidas', mensaje: 'Se espera una lista de comidas' }],
    }
  }

  const comidas: ComidaEntrada[] = []
  const vistas = new Set<string>()

  cuerpo.forEach((crudo, i) => {
    const c = (crudo ?? {}) as Record<string, unknown>
    const donde = `comidas[${i}]`

    const tipo = c['tipoComida']
    if (typeof tipo !== 'string' || !TIPOS_COMIDA.includes(tipo as (typeof TIPOS_COMIDA)[number])) {
      errores.push({ campo: `${donde}.tipoComida`, mensaje: `Debe ser uno de: ${TIPOS_COMIDA.join(', ')}` })
      return
    }

    // La restricción UNIQUE de la base lo impediría igual, pero un
    // duplicado dentro del mismo envío es un error del cliente y merece
    // un mensaje que diga qué tiempo de comida, no un choque de índice.
    if (vistas.has(tipo)) {
      errores.push({ campo: donde, mensaje: 'Hay dos entradas para el mismo tiempo de comida' })
      return
    }
    vistas.add(tipo)

    /** Texto opcional de hasta 1000; '' se normaliza a null. */
    function texto(campo: string): string | null {
      const v = c[campo]
      if (v === undefined || v === null || v === '') return null
      if (typeof v !== 'string') {
        errores.push({ campo: `${donde}.${campo}`, mensaje: 'Debe ser texto' })
        return null
      }
      const limpio = v.trim()
      if (limpio.length > 1000) {
        errores.push({ campo: `${donde}.${campo}`, mensaje: 'No puede superar 1000 caracteres' })
        return null
      }
      return limpio === '' ? null : limpio
    }

    const patron = texto('patron')
    const ejemploMenu = texto('ejemploMenu')

    // Una fila totalmente vacía es «sin prescribir»: no se guarda.
    if (patron === null && ejemploMenu === null) return

    comidas.push({ tipoComida: tipo, patron, ejemploMenu })
  })

  if (errores.length > 0) return { ok: false, errores }
  return { ok: true, comidas }
}

/* ------------------------------------------------------------------ */
/* Rutas                                                               */
/* ------------------------------------------------------------------ */

function noEncontradoPaciente() {
  return { error: 'paciente_no_encontrado', message: 'No se encontró el paciente' }
}

function noEncontradoPlan() {
  return { error: 'plan_no_encontrado', message: 'No se encontró el plan' }
}

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}

export async function registerPlanesRoutes(app: FastifyInstance): Promise<void> {
  /** Alcance del solicitante, o la respuesta de error ya lista. */
  async function alcanceDe(
    request: { auth: { tenantId: string; sub: string; roles: string[] } },
  ): Promise<Alcance | null> {
    const { tenantId, sub, roles } = request.auth
    return resolverAlcance(tenantId, sub, roles)
  }

  async function cargarPlan(
    planId: string,
    tenantId: string,
    restringirA: string | null,
  ): Promise<FilaPlan | null> {
    if (!esUuid(planId)) return null
    const { rows } = await pool.query<FilaPlan>(SQL_PLAN, [planId, tenantId, restringirA])
    return rows[0] ?? null
  }

  /* ---------------------------------------------------------------- */
  /* GET /api/pacientes/:id/planes                                     */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: { id: string } }>(
    '/api/pacientes/:id/planes',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradoPaciente())

      const alcance = await alcanceDe(request)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const visible = await pool.query(SQL_PACIENTE_VISIBLE, [id, tenantId, alcance.restringirA])
      if (visible.rowCount === 0) return reply.code(404).send(noEncontradoPaciente())

      // Solo la cabecera: la lista lateral no necesita 42 celdas por
      // plan, y traerlas multiplicaría la respuesta sin que se vean.
      const { rows } = await pool.query<FilaPlan>(
        `select ${CAMPOS_PLAN}, pa.paciente_id
           from plan_alimentario pa
          where pa.clinica_id = $1 and pa.paciente_id = $2
          -- Orden cronológico inverso, del más reciente al más antiguo
          -- (R41): la pestaña es el HISTÓRICO de planes y una lista que
          -- reordena por estado deja de leerse como una línea de tiempo.
          -- Cuál rige hoy sigue diciéndolo el chip «Activo».
          --
          -- La fecha de prescripción es fecha_inicio cuando la hay; un
          -- borrador sin fechas se ordena por cuándo se creó.
          order by coalesce(pa.fecha_inicio, pa.created_at::date) desc,
                   pa.created_at desc`,
        [tenantId, id],
      )
      return reply.send(rows.map(aPlan))
    },
  )

  /* ---------------------------------------------------------------- */
  /* POST /api/pacientes/:id/planes                                    */
  /* ---------------------------------------------------------------- */
  app.post<{ Params: { id: string } }>(
    '/api/pacientes/:id/planes',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradoPaciente())

      const alcance = await alcanceDe(request)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const visible = await pool.query(SQL_PACIENTE_VISIBLE, [id, tenantId, alcance.restringirA])
      if (visible.rowCount === 0) return reply.code(404).send(noEncontradoPaciente())

      const v = validarCabecera(request.body, true)
      if (!v.ok) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Revisa los datos del plan', errores: v.errores })
      }

      const { rows } = await pool.query<FilaPlan>(
        `insert into plan_alimentario
           (clinica_id, paciente_id, profesional_id, nombre, objetivo, fecha_inicio, fecha_fin, notas)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning ${CAMPOS_PLAN.replace(/pa\./g, '')}, paciente_id`,
        [
          tenantId,
          id,
          // El profesional sale de resolverAlcance, no del 'sub' del
          // token: 'sub' es el id de usuario de Keycloak y no existe en
          // la tabla profesional — la clave foránea lo rechazaría.
          alcance.profesionalId,
          v.datos.nombre,
          v.datos.objetivo ?? null,
          v.datos.fechaInicio ?? null,
          v.datos.fechaFin ?? null,
          v.datos.notas ?? null,
        ],
      )

      // Nace en borrador: activarlo es una decisión aparte, y el plan
      // todavía no tiene ni una comida.
      return reply.code(201).send(aPlan(rows[0] as FilaPlan))
    },
  )

  /* ---------------------------------------------------------------- */
  /* GET /api/planes/:planId                                           */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: { planId: string } }>(
    '/api/planes/:planId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId } = request.auth
      const alcance = await alcanceDe(request)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const plan = await cargarPlan(request.params.planId, tenantId, alcance.restringirA)
      if (!plan) return reply.code(404).send(noEncontradoPlan())

      const { rows } = await pool.query(SQL_COMIDAS, [plan.id])
      // Lista plana ordenada por tiempo de comida: el cliente reconstruye
      // las seis filas fijas rellenando las que falten.
      const comidas = rows.map(aComida)

      return reply.send({ ...aPlan(plan), pacienteId: plan.paciente_id, comidas })
    },
  )

  /* ---------------------------------------------------------------- */
  /* PUT /api/planes/:planId                                           */
  /* ---------------------------------------------------------------- */
  app.put<{ Params: { planId: string } }>(
    '/api/planes/:planId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId } = request.auth
      const alcance = await alcanceDe(request)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const plan = await cargarPlan(request.params.planId, tenantId, alcance.restringirA)
      if (!plan) return reply.code(404).send(noEncontradoPlan())

      if (plan.estado === 'archivado') {
        return reply.code(409).send({
          error: 'plan_archivado',
          message: 'Un plan archivado no se edita: es el registro de lo que se prescribió',
        })
      }

      const v = validarCabecera(request.body, false)
      if (!v.ok) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Revisa los datos del plan', errores: v.errores })
      }

      // Solo se escriben las columnas que vienen en el cuerpo. Un
      // COALESCE haría imposible borrar el objetivo de un plan.
      const sets: string[] = []
      const params: unknown[] = []
      for (const [campo, columna] of [
        ['nombre', 'nombre'],
        ['objetivo', 'objetivo'],
        ['fechaInicio', 'fecha_inicio'],
        ['fechaFin', 'fecha_fin'],
        ['notas', 'notas'],
      ] as const) {
        const valor = v.datos[campo]
        if (valor === undefined) continue
        params.push(valor)
        sets.push(`${columna} = $${params.length}`)
      }

      if (sets.length === 0) return reply.send(aPlan(plan))

      params.push(plan.id)
      const { rows } = await pool.query<FilaPlan>(
        `update plan_alimentario set ${sets.join(', ')}
          where id = $${params.length}
        returning ${CAMPOS_PLAN.replace(/pa\./g, '')}, paciente_id`,
        params,
      )
      return reply.send(aPlan(rows[0] as FilaPlan))
    },
  )

  /* ---------------------------------------------------------------- */
  /* PUT /api/planes/:planId/comidas — reemplazo completo              */
  /* ---------------------------------------------------------------- */
  app.put<{ Params: { planId: string } }>(
    '/api/planes/:planId/comidas',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId } = request.auth
      const alcance = await alcanceDe(request)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const plan = await cargarPlan(request.params.planId, tenantId, alcance.restringirA)
      if (!plan) return reply.code(404).send(noEncontradoPlan())

      if (plan.estado === 'archivado') {
        return reply.code(409).send({
          error: 'plan_archivado',
          message: 'Un plan archivado no se edita: es el registro de lo que se prescribió',
        })
      }

      const v = validarComidas(request.body)
      if (!v.ok) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Revisa las comidas del plan', errores: v.errores })
      }

      /*
       * Borrar e insertar dentro de UNA transacción.
       *
       * El cliente envía el patrón entero, así que el reemplazo total es
       * la operación honesta: un tiempo de comida que el profesional
       * vació tiene que desaparecer. Fuera de transacción, un fallo a
       * mitad dejaría el plan con medio patrón.
       */
      const cliente = await pool.connect()
      try {
        await cliente.query('begin')
        await cliente.query('delete from plan_comida where plan_id = $1', [plan.id])

        for (const c of v.comidas) {
          await cliente.query(
            `insert into plan_comida
               (clinica_id, plan_id, tipo_comida, patron, ejemplo_menu)
             values ($1,$2,$3::tiempo_comida_plan,$4,$5)`,
            [tenantId, plan.id, c.tipoComida, c.patron, c.ejemploMenu],
          )
        }
        await cliente.query('commit')
      } catch (error) {
        await cliente.query('rollback')
        throw error
      } finally {
        cliente.release()
      }

      return reply.send({ planId: plan.id, comidas: v.comidas.length })
    },
  )

  /* ---------------------------------------------------------------- */
  /* PUT /api/planes/:planId/activar                                   */
  /* ---------------------------------------------------------------- */
  app.put<{ Params: { planId: string } }>(
    '/api/planes/:planId/activar',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId } = request.auth
      const alcance = await alcanceDe(request)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const plan = await cargarPlan(request.params.planId, tenantId, alcance.restringirA)
      if (!plan) return reply.code(404).send(noEncontradoPlan())

      if (plan.estado === 'archivado') {
        return reply.code(409).send({
          error: 'plan_archivado',
          message: 'Un plan archivado no se puede reactivar. Duplícalo si quieres volver a usarlo.',
        })
      }
      // Ya activo: se devuelve tal cual. Reactivar lo que ya está
      // activo no es un error, es que no hay nada que hacer.
      if (plan.estado === 'activo') return reply.send(aPlan(plan))

      try {
        const { rows } = await pool.query<FilaPlan>(
          `update plan_alimentario set estado = 'activo' where id = $1
           returning ${CAMPOS_PLAN.replace(/pa\./g, '')}, paciente_id`,
          [plan.id],
        )
        return reply.send(aPlan(rows[0] as FilaPlan))
      } catch (error) {
        // 23505 = el índice parcial de un solo plan activo por paciente.
        // Se traduce a un 409 con instrucciones en vez de dejar salir un
        // error de base que el usuario no puede interpretar.
        if ((error as { code?: string }).code === '23505') {
          return reply.code(409).send({
            error: 'plan_activo_existente',
            message: 'El paciente ya tiene un plan activo. Archívalo antes de activar este.',
          })
        }
        throw error
      }
    },
  )

  /* ---------------------------------------------------------------- */
  /* PUT /api/planes/:planId/archivar                                  */
  /* ---------------------------------------------------------------- */
  app.put<{ Params: { planId: string } }>(
    '/api/planes/:planId/archivar',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId } = request.auth
      const alcance = await alcanceDe(request)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const plan = await cargarPlan(request.params.planId, tenantId, alcance.restringirA)
      if (!plan) return reply.code(404).send(noEncontradoPlan())

      if (plan.estado === 'archivado') {
        return reply.code(409).send({ error: 'plan_archivado', message: 'El plan ya está archivado' })
      }

      const { rows } = await pool.query<FilaPlan>(
        `update plan_alimentario set estado = 'archivado' where id = $1
         returning ${CAMPOS_PLAN.replace(/pa\./g, '')}, paciente_id`,
        [plan.id],
      )
      return reply.send(aPlan(rows[0] as FilaPlan))
    },
  )

  /* ---------------------------------------------------------------- */
  /* DELETE /api/planes/:planId — lógico, solo borradores              */
  /* ---------------------------------------------------------------- */
  app.delete<{ Params: { planId: string } }>(
    '/api/planes/:planId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId } = request.auth
      const alcance = await alcanceDe(request)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const plan = await cargarPlan(request.params.planId, tenantId, alcance.restringirA)
      if (!plan) return reply.code(404).send(noEncontradoPlan())

      // Un plan que llegó a estar activo es historia clínica: se
      // archiva, no se descarta. Solo un borrador —que nunca se
      // prescribió— puede retirarse.
      if (plan.estado !== 'borrador') {
        return reply.code(409).send({
          error: 'plan_no_eliminable',
          message: 'Solo se pueden eliminar planes en borrador. Archiva el plan si quieres retirarlo.',
        })
      }

      // Archivar, no borrar: la trazabilidad del proyecto dice que nada
      // desaparece físicamente.
      await pool.query(`update plan_alimentario set estado = 'archivado' where id = $1`, [plan.id])
      return reply.code(204).send()
    },
  )
}
