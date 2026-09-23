/**
 * Panel de monitoreo continuo — RPM-02.
 *
 * Lo que el profesional mira entre consultas.
 *
 * El valor de esta pantalla no está en quien va bien: está en detectar,
 * sin abrir doce expedientes, a quién lleva nueve días sin apuntar nada
 * o lleva una semana reportando que se encuentra mal. Por eso ordena por
 * defecto por «días sin reportar» y no por nombre, y por eso la columna
 * ancha es esa y no el peso.
 *
 * Un nutricionista ve solo sus pacientes; un administrador, los de toda
 * la clínica. Lo resuelve el servidor.
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError, apiGet } from '../api/client'
import { AlertasPaciente } from '../components/rpm/AlertasPaciente'

const ESTADO_BIENESTAR: Record<number, { texto: string; token: string }> = {
  1: { texto: 'Muy mal', token: '--status-critical' },
  2: { texto: 'Mal', token: '--status-serious' },
  3: { texto: 'Regular', token: '--status-alert' },
  4: { texto: 'Bien', token: '--status-normal' },
  5: { texto: 'Excelente', token: '--status-normal' },
}

const SINTOMA: Record<string, string> = {
  dolor_cabeza: 'Dolor de cabeza',
  fatiga: 'Cansancio',
  insomnio: 'Insomnio',
  ansiedad: 'Ansiedad',
  estres: 'Estrés',
  hinchazon: 'Hinchazón',
  estrenimiento: 'Estreñimiento',
  diarrea: 'Diarrea',
  acidez: 'Acidez',
  nauseas: 'Náuseas',
  antojos: 'Antojos',
  mareo: 'Mareo',
  dolor_muscular: 'Dolor muscular',
}

interface Lectura {
  valor: number | null
  medidoEn: string
}

interface FilaRpm {
  id: string
  nombre: string
  fotoUrl: string | null
  ultimoPeso: Lectura | null
  ultimaGlucosa: Lectura | null
  ultimaPresion: { sistolica: number; diastolica: number; medidoEn: string } | null
  ultimoBienestar: { estado: number; fecha: string } | null
  diasSinBienestar: number | null
  diasSinDiario: number | null
  sparklinePeso: { fecha: string; valor: number }[]
  alertasAbiertas: number
}

interface Detalle {
  paciente: { id: string; nombre: string }
  meses: number
  metricas: {
    tipo: string
    valor: number | null
    sistolica: number | null
    diastolica: number | null
    unidad: string
    medidoEn: string
  }[]
  bienestar: { fecha: string; estado: number; sintomas: string[]; nota: string | null }[]
  sintomasFrecuentes: { sintoma: string; veces: number }[]
  medidas: { fecha: string; cinturaCm: number | null; caderaCm: number | null }[]
  diario: { fecha: string; kcal: number | null; comidas: number; comidasConKcal: number }[]
}

/**
 * Minigráfica de peso.
 *
 * Sin ejes ni etiquetas a propósito: aquí no se lee un valor, se lee una
 * dirección. El número exacto está al lado.
 */
