import { useState } from 'react'
import { PALETAS, PALETAS_LISTA, type ClavePaleta } from '../../lib/palette'

/**
 * Los diez colores de la app — R53.
 *
 * El toque repinta la app entera al instante y la petición va detrás.
 * Es una preferencia visual: esperar a que viaje hace que el selector
 * parezca roto, y si falla se vuelve al color anterior sin que se haya
 * perdido nada.
 */
export function SelectorPaleta({
  actual,
  onElegir,
}: {
  actual: string
  onElegir: (clave: ClavePaleta) => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function elegir(clave: ClavePaleta) {
    if (ocupado || clave === actual) return
    setOcupado(true)
    setError(null)
    try {
      await onElegir(clave)
    } catch {
      setError('No se pudo guardar el color. Vuelve a intentarlo.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div>
      <ul className="grid grid-cols-5 gap-x-2 gap-y-3">
        {PALETAS_LISTA.map(({ clave, etiqueta }) => {
          const p = PALETAS[clave]
          const activa = clave === actual
          return (
            <li key={clave}>
              <button
                type="button"
                onClick={() => void elegir(clave)}
                aria-pressed={activa}
                aria-label={etiqueta}
                className="flex w-full flex-col items-center gap-1"
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-pill text-sm font-bold text-white ${
                    activa ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : ''
                  }`}
                  style={{ backgroundColor: p.primary }}
                >
                  {/* El tilde va DENTRO del círculo y no en una esquina:
                      a 40 px una insignia colgando se sale de la celda y
                      pisa la de al lado. */}
                  {activa ? '✓' : ''}
                </span>
                <span
                  className={`w-full text-center text-[0.65rem] leading-tight ${
                    activa ? 'font-semibold text-ink' : 'text-muted'
                  }`}
                >
                  {etiqueta}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {error && (
        <p role="alert" className="mt-3 text-xs" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
