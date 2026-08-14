/**
 * Citas del paciente — AGE-02.
 *
 * Dos preguntas, en este orden: cuándo es la próxima y cuánto falta; y
 * qué ha pasado hasta ahora. La cuenta atrás es lo primero porque es lo
 * único que el paciente necesita saber la mayoría de las veces que abre
 * esta pantalla.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ApiError,
  confirmarCita,
  getCitasPaciente,
  type AgendaPaciente,
  type CitaPaciente,
} from '../lib/api'
import { entrar, initKeycloak } from '../lib/keycloak'
import { NavBar } from '../components/NavBar'

const TIPOS: Record<string, string> = {
  primera_vez: 'Primera consulta',
  seguimiento: 'Seguimiento',
  control: 'Control',
  urgencia: 'Urgencia',
}

/** Cómo se lee cada estado desde el lado del paciente. */
const ESTADOS: Record<string, { texto: string; token: string }> = {
  programada: { texto: 'Programada', token: '--primary' },
  confirmada: { texto: 'Confirmada', token: '--primary' },
  completada: { texto: 'Realizada', token: '--status-normal' },
  cancelada: { texto: 'Cancelada', token: '--muted' },
  // Al paciente no se le dice «no asistió» con reproche: se le dice qué
  // pasó con esa cita, que es lo mismo sin el juicio.
  no_asistio: { texto: 'No se realizó', token: '--status-alert' },
}

function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Cuánto falta, en la unidad que el paciente usaría al contarlo.
 *
 * A cinco semanas nadie dice «faltan 34 días»; a dos horas nadie dice
 * «falta menos de un día».
 */
function cuantoFalta(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'Es ahora'

  const minutos = Math.round(ms / 60000)
  if (minutos < 60) return `En ${minutos} minuto${minutos === 1 ? '' : 's'}`

  const horas = Math.round(minutos / 60)
  if (horas < 24) return `En ${horas} hora${horas === 1 ? '' : 's'}`

  const dias = Math.round(horas / 24)
  if (dias === 1) return 'Mañana'
  if (dias < 14) return `En ${dias} días`

  const semanas = Math.round(dias / 7)
  return `En ${semanas} semanas`
}

function Fila({ cita }: { cita: CitaPaciente }) {
  const e = ESTADOS[cita.estado] ?? ESTADOS['programada']!
  return (
    <li className="flex items-start gap-3 border-b border-border py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium capitalize text-ink">{fechaLarga(cita.inicio)}</p>
        <p className="text-xs text-muted">
          {hora(cita.inicio)}
          {cita.profesional && ` · ${cita.profesional}`}
          {TIPOS[cita.tipo] && ` · ${TIPOS[cita.tipo]}`}
        </p>
        {cita.motivo && <p className="mt-1 text-xs text-ink">{cita.motivo}</p>}
      </div>
      <span
        className="shrink-0 rounded-pill px-2 py-0.5 text-xs font-medium"
        style={{
          color: `var(${e.token})`,
          backgroundColor: `color-mix(in srgb, var(${e.token}) 14%, transparent)`,
        }}
      >
        {e.texto}
      </span>
    </li>
  )
}

export function Citas() {
  const navegar = useNavigate()
  const [datos, setDatos] = useState<AgendaPaciente | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)

  useEffect(() => {
    let vivo = true
    async function cargar() {
      try {
        if (!(await initKeycloak())) {
          entrar(`${window.location.origin}/citas`)
          return
        }
        const r = await getCitasPaciente()
        if (vivo) setDatos(r)
      } catch (e) {
        if (!vivo) return
        if (e instanceof ApiError && e.codigo === 'sin_vincular') {
          navegar('/activar', { replace: true })
          return
        }
        setError(e instanceof ApiError ? e.message : 'No hemos podido cargar tus citas')
      } finally {
        if (vivo) setCargando(false)
      }
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [navegar])

  /**
   * Confirmar es decir «voy a ir». Se pinta al pulsar y se revierte si
   * el servidor dice que no: en un móvil con mala cobertura, esperar la
   * respuesta hace que parezca que el botón no funcionó.
   */
  async function confirmar(cita: CitaPaciente) {
    if (confirmando || !datos) return
    setConfirmando(true)
    setError(null)
    const antes = datos
    setDatos({ ...datos, proxima: { ...cita, estado: 'confirmada' } })
    try {
      await confirmarCita(cita.id)
    } catch (e) {
      setDatos(antes)
      setError(e instanceof ApiError ? e.message : 'No se pudo confirmar. Inténtalo otra vez.')
    } finally {
      setConfirmando(false)
    }
  }

  if (cargando) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-pill border-4 border-primary border-t-transparent" />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background pb-nav">
      <header className="bg-primary px-4 pb-8 pt-10 text-white">
        <h1 className="text-xl font-bold">Mis citas</h1>
      </header>

      <div className="-mt-4 space-y-4 px-4">
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-border bg-surface p-4 text-sm text-ink shadow-sm"
          >
            {error}
          </p>
        )}

        {datos?.proxima ? (
          <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Tu próxima cita
            </p>
            <p className="mt-1 text-2xl font-bold text-primary">
              {cuantoFalta(datos.proxima.inicio)}
            </p>
            <p className="mt-2 font-medium capitalize text-ink">
              {fechaLarga(datos.proxima.inicio)}
            </p>
            <p className="text-sm text-muted">
              {hora(datos.proxima.inicio)} · {datos.proxima.duracionMinutos} min
              {datos.proxima.profesional && ` · ${datos.proxima.profesional}`}
            </p>
            {datos.proxima.motivo && (
              <p className="mt-2 text-sm text-ink">{datos.proxima.motivo}</p>
            )}
            {datos.proxima.estado === 'confirmada' ? (
              <p
                className="mt-3 flex items-center gap-1.5 text-sm font-semibold"
                style={{ color: 'var(--status-normal)' }}
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-4 w-4 fill-none stroke-current"
                  strokeWidth={3}
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Asistencia confirmada
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void confirmar(datos.proxima!)}
                disabled={confirmando}
                className="mt-4 w-full rounded-md bg-primary py-3 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              >
                {confirmando ? 'Confirmando…' : 'Confirmar que asistiré'}
              </button>
            )}
          </section>
        ) : (
          !error && (
            <section className="rounded-lg border border-border bg-surface p-8 text-center shadow-sm">
              <p className="font-medium text-ink">No tienes ninguna cita agendada</p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-muted">
                Escríbele a tu nutricionista para reservar la siguiente.
              </p>
              <button
                type="button"
                onClick={() => navegar('/mensajes')}
                className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
              >
                Escribir un mensaje
              </button>
            </section>
          )
        )}

        {datos && datos.siguientes.length > 0 && (
          <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold text-ink">Después de esa</h2>
            <ul>
              {datos.siguientes.map((c) => (
                <Fila key={c.id} cita={c} />
              ))}
            </ul>
          </section>
        )}

        {datos && datos.historial.length > 0 && (
          <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold text-ink">Tus citas anteriores</h2>
            <ul>
              {datos.historial.map((c) => (
                <Fila key={c.id} cita={c} />
              ))}
            </ul>
          </section>
        )}
      </div>

      <NavBar />
    </main>
  )
}
