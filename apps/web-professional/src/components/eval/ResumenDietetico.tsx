/**
 * Resumen de macronutrientes — EVAL-04.
 *
 * Los macros los declara el profesional; el sistema NO los deduce del
 * recordatorio. Deducirlos exigiría una tabla de composición de
 * alimentos, y sin ella cualquier cifra automática sería inventada con
 * apariencia de cálculo.
 *
 * Lo único que sí se calcula es la coherencia: las kilocalorías que
 * suman los macros declarados (4/4/9 kcal por gramo), para que un
 * descuadre grande salte a la vista.
 */
import { claseControl } from '../Campo'

interface Macros {
  kcal: string
  proteina: string
  cho: string
  grasa: string
  fibra: string
}

const KCAL_POR_GRAMO = { proteina: 4, cho: 4, grasa: 9 }

const CAMPOS = [
  { clave: 'kcal', etiqueta: 'Kilocalorías totales', unidad: 'kcal' },
  { clave: 'proteina', etiqueta: 'Proteína', unidad: 'g' },
  { clave: 'cho', etiqueta: 'Carbohidratos', unidad: 'g' },
  { clave: 'grasa', etiqueta: 'Grasa', unidad: 'g' },
  { clave: 'fibra', etiqueta: 'Fibra', unidad: 'g' },
] as const

const TONO = {
  proteina: 'var(--chart-1)',
  cho: 'var(--chart-3)',
  grasa: 'var(--chart-4)',
} as const

function n(v: string): number {
  const x = Number(v)
  return Number.isFinite(x) && x > 0 ? x : 0
}

/** Sector de un donut, en coordenadas SVG. */
function sector(desde: number, hasta: number, r = 60, R = 90): string {
  const p = (a: number, radio: number) => {
    const rad = ((a - 90) * Math.PI) / 180
    return `${100 + radio * Math.cos(rad)},${100 + radio * Math.sin(rad)}`
  }
  const grande = hasta - desde > 180 ? 1 : 0
  return `M${p(desde, R)} A${R},${R} 0 ${grande},1 ${p(hasta, R)} L${p(hasta, r)} A${r},${r} 0 ${grande},0 ${p(desde, r)} Z`
}

export function ResumenDietetico({
  macros,
  onCambio,
  bloqueada,
}: {
  macros: Macros
  onCambio: (m: Macros) => void
  bloqueada: boolean
}) {
  const g = { proteina: n(macros.proteina), cho: n(macros.cho), grasa: n(macros.grasa) }
  const kcalDe = {
    proteina: g.proteina * KCAL_POR_GRAMO.proteina,
    cho: g.cho * KCAL_POR_GRAMO.cho,
    grasa: g.grasa * KCAL_POR_GRAMO.grasa,
  }
  const kcalMacros = kcalDe.proteina + kcalDe.cho + kcalDe.grasa
  const kcalDeclaradas = n(macros.kcal)

  // Un descuadre por encima del 10 % suele ser un macro mal tecleado.
  const descuadre =
    kcalDeclaradas > 0 && kcalMacros > 0
      ? Math.abs(kcalDeclaradas - kcalMacros) / kcalDeclaradas
      : 0

  let acumulado = 0
  const sectores = (['proteina', 'cho', 'grasa'] as const)
    .filter((k) => kcalDe[k] > 0)
    .map((k) => {
      const porcion = (kcalDe[k] / kcalMacros) * 360
      const desde = acumulado
      acumulado += porcion
      return { clave: k, desde, hasta: acumulado, pct: (kcalDe[k] / kcalMacros) * 100 }
    })

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
        <h3 className="font-semibold text-ink">Macronutrientes declarados</h3>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CAMPOS.map((c) => (
            <div key={c.clave}>
              <label htmlFor={`m-${c.clave}`} className="mb-1 block text-sm text-ink">
                {c.etiqueta} ({c.unidad})
              </label>
              <input
                id={`m-${c.clave}`}
                type="number"
                min={0}
                step="0.1"
                value={macros[c.clave]}
                disabled={bloqueada}
                onChange={(e) => onCambio({ ...macros, [c.clave]: e.target.value })}
                className={claseControl(false)}
              />
            </div>
          ))}
        </div>

        <p className="text-xs text-muted">
          Estimación del profesional a partir del recordatorio. El sistema no calcula los macros:
          no hay tabla de composición de alimentos detrás.
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <h3 className="font-semibold text-ink">Reparto energético</h3>

        {kcalMacros === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            Introduce proteína, carbohidratos y grasa para ver el reparto.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-6">
              <svg
                viewBox="0 0 200 200"
                className="h-40 w-40 shrink-0"
                role="img"
                aria-label={`Reparto energético: ${sectores
                  .map((s) => `${s.clave} ${s.pct.toFixed(0)} por ciento`)
                  .join(', ')}`}
              >
                {sectores.map((s) => (
                  <path key={s.clave} d={sector(s.desde, s.hasta)} fill={TONO[s.clave]} />
                ))}
                <text
                  x="100"
                  y="96"
                  textAnchor="middle"
                  fontSize="20"
                  fontWeight="700"
                  fill="var(--ink)"
                >
                  {Math.round(kcalMacros)}
                </text>
                <text x="100" y="114" textAnchor="middle" fontSize="10" fill="var(--muted)">
                  kcal de macros
                </text>
              </svg>

              {/* Leyenda con el porcentaje escrito: el color no
                  identifica nada por sí solo. */}
              <ul className="space-y-2 text-sm">
                {sectores.map((s) => (
                  <li key={s.clave} className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-3 w-3 rounded-sm"
                      style={{ backgroundColor: TONO[s.clave] }}
                    />
                    <span className="text-ink">
                      {s.clave === 'cho' ? 'Carbohidratos' : s.clave === 'grasa' ? 'Grasa' : 'Proteína'}
                    </span>
                    <span className="tabular-nums text-muted">
                      {s.pct.toFixed(0)} % · {Math.round(kcalDe[s.clave])} kcal
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {descuadre > 0.1 && (
              <p className="rounded-md border border-[color:var(--status-alert)] bg-surface p-3 text-sm text-ink">
                Las kilocalorías declaradas ({Math.round(kcalDeclaradas)}) y las que suman los
                macros ({Math.round(kcalMacros)}) se separan un{' '}
                {Math.round(descuadre * 100)} %. Suele ser un valor mal tecleado.
              </p>
            )}
          </>
        )}

        {/* La comparación contra necesidades depende de la calculadora
            nutricional, que llega con las conclusiones. */}
        <p className="rounded-md border border-border bg-surface-2 p-3 text-sm text-muted">
          La comparación con los requerimientos del paciente aparecerá cuando la calculadora
          nutricional esté disponible, en la sección de conclusiones.
        </p>
      </section>
    </div>
  )
}
