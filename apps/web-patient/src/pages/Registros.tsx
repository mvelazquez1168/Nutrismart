/**
 * Lo que el paciente apunta desde casa — diario de comidas y medidas.
 *
 * Dos pestañas dentro de una sola pantalla, no dos entradas más en la
 * barra inferior: son la misma acción («apuntar lo mío») y separarlas
 * habría dejado seis pestañas en un móvil.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ApiError,
  FRANJAS,
  borrarComida,
  getDiario,
  getMetricas,
  getSemanaDiario,
  guardarComida,
  guardarMetrica,
  type Diario,
  type DiaSemana,
  type Franja,
  type Metrica,
  type TipoMetrica,
} from '../lib/api'
import { entrar, initKeycloak } from '../lib/keycloak'
import { NavBar } from '../components/NavBar'

const METRICAS: { clave: TipoMetrica; etiqueta: string; unidad: string }[] = [
  { clave: 'peso', etiqueta: 'Peso', unidad: 'kg' },
  { clave: 'presion_arterial', etiqueta: 'Presión', unidad: 'mmHg' },
  { clave: 'glucosa', etiqueta: 'Glucosa', unidad: 'mg/dL' },
]

function hoyLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function control(extra = ''): string {
  return `w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-primary ${extra}`
}

/* ------------------------------------------------------------------ */
/* Diario                                                              */
/* ------------------------------------------------------------------ */

function BarraSemana({ dias }: { dias: DiaSemana[] }) {
  const max = Math.max(...dias.map((d) => d.kcal), 1)
  return (
    <div className="flex items-end gap-1.5" aria-hidden="true">
      {dias.map((d) => (
        <div key={d.fecha} className="flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-sm"
            style={{
              height: `${Math.max((d.kcal / max) * 44, d.kcal > 0 ? 4 : 2)}px`,
              backgroundColor: d.kcal > 0 ? 'var(--primary)' : 'var(--border)',
            }}
          />
          <span className="text-[10px] text-muted">
            {new Date(`${d.fecha}T12:00:00`).toLocaleDateString('es-CR', { weekday: 'narrow' })}
          </span>
        </div>
      ))}
    </div>
  )
}

