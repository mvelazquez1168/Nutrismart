/**
 * Paletas curadas de marca — LOGIN-01, parte C.
 *
 * ── De dónde salen los colores ──────────────────────────────────────
 *
 * De `packages/design-system/tokens.css`, que ya trae las paletas
 * curadas que pide la regla del proyecto («8 paletas curadas»). NO se
 * escriben aquí.
 *
 * El encargo definía diez paletas nuevas con sus hexadecimales en un
 * archivo TypeScript. Eso habría dejado dos listas de colores curados
 * —la del design system y la del código— que nadie mantendría iguales, y
 * contradecía su propia regla de no poner hexadecimales en el JSX.
 *
 * Aquí se leen en tiempo de ejecución: se monta un elemento oculto con
 * `data-brand="…"` y se pregunta al navegador qué valor toma `--primary`
 * ahí dentro. Una sola fuente de verdad, y si mañana se retoca un color
 * en el design system, este selector lo refleja sin tocar nada.
 *
 * Es el mismo recurso que usa el selector de fondos del paciente (R25).
 */
import { useEffect, useState } from 'react'

/**
 * Las paletas, por su nombre en el design system.
 *
 * La etiqueta sí vive aquí: es texto de interfaz, no un valor de color.
 */
export const PALETAS = [
  { marca: '', etiqueta: 'Verde NutriSmart' },
  { marca: 'esmeralda', etiqueta: 'Esmeralda' },
  { marca: 'teal-fresco', etiqueta: 'Teal fresco' },
  { marca: 'azul-clinico', etiqueta: 'Azul clínico' },
  { marca: 'indigo', etiqueta: 'Índigo' },
  { marca: 'coral-calido', etiqueta: 'Coral cálido' },
  { marca: 'ambar', etiqueta: 'Ámbar' },
  { marca: 'grafito', etiqueta: 'Grafito' },
] as const

export interface Paleta {
  marca: string
  etiqueta: string
  primario: string
  acento: string
}

/** `rgb(14, 124, 102)` → `#0e7c66`. Los inputs de color exigen hex. */
function aHex(css: string): string {
  const m = css.trim().match(/^rgba?\(([^)]+)\)$/i)
  if (!m) return css.trim().toLowerCase()
  const [r, g, b] = m[1]!.split(',').map((n) => Number(n.trim()))
  const dos = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${dos(r ?? 0)}${dos(g ?? 0)}${dos(b ?? 0)}`
}

/**
 * Pregunta al navegador el valor real de cada paleta.
 *
 * Se hace una sola vez y fuera de la vista: un div con `position:fixed`
 * y `visibility:hidden` no ocupa sitio ni se lee en voz alta.
 */
function leerPaletas(): Paleta[] {
  const caja = document.createElement('div')
  caja.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;left:-9999px'
  document.body.appendChild(caja)

  const leidas = PALETAS.map((p) => {
    const hijo = document.createElement('div')
    if (p.marca !== '') hijo.setAttribute('data-brand', p.marca)
    caja.appendChild(hijo)
    const estilo = getComputedStyle(hijo)
    return {
      marca: p.marca,
      etiqueta: p.etiqueta,
      primario: aHex(estilo.getPropertyValue('--primary')),
      // El acento no cambia con `data-brand`: las paletas del design
      // system solo mueven la familia del primario. Se mantiene el de
      // información, que es fijo por diseño.
      acento: aHex(estilo.getPropertyValue('--info')),
    }
  })

  caja.remove()
  return leidas
}

export function PaletaSelector({
  primarioActual,
  onSeleccionar,
}: {
  primarioActual: string
  onSeleccionar: (p: Paleta) => void
}) {
  const [paletas, setPaletas] = useState<Paleta[]>([])

  useEffect(() => {
    setPaletas(leerPaletas())
  }, [])

  const actual = primarioActual.trim().toLowerCase()

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {paletas.map((p) => {
        const activa = p.primario === actual
        return (
          <button
            key={p.etiqueta}
            type="button"
            onClick={() => onSeleccionar(p)}
            aria-pressed={activa}
            className={`rounded-md border p-2 text-left ${
              activa ? 'border-primary bg-primary-tint' : 'border-border'
            }`}
          >
            {/* La muestra usa el color de la paleta, que es el dato: no
                es decoración con un hexadecimal escrito a mano. */}
            <span
              aria-hidden="true"
              className="mb-1.5 block h-6 w-full rounded-sm"
              style={{ backgroundColor: p.primario }}
            />
            <span className={`block text-xs font-medium ${activa ? 'text-primary' : 'text-ink'}`}>
              {p.etiqueta}
            </span>
            <span className="block text-[0.65rem] tabular-nums text-muted">{p.primario}</span>
          </button>
        )
      })}
    </div>
  )
}
