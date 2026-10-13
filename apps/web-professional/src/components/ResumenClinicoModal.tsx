/**
 * El resumen clínico de un plan alimentario — R49.
 *
 * Se abre desde cada entrada del histórico de planes. Muestra los SIETE
 * bloques con sus encabezados, siempre los siete: un bloque sin contenido
 * aparece con la leyenda de que no se registró, porque un encabezado que
 * desaparece deja al profesional sin saber si el dato falta o si el
 * resumen está incompleto.
 *
 * El contenido no se recalcula aquí. Se lee lo que se guardó cuando se
 * prescribió el plan, con su fecha: es el resumen de ESE momento, y
 * regenerarlo al mirarlo lo convertiría en otra cosa.
 *
 * ── La marca de IA ──────────────────────────────────────────────────
 *
 * El encabezado dice que lo redactó la IA y con qué modelo. Es la regla
 * de oro del proyecto: la salida de IA va marcada. La distribución de
 * macros lleva su propia nota, porque esa SÍ sale de la prescripción
 * guardada y no del modelo — es la única cifra del resumen que se puede
 * auditar contra la base.
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import {
  generarResumenPlan,
  getResumenPlan,
  type MacrosResumen,
  type ResumenClinico,
} from '../api/planes'
import { Modal } from './Modal'

/** Los siete bloques, en el orden del requerimiento. */
const BLOQUES = [
  { clave: 'objetivos', titulo: 'Objetivos' },
  { clave: 'observacionesClinicas', titulo: 'Observaciones clínicas' },
  { clave: 'justificacion', titulo: 'Justificación' },
  { clave: 'planAlimentario', titulo: 'Plan alimentario' },
  { clave: 'distribucionMacros', titulo: 'Distribución de macros' },
  { clave: 'recomendaciones', titulo: 'Recomendaciones' },
  { clave: 'tareas', titulo: 'Tareas' },
] as const

