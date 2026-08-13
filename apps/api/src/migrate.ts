/**
 * Runner de migraciones incremental.
 *
 * Reglas (docs/REBANADA-01.md):
 *  - Tabla de control `schema_migrations`: lo ya aplicado NO se reintenta.
 *  - Cada migracion corre en SU PROPIA transaccion: si la 002 falla, la
 *    001 queda aplicada y registrada, no se pierde el avance.
 *  - Se guarda un checksum del archivo. Si un .sql ya aplicado cambia,
 *    se aborta: significa que alguien edito historia en vez de anadir una
 *    migracion nueva, y la base de otro entorno ya no coincide.
 *
 * Uso:  npm run migrate -w @nutrismart/api
 */
import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { pool, closeDb } from './db.js'

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = resolve(here, '../migrations')

interface Migration {
  version: string
  filename: string
  sql: string
  checksum: string
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Lee los .sql y los ordena por nombre: 001_… antes que 002_… */
async function loadMigrations(): Promise<Migration[]> {
  const entries = await readdir(MIGRATIONS_DIR)
  const files = entries.filter((f) => f.endsWith('.sql')).sort()

  const migrations: Migration[] = []
  for (const filename of files) {
    // La version es el prefijo numerico: "001_base_multitenant.sql" -> "001"
    const version = filename.split('_')[0] ?? ''
    if (!/^\d+$/.test(version)) {
      throw new Error(
        `Migracion con nombre invalido: "${filename}". Debe empezar por un prefijo numerico, p.ej. 003_lo_que_sea.sql`,
      )
    }
    const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8')
    migrations.push({ version, filename, sql, checksum: sha256(sql) })
  }
  return migrations
}

async function ensureControlTable(): Promise<void> {
  await pool.query(`
    create table if not exists schema_migrations (
      version    text primary key,
      filename   text        not null,
      checksum   text        not null,
      applied_at timestamptz not null default now()
    )
  `)
}

async function appliedVersions(): Promise<Map<string, { checksum: string; filename: string }>> {
  const { rows } = await pool.query<{ version: string; checksum: string; filename: string }>(
    'select version, checksum, filename from schema_migrations',
  )
  return new Map(rows.map((r) => [r.version, { checksum: r.checksum, filename: r.filename }]))
}

async function applyOne(m: Migration): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(m.sql)
    await client.query(
      'insert into schema_migrations (version, filename, checksum) values ($1, $2, $3)',
      [m.version, m.filename, m.checksum],
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

async function main(): Promise<void> {
  const migrations = await loadMigrations()
  if (migrations.length === 0) {
    console.log('No hay migraciones en', MIGRATIONS_DIR)
    return
  }

  await ensureControlTable()
  const applied = await appliedVersions()

  console.log(`Migraciones encontradas: ${migrations.length} | ya aplicadas: ${applied.size}`)

  let aplicadas = 0
  for (const m of migrations) {
    const previa = applied.get(m.version)

    if (previa) {
      if (previa.checksum !== m.checksum) {
        throw new Error(
          `La migracion ${m.version} (${m.filename}) ya fue aplicada pero su contenido cambio.\n` +
            `  checksum registrado: ${previa.checksum}\n` +
            `  checksum actual:     ${m.checksum}\n` +
            `No se edita una migracion ya aplicada: crea una nueva que corrija lo que haga falta.`,
        )
      }
      console.log(`  = ${m.version} ${m.filename} (ya aplicada, se omite)`)
      continue
    }

    console.log(`  + ${m.version} ${m.filename} aplicando…`)
    await applyOne(m)
    aplicadas++
  }

  console.log(
    aplicadas === 0
      ? 'Nada que aplicar: la base ya esta al dia.'
      : `Listo: ${aplicadas} migracion(es) aplicada(s).`,
  )
}

main()
  .then(async () => {
    await closeDb()
    process.exit(0)
  })
  .catch(async (error: unknown) => {
    console.error('\nFallo la migracion:\n', error instanceof Error ? error.message : error)
    await closeDb()
    process.exit(1)
  })
