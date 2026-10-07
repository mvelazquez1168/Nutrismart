/**
 * Biblioteca de recursos — PAC-08, lado del profesional.
 *
 * Se escribe material educativo y se publica para los pacientes de la
 * clínica. Nace como BORRADOR: publicar es un acto aparte, porque un
 * artículo a medias que aparece en la aplicación de todos los pacientes
 * por haber pulsado guardar ya no se puede deshacer — lo han visto.
 *
 * El material lleva firma. Un profesional ve los borradores de sus
 * compañeros (evita escribir dos veces lo mismo) pero no los edita; el
 * administrador de la clínica sí.
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiUpload } from '../api/client'
import { Modal } from '../components/Modal'
import { useCambiosSinGuardar } from '../contexts/CambiosSinGuardar'

const CATEGORIAS = [
  { clave: 'nutricion', etiqueta: 'Nutrición' },
  { clave: 'recetas', etiqueta: 'Recetas' },
  { clave: 'ejercicio', etiqueta: 'Ejercicio' },
  { clave: 'habitos', etiqueta: 'Hábitos' },
  { clave: 'otro', etiqueta: 'Otros' },
] as const

const ETIQUETA: Record<string, string> = Object.fromEntries(
  CATEGORIAS.map((c) => [c.clave, c.etiqueta]),
)

const MAX_CONTENIDO = 20000

/**
 * Qué es un recurso (BIB-01).
 *
 * El tipo decide qué se pide: un texto necesita cuerpo, un enlace una
 * dirección, un archivo una subida. Preguntarlo todo a la vez llenaría
 * el formulario de campos que no aplican.
 */
const TIPOS = [
  { clave: 'texto', etiqueta: 'Escrito aquí', pie: 'Lo redactas tú' },
  { clave: 'enlace', etiqueta: 'Enlace', pie: 'Apunta a otra web' },
  { clave: 'archivo', etiqueta: 'Archivo', pie: 'PDF o imagen' },
] as const

type Tipo = (typeof TIPOS)[number]['clave']

/** Lo que acepta el almacén, detectado por firma de bytes en el servidor. */
const ACEPTA = '.pdf,.png,.jpg,.jpeg'

function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface Archivo {
  id?: string
  nombre: string
  mime: string
  tamanoBytes: number
}

interface RecursoFila {
  id: string
  titulo: string
  resumen: string | null
  categoria: string
  tipo: Tipo
  imagenPortadaUrl: string | null
  urlExterna: string | null
  tieneArchivo: boolean
  publicado: boolean
  publicadoEn: string | null
  actualizadoEn: string
  autor: string
  mio: boolean
  puedeEditar: boolean
  lecturas: number
}

interface RecursoDetalle
  extends Omit<RecursoFila, 'mio' | 'actualizadoEn' | 'lecturas' | 'tieneArchivo'> {
  contenido: string | null
  archivo: Archivo | null
  lecturas: number
}

