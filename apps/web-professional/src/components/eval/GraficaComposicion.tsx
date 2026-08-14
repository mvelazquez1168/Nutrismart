/**
 * Evolución de la composición corporal — EVAL-01.
 *
 * SVG a mano, sin librería de gráficas. Son dos series sobre un eje de
 * tiempo con pocos puntos; añadir una dependencia de gráficas al
 * proyecto por esto no se sostiene, y así los colores salen de los
 * tokens como el resto.
 *
 * Área APILADA de masa libre de grasa + masa grasa: el borde superior
 * ES el peso total, así que no se dibuja además una línea de peso —
 * sería el mismo dato dos veces, y en una gráfica eso invita a
 * compararlos entre sí.
 */
import type { Medicion } from '../../api/valoracion'

const ALTO = 200
const ANCHO = 640
const MARGEN = { arriba: 12, derecha: 12, abajo: 28, izquierda: 40 }

function fechaCorta(iso: string): string {
  const [, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}

export function GraficaComposicion({ mediciones }: { mediciones: Medicion[] }) {
  // Solo las que tienen las dos piezas: media serie dibujada produce un
  // hueco que se lee como una caída a cero.
  const puntos = mediciones
    .filter((m) => m.masaLibreGrasaKg !== null && m.masaGrasaKg !== null)
    .slice()
    .sort((a, b) => a.fechaMedicion.localeCompare(b.fechaMedicion))

  if (puntos.length < 2) {
    return (
      <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
        {puntos.length === 0
          ? 'Aún no hay mediciones de composición corporal.'
          : 'Primera medición registrada. La evolución aparece a partir de la segunda.'}
      </p>
    )
  }

  const totales = puntos.map((p) => (p.masaLibreGrasaKg ?? 0) + (p.masaGrasaKg ?? 0))
  const maximo = Math.max(...totales) * 1.1
  const anchoUtil = ANCHO - MARGEN.izquierda - MARGEN.derecha
  const altoUtil = ALTO - MARGEN.arriba - MARGEN.abajo

  const x = (i: number) =>
    MARGEN.izquierda + (puntos.length === 1 ? anchoUtil / 2 : (i / (puntos.length - 1)) * anchoUtil)
  const y = (v: number) => MARGEN.arriba + altoUtil - (v / maximo) * altoUtil

  const areaDe = (valores: number[], base: number[]) => {
    const arriba = valores.map((v, i) => `${x(i)},${y(v)}`).join(' L')
    // Se recorre al revés para cerrar el polígono por debajo.
    const abajo = base
      .map((_, i) => `${x(base.length - 1 - i)},${y(base[base.length - 1 - i] ?? 0)}`)
      .join(' L')
    return `M${arriba} L${abajo} Z`
  }

  const magras = puntos.map((p) => p.masaLibreGrasaKg ?? 0)
  const ceros = puntos.map(() => 0)

  return (
    <figure className="rounded-lg border border-border bg-surface p-4">
      <figcaption className="mb-3 text-sm font-semibold text-ink">
        Composición corporal por consulta
        <span className="ml-2 font-normal text-muted">
          El borde superior del área es el peso total
        </span>
      </figcaption>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${ANCHO} ${ALTO}`}
          className="h-auto w-full min-w-[32rem]"
          role="img"
          aria-label={`Evolución de la composición corporal en ${puntos.length} mediciones`}
        >
          {/* Rejilla recesiva: orienta sin competir con los datos. */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const valor = maximo * (1 - f)
            const py = MARGEN.arriba + f * altoUtil
            return (
              <g key={f}>
                <line
                  x1={MARGEN.izquierda}
                  x2={ANCHO - MARGEN.derecha}
                  y1={py}
                  y2={py}
                  stroke="var(--chart-grid)"
                  strokeWidth="1"
                />
                <text
                  x={MARGEN.izquierda - 6}
                  y={py + 3}
                  textAnchor="end"
                  fontSize="9"
                  fill="var(--muted)"
                >
                  {Math.round(valor)}
                </text>
              </g>
            )
          })}

          {/* Masa grasa arriba y masa magra abajo: lo que cambia con el
              tratamiento queda contra la rejilla, más fácil de leer. */}
          <path d={areaDe(totales, magras)} fill="var(--chart-2)" fillOpacity="0.45" />
          <path d={areaDe(magras, ceros)} fill="var(--chart-3)" fillOpacity="0.55" />

          <polyline
            points={totales.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
            fill="none"
            stroke="var(--ink)"
            strokeWidth="2"
          />

          {totales.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2">
              <title>
                {fechaCorta(puntos[i]?.fechaMedicion ?? '')} · {v.toFixed(1)} kg
                {' · grasa '}
                {(puntos[i]?.masaGrasaKg ?? 0).toFixed(1)} kg
              </title>
            </circle>
          ))}

          {puntos.map((p, i) => (
            <text
              key={p.id}
              x={x(i)}
              y={ALTO - 8}
              textAnchor="middle"
              fontSize="9"
              fill="var(--muted)"
            >
              {fechaCorta(p.fechaMedicion)}
            </text>
          ))}
        </svg>
      </div>

      {/* Leyenda siempre presente con dos series: el color solo no
          identifica nada por sí mismo. */}
      <ul className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: 'var(--chart-3)' }}
          />
          Masa libre de grasa
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: 'var(--chart-2)' }}
          />
          Masa grasa
        </li>
      </ul>
    </figure>
  )
}
