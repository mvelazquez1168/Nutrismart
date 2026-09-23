# r30-claudecode-prompt.md
# NutriSmart — Rebanada 30
# BIB-01: Biblioteca con imagen de portada y archivos reales (S3/MinIO)

## Contexto de continuidad

SaaS multi-tenant de nutrición clínica. Monorepo: `apps/api` (Fastify),
`apps/web-professional` (Vite + React, puerto 5173), `apps/web-patient` (Vite + React, puerto 5175).

**Columnas conocidas — no redescubrir:**
- `registro_metrica`: columna de fecha es `medido_en` (timestamptz), no `fecha`
- `paciente`: `correo` (no `email`), `nutricionista_id` (no `profesional_id`)
- `TIMESTAMPTZ` → JSON: valor crudo del driver `pg`. Nunca `to_char`.

**Reglas permanentes:**
1. Fastify únicamente. Nunca Express.
2. Multi-tenancy profesional: `request.auth.tenantId`. Paciente: `SELECT clinica_id FROM paciente WHERE keycloak_user_id = $1`.
3. Borrado suave: `activo = false`. Nunca DELETE físico.
4. SVG puro para gráficas. Cero librerías de charting externas.
5. CSS vars / tokens Tailwind. Nunca hex en línea en JSX.
6. URLs de imagen: validar `https://` únicamente. Rechazar `http://`, `data:`, `javascript:`.
7. Resend con `RESEND_API_KEY`; fallback `console.log` si no está definida.
8. `ORDER BY` en fechas que deciden primero/último: siempre añadir `id` como desempate.
9. Antes de crear cualquier migración: ejecutar `SELECT migration_name FROM schema_migrations ORDER BY migration_name DESC LIMIT 1`.

---

## Objetivo

La biblioteca de recursos educativos actualmente solo soporta enlaces externos.
Esta rebanada añade:
1. **Imagen de portada** (URL `https://`) por recurso — mejora la tasa de apertura.
2. **Archivos reales** (PDF, Word, imágenes) subidos al servidor, almacenados en S3/MinIO.
3. **Apertura segura** vía URL prefirmada (TTL 5 min) — S3 sirve el archivo directamente, sin pasar por la API.

Los recursos tipo `'enlace'` siguen funcionando igual que antes.

---

## Paso 0 — Verificación previa (obligatoria)

```sql
-- 1. Número de migración disponible
SELECT migration_name FROM schema_migrations ORDER BY migration_name DESC LIMIT 1;

-- 2. Schema real de recurso_educativo
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'recurso_educativo'
ORDER BY ordinal_position;

-- 3. ¿Existe ya algún tipo/enum relacionado con recurso?
SELECT typname FROM pg_type WHERE typname LIKE 'recurso%';
```

```bash
# 4. Verificar variables S3 disponibles
echo "S3_ENDPOINT=$S3_ENDPOINT"
echo "S3_BUCKET=$S3_BUCKET"
echo "S3_ACCESS_KEY=${S3_ACCESS_KEY:0:4}***"
```

Adapta la migración según los resultados. Si `tipo` ya existe como TEXT,
conviértela con `USING tipo::recurso_tipo` o añade columna nueva y migra datos.
Si alguna columna nueva ya existe, el `IF NOT EXISTS` la omite sin error.

---

## Infraestructura — MinIO (S3 compatible para desarrollo)

### docker-compose.yml — añadir dos servicios

```yaml
  minio:
    image: minio/minio:latest
    ports:
      - "9000:9000"   # API S3 — la API del servidor lo usa en localhost:9000
      - "9001:9001"   # Consola web — abrir http://localhost:9001
    environment:
      MINIO_ROOT_USER:     ${S3_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${S3_SECRET_KEY}
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 15s
      timeout: 10s
      retries: 5

  minio-init:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    environment:
      S3_ACCESS_KEY: ${S3_ACCESS_KEY}
      S3_SECRET_KEY: ${S3_SECRET_KEY}
      S3_BUCKET:     ${S3_BUCKET}
    entrypoint: >
      /bin/sh -c "
        mc alias set local http://minio:9000 $$S3_ACCESS_KEY $$S3_SECRET_KEY &&
        mc mb --ignore-existing local/$$S3_BUCKET &&
        echo 'Bucket listo' &&
        exit 0
      "
    restart: "no"
```

