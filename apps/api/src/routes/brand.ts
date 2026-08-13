/**
 * Configuración de marca por clínica (CLI-06, white-label).
 *
 * Dos particularidades frente al resto de la API:
 *
 *  1. La LECTURA es pública. El logo y el nombre se pintan en la
 *     pantalla de acceso, antes de que exista un token, y un <img> no
 *     puede enviar la cabecera Authorization. Por eso la clínica viaja
 *     como ?clinica=<uuid>. Lo que se expone es identidad visual —lo
 *     mismo que hay en el membrete de la clínica—, nunca dato clínico.
 *
 *  2. El logo se sirve INLINE, al revés que los archivos clínicos, que
 *     salen siempre como descarga. Es la excepción que obliga a ser
 *     estricto con el tipo: ver `detectarImagen`.
 *
 * La escritura sigue la regla de siempre: token válido, acotado por
 * clínica, y aquí además solo admin_clinica.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { esUuid } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'
import { almacen } from '../almacen/index.js'

/**
 * Valores por defecto. Son los del design system (tokens.css), no unos
 * inventados aquí: si difirieran, activar esta rebanada cambiaría el
 * aspecto de todas las clínicas que nunca configuraron nada.
 */
const DEFAULTS = {
  nombreApp: 'NutriSmart',
  colorPrimario: '#0E7C66',
  colorAcento: '#0EA5E9',
} as const

const MAX_LOGO_BYTES = 512 * 1024

const HEX_RE = /^#[0-9a-fA-F]{6}$/

interface BrandRow {
  nombre_app: string
  logo_ruta: string | null
  logo_mime: string | null
  color_primario: string
  color_acento: string
  updated_at: Date
}

interface BrandRespuesta {
  nombreApp: string
  /** Ruta que el navegador puede pedir, o null. Nunca la ruta interna. */
  logoUrl: string | null
  colorPrimario: string
  colorAcento: string
  tieneLogo: boolean
  /**
   * Marca de tiempo del último cambio. El frontend la cuelga del <img>
   * como ?v= para que un logo nuevo se vea al instante en vez de
   * esperar a que caduque la caché del navegador.
   */
  version: string
}

/**
 * Tipos admitidos para el logo.
 *
 * SVG queda FUERA, aunque sea el formato natural de un logotipo y el
 * navegador lo escale sin perder nitidez. Un SVG admite <script>
 * embebido, y este endpoint sirve el contenido inline desde nuestro
 * propio origen: aceptarlo sería XSS almacenado, ejecutándose con la
 * sesión del profesional ya abierta. Es la misma razón por la que
 * almacen/deteccion.ts lo excluye para los archivos clínicos.
 *
 * Si más adelante se quiere SVG, la vía es sanearlo al subirlo o
 * servirlo desde un origen distinto; no relajar esta lista.
 */
const EXTENSION_LOGO: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
}

function empieza(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false
  return bytes.every((b, i) => buffer[i] === b)
}

/**
 * Detecta el tipo por CONTENIDO. Ni el nombre ni el Content-Type que
 * envía el cliente son evidencia de nada: los controla quien sube.
 */
