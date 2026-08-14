/**
 * Interpretación de laboratorios asistida por IA — IA-01.
 *
 * Todo lo que se muestra aquí va rotulado como sugerencia, con el modelo
 * que lo escribió y un aviso al pie. La regla del proyecto: la IA
 * asiste, el profesional decide.
 *
 * Si la IA no está disponible, este panel lo dice y el resto de la
 * pantalla de laboratorios sigue funcionando igual.
 */
import { useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import {
  getInterpretacion,
  interpretar,
  motivoIaCaida,
  revisarInterpretacion,
  type Interpretacion,
} from '../../api/ia'

const SECCIONES = [
  'RESUMEN CLÍNICO',
  'IMPLICACIONES NUTRICIONALES',
  'RECOMENDACIONES DIETÉTICAS',
  'SEGUIMIENTO PRIORITARIO',
]

/** Marca los encabezados de sección sin interpretar el resto del texto. */
function Cuerpo({ texto }: { texto: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-ink">
      {texto.split(/\r?\n/).map((linea, i) => {
        const limpia = linea.replace(/\*\*/g, '').replace(/^#{1,6}\s*/, '').trim()
        if (limpia === '') return null
        const esTitulo = SECCIONES.some(
          (s) => limpia.toUpperCase().replace(/[:.]$/, '') === s,
        )
        return esTitulo ? (
          <h4 key={i} className="pt-2 text-xs font-bold uppercase tracking-wide text-primary">
            {limpia.replace(/[:.]$/, '')}
          </h4>
        ) : (
          <p key={i}>{limpia}</p>
        )
      })}
    </div>
  )
}

function ChipIA() {
  return (
    <span
      className="rounded-pill px-2 py-0.5 text-xs font-semibold"
      style={{
        color: 'var(--status-alert)',
        backgroundColor: 'color-mix(in srgb, var(--status-alert) 16%, transparent)',
      }}
    >
      Sugerencia de IA
    </span>
  )
}

export function PanelInterpretacionIA({ estudioId }: { estudioId: string }) {
  const [dato, setDato] = useState<Interpretacion | null>(null)
  const [cargando, setCargando] = useState(true)
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setCargando(true)
    setDato(null)
    setError(null)
    getInterpretacion(estudioId, ctrl.signal)
      .then((d) => {
        if (!ctrl.signal.aborted) setDato(d)
      })
      // 404 = aún no se ha interpretado. Es el estado inicial, no un fallo.
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false)
      })
    return () => ctrl.abort()
  }, [estudioId])

  async function generar() {
    setGenerando(true)
    setError(null)
    try {
      setDato(await interpretar(estudioId))
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 503
          ? motivoIaCaida(e.tipo)
          : e instanceof ApiError
            ? e.message
            : 'No se pudo generar la interpretación',
      )
    } finally {
      setGenerando(false)
    }
  }

  async function marcarRevisada() {
    if (!dato) return
    try {
      await revisarInterpretacion(estudioId, dato.id)
      setDato({ ...dato, revisada: true })
    } catch {
      setError('No se pudo marcar como revisada')
    }
  }

  if (cargando) return <div className="h-32 animate-pulse rounded-lg bg-surface-2" />

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-ink">Interpretación asistida</h3>
          {dato && <ChipIA />}
          {dato?.revisada && (
            <span
              className="rounded-pill px-2 py-0.5 text-xs font-semibold"
              style={{
                color: 'var(--status-normal)',
                backgroundColor: 'color-mix(in srgb, var(--status-normal) 14%, transparent)',
              }}
            >
              Revisada
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => void generar()}
          disabled={generando}
          className="rounded-md border border-primary px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary-tint disabled:opacity-60"
        >
          {generando ? 'Analizando…' : dato ? 'Volver a interpretar' : 'Interpretar con IA'}
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--status-alert)] bg-surface p-3 text-sm text-ink"
        >
          {error}
        </p>
      )}

      {!dato && !error && (
        <p className="text-sm text-muted">
          Todavía no hay una interpretación de este estudio. Se redacta a partir de los valores y
          de los rangos de referencia de la clínica.
        </p>
      )}

      {dato && (
        <>
          <Cuerpo texto={dato.interpretacion} />

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-xs text-muted">
              Generado por {dato.modelo}
              {dato.tokensSalida !== null && ` · ${dato.tokensSalida} tokens`}
              {dato.profesional && ` · solicitado por ${dato.profesional}`}
              {dato.revisadaPor && ` · revisada por ${dato.revisadaPor}`}
            </p>
            {!dato.revisada && (
              <button
                type="button"
                onClick={() => void marcarRevisada()}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2"
              >
                Marcar como revisada
              </button>
            )}
          </div>

          <p className="text-xs text-muted">
            Esto es una <strong>sugerencia generada por IA</strong> a partir de los valores de este
            estudio. No sustituye tu criterio: revísala antes de actuar sobre ella y ten en cuenta
            que el modelo no conoce el resto del contexto clínico del paciente.
          </p>
        </>
      )}
    </section>
  )
}