Añade `minio_data:` a la sección `volumes:` del docker-compose.

### Variables de entorno — apps/api/.env (añadir)

```
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=nutrismart-recursos
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin123
```

> **Nota importante**: `S3_ENDPOINT` apunta a `localhost:9000` (no a `minio:9000`)
> porque la API corre en el host, no dentro de Docker. Las URLs prefirmadas
> que genera la API usarán `localhost:9000`, que el navegador puede alcanzar.
> En producción, `S3_ENDPOINT` queda vacío (usa AWS S3) y se ponen credenciales reales.

---

## Dependencias

```bash
cd apps/api
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @fastify/multipart
```

---

## Migración — apps/api/migrations/0NN_bib_recursos_s3.sql

```sql
-- Enum de tipo de recurso (idempotente)
DO $$ BEGIN
  CREATE TYPE recurso_tipo AS ENUM ('enlace', 'archivo');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE recurso_educativo
  ADD COLUMN IF NOT EXISTS imagen_url    TEXT,
  ADD COLUMN IF NOT EXISTS tipo          recurso_tipo NOT NULL DEFAULT 'enlace',
  ADD COLUMN IF NOT EXISTS s3_key        TEXT,
  ADD COLUMN IF NOT EXISTS mime_type     TEXT,
  ADD COLUMN IF NOT EXISTS tamano_bytes  BIGINT;
```

---

## Backend

### apps/api/src/lib/s3.ts — cliente y helpers

```typescript
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand }
  from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID }   from 'crypto'

function makeClient(): S3Client {
  const endpoint = process.env.S3_ENDPOINT?.trim()
  return new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),  // forcePathStyle obligatorio en MinIO
    credentials: {
      accessKeyId:     process.env.S3_ACCESS_KEY ?? '',
      secretAccessKey: process.env.S3_SECRET_KEY ?? '',
    },
  })
}

const s3     = makeClient()
const BUCKET = () => process.env.S3_BUCKET ?? 'nutrismart-recursos'

/** Sube un archivo y devuelve el key S3. */
export async function subirArchivo(opts: {
  clinicaId:      string
  nombreOriginal: string
  mimeType:       string
  body:           Buffer
}): Promise<string> {
  const ext = opts.nombreOriginal.split('.').pop()?.toLowerCase() ?? 'bin'
  const key = `recursos/${opts.clinicaId}/${randomUUID()}.${ext}`
  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET(),
    Key:         key,
    Body:        opts.body,
    ContentType: opts.mimeType,
  }))
  return key
}

/** Genera una URL prefirmada de lectura (TTL: 5 minutos). */
export async function urlPrefirmada(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET(), Key: key })
  return getSignedUrl(s3, command, { expiresIn: 300 })
}

/** Elimina un objeto de S3 (llamar después del borrado suave en BD). */
export async function eliminarArchivo(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }))
}

/** MIME types permitidos para subida. */
export const MIME_PERMITIDOS = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
])

/** Tamaño máximo: 10 MB. */
export const MAX_BYTES = 10 * 1024 * 1024
```

### Registro de @fastify/multipart — apps/api/src/server.ts

Añade antes del registro de rutas:

```typescript
import multipart from '@fastify/multipart'
// ...
await fastify.register(multipart, { limits: { fileSize: MAX_BYTES } })
// MAX_BYTES importado de ./lib/s3
```

### apps/api/src/admin/recursos.ts

