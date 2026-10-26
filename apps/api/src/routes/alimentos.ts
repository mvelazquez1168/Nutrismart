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

/* ---- R53: personalización de la app del paciente ---- */

/** Las mismas diez del CHECK de la migración 059 y de `palette.ts`. */
const PALETAS = [
  'verde',
  'azul-oceano',
  'azul-cielo',
  'turquesa',
  'indigo',
  'violeta',
  'rosa',
  'naranja',
  'rojo',
  'gris',
] as const

const ESTILOS_CABELLO = [
  'Corto',
  'Largo',
  'Rizado',
  'Ondulado',
  'Moño',
  'Corto M',
  'Calvo',
] as const

const EXPRESIONES = ['Sonrisa', 'Neutral', 'Amplia'] as const

/** Color de seis dígitos. Mismo patrón que el CHECK de la 059. */
const RE_HEX = /^#[0-9a-fA-F]{6}$/

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

interface UnidadFila {
  id: string
  nombre: string
  gramosEquivalentes: string | number
  esDefecto: boolean
}

function aAlimento(f: Record<string, unknown>) {
  // `unidades` llega como json desde la base, con los numeros ya
  // serializados. Se normalizan a number aqui para que el cliente no
  // tenga que distinguir de donde salio cada campo.
  const unidades = ((f['unidades'] ?? []) as UnidadFila[]).map((u) => ({
    id: u.id,
    nombre: u.nombre,
    gramosEquivalentes: Number(u.gramosEquivalentes),
    esDefecto: u.esDefecto,
  }))

  return {
    id: f['id'] as string,
    nombre: f['nombre'] as string,
    categoria: f['categoria'] as string,
    kcalPor100g: num(f['kcal_por_100g']),
    proteinaPor100g: num(f['proteina_por_100g']),
    choPor100g: num(f['cho_por_100g']),
    grasaPor100g: num(f['grasa_por_100g']),
    // R52. NULL en los 46 alimentos de la 026: no se conoce, y un 0
    // afirmaria que el frijol no tiene fibra.
    fibraPor100g: num(f['fibra_por_100g']),
    porcionTipicaG: num(f['porcion_tipica_g']),
    unidadPorcion: f['unidad_porcion'] as string,
    verificado: f['verificado'] === true,
    propio: f['clinica_id'] !== null,
    // Siempre al menos dos: la porcion tipica y los 100 g. La pantalla
    // de detalle preselecciona la que tenga `esDefecto`.
    unidades,
  }
}