function PanelDiario() {
  const [fecha, setFecha] = useState(hoyLocal())
  const [diario, setDiario] = useState<Diario | null>(null)
  const [semana, setSemana] = useState<DiaSemana[]>([])
  const [editando, setEditando] = useState<Franja | null>(null)
  const [texto, setTexto] = useState('')
  const [kcal, setKcal] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async (f: string) => {
    const [d, s] = await Promise.all([getDiario(f), getSemanaDiario(7)])
    setDiario(d)
    setSemana(s)
  }, [])

  useEffect(() => {
    cargar(fecha).catch((e) =>
      setError(e instanceof ApiError ? e.message : 'No hemos podido cargar tu diario'),
    )
  }, [fecha, cargar])

  function abrir(franja: Franja) {
    const ya = diario?.registros.find((r) => r.tipoComida === franja)
    setTexto(ya?.descripcion ?? '')
    setKcal(ya?.kcal !== null && ya?.kcal !== undefined ? String(ya.kcal) : '')
    setEditando(franja)
    setError(null)
  }

  async function guardar() {
    if (!editando || texto.trim() === '' || ocupado) return
    setOcupado(true)
    setError(null)
    try {
      await guardarComida({
        tipoComida: editando,
        descripcion: texto.trim(),
        fecha,
        kcal: kcal.trim() === '' ? null : Number(kcal),
      })
      setEditando(null)
      await cargar(fecha)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar')
    } finally {
      setOcupado(false)
    }
  }

  async function borrar(id: string) {
    setOcupado(true)
    try {
      await borrarComida(id)
      setEditando(null)
      await cargar(fecha)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo borrar')
    } finally {
      setOcupado(false)
    }
  }

  if (!diario) return <div className="h-64 animate-pulse rounded-lg bg-surface-2" />

  const objetivo = diario.objetivo?.kcal ?? null
  const pct = objetivo ? Math.min((diario.totales.kcal / objetivo) * 100, 100) : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="fecha" className="text-sm font-medium text-ink">
          Día
        </label>
        <input
          id="fecha"
          type="date"
          value={fecha}
          max={hoyLocal()}
          onChange={(e) => setFecha(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink"
        />
      </div>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <p className="text-3xl font-bold text-ink">
          {diario.totales.kcal}
          <span className="ml-1 text-base font-normal text-muted">
            {objetivo ? `de ${objetivo} kcal` : 'kcal'}
          </span>
        </p>

        {objetivo !== null && (
          <div className="mt-2 h-2 overflow-hidden rounded-pill bg-surface-2">
            <div className="h-full rounded-pill bg-primary" style={{ width: `${pct}%` }} />
          </div>
        )}

        {/* Un total al que le faltan tres comidas no es un total, y
            callarlo hace que parezca que se ha comido de menos. */}
        {diario.totales.sinEstimar > 0 && (
          <p className="mt-2 text-xs text-muted">
            {diario.totales.sinEstimar === 1
              ? 'Una comida sin calorías apuntadas: no cuenta en el total.'
              : `${diario.totales.sinEstimar} comidas sin calorías apuntadas: no cuentan en el total.`}
          </p>
        )}

        {semana.length > 1 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-2 text-xs text-muted">Últimos 7 días</p>
            <BarraSemana dias={semana} />
          </div>
        )}
      </section>

      <ul className="space-y-2">
        {FRANJAS.map((f) => {
          const r = diario.registros.find((x) => x.tipoComida === f.clave)
          const abierta = editando === f.clave
          return (
            <li key={f.clave} className="rounded-lg border border-border bg-surface shadow-sm">
              <button
                type="button"
                onClick={() => (abierta ? setEditando(null) : abrir(f.clave))}
                className="flex w-full items-start justify-between gap-3 p-4 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{f.etiqueta}</p>
                  <p className={`mt-0.5 text-sm ${r ? 'text-ink' : 'text-muted'}`}>
                    {r ? r.descripcion : 'Sin apuntar'}
                  </p>
                </div>
                {r?.kcal !== null && r?.kcal !== undefined && (
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-primary">
                    {r.kcal} kcal
                  </span>
                )}
              </button>

              {abierta && (
                <div className="space-y-2 border-t border-border p-4">
                  <label htmlFor={`d-${f.clave}`} className="block text-xs text-muted">
                    ¿Qué comiste?
                  </label>
                  <textarea
                    id={`d-${f.clave}`}
                    rows={2}
                    maxLength={1000}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    placeholder="Arroz con pollo y ensalada"
                    className={control('resize-none')}
                  />
                  <label htmlFor={`k-${f.clave}`} className="block text-xs text-muted">
                    Calorías, si las sabes
                  </label>
                  <input
                    id={`k-${f.clave}`}
                    type="number"
                    min={0}
                    max={9999}
                    value={kcal}
                    onChange={(e) => setKcal(e.target.value)}
                    placeholder="Opcional"
                    className={control()}
                  />
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => void guardar()}
                      disabled={ocupado || texto.trim() === ''}
                      className="flex-1 rounded-md bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
                    >
                      Guardar
                    </button>
                    {r && (
                      <button
                        type="button"
                        onClick={() => void borrar(r.id)}
                        disabled={ocupado}
                        className="rounded-md border border-border px-4 text-sm font-medium text-muted hover:text-ink"
                      >
                        Borrar
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {error && (
        <p role="alert" className="text-center text-sm" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Métricas                                                            */
/* ------------------------------------------------------------------ */

function PanelMetricas() {
  const [tipo, setTipo] = useState<TipoMetrica>('peso')
  const [lecturas, setLecturas] = useState<Metrica[]>([])
  const [valor, setValor] = useState('')
  const [sis, setSis] = useState('')
  const [dia, setDia] = useState('')
  const [nota, setNota] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async (t: TipoMetrica) => {
    setLecturas(await getMetricas(t, 30))
  }, [])

  useEffect(() => {
    cargar(tipo).catch(() => {})
  }, [tipo, cargar])

  const esPresion = tipo === 'presion_arterial'

  async function guardar() {
    if (ocupado) return
    setOcupado(true)
    setError(null)
    try {
      await guardarMetrica({
        tipo,
        ...(esPresion
          ? { sistolica: Number(sis), diastolica: Number(dia) }
          : { valor: Number(valor) }),
        ...(nota.trim() !== '' ? { nota: nota.trim() } : {}),
      })
      setValor('')
      setSis('')
      setDia('')
      setNota('')
      await cargar(tipo)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar')
    } finally {
      setOcupado(false)
    }
  }

  const completo = esPresion ? sis.trim() !== '' && dia.trim() !== '' : valor.trim() !== ''
  const unidad = METRICAS.find((m) => m.clave === tipo)?.unidad ?? ''

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {METRICAS.map((m) => (
          <button
            key={m.clave}
            type="button"
            onClick={() => setTipo(m.clave)}
            aria-pressed={tipo === m.clave}
            className={`flex-1 rounded-md border px-2 py-2 text-sm font-medium ${
              tipo === m.clave
                ? 'border-primary bg-primary-tint text-primary'
                : 'border-border bg-surface text-ink'
            }`}
          >
            {m.etiqueta}
          </button>
        ))}
      </div>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
        {esPresion ? (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor="sis" className="mb-1 block text-xs text-muted">
                Sistólica
              </label>
              <input
                id="sis"
                type="number"
                inputMode="numeric"
                value={sis}
                onChange={(e) => setSis(e.target.value)}
                placeholder="120"
                className={control()}
              />
            </div>
            <span className="pb-2 text-lg text-muted">/</span>
            <div className="flex-1">
              <label htmlFor="dia" className="mb-1 block text-xs text-muted">
                Diastólica
              </label>
              <input
                id="dia"
                type="number"
                inputMode="numeric"
                value={dia}
                onChange={(e) => setDia(e.target.value)}
                placeholder="80"
                className={control()}
              />
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor="valor" className="mb-1 block text-xs text-muted">
              Valor en {unidad}
            </label>
            <input
              id="valor"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              className={control()}
            />
          </div>
        )}

        <div>
          <label htmlFor="nota" className="mb-1 block text-xs text-muted">
            Nota, si quieres
          </label>
          <input
            id="nota"
            type="text"
            maxLength={500}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="En ayunas, después de caminar…"
            className={control()}
          />
        </div>

        <button
          type="button"
          onClick={() => void guardar()}
          disabled={ocupado || !completo}
          className="w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {ocupado ? 'Guardando…' : 'Apuntar'}
        </button>

        {error && (
          <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
            {error}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-ink">Lo que has apuntado</h2>
        {lecturas.length === 0 ? (
          <p className="text-sm text-muted">Todavía nada. Lo que apuntes aparecerá aquí.</p>
        ) : (
          <ul>
            {lecturas.map((l) => (
              <li
                key={l.id}
                className="flex items-baseline justify-between gap-2 border-b border-border py-2 last:border-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold tabular-nums text-ink">
                    {l.tipo === 'presion_arterial'
                      ? `${l.sistolica}/${l.diastolica}`
                      : l.valor}{' '}
                    <span className="text-xs font-normal text-muted">{l.unidad}</span>
                  </p>
                  {l.nota && <p className="truncate text-xs text-muted">{l.nota}</p>}
                </div>
                <span className="shrink-0 text-xs text-muted">
                  {new Date(l.medidoEn).toLocaleDateString('es-CR', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* El peso de casa y el de la consulta no son el mismo dato: la
            báscula de la clínica está calibrada y se usa siempre igual.
            Decirlo evita que el paciente crea que se contradicen. */}
        {tipo === 'peso' && lecturas.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            Este es tu registro en casa. El peso de las consultas se mide aparte y es el que usa tu
            nutricionista para el seguimiento.
          </p>
        )}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */

export function Registros() {
  const navegar = useNavigate()
  const [pestana, setPestana] = useState<'diario' | 'medidas'>('diario')
  const [listo, setListo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    async function arrancar() {
      try {
        if (!(await initKeycloak())) {
          entrar(`${window.location.origin}/registros`)
          return
        }
        if (vivo) setListo(true)
      } catch (e) {
        if (!vivo) return
        if (e instanceof ApiError && e.codigo === 'sin_vincular') {
          navegar('/activar', { replace: true })
          return
        }
        setError('No hemos podido abrir tus registros')
      }
    }
    void arrancar()
    return () => {
      vivo = false
    }
  }, [navegar])

  return (
    <main className="min-h-screen bg-background pb-nav">
      <header className="bg-primary px-4 pb-8 pt-10 text-white">
        <h1 className="text-xl font-bold">Mis registros</h1>
        <p className="mt-1 text-sm opacity-90">
          Lo que apuntes aquí lo verá tu nutricionista en la próxima consulta.
        </p>
      </header>

      <div className="-mt-4 px-4">
        <div className="mb-4 flex overflow-hidden rounded-md border border-border bg-surface">
          {(['diario', 'medidas'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPestana(p)}
              aria-pressed={pestana === p}
              className={`flex-1 py-2.5 text-sm font-medium ${
                pestana === p ? 'bg-primary text-white' : 'text-ink'
              }`}
            >
              {p === 'diario' ? 'Qué comí' : 'Mis medidas'}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="text-center text-sm" style={{ color: 'var(--status-critical)' }}>
            {error}
          </p>
        )}

        {listo && (pestana === 'diario' ? <PanelDiario /> : <PanelMetricas />)}
      </div>

      <NavBar />
    </main>
  )
}
