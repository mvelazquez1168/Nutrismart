/**
 * Biblioteca de recursos — PAC-08.
 *
 * El profesional escribe material educativo y el paciente lo lee desde
 * su aplicación. Es contenido de la CLÍNICA, no de cada paciente: se
 * publica una vez y lo ve todo el que pertenece a ella.
 *
 * Quién puede escribir: cualquier profesional activo de la clínica.
 * Quién puede editar: el autor y el administrador de la clínica. Un
 * nutricionista no reescribe el material de otro — lleva su firma.
 *
 * Retirar un recurso lo despublica o lo archiva, nunca lo borra. Si un
 * paciente lo leyó, esa lectura tiene que seguir apuntando a algo.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth, requireAuthPaciente } from '../auth.js'
import { esUuid } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'
import { almacen } from '../almacen/index.js'
import { cabeceraDescarga } from '../almacen/descarga.js'

const CATEGORIAS = ['nutricion', 'ejercicio', 'habitos', 'recetas', 'otro'] as const
type Categoria = (typeof CATEGORIAS)[number]

/**
 * Qué es un recurso (BIB-01).
 *
 * `texto`   — escrito a mano en la aplicación. Lo de la Rebanada 24.
 * `enlace`  — apunta fuera. Solo https.
 * `archivo` — un PDF o una imagen subidos, en la tabla `archivo`.
 */
const TIPOS = ['texto', 'enlace', 'archivo'] as const
type Tipo = (typeof TIPOS)[number]

const MAX_CONTENIDO = 20000
const POR_PAGINA = 20

