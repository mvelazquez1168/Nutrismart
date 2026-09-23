/**
 * Conectar una pulsera o un reloj — RPM-01.
 *
 * ── El `state` de OAuth ─────────────────────────────────────────────
 *
 * La vuelta del proveedor llega como una navegación del navegador, sin
 * cabecera `Authorization`. Lo único que dice de quién es esa vuelta es
 * el parámetro `state`.
 *
 * El encargo lo resolvía con `base64(pacienteId)`. Base64 no es cifrado:
 * cualquiera puede leerlo y, sobre todo, **fabricarlo**. Con eso, alguien
 * construye la URL de callback con el identificador de otro paciente y su
 * propio código de Fitbit, y deja su cuenta de salud enganchada al
 * expediente de esa persona — el nutricionista vería los pasos y el pulso
 * de un desconocido creyendo que son de su paciente.
 *
 * Aquí el `state` son 32 bytes aleatorios guardados en
 * `wearable_oauth_estado`, de un solo uso y con diez minutos de vida.
 */
import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { pool } from '../db.js'
import { requireAuthPaciente } from '../auth.js'
import { config } from '../config.js'
import { cifrar } from '../wearables/cifrado.js'
import {
  canjearCodigo,
  leerDia,
  medidasWithings,
  tokenVigente,
  ErrorProveedor,
} from '../wearables/cliente.js'
import {
  DEFINICION,
  ES_PROVEEDOR,
  ETIQUETA,
  PROVEEDORES,
  QUE_TRAE,
  credenciales,
  loQueFalta,
  urlCallback,
  type Proveedor,
} from '../wearables/proveedores.js'

const ZONA = 'America/Costa_Rica'

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

/** Días hacia atrás que se piden al conectar y en cada sincronización. */
const DIAS_ATRAS = 7

