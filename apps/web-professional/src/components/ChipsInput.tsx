/**
 * Entrada de etiquetas (chips) para diagnósticos y alergias.
 *
 * Enter o coma confirman el chip. Retroceso con el campo vacío borra el
 * último — el atajo que la gente ya espera de este control.
 *
 * Al perder el foco también se confirma lo escrito: dejar texto a medias
 * y pulsar "Guardar" perdería el dato en silencio, que es justo lo que
 * no puede pasar con una alergia.
 */
import { useState, type KeyboardEvent } from 'react'
import { claseControl } from './Campo'

interface Props {
  id: string
  valores: string[]
  onCambio: (valores: string[]) => void
  placeholder?: string
  hayError?: boolean
  /** Atajos para valores frecuentes, p. ej. "Ninguna". */
  sugerencias?: string[]
  disabled?: boolean
}

export function ChipsInput({
  id,
  valores,
  onCambio,
  placeholder,
  hayError = false,
  sugerencias = [],
  disabled = false,
}: Props) {
  const [borrador, setBorrador] = useState('')

  function agregar(texto: string) {
    const limpio = texto.trim()
    if (!limpio) return
    // Comparación sin distinguir mayúsculas: "Penicilina" y "penicilina"
    // son la misma alergia.
    if (valores.some((v) => v.toLowerCase() === limpio.toLowerCase())) {
      setBorrador('')
      return
    }
    onCambio([...valores, limpio])
    setBorrador('')
  }

  function quitar(indice: number) {
    onCambio(valores.filter((_, i) => i !== indice))
  }

  function alTeclear(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      agregar(borrador)
      return
    }
    if (e.key === 'Backspace' && borrador === '' && valores.length > 0) {
      quitar(valores.length - 1)
    }
  }

  return (
    <div>
      <div className={`${claseControl(hayError)} flex flex-wrap items-center gap-1.5 py-1.5`}>
        {valores.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1 rounded-pill bg-primary-tint px-2 py-0.5 text-xs font-medium text-primary"
          >
            {v}
            <button
              type="button"
              onClick={() => quitar(i)}
              disabled={disabled}
              aria-label={`Quitar ${v}`}
              className="text-primary/70 hover:text-primary"
            >
              ×
            </button>
          </span>
        ))}

        <input
          id={id}
          type="text"
          value={borrador}
          disabled={disabled}
          onChange={(e) => setBorrador(e.target.value)}
          onKeyDown={alTeclear}
          onBlur={() => agregar(borrador)}
          placeholder={valores.length === 0 ? placeholder : ''}
          className="min-w-32 flex-1 bg-transparent py-0.5 text-sm text-ink outline-none placeholder:text-muted"
          {...(hayError ? { 'aria-describedby': `${id}-error` } : {})}
        />
      </div>

      {sugerencias.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {sugerencias
            .filter((s) => !valores.some((v) => v.toLowerCase() === s.toLowerCase()))
            .map((s) => (
              <button
                key={s}
                type="button"
                disabled={disabled}
                onClick={() => agregar(s)}
                className="rounded-pill border border-border px-2 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-ink"
              >
                + {s}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
