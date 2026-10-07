/**
 * Control numérico con flechas de incremento propias — R46.
 *
 * Es solo el CONTROL: la etiqueta, la ayuda y el error siguen siendo de
 * `Campo`, que es quien los pinta. Se usa como hijo suyo.
 *
 * ── Por qué no es un `<input type="number">` ─────────────────────────
 *
 * Dos razones, las dos de tablet:
 *
 * 1. **Los navegadores táctiles no dibujan el spinner.** No es una regla
 *    de CSS que se pueda quitar: Safari de iOS y Chrome de Android
 *    directamente no pintan las flechas de un `type="number"`. La única
 *    manera de tener incremento y decremento a la vista en una tablet es
 *    dibujarlos.
 *
 * 2. **`type="number"` se sanea solo, y eso cierra el teclado.** Mientras
 *    se escribe un valor a medias —«5.», «1e», «-»— la propiedad `value`
 *    del nodo vale **cadena vacía**, no el texto escrito. Un campo
 *    controlado recibe entonces `''`, lo guarda en el estado y React lo
 *    reescribe en el nodo: el valor desaparece, el caret salta y el
 *    teclado táctil lo cuenta como cambio de contexto y se recoge.
 *
 * `type="text"` con `inputMode` saca el mismo teclado numérico y no
 * sanea nada: lo escrito se queda tal cual. El reparto entre filtrar,
 * acotar y redondear está en `lib/numero.ts`, que se prueba sin
 * navegador.
 *
 * Los botones hacen `preventDefault` en `pointerdown`: sin eso el foco
 * se iría al botón y el teclado se cerraría al tocar una flecha, que es
 * exactamente lo que se viene a arreglar.
 */
import { claseControl } from './Campo'
import { limpiar, mover, normalizar, type Rango } from '../lib/numero'

export function InputNumero({
  id,
  valor,
  onChange,
  min,
  max,
  paso = 1,
  decimales = false,
  disabled = false,
  hayError = false,
  etiqueta,
  placeholder,
}: {
  id: string
  /** El valor vive como texto: '' es «sin dato», no cero. */
  valor: string
  onChange: (v: string) => void
  min?: number
  max?: number
  /** Salto de las flechas, las del control y las del teclado. */
  paso?: number
  /** Admite decimales: cambia el teclado y acepta el separador. */
  decimales?: boolean
  disabled?: boolean
  hayError?: boolean
  /**
   * Nombre del campo para las flechas («Aumentar sesiones por semana»).
   * Lo necesita el lector de pantalla: «▲» no dice de qué.
   */
  etiqueta: string
  placeholder?: string
}) {
  // Sin mínimo, o con un mínimo negativo, el signo tiene sentido. Con
  // min >= 0 no, y dejarlo pasar mandaría NaN al guardar.
  const negativos = min === undefined || min < 0
  const rango: Rango = { min, max, decimales }

  function aplicarPaso(signo: 1 | -1) {
    onChange(mover(valor, signo, paso, rango))
  }

  function alSalir() {
    const limpio = normalizar(valor, rango)
    if (limpio !== valor) onChange(limpio)
  }

  const FLECHA =
    'flex flex-1 items-center justify-center border-border text-[0.625rem] leading-none text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div className="flex min-h-12 items-stretch">
      <input
        id={id}
        type="text"
        // El teclado numérico sin el saneado de type="number".
        inputMode={decimales ? 'decimal' : 'numeric'}
        // Para los Safari viejos, que ignoran inputMode.
        pattern={decimales ? '[0-9]*[.,]?[0-9]*' : '[0-9]*'}
        autoComplete="off"
        value={valor}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(limpiar(e.target.value, { decimales, negativos }))}
        onBlur={alSalir}
        onKeyDown={(e) => {
          // Lo que hacían las flechas del spinner nativo.
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            aplicarPaso(1)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            aplicarPaso(-1)
          }
        }}
        className={`${claseControl(hayError)} rounded-r-none border-r-0 tabular-nums`}
      />
      {/* Las dos flechas, apiladas como el spinner que la tablet no
          pinta. 36 × 24 px cada una: el mínimo táctil de la WCAG 2.5.8,
          que el spinner nativo de escritorio ni siquiera alcanza. */}
      <div className="flex w-9 shrink-0 flex-col overflow-hidden rounded-r-md border border-border">
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={`Aumentar ${etiqueta}`}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => aplicarPaso(1)}
          className={`${FLECHA} border-b`}
        >
          <span aria-hidden="true">▲</span>
        </button>
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={`Disminuir ${etiqueta}`}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => aplicarPaso(-1)}
          className={FLECHA}
        >
          <span aria-hidden="true">▼</span>
        </button>
      </div>
    </div>
  )
}
