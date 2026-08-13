/**
 * Arranque de la API de NutriSmart.
 *
 * Rebanada 1 (walking skeleton): /health + /api/me + /api/pacientes.
 */
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { createRequire } from 'node:module'
import { config } from './config.js'
import { pingDb, closeDb } from './db.js'
import { registerAuth } from './auth.js'
import { registerMeRoutes } from './routes/me.js'
import { registerPacientesRoutes } from './routes/pacientes.js'
import { registerExpedienteRoutes } from './routes/expediente.js'

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

    registerAuth(app)

    await registerMeRoutes(app)
    await registerPacientesRoutes(app)
    await registerExpedienteRoutes(app)

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
      await closeDb()
      process.exit(0)
    })()
  })
}

void start()
