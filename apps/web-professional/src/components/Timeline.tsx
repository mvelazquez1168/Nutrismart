/**
 * Timeline vertical de puntos de control.
 *
 * Orden cronológico descendente: lo más reciente arriba, que es lo que
 * el nutricionista mira primero al abrir la ficha.
 *
 * Las versiones corregidas NO aparecen sueltas en la línea temporal:
 * viajan plegadas dentro de la que las reemplaza. Así la evolución se
 * lee de un vistazo sin que la historia se pierda.
 */
import { useState, type CSSProperties } from 'react'
import type { SnapshotResumen } from '../api/tipos'
import { Tendencia } from './Tendencia'

function formatearFecha(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split('-')
  if (!anio || !mes || !dia) return iso
  return `${dia}/${mes}/${anio}`
}

function EstadoChip({ estado }: { estado: SnapshotResumen['estado'] }) {
  if (estado === 'borrador') {
    return (
      <span
        className="badge-estado"
        style={{ '--estado-color': 'var(--status-alert)' } as CSSProperties}
      >
        Borrador
      </span>
    )
  }
  if (estado === 'corregido') {
    return (
      <span className="rounded-pill bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted">
        Versión corregida
      </span>
    )
  }
  return null
}

function Metricas({ snapshot }: { snapshot: SnapshotResumen }) {
  if (snapshot.metricas.length === 0) {
    return <p className="text-sm text-muted">Sin mediciones en este control.</p>
  }
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
      {snapshot.metricas.map((m) => (
        <div key={m.codigo}>
          <dt className="text-xs uppercase tracking-wide text-muted">{m.nombre}</dt>
          <dd className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-ink">
              {m.valor} <span className="font-normal text-muted">{m.unidad}</span>
            </span>
            <Tendencia metrica={m} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

interface Props {
  snapshots: SnapshotResumen[]
  onEditar: (s: SnapshotResumen) => void
  onCerrar: (s: SnapshotResumen) => void
  onCorregir: (s: SnapshotResumen) => void
  ocupado: boolean
}

export function Timeline({ snapshots, onEditar, onCerrar, onCorregir, ocupado }: Props) {
  const [desplegados, setDesplegados] = useState<Set<string>>(new Set())
  /** id del control cuyo cierre se está confirmando; null = ninguno. */
  const [confirmando, setConfirmando] = useState<string | null>(null)

  function alternar(id: string) {
    setDesplegados((prev) => {
      const copia = new Set(prev)
      if (copia.has(id)) copia.delete(id)
      else copia.add(id)
      return copia
    })
  }

  if (snapshots.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-10 text-center shadow-sm">
        <p className="font-semibold text-ink">Aún sin puntos de control</p>
        <p className="mt-1 text-sm text-muted">
          El primero se registra en la próxima consulta.
        </p>
      </div>
    )
  }

  return (
    <ol className="relative space-y-4 pl-8">
      {/* Línea vertical continua detrás de los puntos */}
      <span
        aria-hidden="true"
        className="absolute bottom-2 left-[7px] top-2 w-0.5 bg-border"
      />

      {snapshots.map((s) => (
        <li key={s.id} className="relative">
          <span
            aria-hidden="true"
            className={`absolute -left-8 top-5 h-4 w-4 rounded-pill border-[3px] bg-surface ${
              s.estado === 'borrador' ? 'border-[color:var(--status-alert)]' : 'border-primary'
            }`}
          />

          <article className="rounded-lg border border-border bg-surface p-5 shadow-sm">
            <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-ink">{formatearFecha(s.fecha)}</h3>
                <EstadoChip estado={s.estado} />
                {s.profesional && <span className="text-sm text-muted">· {s.profesional}</span>}
              </div>

              <div className="flex gap-2">
                {s.estado === 'borrador' &&
                  (confirmando === s.id ? (
                    // Confirmación en línea: cerrar vuelve el control
                    // inmutable y no hay vuelta atrás salvo corrigiendo.
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <span className="text-xs text-ink">
                        Quedará inmutable. ¿Cerrar?
                      </span>
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => setConfirmando(null)}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
                      >
                        No
                      </button>
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => {
                          setConfirmando(null)
                          onCerrar(s)
                        }}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                      >
                        Sí, cerrar
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => onEditar(s)}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => setConfirmando(s.id)}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                      >
                        Cerrar control
                      </button>
                    </>
                  ))}
                {s.estado === 'cerrado' && (
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => onCorregir(s)}
                    title="Crea una versión nueva; la actual se conserva como histórico"
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-60"
                  >
                    Corregir
                  </button>
                )}
              </div>
            </header>

            <Metricas snapshot={s} />

            {s.nota && (
              <p className="mt-3 border-t border-border pt-3 text-sm text-ink">{s.nota}</p>
            )}

            {/* Enganches de CLI-04 y CLI-05: se anuncian como pendientes en
                vez de maquetarse con datos de ejemplo, que en una ficha
                clínica se confundirían con datos reales del paciente. */}
            <p className="mt-3 text-xs text-muted">
              Laboratorios y estrategia — próximamente
            </p>

            {s.corregidoPor && (
              <div className="mt-3 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => alternar(s.id)}
                  aria-expanded={desplegados.has(s.id)}
                  className="text-xs font-medium text-muted hover:text-ink"
                >
                  {desplegados.has(s.id) ? '▾' : '▸'} Esta versión corrige un control anterior
                </button>

                {desplegados.has(s.id) && (
                  <div className="mt-3 rounded-md border border-border bg-surface-2 p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">
                        {formatearFecha(s.corregidoPor.fecha)}
                      </span>
                      <EstadoChip estado={s.corregidoPor.estado} />
                    </div>
                    <Metricas snapshot={s.corregidoPor} />
                    {s.corregidoPor.nota && (
                      <p className="mt-2 text-sm text-muted">{s.corregidoPor.nota}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </article>
        </li>
      ))}
    </ol>
  )
}
