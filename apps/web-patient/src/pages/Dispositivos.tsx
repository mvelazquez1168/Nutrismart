/**
 * Pulseras y relojes — RPM-01.
 *
 * Lo que se conecta aquí trae datos solos: pasos, pulso en reposo y
 * horas de sueño, todos los días, sin que el paciente tenga que
 * acordarse de nada. Es la diferencia entre un seguimiento que depende
 * de la constancia y uno que no.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ApiError,
  conectarWearable,
  desconectarWearable,
  getWearables,
  sincronizarWearable,
  type EstadoWearable,
} from '../lib/api'
import { entrar, initKeycloak } from '../lib/keycloak'
import { NavBar } from '../components/NavBar'

/** Lo que devuelve el callback en la URL, en palabras. */
const RESULTADO: Record<string, { texto: string; bien: boolean }> = {
  conectado: { texto: 'Listo. Ya estamos recibiendo tus datos.', bien: true },
  cancelado: { texto: 'No se completó la conexión. Puedes intentarlo otra vez.', bien: false },
  enlace_caducado: {
    texto: 'El enlace caducó. Vuelve a pulsar Conectar para empezar de nuevo.',
    bien: false,
  },
  fallo: { texto: 'No pudimos completar la conexión. Inténtalo más tarde.', bien: false },
  proveedor_desconocido: { texto: 'Ese servicio no está disponible.', bien: false },
}