```typescript
import type { FastifyInstance } from 'fastify'
import { pool } from '../db'
import { subirArchivo, eliminarArchivo, MIME_PERMITIDOS, MAX_BYTES } from '../lib/s3'

export async function adminRecursosRoutes(fastify: FastifyInstance) {

  // GET /api/admin/recursos
  fastify.get('/api/admin/recursos', async (request) => {
    const { rows } = await pool.query(
      `SELECT id, titulo, descripcion, url, imagen_url,
              tipo, mime_type, tamano_bytes, activo, created_at
       FROM recurso_educativo
       WHERE clinica_id = $1
       ORDER BY created_at DESC`,
      [request.auth.tenantId]
    )
    return rows
  })

  // POST /api/admin/recursos — acepta JSON (enlace) o multipart (archivo)
  fastify.post('/api/admin/recursos', async (request, reply) => {
    const ct = request.headers['content-type'] ?? ''

    if (ct.includes('multipart/form-data')) {
      // ── Tipo archivo ──────────────────────────────────────────────────────
      const parts  = request.parts()
      const campos: Record<string, string> = {}
      let fileBuffer: Buffer | null = null
      let fileMime   = ''
      let fileNombre = ''
      let fileBytes  = 0

      for await (const part of parts) {
        if (part.type === 'file') {
          if (!MIME_PERMITIDOS.has(part.mimetype)) {
            return reply.status(400).send({
              error: `Tipo no permitido: ${part.mimetype}. Usa PDF, Word, PNG o JPG.`,
            })
          }
          const chunks: Buffer[] = []
          for await (const chunk of part.file) chunks.push(chunk)
          fileBuffer = Buffer.concat(chunks)
          fileBytes  = fileBuffer.length
          fileMime   = part.mimetype
          fileNombre = part.filename ?? 'archivo'
          if (fileBytes > MAX_BYTES) {
            return reply.status(400).send({ error: 'El archivo supera los 10 MB' })
          }
        } else {
          campos[part.fieldname] = part.value as string
        }
      }

      if (!campos.titulo?.trim()) {
        return reply.status(400).send({ error: 'El título es obligatorio' })
      }
      if (!fileBuffer) {
        return reply.status(400).send({ error: 'No se recibió ningún archivo' })
      }
      if (campos.imagen_url && !campos.imagen_url.startsWith('https://')) {
        return reply.status(400).send({ error: 'imagen_url debe comenzar con https://' })
      }

      const s3Key = await subirArchivo({
        clinicaId:      request.auth.tenantId,
        nombreOriginal: fileNombre,
        mimeType:       fileMime,
        body:           fileBuffer,
      })

      const { rows } = await pool.query(
        `INSERT INTO recurso_educativo
           (clinica_id, titulo, descripcion, imagen_url, tipo, s3_key, mime_type, tamano_bytes, activo)
         VALUES ($1, $2, $3, $4, 'archivo', $5, $6, $7, true)
         RETURNING id, titulo, descripcion, imagen_url, tipo, mime_type, tamano_bytes, activo`,
        [
          request.auth.tenantId,
          campos.titulo.trim(),
          campos.descripcion?.trim() ?? null,
          campos.imagen_url?.trim() ?? null,
          s3Key, fileMime, fileBytes,
        ]
      )
      reply.status(201)
      return rows[0]

    } else {
      // ── Tipo enlace ───────────────────────────────────────────────────────
      const { titulo, descripcion, url, imagen_url } =
        request.body as Record<string, string>

      if (!titulo?.trim()) {
        return reply.status(400).send({ error: 'El título es obligatorio' })
      }
      if (!url?.startsWith('http')) {
        return reply.status(400).send({ error: 'La URL del recurso es obligatoria' })
      }
      if (imagen_url && !imagen_url.startsWith('https://')) {
        return reply.status(400).send({ error: 'imagen_url debe comenzar con https://' })
      }

      const { rows } = await pool.query(
        `INSERT INTO recurso_educativo
           (clinica_id, titulo, descripcion, url, imagen_url, tipo, activo)
         VALUES ($1, $2, $3, $4, $5, 'enlace', true)
         RETURNING id, titulo, descripcion, url, imagen_url, tipo, activo`,
        [
          request.auth.tenantId,
          titulo.trim(),
          descripcion?.trim() ?? null,
          url.trim(),
          imagen_url?.trim() ?? null,
        ]
      )
      reply.status(201)
      return rows[0]
    }
  })

  // PATCH /api/admin/recursos/:id — editar metadatos (no reemplaza el archivo)
  fastify.patch<{ Params: { id: string } }>(
    '/api/admin/recursos/:id',
    async (request, reply) => {
      const { id }  = request.params
      const body    = request.body as Record<string, unknown>

      const check = await pool.query(
        `SELECT id FROM recurso_educativo WHERE id = $1 AND clinica_id = $2`,
        [id, request.auth.tenantId]
      )
      if (!check.rows[0]) {
        return reply.status(404).send({ error: 'Recurso no encontrado' })
      }

      if (body.imagen_url && typeof body.imagen_url === 'string' &&
          !body.imagen_url.startsWith('https://')) {
        return reply.status(400).send({ error: 'imagen_url debe comenzar con https://' })
      }

      const PERMITIDOS = ['titulo', 'descripcion', 'url', 'imagen_url', 'activo']
      const fields     = Object.keys(body).filter(k => PERMITIDOS.includes(k))
      if (fields.length === 0) {
        return reply.status(400).send({ error: 'Sin campos válidos' })
      }

      const sets   = fields.map((f, i) => `${f} = $${i + 2}`)
      const values = fields.map(f => body[f])

      const { rows } = await pool.query(
        `UPDATE recurso_educativo
         SET ${sets.join(', ')}, updated_at = now()
         WHERE id = $1
         RETURNING id, titulo, descripcion, url, imagen_url, tipo,
                   mime_type, tamano_bytes, activo`,
        [id, ...values]
      )
      return rows[0]
    }
  )

  // DELETE /api/admin/recursos/:id — borrado suave + limpieza S3 en background
  fastify.delete<{ Params: { id: string } }>(
    '/api/admin/recursos/:id',
    async (request, reply) => {
      const { rows } = await pool.query(
        `UPDATE recurso_educativo
         SET activo = false
         WHERE id = $1 AND clinica_id = $2
         RETURNING s3_key`,
        [request.params.id, request.auth.tenantId]
      )
      if (!rows[0]) {
        return reply.status(404).send({ error: 'Recurso no encontrado' })
      }
      if (rows[0].s3_key) {
        // No bloquea la respuesta; el objeto se elimina en background
        eliminarArchivo(rows[0].s3_key).catch(err =>
          console.error('[s3] Error al eliminar:', err)
        )
      }
      reply.status(204)
    }
  )
}
```

