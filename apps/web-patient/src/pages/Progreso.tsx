/**
 * Mi progreso — PAC-05.
 *
 * Dos series de peso, dibujadas juntas pero distinguidas: la de consulta
 * en trazo firme, la de casa en trazo fino. La meta se mide contra la de
 * consulta, y la pantalla lo dice.
 *
 * Mezclarlas en una sola línea daría una gráfica más bonita y una
 * lectura falsa: una bajada podría ser progreso o podría ser que ese día
 * se pesó en ayunas.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, getProgreso, type Progreso as Datos } from '../lib/api'
import { entrar, initKeycloak } from '../lib/keycloak'
import { NavBar } from '../components/NavBar'

const METRICA: Record<string, string> = {
  presion_arterial: 'Presión arterial',
  glucosa: 'Glucosa',
  otro: 'Otra medida',
}

function Tarjeta({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-ink">{titulo}</h2>
      {children}
    </section>
  )
}

/**
 * Las dos series de peso sobre los mismos ejes.
 *
 * El eje vertical incluye la meta aunque quede fuera del rango medido:
 * si no, la línea de meta se sale del dibujo justo cuando más lejos se
 * está de ella, que es cuando más importa verla.
 */
function GraficaPeso({ datos }: { datos: Datos }) {
  const W = 300
  const H = 130
  const P = 14

  const puntosClinica = datos.pesoEnConsulta.map((p) => ({
    t: new Date(`${p.fecha}T12:00:00`).getTime(),
    v: p.pesoKg,
  }))
  const puntosCasa = datos.pesoEnCasa.map((p) => ({
    t: new Date(`${p.semana}T12:00:00`).getTime(),
    v: p.promedio,
  }))

  const todos = [...puntosClinica, ...puntosCasa]
  if (todos.length === 0) return null

  const meta = datos.meta.pesoObjetivo
  const valores = [...todos.map((p) => p.v), ...(meta !== null ? [meta] : [])]
  const min = Math.min(...valores) - 1
  const max = Math.max(...valores) + 1
  const rango = max - min || 1

  const tMin = Math.min(...todos.map((p) => p.t))
  const tMax = Math.max(...todos.map((p) => p.t))
  const rangoT = tMax - tMin || 1

  const x = (t: number) => P + ((t - tMin) / rangoT) * (W - P * 2)
  const y = (v: number) => P + (1 - (v - min) / rango) * (H - P * 2)

  const linea = (ps: { t: number; v: number }[]) =>
    ps.map((p) => `${x(p.t)},${y(p.v)}`).join(' ')

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Evolución del peso">
        {meta !== null && (
          <>
            <line
              x1={P}
              x2={W - P}
              y1={y(meta)}
              y2={y(meta)}
              stroke="var(--status-normal)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text x={W - P} y={y(meta) - 4} textAnchor="end" fontSize="9" fill="var(--status-normal)">
              meta {meta} kg
            </text>
          </>
        )}

        {puntosCasa.length > 1 && (
          <polyline
            points={linea(puntosCasa)}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={1.5}
            strokeDasharray="3 3"
            opacity={0.7}
          />
        )}

        {puntosClinica.length > 1 && (
          <polyline
            points={linea(puntosClinica)}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {puntosClinica.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.v)} r={3.5} fill="var(--primary)" />
        ))}
      </svg>

      {/* Leyenda siempre: con dos series, el color solo no basta. */}
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-0.5 w-4 rounded-pill"
            style={{ backgroundColor: 'var(--primary)' }}
          />
          En consulta
        </span>
        {puntosCasa.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-0.5 w-4 rounded-pill"
              style={{ backgroundColor: 'var(--muted)' }}
            />
            En casa (media semanal)
          </span>
        )}
      </figcaption>
    </figure>
  )
}

