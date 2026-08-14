/**
 * Rejilla del plan en modo EDICIÓN (CLI-09).
 *
 * 42 celdas editables. Se envía la rejilla ENTERA y el servidor
 * reemplaza lo que había: es la única semántica honesta cuando el
 * profesional puede vaciar una celda — con un guardado incremental,
 * borrar el almuerzo del martes no tendría forma de expresarse.
 *
 * Las celdas sin descripción no viajan: una celda vacía es "no hay
 * comida prescrita", no una comida en blanco.
 */
import { useState } from 'react'
import { ApiError } from '../api/client'
import { DIAS, TIPOS_COMIDA, guardarComidas, type ComidaPlan, type TipoComida } from '../api/planes'

interface Celda {
  descripcion: string
  calorias: string
}

const VACIA: Celda = { descripcion: '', calorias: '' }

function clave(dia: number, tipo: string): string {
  return `${dia}_${tipo}`
}

function estadoInicial(dias: Record<string, ComidaPlan[]>): Record<string, Celda> {
  const estado: Record<string, Celda> = {}
  for (const d of DIAS) {
    for (const t of TIPOS_COMIDA) estado[clave(d.numero, t.clave)] = { ...VACIA }
  }
  for (const [dia, comidas] of Object.entries(dias)) {
    for (const c of comidas) {
      estado[clave(Number(dia), c.tipoComida)] = {
        descripcion: c.descripcion,
        calorias: c.caloriasKcal !== null ? String(c.caloriasKcal) : '',
      }
    }
  }
  return estado
}

export function PlanEditor({
  planId,
  dias,
  onGuardado,
  onCancelar,
}: {
  planId: string
  dias: Record<string, ComidaPlan[]>
  onGuardado: () => void | Promise<void>
  onCancelar: () => void
}) {
  const [celdas, setCeldas] = useState<Record<string, Celda>>(() => estadoInicial(dias))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function actualizar(k: string, campo: keyof Celda, valor: string) {
    setCeldas((prev) => ({ ...prev, [k]: { ...(prev[k] ?? VACIA), [campo]: valor } }))
  }

  const llenas = Object.values(celdas).filter((c) => c.descripcion.trim() !== '').length

  async function guardar() {
    setGuardando(true)
    setError(null)
    try {
      const comidas = []
      for (const d of DIAS) {
        for (const t of TIPOS_COMIDA) {
          const c = celdas[clave(d.numero, t.clave)]
          if (!c || c.descripcion.trim() === '') continue
          const kcal = c.calorias.trim() === '' ? null : Number(c.calorias)
          comidas.push({
            diaSemana: d.numero,
            tipoComida: t.clave as TipoComida,
            descripcion: c.descripcion.trim(),
            caloriasKcal: kcal !== null && Number.isFinite(kcal) ? kcal : null,
          })
        }
      }
      await guardarComidas(planId, comidas)
      await onGuardado()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudieron guardar las comidas')
    } finally {
      setGuardando(false)
    }
  }

  const Acciones = () => (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-muted">
        {llenas === 0
          ? 'Sin comidas: guardar dejará el plan vacío.'
          : `${llenas} ${llenas === 1 ? 'comida' : 'comidas'} en la semana.`}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancelar}
          disabled={guardando}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
        >
          {error}
        </p>
      )}

      <Acciones />

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th
                scope="col"
                className="w-28 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted"
              >
                Comida
              </th>
              {DIAS.map((d) => (
                <th
                  key={d.numero}
                  scope="col"
                  className="min-w-[9rem] px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted"
                >
                  <abbr title={d.largo} className="no-underline">
                    {d.corto}
                  </abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIPOS_COMIDA.map((tipo) => (
              <tr key={tipo.clave} className="border-t border-border align-top">
                <th
                  scope="row"
                  className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-ink"
                >
                  {tipo.etiqueta}
                </th>
                {DIAS.map((d) => {
                  const k = clave(d.numero, tipo.clave)
                  const c = celdas[k] ?? VACIA
                  return (
                    <td key={d.numero} className="px-1 py-1">
                      <div className="space-y-1">
                        <textarea
                          rows={3}
                          value={c.descripcion}
                          maxLength={1000}
                          onChange={(e) => actualizar(k, 'descripcion', e.target.value)}
                          placeholder="—"
                          aria-label={`${tipo.etiqueta}, ${d.largo}`}
                          className="w-full resize-none rounded-md border border-border bg-surface p-1.5 text-xs text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
                        />
                        <input
                          type="number"
                          min={1}
                          value={c.calorias}
                          onChange={(e) => actualizar(k, 'calorias', e.target.value)}
                          placeholder="kcal"
                          aria-label={`Calorías de ${tipo.etiqueta}, ${d.largo}`}
                          className="w-full rounded-md border border-border bg-surface p-1.5 text-xs tabular-nums text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
                        />
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Repetidas abajo: la rejilla es alta y obligar a subir para
          guardar es una fricción gratuita. */}
      <Acciones />
    </div>
  )
}
