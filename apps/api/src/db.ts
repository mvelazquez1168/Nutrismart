/**
 * Pool de conexiones a Postgres.
 *
 * Regla del proyecto: toda query de datos de negocio se acota por
 * clinica_id (tenant). Este modulo solo expone el pool y utilidades
 * genericas; el filtrado por tenant vive en la capa de repositorio,
 * donde el tenant es un parametro OBLIGATORIO, no opcional.
 */
import pg from 'pg'
import { config } from './config.js'

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  // Un dev local no necesita mas; evita agotar conexiones del Postgres
  // compartido con otros proyectos en la misma maquina.
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

/**
 * Comprueba que la base responde de verdad. Devuelve la latencia en ms.
 * Lanza si no hay conexion: quien llama decide como reportarlo.
 */
export async function pingDb(): Promise<{ latencyMs: number }> {
  const started = process.hrtime.bigint()
  const result = await pool.query<{ ok: number }>('select 1 as ok')
  const latencyMs = Number(process.hrtime.bigint() - started) / 1_000_000

  if (result.rows[0]?.ok !== 1) {
    throw new Error('Postgres respondio, pero "select 1" no devolvio 1')
  }
  return { latencyMs: Math.round(latencyMs * 100) / 100 }
}

export async function closeDb(): Promise<void> {
  await pool.end()
}
