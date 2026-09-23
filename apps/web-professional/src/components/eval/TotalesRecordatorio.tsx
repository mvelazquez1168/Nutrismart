/**
 * Totales calculados del recordatorio, dentro de «Resumen y macros» — R41.
 *
 * ── Qué suma ────────────────────────────────────────────────────────
 *
 * Las filas del Recordatorio de 24 h y las del Consumo Usual, cada una
 * por su lado: son dos fotos distintas —lo de ayer y lo de siempre— y
 * mezclarlas daría un día que el paciente no ha tenido.
 *
 * Las kcal cuentan la corrección manual del profesional cuando la hay,
 * igual que el pie de cada tabla. Los gramos son los de la IA.
 *
 * ── Por qué no rellena los macros declarados solo ───────────────────
 *
 * Porque son cosas distintas y la de arriba manda. Lo declarado es lo
 * que el profesional firma; esto es una estimación del método ADA hecha
 * por un modelo. Se enseña al lado, y copiarlo es un clic explícito —el
 * mismo criterio que rige el resto de salidas de IA del proyecto.
 */
import { useEffect, useState } from 'react'
import {
  getRegistroDietetico,
  type FilaDietetica,
  type TipoRegistro,
} from '../../api/registroDietetico'

interface Suma {
  kcal: number
  cho: number
  prot: number
  grasas: number
}

const FUENTES: { tipo: TipoRegistro; etiqueta: string }[] = [
  { tipo: 'recordatorio_24h', etiqueta: 'Recordatorio de 24 horas' },
  { tipo: 'consumo_usual', etiqueta: 'Consumo Usual' },
]

/** null si no hay ni una fila con kcal: no es un cero, es que no se ha calculado. */
function sumar(filas: FilaDietetica[]): Suma | null {
  const t: Suma = { kcal: 0, cho: 0, prot: 0, grasas: 0 }
  let hayAlgo = false
  for (const f of filas) {
    const kcal = f.kcal_manual ?? f.ai_kcal
    if (kcal === null) continue
    hayAlgo = true
    t.kcal += kcal
    t.cho += f.ai_cho_g ?? 0
    t.prot += f.ai_prot_g ?? 0
    t.grasas += f.ai_grasas_g ?? 0
  }
  return hayAlgo ? t : null
}

export function TotalesRecordatorio({
  pacienteId,
  consultaId,
  onCopiar,
}: {
  pacienteId: string
  consultaId: string
  /** Vuelca una suma en los macros declarados. Ausente = sin botón (consulta cerrada). */
  onCopiar?: (s: Suma) => void
}) {
  const [sumas, setSumas] = useState<Record<string, Suma | null>>({})
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    const ctrl = new AbortController()
    setCargando(true)
    Promise.all(
      FUENTES.map((f) =>
        getRegistroDietetico(pacienteId, consultaId, f.tipo, ctrl.signal)
          .then((r) => [f.tipo, sumar(r.filas)] as const)
          // Sin registro todavía: no es un fallo, es que no se ha llenado.
          .catch(() => [f.tipo, null] as const),
      ),
    )
      .then((pares) => {
        if (!ctrl.signal.aborted) setSumas(Object.fromEntries(pares))
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false)
      })
    return () => ctrl.abort()
  }, [pacienteId, consultaId])

  if (cargando) return <div className="h-28 animate-pulse rounded-lg bg-surface-2" />

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
      <div>
        <h3 className="font-semibold text-ink">Totales calculados del recordatorio</h3>
        <p className="mt-0.5 text-xs text-muted">
          Estimación del método ADA sobre lo que se escribió en cada tiempo de comida. Es una
          sugerencia: los macros declarados arriba siguen siendo los que valen.
        </p>
      </div>

      {FUENTES.map((f) => {
        const s = sumas[f.tipo] ?? null
        return (
          <div
            key={f.tipo}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-2 p-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{f.etiqueta}</p>
              {s === null ? (
                <p className="text-xs text-muted">
                  Sin analizar. Usa «Analizar IA» en cada tiempo de comida, o escribe las kcal a
                  mano.
                </p>
              ) : (
                <p className="text-sm tabular-nums text-ink">
                  Total CHO: <strong>{s.cho.toFixed(1)} g</strong> · Total Proteína:{' '}
                  <strong>{s.prot.toFixed(1)} g</strong> · Total Grasas:{' '}
                  <strong>{s.grasas.toFixed(1)} g</strong> · Total kcal:{' '}
                  <strong className="text-primary">{s.kcal.toFixed(0)}</strong>
                </p>
              )}
            </div>

            {s !== null && onCopiar && (
              <button
                type="button"
                onClick={() => onCopiar(s)}
                className="shrink-0 rounded-md border border-primary px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-tint"
              >
                Copiar a los macros declarados
              </button>
            )}
          </div>
        )
      })}
    </section>
  )
}