export async function registerAlimentosRoutes(app: FastifyInstance): Promise<void> {
  /* ================================================================ */
  /* Catálogo                                                          */
  /* ================================================================ */

  app.get<{ Querystring: { q?: string; categoria?: string; fuente?: string; limite?: string } }>(
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

      // R52 pide dos pestanas en el buscador: «Biblioteca» y «Mis
      // alimentos». No hay alimentos POR PACIENTE en el modelo —el
      // catalogo es global o de la clinica (026)—, asi que «mis
      // alimentos» son los de la clinica del paciente, que es lo que su
      // nutricionista dio de alta para el. Un valor que no sea ninguno
      // de los dos se ignora en vez de dar 400: el buscador seguiria
      // siendo util y un filtro mal escrito no debe vaciar la pantalla.
      const fuente =
        request.query.fuente === 'biblioteca' || request.query.fuente === 'mis-alimentos'
          ? request.query.fuente
          : null

      const limitePedido = Number(request.query.limite)
      const limite = Number.isFinite(limitePedido)
        ? Math.min(Math.max(Math.floor(limitePedido), 1), 60)
        : 40

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
        `select a.id, a.clinica_id, a.nombre, a.categoria, a.kcal_por_100g,
                a.proteina_por_100g, a.cho_por_100g, a.grasa_por_100g,
                a.fibra_por_100g, a.porcion_tipica_g, a.unidad_porcion, a.verificado,
                -- Las unidades en la misma consulta y no en una por
                -- alimento: la pantalla de detalle las necesita para
                -- pintar las chips en cuanto el paciente toca un
                -- resultado, y 40 consultas mas por busqueda se notan
                -- en un movil con mala red.
                coalesce(
                  (select json_agg(json_build_object(
                            'id', u.id,
                            'nombre', u.nombre,
                            'gramosEquivalentes', u.gramos_equivalentes,
                            'esDefecto', u.es_defecto)
                          order by u.es_defecto desc, u.gramos_equivalentes)
                     from alimento_unidad u
                    where u.alimento_id = a.id and u.activo = true),
                  '[]'::json) as unidades
           from alimento_catalogo a
          where a.activo = true
            and (a.clinica_id is null or a.clinica_id = $1)
            and ($2::text is null
                 or alimento_texto_busqueda(a.nombre, a.sinonimos)
                      like '%' || lower(unaccent('unaccent', $2)) || '%')
            and ($3::text is null or a.categoria = $3)
            and ($4::text is null
                 or ($4 = 'biblioteca' and a.clinica_id is null)
                 or ($4 = 'mis-alimentos' and a.clinica_id = $1))
          -- Lo propio de la clínica primero: si alguien se molestó en
          -- dar de alta "casado del día", es lo que quiere encontrar.
          order by (a.clinica_id is null), a.nombre
          limit $5`,
        [pac.clinica_id, q === '' ? null : q, cat, fuente, limite],
      )

      return reply.send(rows.map(aAlimento))
    },
  )

  /**
   * Una ficha concreta — R52.
   *
   * La búsqueda ya devuelve las unidades, así que la pantalla de detalle
   * no necesita esto para abrirse. Hace falta para el otro camino: abrir
   * un alimento que el paciente apuntó hace días, cuando lo único que
   * hay guardado es su id.
   */
  app.get<{ Params: { id: string } }>(
    '/api/paciente/alimentos/:id',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const { id } = request.params
      if (!esUuid(id)) {
        return reply
          .code(404)
          .send({ error: 'no_encontrado', message: 'Ese alimento no está disponible' })
      }

      const { rows } = await pool.query(
        `select a.id, a.clinica_id, a.nombre, a.categoria, a.kcal_por_100g,
                a.proteina_por_100g, a.cho_por_100g, a.grasa_por_100g,
                a.fibra_por_100g, a.porcion_tipica_g, a.unidad_porcion, a.verificado,
                coalesce(
                  (select json_agg(json_build_object(
                            'id', u.id,
                            'nombre', u.nombre,
                            'gramosEquivalentes', u.gramos_equivalentes,
                            'esDefecto', u.es_defecto)
                          order by u.es_defecto desc, u.gramos_equivalentes)
                     from alimento_unidad u
                    where u.alimento_id = a.id and u.activo = true),
                  '[]'::json) as unidades
           from alimento_catalogo a
          where a.id = $1 and a.activo = true
            and (a.clinica_id is null or a.clinica_id = $2)`,
        [id, pac.clinica_id],
      )

      // Un alimento de otra clínica se contesta igual que uno que no
      // existe: desde fuera no debe poder distinguirse.
      if (!rows[0]) {
        return reply
          .code(404)
          .send({ error: 'no_encontrado', message: 'Ese alimento no está disponible' })
      }

      return reply.send(aAlimento(rows[0]))
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
                c.modo_diario, c.fondo, c.foto_url, c.nombre_preferido,
                c.paleta_color, c.avatar_personaje, c.avatar_piel,
                c.avatar_cabello_estilo, c.avatar_cabello_color,
                c.avatar_ojos, c.avatar_expresion, c.avatar_lentes
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
        // R53. `paleta` va suelta y el avatar agrupado porque son dos
        // cosas que se guardan por separado, con un PATCH cada una.
        paleta: f['paleta_color'] ?? 'verde',
        avatar: {
          personaje: f['avatar_personaje'] ?? 0,
          piel: f['avatar_piel'] ?? '#FDDCB5',
          cabelloEstilo: f['avatar_cabello_estilo'] ?? 'Largo',
          cabelloColor: f['avatar_cabello_color'] ?? '#2C1B18',
          ojos: f['avatar_ojos'] ?? '#3D2B1A',
          expresion: f['avatar_expresion'] ?? 'Sonrisa',
          lentes: f['avatar_lentes'] === true,
        },
        // Para que la pantalla sepa si enseñar el avatar o las
        // iniciales: sin fila de configuración, el paciente no ha
        // elegido nada todavía y un avatar por defecto seria inventarle
        // una cara.
        tieneAvatar: f['avatar_personaje'] !== null && f['avatar_personaje'] !== undefined,
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
  /* Paleta y avatar — R53                                             */
  /* ================================================================ */

  app.patch<{ Body: Record<string, unknown> }>(
    '/api/paciente/perfil/paleta',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const v = (request.body ?? {})['paleta']
      if (typeof v !== 'string' || !(PALETAS as readonly string[]).includes(v)) {
        return reply.code(400).send({ error: 'validacion', message: 'Esa paleta no existe' })
      }

      const { rows } = await pool.query(
        `insert into configuracion_paciente (paciente_id, clinica_id, paleta_color)
         values ($1, $2, $3)
         on conflict (paciente_id, clinica_id)
         do update set paleta_color = excluded.paleta_color, updated_at = now()
         returning paleta_color`,
        [pac.id, pac.clinica_id, v],
      )

      return reply.send({ paleta: rows[0]!['paleta_color'] })
    },
  )

  /**
   * El avatar ilustrado.
   *
   * Los siete campos van juntos y de una vez: el paciente los ajusta en
   * la misma pantalla y pulsa guardar una sola vez. Un PATCH por campo
   * dejaría estados a medias —piel nueva con pelo viejo— si se cae la
   * red entre dos de ellos.
   *
   * Se valida TODO contra las mismas listas cerradas que impone la base
   * (migración 059). Un CHECK que salta llega al cliente como 500, y lo
   * que tiene que ver es por qué su elección no vale.
   */
  app.patch<{ Body: Record<string, unknown> }>(
    '/api/paciente/perfil/avatar',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const b = request.body ?? {}
      const malo = (mensaje: string) =>
        reply.code(400).send({ error: 'validacion', message: mensaje })

      const personaje = Number(b['personaje'])
      if (!Number.isInteger(personaje) || personaje < 0 || personaje > 11) {
        return malo('Ese personaje no existe')
      }

      const hex = (v: unknown) => typeof v === 'string' && RE_HEX.test(v)
      if (!hex(b['piel'])) return malo('Ese tono de piel no vale')
      if (!hex(b['cabelloColor'])) return malo('Ese color de pelo no vale')
      if (!hex(b['ojos'])) return malo('Ese color de ojos no vale')

      const estilo = b['cabelloEstilo']
      if (typeof estilo !== 'string' || !(ESTILOS_CABELLO as readonly string[]).includes(estilo)) {
        return malo('Ese peinado no existe')
      }

      const expresion = b['expresion']
      if (typeof expresion !== 'string' || !(EXPRESIONES as readonly string[]).includes(expresion)) {
        return malo('Esa expresion no existe')
      }

      const { rows } = await pool.query(
        `insert into configuracion_paciente
           (paciente_id, clinica_id, avatar_personaje, avatar_piel,
            avatar_cabello_estilo, avatar_cabello_color, avatar_ojos,
            avatar_expresion, avatar_lentes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (paciente_id, clinica_id)
         do update set avatar_personaje      = excluded.avatar_personaje,
                       avatar_piel           = excluded.avatar_piel,
                       avatar_cabello_estilo = excluded.avatar_cabello_estilo,
                       avatar_cabello_color  = excluded.avatar_cabello_color,
                       avatar_ojos           = excluded.avatar_ojos,
                       avatar_expresion      = excluded.avatar_expresion,
                       avatar_lentes         = excluded.avatar_lentes,
                       updated_at            = now()
         returning avatar_personaje, avatar_piel, avatar_cabello_estilo,
                   avatar_cabello_color, avatar_ojos, avatar_expresion, avatar_lentes`,
        [
          pac.id,
          pac.clinica_id,
          personaje,
          b['piel'],
          estilo,
          b['cabelloColor'],
          b['ojos'],
          expresion,
          b['lentes'] === true,
        ],
      )

      const a = rows[0]!
      return reply.send({
        personaje: a['avatar_personaje'],
        piel: a['avatar_piel'],
        cabelloEstilo: a['avatar_cabello_estilo'],
        cabelloColor: a['avatar_cabello_color'],
        ojos: a['avatar_ojos'],
        expresion: a['avatar_expresion'],
        lentes: a['avatar_lentes'] === true,
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

      // La unidad por LEFT JOIN: las filas de antes de R52 no la tienen
      // y las que la tenían pueden haberla perdido si la clínica retiró
      // la medida del catálogo (`on delete set null`). En los dos casos
      // quedan los gramos, que es el dato clínico.
      const { rows } = await pool.query(
        `select i.id, i.alimento_id, i.nombre_alimento, i.cantidad_g, i.cantidad,
                i.unidad_id, u.nombre as unidad_nombre,
                i.kcal, i.proteina_g, i.cho_g, i.grasa_g,
                to_char(i.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
           from registro_comida_item i
           left join alimento_unidad u on u.id = i.unidad_id
          where i.registro_comida_id = $1 and i.activo = true
          order by i.created_at, i.id`,
        [registroId],
      )

      return reply.send(
        rows.map((f) => ({
          id: f['id'],
          alimentoId: f['alimento_id'],
          nombre: f['nombre_alimento'],
          cantidadG: num(f['cantidad_g']),
          cantidad: num(f['cantidad']),
          unidadId: f['unidad_id'],
          unidadNombre: f['unidad_nombre'],
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

      /*
       * Dos formas de decir cuánto se comió — R52.
       *
       * La pantalla nueva manda `unidadId` + `cantidad` («1.5 tazas»),
       * que es como la gente mide. La anterior manda `cantidadG`. Se
       * admiten las dos: un alimento escrito a mano no tiene unidades
       * que elegir, y las filas de antes de R52 se siguen editando.
       *
       * Los gramos se calculan en el servidor a partir de la unidad del
       * catálogo, nunca se aceptan del cliente junto con la unidad: si
       * no, los gramos y la etiqueta podrían decir cosas distintas y
       * ninguna pantalla sabría cuál vale.
       */
      const unidadId = b['unidadId']
      const usaUnidad = unidadId !== undefined && unidadId !== null && unidadId !== ''

      let cantidadUnidades: number | null = null
      if (usaUnidad) {
        if (typeof unidadId !== 'string' || !esUuid(unidadId)) {
          return reply
            .code(400)
            .send({ error: 'validacion', message: 'La unidad indicada no es válida' })
        }
        const n = Number(b['cantidad'])
        // 0.25 es el mínimo del selector de la pantalla (un cuarto de
        // porción); por debajo de eso el redondeo a un decimal de las
        // columnas se come la diferencia.
        if (!Number.isFinite(n) || n < 0.25 || n > 100) {
          return reply
            .code(400)
            .send({ error: 'validacion', message: 'Indica una cantidad entre 0.25 y 100' })
        }
        cantidadUnidades = Math.round(n * 100) / 100
      }

      const alimentoId = b['alimentoId']
      const tieneAlimento = alimentoId !== undefined && alimentoId !== null && alimentoId !== ''

      if (usaUnidad && !tieneAlimento) {
        return reply.code(400).send({
          error: 'validacion',
          message: 'Una unidad de medida solo se puede usar con un alimento del catálogo',
        })
      }

      // En gramos (o ml, según el alimento). Es lo que se guarda y con
      // lo que se calculan las kcal, igual que antes de R52.
      let cantidad: number
      if (!usaUnidad) {
        const g = Number(b['cantidadG'])
        if (!Number.isFinite(g) || g <= 0 || g > 5000) {
          return reply
            .code(400)
            .send({ error: 'validacion', message: 'Indica una cantidad entre 1 y 5000' })
        }
        cantidad = g
      } else {
        cantidad = 0 // se fija al resolver la unidad contra el alimento
      }

      let nombre: string
      let kcal: number | null = null
      let prot: number | null = null
      let cho: number | null = null
      let grasa: number | null = null

      if (tieneAlimento) {
        if (typeof alimentoId !== 'string' || !esUuid(alimentoId)) {
          return reply
            .code(400)
            .send({ error: 'validacion', message: 'El alimento indicado no es válido' })
        }

        // Se relee el alimento del servidor en vez de fiarse de las
        // cifras que manda el cliente: si no, cualquiera podría apuntar
        // una pizza con 0 kcal y el diario dejaría de valer.
        //
        // La unidad entra por LEFT JOIN y con `u.alimento_id = a.id` en
        // la condición: así una unidad existente pero de OTRO alimento
        // llega como null y se rechaza. Sin esa comparación se podría
        // apuntar pechuga de pollo medida en «1 taza de arroz».
        const { rows } = await pool.query(
          `select a.nombre, a.kcal_por_100g, a.proteina_por_100g, a.cho_por_100g,
                  a.grasa_por_100g,
                  u.id as unidad_id, u.gramos_equivalentes
             from alimento_catalogo a
             left join alimento_unidad u
                    on u.id = $3::uuid and u.alimento_id = a.id and u.activo = true
            where a.id = $1 and a.activo = true
              and (a.clinica_id is null or a.clinica_id = $2)`,
          [alimentoId, pac.clinica_id, usaUnidad ? unidadId : null],
        )
        const a = rows[0]
        if (!a) {
          return reply
            .code(404)
            .send({ error: 'no_encontrado', message: 'Ese alimento ya no está disponible' })
        }

        if (usaUnidad) {
          if (!a['unidad_id']) {
            return reply
              .code(404)
              .send({ error: 'no_encontrada', message: 'Esa medida ya no está disponible' })
          }
          cantidad = r1(Number(a['gramos_equivalentes']) * (cantidadUnidades as number))
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
              cantidad_g, kcal, proteina_g, cho_g, grasa_g,
              unidad_id, cantidad)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
            usaUnidad ? (unidadId as string) : null,
            cantidadUnidades,
          ],
        )

        await cliente.query('commit')

        // Se devuelve también la etiqueta de la unidad para que la lista
        // pueda pintar «1.5 tazas» sin volver a pedir el alimento.
        let unidadNombre: string | null = null
        if (usaUnidad) {
          const { rows: u } = await pool.query<{ nombre: string }>(
            `select nombre from alimento_unidad where id = $1`,
            [unidadId as string],
          )
          unidadNombre = u[0]?.nombre ?? null
        }

        return reply.code(201).send({
          registroId,
          id: rows[0]!.id,
          nombre,
          cantidadG: cantidad,
          cantidad: cantidadUnidades,
          unidadId: usaUnidad ? (unidadId as string) : null,
          unidadNombre,
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
