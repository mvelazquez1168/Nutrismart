/**
 * Buscar un alimento y decir cuánto — PAC-07.
 *
 * Se pide en PORCIONES, no en gramos. La historia se llama «contador de
 * porciones» y es lo que la gente sabe responder: nadie tiene una
 * báscula al lado del plato, pero todo el mundo puede decir si se comió
 * una tortilla o dos.
 *
 * Los gramos exactos siguen estando, plegados, para quien sí pesa: el
 * paciente que se toma la molestia merece que se le apunte bien.
 */
import { useEffect, useRef, useState } from 'react'
import { ApiError, buscarAlimentos, type Alimento } from '../lib/api'

/** Las porciones que se ofrecen de un toque. */
const MULTIPLOS = [0.5, 1, 1.5, 2, 3] as const

const UNIDAD: Record<string, string> = { g: 'g', ml: 'ml', pza: 'ud' }

function etiquetaPorcion(a: Alimento, mult: number): string {
  const cantidad = a.porcionTipicaG * mult
  if (a.unidadPorcion === 'pza') {
    const n = mult === 1 ? '1 unidad' : `${mult} unidades`
    return `${n} · ${Math.round(cantidad)} g`
  }
  return `${Math.round(cantidad)} ${UNIDAD[a.unidadPorcion] ?? 'g'}`
}

interface Props {
  onElegir: (datos: { alimentoId?: string; nombre?: string; cantidadG: number }) => Promise<void>
  onCerrar: () => void
}

export function BuscadorAlimento({ onElegir, onCerrar }: Props) {
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<Alimento[]>([])
  const [elegido, setElegido] = useState<Alimento | null>(null)
  const [multiplo, setMultiplo] = useState(1)
  const [gramos, setGramos] = useState('')
  const [exacto, setExacto] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    campo.current?.focus()
  }, [])

  // Se espera a que el paciente deje de escribir: una consulta por
  // pulsación llena la red de peticiones que ya no interesan, y en un
  // móvil con mala cobertura los resultados llegan desordenados.
  useEffect(() => {
    if (elegido) return
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      buscarAlimentos(texto)
        .then((r) => {
          if (!ctrl.signal.aborted) setResultados(r)
        })
        .catch(() => {
          /* la lista vacía ya dice que no hay nada */
        })
    }, 250)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [texto, elegido])

  const cantidadFinal = elegido
    ? exacto
      ? Number(gramos)
      : Math.round(elegido.porcionTipicaG * multiplo * 10) / 10
    : 0

  const kcalFinal =
    elegido && Number.isFinite(cantidadFinal) && cantidadFinal > 0
      ? Math.round((elegido.kcalPor100g * cantidadFinal) / 100)
      : null

  async function confirmar() {
    if (ocupado) return
    setError(null)

    if (elegido) {
      if (!Number.isFinite(cantidadFinal) || cantidadFinal <= 0 || cantidadFinal > 5000) {
        setError('Indica una cantidad entre 1 y 5000 g')
        return
      }
      setOcupado(true)
      try {
        await onElegir({ alimentoId: elegido.id, cantidadG: cantidadFinal })
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'No se pudo añadir')
        setOcupado(false)
      }
      return
    }

    // Nada elegido de la lista: se apunta lo escrito tal cual. El
    // catálogo nunca lo va a tener todo, y obligar a elegir de una lista
    // es la forma más segura de que alguien deje de apuntar.
    const n = texto.trim()
    if (n === '') return
    setOcupado(true)
    try {
      await onElegir({ nombre: n, cantidadG: 100 })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo añadir')
      setOcupado(false)
    }
  }

  return (
    <div className="space-y-3">
      {!elegido ? (
        <>
          <label htmlFor="busca-alimento" className="block text-xs text-muted">
            ¿Qué comiste?
          </label>
          <input
            id="busca-alimento"
            ref={campo}
            type="text"
            value={texto}
            maxLength={200}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Arroz, pollo, banano…"
            className="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-primary"
          />

          {resultados.length > 0 && (
            <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {resultados.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setElegido(a)
                      setMultiplo(1)
                      setGramos(String(a.porcionTipicaG))
                      setExacto(false)
                    }}
                    className="flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface-2"
                  >
                    <span className="min-w-0 truncate text-sm text-ink">{a.nombre}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted">
                      {Math.round((a.kcalPor100g * a.porcionTipicaG) / 100)} kcal
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* La salida cuando no está en el catálogo. Sin calorías, que
              es lo honesto: no las sabemos. */}
          {texto.trim() !== '' && resultados.length === 0 && (
            <p className="text-xs text-muted">
              No está en la lista. Puedes apuntarlo igual, aunque sin calorías.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-semibold text-ink">{elegido.nombre}</p>
            <button
              type="button"
              onClick={() => setElegido(null)}
              className="shrink-0 text-xs text-muted underline hover:text-ink"
            >
              Cambiar
            </button>
          </div>

          {!exacto ? (
            <>
              <p className="text-xs text-muted">¿Cuánto?</p>
              <div className="flex flex-wrap gap-1.5">
                {MULTIPLOS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMultiplo(m)}
                    aria-pressed={multiplo === m}
                    className={`flex-1 rounded-md border px-2 py-2 text-xs font-medium ${
                      multiplo === m
                        ? 'border-primary bg-primary-tint text-primary'
                        : 'border-border text-muted'
                    }`}
                  >
                    {m === 0.5 ? '½' : m === 1.5 ? '1½' : m}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted">{etiquetaPorcion(elegido, multiplo)}</p>
              <button
                type="button"
                onClick={() => {
                  setGramos(String(Math.round(elegido.porcionTipicaG * multiplo)))
                  setExacto(true)
                }}
                className="text-xs text-primary underline"
              >
                Lo pesé
              </button>
            </>
          ) : (
            <>
              <label htmlFor="gramos-exactos" className="block text-xs text-muted">
                Cantidad exacta ({UNIDAD[elegido.unidadPorcion] === 'ml' ? 'ml' : 'g'})
              </label>
              <input
                id="gramos-exactos"
                type="number"
                min={1}
                max={5000}
                value={gramos}
                onChange={(e) => setGramos(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => setExacto(false)}
                className="text-xs text-primary underline"
              >
                Volver a porciones
              </button>
            </>
          )}

          {kcalFinal !== null && (
            <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-ink">
              <strong className="tabular-nums">{kcalFinal}</strong> kcal
            </p>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="text-xs" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void confirmar()}
          disabled={ocupado || (!elegido && texto.trim() === '')}
          className="flex-1 rounded-md bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
        >
          Añadir
        </button>
        <button
          type="button"
          onClick={onCerrar}
          disabled={ocupado}
          className="rounded-md border border-border px-4 text-sm font-medium text-muted hover:text-ink"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