/** 'AAAA-MM-DDTHH:MM:SSZ' → '12 de octubre de 2026, 14:35'. */
function fechaHora(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('es-CR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Los macros en tabla, cuando hay cifras.
 *
 * `fuente: 'ausente'` no se tabula: una tabla de guiones se lee como «el
 * plan no aporta nutrientes». En ese caso se muestra el texto del bloque,
 * que explica qué falta registrar y dónde.
 */
function TablaMacros({ m }: { m: MacrosResumen }) {
  const filas = [
    { n: 'Carbohidratos', g: m.choG, p: m.choPct },
    { n: 'Proteínas', g: m.protG, p: m.protPct },
    { n: 'Grasas', g: m.grasaG, p: m.grasaPct },
  ]

  return (
    <div className="space-y-2">
      <p className="text-sm text-ink">
        Valor calórico total:{' '}
        <span className="font-semibold tabular-nums">
          {m.kcal === null ? 'no registrado' : `${m.kcal.toLocaleString('es-CR')} kcal/día`}
        </span>
      </p>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-1.5 pr-3 font-semibold text-ink">Macronutriente</th>
              <th className="py-1.5 pr-3 text-right font-semibold text-ink">Gramos</th>
              <th className="py-1.5 text-right font-semibold text-ink">% del VCT</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.n} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 pr-3 text-ink">{f.n}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-ink">
                  {f.g === null ? '—' : `${f.g} g`}
                </td>
                <td className="py-1.5 text-right tabular-nums text-ink">
                  {f.p === null ? '—' : `${f.p} %`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted">
        {m.fuente === 'calculadora'
          ? 'Cifras de la calculadora nutricional de la consulta. Los porcentajes se calculan desde los gramos (4/4/9 kcal/g), no los redacta la IA.'
          : 'Cifras de la prescripción guardada en la consulta. Los porcentajes se calculan desde los gramos (4/4/9 kcal/g), no los redacta la IA.'}
      </p>
    </div>
  )
}

export function ResumenClinicoModal({
  planId,
  planNombre,
  abierto,
  onCerrar,
  onGenerado,
}: {
  planId: string
  planNombre: string
  abierto: boolean
  onCerrar: () => void
  /** Avisa al histórico de que este plan ya tiene resumen. */
  onGenerado?: () => void
}) {
  const [resumen, setResumen] = useState<ResumenClinico | null>(null)
  const [cargando, setCargando] = useState(true)
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Distingue «todavía no cargué» de «cargué y no hay»: sin esta
  // bandera, el hueco inicial y la ausencia real se ven igual.
  const [consultado, setConsultado] = useState(false)

  const cargar = useCallback(
    async (signal?: AbortSignal) => {
      setCargando(true)
      setError(null)
      try {
        const r = await getResumenPlan(planId, signal)
        if (signal?.aborted) return
        setResumen(r.existe ? (r.resumen ?? null) : null)
        setConsultado(true)
      } catch (e) {
        if (signal?.aborted) return
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof ApiError ? e.message : 'No se pudo cargar el resumen')
        setConsultado(true)
      } finally {
        if (!signal?.aborted) setCargando(false)
      }
    },
    [planId],
  )

  useEffect(() => {
    if (!abierto) return
    const ctrl = new AbortController()
    void cargar(ctrl.signal)
    return () => ctrl.abort()
  }, [abierto, cargar])

  async function generar() {
    setGenerando(true)
    setError(null)
    try {
      const r = await generarResumenPlan(planId)
      setResumen(r.resumen)
      setConsultado(true)
      onGenerado?.()
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : 'No se pudo generar el resumen clínico',
      )
    } finally {
      setGenerando(false)
    }
  }

  const pie = (
    <>
      {consultado && resumen === null && !cargando && (
        <button
          type="button"
          onClick={() => void generar()}
          disabled={generando}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {generando ? 'Generando…' : 'Generar resumen'}
        </button>
      )}
      <button
        type="button"
        onClick={onCerrar}
        className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2"
      >
        Cerrar
      </button>
    </>
  )

  return (
    <Modal
      titulo="Resumen clínico del plan"
      descripcion={planNombre}
      abierto={abierto}
      onCerrar={onCerrar}
      bloqueado={generando}
      pie={pie}
    >
      {cargando ? (
        <div className="space-y-3">
          <div className="h-4 w-1/3 animate-pulse rounded bg-surface-2" />
          <div className="h-20 animate-pulse rounded bg-surface-2" />
          <div className="h-20 animate-pulse rounded bg-surface-2" />
        </div>
      ) : (
        <div className="space-y-4">
          {error && (
            <p
              role="alert"
              className="rounded-md border border-[color:var(--status-alert)] bg-surface-2 p-3 text-sm text-ink"
            >
              {error}
            </p>
          )}

          {resumen === null && !error && (
            <div className="rounded-md border border-dashed border-border bg-surface-2 p-6 text-center">
              <p className="text-sm font-medium text-ink">Este plan todavía no tiene resumen.</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                El resumen se genera al guardar la prescripción. Los planes anteriores a esta
                funcionalidad, y los que se guardaron sin la IA disponible, no tienen uno: puedes
                generarlo ahora con los datos de la consulta.
              </p>
            </div>
          )}

          {resumen && (
            <>
              {/* La marca de IA: quién lo redactó y cuándo. */}
              <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
                {resumen.origen === 'ia' ? (
                  <>
                    Redactado por la IA el {fechaHora(resumen.generadoEn)}
                    {resumen.modelo && ` · ${resumen.modelo}`}. Revísalo antes de compartirlo con el
                    paciente: la decisión clínica es tuya.
                  </>
                ) : (
                  <>
                    Armado el {fechaHora(resumen.generadoEn)} con los datos registrados en la
                    consulta, <strong className="text-ink">sin redacción de la IA</strong>: no estaba
                    disponible al guardar el plan. Puedes generarlo de nuevo cuando lo esté.
                  </>
                )}
              </div>

              {/*
                Scroll propio, no el de la página: el modal se queda
                quieto con su encabezado y su botón de cierre a la vista
                mientras el contenido se recorre. Un resumen de siete
                bloques se pasa de pantalla con facilidad.
              */}
              <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
                {BLOQUES.map(({ clave, titulo }) => {
                  const texto = resumen.bloques[clave]
                  const esMacros = clave === 'distribucionMacros'
                  const tabla = esMacros && resumen.macros && resumen.macros.fuente !== 'ausente'

                  return (
                    <section key={clave}>
                      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                        {titulo}
                      </h3>
                      {tabla ? (
                        <TablaMacros m={resumen.macros!} />
                      ) : texto ? (
                        // `whitespace-pre-line` conserva los saltos del
                        // texto generado sin interpretar markdown: lo que
                        // se guardó es lo que se ve.
                        <p className="whitespace-pre-line text-sm leading-relaxed text-ink">
                          {texto}
                        </p>
                      ) : (
                        <p className="text-sm italic text-muted">
                          Sin contenido para este bloque.
                        </p>
                      )}
                    </section>
                  )
                })}
              </div>

              {resumen.origen === 'datos' && (
                <button
                  type="button"
                  onClick={() => void generar()}
                  disabled={generando}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
                >
                  {generando ? 'Generando…' : 'Generar la redacción con IA'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
