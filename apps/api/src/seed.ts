/**
 * Seed de DESARROLLO.
 *
 * Ejecuta apps/api/seed/dev_seed.sql sustituyendo los marcadores
 * ${VARIABLE} por valores del entorno. Hoy solo se usa uno:
 * ${DEV_KEYCLOAK_SUB}, que rellena profesional.keycloak_user_id con el
 * 'sub' real del usuario del realm de Keycloak.
 *
 * Por que un marcador y no el valor incrustado en el .sql: Keycloak 26
 * genera el id del usuario y no acepta uno fijado, asi que el 'sub'
 * cambia cada vez que se recrea el realm. Con el marcador, ese valor
 * vive en un unico sitio (el .env) y el SQL no se toca.
 *
 * Uso:  npm run seed -w @nutrismart/api
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { config } from './config.js'
import { pool, closeDb } from './db.js'

const here = dirname(fileURLToPath(import.meta.url))
const SEED_FILE = resolve(here, '../seed/dev_seed.sql')

/** Marcadores soportados. Anadir aqui si el seed necesita mas. */
function buildSubstitutions(): Record<string, string> {
  const subs: Record<string, string> = {}

  if (config.devKeycloakSub) {
    subs['DEV_KEYCLOAK_SUB'] = config.devKeycloakSub
  }
  if (config.devKeycloakSubNutri) {
    subs['DEV_KEYCLOAK_SUB_NUTRI'] = config.devKeycloakSubNutri
  }
  return subs
}

function substitute(sql: string, subs: Record<string, string>): string {
  let out = sql
  for (const [clave, valor] of Object.entries(subs)) {
    out = out.split(`\${${clave}}`).join(valor)
  }
  return out
}

/**
 * Comprueba que no quedo ningun ${…} sin sustituir. Sin esto, el literal
 * "${DEV_KEYCLOAK_SUB}" se insertaria como texto en keycloak_user_id y
 * /api/me devolveria 404 sin ninguna pista del motivo.
 */
function assertSinMarcadores(sql: string): void {
  const restantes = [...sql.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1])
  const unicos = [...new Set(restantes)]

  if (unicos.length > 0) {
    throw new Error(
      `El seed tiene marcadores sin sustituir: ${unicos.map((u) => `\${${u}}`).join(', ')}\n` +
        `Define esa(s) variable(s) en el .env de la raiz del repo.`,
    )
  }
}

async function main(): Promise<void> {
  if (config.nodeEnv === 'production') {
    throw new Error('El seed de desarrollo no debe correr con NODE_ENV=production.')
  }

  const plantilla = await readFile(SEED_FILE, 'utf8')
  const sql = substitute(plantilla, buildSubstitutions())
  assertSinMarcadores(sql)

  console.log(`Seed: ${SEED_FILE}`)
  console.log(`  keycloak_user_id -> ${config.devKeycloakSub}`)

  // Todo el seed en una transaccion: o entra completo o no entra nada.
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(sql)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }

  const { rows } = await pool.query<{
    clinicas: string
    profesionales: string
    pacientes: string
  }>(`
    select
      (select count(*) from clinica)     as clinicas,
      (select count(*) from profesional) as profesionales,
      (select count(*) from paciente)    as pacientes
  `)

  const r = rows[0]
  if (r) {
    console.log(
      `Listo. clinicas=${r.clinicas} profesionales=${r.profesionales} pacientes=${r.pacientes}`,
    )
  }
}

main()
  .then(async () => {
    await closeDb()
    process.exit(0)
  })
  .catch(async (error: unknown) => {
    console.error('\nFallo el seed:\n', error instanceof Error ? error.message : error)
    await closeDb()
    process.exit(1)
  })