export async function registerWearablesRoutes(app: FastifyInstance): Promise<void> {
  /* ================================================================ */
  /* Estado de las conexiones                                          */
  /* ================================================================ */

  app.get(
    '/api/paciente/wearables',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const { rows } = await pool.query(
        `select proveedor, activo, ultimo_error,
                to_char(ultimo_sync at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as ultimo_sync,
                (select count(*) from registro_metrica m
                  where m.paciente_id = c.paciente_id and m.fuente = c.proveedor and m.activo)::int
                  as lecturas
           from conexion_wearable c
          where c.paciente_id = $1`,
        [pac.id],
      )

      const porProveedor = new Map(rows.map((r) => [r['proveedor'] as string, r]))

      return reply.send(
        PROVEEDORES.map((p) => {
          const c = porProveedor.get(p)
          const falta = loQueFalta(p)
          return {
            proveedor: p,
            etiqueta: ETIQUETA[p],
            // Con tres proveedores en pantalla, el nombre no basta para
            // elegir: una bascula y una pulsera no traen lo mismo.
            queTrae: QUE_TRAE[p],
            // Que la pantalla sepa distinguir «no lo has conectado» de
            // «este servidor no lo ofrece»: son cosas muy distintas para
            // quien mira.
            disponible: falta === null,
            motivoNoDisponible: falta,
            conectado: c?.['activo'] === true,
            ultimoSync: c?.['ultimo_sync'] ?? null,
            ultimoError: c?.['ultimo_error'] ?? null,
            lecturas: c ? Number(c['lecturas']) : 0,
          }
        }),
      )
    },
  )

  /* ================================================================ */
  /* Conectar                                                          */
  /* ================================================================ */

  app.post<{ Params: { proveedor: string } }>(
    '/api/paciente/wearables/:proveedor/conectar',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const p = request.params.proveedor
      if (!ES_PROVEEDOR(p)) {
        return reply.code(404).send({ error: 'no_encontrado', message: 'Ese proveedor no existe' })
      }

      const falta = loQueFalta(p)
      if (falta) {
        // 503 y no 500: no es un fallo, es que la pieza no está puesta.
        return reply.code(503).send({ error: 'no_configurado', message: falta })
      }

      const estado = randomBytes(32).toString('hex')

      // Se reemplaza cualquier intento anterior del mismo paciente y
      // proveedor: pulsar el botón dos veces no debe dejar dos vivos.
      await pool.query(
        `delete from wearable_oauth_estado
          where paciente_id = $1 and proveedor = $2 or expira_en < now()`,
        [pac.id, p],
      )
      await pool.query(
        `insert into wearable_oauth_estado (estado, clinica_id, paciente_id, proveedor)
         values ($1, $2, $3, $4)`,
        [estado, pac.clinica_id, pac.id, p],
      )

      const url = new URL(DEFINICION[p].urlAutorizacion)
      url.searchParams.set('client_id', credenciales(p)!.clientId)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', DEFINICION[p].scope)
      url.searchParams.set('redirect_uri', urlCallback(p))
      url.searchParams.set('state', estado)
      if (p === 'google_fit') {
        // Sin esto Google no entrega refresh_token en la segunda
        // autorización, y la conexión moriría en cuanto caduque.
        url.searchParams.set('access_type', 'offline')
        url.searchParams.set('prompt', 'consent')
      }

      return reply.send({ url: url.toString() })
    },
  )

  /* ================================================================ */
  /* Vuelta del proveedor                                              */
  /* ================================================================ */

  /**
   * NO lleva `requireAuthPaciente` a propósito: es una navegación del
   * navegador desde el proveedor y no trae token. Quién es se resuelve
   * por el `state`, que es aleatorio y de un solo uso.
   */
  app.get<{
    Params: { proveedor: string }
    Querystring: { code?: string; state?: string; error?: string }
  }>('/api/paciente/wearables/:proveedor/callback', async (request, reply) => {
    const p = request.params.proveedor
    const { code, state, error } = request.query

    const volver = (resultado: string) =>
      reply.redirect(
        `${config.wearables.urlPublica ?? ''}/dispositivos?resultado=${encodeURIComponent(resultado)}`,
      )

    if (!ES_PROVEEDOR(p)) return volver('proveedor_desconocido')
    // El usuario pudo cancelar en la pantalla del proveedor.
    if (error || !code || !state) return volver('cancelado')

    // Un solo uso: se borra al leerlo. Si dos peticiones llegan a la vez
    // con el mismo `state`, solo una encuentra fila.
    const { rows } = await pool.query<{
      clinica_id: string
      paciente_id: string
      proveedor: Proveedor
    }>(
      `delete from wearable_oauth_estado
        where estado = $1 and proveedor = $2 and expira_en > now()
        returning clinica_id, paciente_id, proveedor`,
      [state, p],
    )
    const st = rows[0]
    if (!st) return volver('enlace_caducado')

    try {
      const datos = await canjearCodigo(p, code)

      await pool.query(
        `insert into conexion_wearable
           (clinica_id, paciente_id, proveedor, access_token, refresh_token,
            token_expira_en, scope, activo, ultimo_error, usuario_externo)
         values ($1, $2, $3, $4, $5,
                 case when $6::int is null then null
                      else now() + make_interval(secs => $6::int) end,
                 $7, true, null, $8)
         on conflict (paciente_id, proveedor) do update
           set access_token = excluded.access_token,
               refresh_token = coalesce(excluded.refresh_token, conexion_wearable.refresh_token),
               token_expira_en = excluded.token_expira_en,
               scope = excluded.scope,
               activo = true,
               ultimo_error = null,
               usuario_externo = coalesce(excluded.usuario_externo, conexion_wearable.usuario_externo)`,
        [
          st.clinica_id,
          st.paciente_id,
          p,
          cifrar(datos.access_token),
          datos.refresh_token ? cifrar(datos.refresh_token) : null,
          datos.expires_in ?? null,
          datos.scope ?? DEFINICION[p].scope,
          // Solo Withings lo trae. Es lo que permite saber de quién es
          // cada aviso de su webhook.
          datos.userid !== undefined ? String(datos.userid) : null,
        ],
      )

      // Primera sincronización en el momento: si no, el paciente conecta
      // y ve una pantalla vacía sin saber si funcionó.
      void sincronizar(st.paciente_id).catch(() => {
        /* el estado de la conexión ya recoge el fallo */
      })

      return volver('conectado')
    } catch (e) {
      request.log.warn({ err: e, proveedor: p }, 'wearables: fallo al canjear el codigo')
      return volver('fallo')
    }
  })

  /* ================================================================ */
  /* Webhook de Withings                                               */
  /* ================================================================ */

  /**
   * Aviso de que un usuario tiene datos nuevos — RPM-02.
   *
   * ── El modelo de confianza ──────────────────────────────────────
   *
   * Esta ruta es PÚBLICA: la llama Withings desde internet, sin token.
   * Cualquiera puede POSTear aquí.
   *
   * Por eso **no se cree nada de lo que trae el cuerpo**. El aviso solo
   * dice «el usuario X puede tener datos nuevos»; los datos los pedimos
   * NOSOTROS a la API de Withings con NUESTRO token guardado. Alguien
   * que falsifique un aviso no puede inyectar un peso inventado en el
   * expediente de nadie: lo más que consigue es que preguntemos a
   * Withings por un usuario que ya estaba conectado.
   *
   * El encargo lo resolvía verificando una firma con
   * `WITHINGS_WEBHOOK_SECRET`. Pero el mecanismo de firma de Withings es
   * para las llamadas que uno le hace a ÉL, no para las notificaciones
   * que él envía: no hay firma que comprobar aquí. Confiar en una
   * comprobación que no existe es peor que no tenerla, porque invita a
   * fiarse del contenido.
   *
   * Contra el abuso queda el freno de abajo: un aviso no dispara una
   * sincronización si acaba de haber una.
   */
  app.post<{ Body: Record<string, string> }>(
    '/api/wearables/webhook/withings',
    async (request, reply) => {
      const usuario = String(request.body?.['userid'] ?? '').trim()

      // Siempre 200, incluso si no se reconoce el usuario. Un 404 aquí
      // le confirmaría a quien sondee qué identificadores existen en la
      // plataforma; y Withings, ante un error, reintenta y acaba dando
      // de baja la suscripción.
      if (!/^\d{1,20}$/.test(usuario)) return reply.send({ ok: true })

      const { rows } = await pool.query<{ id: string; paciente_id: string }>(
        `select id, paciente_id from conexion_wearable
          where proveedor = 'withings' and usuario_externo = $1 and activo = true
            -- Freno: si ya se sincronizó hace menos de un minuto, este
            -- aviso no vuelve a disparar nada. Withings manda uno por
            -- cada medida y una pesada genera cinco o seis.
            and (ultimo_sync is null or ultimo_sync < now() - interval '1 minute')`,
        [usuario],
      )
      const cx = rows[0]
      if (!cx) return reply.send({ ok: true })

      // Se responde YA y se sincroniza después: Withings espera una
      // respuesta rápida y da por fallido lo que tarde.
      void sincronizar(cx.paciente_id, 'withings').catch(() => {
        /* el estado de la conexión ya recoge el fallo */
      })

      return reply.send({ ok: true })
    },
  )

  /**
   * Withings comprueba la URL con un HEAD antes de aceptar la
   * suscripción. Sin esto la rechaza y no llega ningún aviso nunca.
   */
  app.head('/api/wearables/webhook/withings', async (_request, reply) => reply.send())

  /* ================================================================ */
  /* Sincronizar y desconectar                                         */
  /* ================================================================ */

  app.post<{ Params: { proveedor: string } }>(
    '/api/paciente/wearables/:proveedor/sincronizar',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }
      const p = request.params.proveedor
      if (!ES_PROVEEDOR(p)) {
        return reply.code(404).send({ error: 'no_encontrado', message: 'Ese proveedor no existe' })
      }

      const r = await sincronizar(pac.id, p)
      if (r.error) {
        return reply.code(502).send({ error: 'fallo_proveedor', message: r.error })
      }
      return reply.send({ nuevas: r.nuevas, dias: DIAS_ATRAS })
    },
  )

  app.delete<{ Params: { proveedor: string } }>(
    '/api/paciente/wearables/:proveedor',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }
      const p = request.params.proveedor
      if (!ES_PROVEEDOR(p)) {
        return reply.code(404).send({ error: 'no_encontrado', message: 'Ese proveedor no existe' })
      }

      // Se BORRA la conexión, no se archiva. Contiene un token que da
      // acceso a los datos de salud del paciente: si dice que
      // desconecta, lo que espera es que deje de existir.
      //
      // Las lecturas ya sincronizadas se conservan: son suyas y su
      // nutricionista puede haberlas comentado en consulta. Es lo mismo
      // que pasa al desvincular una cuenta y no borrar el expediente.
      const { rowCount } = await pool.query(
        `delete from conexion_wearable where paciente_id = $1 and proveedor = $2`,
        [pac.id, p],
      )
      if (rowCount === 0) {
        return reply.code(404).send({ error: 'no_encontrado', message: 'No estaba conectado' })
      }
      return reply.send({ ok: true })
    },
  )
}

