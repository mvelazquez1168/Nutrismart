/**
 * Consultas previas del paciente, en su expediente — EVAL-00.
 *
 * Es la puerta de entrada a la valoración: desde aquí se abre una nueva
 * o se reabre una anterior.
 *
 * Dos destinos por fila, y no es un descuido: pulsar la fila ABRE EL
 * PANEL de solo lectura (R43) —que es lo que se quiere el 90% de las
 * veces: mirar qué se dijo— mientras el botón de la derecha entra a la
 * valoración, que sí edita. Mandar el clic de la fila a la pantalla de
 * edición haría que consultar una consulta cerrada pasara por abrirla.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import {
  TIPOS_CONSULTA,
  crearConsulta,
  etiquetaTipoConsulta,
  getConsultas,
  type Consulta,
} from '../../api/valoracion'
import { ConsultaDetalleSheet } from '../ConsultaDetalleSheet'

export function ListaConsultas({ pacienteId }: { pacienteId: string }) {
  const navigate = useNavigate()
  const [consultas, setConsultas] = useState<Consulta[]>([])
  const [cargando, setCargando] = useState(true)
  const [creando, setCreando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Consulta cuyo detalle se está mirando; null = panel cerrado. */
  const [detalle, setDetalle] = useState<string | null>(null)
  /** true mientras se elige el tipo de la consulta por abrir (R44). */
  const [abriendo, setAbriendo] = useState(false)
  const [tipoNuevo, setTipoNuevo] = useState<Consulta['tipo']>('inicial')

  const cargar = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const lista = await getConsultas(pacienteId, signal)
        if (!signal?.aborted) setConsultas(lista)
      } catch (e) {
        if (signal?.aborted) return
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'No se pudieron cargar las consultas')
      } finally {
        if (!signal?.aborted) setCargando(false)
      }
    },
    [pacienteId],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    void cargar(ctrl.signal)
    return () => ctrl.abort()
  }, [cargar])

  async function nueva() {
    setCreando(true)
    setError(null)
    try {
      const c = await crearConsulta(pacienteId, tipoNuevo)
      // Se navega directamente: la consulta nace vacía y lo siguiente
      // que toca es medir.
      navigate(`/pacientes/${pacienteId}/valoracion/${c.id}`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo crear la consulta')
      setCreando(false)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-ink">Valoraciones</h2>
        {/* Abre el formulario en vez de crear la consulta de golpe: desde
            la R44 el tipo lo elige quien la abre, y no hay vuelta atrás
            —una consulta no se borra—, así que se pregunta antes. */}
        {!abriendo && (
          <button
            type="button"
            onClick={() => {
              // Se propone lo que el servidor haría solo: la primera
              // consulta es una valoración completa y las siguientes,
              // control. Queda cambiarlo de un clic.
              setTipoNuevo(consultas.length === 0 ? 'inicial' : 'seguimiento')
              setAbriendo(true)
              setError(null)
            }}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover"
          >
            + Nueva consulta
          </button>
        )}
      </div>

      {/* ---- Formulario de nueva consulta (R44) ---- */}
      {abriendo && (
        <div className="mb-4 rounded-md border border-primary bg-primary-tint/40 p-4">
          <p className="mb-2 text-sm font-semibold text-ink">Tipo de consulta</p>
          <div
            className="space-y-2"
            role="radiogroup"
            aria-label="Tipo de la consulta por abrir"
          >
            {TIPOS_CONSULTA.map((t) => (
              <label
                key={t.clave}
                className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 ${
                  tipoNuevo === t.clave
                    ? 'border-primary bg-surface'
                    : 'border-border bg-surface hover:bg-surface-2'
                }`}
              >
                <input
                  type="radio"
                  name="tipo-consulta-nueva"
                  checked={tipoNuevo === t.clave}
                  onChange={() => setTipoNuevo(t.clave)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--primary)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{t.etiqueta}</span>
                  <span className="block text-xs text-muted">{t.descripcion}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              disabled={creando}
              onClick={() => setAbriendo(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={creando}
              onClick={() => void nueva()}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
            >
              {creando ? 'Creando…' : 'Abrir consulta'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mb-3 rounded-md border border-[color:var(--status-critical)] bg-surface p-2 text-xs text-ink"
        >
          {error}
        </p>
      )}

      {cargando ? (
        <div className="h-16 animate-pulse rounded-md bg-surface-2" />
      ) : consultas.length === 0 ? (
        <p className="text-sm text-muted">Sin valoraciones registradas.</p>
      ) : (
        <ul className="divide-y divide-border">
          {consultas.map((c) => {
            const finalizada = c.estado === 'finalizada'
            return (
              <li
                key={c.id}
                onClick={() => setDetalle(c.id)}
                className="-mx-2 flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-surface-2"
              >
                {/* Botón de verdad dentro de la fila: el onClick del <li>
                    atiende el ratón, y esto le da foco y teclado a lo
                    mismo. El clic burbujea al <li> y repite setDetalle con
                    el mismo id, que es inocuo. */}
                <button
                  type="button"
                  onClick={() => setDetalle(c.id)}
                  title="Ver el detalle de esta consulta"
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    Consulta #{c.numeroConsulta}
                    {/* El tipo como etiqueta y no como texto suelto: es
                        lo que distingue una valoración completa de un
                        control, y se busca de un barrido (R44). */}
                    <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                      {etiquetaTipoConsulta(c.tipo)}
                    </span>
                  </p>
                  <p className="text-xs text-muted">
                    {c.fechaConsulta}
                    {c.profesional ? ` · ${c.profesional}` : ''}
                  </p>
                </button>

                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className="rounded-pill px-2 py-0.5 text-xs font-semibold"
                    style={{
                      color: finalizada ? 'var(--status-normal)' : 'var(--status-alert)',
                      backgroundColor: `color-mix(in srgb, ${
                        finalizada ? 'var(--status-normal)' : 'var(--status-alert)'
                      } 14%, transparent)`,
                    }}
                  >
                    {finalizada ? 'Finalizada' : 'En curso'}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      // Si no se detiene, el <li> abriría además el panel.
                      e.stopPropagation()
                      navigate(`/pacientes/${pacienteId}/valoracion/${c.id}`)
                    }}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2"
                  >
                    {finalizada ? 'Ver' : 'Continuar'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <ConsultaDetalleSheet
        pacienteId={pacienteId}
        consultaId={detalle}
        onCerrar={() => setDetalle(null)}
      />
    </section>
  )
}
