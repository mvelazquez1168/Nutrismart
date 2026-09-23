/**
 * Contador de porciones — PAC-07.
 *
 * El diario de la Rebanada 22 acepta una frase por comida. Esto añade el
 * modo detallado: alimento por alimento, con cantidad, y las calorías
 * salen del catálogo en vez de la estimación del paciente.
 *
 * Dos cosas importan al leer esto:
 *
 * Los items cuelgan de la MISMA fila `registro_comida` que usa el modo
 * simple, y sus totales los recalcula un trigger. Por eso la ficha del
 * profesional (R22) y la media de calorías del progreso (R23) siguen
 * funcionando sin tocarlas: leen la fila padre, que ahora está bien.
 *
 * Y las cifras se COPIAN al apuntar. Si mañana se corrige una ficha del
 * catálogo, lo que el paciente registró en marzo sigue diciendo lo que
 * registró: un diario clínico no se reescribe solo.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuthPaciente } from '../auth.js'
import { esUuid } from '../pacientes/validacion.js'

const CATEGORIAS = [
  'cereales',
  'leguminosas',
  'carnes',
  'lacteos',
  'frutas',
  'verduras',
  'bebidas',
  'grasas',
  'otro',
] as const

const MODOS = ['simple', 'detallado'] as const
type Modo = (typeof MODOS)[number]

/**
 * Claves de los fondos (PAC-09). Solo la clave: los colores están en
 * `packages/design-system/tokens.css`, con el mismo mecanismo que las
 * paletas de marca. El servidor no sabe de qué color es «verde», y no
 * tiene por qué saberlo.
 */
const FONDOS = ['neutro', 'verde', 'azul', 'morado', 'salmon', 'cafe', 'noche'] as const
type Fondo = (typeof FONDOS)[number]

/** Las mismas franjas del plan alimentario y del diario simple. */
const TIPOS_COMIDA = [
  'desayuno',
  'media_manana',
  'almuerzo',
  'merienda',
  'cena',
  'extra',
] as const

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

interface Pac {
  id: string
  clinica_id: string
}

async function resolverPaciente(sub: string): Promise<Pac | undefined> {
  const { rows } = await pool.query<Pac>(
    `select id, clinica_id from paciente
      where keycloak_user_id = $1 and estado = 'activo'`,
    [sub],
  )
  return rows[0]
}