/* ------------------------------------------------------------------ */
/* Sincronización                                                      */
/* ------------------------------------------------------------------ */

/**
 * Guarda una lectura. Devuelve `true` si era nueva.
 *
 * `medido_en` se fija al MEDIODÍA del día, no al instante de la
 * sincronización. Es lo que hace que repetir el proceso no duplique: el
 * índice único incluye `medido_en`, y si cambiara en cada pasada, cada
 * sincronización crearía filas nuevas.
 *
 * Mediodía y no medianoche porque son valores de un día entero:
 * colocarlos a las 00:00 los empuja al día anterior en cualquier gráfica
 * que agrupe por fecha local.
 *
 * Para Withings esto tiene una consecuencia deliberada: si alguien se
 * pesa dos veces el mismo día, se guarda **una sola** medida. Es lo
 * correcto — dos pesadas separadas por veinte minutos no son dos datos,
 * son la misma con ruido, y la segunda no sustituye a la primera porque
 * ninguna es más verdadera.
 */
async function guardar(
  clinicaId: string,
  pacienteId: string,
  l: { tipo: string; valor: number; unidad: string; dia: string },
  fuente: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `insert into registro_metrica
       (clinica_id, paciente_id, tipo, valor, unidad, medido_en, fuente)
     values ($1, $2, $3::tipo_metrica, $4, $5, ($6::date + time '12:00') at time zone $7, $8)
     on conflict do nothing`,
    [clinicaId, pacienteId, l.tipo, l.valor, l.unidad, l.dia, ZONA, fuente],
  )
  return (rowCount ?? 0) > 0
}