function Sparkline({ puntos }: { puntos: { fecha: string; valor: number }[] }) {
  if (puntos.length < 2) {
    return <span className="text-xs text-muted">—</span>
  }
  const W = 80
  const H = 24
  const P = 2
  const vs = puntos.map((p) => p.valor)
  const min = Math.min(...vs)
  const max = Math.max(...vs)
  const rango = max - min || 1
  const d = puntos
    .map((p, i) => {
      const x = P + (i / (puntos.length - 1)) * (W - P * 2)
      const y = P + (1 - (p.valor - min) / rango) * (H - P * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-6 w-20" role="img" aria-label="Evolución del peso">
      <polyline
        points={d}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * «Hace N días» o «nunca».
 *
 * Son cosas distintas y la pantalla las distingue: alguien que nunca ha
 * reportado necesita que le enseñen la aplicación; alguien que reportaba
 * y dejó de hacerlo hace nueve días necesita una llamada.
 */
function Silencio({ dias }: { dias: number | null }) {
  if (dias === null) {
    return <span className="text-xs text-muted">Nunca</span>
  }
  if (dias === 0) return <span className="text-xs text-muted">Hoy</span>
  const token = dias >= 7 ? '--status-alert' : '--muted'
  return (
    <span className="text-xs font-medium tabular-nums" style={{ color: `var(${token})` }}>
      Hace {dias} {dias === 1 ? 'día' : 'días'}
    </span>
  )
}

function Iniciales({ nombre, fotoUrl }: { nombre: string; fotoUrl: string | null }) {
  const p = nombre.trim().split(/\s+/).filter(Boolean)
  const ini =
    p.length === 0
      ? '?'
      : p.length === 1
        ? (p[0] ?? '').slice(0, 2).toUpperCase()
        : ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase()

  if (fotoUrl) {
    return (
      <img
        src={fotoUrl}
        alt=""
        className="h-8 w-8 shrink-0 rounded-pill border border-border object-cover"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-primary text-xs font-semibold text-white"
    >
      {ini}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Detalle                                                             */
/* ------------------------------------------------------------------ */

function PanelDetalle({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const [datos, setDatos] = useState<Detalle | null>(null)
  const [meses, setMeses] = useState(3)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setDatos(null)
    apiGet<Detalle>(`/api/rpm/pacientes/${id}?meses=${meses}`, ctrl.signal)
      .then((d) => {
        if (!ctrl.signal.aborted) setDatos(d)
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) {
          setError(e instanceof ApiError ? e.message : 'No se pudo cargar el seguimiento')
        }
      })
    return () => ctrl.abort()
  }, [id, meses])

  if (error) {
    return (
      <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
        {error}
      </p>
    )
  }
  if (!datos) return <div className="h-64 animate-pulse rounded-lg bg-surface-2" />

  const pesos = datos.metricas.filter((m) => m.tipo === 'peso' && m.valor !== null)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onCerrar}
          className="text-sm font-medium text-primary hover:underline"
        >
          ← Todos los pacientes
        </button>
        <div className="flex gap-1.5">
          {[1, 3, 6, 12].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMeses(m)}
              aria-pressed={meses === m}
              className={`rounded-md border px-3 py-1 text-xs font-medium ${
                meses === m ? 'border-primary bg-primary-tint text-primary' : 'border-border text-muted'
              }`}
            >
              {m} {m === 1 ? 'mes' : 'meses'}
            </button>
          ))}
        </div>
      </div>

      <h2 className="text-lg font-semibold text-ink">{datos.paciente.nombre}</h2>

      <AlertasPaciente pacienteId={id} />

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <h3 className="mb-1 font-semibold text-ink">Cómo dice que se encuentra</h3>
          {/* El aviso importa: esto es lo que el paciente reporta, no un
              diagnóstico. Leerlo como si fuera exploración clínica es el
              error que esta pantalla podría inducir. */}
          <p className="mb-3 text-xs text-muted">
            Es lo que reporta el paciente desde su aplicación.
          </p>

          {datos.bienestar.length === 0 ? (
            <p className="text-sm text-muted">No ha reportado nada en este periodo.</p>
          ) : (
            <>
              <div className="mb-3 flex items-end gap-0.5">
                {datos.bienestar.slice(-30).map((b) => {
                  const e = ESTADO_BIENESTAR[b.estado]!
                  return (
                    <span
                      key={b.fecha}
                      title={`${b.fecha} · ${e.texto}`}
                      className="h-8 flex-1 rounded-sm"
                      style={{
                        backgroundColor: `var(${e.token})`,
                        opacity: 0.35 + b.estado * 0.13,
                      }}
                    />
                  )
                })}
              </div>

              {datos.sintomasFrecuentes.length > 0 && (
                <>
                  <p className="mb-1 text-xs text-muted">Lo que más ha reportado:</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {datos.sintomasFrecuentes.slice(0, 6).map((s) => (
                      <li
                        key={s.sintoma}
                        className="rounded-pill border border-border px-2.5 py-1 text-xs text-ink"
                      >
                        {SINTOMA[s.sintoma] ?? s.sintoma}{' '}
                        <span className="font-semibold tabular-nums">{s.veces}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <h3 className="mb-1 font-semibold text-ink">Peso en casa</h3>
          <p className="mb-3 text-xs text-muted">
            Báscula del paciente. No sustituye a la medición de consulta.
          </p>
          {pesos.length === 0 ? (
            <p className="text-sm text-muted">Sin registros en este periodo.</p>
          ) : (
            <>
              <Sparkline
                puntos={pesos.map((m) => ({ fecha: m.medidoEn, valor: m.valor as number }))}
              />
              <p className="mt-2 text-sm text-ink">
                Último: <strong className="tabular-nums">{pesos[pesos.length - 1]!.valor} kg</strong>
                <span className="ml-2 text-xs text-muted">
                  {new Date(pesos[pesos.length - 1]!.medidoEn).toLocaleDateString('es-CR')}
                </span>
              </p>
            </>
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <h3 className="mb-3 font-semibold text-ink">Medidas que se toma en casa</h3>
          {datos.medidas.length === 0 ? (
            <p className="text-sm text-muted">Sin medidas en este periodo.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {datos.medidas.slice(-6).reverse().map((m) => (
                <li key={m.fecha} className="flex justify-between gap-2 py-1.5">
                  <span className="text-muted">
                    {new Date(`${m.fecha}T12:00:00`).toLocaleDateString('es-CR', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                  <span className="tabular-nums text-ink">
                    {m.cinturaCm !== null && `cintura ${m.cinturaCm} cm`}
                    {m.cinturaCm !== null && m.caderaCm !== null && ' · '}
                    {m.caderaCm !== null && `cadera ${m.caderaCm} cm`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <h3 className="mb-3 font-semibold text-ink">Días que ha apuntado comidas</h3>
          {datos.diario.length === 0 ? (
            <p className="text-sm text-muted">No ha apuntado ninguna comida.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {datos.diario.slice(-8).reverse().map((d) => (
                <li key={d.fecha} className="flex justify-between gap-2 py-1.5">
                  <span className="text-muted">
                    {new Date(`${d.fecha}T12:00:00`).toLocaleDateString('es-CR', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                  <span className="tabular-nums text-ink">
                    {d.kcal !== null ? `${Math.round(d.kcal)} kcal` : '—'}
                    {/* Si faltan calorías en alguna comida se dice: un
                        total de 400 kcal con tres comidas sin estimar no
                        es un día de 400 kcal. */}
                    {d.comidasConKcal < d.comidas && (
                      <span className="ml-1 text-xs font-normal text-muted">
                        ({d.comidas - d.comidasConKcal} sin estimar)
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Lista                                                               */
/* ------------------------------------------------------------------ */

export function Monitoreo() {
  const [filas, setFilas] = useState<FilaRpm[] | null>(null)
  const [orden, setOrden] = useState<'alertas' | 'silencio' | 'nombre' | 'bienestar'>('alertas')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      setFilas(await apiGet<FilaRpm[]>('/api/rpm/pacientes'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cargar el monitoreo')
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (abierto) {
    return <PanelDetalle id={abierto} onCerrar={() => setAbierto(null)} />
  }

  // «Nunca ha reportado» ordena por delante de cualquier número de días:
  // es el caso que más atención necesita, no el que menos.
  const orden_silencio = (f: FilaRpm) =>
    f.diasSinBienestar === null ? Number.MAX_SAFE_INTEGER : f.diasSinBienestar

  const ordenadas = [...(filas ?? [])].sort((a, b) => {
    if (orden === 'nombre') return a.nombre.localeCompare(b.nombre)
    if (orden === 'alertas') return b.alertasAbiertas - a.alertasAbiertas
    if (orden === 'bienestar') {
      return (a.ultimoBienestar?.estado ?? 99) - (b.ultimoBienestar?.estado ?? 99)
    }
    return orden_silencio(b) - orden_silencio(a)
  })

  const conAlertas = (filas ?? []).reduce((t, f) => t + f.alertasAbiertas, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-ink">Monitoreo</h1>
          <p className="text-sm text-muted">
            Lo que tus pacientes reportan entre consultas.
            {conAlertas > 0 && (
              <>
                {' · '}
                <span className="font-medium" style={{ color: 'var(--status-alert)' }}>
                  {conAlertas} {conAlertas === 1 ? 'alerta abierta' : 'alertas abiertas'}
                </span>
              </>
            )}
          </p>
        </div>
        <select
          value={orden}
          onChange={(e) => setOrden(e.target.value as typeof orden)}
          aria-label="Ordenar por"
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink"
        >
          <option value="alertas">Los que tienen alertas abiertas</option>
          <option value="silencio">Los que llevan más sin reportar</option>
          <option value="bienestar">Los que peor se encuentran</option>
          <option value="nombre">Por nombre</option>
        </select>
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      )}

      {filas === null ? (
        <div className="h-48 animate-pulse rounded-lg bg-surface-2" />
      ) : filas.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted shadow-sm">
          No tienes pacientes activos asignados.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Paciente</th>
                <th className="px-4 py-2 font-medium">Alertas</th>
                <th className="px-4 py-2 font-medium">Cómo se encuentra</th>
                <th className="px-4 py-2 font-medium">Sin reportar</th>
                <th className="px-4 py-2 font-medium">Sin apuntar comidas</th>
                <th className="px-4 py-2 font-medium">Peso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ordenadas.map((f) => {
                const e = f.ultimoBienestar ? ESTADO_BIENESTAR[f.ultimoBienestar.estado] : null
                return (
                  <tr
                    key={f.id}
                    onClick={() => setAbierto(f.id)}
                    className="cursor-pointer hover:bg-surface-2"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Iniciales nombre={f.nombre} fotoUrl={f.fotoUrl} />
                        <span className="font-medium text-ink">{f.nombre}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {/* Sin alertas no se pinta un cero: una columna
                          llena de ceros esconde los pocos que no lo son. */}
                      {f.alertasAbiertas > 0 ? (
                        <span
                          className="rounded-pill px-2 py-0.5 text-xs font-semibold"
                          style={{
                            color: 'var(--status-alert)',
                            backgroundColor:
                              'color-mix(in srgb, var(--status-alert) 16%, transparent)',
                          }}
                        >
                          {f.alertasAbiertas}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {e ? (
                        <span
                          className="rounded-pill px-2 py-0.5 text-xs font-medium"
                          style={{
                            color: `var(${e.token})`,
                            backgroundColor: `color-mix(in srgb, var(${e.token}) 14%, transparent)`,
                          }}
                        >
                          {e.texto}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">Sin datos</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Silencio dias={f.diasSinBienestar} />
                    </td>
                    <td className="px-4 py-2.5">
                      <Silencio dias={f.diasSinDiario} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Sparkline puntos={f.sparklinePeso} />
                        {f.ultimoPeso?.valor !== undefined && f.ultimoPeso?.valor !== null && (
                          <span className="tabular-nums text-ink">{f.ultimoPeso.valor} kg</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
