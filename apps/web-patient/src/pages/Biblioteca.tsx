/**
 * Biblioteca — PAC-08, lado del paciente.
 *
 * El material que publica su clínica. Lo ya leído se marca, pero no se
 * esconde: un artículo sobre etiquetas se relee, y una receta más.
 *
 * No es una sexta pestaña de la barra inferior —cinco es el máximo
 * razonable en un móvil, como se decidió en la Rebanada 23—; se llega
 * desde una tarjeta de Inicio.
 *
 * ── Dos cambios de R47 ──────────────────────────────────────────────
 *
 * **Temas.** El paciente elige qué categorías le interesan y la lista
 * se queda con esas. Sin elegir ninguna ve todo, que es lo que veía
 * hasta ahora: la ausencia de preferencias es «no ha dicho», no «no
 * quiere nada».
 *
 * **Los documentos se ven, no se bajan.** El botón de descargar se
 * sustituyó por un visor dentro de la aplicación. No es una protección
 * criptográfica —los bytes llegan al navegador porque tienen que llegar
 * para poder verse— sino la retirada de la invitación: ni descarga, ni
 * compartir, ni menú del visor.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ApiError,
  CATEGORIAS_RECURSO,
  abrirArchivoRecurso,
  getPreferenciasBiblioteca,
  getRecurso,
  getRecursos,
  guardarPreferenciasBiblioteca,
  type Recurso,
  type RecursoResumen,
} from '../lib/api'
import { entrar, initKeycloak } from '../lib/keycloak'
import { NavBar } from '../components/NavBar'

const ETIQUETA: Record<string, string> = Object.fromEntries(
  CATEGORIAS_RECURSO.map((c) => [c.clave, c.etiqueta]),
)

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CR', { day: 'numeric', month: 'long' })
}

/** Sesión y redirección, igual en las dos pantallas de este archivo. */
async function conSesion(destino: string): Promise<boolean> {
  if (await initKeycloak()) return true
  entrar(`${window.location.origin}${destino}`)
  return false
}

/**
 * «Mis temas»: las categorías que el paciente quiere seguir — R47.
 *
 * Vive dentro de la biblioteca y no en el perfil: se decide mirando la lista
 * que se quiere filtrar, no en otra pantalla a la que hay que acordarse de ir.
 *
 * Guarda la lista ENTERA, no los cambios uno a uno. Es lo que el paciente ve
 * al pulsar: con un guardado por casilla, cerrar a medias dejaría una
 * selección que nunca estuvo en pantalla.
 */
