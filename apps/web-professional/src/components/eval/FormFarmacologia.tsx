/**
 * Medicación del paciente — EVAL-03.
 *
 * Suspender un medicamento es baja lógica: sigue en el expediente
 * porque explica hallazgos de laboratorio pasados. Por eso el botón
 * dice «Suspender» y no «Eliminar».
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import {
  crearMedicamento,
  getInteracciones,
  getMedicamentos,
  suspenderMedicamento,
  type Medicamento,
  type RevisionInteracciones,
} from '../../api/clinico'
import { claseControl } from '../Campo'
import { InteraccionesPanel } from './InteraccionesPanel'

const VACIO = { nombre: '', dosis: '', frecuencia: '', desde: '' }

export function FormFarmacologia({
  pacienteId,
  bloqueada,
  onAnadirANotas,
}: {
  pacienteId: string
  bloqueada: boolean
  onAnadirANotas?: (texto: string) => void
}) {
  const [lista, setLista] = useState<Medicamento[]>([])
  const [revision, setRevision] = useState<RevisionInteracciones | null>(null)
  const [nuevo, setNuevo] = useState(VACIO)
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(
    async (signal?: AbortSignal) => {
      try {
        // Las dos juntas: la revisión depende de la lista, pero pedirlas
        // en cadena duplicaría la espera antes de pintar nada.
        const [meds, rev] = await Promise.all([
          getMedicamentos(pacienteId, signal),
          getInteracciones(pacienteId, signal),
        ])
        if (signal?.aborted) return
        setLista(meds)
        setRevision(rev)
      } catch (e) {
        if (signal?.aborted) return
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'No se pudo cargar la medicación')
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

  async function anadir() {
    if (nuevo.nombre.trim() === '' || ocupado) return
    setOcupado(true)
    setError(null)
    try {
      await crearMedicamento(pacienteId, {
        nombre: nuevo.nombre.trim(),
        dosis: nuevo.dosis.trim() || null,
        frecuencia: nuevo.frecuencia.trim() || null,
        desde: nuevo.desde || null,
      })
      setNuevo(VACIO)
      // Se recarga todo: al añadir un fármaco cambian también las
      // interacciones, y mostrarlas desfasadas sería peor que esperar.
      await cargar()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo añadir el medicamento')
    } finally {
      setOcupado(false)
    }
  }

  async function suspender(med: Medicamento) {
    if (!window.confirm(`¿Suspender ${med.nombre}? Se conserva en el expediente como suspendido.`))
      return
    setOcupado(true)
    setError(null)
    try {
      await suspenderMedicamento(pacienteId, med.id)
      await cargar()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo suspender el medicamento')
    } finally {
      setOcupado(false)
    }
  }

  if (cargando) return <div className="h-48 animate-pulse rounded-lg bg-surface-2" />

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-surface p-5">
        <h3 className="mb-3 font-semibold text-ink">Medicación actual</h3>

        {error && (
          <p
            role="alert"
            className="mb-3 rounded-md border border-[color:var(--status-critical)] bg-surface p-2 text-sm text-ink"
          >
            {error}
          </p>
        )}

        {lista.length === 0 ? (
          <p className="text-sm text-muted">Sin medicación registrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {['Medicamento', 'Dosis', 'Frecuencia', 'Desde', ''].map((h) => (
                    <th
                      key={h}
                      className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lista.map((m) => (
                  <tr key={m.id}>
                    <td className="px-2 py-2 font-medium text-ink">{m.nombre}</td>
                    <td className="px-2 py-2 text-muted">{m.dosis ?? '—'}</td>
                    <td className="px-2 py-2 text-muted">{m.frecuencia ?? '—'}</td>
                    <td className="px-2 py-2 tabular-nums text-muted">{m.desde ?? '—'}</td>
                    <td className="px-2 py-2 text-right">
                      {!bloqueada && (
                        <button
                          type="button"
                          onClick={() => void suspender(m)}
                          disabled={ocupado}
                          className="text-xs font-medium text-[color:var(--status-critical)] hover:underline disabled:opacity-60"
                        >
                          Suspender
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!bloqueada && (
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-5">
            <input
              type="text"
              value={nuevo.nombre}
              onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
              placeholder="Medicamento"
              aria-label="Nombre del medicamento"
              className={claseControl(false)}
            />
            <input
              type="text"
              value={nuevo.dosis}
              onChange={(e) => setNuevo({ ...nuevo, dosis: e.target.value })}
              placeholder="Dosis"
              aria-label="Dosis"
              className={claseControl(false)}
            />
            <input
              type="text"
              value={nuevo.frecuencia}
              onChange={(e) => setNuevo({ ...nuevo, frecuencia: e.target.value })}
              placeholder="Frecuencia"
              aria-label="Frecuencia"
              className={claseControl(false)}
            />
            <input
              type="date"
              value={nuevo.desde}
              onChange={(e) => setNuevo({ ...nuevo, desde: e.target.value })}
              aria-label="Desde"
              className={claseControl(false)}
            />
            <button
              type="button"
              onClick={() => void anadir()}
              disabled={ocupado || nuevo.nombre.trim() === ''}
              className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
            >
              Añadir
            </button>
          </div>
        )}
      </section>

      <InteraccionesPanel revision={revision} {...(onAnadirANotas ? { onAnadirANotas } : {})} />
    </div>
  )
}
