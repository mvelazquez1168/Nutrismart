/**
 * Pestaña «Plan alimentario» de la ficha del paciente — CLI-09.
 *
 * Lista de planes a la izquierda, plan seleccionado a la derecha. Las
 * acciones disponibles dependen del estado: un archivado no se edita ni
 * se reactiva, porque es el registro de lo que se prescribió.
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import {
  activarPlan,
  archivarPlan,
  crearPlan,
  eliminarPlan,
  getPlan,
  getPlanes,
  type Plan,
  type PlanDetalle,
} from '../api/planes'
import { Campo, claseControl } from './Campo'
import { ChipEstadoPlan, PlanCard } from './PlanCard'
import { PlanGrilla } from './PlanGrilla'
import { PlanEditor } from './PlanEditor'

/** 'AAAA-MM-DD' → '17 de agosto de 2026'. Sin pasar por Date. */
function fechaLarga(iso: string | null): string | null {
  if (!iso) return null
  const [anio, mes, dia] = iso.split('-').map(Number)
  if (!anio || !mes || !dia) return iso
  const MESES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ]
  return `${dia} de ${MESES[mes - 1]} de ${anio}`
}

export function PlanAlimentarioTab({ pacienteId }: { pacienteId: string }) {
  const [planes, setPlanes] = useState<Plan[]>([])
  const [plan, setPlan] = useState<PlanDetalle | null>(null)
  const [cargando, setCargando] = useState(true)
  const [editando, setEditando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [creando, setCreando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [objetivo, setObjetivo] = useState('')

  const cargarLista = useCallback(
    async (signal?: AbortSignal) => {
      setCargando(true)
      try {
        const lista = await getPlanes(pacienteId, signal)
        if (signal?.aborted) return
        setPlanes(lista)
      } catch (e) {
        if (signal?.aborted) return
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'No se pudieron cargar los planes')
      } finally {
        if (!signal?.aborted) setCargando(false)
      }
    },
    [pacienteId],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    void cargarLista(ctrl.signal)
    return () => ctrl.abort()
  }, [cargarLista])

  async function abrir(planId: string) {
    setError(null)
    try {
      setPlan(await getPlan(planId))
      setEditando(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el plan')
    }
  }

  /** Envuelve una acción: bloquea, refresca lista y detalle, y reporta. */
  async function accion(fn: () => Promise<unknown>, trasHacer?: 'cerrar' | 'recargar') {
    if (ocupado) return
    setOcupado(true)
    setError(null)
    try {
      await fn()
      await cargarLista()
      if (trasHacer === 'cerrar') setPlan(null)
      else if (plan) await abrir(plan.id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo completar la acción')
    } finally {
      setOcupado(false)
    }
  }

  async function crear() {
    if (nombre.trim() === '') return
    setOcupado(true)
    setError(null)
    try {
      const nuevo = await crearPlan(pacienteId, {
        nombre: nombre.trim(),
        objetivo: objetivo.trim() === '' ? null : objetivo.trim(),
      })
      setCreando(false)
      setNombre('')
      setObjetivo('')
      await cargarLista()
      await abrir(nuevo.id)
      // El plan nace vacío: lo siguiente que toca es cargar comidas.
      setEditando(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo crear el plan')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* ---- Lista ---- */}
      <aside className="w-full shrink-0 space-y-3 lg:w-64">
        <button
          type="button"
          onClick={() => {
            setCreando(true)
            setError(null)
          }}
          className="w-full rounded-md border-2 border-dashed border-border px-3 py-2 text-sm font-medium text-muted transition-colors hover:border-primary hover:text-primary"
        >
          + Nuevo plan
        </button>

        {creando && (
          <div className="space-y-3 rounded-md border border-border bg-surface p-3">
            <Campo id="plan-nombre" etiqueta="Nombre del plan" requerido>
              <input
                id="plan-nombre"
                autoFocus
                type="text"
                value={nombre}
                maxLength={120}
                onChange={(e) => setNombre(e.target.value)}
                className={claseControl(false)}
              />
            </Campo>
            <Campo id="plan-objetivo" etiqueta="Objetivo" ayuda="Opcional">
              <input
                id="plan-objetivo"
                type="text"
                value={objetivo}
                maxLength={500}
                onChange={(e) => setObjetivo(e.target.value)}
                className={claseControl(false)}
              />
            </Campo>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={crear}
                disabled={ocupado || nombre.trim() === ''}
                className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              >
                Crear
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreando(false)
                  setNombre('')
                  setObjetivo('')
                }}
                className="flex-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {cargando ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-md bg-surface-2" />
            ))}
          </div>
        ) : planes.length === 0 ? (
          <p className="rounded-md border border-border bg-surface p-4 text-center text-sm text-muted">
            Aún sin planes registrados.
          </p>
        ) : (
          planes.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              seleccionado={plan?.id === p.id}
              onClick={() => void abrir(p.id)}
            />
          ))
        )}
      </aside>

      {/* ---- Detalle ---- */}
      <div className="min-w-0 flex-1 space-y-4">
        {error && (
          <p
            role="alert"
            className="rounded-md border border-[color:var(--status-alert)] bg-surface p-3 text-sm text-ink"
          >
            {error}
          </p>
        )}

        {!plan ? (
          <p className="rounded-lg border border-border bg-surface p-10 text-center text-sm text-muted">
            Selecciona un plan de la lista o crea uno nuevo.
          </p>
        ) : (
          <>
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-ink">{plan.nombre}</h2>
                  <ChipEstadoPlan estado={plan.estado} />
                </div>
                {plan.objetivo && <p className="mt-0.5 text-sm text-muted">{plan.objetivo}</p>}
                {plan.fechaInicio && (
                  <p className="mt-1 text-xs text-muted">
                    Desde {fechaLarga(plan.fechaInicio)}
                    {plan.fechaFin && ` hasta ${fechaLarga(plan.fechaFin)}`}
                  </p>
                )}
              </div>

              {!editando && plan.estado !== 'archivado' && (
                <div className="flex shrink-0 flex-wrap gap-2">
                  {plan.estado === 'borrador' && (
                    <button
                      type="button"
                      onClick={() => void accion(() => activarPlan(plan.id))}
                      disabled={ocupado}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                    >
                      Activar plan
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditando(true)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2"
                  >
                    Editar comidas
                  </button>
                  {plan.estado === 'activo' && (
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            'Al archivar, el plan deja de regir y ya no se podrá editar. Se conserva en el historial. ¿Continuar?',
                          )
                        ) {
                          void accion(() => archivarPlan(plan.id))
                        }
                      }}
                      disabled={ocupado}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-60"
                    >
                      Archivar
                    </button>
                  )}
                  {plan.estado === 'borrador' && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('¿Descartar este borrador? Quedará archivado.')) {
                          void accion(() => eliminarPlan(plan.id), 'cerrar')
                        }
                      }}
                      disabled={ocupado}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-[color:var(--status-critical)] hover:bg-surface-2 disabled:opacity-60"
                    >
                      Descartar
                    </button>
                  )}
                </div>
              )}
            </header>

            {plan.estado === 'archivado' && (
              <p className="rounded-md border border-border bg-surface-2 p-3 text-sm text-muted">
                Este plan está archivado: se conserva como registro de lo que se prescribió y no se
                puede editar ni reactivar.
              </p>
            )}

            {editando ? (
              <PlanEditor
                planId={plan.id}
                dias={plan.dias}
                onGuardado={async () => {
                  await abrir(plan.id)
                  setEditando(false)
                }}
                onCancelar={() => setEditando(false)}
              />
            ) : (
              <PlanGrilla dias={plan.dias} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