function PanelTemas({ onGuardado }: { onGuardado: () => void }) {
  const [seguidas, setSeguidas] = useState<string[] | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    getPreferenciasBiblioteca()
      .then((p) => {
        if (vivo) setSeguidas(p.seguidas)
      })
      .catch(() => {
        if (vivo) setError('No hemos podido cargar tus temas')
      })
    return () => {
      vivo = false
    }
  }, [])

  async function guardar() {
    if (seguidas === null || guardando) return
    setGuardando(true)
    setError(null)
    try {
      await guardarPreferenciasBiblioteca(seguidas)
      onGuardado()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  if (error) {
    return (
      <p role="alert" className="rounded-lg border border-border bg-surface p-4 text-sm text-ink">
        {error}
      </p>
    )
  }

  if (seguidas === null) {
    return <div className="h-40 animate-pulse rounded-lg bg-surface-2" />
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-ink">Mis temas</h2>
      <p className="mt-0.5 text-xs text-muted">
        Marca lo que te interesa y la biblioteca te enseñará solo eso. Si no marcas nada, verás
        todo lo que publique tu nutricionista.
      </p>

      <ul className="mt-3 space-y-1">
        {CATEGORIAS_RECURSO.map((c) => {
          const marcada = seguidas.includes(c.clave)
          return (
            <li key={c.clave}>
              <label className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-2">
                <input
                  type="checkbox"
                  checked={marcada}
                  onChange={() =>
                    setSeguidas((prev) =>
                      (prev ?? []).includes(c.clave)
                        ? (prev ?? []).filter((x) => x !== c.clave)
                        : [...(prev ?? []), c.clave],
                    )
                  }
                  className="h-5 w-5 shrink-0 accent-[color:var(--primary)]"
                />
                <span className="text-sm text-ink">{c.etiqueta}</span>
              </label>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={() => void guardar()}
        disabled={guardando}
        className="mt-2 w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {guardando ? 'Guardando…' : 'Guardar mis temas'}
      </button>
    </section>
  )
}

export function Biblioteca() {
  const navegar = useNavigate()
  const [categoria, setCategoria] = useState<string | null>(null)
  const [verTemas, setVerTemas] = useState(false)
  /** Se incrementa al guardar temas: obliga a recargar la lista filtrada. */
  const [recarga, setRecarga] = useState(0)
  const [lista, setLista] = useState<RecursoResumen[] | null>(null)
  const [pagina, setPagina] = useState(1)
  const [hayMas, setHayMas] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    async function cargar() {
      try {
        if (!(await conSesion('/biblioteca'))) return
        const d = await getRecursos(categoria ?? undefined, pagina)
        if (!vivo) return
        // Al paginar se acumula; al cambiar de categoría se reemplaza.
        setLista((prev) => (pagina === 1 ? d.recursos : [...(prev ?? []), ...d.recursos]))
        setHayMas(d.hayMas)
      } catch (e) {
        if (!vivo) return
        if (e instanceof ApiError && e.codigo === 'sin_vincular') {
          navegar('/activar', { replace: true })
          return
        }
        setError(e instanceof ApiError ? e.message : 'No hemos podido cargar la biblioteca')
      }
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [navegar, categoria, pagina, recarga])

  return (
    <main className="min-h-screen bg-background pb-nav">
      <header className="bg-primary px-4 pb-8 pt-10 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Biblioteca</h1>
            <p className="mt-1 text-sm opacity-90">Material que publica tu nutricionista</p>
          </div>
          <button
            type="button"
            onClick={() => setVerTemas((v) => !v)}
            aria-expanded={verTemas}
            className="shrink-0 rounded-pill border border-white/40 px-3 py-1.5 text-xs font-medium"
          >
            {verTemas ? 'Cerrar' : 'Mis temas'}
          </button>
        </div>
      </header>

      <div className="-mt-4 space-y-4 px-4">
        {verTemas && (
          <PanelTemas
            onGuardado={() => {
              setVerTemas(false)
              setPagina(1)
              setRecarga((n) => n + 1)
            }}
          />
        )}

        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => {
              setCategoria(null)
              setPagina(1)
            }}
            aria-pressed={categoria === null}
            className={`shrink-0 rounded-pill border px-3 py-1.5 text-xs font-medium ${
              categoria === null
                ? 'border-primary bg-primary-tint text-primary'
                : 'border-border bg-surface text-muted'
            }`}
          >
            Todo
          </button>
          {CATEGORIAS_RECURSO.map((c) => (
            <button
              key={c.clave}
              type="button"
              onClick={() => {
                setCategoria(c.clave)
                setPagina(1)
              }}
              aria-pressed={categoria === c.clave}
              className={`shrink-0 rounded-pill border px-3 py-1.5 text-xs font-medium ${
                categoria === c.clave
                  ? 'border-primary bg-primary-tint text-primary'
                  : 'border-border bg-surface text-muted'
              }`}
            >
              {c.etiqueta}
            </button>
          ))}
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-border bg-surface p-4 text-sm text-ink shadow-sm"
          >
            {error}
          </p>
        )}

        {lista === null && !error && (
          <div className="h-40 animate-pulse rounded-lg bg-surface-2" />
        )}

        {lista !== null && lista.length === 0 && (
          <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted shadow-sm">
            {categoria === null
              ? 'Tu nutricionista todavía no ha publicado nada.'
              : 'No hay nada publicado en esta categoría.'}
          </p>
        )}

        <ul className="space-y-3">
          {(lista ?? []).map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => navegar(`/biblioteca/${r.id}`)}
                className="w-full overflow-hidden rounded-lg border border-border bg-surface text-left shadow-sm"
              >
                {/* La portada es lo que hace que se abra. Si la imagen
                    falla se esconde entera: media tarjeta rota llama más
                    la atención que la que no tiene foto. */}
                {r.imagenPortadaUrl && (
                  <img
                    src={r.imagenPortadaUrl}
                    alt=""
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                    className="h-32 w-full object-cover"
                  />
                )}
                <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="min-w-0 text-sm font-semibold text-ink">{r.titulo}</h2>
                  {/* Lo no leído se señala; lo leído no lleva marca. Al
                      revés, una lista entera de «leído» es solo ruido. */}
                  {!r.leido && (
                    <span
                      aria-label="Sin leer"
                      className="mt-1 h-2 w-2 shrink-0 rounded-pill bg-primary"
                    />
                  )}
                </div>
                {r.resumen && <p className="mt-1 text-sm text-muted">{r.resumen}</p>}
                <p className="mt-2 text-xs text-muted">
                  {ETIQUETA[r.categoria] ?? r.categoria} · {fechaCorta(r.publicadoEn)} ·{' '}
                  {r.autor}
                  {/* Que se sepa antes de tocar si abre otra web o baja
                      un archivo: son cosas distintas y en un móvil con
                      datos contados, importa. */}
                  {r.tipo === 'enlace' && ' · enlace externo'}
                  {/* Ya no se descarga: se abre dentro de la app (R47). */}
                  {r.tipo === 'archivo' && ' · documento para ver'}
                </p>
                </div>
              </button>
            </li>
          ))}
        </ul>

        {hayMas && (
          <button
            type="button"
            onClick={() => setPagina((p) => p + 1)}
            className="w-full rounded-md border border-border bg-surface py-2.5 text-sm font-medium text-primary shadow-sm"
          >
            Ver más
          </button>
        )}
      </div>

      <NavBar />
    </main>
  )
}