/**
 * Trae los últimos días de cada conexión activa del paciente.
 *
 * Se piden siete días y no solo el de hoy: los dispositivos sincronizan
 * cuando pueden, y un día que llegó tarde al servidor del proveedor se
 * habría perdido para siempre. Al ser idempotente, repetirlos no cuesta
 * nada.
 */
export async function sincronizar(
  pacienteId: string,
  soloProveedor?: Proveedor,
): Promise<{ nuevas: number; error: string | null }> {
  const { rows: conexiones } = await pool.query<{
    id: string
    clinica_id: string
    proveedor: Proveedor
  }>(
    `select id, clinica_id, proveedor from conexion_wearable
      where paciente_id = $1 and activo = true
        and ($2::text is null or proveedor = $2)`,
    [pacienteId, soloProveedor ?? null],
  )
  if (conexiones.length === 0) return { nuevas: 0, error: 'No hay ninguna conexión activa' }

  const { rows: hoyRows } = await pool.query<{ hoy: string }>(
    `select (now() at time zone $1)::date::text as hoy`,
    [ZONA],
  )
  const hoy = new Date(`${hoyRows[0]!.hoy}T12:00:00Z`)

  let nuevas = 0
  let error: string | null = null

  for (const cx of conexiones) {
    try {
      const token = await tokenVigente(cx.id)

      // Withings devuelve un rango entero en una sola llamada, con el
      // instante real de cada pesada. Pedirle día a día serían siete
      // peticiones para lo mismo.
      if (cx.proveedor === 'withings') {
        for (const l of await medidasWithings(token, DIAS_ATRAS)) {
          if (await guardar(cx.clinica_id, pacienteId, l, cx.proveedor)) nuevas++
        }
        await pool.query(
          `update conexion_wearable set ultimo_sync = now(), ultimo_error = null where id = $1`,
          [cx.id],
        )
        continue
      }

      for (let i = 0; i < DIAS_ATRAS; i++) {
        const d = new Date(hoy)
        d.setUTCDate(d.getUTCDate() - i)
        const dia = d.toISOString().slice(0, 10)

        for (const l of await leerDia(cx.proveedor, token, dia)) {
          if (await guardar(cx.clinica_id, pacienteId, l, cx.proveedor)) nuevas++
        }
      }

      await pool.query(
        `update conexion_wearable set ultimo_sync = now(), ultimo_error = null where id = $1`,
        [cx.id],
      )
    } catch (e) {
      error = e instanceof ErrorProveedor ? e.message : 'No se pudo sincronizar'
      // El motivo se guarda para que la pantalla pueda decirlo, en vez
      // de dejar una conexión que calla y no trae datos.
      await pool.query(`update conexion_wearable set ultimo_error = $2 where id = $1`, [
        cx.id,
        error.slice(0, 300),
      ])
    }
  }

  return { nuevas, error }
}
