/**
 * Arranque de la API de NutriSmart.
 *
 * Rebanada 1 (walking skeleton): /health + /api/me + /api/pacientes.
 */
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { createRequire } from 'node:module'
import { TAMANO_MAXIMO_BYTES } from './almacen/deteccion.js'
import { config } from './config.js'
import { pingDb, closeDb } from './db.js'
import { registerAuth } from './auth.js'
import { registerMeRoutes } from './routes/me.js'
import { registerPacientesRoutes } from './routes/pacientes.js'
import { registerExpedienteRoutes } from './routes/expediente.js'
import { registerAgendaRoutes } from './routes/agenda.js'
import { registerArchivosRoutes } from './routes/archivos.js'
import { registerLaboratoriosRoutes } from './routes/laboratorios.js'
import { registerBrandRoutes } from './routes/brand.js'
import { registerSociodemograficoRoutes } from './routes/sociodemografico.js'
import { registerAdminRoutes } from './routes/admin.js'
import { registerPlanesRoutes } from './routes/planes.js'
import { registerPdfRoutes } from './routes/pdf.js'
import { registerMensajeriaRoutes } from './routes/mensajeria.js'
import { registerNotificacionesRoutes } from './routes/notificaciones.js'
import { registerConsultasRoutes } from './routes/consultas.js'
import { registerAntropometriaRoutes } from './routes/antropometria.js'
import { registerBioquimicaRoutes } from './routes/bioquimica.js'
import { registerHistorialRoutes } from './routes/historial.js'
import { registerDieteticoRoutes } from './routes/dietetico.js'
import { registerRegistroDieteticoRoutes } from './routes/registroDietetico.js'
import { registerConclusionRoutes } from './routes/conclusion.js'
import { registerConsultaDetalleRoutes } from './routes/consulta-detalle.js'
import { registerSeguimientoRoutes } from './routes/seguimiento.js'
import { registerIaRoutes } from './routes/ia.js'
import { registerInvitacionRoutes } from './routes/invitacion.js'
import { registerPacienteRoutes } from './routes/paciente.js'
import { registerPacienteMensajeriaRoutes } from './routes/paciente-mensajeria.js'
import { registerPacienteRegistrosRoutes } from './routes/paciente-registros.js'
import { registerPacienteProgresoRoutes } from './routes/paciente-progreso.js'
import { registerAlimentosRoutes } from './routes/alimentos.js'
import { registerRecursosRoutes } from './routes/recursos.js'
import { registerBienestarRoutes } from './routes/bienestar.js'
import { registerRpmRoutes } from './routes/rpm.js'
import { registerAlertasRoutes } from './routes/alertas.js'
import { registerEquipoRoutes } from './routes/equipo.js'
import { registerEstadisticasRoutes } from './routes/estadisticas.js'
import { registerWearablesRoutes } from './routes/wearables.js'
import { registerSuperAdminRoutes } from './routes/superadmin.js'
import { evaluarAlertas } from './rpm/evaluar-alertas.js'
import { enviarAlertasPendientes } from './rpm/email-alerta.js'
import cron from 'node-cron'
import { correoConfigurado, procesarRecordatorios } from './agenda/recordatorios.js'
import { cerrarNavegador } from './pdf/generar.js'

/**
 * pino-pretty es una devDependency: en la imagen de produccion no
 * existe. Se comprueba que se pueda resolver ANTES de pedirlo, porque
 * Fastify lanza al arrancar si el transporte no esta — y un logger
 * bonito no puede ser motivo de que la API no levante.
 *
 * Pasa en cuanto NODE_ENV llega como 'development' dentro del
 * contenedor (el env_file del compose pisa el ENV de la imagen).
 */
function transporteLegible(): Record<string, unknown> {
  if (!config.isDev) return {}
  try {
    createRequire(import.meta.url).resolve('pino-pretty')
    return { transport: { target: 'pino-pretty' } }
  } catch {
    return {}
  }
}

const app = Fastify({
  logger: {
    level: config.isDev ? 'info' : 'warn',
    ...transporteLegible(),
  },
})

/**
 * Health real: consulta la base. Un /health que devuelve {ok:true} sin
 * tocar Postgres miente justo cuando mas importa.
 *
 * Va sin auth a proposito: sirve para diagnosticar, y exigir un token
 * lo volveria inutil cuando lo que falla es precisamente la auth.
 */
app.get('/health', async (_request, reply) => {
  try {
    const { latencyMs } = await pingDb()
    return { status: 'ok', db: { status: 'up', latencyMs } }
  } catch (error) {
    app.log.error({ err: error }, 'health: la base no responde')
    reply.code(503)
    return {
      status: 'degraded',
      db: { status: 'down', error: (error as Error).message },
    }
  }
})

