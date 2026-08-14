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
import { registerConclusionRoutes } from './routes/conclusion.js'
import { registerSeguimientoRoutes } from './routes/seguimiento.js'
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
    // Origen unico y explicito, no '*'. Esta API responde datos clinicos
    // con cabecera Authorization; abrirla a cualquier origen permitiria a
    // otra pagina leer expedientes con el token del usuario.
    await app.register(cors, {
      origin: config.frontendProUrl,
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
    await registerConclusionRoutes(app)
    await registerSeguimientoRoutes(app)

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