const FECHA_UTC = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`

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

function noEncontrado() {
  return { error: 'no_encontrado', message: 'No se encontró el recurso' }
}

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}

function categoriaValida(v: unknown): v is Categoria {
  return typeof v === 'string' && (CATEGORIAS as readonly string[]).includes(v)
}

export async function registerRecursosRoutes(app: FastifyInstance): Promise<void> {
  /* ================================================================ */
  /* Lado del paciente                                                 */
  /* ================================================================ */

  app.get<{ Querystring: { categoria?: string; pagina?: string } }>(
    '/api/paciente/recursos',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const cat = categoriaValida(request.query.categoria) ? request.query.categoria : null
      const pagina = Math.max(1, Number(request.query.pagina) || 1)

      // El paciente solo ve lo publicado y activo de SU clínica. El
      // contenido no viaja en la lista: son artículos largos y la lista
      // solo necesita de qué van.
      const { rows } = await pool.query(
        `select r.id, r.titulo, r.resumen, r.categoria,
                r.tipo::text as tipo, r.imagen_portada_url, r.url_externa,
                (r.archivo_id is not null) as tiene_archivo,
                to_char(r.publicado_en at time zone 'UTC', ${FECHA_UTC}) as publicado_en,
                p.nombre as autor,
                (l.recurso_id is not null) as leido,
                count(*) over () :: text as total
           from recurso r
           join profesional p on p.id = r.profesional_id
           left join recurso_lectura l
                  on l.recurso_id = r.id and l.paciente_id = $1
          where r.clinica_id = $2 and r.publicado = true and r.activo = true
            and ($3::text is null or r.categoria = $3)
          order by r.publicado_en desc
          limit $4 offset $5`,
        [pac.id, pac.clinica_id, cat, POR_PAGINA, (pagina - 1) * POR_PAGINA],
      )

      const total = rows[0] ? Number(rows[0]['total']) : 0

      return reply.send({
        pagina,
        total,
        hayMas: pagina * POR_PAGINA < total,
        recursos: rows.map((f) => ({
          id: f['id'],
          titulo: f['titulo'],
          resumen: f['resumen'],
          categoria: f['categoria'],
          tipo: f['tipo'],
          imagenPortadaUrl: f['imagen_portada_url'],
          urlExterna: f['url_externa'],
          tieneArchivo: f['tiene_archivo'] === true,
          autor: f['autor'],
          publicadoEn: f['publicado_en'],
          leido: f['leido'] === true,
        })),
      })
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/paciente/recursos/:id',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontrado())

      const { rows } = await pool.query(
        `select r.id, r.titulo, r.resumen, r.contenido, r.categoria,
                r.tipo::text as tipo, r.imagen_portada_url, r.url_externa,
                r.archivo_id, a.nombre_original, a.mime, a.tamano_bytes,
                to_char(r.publicado_en at time zone 'UTC', ${FECHA_UTC}) as publicado_en,
                p.nombre as autor
           from recurso r
           join profesional p on p.id = r.profesional_id
           left join archivo a on a.id = r.archivo_id
          where r.id = $1 and r.clinica_id = $2 and r.publicado = true and r.activo = true`,
        [id, pac.clinica_id],
      )
      const r = rows[0]
      if (!r) return reply.code(404).send(noEncontrado())

      // Abrirlo lo marca como leído. Es lo que significa "leído" aquí:
      // no hay forma de saber si llegó al final, y pedirle al paciente
      // que pulse un botón para confirmarlo solo añade un paso que casi
      // nadie da.
      //
      // `do nothing`: se guarda la PRIMERA lectura. Reabrirlo un mes
      // después no debe hacer parecer que es material recién visto.
      await pool.query(
        `insert into recurso_lectura (recurso_id, paciente_id, clinica_id)
         values ($1, $2, $3)
         on conflict (recurso_id, paciente_id) do nothing`,
        [id, pac.id, pac.clinica_id],
      )

      return reply.send({
        id: r['id'],
        titulo: r['titulo'],
        resumen: r['resumen'],
        contenido: r['contenido'],
        categoria: r['categoria'],
        tipo: r['tipo'],
        imagenPortadaUrl: r['imagen_portada_url'],
        urlExterna: r['url_externa'],
        archivo:
          r['archivo_id'] === null
            ? null
            : {
                nombre: r['nombre_original'],
                mime: r['mime'],
                tamanoBytes: Number(r['tamano_bytes']),
              },
        autor: r['autor'],
        publicadoEn: r['publicado_en'],
      })
    },
  )

  /**
   * Descarga del archivo de un recurso, para el PACIENTE.
   *
   * No vale `/api/archivos/:id`: esa ruta es de profesionales y resuelve
   * el alcance por `profesional`. Aquí la pregunta es otra — ¿este
   * archivo cuelga de un recurso PUBLICADO de la clínica de este
   * paciente?— y se responde en la propia consulta, uniendo por
   * `recurso`. Así un id de archivo suelto no abre nada: tiene que estar
   * publicado y ser de su clínica.
   *
   * El encargo resolvía esto con una URL prefirmada de S3, válida cinco
   * minutos. Aquí el archivo pasa por la API, que además de evitar un
   * segundo sistema de almacenamiento tiene una ventaja: cada descarga
   * vuelve a comprobar el permiso. Una URL prefirmada, una vez emitida,
   * la abre cualquiera que la reciba — y estos son documentos de salud.
   */
  app.get<{ Params: { id: string } }>(
    '/api/paciente/recursos/:id/archivo',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontrado())

      const { rows } = await pool.query<{
        nombre_original: string
        mime: string
        ruta_relativa: string
      }>(
        `select a.nombre_original, a.mime, a.ruta_relativa
           from recurso r
           join archivo a on a.id = r.archivo_id
          where r.id = $1 and r.clinica_id = $2
            and r.publicado = true and r.activo = true`,
        [id, pac.clinica_id],
      )
      const a = rows[0]
      if (!a) return reply.code(404).send(noEncontrado())

      const contenido = await almacen.leer(a.ruta_relativa)

      return reply
        .header('Content-Type', a.mime)
        // Descarga, nunca interpretación. Mismas cabeceras que la ruta
        // profesional de la R5, y por el mismo motivo.
        .header('Content-Disposition', cabeceraDescarga(a.nombre_original))
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, no-store')
        .send(contenido)
    },
  )

  /* ================================================================ */
  /* Lado del profesional                                              */
  /* ================================================================ */

  app.get<{ Querystring: { categoria?: string; publicado?: string } }>(
    '/api/recursos',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const cat = categoriaValida(request.query.categoria) ? request.query.categoria : null
      const pub =
        request.query.publicado === 'true'
          ? true
          : request.query.publicado === 'false'
            ? false
            : null

      // Todo el material de la clínica, borradores incluidos. Los
      // borradores de un compañero se ven pero no se editan: saber qué
      // se está preparando evita escribir dos veces lo mismo.
      const { rows } = await pool.query(
        `select r.id, r.titulo, r.resumen, r.categoria, r.publicado,
                r.tipo::text as tipo, r.imagen_portada_url, r.url_externa,
                (r.archivo_id is not null) as tiene_archivo,
                to_char(r.publicado_en at time zone 'UTC', ${FECHA_UTC}) as publicado_en,
                to_char(r.updated_at   at time zone 'UTC', ${FECHA_UTC}) as updated_at,
                r.profesional_id, p.nombre as autor,
                (select count(*) from recurso_lectura l where l.recurso_id = r.id)::text as lecturas
           from recurso r
           join profesional p on p.id = r.profesional_id
          where r.clinica_id = $1 and r.activo = true
            and ($2::text is null or r.categoria = $2)
            and ($3::boolean is null or r.publicado = $3)
          order by r.updated_at desc
          limit 200`,
        [tenantId, cat, pub],
      )

      return reply.send(
        rows.map((f) => ({
          id: f['id'],
          titulo: f['titulo'],
          resumen: f['resumen'],
          categoria: f['categoria'],
          tipo: f['tipo'],
          imagenPortadaUrl: f['imagen_portada_url'],
          urlExterna: f['url_externa'],
          tieneArchivo: f['tiene_archivo'] === true,
          publicado: f['publicado'],
          publicadoEn: f['publicado_en'],
          actualizadoEn: f['updated_at'],
          autor: f['autor'],
          mio: f['profesional_id'] === alcance.profesionalId,
          puedeEditar: f['profesional_id'] === alcance.profesionalId || alcance.esAdmin,
          lecturas: Number(f['lecturas']),
        })),
      )
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/recursos/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontrado())

      const { rows } = await pool.query(
        `select r.id, r.titulo, r.resumen, r.contenido, r.categoria, r.publicado,
                r.tipo::text as tipo, r.imagen_portada_url, r.url_externa,
                r.archivo_id, a.nombre_original, a.mime, a.tamano_bytes,
                to_char(r.publicado_en at time zone 'UTC', ${FECHA_UTC}) as publicado_en,
                r.profesional_id, p.nombre as autor,
                (select count(*) from recurso_lectura l where l.recurso_id = r.id)::text as lecturas
           from recurso r
           join profesional p on p.id = r.profesional_id
           left join archivo a on a.id = r.archivo_id
          where r.id = $1 and r.clinica_id = $2 and r.activo = true`,
        [id, tenantId],
      )
      const r = rows[0]
      if (!r) return reply.code(404).send(noEncontrado())

      return reply.send({
        id: r['id'],
        titulo: r['titulo'],
        resumen: r['resumen'],
        contenido: r['contenido'],
        categoria: r['categoria'],
        tipo: r['tipo'],
        imagenPortadaUrl: r['imagen_portada_url'],
        urlExterna: r['url_externa'],
        archivo:
          r['archivo_id'] === null
            ? null
            : {
                id: r['archivo_id'],
                nombre: r['nombre_original'],
                mime: r['mime'],
                tamanoBytes: Number(r['tamano_bytes']),
              },
        publicado: r['publicado'],
        publicadoEn: r['publicado_en'],
        autor: r['autor'],
        puedeEditar: r['profesional_id'] === alcance.profesionalId || alcance.esAdmin,
        lecturas: Number(r['lecturas']),
      })
    },
  )

  interface Campos {
    titulo?: string
    resumen?: string | null
    contenido?: string | null
    categoria?: Categoria
    tipo?: Tipo
    imagen_portada_url?: string | null
    url_externa?: string | null
    archivo_id?: string | null
  }

  /** Solo https, y con tope. Mismo criterio que la foto de perfil (R25). */
  function urlHttps(v: unknown, max: number): string | null | undefined {
    if (v === null || v === '') return null
    if (typeof v !== 'string' || v.length > max) return undefined
    let u: URL
    try {
      u = new URL(v.trim())
    } catch {
      return undefined
    }
    return u.protocol === 'https:' ? u.toString() : undefined
  }

  /** Valida el cuerpo común de crear y editar. */
  function leerCuerpo(
    b: Record<string, unknown>,
    parcial: boolean,
  ): { error?: string; valor?: Campos } {
    const out: Campos = {}

    if (!parcial || b['titulo'] !== undefined) {
      const t = typeof b['titulo'] === 'string' ? b['titulo'].trim() : ''
      if (t === '' || t.length > 200) return { error: 'Escribe un título (hasta 200 caracteres)' }
      out.titulo = t
    }

    // El tipo manda sobre lo demás: decide qué campo es obligatorio y
    // cuáles tienen que ir vacíos. Sin eso cabría un recurso de tipo
    // 'archivo' sin archivo — un botón de descarga que no descarga.
    const tipo = b['tipo']
    if (tipo !== undefined) {
      if (typeof tipo !== 'string' || !(TIPOS as readonly string[]).includes(tipo)) {
        return { error: 'Elige un tipo válido: texto, enlace o archivo' }
      }
      out.tipo = tipo as Tipo
    }
    const tipoEfectivo = out.tipo ?? (parcial ? undefined : 'texto')

    if (tipoEfectivo === 'texto' || (tipoEfectivo === undefined && b['contenido'] !== undefined)) {
      const c = typeof b['contenido'] === 'string' ? b['contenido'].trim() : ''
      if (c === '' || c.length > MAX_CONTENIDO) {
        return { error: `Escribe el contenido (hasta ${MAX_CONTENIDO} caracteres)` }
      }
      out.contenido = c
    }

    if (tipoEfectivo === 'enlace') {
      const u = urlHttps(b['urlExterna'], 1000)
      if (u === undefined || u === null) {
        return { error: 'Escribe la dirección del enlace; tiene que empezar por https://' }
      }
      out.url_externa = u
      out.archivo_id = null
      out.contenido = null
    }

    if (tipoEfectivo === 'archivo') {
      const a = b['archivoId']
      if (typeof a !== 'string' || !esUuid(a)) {
        return { error: 'Sube un archivo antes de guardar' }
      }
      out.archivo_id = a
      out.url_externa = null
      out.contenido = null
    }

    if (tipoEfectivo === 'texto') {
      out.url_externa = null
      out.archivo_id = null
    }

    if (b['imagenPortadaUrl'] !== undefined) {
      const u = urlHttps(b['imagenPortadaUrl'], 500)
      if (u === undefined) {
        return { error: 'La imagen de portada debe ser una dirección https://' }
      }
      out.imagen_portada_url = u
    }

    if (b['resumen'] !== undefined) {
      const s = typeof b['resumen'] === 'string' ? b['resumen'].trim() : ''
      if (s.length > 500) return { error: 'El resumen no puede pasar de 500 caracteres' }
      out.resumen = s === '' ? null : s
    }

    if (!parcial || b['categoria'] !== undefined) {
      if (!categoriaValida(b['categoria'])) return { error: 'Elige una categoría válida' }
      out.categoria = b['categoria']
    }

    return { valor: out }
  }

  app.post<{ Body: Record<string, unknown> }>(
    '/api/recursos',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const p = leerCuerpo(request.body ?? {}, false)
      if (p.error) return reply.code(400).send({ error: 'validacion', message: p.error })
      const v = p.valor!

      // Nace como borrador. Publicar es un acto aparte y deliberado:
      // que un artículo a medio escribir aparezca en la aplicación de
      // todos los pacientes por haber pulsado guardar sería difícil de
      // deshacer, porque ya lo habrían visto.
      const { rows } = await pool.query<{ id: string }>(
        `insert into recurso (clinica_id, profesional_id, titulo, resumen, contenido, categoria,
                              tipo, imagen_portada_url, url_externa, archivo_id)
         values ($1, $2, $3, $4, $5, $6, $7::recurso_tipo, $8, $9, $10)
         returning id`,
        [
          tenantId,
          alcance.profesionalId,
          v.titulo,
          v.resumen ?? null,
          v.contenido ?? null,
          v.categoria,
          v.tipo ?? 'texto',
          v.imagen_portada_url ?? null,
          v.url_externa ?? null,
          v.archivo_id ?? null,
        ],
      )

      return reply.code(201).send({ id: rows[0]!.id, publicado: false })
    },
  )

  /**
   * ¿Puede este profesional tocar este recurso?
   *
   * Devuelve el estado actual si sí; `null` si no existe en la clínica.
   * La diferencia entre "no existe" y "no es tuyo" se responde con el
   * mismo 404 hacia fuera cuando es de otra clínica, y con un 403
   * explicativo cuando es de un compañero: dentro de la misma clínica el
   * recurso sí existe y ocultarlo confundiría más que ayudar.
   */
  async function paraEditar(id: string, tenantId: string, alcance: { profesionalId: string; esAdmin: boolean }) {
    const { rows } = await pool.query<{ profesional_id: string; publicado: boolean }>(
      `select profesional_id, publicado from recurso
        where id = $1 and clinica_id = $2 and activo = true`,
      [id, tenantId],
    )
    const r = rows[0]
    if (!r) return { estado: 404 as const }
    if (r.profesional_id !== alcance.profesionalId && !alcance.esAdmin) {
      return { estado: 403 as const }
    }
    return { estado: 200 as const, recurso: r }
  }

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/recursos/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontrado())

      const permiso = await paraEditar(id, tenantId, alcance)
      if (permiso.estado === 404) return reply.code(404).send(noEncontrado())
      if (permiso.estado === 403) {
        return reply.code(403).send({
          error: 'no_es_tuyo',
          message: 'Este material lo escribió otro profesional. Solo su autor puede editarlo.',
        })
      }

      const p = leerCuerpo(request.body ?? {}, true)
      if (p.error) return reply.code(400).send({ error: 'validacion', message: p.error })
      const v = p.valor!

      const campos: string[] = []
      const args: unknown[] = [id, tenantId]
      for (const [col, val, cast] of [
        ['titulo', v.titulo, ''],
        ['resumen', v.resumen, ''],
        ['contenido', v.contenido, ''],
        ['categoria', v.categoria, ''],
        ['tipo', v.tipo, '::recurso_tipo'],
        ['imagen_portada_url', v.imagen_portada_url, ''],
        ['url_externa', v.url_externa, ''],
        ['archivo_id', v.archivo_id, '::uuid'],
      ] as const) {
        if (val !== undefined) {
          args.push(val)
          campos.push(`${col} = $${args.length}${cast}`)
        }
      }
      if (campos.length === 0) {
        return reply.code(400).send({ error: 'validacion', message: 'No hay nada que cambiar' })
      }

      await pool.query(
        `update recurso set ${campos.join(', ')} where id = $1 and clinica_id = $2`,
        args,
      )

      return reply.send({ ok: true })
    },
  )

  /**
   * Publicar y despublicar en la misma ruta.
   *
   * Es un interruptor, no dos operaciones: separarlo en `/publicar` y
   * `/despublicar` duplica la comprobación de permiso en dos sitios que
   * con el tiempo se separan.
   */
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/recursos/:id/publicacion',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontrado())

      const publicado = request.body?.['publicado']
      if (typeof publicado !== 'boolean') {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Indica si se publica o se retira' })
      }

      const permiso = await paraEditar(id, tenantId, alcance)
      if (permiso.estado === 404) return reply.code(404).send(noEncontrado())
      if (permiso.estado === 403) {
        return reply.code(403).send({
          error: 'no_es_tuyo',
          message: 'Este material lo escribió otro profesional. Solo su autor puede retirarlo.',
        })
      }

      // Al despublicar se conserva `publicado_en`: es cuándo estuvo
      // disponible, no un campo de estado. Y al volver a publicar se
      // respeta la fecha original si ya la había — republicar no
      // convierte material de enero en novedad de agosto.
      const { rows } = await pool.query<{ publicado_en: string | null }>(
        `update recurso
            set publicado = $3,
                publicado_en = case when $3 then coalesce(publicado_en, now()) else publicado_en end
          where id = $1 and clinica_id = $2
          returning to_char(publicado_en at time zone 'UTC', ${FECHA_UTC}) as publicado_en`,
        [id, tenantId, publicado],
      )

      return reply.send({ publicado, publicadoEn: rows[0]?.publicado_en ?? null })
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/recursos/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontrado())

      const permiso = await paraEditar(id, tenantId, alcance)
      if (permiso.estado === 404) return reply.code(404).send(noEncontrado())
      if (permiso.estado === 403) {
        return reply.code(403).send({
          error: 'no_es_tuyo',
          message: 'Este material lo escribió otro profesional. Solo su autor puede archivarlo.',
        })
      }

      // Archivar, nunca borrar: si un paciente lo leyó, esa lectura
      // tiene que seguir apuntando a algo. Se despublica a la vez,
      // porque archivado y visible es una contradicción.
      await pool.query(
        `update recurso set activo = false, publicado = false where id = $1 and clinica_id = $2`,
        [id, tenantId],
      )

      return reply.send({ ok: true })
    },
  )
}
