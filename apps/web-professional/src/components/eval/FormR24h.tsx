/**
 * Recordatorio de 24 horas — EVAL-04.
 *
 * El estado vive en el contenedor y aquí solo se edita: guardar el
 * recordatorio, la frecuencia y los macros en una sola petición evita
 * que una desconexión a media captura deje media evaluación.
 */
import type { Alimento, ComidaR24 } from '../../api/clinico'
import { claseControl } from '../Campo'

const TIPOS = ['desayuno', 'media_manana', 'almuerzo', 'merienda', 'cena', 'extra'] as const

const ETIQUETA: Record<string, string> = {
  desayuno: 'Desayuno',
  media_manana: 'Media mañana',
  almuerzo: 'Almuerzo',
  merienda: 'Merienda',
  cena: 'Cena',
  extra: 'Extra',
}

const UNIDADES = ['g', 'ml', 'porción', 'taza', 'cucharada', 'unidad'] as const

const ALIMENTO_VACIO: Alimento = { nombre: '', cantidad: null, unidad: 'g', kcal: null }

export function FormR24h({
  comidas,
  onCambio,
  bloqueada,
}: {
  comidas: ComidaR24[]
  onCambio: (c: ComidaR24[]) => void
  bloqueada: boolean
}) {
  function actualizarComida(i: number, cambios: Partial<ComidaR24>) {
    onCambio(comidas.map((c, j) => (i === j ? { ...c, ...cambios } : c)))
  }

  function actualizarAlimento(ci: number, ai: number, cambios: Partial<Alimento>) {
    const comida = comidas[ci]
    if (!comida) return
    actualizarComida(ci, {
      alimentos: comida.alimentos.map((a, j) => (j === ai ? { ...a, ...cambios } : a)),
    })
  }

  const totalKcal = comidas.reduce(
    (t, c) => t + c.alimentos.reduce((s, a) => s + (a.kcal ?? 0), 0),
    0,
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Todo lo que el paciente comió y bebió en las últimas 24 horas.
        </p>
        <span className="rounded-pill bg-primary-tint px-3 py-1 text-sm font-semibold text-primary">
          {totalKcal.toLocaleString('es-CR')} kcal declaradas
        </span>
      </div>

      {comidas.length === 0 && (
        <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
          Aún no hay comidas registradas.
        </p>
      )}

      <ul className="space-y-3">
        {comidas.map((comida, ci) => {
          const kcalComida = comida.alimentos.reduce((s, a) => s + (a.kcal ?? 0), 0)
          return (
            <li key={ci} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="time"
                  value={comida.hora}
                  disabled={bloqueada}
                  onChange={(e) => actualizarComida(ci, { hora: e.target.value })}
                  aria-label="Hora de la comida"
                  className="w-28 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-primary"
                />
                <select
                  value={comida.tipo}
                  disabled={bloqueada}
                  onChange={(e) => actualizarComida(ci, { tipo: e.target.value })}
                  aria-label="Tipo de comida"
                  className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-primary"
                >
                  {TIPOS.map((t) => (
                    <option key={t} value={t}>
                      {ETIQUETA[t]}
                    </option>
                  ))}
                </select>
                <span className="text-sm tabular-nums text-muted">{kcalComida} kcal</span>
                {!bloqueada && (
                  <button
                    type="button"
                    onClick={() => onCambio(comidas.filter((_, j) => j !== ci))}
                    className="ml-auto text-xs font-medium text-[color:var(--status-critical)] hover:underline"
                  >
                    Quitar comida
                  </button>
                )}
              </div>

              <div className="mt-3 space-y-2">
                {comida.alimentos.map((a, ai) => (
                  <div key={ai} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <input
                      type="text"
                      value={a.nombre}
                      disabled={bloqueada}
                      onChange={(e) => actualizarAlimento(ci, ai, { nombre: e.target.value })}
                      placeholder="Alimento"
                      aria-label="Alimento"
                      className={`${claseControl(false)} sm:col-span-2`}
                    />
                    <input
                      type="number"
                      min={0}
                      value={a.cantidad ?? ''}
                      disabled={bloqueada}
                      onChange={(e) =>
                        actualizarAlimento(ci, ai, {
                          cantidad: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      placeholder="Cantidad"
                      aria-label="Cantidad"
                      className={claseControl(false)}
                    />
                    <select
                      value={a.unidad}
                      disabled={bloqueada}
                      onChange={(e) => actualizarAlimento(ci, ai, { unidad: e.target.value })}
                      aria-label="Unidad"
                      className={claseControl(false)}
                    >
                      {UNIDADES.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-1">
                      <input
                        type="number"
                        min={0}
                        value={a.kcal ?? ''}
                        disabled={bloqueada}
                        onChange={(e) =>
                          actualizarAlimento(ci, ai, {
                            kcal: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                        placeholder="kcal"
                        aria-label="Calorías"
                        className={claseControl(false)}
                      />
                      {!bloqueada && (
                        <button
                          type="button"
                          onClick={() =>
                            actualizarComida(ci, {
                              alimentos: comida.alimentos.filter((_, j) => j !== ai),
                            })
                          }
                          aria-label="Quitar alimento"
                          className="shrink-0 rounded-md border border-border px-2 text-sm text-muted hover:text-ink"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {!bloqueada && (
                  <button
                    type="button"
                    onClick={() =>
                      actualizarComida(ci, { alimentos: [...comida.alimentos, { ...ALIMENTO_VACIO }] })
                    }
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    + Añadir alimento
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {!bloqueada && (
        <button
          type="button"
          onClick={() =>
            onCambio([
              ...comidas,
              { hora: '08:00', tipo: 'desayuno', alimentos: [{ ...ALIMENTO_VACIO }] },
            ])
          }
          className="w-full rounded-md border-2 border-dashed border-border px-3 py-2 text-sm font-medium text-muted hover:border-primary hover:text-primary"
        >
          + Añadir comida
        </button>
      )}

      {/* Las kcal son las que teclea el profesional: no hay tabla de
          composición de alimentos detrás, y fingir un cálculo daría una
          cifra con apariencia de dato. */}
      <p className="text-xs text-muted">
        Las calorías por alimento son estimación del profesional; el sistema no las deduce.
      </p>
    </div>
  )
}
