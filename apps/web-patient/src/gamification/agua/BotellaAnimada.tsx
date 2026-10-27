import { useState } from 'react'
import { useAgua } from './useAgua'

/**
 * La botella que se llena — R55.
 *
 * Un SVG, no una imagen: el nivel del agua es un `<rect>` cuya altura
 * sale del porcentaje, y animarlo es una transición de CSS. Con un PNG
 * harían falta veinte estados o un recorte por JavaScript.
 *
 * ── Por qué el agua sube desde abajo ────────────────────────────────
 *
 * En SVG el origen está ARRIBA: un rectángulo con `y` fijo y altura
 * creciente crece hacia abajo, que es exactamente al revés de como se
 * llena un vaso. Se mueven las dos cosas a la vez —`y` baja mientras
 * `height` sube— y las dos transicionan juntas.
 */

/** Un vaso y un vaso grande. Para cantidades raras se repite el toque. */
const RAPIDOS = [250, 500] as const

/** Geometría del cuerpo de la botella, en coordenadas del viewBox. */
const CUERPO = { x: 14, y: 26, ancho: 36, alto: 62, radio: 10 }

const AZUL = '#38bdf8'

export function BotellaAnimada() {
  const { meta, registrado, pct, cargando, error, registrarMl } = useAgua()
  const [ocupado, setOcupado] = useState(false)

  async function sumar(ml: number) {
    if (ocupado) return
    setOcupado(true)
    try {
      await registrarMl(ml)
    } finally {
      setOcupado(false)
    }
  }

  // Altura del agua y su borde superior. Ver la nota de arriba.
  const altoAgua = (CUERPO.alto * pct) / 100
  const yAgua = CUERPO.y + CUERPO.alto - altoAgua

  if (cargando) {
    return <div className="h-40 animate-pulse rounded-md bg-surface-2" />
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <svg
          viewBox="0 0 64 96"
          className="h-32 w-auto shrink-0"
          role="img"
          aria-label={
            meta
              ? `Botella de agua: ${registrado} de ${meta} mililitros, ${pct} por ciento`
              : `Botella de agua: ${registrado} mililitros, sin meta definida`
          }
        >
          <defs>
            {/* Recorta el agua con la forma del cuerpo: sin esto, el
                rectángulo asoma por las esquinas redondeadas. */}
            <clipPath id="agua-cuerpo">
              <rect
                x={CUERPO.x}
                y={CUERPO.y}
                width={CUERPO.ancho}
                height={CUERPO.alto}
                rx={CUERPO.radio}
              />
            </clipPath>
          </defs>

          {/* Tapón y cuello */}
          <rect x="26" y="6" width="12" height="7" rx="2" fill="var(--muted)" opacity="0.5" />
          <rect x="28" y="13" width="8" height="13" fill="var(--border)" />

          {/* Cuerpo vacío */}
          <rect
            x={CUERPO.x}
            y={CUERPO.y}
            width={CUERPO.ancho}
            height={CUERPO.alto}
            rx={CUERPO.radio}
            fill="var(--surface-2)"
            stroke="var(--border)"
            strokeWidth="2"
          />

          {/* El agua */}
          <g clipPath="url(#agua-cuerpo)">
            <rect
              x={CUERPO.x}
              y={yAgua}
              width={CUERPO.ancho}
              height={altoAgua}
              fill={AZUL}
              style={{ transition: 'y 0.6s ease, height 0.6s ease' }}
            />
            {/* Una línea más clara en la superficie: es lo que hace que
                se lea como líquido y no como una barra de progreso
                girada. */}
            {pct > 0 && (
              <rect
                x={CUERPO.x}
                y={yAgua}
                width={CUERPO.ancho}
                height="3"
                fill="#7dd3fc"
                style={{ transition: 'y 0.6s ease' }}
              />
            )}
          </g>

          {/* El borde se repinta ENCIMA del agua para que no quede
              tapado por el relleno. */}
          <rect
            x={CUERPO.x}
            y={CUERPO.y}
            width={CUERPO.ancho}
            height={CUERPO.alto}
            rx={CUERPO.radio}
            fill="none"
            stroke="var(--border)"
            strokeWidth="2"
          />
        </svg>

        <div className="min-w-0 flex-1">
          {meta ? (
            <>
              <p className="text-2xl font-bold tabular-nums text-ink">
                {registrado}
                <span className="text-sm font-normal text-muted"> / {meta} ml</span>
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {pct >= 100 ? '¡Meta del día cumplida!' : `Llevas el ${pct}% de tu meta.`}
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold tabular-nums text-ink">
                {registrado}
                <span className="text-sm font-normal text-muted"> ml</span>
              </p>
              {/* Sin meta se sigue pudiendo apuntar: el dato le sirve al
                  profesional aunque todavía no haya indicado cuánto. */}
              <p className="mt-0.5 text-xs text-muted">
                Tu nutricionista aún no definió tu meta de agua.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        {RAPIDOS.map((ml) => (
          <button
            key={ml}
            type="button"
            onClick={() => void sumar(ml)}
            disabled={ocupado}
            className="flex-1 rounded-md border border-border bg-surface py-2 text-sm font-medium text-primary disabled:opacity-60"
          >
            +{ml} ml
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
