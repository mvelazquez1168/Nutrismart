/**
 * Interacciones fármaco–nutriente — apoyo a EVAL-03.
 *
 * Lo delicado de esta pantalla no son las interacciones que muestra,
 * sino cómo enuncia su ausencia. Un «sin interacciones» a secas se lee
 * como una comprobación completa, y esta lista cubre ocho principios
 * activos. Por eso siempre se dice cuántos cubre y cuáles no reconoció.
 */
import type { Interaccion, RevisionInteracciones, Severidad } from '../../api/clinico'

const TONO: Record<Severidad, { color: string; etiqueta: string; icono: string }> = {
  importante: { color: 'var(--status-critical)', etiqueta: 'Importante', icono: '⛔' },
  advertencia: { color: 'var(--status-alert)', etiqueta: 'Vigilar', icono: '⚠' },
  info: { color: 'var(--chart-1)', etiqueta: 'Informativo', icono: 'ℹ' },
}

function Tarjeta({ interaccion }: { interaccion: Interaccion }) {
  const t = TONO[interaccion.severidad]
  return (
    <li
      className="rounded-md border-l-4 border border-border bg-surface p-3"
      style={{ borderLeftColor: t.color }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true">{t.icono}</span>
        {/* La severidad va escrita, no solo en el color del borde. */}
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: t.color }}>
          {t.etiqueta}
        </span>
        <span className="text-sm font-medium text-ink">{interaccion.medicamento}</span>
        <span aria-hidden="true" className="text-muted">
          →
        </span>
        <span className="text-sm text-ink">{interaccion.nutrientes.join(', ')}</span>
      </div>
      <p className="mt-1 text-sm text-muted">{interaccion.recomendacion}</p>
    </li>
  )
}

export function InteraccionesPanel({
  revision,
  onAnadirANotas,
}: {
  revision: RevisionInteracciones | null
  /** Vuelca las recomendaciones en las notas del historial. */
  onAnadirANotas?: (texto: string) => void
}) {
  if (!revision) return null

  const { interacciones, noReconocidos, cobertura } = revision
  const hayAlgo = interacciones.length > 0

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-ink">Interacciones fármaco–nutriente</h3>
        {hayAlgo && onAnadirANotas && (
          <button
            type="button"
            onClick={() =>
              onAnadirANotas(
                interacciones
                  .map((i) => `${i.medicamento} → ${i.nutrientes.join(', ')}: ${i.recomendacion}`)
                  .join('\n'),
              )
            }
            className="text-sm font-medium text-primary hover:underline"
          >
            Añadir a las notas
          </button>
        )}
      </div>

      {hayAlgo ? (
        <ul className="space-y-2">
          {interacciones.map((i) => (
            <Tarjeta key={`${i.medicamento}-${i.principio}`} interaccion={i} />
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-border bg-surface-2 p-3 text-sm text-ink">
          Ninguno de los medicamentos registrados figura entre los{' '}
          <strong>{cobertura} principios activos</strong> que cubre esta revisión.
        </p>
      )}

      {noReconocidos.length > 0 && (
        <p className="rounded-md border border-border bg-surface-2 p-3 text-sm text-muted">
          <span className="font-medium text-ink">Fuera de la revisión: </span>
          {noReconocidos.join(', ')}. No significa que no interactúen — significa que esta lista no
          los contempla.
        </p>
      )}

      <p className="text-xs text-muted">
        Lista curada de interacciones bien documentadas, como ayuda de memoria.{' '}
        <strong>No es un comprobador de interacciones</strong> ni sustituye la consulta de una
        fuente farmacológica ni el juicio clínico.
      </p>
    </section>
  )
}