export function Progreso() {
  const navegar = useNavigate()
  const [datos, setDatos] = useState<Datos | null>(null)
  const [meses, setMeses] = useState(6)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    async function cargar() {
      try {
        if (!(await initKeycloak())) {
          entrar(`${window.location.origin}/progreso`)
          return
        }
        const d = await getProgreso(meses)
        if (vivo) setDatos(d)
      } catch (e) {
        if (!vivo) return
        if (e instanceof ApiError && e.codigo === 'sin_vincular') {
          navegar('/activar', { replace: true })
          return
        }
        setError(e instanceof ApiError ? e.message : 'No hemos podido cargar tu progreso')
      }
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [navegar, meses])

  if (!datos && !error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-pill border-4 border-primary border-t-transparent" />
      </main>
    )
  }

  const a = datos?.avance ?? null

  return (
    <main className="min-h-screen bg-background pb-nav">
      <header className="bg-primary px-4 pb-8 pt-10 text-white">
        <h1 className="text-xl font-bold">Mi progreso</h1>
      </header>

      <div className="-mt-4 space-y-4 px-4">
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-border bg-surface p-4 text-sm text-ink shadow-sm"
          >
            {error}
          </p>
        )}

        {datos && (
          <>
            {a ? (
              <Tarjeta titulo="Hacia tu meta">
                <div className="flex items-baseline justify-between">
                  <p className="text-3xl font-bold text-ink">
                    {a.pesoActual}
                    <span className="ml-1 text-base font-normal text-muted">kg</span>
                  </p>
                  <p
                    className="text-sm font-semibold tabular-nums"
                    style={{ color: a.recorrido <= 0 ? 'var(--status-normal)' : 'var(--muted)' }}
                  >
                    {a.recorrido > 0 ? '+' : ''}
                    {a.recorrido} kg
                  </p>
                </div>

                <div className="mt-3 h-2.5 overflow-hidden rounded-pill bg-surface-2">
                  <div
                    className="h-full rounded-pill bg-primary transition-all"
                    style={{ width: `${a.pctCompletado}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs text-muted">
                  <span>Empezaste en {a.pesoInicial} kg</span>
                  <span>Meta {a.objetivo} kg</span>
                </div>

                <p className="mt-3 text-sm text-ink">
                  Llevas <strong>{a.pctCompletado} %</strong> del camino.
                  {a.restante !== 0 && (
                    <>
                      {' '}
                      Te quedan {Math.abs(a.restante)} kg
                      {datos.meta.fechaObjetivo && ` (meta para el ${datos.meta.fechaObjetivo})`}.
                    </>
                  )}
                </p>

                {/* Que quede claro contra qué se mide, para que nadie
                    compare este número con su báscula de casa. */}
                <p className="mt-2 text-xs text-muted">
                  Se calcula con el peso medido en consulta.
                </p>
              </Tarjeta>
            ) : (
              <Tarjeta titulo="Hacia tu meta">
                <p className="text-sm text-muted">
                  {datos.meta.pesoObjetivo === null
                    ? 'Tu nutricionista todavía no ha fijado una meta de peso contigo.'
                    : 'Hace falta más de una medición en consulta para poder decirte cuánto llevas avanzado.'}
                </p>
              </Tarjeta>
            )}

            <Tarjeta titulo="Cómo ha ido tu peso">
              {datos.pesoEnConsulta.length + datos.pesoEnCasa.length === 0 ? (
                <p className="text-sm text-muted">Aún no hay mediciones que dibujar.</p>
              ) : (
                <GraficaPeso datos={datos} />
              )}

              <div className="mt-3 flex gap-1.5 border-t border-border pt-3">
                {[3, 6, 12].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMeses(m)}
                    aria-pressed={meses === m}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium ${
                      meses === m
                        ? 'border-primary bg-primary-tint text-primary'
                        : 'border-border text-muted'
                    }`}
                  >
                    {m} meses
                  </button>
                ))}
              </div>
            </Tarjeta>

            {datos.calorias.length > 0 && (
              <Tarjeta titulo="Lo que has comido">
                <ul className="space-y-2">
                  {datos.calorias.slice(-6).map((c) => (
                    <li key={c.semana} className="flex items-baseline justify-between gap-2">
                      <span className="text-xs text-muted">Semana del {c.semana}</span>
                      <span className="text-sm font-semibold tabular-nums text-ink">
                        {c.kcalDia} kcal/día
                        <span className="ml-1 text-xs font-normal text-muted">
                          ({c.diasConRegistro} {c.diasConRegistro === 1 ? 'día' : 'días'})
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                {/* La media es por día apuntado, no por día de la semana:
                    decirlo evita que parezca que come muchísimo menos. */}
                <p className="mt-3 text-xs text-muted">
                  Es la media de los días que apuntaste, no de toda la semana.
                  {datos.meta.kcalObjetivo && ` Tu objetivo son ${datos.meta.kcalObjetivo} kcal.`}
                </p>
              </Tarjeta>
            )}

            {datos.otrasMetricas.length > 0 && (
              <Tarjeta titulo="Tus últimas medidas">
                <ul className="space-y-2">
                  {datos.otrasMetricas.map((m) => (
                    <li key={m.tipo} className="flex items-baseline justify-between gap-2">
                      <span className="text-sm text-ink">{METRICA[m.tipo] ?? m.tipo}</span>
                      <span className="text-sm font-semibold tabular-nums text-ink">
                        {m.tipo === 'presion_arterial'
                          ? `${m.sistolica}/${m.diastolica}`
                          : m.valor}{' '}
                        <span className="text-xs font-normal text-muted">{m.unidad}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Tarjeta>
            )}
          </>
        )}
      </div>

      <NavBar />
    </main>
  )
}