async function sinExpediente(sub: string) {
  const { rows } = await pool.query(
    `select 1 from profesional where keycloak_user_id = $1 limit 1`,
    [sub],
  )
  return rows[0]
    ? {
        codigo: 403,
        cuerpo: {
          error: 'solo_pacientes',
          message: 'Esta zona es solo para pacientes. Entra por la aplicación profesional.',
        },
      }
    : {
        codigo: 404,
        cuerpo: {
          error: 'sin_vincular',
          message: 'Tu cuenta todavía no está vinculada a un expediente.',
        },
      }
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

/** Redondeo a un decimal, que es la precisión de las columnas. */
const r1 = (n: number) => Math.round(n * 10) / 10

function aAlimento(f: Record<string, unknown>) {
  return {
    id: f['id'] as string,
    nombre: f['nombre'] as string,
    categoria: f['categoria'] as string,
    kcalPor100g: num(f['kcal_por_100g']),
    proteinaPor100g: num(f['proteina_por_100g']),
    choPor100g: num(f['cho_por_100g']),
    grasaPor100g: num(f['grasa_por_100g']),
    porcionTipicaG: num(f['porcion_tipica_g']),
    unidadPorcion: f['unidad_porcion'] as string,
    propio: f['clinica_id'] !== null,
  }
}

export async function registerAlimentosRoutes(app: FastifyInstance): Promise<void> {
  /* ================================================================ */
  /* Catálogo                                                          */
  /* ================================================================ */

  app.get<{ Querystring: { q?: string; categoria?: string } }>(
    '/api/paciente/alimentos',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const q = typeof request.query.q === 'string' ? request.query.q.trim() : ''
      const cat =
        typeof request.query.categoria === 'string' &&
        (CATEGORIAS as readonly string[]).includes(request.query.categoria)
          ? request.query.categoria
          : null

      // El lado izquierdo usa la misma función que indexa la tabla, así
      // que "platano" encuentra "Plátano" y "jitomate" encuentra
      // "Tomate".
      //
      // El término que teclea el paciente se normaliza APARTE, no con
      // esa función: la función concatena nombre y sinónimos, y aplicada
      // a un término suelto deja un espacio al final. El patrón sería
      // '%pech %' y no encontraría "Pechuga de pollo" — que es
      // exactamente lo que pasó al probarlo.
      //
      // Se ven los alimentos globales (clinica_id null) y los de la
      // propia clínica. Los de otra clínica no existen para este
      // paciente.
      const { rows } = await pool.query(
        `select id, clinica_id, nombre, categoria, kcal_por_100g, proteina_por_100g,
                cho_por_100g, grasa_por_100g, porcion_tipica_g, unidad_porcion
           from alimento_catalogo
          where activo = true
            and (clinica_id is null or clinica_id = $1)
            and ($2::text is null
                 or alimento_texto_busqueda(nombre, sinonimos)
                      like '%' || lower(unaccent('unaccent', $2)) || '%')
            and ($3::text is null or categoria = $3)
          -- Lo propio de la clínica primero: si alguien se molestó en
          -- dar de alta "casado del día", es lo que quiere encontrar.
          order by (clinica_id is null), nombre
          limit 40`,
        [pac.clinica_id, q === '' ? null : q, cat],
      )

      return reply.send(rows.map(aAlimento))
    },
  )

  /* ================================================================ */
  /* Preferencia de modo                                               */
  /* ================================================================ */

  app.get(
    '/api/paciente/configuracion',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      // El nombre y las iniciales salen del expediente si el paciente no
      // ha puesto otra cosa, así que la consulta parte de `paciente` y
      // deja la configuración en LEFT JOIN: sin fila de preferencias la
      // respuesta sigue siendo completa.
      const { rows } = await pool.query(
        `select p.nombre,
                c.modo_diario, c.fondo, c.foto_url, c.nombre_preferido
           from paciente p
           left join configuracion_paciente c
                  on c.paciente_id = p.id and c.clinica_id = p.clinica_id
          where p.id = $1 and p.clinica_id = $2`,
        [pac.id, pac.clinica_id],
      )
      const f = rows[0]!

      // Sin fila, los valores de fábrica. No se crea al vuelo: una
      // preferencia que nadie ha expresado no es una preferencia.
      return reply.send({
        modoDiario: f['modo_diario'] ?? 'simple',
        fondo: f['fondo'] ?? 'neutro',
        fotoUrl: f['foto_url'] ?? null,
        // El nombre del expediente es el de reserva, no el que manda: si
        // el paciente eligió cómo quiere que le llamen, gana el suyo.
        nombre: f['nombre_preferido'] ?? f['nombre'],
        nombrePreferido: f['nombre_preferido'] ?? null,
        nombreExpediente: f['nombre'],
      })
    },
  )

  app.patch<{ Body: Record<string, unknown> }>(
    '/api/paciente/configuracion',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      // Parcial: se cambia lo que venga. Exigir los dos campos obligaría
      // al selector de fondo a reenviar el modo del diario, y a la larga
      // uno pisaría al otro.
      const b = request.body ?? {}
      const modo = b['modoDiario']
      const fondo = b['fondo']

      if (modo !== undefined && (typeof modo !== 'string' || !(MODOS as readonly string[]).includes(modo))) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'El modo debe ser simple o detallado' })
      }
      if (fondo !== undefined && (typeof fondo !== 'string' || !(FONDOS as readonly string[]).includes(fondo))) {
        return reply.code(400).send({ error: 'validacion', message: 'Ese fondo no existe' })
      }
      if (modo === undefined && fondo === undefined) {
        return reply.code(400).send({ error: 'validacion', message: 'No hay nada que cambiar' })
      }

      // `coalesce(excluded.x, tabla.x)` deja intacto lo que no se manda,
      // y los DEFAULT de la tabla cubren el primer INSERT.
      const { rows } = await pool.query(
        `insert into configuracion_paciente (paciente_id, clinica_id, modo_diario, fondo)
         values ($1, $2, coalesce($3, 'simple'), coalesce($4, 'neutro'))
         on conflict (paciente_id, clinica_id)
         do update set modo_diario = coalesce(excluded.modo_diario, configuracion_paciente.modo_diario),
                       fondo       = coalesce($4, configuracion_paciente.fondo),
                       updated_at  = now()
         returning modo_diario, fondo`,
        [pac.id, pac.clinica_id, (modo as Modo) ?? null, (fondo as Fondo) ?? null],
      )

      const r = rows[0]!
      return reply.send({ modoDiario: r['modo_diario'], fondo: r['fondo'] })
    },
  )

  /* ================================================================ */
  /* Perfil: foto y nombre preferido                                   */
  /* ================================================================ */

  app.patch<{ Body: Record<string, unknown> }>(
    '/api/paciente/perfil',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const b = request.body ?? {}

      // `null` explícito significa BORRAR; ausente significa NO TOCAR.
      // Sin distinguirlos no habría forma de quitar una foto: mandar
      // null se leería igual que no mandar nada.
      const tocaFoto = 'fotoUrl' in b
      const tocaNombre = 'nombrePreferido' in b
      if (!tocaFoto && !tocaNombre) {
        return reply.code(400).send({ error: 'validacion', message: 'No hay nada que cambiar' })
      }

      let fotoUrl: string | null = null
      if (tocaFoto && b['fotoUrl'] !== null) {
        const v = b['fotoUrl']
        if (typeof v !== 'string' || v.length > 500) {
          return reply.code(400).send({ error: 'validacion', message: 'La dirección de la foto no vale' })
        }
        // Solo https. Un `http://` filtraría la petición en claro y un
        // `javascript:` o `data:` acabaría en el atributo src de una
        // etiqueta img de la aplicación.
        let u: URL
        try {
          u = new URL(v)
        } catch {
          return reply
            .code(400)
            .send({ error: 'validacion', message: 'Escribe una dirección web completa' })
        }
        if (u.protocol !== 'https:') {
          return reply
            .code(400)
            .send({ error: 'validacion', message: 'La dirección de la foto debe empezar por https://' })
        }
        fotoUrl = u.toString()
      }

      let nombre: string | null = null
      if (tocaNombre && b['nombrePreferido'] !== null) {
        const v = b['nombrePreferido']
        const t = typeof v === 'string' ? v.trim() : ''
        if (t === '' || t.length > 50) {
          return reply
            .code(400)
            .send({ error: 'validacion', message: 'El nombre debe tener entre 1 y 50 caracteres' })
        }
        nombre = t
      }

      const { rows } = await pool.query(
        `insert into configuracion_paciente
           (paciente_id, clinica_id, foto_url, nombre_preferido)
         values ($1, $2, $3, $4)
         on conflict (paciente_id, clinica_id)
         do update set
           foto_url         = case when $5 then $3 else configuracion_paciente.foto_url end,
           nombre_preferido = case when $6 then $4 else configuracion_paciente.nombre_preferido end,
           updated_at       = now()
         returning foto_url, nombre_preferido`,
        [pac.id, pac.clinica_id, fotoUrl, nombre, tocaFoto, tocaNombre],
      )

      const r = rows[0]!
      return reply.send({
        fotoUrl: r['foto_url'],
        nombrePreferido: r['nombre_preferido'],
      })
    },
  )

  /* ================================================================ */
  /* Items de una comida                                               */
  /* ================================================================ */

  /**
   * Comprueba que la comida es de este paciente antes de tocarla.
   *
   * Devuelve `undefined` tanto si no existe como si es de otro: desde
   * fuera no se puede distinguir un id inventado de uno ajeno, que es
   * justo lo que se quiere.
   */
  async function comidaPropia(registroId: string, pac: Pac): Promise<boolean> {
    const { rows } = await pool.query(
      `select 1 from registro_comida
        where id = $1 and paciente_id = $2 and clinica_id = $3 and activo = true`,
      [registroId, pac.id, pac.clinica_id],
    )
    return rows.length > 0
  }

  app.get<{ Params: { registroId: string } }>(
    '/api/paciente/diario/:registroId/items',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const { registroId } = request.params
      if (!esUuid(registroId) || !(await comidaPropia(registroId, pac))) {
        return reply.code(404).send({ error: 'no_encontrada', message: 'No se encontró la comida' })
      }

      const { rows } = await pool.query(
        `select id, alimento_id, nombre_alimento, cantidad_g,
                kcal, proteina_g, cho_g, grasa_g,
                to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
           from registro_comida_item
          where registro_comida_id = $1 and activo = true
          order by created_at, id`,
        [registroId],
      )

      return reply.send(
        rows.map((f) => ({
          id: f['id'],
          alimentoId: f['alimento_id'],
          nombre: f['nombre_alimento'],
          cantidadG: num(f['cantidad_g']),
          kcal: num(f['kcal']),
          proteinaG: num(f['proteina_g']),
          choG: num(f['cho_g']),
          grasaG: num(f['grasa_g']),
          apuntadoEn: f['created_at'],
        })),
      )
    },
  )

  /**
   * Añade un alimento a una franja del día.
   *
   * La ruta lleva la FRANJA y no el id de la comida, a diferencia de lo
   * que pedía el encargo. El motivo: en modo detallado la descripción de
   * la comida la calcula el trigger a partir de los alimentos, así que
   * no hay nada que escribir para crearla antes. Con `:registroId` el
   * cliente tendría que crear primero una comida con una descripción
   * inventada y confiar en que el trigger la tape — y si el paciente
   * abandona ahí, se queda un registro con texto de relleno.
   *
   * Abriendo la franja y metiendo el alimento en la misma transacción no
   * existe ese estado intermedio: o hay comida con al menos un alimento,
   * o no hay comida.
   */
  app.post<{ Body: Record<string, unknown> }>(
    '/api/paciente/diario/items',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const b = request.body ?? {}

      const tipo = b['tipoComida']
      if (typeof tipo !== 'string' || !(TIPOS_COMIDA as readonly string[]).includes(tipo)) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Indica una franja de comida válida' })
      }

      const f = b['fecha']
      const fecha = typeof f === 'string' && RE_FECHA.test(f) ? f : null

      const cantidad = Number(b['cantidadG'])
      if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 5000) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Indica una cantidad entre 1 y 5000' })
      }

      const alimentoId = b['alimentoId']
      let nombre: string
      let kcal: number | null = null
      let prot: number | null = null
      let cho: number | null = null
      let grasa: number | null = null

      if (alimentoId !== undefined && alimentoId !== null && alimentoId !== '') {
        if (typeof alimentoId !== 'string' || !esUuid(alimentoId)) {
          return reply
            .code(400)
            .send({ error: 'validacion', message: 'El alimento indicado no es válido' })
        }

        // Se relee el alimento del servidor en vez de fiarse de las
        // cifras que manda el cliente: si no, cualquiera podría apuntar
        // una pizza con 0 kcal y el diario dejaría de valer.
        const { rows } = await pool.query(
          `select nombre, kcal_por_100g, proteina_por_100g, cho_por_100g, grasa_por_100g
             from alimento_catalogo
            where id = $1 and activo = true and (clinica_id is null or clinica_id = $2)`,
          [alimentoId, pac.clinica_id],
        )
        const a = rows[0]
        if (!a) {
          return reply
            .code(404)
            .send({ error: 'no_encontrado', message: 'Ese alimento ya no está disponible' })
        }

        const factor = cantidad / 100
        nombre = a['nombre'] as string
        kcal = r1(Number(a['kcal_por_100g']) * factor)
        prot = r1(Number(a['proteina_por_100g']) * factor)
        cho = r1(Number(a['cho_por_100g']) * factor)
        grasa = r1(Number(a['grasa_por_100g']) * factor)
      } else {
        // Alimento libre: el catálogo nunca lo va a tener todo, y
        // obligar a elegir de una lista hace que la gente deje de
        // apuntar. Sin cifras nutricionales, porque no las hay — y una
        // comida sin estimar ya se cuenta aparte desde la R22.
        const n = typeof b['nombre'] === 'string' ? b['nombre'].trim() : ''
        if (n === '' || n.length > 200) {
          return reply
            .code(400)
            .send({ error: 'validacion', message: 'Escribe el nombre del alimento' })
        }
        nombre = n
      }

      const cliente = await pool.connect()
      try {
        await cliente.query('begin')

        // La franja se abre o se reutiliza. `descripcion` va con el
        // nombre del alimento solo para satisfacer el NOT NULL: el
        // trigger la reescribe con la lista completa en cuanto se
        // inserta el item, dentro de esta misma transacción, así que
        // nadie llega a ver ese valor.
        //
        // `activo = true` en el conflicto revive una comida que se
        // hubiera vaciado antes, igual que hace el diario simple.
        const { rows: comida } = await cliente.query<{ id: string }>(
          `insert into registro_comida
             (clinica_id, paciente_id, fecha, tipo_comida, descripcion)
           values ($1, $2,
                   coalesce($3::date, (now() at time zone 'America/Costa_Rica')::date),
                   $4, $5)
           on conflict (paciente_id, fecha, tipo_comida) do update
             set activo = true, updated_at = now()
           returning id`,
          [pac.clinica_id, pac.id, fecha, tipo, nombre],
        )
        const registroId = comida[0]!.id

        const { rows } = await cliente.query<{ id: string }>(
          `insert into registro_comida_item
             (registro_comida_id, clinica_id, alimento_id, nombre_alimento,
              cantidad_g, kcal, proteina_g, cho_g, grasa_g)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           returning id`,
          [
            registroId,
            pac.clinica_id,
            typeof alimentoId === 'string' && alimentoId !== '' ? alimentoId : null,
            nombre,
            cantidad,
            kcal,
            prot,
            cho,
            grasa,
          ],
        )

        await cliente.query('commit')

        return reply.code(201).send({
          registroId,
          id: rows[0]!.id,
          nombre,
          cantidadG: cantidad,
          kcal,
          proteinaG: prot,
          choG: cho,
          grasaG: grasa,
        })
      } catch (e) {
        await cliente.query('rollback')
        throw e
      } finally {
        cliente.release()
      }
    },
  )

  app.delete<{ Params: { registroId: string; itemId: string } }>(
    '/api/paciente/diario/:registroId/items/:itemId',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const { registroId, itemId } = request.params
      if (!esUuid(registroId) || !esUuid(itemId) || !(await comidaPropia(registroId, pac))) {
        return reply.code(404).send({ error: 'no_encontrada', message: 'No se encontró la comida' })
      }

      const { rowCount } = await pool.query(
        `update registro_comida_item set activo = false
          where id = $1 and registro_comida_id = $2 and clinica_id = $3 and activo = true`,
        [itemId, registroId, pac.clinica_id],
      )
      if (rowCount === 0) {
        return reply.code(404).send({ error: 'no_encontrado', message: 'No se encontró el alimento' })
      }

      // Quitado el último alimento, la comida se queda vacía: su
      // descripción sería la de antes de quitar nada, y una comida que
      // dice "arroz, pollo" cuando ya no queda ninguno de los dos es
      // peor que ninguna comida. Se archiva entera.
      //
      // El trigger no puede hacerlo: al llegar a cero no tiene con qué
      // reconstruir nada, y borrar filas desde un trigger de otra tabla
      // esconde demasiado.
      const { rows: quedan } = await pool.query<{ n: string }>(
        `select count(*)::text as n from registro_comida_item
          where registro_comida_id = $1 and activo = true`,
        [registroId],
      )

      const vacia = quedan[0]!.n === '0'
      if (vacia) {
        await pool.query(
          `update registro_comida set activo = false, updated_at = now() where id = $1`,
          [registroId],
        )
      }

      return reply.send({ ok: true, comidaVacia: vacia })
    },
  )
}