### apps/api/src/paciente/recursos.ts — actualizar

Localiza el archivo existente que sirve `GET /api/paciente/recursos`.
Añade los campos nuevos al SELECT y registra el endpoint de apertura:

```typescript
import { urlPrefirmada } from '../lib/s3'

// Actualiza la query de GET /api/paciente/recursos para incluir campos nuevos:
const { rows } = await pool.query(
  `SELECT id, titulo, descripcion, url, imagen_url,
          tipo, mime_type, tamano_bytes
   FROM recurso_educativo
   WHERE clinica_id = $1 AND activo = true
   ORDER BY created_at DESC`,
  [clinicaId]
)

// Añade este endpoint nuevo en el mismo FastifyInstance:
fastify.get<{ Params: { id: string } }>(
  '/api/paciente/recursos/:id/abrir',
  async (request, reply) => {
    const { rows: pac } = await pool.query(
      `SELECT clinica_id FROM paciente WHERE keycloak_user_id = $1 AND activo = true`,
      [request.user.sub]
    )
    if (!pac[0]) return reply.status(401).send({ error: 'Paciente no encontrado' })

    const { rows } = await pool.query(
      `SELECT tipo, url, s3_key
       FROM recurso_educativo
       WHERE id = $1 AND clinica_id = $2 AND activo = true`,
      [request.params.id, pac[0].clinica_id]
    )
    if (!rows[0]) return reply.status(404).send({ error: 'Recurso no encontrado' })

    const rec = rows[0]
    if (rec.tipo === 'archivo') {
      if (!rec.s3_key) {
        return reply.status(500).send({ error: 'Archivo no disponible' })
      }
      const presigned = await urlPrefirmada(rec.s3_key)
      return reply.redirect(302, presigned)
    }
    return reply.redirect(302, rec.url)
  }
)
```

