/**
 * Medidas de la cinta métrica — RPM-01.
 *
 * Por qué existe esta pantalla teniendo ya el peso: el peso solo miente
 * a corto plazo. Quien empieza a entrenar puede perder cintura y no
 * perder ni un gramo, y si la única cifra que ve es la báscula concluye
 * que no sirve de nada y lo deja.
 *
 * Estas medidas NO se mezclan con las de consulta: el profesional mide
 * con puntos anatómicos y protocolo, esto es una cinta delante del
 * espejo. Se cuentan aparte, igual que el peso desde la Rebanada 22.
 */
import { useEffect, useState } from 'react'
import {
  ApiError,
  MEDIDAS_CUERPO,
  getMedidasCorporales,
  guardarMedidasCorporales,
  type ClaveMedida,
  type MedidasCorporales,
} from '../lib/api'

function hoyLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Evolución de una medida.
 *
 * Con menos de dos tomas no se dibuja nada: una línea de un punto no es
 * una evolución, y una de dos puntos ya dice algo.
 */
function Linea({ valores }: { valores: { fecha: string; v: number }[] }) {
  if (valores.length < 2) return null
  const W = 240
  const H = 44
  const P = 4
  const vs = valores.map((x) => x.v)
  const min = Math.min(...vs)
  const max = Math.max(...vs)
  const rango = max - min || 1
  const puntos = valores
    .map((x, i) => {
      const px = P + (i / (valores.length - 1)) * (W - P * 2)
      const py = P + (1 - (x.v - min) / rango) * (H - P * 2)
      return `${px},${py}`
    })
    .join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-11 w-full" aria-hidden="true">
      <polyline
        points={puntos}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function PanelCuerpo() {
  const [datos, setDatos] = useState<MedidasCorporales | null>(null)
  const [valores, setValores] = useState<Record<string, string>>({})
  const [fecha, setFecha] = useState(hoyLocal())
  const [abierto, setAbierto] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cargar() {
    setDatos(await getMedidasCorporales(180))
  }

  useEffect(() => {
    cargar().catch((e) =>
      setError(e instanceof ApiError ? e.message : 'No hemos podido cargar tus medidas'),
    )
  }, [])

  async function guardar() {
    if (ocupado) return
    const cuerpo: Partial<Record<ClaveMedida, number>> = {}
    for (const m of MEDIDAS_CUERPO) {
      const v = valores[m.clave]
      if (v !== undefined && v.trim() !== '') cuerpo[m.clave] = Number(v)
    }
    if (Object.keys(cuerpo).length === 0) {
      setError('Apunta al menos una medida')
      return
    }
    setOcupado(true)
    setError(null)
    try {
      await guardarMedidasCorporales({ ...cuerpo, fecha })
      setValores({})
      setAbierto(false)
      await cargar()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar')
    } finally {
      setOcupado(false)
    }
  }

  if (!datos) return <div className="h-64 animate-pulse rounded-lg bg-surface-2" />

  return (
    <div className="space-y-4">
      {!abierto ? (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary-hover"
        >
          Apuntar medidas
        </button>
      ) : (
        <section className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Nuevas medidas</h2>
            <input
              type="date"
              value={fecha}
              max={hoyLocal()}
              onChange={(e) => setFecha(e.target.value)}
              aria-label="Día"
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink"
            />
          </div>

          {/* Se pueden dejar en blanco las que no se midieron. Obligar a
              rellenarlas todas haría que la gente escribiera cualquier
              cosa por salir del paso. */}
          <p className="-mt-1 text-xs text-muted">
            Apunta solo las que te midas. En centímetros.
          </p>

          <div className="grid grid-cols-2 gap-2">
            {MEDIDAS_CUERPO.map((m) => (
              <div key={m.clave}>
                <label
                  htmlFor={`m-${m.clave}`}
                  className="mb-0.5 block text-xs text-muted"
                >
                  {m.etiqueta}
                </label>
                <input
                  id={`m-${m.clave}`}
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  value={valores[m.clave] ?? ''}
                  onChange={(e) =>
                    setValores((prev) => ({ ...prev, [m.clave]: e.target.value }))
                  }
                  placeholder="—"
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-primary"
                />
              </div>
            ))}
          </div>

          {error && (
            <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={ocupado}
              className="flex-1 rounded-md bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="rounded-md border border-border px-4 text-sm font-medium text-muted"
            >
              Cancelar
            </button>
          </div>
        </section>
      )}

      {datos.registros.length === 0 ? (
        <section className="rounded-lg border border-border bg-surface p-6 text-center shadow-sm">
          <p className="text-sm text-muted">
            Todavía no has apuntado ninguna medida. Con dos tomas ya se ve por dónde vas.
          </p>
        </section>
      ) : (
        MEDIDAS_CUERPO.map((m) => {
          const serie = datos.registros
            .filter((r) => r[m.clave] !== null)
            .map((r) => ({ fecha: r.fecha, v: r[m.clave] as number }))
            .reverse() // de más antigua a más reciente, para dibujar
          if (serie.length === 0) return null
          const cambio = datos.cambios[m.clave]

          return (
            <section
              key={m.clave}
              className="rounded-lg border border-border bg-surface p-4 shadow-sm"
            >
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-ink">{m.etiqueta}</h2>
                <p className="text-lg font-bold tabular-nums text-ink">
                  {serie[serie.length - 1]!.v}
                  <span className="ml-1 text-xs font-normal text-muted">cm</span>
                </p>
              </div>

              <Linea valores={serie} />

              {/* Con una sola toma se dice que falta otra, en vez de
                  enseñar un cambio de cero que parecería estancamiento. */}
              {cambio ? (
                <p className="text-xs text-muted">
                  <span
                    className="font-semibold tabular-nums"
                    style={{
                      color: cambio.delta <= 0 ? 'var(--status-normal)' : 'var(--muted)',
                    }}
                  >
                    {cambio.delta > 0 ? '+' : ''}
                    {cambio.delta} cm
                  </span>{' '}
                  desde {cambio.primero} cm
                </p>
              ) : (
                <p className="text-xs text-muted">
                  Hace falta otra toma para poder comparar.
                </p>
              )}
            </section>
          )
        })
      )}
    </div>
  )
}