function cuando(iso: string | null): string {
  if (!iso) return 'nunca'
  return new Date(iso).toLocaleString('es-CR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function Dispositivos() {
  const navegar = useNavigate()
  const [params, setParams] = useSearchParams()
  const [lista, setLista] = useState<EstadoWearable[] | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      setLista(await getWearables())
    } catch (e) {
      if (e instanceof ApiError && e.codigo === 'sin_vincular') {
        navegar('/activar', { replace: true })
        return
      }
      setError(e instanceof ApiError ? e.message : 'No hemos podido cargar tus dispositivos')
    }
  }, [navegar])

  useEffect(() => {
    void (async () => {
      if (!(await initKeycloak())) {
        entrar(`${window.location.origin}/dispositivos`)
        return
      }
      await cargar()
    })()
  }, [cargar])

  // El resultado de la vuelta de OAuth llega en la URL. Se lee una vez y
  // se quita: si no, recargar la página repetiría el mensaje.
  const resultado = params.get('resultado')
  useEffect(() => {
    if (!resultado) return
    const r = RESULTADO[resultado]
    if (r) (r.bien ? setAviso : setError)(r.texto)
    params.delete('resultado')
    setParams(params, { replace: true })
  }, [resultado, params, setParams])

  async function conectar(p: string) {
    setOcupado(p)
    setError(null)
    try {
      const { url } = await conectarWearable(p)
      // Navegación completa a propósito: la autorización ocurre en el
      // sitio del proveedor y tiene que verse su dirección en la barra.
      // Meterla en un iframe sería enseñar un formulario de contraseña
      // dentro de nuestra página, que es la forma de un engaño.
      window.location.assign(url)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo iniciar la conexión')
      setOcupado(null)
    }
  }

  async function sincronizar(p: string) {
    setOcupado(p)
    setError(null)
    setAviso(null)
    try {
      const r = await sincronizarWearable(p)
      setAviso(
        r.nuevas === 0
          ? 'Ya estaba todo al día.'
          : `${r.nuevas} ${r.nuevas === 1 ? 'dato nuevo' : 'datos nuevos'}.`,
      )
      await cargar()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo sincronizar')
    } finally {
      setOcupado(null)
    }
  }

  async function desconectar(p: string) {
    setOcupado(p)
    setError(null)
    try {
      await desconectarWearable(p)
      setAviso('Desconectado. Lo que ya se había registrado se conserva.')
      await cargar()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo desconectar')
    } finally {
      setOcupado(null)
    }
  }

  return (
    <main className="min-h-screen bg-background pb-nav">
      <header className="fondo-hero px-4 pb-8 pt-10">
        <button
          type="button"
          onClick={() => navegar('/inicio')}
          className="mb-2 text-sm text-muted hover:text-ink"
        >
          ← Inicio
        </button>
        <h1 className="text-xl font-bold text-ink">Mis dispositivos</h1>
        <p className="mt-1 text-sm text-muted">
          Conecta tu pulsera y tus pasos, tu pulso y tu sueño llegarán solos.
        </p>
      </header>

      <div className="-mt-4 space-y-4 px-4">
        {aviso && (
          <p className="rounded-lg border border-border bg-surface p-3 text-sm text-ink shadow-sm">
            {aviso}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-border bg-surface p-3 text-sm shadow-sm"
            style={{ color: 'var(--status-critical)' }}
          >
            {error}
          </p>
        )}

        {lista === null ? (
          <div className="h-40 animate-pulse rounded-lg bg-surface-2" />
        ) : (
          lista.map((w) => (
            <section
              key={w.proveedor}
              className="rounded-lg border border-border bg-surface p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-ink">{w.etiqueta}</h2>
                  <p className="text-xs text-muted">{w.queTrae}</p>
                  {w.conectado ? (
                    <p className="text-xs text-muted">
                      Última vez: {cuando(w.ultimoSync)} · {w.lecturas}{' '}
                      {w.lecturas === 1 ? 'dato' : 'datos'}
                    </p>
                  ) : (
                    <p className="text-xs text-muted">Sin conectar</p>
                  )}
                </div>
                {w.conectado && (
                  <span
                    className="shrink-0 rounded-pill px-2 py-0.5 text-xs font-medium"
                    style={{
                      color: 'var(--status-normal)',
                      backgroundColor: 'color-mix(in srgb, var(--status-normal) 14%, transparent)',
                    }}
                  >
                    Conectado
                  </span>
                )}
              </div>

              {/* Un fallo del proveedor se cuenta, no se esconde: si no,
                  el paciente ve «conectado» y ningún dato, y no sabe si
                  el problema es suyo. */}
              {w.ultimoError && (
                <p className="mt-2 text-xs" style={{ color: 'var(--status-alert)' }}>
                  {w.ultimoError}
                </p>
              )}

              {!w.disponible ? (
                <p className="mt-3 text-xs text-muted">{w.motivoNoDisponible}</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {w.conectado ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void sincronizar(w.proveedor)}
                        disabled={ocupado !== null}
                        className="flex-1 rounded-md bg-primary py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {ocupado === w.proveedor ? 'Sincronizando…' : 'Sincronizar ahora'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void desconectar(w.proveedor)}
                        disabled={ocupado !== null}
                        className="rounded-md border border-border px-4 text-sm text-muted"
                      >
                        Desconectar
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void conectar(w.proveedor)}
                      disabled={ocupado !== null}
                      className="w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Conectar {w.etiqueta}
                    </button>
                  )}
                </div>
              )}
            </section>
          ))
        )}

        {/* Lo que nadie adivina si no se le dice. */}
        <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-ink">¿Tienes un Apple Watch?</h2>
          <p className="mt-1 text-sm text-muted">
            Conecta <strong>Fitbit</strong>. Su aplicación de iPhone se sincroniza con Salud, así
            que los datos de tu reloj acaban llegando aquí sin que tengas que hacer nada más.
          </p>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-ink">Qué se comparte</h2>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-muted">
            <li>Pasos de cada día</li>
            <li>Pulso en reposo</li>
            <li>Horas de sueño (solo Fitbit)</li>
          </ul>
          {/* Decir lo que NO se pide vale tanto como decir lo que sí. */}
          <p className="mt-2 text-xs text-muted">
            Nada más. No pedimos tu ubicación ni tus entrenamientos. Puedes desconectarlo cuando
            quieras y dejaremos de recibir datos al momento.
          </p>
        </section>
      </div>

      <NavBar />
    </main>
  )
}
