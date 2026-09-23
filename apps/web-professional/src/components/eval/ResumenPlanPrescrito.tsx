/**
 * Plan alimentario vigente, visto desde la valoración — EVAL-07, R41.
 *
 * Solo lectura. El plan se edita en su propia pestaña del expediente:
 * dos sitios donde tocar lo mismo acaban discrepando, y aquí lo que hace
 * falta es comprobar qué se le prescribió, no cambiarlo.
 *
 * ── Qué estaba roto (R41) ───────────────────────────────────────────
 *
 * Los dos botones enlazaban a `/pacientes/:id` a secas. El expediente
 * abre siempre en «Resumen», así que pulsar «Crear plan alimentario»
 * dejaba al profesional en una pantalla que no era la que pidió, sin
 * plan creado y sin nada que explicara qué había pasado. Parecía que el
 * botón no hacía nada; en realidad hacía lo que le habían dicho.
 *
 * Ahora:
 *   · con plan vigente  -> se abre ESE plan, en su pestaña
 *   · sin plan          -> se crea uno y se abre el recién creado
 *
 * Crear es una escritura, así que el fallo se cuenta aquí mismo en vez
 * de navegar a una pestaña donde no habría nada.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { crearPlan, getPlan, getPlanes, type PlanDetalle } from '../../api/planes'
import { PlanGrilla } from '../PlanGrilla'

/** Hoy en 'dd/mm/aaaa', para nombrar un plan que nace sin nombre. */
function hoyCorta(): string {
  const d = new Date()
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()}`
}

export function ResumenPlanPrescrito({ pacienteId }: { pacienteId: string }) {
  const navigate = useNavigate()
  const [plan, setPlan] = useState<PlanDetalle | null>(null)
  const [cargando, setCargando] = useState(true)
  const [creando, setCreando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setCargando(true)

    getPlanes(pacienteId, ctrl.signal)
      .then(async (lista) => {
        const activo = lista.find((p) => p.estado === 'activo')
        if (!activo || ctrl.signal.aborted) return null
        return getPlan(activo.id, ctrl.signal)
      })
      .then((detalle) => {
        if (!ctrl.signal.aborted) setPlan(detalle ?? null)
      })
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false)
      })

    return () => ctrl.abort()
  }, [pacienteId])

  /** Lleva a la pestaña de planes del expediente, con uno abierto. */
  function abrirEnExpediente(planId: string) {
    navigate(`/pacientes/${pacienteId}?tab=plan&plan=${planId}`)
  }

  /**
   * Sin plan vigente: se crea uno y se abre.
   *
   * Nace en borrador y vacío —eso lo decide la API—, que es justo lo que
   * hace falta: el siguiente paso es cargarle las comidas.
   */
  async function crearYAbrir() {
    if (creando) return
    setCreando(true)
    setError(null)
    try {
      const nuevo = await crearPlan(pacienteId, {
        nombre: `Plan alimentario ${hoyCorta()}`,
        objetivo: null,
      })
      abrirEnExpediente(nuevo.id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo crear el plan alimentario')
      setCreando(false)
    }
  }

  if (cargando) return <div className="h-40 animate-pulse rounded-lg bg-surface-2" />

  if (!plan) {
    return (
      <section className="rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm font-medium text-ink">Sin plan de alimentación activo</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">
          La prescripción de esta valoración indica cuánto y cómo; el plan concreta qué se come
          en cada tiempo de comida.
        </p>

        {error && (
          <p
            role="alert"
            className="mx-auto mt-3 max-w-md rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
          >
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => void crearYAbrir()}
          disabled={creando}
          className="mt-3 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {creando ? 'Creando…' : 'Crear plan alimentario'}
        </button>
      </section>
    )
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-ink">{plan.nombre}</h3>
          <span
            className="rounded-pill px-2 py-0.5 text-xs font-semibold"
            style={{
              color: 'var(--status-normal)',
              backgroundColor: 'color-mix(in srgb, var(--status-normal) 14%, transparent)',
            }}
          >
            Activo
          </span>
        </div>
        <button
          type="button"
          onClick={() => abrirEnExpediente(plan.id)}
          className="text-sm font-medium text-primary hover:underline"
        >
          Abrir el plan completo →
        </button>
      </div>

      {plan.objetivo && <p className="text-sm text-muted">{plan.objetivo}</p>}

      <PlanGrilla comidas={plan.comidas} />
    </section>
  )
}
