/**
 * Biblioteca — PAC-08, lado del paciente.
 *
 * El material que publica su clínica. Lo ya leído se marca, pero no se
 * esconde: un artículo sobre etiquetas se relee, y una receta más.
 *
 * No es una sexta pestaña de la barra inferior —cinco es el máximo
 * razonable en un móvil, como se decidió en la Rebanada 23—; se llega
 * desde una tarjeta de Inicio.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ApiError,
  CATEGORIAS_RECURSO,
  descargarArchivoRecurso,
  getRecurso,
  getRecursos,
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

export function Biblioteca() {
  const navegar = useNavigate()
  const [categoria, setCategoria] = useState<string | null>(null)
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
  }, [navegar, categoria, pagina])

  return (
    <main className="min-h-screen bg-background pb-nav">
      <header className="bg-primary px-4 pb-8 pt-10 text-white">
        <h1 className="text-xl font-bold">Biblioteca</h1>
        <p className="mt-1 text-sm opacity-90">Material que publica tu nutricionista</p>
      </header>

      <div className="-mt-4 space-y-4 px-4">
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
                  {r.tipo === 'archivo' && ' · archivo para descargar'}
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
  const [bajando, setBajando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function bajar() {
    if (!recurso?.archivo || bajando) return
    setBajando(true)
    setError(null)
    try {
      await descargarArchivoRecurso(recurso.id, recurso.archivo.nombre)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo descargar')
    } finally {
      setBajando(false)
    }
  }

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
                    onClick={() => void bajar()}
                    disabled={bajando}
                    className="w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {bajando ? 'Descargando…' : `Descargar ${recurso.archivo.nombre}`}
                  </button>
                  <p className="mt-1 text-center text-xs text-muted">
                    {Math.max(1, Math.round(recurso.archivo.tamanoBytes / 1024))} kB
                  </p>
                </div>
              )}
            </div>
          </article>
        )}
      </div>

      <NavBar />
    </main>
  )
}
