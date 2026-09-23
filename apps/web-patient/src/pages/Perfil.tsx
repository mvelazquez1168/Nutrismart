/**
 * Mi perfil — PAC-09.
 *
 * Tres cosas: cómo quiere que le llamen, su foto y el fondo de la app.
 *
 * Lo que NO hay aquí es igual de importante. El paciente no edita su
 * nombre del expediente, ni su fecha de nacimiento, ni su correo: eso es
 * documentación clínica que escribe la clínica. Se le enseña, para que
 * sepa qué consta de él, con quién comprobarlo si está mal.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../lib/api'
import { entrar, initKeycloak } from '../lib/keycloak'
import { usePerfil } from '../hooks/usePerfil'
import { FONDOS, type Fondo } from '../lib/temas'
import { Avatar } from '../components/Avatar'
import { NavBar } from '../components/NavBar'

function Tarjeta({ titulo, pie, children }: { titulo: string; pie?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-ink">{titulo}</h2>
      {pie && <p className="mb-3 mt-0.5 text-xs text-muted">{pie}</p>}
      <div className={pie ? '' : 'mt-3'}>{children}</div>
    </section>
  )
}

export function Perfil() {
  const navegar = useNavigate()
  const { perfil, cambiarFondo, cambiarPerfil } = usePerfil()

  const [nombre, setNombre] = useState('')
  const [foto, setFoto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      if (!(await initKeycloak())) entrar(`${window.location.origin}/perfil`)
    })()
  }, [])

  // Los campos se rellenan cuando llega el perfil, no antes: escribir el
  // valor por defecto en el estado inicial dejaría los cuadros vacíos.
  useEffect(() => {
    if (!perfil) return
    setNombre(perfil.nombrePreferido ?? '')
    setFoto(perfil.fotoUrl ?? '')
  }, [perfil])

  async function guardar() {
    if (ocupado || !perfil) return
    setOcupado(true)
    setError(null)
    setAviso(null)
    try {
      const n = nombre.trim()
      const f = foto.trim()
      await cambiarPerfil({
        // Vacío significa «vuelve al del expediente» / «quita la foto»:
        // se manda null, que es lo que el servidor entiende por borrar.
        nombrePreferido: n === '' ? null : n,
        fotoUrl: f === '' ? null : f,
      })
      setAviso('Guardado')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar')
    } finally {
      setOcupado(false)
    }
  }

  async function elegirFondo(f: Fondo) {
    setError(null)
    try {
      await cambiarFondo(f)
    } catch {
      setError('No se pudo guardar el fondo')
    }
  }

  if (!perfil) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-pill border-4 border-primary border-t-transparent" />
      </main>
    )
  }

  const cambiado =
    nombre.trim() !== (perfil.nombrePreferido ?? '') || foto.trim() !== (perfil.fotoUrl ?? '')

  return (
    <main className="min-h-screen bg-background pb-nav">
      <header className="fondo-hero px-4 pb-8 pt-10">
        <button
          type="button"
          onClick={() => navegar('/inicio')}
          className="mb-3 text-sm text-muted hover:text-ink"
        >
          ← Inicio
        </button>
        <div className="flex items-center gap-3">
          <Avatar nombre={perfil.nombre} fotoUrl={perfil.fotoUrl} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-ink">{perfil.nombre}</h1>
            {perfil.nombrePreferido && perfil.nombrePreferido !== perfil.nombreExpediente && (
              <p className="truncate text-xs text-muted">
                En tu expediente: {perfil.nombreExpediente}
              </p>
            )}
          </div>
        </div>
      </header>

      <div className="-mt-4 space-y-4 px-4">
        <Tarjeta titulo="Cómo quieres que te llamemos" pie="Solo cambia lo que ves en la aplicación.">
          <input
            type="text"
            value={nombre}
            maxLength={50}
            onChange={(e) => setNombre(e.target.value)}
            placeholder={perfil.nombreExpediente}
            aria-label="Nombre preferido"
            className="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-primary"
          />
        </Tarjeta>

        <Tarjeta
          titulo="Tu foto"
          pie="Pega la dirección de una imagen. Debe empezar por https://"
        >
          <div className="flex items-center gap-3">
            <Avatar nombre={nombre.trim() || perfil.nombre} fotoUrl={foto.trim() || null} size="md" />
            <input
              type="url"
              value={foto}
              maxLength={500}
              onChange={(e) => setFoto(e.target.value)}
              placeholder="https://…"
              aria-label="Dirección de la foto"
              className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-primary"
            />
          </div>
          {/* Se dice de dónde sale la imagen: es una dirección externa y
              el sitio que la sirve ve que alguien la pide. */}
          <p className="mt-2 text-xs text-muted">
            La imagen se carga desde donde esté alojada; no se copia a NutriSmart.
          </p>
        </Tarjeta>

        {(cambiado || aviso || error) && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={ocupado || !cambiado}
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
            >
              Guardar
            </button>
            {aviso && <span className="text-sm text-muted">{aviso}</span>}
            {error && (
              <span role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
                {error}
              </span>
            )}
          </div>
        )}

        <Tarjeta titulo="El fondo de tu aplicación" pie="Se aplica al momento.">
          <div className="grid grid-cols-2 gap-2">
            {FONDOS.map((f) => {
              const activo = perfil.fondo === f.clave
              return (
                <button
                  key={f.clave}
                  type="button"
                  onClick={() => void elegirFondo(f.clave)}
                  aria-pressed={activo}
                  className={`flex items-center gap-2 rounded-md border p-2 text-left ${
                    activo ? 'border-primary bg-primary-tint' : 'border-border'
                  }`}
                >
                  {/* La muestra se pinta con las variables del propio
                      tema, dentro de un contenedor marcado con su
                      data-fondo. Así el selector no repite ni un color:
                      si mañana se retoca un verde, esto lo refleja solo. */}
                  <span
                    data-fondo={f.clave}
                    aria-hidden="true"
                    className="fondo-hero h-8 w-8 shrink-0 rounded-md border border-border"
                  />
                  <span className={`text-xs font-medium ${activo ? 'text-primary' : 'text-ink'}`}>
                    {f.etiqueta}
                  </span>
                </button>
              )
            })}
          </div>
        </Tarjeta>

        {/* Lo que consta en el expediente. Se enseña, no se edita. */}
        <Tarjeta
          titulo="Lo que consta en tu expediente"
          pie="Lo escribe tu clínica. Si algo no está bien, díselo a tu nutricionista."
        >
          <dl className="divide-y divide-border text-sm">
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-muted">Nombre</dt>
              <dd className="text-right text-ink">{perfil.nombreExpediente}</dd>
            </div>
          </dl>
        </Tarjeta>
      </div>

      <NavBar />
    </main>
  )
}