export function RecursoDetalle() {
  const { id } = useParams<{ id: string }>()
  const navegar = useNavigate()
  const [recurso, setRecurso] = useState<Recurso | null>(null)
  const [abriendo, setAbriendo] = useState(false)
  /** La dirección de blob del documento abierto, y su tipo. null = cerrado. */
  const [visor, setVisor] = useState<{ url: string; mime: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * Abre el documento DENTRO de la aplicación — R47.
   *
   * Antes esto bajaba el archivo. Ahora se trae el blob y se enseña en un
   * visor propio: ni `download`, ni «compartir», ni la barra de herramientas
   * del visor de PDF del navegador (`#toolbar=0`).
   */
  async function abrir() {
    if (!recurso?.archivo || abriendo || visor) return
    setAbriendo(true)
    setError(null)
    try {
      setVisor(await abrirArchivoRecurso(recurso.id))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo abrir el documento')
    } finally {
      setAbriendo(false)
    }
  }

  function cerrarVisor() {
    // El blob vive en memoria hasta que se suelta a mano.
    if (visor) URL.revokeObjectURL(visor.url)
    setVisor(null)
  }

  // Salir de la pantalla con el visor abierto también suelta el blob.
  useEffect(() => {
    return () => {
      if (visor) URL.revokeObjectURL(visor.url)
    }
  }, [visor])

  useEffect(() => {
    let vivo = true
    async function cargar() {
      try {
        if (!id) return
        if (!(await conSesion(`/biblioteca/${id}`))) return
        const d = await getRecurso(id)
        if (vivo) setRecurso(d)
      } catch (e) {
        if (!vivo) return
        if (e instanceof ApiError && e.codigo === 'sin_vincular') {
          navegar('/activar', { replace: true })
          return
        }
        setError(e instanceof ApiError ? e.message : 'No hemos podido abrir este material')
      }
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [id, navegar])

  return (
    <main className="min-h-screen bg-background pb-nav">
      <header className="bg-primary px-4 pb-8 pt-10 text-white">
        <button
          type="button"
          onClick={() => navegar('/biblioteca')}
          className="mb-2 text-sm opacity-90 hover:opacity-100"
        >
          ← Biblioteca
        </button>
        <h1 className="text-xl font-bold">{recurso?.titulo ?? ' '}</h1>
      </header>

      <div className="-mt-4 px-4">
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-border bg-surface p-4 text-sm text-ink shadow-sm"
          >
            {error}
          </p>
        )}

        {!recurso && !error && <div className="h-64 animate-pulse rounded-lg bg-surface-2" />}

        {recurso && (
          <article className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            {recurso.imagenPortadaUrl && (
              <img
                src={recurso.imagenPortadaUrl}
                alt=""
                onError={(e) => (e.currentTarget.style.display = 'none')}
                className="h-44 w-full object-cover"
              />
            )}

            <div className="p-5">
              <p className="text-xs text-muted">
                {ETIQUETA[recurso.categoria] ?? recurso.categoria} ·{' '}
                {fechaCorta(recurso.publicadoEn)} · {recurso.autor}
              </p>

              {recurso.resumen && (
                <p className="mt-3 border-l-2 border-primary pl-3 text-sm text-ink">
                  {recurso.resumen}
                </p>
              )}

              {/* Se pinta como texto, párrafo a párrafo, no como HTML. El
                  contenido lo escribe una persona en un cuadro de texto y
                  meterlo con innerHTML abriría la puerta a que lo escrito
                  en la aplicación profesional ejecute algo en la del
                  paciente. */}
              {recurso.tipo === 'texto' && recurso.contenido && (
                <div className="mt-4 space-y-3">
                  {recurso.contenido.split(/\n{2,}/).map((parrafo, i) => (
                    <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                      {parrafo}
                    </p>
                  ))}
                </div>
              )}

              {/* `noopener noreferrer`: sin ellos la página de destino
                  puede manipular la pestaña de origen y ve de dónde
                  viene el paciente. */}
              {recurso.tipo === 'enlace' && recurso.urlExterna && (
                <a
                  href={recurso.urlExterna}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 block rounded-md bg-primary py-2.5 text-center text-sm font-semibold text-white"
                >
                  Abrir el enlace →
                </a>
              )}

              {recurso.tipo === 'archivo' && recurso.archivo && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => void abrir()}
                    disabled={abriendo}
                    className="w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {abriendo ? 'Abriendo…' : 'Ver documento'}
                  </button>
                  <p className="mt-1 text-center text-xs text-muted">
                    {recurso.archivo.nombre} ·{' '}
                    {Math.max(1, Math.round(recurso.archivo.tamanoBytes / 1024))} kB · se ve aquí
                    dentro
                  </p>
                </div>
              )}
            </div>
          </article>
        )}
      </div>

      {/*
        El visor — R47.

        A pantalla completa y por encima de todo: en un móvil, un PDF metido
        en una tarjeta de 200 px no se lee.

        ## Por qué el iframe NO lleva `sandbox`

        Se intentó. **Chrome desactiva su visor de PDF en cuanto el iframe
        tiene el atributo `sandbox`, con cualquier valor**: se comprobó con
        `sandbox=""`, con `allow-scripts` y con `allow-scripts
        allow-same-origin`, y en los tres casos el marco pinta el icono de
        documento roto. Sin el atributo, el PDF se ve. Entre un visor que no
        enseña nada y uno que enseña el documento, el que cumple el
        requerimiento es el segundo.

        El riesgo que el sandbox cubriría es un PDF con JavaScript. Lo acota
        lo de siempre: el archivo lo subió el profesional de la clínica a su
        propia biblioteca, y el tipo se valida por CONTENIDO al subirlo
        (`detectarTipo`, solo PDF/CSV/PNG/JPEG).

        ## Qué quita esto y qué no

        `#toolbar=0&navpanes=0` quita la barra del visor de PDF, que es donde
        vive su botón de descargar. No hay `<a download>`, ni botón de
        compartir, ni menú.

        **No impide guardar el archivo a quien se lo proponga**: los bytes
        están en el navegador porque tienen que estar para poder pintarse, y
        el menú contextual del sistema sigue existiendo. Es una regla de uso
        —el material se consulta dentro de la aplicación—, no un candado, y se
        describe como lo que es.
      */}
      {visor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Documento: ${recurso?.titulo ?? ''}`}
          className="fixed inset-0 z-50 flex flex-col bg-black/90"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">
              {recurso?.titulo}
            </p>
            <button
              type="button"
              onClick={cerrarVisor}
              className="shrink-0 rounded-md border border-white/40 px-3 py-1.5 text-sm font-medium text-white"
            >
              Cerrar
            </button>
          </div>

          <div className="min-h-0 flex-1 bg-surface">
            {visor.mime.startsWith('image/') ? (
              // Una imagen no necesita iframe. `pointer-events-none` quita el
              // menú contextual del móvil, que trae «guardar imagen».
              <img
                src={visor.url}
                alt={recurso?.titulo ?? 'Documento'}
                className="pointer-events-none h-full w-full object-contain"
              />
            ) : (
              <iframe
                src={`${visor.url}#toolbar=0&navpanes=0`}
                title={recurso?.titulo ?? 'Documento'}
                className="h-full w-full border-0"
              />
            )}
          </div>

          <p className="px-4 py-2 text-center text-xs text-white/70">
            Este material es para que lo consultes aquí. No se descarga ni se comparte.
          </p>
        </div>
      )}

      <NavBar />
    </main>
  )
}
