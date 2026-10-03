/**
 * Observaciones clínicas del historial — R44.
 *
 * Va al final de la carpeta Clínico, después de Hábitos, y guarda en el
 * historial del PACIENTE (`historial_clinico.observaciones_clinicas`).
 *
 * No es la misma caja que «Observaciones clínicas» de Prescripción: esa
 * es el juicio de UNA consulta y vive en `conclusion_valoracion`. Esta
 * acompaña al historial y se actualiza visita a visita, como el resto de
 * la carpeta. Comparten rótulo porque están en carpetas distintas.
 *
 * Tarjeta propia con su propio botón —como Hábitos— y por eso usa su
 * propio endpoint: el PUT del historial completo reemplaza la fila
 * entera, y mandarlo desde aquí, sin el resto del formulario a mano,
 * borraría antecedentes, síntomas y tamizaje de un golpe.
 */
import { useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import { getHistorial, guardarObservacionesHistorial } from '../../api/clinico'
import { claseControl } from '../Campo'

export function ObservacionesHistorial({
  pacienteId,
  bloqueada,
}: {
  pacienteId: string
  bloqueada: boolean
}) {
  const [texto, setTexto] = useState('')
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    const ctrl = new AbortController()
    setCargando(true)
    getHistorial(pacienteId, ctrl.signal)
      .then((h) => {
        if (!ctrl.signal.aborted) setTexto(h.observacionesClinicas ?? '')
      })
      // 404 = este paciente aún no tiene historial. No es un error.
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false)
      })
    return () => ctrl.abort()
  }, [pacienteId])

  async function guardar() {
    setGuardando(true)
    setError(null)
    setOk(false)
    try {
      const h = await guardarObservacionesHistorial(
        pacienteId,
        texto.trim() === '' ? null : texto,
      )
      setTexto(h.observacionesClinicas ?? '')
      setOk(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudieron guardar las observaciones')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <div className="h-40 animate-pulse rounded-lg bg-surface-2" />

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
      <div>
        <h3 className="font-semibold text-ink">Observaciones clínicas</h3>
        <p className="text-sm text-muted">
          Del historial del paciente, no de esta consulta: se actualiza visita a visita.
        </p>
      </div>

      <textarea
        aria-label="Observaciones clínicas del historial"
        rows={5}
        value={texto}
        disabled={bloqueada}
        onChange={(e) => {
          setTexto(e.target.value)
          setOk(false)
        }}
        className={`${claseControl(false)} resize-y`}
      />

      {error && (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
        >
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded-md border border-border bg-primary-tint p-3 text-sm text-primary">
          Observaciones guardadas.
        </p>
      )}

      {!bloqueada && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={guardando}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {guardando ? 'Guardando…' : 'Guardar observaciones'}
          </button>
        </div>
      )}
    </section>
  )
}
