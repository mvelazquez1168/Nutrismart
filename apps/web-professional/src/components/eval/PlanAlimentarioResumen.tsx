/**
 * El plan alimentario, dentro de la conclusión — R38.
 *
 * Una tabla por tiempos de comida: seis franjas fijas del día, cada una
 * con su patrón (qué grupos de alimentos la componen) y un ejemplo de
 * menú concreto. Es la MISMA estructura que el gestor de planes de la
 * ficha (`PlanAlimentarioTab`); aquí se redacta sin salir de la consulta.
 *
 * ── Persistencia ────────────────────────────────────────────────────
 *
 * Guardar crea o actualiza el PLAN ACTIVO del paciente:
 *   · si ya hay uno activo, se reescriben sus comidas;
 *   · si no lo hay, se crea un plan «Plan alimentario», se activa y se le
 *     cargan las comidas.
 *
 * Por eso lo escrito aquí aparece luego en la pestaña «Plan alimentario»
 * de la ficha y en el PDF: es el mismo plan, no una copia suelta.
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import { useCambiosSinGuardar } from '../../contexts/CambiosSinGuardar'
import {
  TIPOS_COMIDA,
  activarPlan,
  crearPlan,
  getPlan,
  getPlanes,
  guardarComidas,
  type TipoComida,
} from '../../api/planes'

interface Fila {
  patron: string
  ejemploMenu: string
}

const VACIA: Fila = { patron: '', ejemploMenu: '' }

function filasVacias(): Record<string, Fila> {
  const estado: Record<string, Fila> = {}
  for (const t of TIPOS_COMIDA) estado[t.clave] = { ...VACIA }
  return estado
}

export function PlanAlimentarioResumen({ pacienteId }: { pacienteId: string }) {
  const [planId, setPlanId] = useState<string | null>(null)
  const [filas, setFilas] = useState<Record<string, Fila>>(filasVacias)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const cargar = useCallback(
    (signal?: AbortSignal) => {
      setCargando(true)
      getPlanes(pacienteId, signal)
        .then(async (lista) => {
          const activo = lista.find((p) => p.estado === 'activo')
          if (!activo) return null
          return getPlan(activo.id, signal)
        })
        .then((detalle) => {
          if (signal?.aborted) return
          if (detalle) {
            setPlanId(detalle.id)
            const estado = filasVacias()
            for (const c of detalle.comidas) {
              estado[c.tipoComida] = { patron: c.patron ?? '', ejemploMenu: c.ejemploMenu ?? '' }
            }
            setFilas(estado)
          }
        })
        .catch(() => {
          /* Sin plan visible se empieza en blanco; guardar creará uno. */
        })
        .finally(() => {
          if (!signal?.aborted) setCargando(false)
        })
    },
    [pacienteId],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    cargar(ctrl.signal)
    return () => ctrl.abort()
  }, [cargar])

  function actualizar(clave: string, campo: keyof Fila, valor: string) {
    setFilas((prev) => ({ ...prev, [clave]: { ...(prev[clave] ?? VACIA), [campo]: valor } }))
    setOk(false)
  }

  function comidasEnvio() {
    const envio = []
    for (const t of TIPOS_COMIDA) {
      const f = filas[t.clave] ?? VACIA
      const patron = f.patron.trim()
      const ejemploMenu = f.ejemploMenu.trim()
      if (patron === '' && ejemploMenu === '') continue
      envio.push({
        tipoComida: t.clave as TipoComida,
        patron: patron === '' ? null : patron,
        ejemploMenu: ejemploMenu === '' ? null : ejemploMenu,
      })
    }
    return envio
  }

  // Aviso al salir con cambios sin guardar (R46).
  const { marcarGuardado } = useCambiosSinGuardar({
    nombre: 'Plan alimentario',
    activo: !cargando,
    valores: filas,
    guardar: () => guardar(),
  })

  async function guardar() {
    setGuardando(true)
    setError(null)
    setOk(false)
    try {
      let id = planId
      if (!id) {
        // No hay plan activo: se crea uno y se activa antes de cargar las
        // comidas. Nace en borrador, por eso el activarPlan explícito.
        const nuevo = await crearPlan(pacienteId, { nombre: 'Plan alimentario' })
        await activarPlan(nuevo.id)
        id = nuevo.id
        setPlanId(id)
      }
      await guardarComidas(id, comidasEnvio())
      setOk(true)
      marcarGuardado()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar el plan alimentario')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) {
    return (
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="h-40 animate-pulse rounded-md bg-surface-2" />
      </section>
    )
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-ink">Plan alimentario</h3>
        <span className="text-xs text-muted">
          {planId ? 'Se guarda en el plan activo del paciente' : 'Al guardar se crea el plan activo'}
        </span>
      </div>

      {/* Escritorio: tabla de tres columnas. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="w-40 px-3 py-2 font-semibold text-ink">Tiempo de comida</th>
              <th className="px-3 py-2 font-semibold text-ink">Patrón</th>
              <th className="px-3 py-2 font-semibold text-ink">Ejemplo de menú</th>
            </tr>
          </thead>
          <tbody>
            {TIPOS_COMIDA.map((t) => {
              const f = filas[t.clave] ?? VACIA
              return (
                <tr key={t.clave} className="border-b border-border align-top">
                  <td className="w-40 bg-surface-2 px-3 py-2 font-medium text-ink">{t.etiqueta}</td>
                  <td className="px-2 py-2">
                    <textarea
                      aria-label={`Patrón de ${t.etiqueta}`}
                      rows={2}
                      maxLength={1000}
                      value={f.patron}
                      onChange={(e) => actualizar(t.clave, 'patron', e.target.value)}
                      placeholder="Un lácteo, una fruta, 1 cereal"
                      className="min-h-[3rem] w-full resize-y rounded-md border border-border bg-surface p-1.5 text-sm text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <textarea
                      aria-label={`Ejemplo de menú de ${t.etiqueta}`}
                      rows={2}
                      maxLength={1000}
                      value={f.ejemploMenu}
                      onChange={(e) => actualizar(t.clave, 'ejemploMenu', e.target.value)}
                      placeholder="Una taza de yogurt + 1/4 de granola + 1 banano mediano"
                      className="min-h-[3rem] w-full resize-y rounded-md border border-border bg-surface p-1.5 text-sm text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Móvil: las mismas seis filas apiladas como tarjetas. */}
      <div className="space-y-3 sm:hidden">
        {TIPOS_COMIDA.map((t) => {
          const f = filas[t.clave] ?? VACIA
          return (
            <div key={t.clave} className="rounded-md border border-border p-3">
              <p className="mb-2 font-medium text-ink">{t.etiqueta}</p>

              <label className="mb-1 block text-xs font-medium text-muted">Patrón</label>
              <textarea
                aria-label={`Patrón de ${t.etiqueta}`}
                rows={2}
                maxLength={1000}
                value={f.patron}
                onChange={(e) => actualizar(t.clave, 'patron', e.target.value)}
                placeholder="Un lácteo, una fruta, 1 cereal"
                className="mb-3 w-full resize-y rounded-md border border-border bg-surface p-1.5 text-sm text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
              />

              <label className="mb-1 block text-xs font-medium text-muted">Ejemplo de menú</label>
              <textarea
                aria-label={`Ejemplo de menú de ${t.etiqueta}`}
                rows={2}
                maxLength={1000}
                value={f.ejemploMenu}
                onChange={(e) => actualizar(t.clave, 'ejemploMenu', e.target.value)}
                placeholder="Una taza de yogurt + 1/4 de granola + 1 banano mediano"
                className="w-full resize-y rounded-md border border-border bg-surface p-1.5 text-sm text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
              />
            </div>
          )
        })}
      </div>

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
          Plan alimentario guardado en el plan activo del paciente.
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void guardar()}
          disabled={guardando}
          className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {guardando ? 'Guardando…' : 'Guardar plan alimentario'}
        </button>
      </div>
    </section>
  )
}