function campo(extra = ''): string {
  return `w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-primary ${extra}`
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

function ModalRecurso({
  id,
  onCerrar,
  onGuardado,
}: {
  id: string | null
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [titulo, setTitulo] = useState('')
  const [resumen, setResumen] = useState('')
  const [contenido, setContenido] = useState('')
  const [categoria, setCategoria] = useState<string>('nutricion')
  const [tipo, setTipo] = useState<Tipo>('texto')
  const [portada, setPortada] = useState('')
  const [urlExterna, setUrlExterna] = useState('')
  const [archivo, setArchivo] = useState<Archivo | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [cargando, setCargando] = useState(id !== null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    apiGet<RecursoDetalle>(`/api/recursos/${id}`)
      .then((r) => {
        setTitulo(r.titulo)
        setResumen(r.resumen ?? '')
        setContenido(r.contenido ?? '')
        setCategoria(r.categoria)
        setTipo(r.tipo)
        setPortada(r.imagenPortadaUrl ?? '')
        setUrlExterna(r.urlExterna ?? '')
        setArchivo(r.archivo)
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar'))
      .finally(() => setCargando(false))
  }, [id])

  /**
   * Sube el archivo por la ruta genérica de la Rebanada 5.
   *
   * Se sube ANTES de guardar el recurso, y por separado: así el
   * servidor puede rechazarlo por tipo o tamaño sin que se pierda lo ya
   * escrito en el formulario.
   */
  async function subir(f: File) {
    setSubiendo(true)
    setError(null)
    try {
      const meta = await apiUpload<Archivo & { nombreOriginal: string }>('/api/archivos', f)
      setArchivo({
        id: meta.id,
        nombre: meta.nombreOriginal ?? f.name,
        mime: meta.mime,
        tamanoBytes: meta.tamanoBytes,
      })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo subir el archivo')
    } finally {
      setSubiendo(false)
    }
  }

  /** Lo que falta según el tipo. `null` si se puede guardar. */
  function loQueFalta(): string | null {
    if (titulo.trim() === '') return 'el título'
    if (tipo === 'texto' && contenido.trim() === '') return 'el contenido'
    if (tipo === 'enlace' && urlExterna.trim() === '') return 'la dirección del enlace'
    if (tipo === 'archivo' && !archivo?.id) return 'el archivo'
    return null
  }

  // Aviso al salir con cambios sin guardar (R46).
  const { marcarGuardado } = useCambiosSinGuardar({
    nombre: 'Recurso',
    activo: !cargando,
    valores: {
      titulo,
      resumen,
      contenido,
      categoria,
      tipo,
      portada,
      urlExterna,
      archivo: archivo?.id ?? null,
    },
    guardar: () => guardar(),
  })

  async function guardar() {
    if (ocupado || loQueFalta() !== null) return
    setOcupado(true)
    setError(null)
    const cuerpo = {
      titulo: titulo.trim(),
      resumen: resumen.trim(),
      categoria,
      tipo,
      imagenPortadaUrl: portada.trim() === '' ? null : portada.trim(),
      ...(tipo === 'texto' ? { contenido: contenido.trim() } : {}),
      ...(tipo === 'enlace' ? { urlExterna: urlExterna.trim() } : {}),
      ...(tipo === 'archivo' ? { archivoId: archivo?.id } : {}),
    }
    try {
      if (id) await apiPatch(`/api/recursos/${id}`, cuerpo)
      else await apiPost('/api/recursos', cuerpo)
      marcarGuardado()
      onGuardado()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar')
      setOcupado(false)
    }
  }

  return (
    <Modal
      titulo={id ? 'Editar material' : 'Nuevo material'}
      abierto
      bloqueado={ocupado}
      onCerrar={onCerrar}
    >
      {cargando ? (
        <div className="h-64 animate-pulse rounded-md bg-surface-2" />
      ) : (
        <div className="space-y-3">
          <div>
            <label htmlFor="r-titulo" className="mb-1 block text-xs font-medium text-muted">
              Título
            </label>
            <input
              id="r-titulo"
              type="text"
              value={titulo}
              maxLength={200}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Cómo leer una etiqueta nutricional"
              className={campo()}
            />
          </div>

          <div>
            <label htmlFor="r-categoria" className="mb-1 block text-xs font-medium text-muted">
              Categoría
            </label>
            <select
              id="r-categoria"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className={campo()}
            >
              {CATEGORIAS.map((c) => (
                <option key={c.clave} value={c.clave}>
                  {c.etiqueta}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="r-resumen" className="mb-1 block text-xs font-medium text-muted">
              Resumen <span className="font-normal">— lo que se lee en la lista</span>
            </label>
            <textarea
              id="r-resumen"
              rows={2}
              value={resumen}
              maxLength={500}
              onChange={(e) => setResumen(e.target.value)}
              placeholder="En una frase, de qué trata"
              className={campo('resize-none')}
            />
          </div>

          {/* El tipo primero: decide qué se pregunta debajo. */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Qué es</label>
            <div className="flex gap-1.5">
              {TIPOS.map((t) => (
                <button
                  key={t.clave}
                  type="button"
                  onClick={() => setTipo(t.clave)}
                  aria-pressed={tipo === t.clave}
                  className={`flex-1 rounded-md border px-2 py-2 text-center ${
                    tipo === t.clave
                      ? 'border-primary bg-primary-tint text-primary'
                      : 'border-border text-muted'
                  }`}
                >
                  <span className="block text-xs font-semibold">{t.etiqueta}</span>
                  <span className="block text-[0.65rem] leading-tight">{t.pie}</span>
                </button>
              ))}
            </div>
          </div>

          {tipo === 'texto' && (
            <div>
              <label htmlFor="r-contenido" className="mb-1 block text-xs font-medium text-muted">
                Contenido
              </label>
              <textarea
                id="r-contenido"
                rows={12}
                value={contenido}
                maxLength={MAX_CONTENIDO}
                onChange={(e) => setContenido(e.target.value)}
                placeholder="Escribe aquí. Deja una línea en blanco para separar párrafos."
                className={campo('resize-y font-normal')}
              />
              {/* El paciente lo ve como texto, no como HTML: conviene que
                  quien escribe lo sepa antes de intentar poner negritas. */}
              <p className="mt-1 text-xs text-muted">
                Se muestra como texto. Separa los párrafos con una línea en blanco.{' '}
                {contenido.length}/{MAX_CONTENIDO}
              </p>
            </div>
          )}

          {tipo === 'enlace' && (
            <div>
              <label htmlFor="r-url" className="mb-1 block text-xs font-medium text-muted">
                Dirección
              </label>
              <input
                id="r-url"
                type="url"
                value={urlExterna}
                maxLength={1000}
                onChange={(e) => setUrlExterna(e.target.value)}
                placeholder="https://…"
                className={campo()}
              />
              <p className="mt-1 text-xs text-muted">
                Tiene que empezar por https://. Se abrirá fuera de la aplicación.
              </p>
            </div>
          )}

          {tipo === 'archivo' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Archivo</label>
              {archivo ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                  <span className="min-w-0 truncate text-sm text-ink">
                    {archivo.nombre}
                    <span className="ml-2 text-xs text-muted">
                      {tamanoLegible(archivo.tamanoBytes)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setArchivo(null)}
                    className="shrink-0 text-xs text-muted hover:text-ink"
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <input
                  type="file"
                  accept={ACEPTA}
                  disabled={subiendo}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void subir(f)
                  }}
                  className="w-full text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
                />
              )}
              {/* El servidor comprueba el tipo por la FIRMA del archivo,
                  no por la extensión: renombrar un .exe a .pdf no cuela. */}
              <p className="mt-1 text-xs text-muted">
                {subiendo
                  ? 'Subiendo…'
                  : 'PDF, PNG o JPG. Se comprueba el contenido, no la extensión.'}
              </p>
            </div>
          )}

          <div>
            <label htmlFor="r-portada" className="mb-1 block text-xs font-medium text-muted">
              Imagen de portada <span className="font-normal">— opcional</span>
            </label>
            <div className="flex items-center gap-3">
              {portada.trim() !== '' && (
                <img
                  src={portada}
                  alt=""
                  onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
                  className="h-12 w-20 shrink-0 rounded-md border border-border object-cover"
                />
              )}
              <input
                id="r-portada"
                type="url"
                value={portada}
                maxLength={500}
                onChange={(e) => setPortada(e.target.value)}
                placeholder="https://…"
                className={campo()}
              />
            </div>
            <p className="mt-1 text-xs text-muted">
              Se carga desde donde esté alojada; no se copia a NutriSmart. Debe ser https://
            </p>
          </div>

          {error && (
            <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={onCerrar}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted hover:text-ink"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={ocupado || subiendo || loQueFalta() !== null}
              title={loQueFalta() ? `Falta ${loQueFalta()}` : undefined}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
            >
              {id ? 'Guardar cambios' : 'Guardar como borrador'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Lista                                                               */
/* ------------------------------------------------------------------ */

export function Recursos() {
  const [filas, setFilas] = useState<RecursoFila[] | null>(null)
  const [categoria, setCategoria] = useState<string>('')
  const [estado, setEstado] = useState<string>('')
  const [editando, setEditando] = useState<string | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const p = new URLSearchParams()
    if (categoria) p.set('categoria', categoria)
    if (estado) p.set('publicado', estado)
    const cola = p.toString()
    try {
      setFilas(await apiGet<RecursoFila[]>(`/api/recursos${cola ? `?${cola}` : ''}`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cargar la biblioteca')
    }
  }, [categoria, estado])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function publicar(r: RecursoFila, publicado: boolean) {
    if (ocupado) return
    setOcupado(true)
    setError(null)
    try {
      await apiPatch(`/api/recursos/${r.id}/publicacion`, { publicado })
      await cargar()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cambiar el estado')
    } finally {
      setOcupado(false)
    }
  }

  async function archivar(r: RecursoFila) {
    if (ocupado) return
    setOcupado(true)
    setError(null)
    try {
      await apiDelete(`/api/recursos/${r.id}`)
      await cargar()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo archivar')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-ink">Biblioteca</h1>
            <p className="text-sm text-muted">
              Material educativo que ven tus pacientes en su aplicación.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditando(null)
              setAbierto(true)
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            Nuevo material
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            aria-label="Categoría"
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink"
          >
            <option value="">Todas las categorías</option>
            {CATEGORIAS.map((c) => (
              <option key={c.clave} value={c.clave}>
                {c.etiqueta}
              </option>
            ))}
          </select>
          <select
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            aria-label="Estado"
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink"
          >
            <option value="">Todo</option>
            <option value="true">Publicado</option>
            <option value="false">Borradores</option>
          </select>
        </div>

        {error && (
          <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
            {error}
          </p>
        )}

        {filas === null ? (
          <div className="h-48 animate-pulse rounded-lg bg-surface-2" />
        ) : filas.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted shadow-sm">
            Todavía no hay material. El primero que publiques lo verán todos tus pacientes.
          </p>
        ) : (
          <ul className="space-y-2">
            {filas.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-border bg-surface p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-ink">{r.titulo}</h2>
                      <span
                        className="rounded-pill px-2 py-0.5 text-xs font-medium"
                        style={{
                          color: r.publicado ? 'var(--status-normal)' : 'var(--muted)',
                          backgroundColor: r.publicado
                            ? 'color-mix(in srgb, var(--status-normal) 14%, transparent)'
                            : 'var(--surface-2)',
                        }}
                      >
                        {r.publicado ? 'Publicado' : 'Borrador'}
                      </span>
                    </div>
                    {r.resumen && <p className="mt-1 text-sm text-muted">{r.resumen}</p>}
                    <p className="mt-1 text-xs text-muted">
                      {ETIQUETA[r.categoria] ?? r.categoria} · {r.autor}
                      {/* Las lecturas solo dicen algo si está publicado:
                          un borrador con cero lecturas no es un fracaso. */}
                      {r.publicado &&
                        ` · ${r.lecturas} ${r.lecturas === 1 ? 'lectura' : 'lecturas'}`}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {r.puedeEditar ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditando(r.id)
                            setAbierto(true)
                          }}
                          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-ink hover:border-primary"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void publicar(r, !r.publicado)}
                          disabled={ocupado}
                          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                        >
                          {r.publicado ? 'Retirar' : 'Publicar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void archivar(r)}
                          disabled={ocupado}
                          className="text-xs text-muted hover:text-ink"
                        >
                          Archivar
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-muted">De otro profesional</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {abierto && (
        <ModalRecurso
          id={editando}
          onCerrar={() => setAbierto(false)}
          onGuardado={() => {
            setAbierto(false)
            void cargar()
          }}
        />
      )}
    </>
  )
}