function detectarImagen(buffer: Buffer): string | null {
  if (empieza(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (empieza(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg'

  // WebP es un contenedor RIFF: 'RIFF' + 4 bytes de tamaño + 'WEBP'.
  // Comprobar solo 'RIFF' aceptaría también WAV y AVI.
  if (
    empieza(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    buffer.length >= 12 &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }

  return null
}

/** La clínica de una petición pública: solo desde ?clinica=<uuid>. */
function clinicaDeQuery(request: FastifyRequest): string | null {
  const q = (request.query as Record<string, unknown>)?.['clinica']
  if (typeof q !== 'string' || !esUuid(q)) return null
  return q
}

const SELECT_BRAND = `
  select nombre_app, logo_ruta, logo_mime, color_primario, color_acento, updated_at
    from brand_config
   where clinica_id = $1
`

function aRespuesta(row: BrandRow | undefined, clinicaId: string): BrandRespuesta {
  const tieneLogo = !!row?.logo_ruta
  return {
    nombreApp: row?.nombre_app ?? DEFAULTS.nombreApp,
    logoUrl: tieneLogo ? `/api/brand/logo?clinica=${clinicaId}` : null,
    colorPrimario: row?.color_primario ?? DEFAULTS.colorPrimario,
    colorAcento: row?.color_acento ?? DEFAULTS.colorAcento,
    tieneLogo,
    // Sin fila, la versión es fija: no hay nada que invalidar.
    version: row ? row.updated_at.toISOString() : 'defaults',
  }
}

/**
 * Exige un admin_clinica ACTIVO en esta clínica.
 *
 * No basta con mirar el rol del token: resolverAlcance comprueba
 * además que exista el profesional y no esté inactivo, que es la
 * misma puerta que usa el resto de la API.
 */
async function exigirAdmin(
  request: FastifyRequest,
): Promise<{ ok: true; clinicaId: string } | { ok: false; code: 403; cuerpo: unknown }> {
  const { tenantId, sub, roles } = request.auth
  const alcance = await resolverAlcance(tenantId, sub, roles)

  if (!alcance) {
    return {
      ok: false,
      code: 403,
      cuerpo: {
        error: 'profesional_no_encontrado',
        message: 'Tu usuario no tiene un profesional asociado en esta clínica',
      },
    }
  }
  if (!alcance.esAdmin) {
    return {
      ok: false,
      code: 403,
      cuerpo: {
        error: 'solo_admin_clinica',
        message: 'Solo un administrador de la clínica puede cambiar la identidad visual',
      },
    }
  }
  return { ok: true, clinicaId: tenantId }
}

export async function registerBrandRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* GET /api/brand?clinica=<uuid>  — público                          */
  /* ---------------------------------------------------------------- */
  app.get('/api/brand', async (request, reply) => {
    const clinicaId = clinicaDeQuery(request)

    // Sin clínica identificable se responden los defaults en vez de un
    // 400: quien pinta la pantalla de acceso todavía no sabe a qué
    // clínica pertenece el visitante, y un error ahí dejaría la app sin
    // tema en lugar de con el genérico.
    if (!clinicaId) {
      return reply.send({
        ...DEFAULTS,
        logoUrl: null,
        tieneLogo: false,
        version: 'defaults',
      } satisfies BrandRespuesta)
    }

    const { rows } = await pool.query<BrandRow>(SELECT_BRAND, [clinicaId])
    return reply.send(aRespuesta(rows[0], clinicaId))
  })

  /* ---------------------------------------------------------------- */
  /* GET /api/brand/logo?clinica=<uuid>  — público, INLINE             */
  /* ---------------------------------------------------------------- */
  app.get('/api/brand/logo', async (request, reply) => {
    const noEncontrado = { error: 'logo_no_configurado', message: 'Esta clínica no tiene logo' }

    const clinicaId = clinicaDeQuery(request)
    if (!clinicaId) return reply.code(404).send(noEncontrado)

    const { rows } = await pool.query<BrandRow>(SELECT_BRAND, [clinicaId])
    const row = rows[0]
    if (!row?.logo_ruta || !row.logo_mime) return reply.code(404).send(noEncontrado)

    let contenido: Buffer
    try {
      contenido = await almacen.leer(row.logo_ruta)
    } catch {
      // La fila apunta a un archivo que ya no está. Para el cliente es
      // indistinguible de no tener logo; el detalle queda en el log.
      request.log.warn({ clinicaId }, 'brand: la fila apunta a un logo inexistente')
      return reply.code(404).send(noEncontrado)
    }

    return (
      reply
        // El tipo es el DETECTADO al subir, no uno declarado por nadie.
        .header('Content-Type', row.logo_mime)
        // Sin esto el navegador puede adivinar el tipo e ignorar el que
        // enviamos, que es justo lo que la lista blanca evita.
        .header('X-Content-Type-Options', 'nosniff')
        // Es identidad pública, no dato clínico: la caché compartida
        // está bien. El ETag hace que un logo nuevo se detecte aunque
        // el max-age no haya vencido.
        .header('Cache-Control', 'public, max-age=300')
        .header('ETag', `"${row.updated_at.getTime()}"`)
        .send(contenido)
    )
  })

  /* ---------------------------------------------------------------- */
  /* PUT /api/brand  — solo admin_clinica                              */
  /* ---------------------------------------------------------------- */
  app.put('/api/brand', { preHandler: requireAuth }, async (request, reply) => {
    const permiso = await exigirAdmin(request)
    if (!permiso.ok) return reply.code(permiso.code).send(permiso.cuerpo)

    const body = (request.body ?? {}) as {
      nombreApp?: unknown
      colorPrimario?: unknown
      colorAcento?: unknown
    }

    const errores: { campo: string; mensaje: string }[] = []

    let nombreApp: string | null = null
    if (body.nombreApp !== undefined) {
      const valor = typeof body.nombreApp === 'string' ? body.nombreApp.trim() : ''
      if (valor.length === 0 || valor.length > 80) {
        errores.push({ campo: 'nombreApp', mensaje: 'Debe tener entre 1 y 80 caracteres' })
      } else {
        nombreApp = valor
      }
    }

    // Se normaliza a minúsculas para que #FFF000 y #fff000 no se
    // guarden como configuraciones distintas.
    function hex(campo: 'colorPrimario' | 'colorAcento'): string | null {
      const valor = body[campo]
      if (valor === undefined) return null
      if (typeof valor !== 'string' || !HEX_RE.test(valor)) {
        errores.push({ campo, mensaje: 'Debe ser un color #rrggbb' })
        return null
      }
      return valor.toLowerCase()
    }

    const colorPrimario = hex('colorPrimario')
    const colorAcento = hex('colorAcento')

    if (errores.length > 0) {
      return reply.code(400).send({
        error: 'validacion',
        message: 'Revisa los datos de la identidad visual',
        errores,
      })
    }

    // COALESCE por columna: un PUT que solo trae el color no borra el
    // nombre. En el INSERT el COALESCE cae al default de la tabla.
    const { rows } = await pool.query<BrandRow>(
      `insert into brand_config (clinica_id, nombre_app, color_primario, color_acento)
            values ($1, coalesce($2, $5), coalesce($3, $6), coalesce($4, $7))
       on conflict (clinica_id) do update
          set nombre_app     = coalesce($2, brand_config.nombre_app),
              color_primario = coalesce($3, brand_config.color_primario),
              color_acento   = coalesce($4, brand_config.color_acento)
        returning nombre_app, logo_ruta, logo_mime, color_primario, color_acento, updated_at`,
      [
        permiso.clinicaId,
        nombreApp,
        colorPrimario,
        colorAcento,
        DEFAULTS.nombreApp,
        DEFAULTS.colorPrimario,
        DEFAULTS.colorAcento,
      ],
    )

    return reply.send(aRespuesta(rows[0], permiso.clinicaId))
  })

  /* ---------------------------------------------------------------- */
  /* PUT /api/brand/logo  — solo admin_clinica                         */
  /* ---------------------------------------------------------------- */
  app.put('/api/brand/logo', { preHandler: requireAuth }, async (request, reply) => {
    const permiso = await exigirAdmin(request)
    if (!permiso.ok) return reply.code(permiso.code).send(permiso.cuerpo)

    if (!request.isMultipart()) {
      return reply.code(415).send({
        error: 'no_multipart',
        message: 'El logo debe enviarse como multipart/form-data',
      })
    }

    // El límite del logo (512 KB) es más estricto que el global de
    // subidas (10 MB) y se aplica DURANTE la lectura: la petición se
    // aborta al superarlo en vez de cargar el archivo entero para
    // luego rechazarlo.
    const parte = await request.file({ limits: { fileSize: MAX_LOGO_BYTES } })
    if (!parte) {
      return reply.code(400).send({ error: 'sin_archivo', message: 'No se recibió ningún archivo' })
    }

    let contenido: Buffer
    try {
      contenido = await parte.toBuffer()
    } catch (error) {
      if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({
          error: 'logo_demasiado_grande',
          message: `El logo supera el máximo de ${MAX_LOGO_BYTES / 1024} KB`,
        })
      }
      throw error
    }

    const mime = detectarImagen(contenido)
    if (!mime) {
      return reply.code(415).send({
        error: 'tipo_no_permitido',
        message:
          'El logo debe ser PNG, JPEG o WebP. SVG no se admite porque puede contener código ejecutable.',
        declarado: parte.mimetype,
      })
    }

    // Se lee la ruta anterior ANTES de escribir la nueva: si se borrara
    // después de actualizar la fila sin haberla leído, el archivo viejo
    // quedaría huérfano en disco para siempre.
    const previo = await pool.query<{ logo_ruta: string | null }>(
      'select logo_ruta from brand_config where clinica_id = $1',
      [permiso.clinicaId],
    )
    const rutaAnterior = previo.rows[0]?.logo_ruta ?? null

    const guardado = await almacen.guardar(permiso.clinicaId, contenido, mime)

    let rows: BrandRow[]
    try {
      const res = await pool.query<BrandRow>(
        `insert into brand_config (clinica_id, logo_ruta, logo_mime)
              values ($1, $2, $3)
         on conflict (clinica_id) do update
            set logo_ruta = $2, logo_mime = $3
          returning nombre_app, logo_ruta, logo_mime, color_primario, color_acento, updated_at`,
        [permiso.clinicaId, guardado.rutaRelativa, mime],
      )
      rows = res.rows
    } catch (error) {
      // El binario ya está en disco pero la fila no entró: sin esto
      // quedaría un archivo que nadie sabe borrar.
      await almacen.eliminar(guardado.rutaRelativa)
      throw error
    }

    // Solo cuando la fila ya apunta al nuevo. Si fallara aquí, lo peor
    // es un archivo huérfano; al revés, el logo dejaría de verse.
    if (rutaAnterior && rutaAnterior !== guardado.rutaRelativa) {
      await almacen.eliminar(rutaAnterior).catch(() => {})
    }

    return reply.send(aRespuesta(rows[0], permiso.clinicaId))
  })

  /* ---------------------------------------------------------------- */
  /* DELETE /api/brand/logo  — solo admin_clinica                      */
  /* ---------------------------------------------------------------- */
  app.delete('/api/brand/logo', { preHandler: requireAuth }, async (request, reply) => {
    const permiso = await exigirAdmin(request)
    if (!permiso.ok) return reply.code(permiso.code).send(permiso.cuerpo)

    // Se lee la ruta antes de anularla: un subselect dentro de
    // RETURNING tiene semántica sutil sobre qué versión de la fila ve.
    const previo = await pool.query<{ logo_ruta: string | null }>(
      'select logo_ruta from brand_config where clinica_id = $1',
      [permiso.clinicaId],
    )
    const ruta = previo.rows[0]?.logo_ruta ?? null

    if (ruta) {
      await pool.query(
        'update brand_config set logo_ruta = null, logo_mime = null where clinica_id = $1',
        [permiso.clinicaId],
      )
      // Primero la fila, luego el disco: si esto falla queda un
      // archivo huérfano, que es mucho menos grave que una fila
      // apuntando a un archivo que ya no existe.
      await almacen.eliminar(ruta).catch(() => {})
    }

    // 204 tanto si había logo como si no: borrar algo que ya no está
    // no es un error, y el estado final es el que pidió el cliente.
    return reply.code(204).send()
  })
}