### Registro en apps/api/src/server.ts

```typescript
import { adminRecursosRoutes } from './admin/recursos'
// ...
await fastify.register(adminRecursosRoutes)
```

---

## Frontend — apps/web-professional

### apps/web-professional/src/pages/admin/RecursosPage.tsx

```tsx
import { useEffect, useRef, useState } from 'react'
import { Plus, Link2, FileText, Eye, EyeOff, Trash2, BookOpen } from 'lucide-react'
import { apiFetch } from '../../lib/api'

interface Recurso {
  id:            string
  titulo:        string
  descripcion?:  string
  url?:          string
  imagen_url?:   string
  tipo:          'enlace' | 'archivo'
  mime_type?:    string
  tamano_bytes?: number
  activo:        boolean
}

type Modal = 'enlace' | 'archivo' | null

export default function RecursosPage() {
  const [recursos, setRecursos] = useState<Recurso[]>([])
  const [modal,    setModal]    = useState<Modal>(null)
  const [error,    setError]    = useState('')

  async function cargar() {
    const r = await apiFetch('/api/admin/recursos')
    if (r.ok) setRecursos(await r.json())
  }
  useEffect(() => { cargar() }, [])

  async function toggleActivo(rec: Recurso) {
    await apiFetch(`/api/admin/recursos/${rec.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ activo: !rec.activo }),
    })
    cargar()
  }

  async function eliminar(rec: Recurso) {
    if (!window.confirm(`¿Eliminar "${rec.titulo}"?`)) return
    await apiFetch(`/api/admin/recursos/${rec.id}`, { method: 'DELETE' })
    cargar()
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">
          Biblioteca de recursos
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => setModal('enlace')}
            className="flex items-center gap-2 rounded-lg border border-[var(--color-border)]
                       px-4 py-2 text-sm text-[var(--color-text)]"
          >
            <Link2 size={15} /> Agregar enlace
          </button>
          <button
            onClick={() => setModal('archivo')}
            className="flex items-center gap-2 rounded-lg bg-[var(--color-primary)]
                       px-4 py-2 text-sm font-semibold text-white"
          >
            <Plus size={15} /> Subir archivo
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 text-sm text-[var(--color-danger)]">{error}</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {recursos.map(rec => (
          <TarjetaRecurso
            key={rec.id}
            recurso={rec}
            onToggle={() => toggleActivo(rec)}
            onEliminar={() => eliminar(rec)}
          />
        ))}
        {recursos.length === 0 && (
          <div className="col-span-full flex flex-col items-center py-16
                          text-[var(--color-muted)]">
            <BookOpen size={40} className="mb-3 opacity-40" />
            <p className="text-sm">No hay recursos publicados aún.</p>
          </div>
        )}
      </div>

      {modal === 'enlace' && (
        <ModalEnlace
          onClose={() => setModal(null)}
          onGuardado={() => { setModal(null); cargar() }}
        />
      )}
      {modal === 'archivo' && (
        <ModalArchivo
          onClose={() => setModal(null)}
          onGuardado={() => { setModal(null); cargar() }}
        />
      )}
    </div>
  )
}