async function start(): Promise<void> {
  try {
    // registerAuth declara la propiedad `auth` en el request y tiene que
    // correr sobre la instancia raiz ANTES de registrar cualquier ruta
    // que la use; si no, el decorador no existe cuando llega la peticion.
    // Lista CERRADA de origenes, no '*'. Esta API responde datos
    // clinicos con cabecera Authorization; abrirla a cualquier origen
    // permitiria a otra pagina leer expedientes con el token del usuario.
    //
    // Son dos porque son dos aplicaciones: la profesional en 5173 y la
    // del paciente en 5175. Con un solo origen, la del paciente recibe
    // un fallo de red en cada peticion.
    await app.register(cors, {
      origin: [config.frontendProUrl, config.frontendPacUrl],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type'],
    })

    // El límite se aplica DURANTE la lectura: la petición se aborta al
    // superarlo, en vez de cargar cientos de megas en memoria para
    // luego rechazarlos. `files: 1` evita que una sola petición suba
    // cien archivos y esquive el límite por acumulación.
    await app.register(multipart, {
      limits: { fileSize: TAMANO_MAXIMO_BYTES, files: 1, fields: 10 },
    })

    /**
     * Formularios codificados en la URL.
     *
     * Solo lo usa el webhook de Withings, que POSTea
     * `application/x-www-form-urlencoded`. Fastify no trae ese parser y
     * sin el la peticion falla con 415 antes de llegar a la ruta.
     *
     * Se resuelve con seis lineas en vez de anadir @fastify/formbody:
     * ninguna otra ruta del proyecto usa ese tipo de contenido.
     */
    app.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_req, cuerpo, hecho) => {
        try {
          hecho(null, Object.fromEntries(new URLSearchParams(cuerpo as string)))
        } catch (e) {
          hecho(e as Error, undefined)
        }
      },
    )

    registerAuth(app)

    await registerMeRoutes(app)
    await registerPacientesRoutes(app)
    await registerExpedienteRoutes(app)
    await registerAgendaRoutes(app)
    await registerArchivosRoutes(app)
    await registerLaboratoriosRoutes(app)
    // Las lecturas de marca van SIN requireAuth a proposito: la
    // pantalla de acceso las necesita antes de que exista un token.
    // Aqui no hay hook global de auth —cada ruta declara el suyo— asi
    // que basta con no ponerlo; no hay que reordenar nada.
    await registerBrandRoutes(app)
    await registerSociodemograficoRoutes(app)
    await registerAdminRoutes(app)
    await registerPlanesRoutes(app)
    await registerPdfRoutes(app)
    await registerMensajeriaRoutes(app)
    await registerNotificacionesRoutes(app)
    await registerConsultasRoutes(app)
    await registerAntropometriaRoutes(app)
    await registerBioquimicaRoutes(app)
    await registerHistorialRoutes(app)
    await registerDieteticoRoutes(app)
    await registerRegistroDieteticoRoutes(app)
    await registerConclusionRoutes(app)
    await registerConsultaDetalleRoutes(app)
    await registerSeguimientoRoutes(app)
    await registerIaRoutes(app)
    await registerInvitacionRoutes(app)
    await registerPacienteRoutes(app)
    await registerPacienteMensajeriaRoutes(app)
    await registerPacienteRegistrosRoutes(app)
    await registerPacienteProgresoRoutes(app)
    await registerAlimentosRoutes(app)
    await registerRecursosRoutes(app)
    await registerBienestarRoutes(app)
    await registerRpmRoutes(app)
    await registerAlertasRoutes(app)
    await registerEquipoRoutes(app)
    await registerEstadisticasRoutes(app)
    await registerWearablesRoutes(app)
    await registerSuperAdminRoutes(app)

    // ---- Recordatorios de cita (AGE-03) ----
    //
    // Vive dentro del proceso de la API. Con una sola instancia basta, y
    // si algun dia hay varias el duplicado no llega al paciente: cada
    // aviso se reserva en `recordatorio_cita` antes de enviarse y el
    // indice unico deja pasar solo a uno.
    //
    // Cada 15 minutos. La ventana de 1 hora es de 55 a 65 minutos, asi
    // que ningun aviso se escapa entre dos ciclos.
    cron.schedule('*/15 * * * *', () => {
      void procesarRecordatorios()
    })
    app.log.info(
      { correo: correoConfigurado() ? 'resend' : 'consola' },
      'recordatorios de cita: cada 15 minutos',
    )

    // Si la IA no esta configurada, TODOS sus botones responden 503 y hasta
    // ahora no habia donde verlo: `config.iaHabilitada` se calculaba y no se
    // usaba en ningun sitio. Un "Analizar IA" que no hace nada se diagnostica
    // en un minuto con esta linea y en media hora sin ella (R46).
    if (config.iaHabilitada) {
      app.log.info({ modelo: config.anthropicModelo }, 'IA: configurada')
    } else {
      app.log.warn(
        'IA: SIN CONFIGURAR (falta ANTHROPIC_API_KEY). El analisis dietetico, la ' +
          'interpretacion de laboratorios y la nota SOAP responderan 503. El acceso ' +
          'clinico no se ve afectado.',
      )
    }

    // Alertas: una vez al dia, a las 7 de la manana en Costa Rica. El
    // contenedor corre en UTC, asi que son las 13:00 UTC.
    //
    // A esa hora porque lo que se mira son datos del dia anterior y el
    // profesional lo lee al empezar la consulta. Correr cada hora no
    // aportaria nada: el paciente no se pesa doce veces al dia, y una
    // alerta que aparece a las 3 de la madrugada nadie la ve antes.
    cron.schedule('0 13 * * *', () => {
      void (async () => {
        try {
          const r = await evaluarAlertas()
          app.log.info(r, 'alertas evaluadas')
          if (r.abiertas > 0) {
            const n = await enviarAlertasPendientes()
            app.log.info({ enviados: n }, 'avisos de alerta enviados')
          }
        } catch (err) {
          app.log.error({ err }, 'fallo evaluando alertas')
        }
      })()
    })
    app.log.info('alertas de seguimiento: cada dia a las 07:00 (Costa Rica)')

    // host 0.0.0.0: dentro de Docker, escuchar solo en localhost dejaria
    // el puerto publicado inalcanzable desde fuera del contenedor.
    await app.listen({ port: config.apiPort, host: '0.0.0.0' })
  } catch (error) {
    app.log.error({ err: error }, 'no se pudo levantar la API')
    process.exit(1)
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      app.log.info(`${signal} recibido, cerrando`)
      await app.close()
      // Chromium se reutiliza entre exportaciones: sin esto queda un
      // proceso huérfano cada vez que se reinicia la API.
      await cerrarNavegador()
      await closeDb()
      process.exit(0)
    })()
  })
}

void start()