// ── Tarjeta de recurso ────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function TarjetaRecurso({
  recurso, onToggle, onEliminar,
}: { recurso: Recurso; onToggle: () => void; onEliminar: () => void }) {
  return (
    <div className={`overflow-hidden rounded-xl border bg-[var(--color-surface)] transition-opacity
      ${recurso.activo ? 'border-[var(--color-border)]' : 'border-dashed border-[var(--color-border)] opacity-60'}`}>

      {recurso.imagen_url ? (
        <img src={recurso.imagen_url} alt=""
             className="h-32 w-full object-cover" />
      ) : (
        <div className="flex h-32 items-center justify-center
                        bg-[var(--color-primary)]/10">
          {recurso.tipo === 'archivo'
            ? <FileText size={32} className="text-[var(--color-primary)]" />
            : <Link2   size={32} className="text-[var(--color-primary)]" />}
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="truncate font-medium text-[var(--color-text)]">
            {recurso.titulo}
          </p>
          <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium
            ${recurso.tipo === 'archivo'
              ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
              : 'bg-[var(--color-muted)]/10 text-[var(--color-muted)]'}`}>
            {recurso.tipo === 'archivo' ? 'Archivo' : 'Enlace'}
          </span>
        </div>

        {recurso.descripcion && (
          <p className="line-clamp-2 text-xs text-[var(--color-muted)]">
            {recurso.descripcion}
          </p>
        )}
        {recurso.tamano_bytes != null && (
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            {formatBytes(recurso.tamano_bytes)}
          </p>
        )}

        <div className="mt-3 flex justify-end gap-1">
          <button
            onClick={onToggle}
            title={recurso.activo ? 'Despublicar' : 'Publicar'}
            className="rounded-lg p-1.5 text-[var(--color-muted)]
                       hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
          >
            {recurso.activo ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          <button
            onClick={onEliminar}
            title="Eliminar"
            className="rounded-lg p-1.5 text-[var(--color-danger)]
                       hover:bg-[var(--color-danger)]/10"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal agregar enlace ───────────────────────────────────────────────────────

function ModalEnlace({
  onClose, onGuardado,
}: { onClose: () => void; onGuardado: () => void }) {
  const [form,     setForm]     = useState({ titulo: '', descripcion: '', url: '', imagen_url: '' })
  const [error,    setError]    = useState('')
  const [guardando,setGuardando]= useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      const r = await apiFetch('/api/admin/recursos', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      })
      if (!r.ok) { setError((await r.json()).error ?? 'Error'); return }
      onGuardado()
    } finally { setGuardando(false) }
  }

  return (
    <Modal titulo="Agregar enlace" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Campo label="Título" value={form.titulo} required
          onChange={v => setForm(f => ({ ...f, titulo: v }))} />
        <Campo label="Descripción" value={form.descripcion}
          onChange={v => setForm(f => ({ ...f, descripcion: v }))} />
        <Campo label="URL del recurso" type="url" value={form.url} required
          onChange={v => setForm(f => ({ ...f, url: v }))} />
        <div>
          <Campo label="URL de imagen de portada (https://…)" type="url"
            value={form.imagen_url}
            onChange={v => setForm(f => ({ ...f, imagen_url: v }))} />
          {form.imagen_url.startsWith('https://') && (
            <img src={form.imagen_url} alt="Vista previa"
                 className="mt-2 h-24 w-full rounded-lg object-cover" />
          )}
        </div>
        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
        <BotonesModal onClose={onClose} guardando={guardando} />
      </form>
    </Modal>
  )
}

// ── Modal subir archivo ────────────────────────────────────────────────────────

function ModalArchivo({
  onClose, onGuardado,
}: { onClose: () => void; onGuardado: () => void }) {
  const [titulo,      setTitulo]      = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [imagenUrl,   setImagenUrl]   = useState('')
  const [archivo,     setArchivo]     = useState<File | null>(null)
  const [error,       setError]       = useState('')
  const [guardando,   setGuardando]   = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!archivo) { setError('Selecciona un archivo'); return }
    if (archivo.size > 10 * 1024 * 1024) { setError('El archivo supera los 10 MB'); return }

    // No pasar Content-Type: el navegador lo establece con el boundary correcto
    const fd = new FormData()
    fd.append('titulo',      titulo)
    fd.append('descripcion', descripcion)
    fd.append('imagen_url',  imagenUrl)
    fd.append('file',        archivo, archivo.name)

    setGuardando(true)
    try {
      const r = await apiFetch('/api/admin/recursos', { method: 'POST', body: fd })
      if (!r.ok) { setError((await r.json()).error ?? 'Error'); return }
      onGuardado()
    } finally { setGuardando(false) }
  }

  return (
    <Modal titulo="Subir archivo" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Campo label="Título" value={titulo} required onChange={setTitulo} />
        <Campo label="Descripción" value={descripcion} onChange={setDescripcion} />
        <div>
          <Campo label="URL de imagen de portada (https://…)" type="url"
            value={imagenUrl} onChange={setImagenUrl} />
          {imagenUrl.startsWith('https://') && (
            <img src={imagenUrl} alt="Vista previa"
                 className="mt-2 h-24 w-full rounded-lg object-cover" />
          )}
        </div>

        {/* Zona de selección de archivo */}
        <div
          onClick={() => inputRef.current?.click()}
          className="cursor-pointer rounded-xl border-2 border-dashed
                     border-[var(--color-border)] p-6 text-center
                     hover:border-[var(--color-primary)] transition-colors"
        >
          {archivo ? (
            <p className="text-sm text-[var(--color-text)]">
              📄 {archivo.name}
              <span className="ml-2 text-xs text-[var(--color-muted)]">
                ({formatBytes(archivo.size)})
              </span>
            </p>
          ) : (
            <>
              <p className="text-sm text-[var(--color-muted)]">
                Haz clic para seleccionar
              </p>
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                PDF, Word, PNG, JPG — máx. 10 MB
              </p>
            </>
          )}
        </div>
        <input
          ref={inputRef} type="file" className="hidden"
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
          onChange={e => setArchivo(e.target.files?.[0] ?? null)}
        />

        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
        <BotonesModal onClose={onClose} guardando={guardando}
          textoGuardar={guardando ? 'Subiendo…' : 'Subir archivo'} />
      </form>
    </Modal>
  )
}

// ── Subcomponentes ─────────────────────────────────────────────────────────────

function Modal({ titulo, onClose, children }: {
  titulo: string; onClose: () => void; children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-[var(--color-surface)] p-6 shadow-xl
                      max-h-[90vh] overflow-y-auto">
        <h2 className="mb-5 text-lg font-bold text-[var(--color-text)]">{titulo}</h2>
        {children}
      </div>
    </div>
  )
}

function Campo({ label, value, onChange, required, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void
  required?: boolean; type?: string
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">
        {label}
      </label>
      <input type={type} value={value} required={required}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm
                   bg-[var(--color-surface)] text-[var(--color-text)]
                   focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" />
    </div>
  )
}

function BotonesModal({ onClose, guardando, textoGuardar = 'Guardar' }: {
  onClose: () => void; guardando: boolean; textoGuardar?: string
}) {
  return (
    <div className="flex gap-3 pt-2">
      <button type="button" onClick={onClose}
        className="flex-1 rounded-lg border border-[var(--color-border)] py-2
                   text-sm text-[var(--color-text)]">
        Cancelar
      </button>
      <button type="submit" disabled={guardando}
        className="flex-1 rounded-lg bg-[var(--color-primary)] py-2
                   text-sm font-semibold text-white disabled:opacity-50">
        {textoGuardar}
      </button>
    </div>
  )
}
```

### Router — nueva ruta admin

```tsx
import { BookOpen } from 'lucide-react'
import RecursosPage from './pages/admin/RecursosPage'

// En el bloque de rutas protegidas:
<Route path="/admin/recursos"
  element={<RequireAdmin><RecursosPage /></RequireAdmin>} />
```

### Sidebar admin — añadir ítem Biblioteca

En el bloque `{esAdmin && (...)}` del sidebar, añade junto a Clínica y Equipo:

```tsx
<NavItem to="/admin/recursos" icon={<BookOpen size={18} />} label="Biblioteca" />
```

---

## Frontend — apps/web-patient

Localiza el componente que renderiza los recursos del paciente
(el que consume `GET /api/paciente/recursos`).
Reemplaza el renderizado por tarjetas con imagen de portada:

```tsx
// Importar si no están:
import { FileText, Link2 } from 'lucide-react'

// Renderizar grid de tarjetas:
<div className="grid gap-4 sm:grid-cols-2">
  {recursos.map(rec => (
    <div key={rec.id}
         className="overflow-hidden rounded-xl border border-[var(--color-border)]
                    bg-[var(--color-surface)]">

      {/* Portada */}
      {rec.imagen_url ? (
        <img src={rec.imagen_url} alt=""
             className="h-28 w-full object-cover" />
      ) : (
        <div className="flex h-28 items-center justify-center
                        bg-[var(--color-primary)]/10">
          {rec.tipo === 'archivo'
            ? <FileText size={28} className="text-[var(--color-primary)]" />
            : <Link2   size={28} className="text-[var(--color-primary)]" />}
        </div>
      )}

      <div className="p-3">
        <p className="font-medium text-sm text-[var(--color-text)]">{rec.titulo}</p>
        {rec.descripcion && (
          <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-muted)]">
            {rec.descripcion}
          </p>
        )}
        {rec.tamano_bytes != null && (
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            {rec.tamano_bytes < 1024 * 1024
              ? `${(rec.tamano_bytes / 1024).toFixed(0)} KB`
              : `${(rec.tamano_bytes / 1024 / 1024).toFixed(1)} MB`}
          </p>
        )}

        {/* El href apunta al endpoint que hace 302 → presigned URL.
            No se expone la URL de S3 en el frontend. */}
        <a
          href={`${import.meta.env.VITE_API_URL ?? ''}/api/paciente/recursos/${rec.id}/abrir`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block w-full rounded-lg bg-[var(--color-primary)] py-2
                     text-center text-xs font-semibold text-white"
        >
          Abrir
        </a>
      </div>
    </div>
  ))}
</div>
```

> Si el frontend del paciente está en un contenedor Docker (no Vite dev server),
> reconstruirlo después de los cambios.

---

## Lista de verificación

- [ ] Paso 0 ejecutado; schema de `recurso_educativo` verificado antes de migrar.
- [ ] MinIO arriba: `docker compose up minio minio-init -d` sin error.
- [ ] Consola MinIO accesible en `http://localhost:9001` (usuario/contraseña del .env).
- [ ] Bucket `nutrismart-recursos` creado automáticamente por `minio-init`.
- [ ] Migración aplicada: columnas `imagen_url`, `tipo`, `s3_key`, `mime_type`, `tamano_bytes` existen en `recurso_educativo`.
- [ ] `@fastify/multipart` registrado antes de las rutas.
- [ ] `GET /api/admin/recursos` → 200 con lista (incluye recursos existentes con `tipo='enlace'`).
- [ ] `POST /api/admin/recursos` con JSON → 201, tipo `'enlace'`.
- [ ] `POST /api/admin/recursos` con multipart + PDF → 201, tipo `'archivo'`; `s3_key` guardado en BD; objeto visible en consola MinIO.
- [ ] Subir archivo > 10 MB → 400.
- [ ] Subir MIME no permitido (p.ej. `.exe`) → 400.
- [ ] `imagen_url` con `http://` (no https) → 400 en ambos tipos.
- [ ] `GET /api/paciente/recursos/:id/abrir` tipo `'archivo'` → 302 a URL prefirmada de MinIO; PDF abre en el navegador.
- [ ] `GET /api/paciente/recursos/:id/abrir` tipo `'enlace'` → 302 a la URL del recurso.
- [ ] Paciente de otra clínica intenta abrir el recurso → 404.
- [ ] `PATCH /api/admin/recursos/:id` con `{ activo: false }` → recurso desaparece del listado del paciente.
- [ ] `DELETE /api/admin/recursos/:id` → `activo=false` en BD; objeto eliminado de MinIO (verificar en consola `http://localhost:9001`).
- [ ] Página `/admin/recursos` (`:5173`) muestra tarjetas con imagen de portada y badge de tipo.
- [ ] Página de biblioteca del paciente (`:5175`) muestra grid con imagen y botón "Abrir".
