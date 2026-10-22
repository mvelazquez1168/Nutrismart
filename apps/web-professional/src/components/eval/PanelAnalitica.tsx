/**
 * Analítica de laboratorio: la evolución de cada analito — R49.
 *
 * ## Qué pregunta contesta
 *
 * La pestaña «Estudios» enseña lo que trajo cada informe. Ésta enseña lo
 * contrario: cómo ha ido cada analito a lo largo del tiempo. Una glucosa de
 * 112 no significa lo mismo viniendo de 140 que viniendo de 95, y hasta ahora
 * eso había que reconstruirlo abriendo estudio por estudio.
 *
 * ## Lo que NO aparece aquí
 *
 * Los analitos **sin catalogar** (`nombre_libre`). Una serie histórica es una
 * comparación —el mismo analito, medido varias veces— y «IgG» escrito a mano
 * en dos informes no garantiza ser la misma medición. El servidor los deja
 * fuera a propósito y siguen visibles en el detalle de su estudio.
 *
 * ## Los colores son los clínicos, no decorativos
 *
 * Verde, rojo y gris son `--status-normal`, `--status-critical` y `--muted`:
 * los mismos tres que usan la tabla de estudios y el expediente. Un punto
 * rojo aquí y una fila roja allá significan lo mismo. Y nunca van solos: el
 * estado se repite en palabras en su badge.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { getAnalitica } from '../../api/laboratorios'
import type { AnalitoHistorico } from '../../api/tipos'
import { formatGrupo, ordenarGrupos } from '../../lib/grupos'
import { TendenciaModal } from './TendenciaModal'

export type EstadoAnalito = 'ok' | 'bad' | 'none'

/**
 * El estado del ÚLTIMO punto de la serie.
 *
 * Un cualitativo no tiene estado: «No Reactiva» no se compara con un
 * intervalo. Y sin rango tampoco lo hay — decir «normal» sin criterio sería
 * inventar una tranquilidad que nadie ha comprobado.
 */
export function calcularEstado(a: AnalitoHistorico): EstadoAnalito {
  if (a.es_cualitativo) return 'none'
  const v = a.serie.at(-1)?.valor
  if (v === null || v === undefined) return 'none'
  if (a.refMin !== null && v < a.refMin) return 'bad'
  if (a.refMax !== null && v > a.refMax) return 'bad'
  if (a.refMin === null && a.refMax === null) return 'none'
  return 'ok'
}

export interface Variacion {
  pct: string
  up: boolean
  empeora: boolean
}

/**
 * El cambio respecto al penúltimo punto.
 *
 * **Subir no es malo por sí mismo.** Una hemoglobina que sube desde una
 * anemia es una buena noticia y un colesterol que sube no lo es; por eso el
 * color no lo decide la dirección, lo decide si el cambio ALEJA el valor del
 * rango. Pintar toda subida de rojo enseñaría a ignorar el color.
 */
export function calcularVariacion(a: AnalitoHistorico): Variacion | null {
  if (a.es_cualitativo || a.serie.length < 2) return null
  const cur = a.serie.at(-1)!.valor
  const prev = a.serie.at(-2)!.valor
  if (cur === null || prev === null || prev === 0) return null
  const diff = cur - prev
  if (diff === 0) return null
  const pct = Math.abs((diff / prev) * 100)
  const up = diff > 0
  const empeora =
    calcularEstado(a) === 'bad' &&
    ((a.refMax !== null && up && cur > a.refMax) ||
      (a.refMin !== null && !up && cur < a.refMin))
  return { pct: pct.toFixed(1), up, empeora }
}

export const COLOR_ESTADO: Record<EstadoAnalito, string> = {
  ok: 'var(--status-normal)',
  bad: 'var(--status-critical)',
  none: 'var(--muted)',
}

const TEXTO_ESTADO: Record<EstadoAnalito, string> = {
  ok: 'NORMAL',
  bad: 'ALTERADO',
  none: 'SIN REF.',
}

/** «70 – 100 mg/dL», «≤ 200 mg/dL», «≥ 40 mg/dL» o «—». */
export function textoReferencia(a: AnalitoHistorico): string {
  if (a.es_cualitativo) return '—'
  const u = a.unidad && a.unidad !== '—' ? ` ${a.unidad}` : ''
  if (a.refMin !== null && a.refMax !== null) return `${a.refMin} – ${a.refMax}${u}`
  if (a.refMax !== null) return `≤ ${a.refMax}${u}`
  if (a.refMin !== null) return `≥ ${a.refMin}${u}`
  return '—'
}

/** «20 oct 2026». */
export function fechaLarga(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-CR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** El último valor, con su unidad, o el texto del cualitativo. */
export function ultimoValor(a: AnalitoHistorico): string {
  const p = a.serie.at(-1)
  if (!p) return '—'
  if (a.es_cualitativo || p.valor === null) return p.valor_texto ?? '—'
  const u = a.unidad && a.unidad !== '—' ? ` ${a.unidad}` : ''
  return `${p.valor}${u}`
}

function Badge({ estado }: { estado: EstadoAnalito }) {
  return (
    <span
      className="inline-block whitespace-nowrap rounded-pill px-2 py-0.5 text-[10px] font-bold tracking-wide"
      style={{
        color: COLOR_ESTADO[estado],
        backgroundColor: `color-mix(in srgb, ${COLOR_ESTADO[estado]} 14%, transparent)`,
      }}
    >
      {TEXTO_ESTADO[estado]}
    </span>
  )
}

/**
 * La miniatura de la serie.
 *
 * Sin ejes ni etiquetas a propósito: aquí no se lee un valor, se lee una
 * dirección. El número exacto está en la celda de al lado y el detalle, en el
 * modal.
 */
function Sparkline({ a, estado }: { a: AnalitoHistorico; estado: EstadoAnalito }) {
  const puntos = a.serie.filter((p) => p.valor !== null).map((p) => p.valor as number)
  if (a.es_cualitativo || puntos.length < 2) return null

  const W = 80
  const H = 32
  const P = 4
  const min = Math.min(...puntos)
  const max = Math.max(...puntos)
  // Un 5 % de aire para que un punto no quede pegado al borde, donde se corta
  // a la mitad. Si todos los valores son iguales, la línea va centrada.
  const margen = (max - min) * 0.05 || Math.abs(max) * 0.05 || 1
  const bajo = min - margen
  const alto = max + margen
  const x = (i: number) => P + (i / (puntos.length - 1)) * (W - P * 2)
  const y = (v: number) => P + (1 - (v - bajo) / (alto - bajo)) * (H - P * 2)

  const color = COLOR_ESTADO[estado]
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Evolución de ${a.nombre}`}>
      <polyline
        points={puntos.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={x(puntos.length - 1)} cy={y(puntos[puntos.length - 1]!)} r="3" fill={color} />
    </svg>
  )
}

function FlechaVariacion({ v }: { v: Variacion }) {
  const color = v.empeora ? COLOR_ESTADO.bad : COLOR_ESTADO.ok
  return (
    <span className="whitespace-nowrap text-xs font-medium tabular-nums" style={{ color }}>
      {v.up ? '▲' : '▼'} {v.pct} %
    </span>
  )
}

const TODOS = '__todos__'

export function PanelAnalitica({ pacienteId }: { pacienteId: string }) {
  const [datos, setDatos] = useState<AnalitoHistorico[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [grupo, setGrupo] = useState<string>(TODOS)
  const [abierto, setAbierto] = useState<AnalitoHistorico | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setDatos(null)
    setError(null)
    getAnalitica(pacienteId, ctrl.signal)
      .then((d) => {
        if (!ctrl.signal.aborted) setDatos(d)
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof ApiError ? e.message : 'No se pudo cargar la analítica')
      })
    return () => ctrl.abort()
  }, [pacienteId])

  const grupos = useMemo(
    () => ordenarGrupos([...new Set((datos ?? []).map((a) => a.grupo))]),
    [datos],
  )

  const visibles = useMemo(
    () => (datos ?? []).filter((a) => grupo === TODOS || a.grupo === grupo),
    [datos, grupo],
  )

  const alterados = useMemo(
    () => (datos ?? []).filter((a) => calcularEstado(a) === 'bad'),
    [datos],
  )

  /**
   * El banner lleva al primer alterado, no solo cuenta cuántos hay.
   *
   * El `setTimeout` no es un parche de carrera: al pulsar se cambia a «Todos»
   * y la fila a la que hay que ir **todavía no está en el DOM** si estaba en
   * otro grupo. Hay que dejar que React pinte antes de pedirle que la busque.
   */
  const primeraAlterada = useRef<HTMLTableRowElement>(null)

  function irAlPrimerAlterado() {
    setGrupo(TODOS)
    setTimeout(() => {
      primeraAlterada.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
  }

  if (error) {
    return (
      <p
        role="alert"
        className="rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
      >
        {error}
      </p>
    )
  }

  if (datos === null) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
    )
  }

  if (datos.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
        Este paciente aún no tiene estudios registrados con analitos del catálogo.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {/*
        El aviso de lo alterado, encima de todo — R50.

        Es lo que se mira primero en una consulta de seguimiento, y buscarlo
        recorriendo once pestañas es justo lo que esta pantalla vino a evitar.
      */}
      {alterados.length > 0 && (
        <button
          type="button"
          onClick={irAlPrimerAlterado}
          className="flex w-full items-center gap-2 rounded-lg border px-4 py-2.5 text-left text-sm transition-colors hover:brightness-95"
          style={{
            borderColor: 'var(--status-critical)',
            backgroundColor: 'color-mix(in srgb, var(--status-critical) 8%, transparent)',
          }}
        >
          <span aria-hidden="true" style={{ color: 'var(--status-critical)' }}>
            ⚠
          </span>
          <span className="text-ink">
            <strong className="font-semibold">
              {alterados.length}{' '}
              {alterados.length === 1 ? 'analito fuera de rango' : 'analitos fuera de rango'}
            </strong>{' '}
            en el último estudio de cada uno.
          </span>
        </button>
      )}

      {/* Pestañas de grupo. Con scroll horizontal: once no caben en un móvil
          y partirlas en dos filas descoloca el subrayado. */}
      <div className="overflow-x-auto border-b border-border">
        <nav className="flex min-w-max gap-1" aria-label="Grupos de analitos">
          {[TODOS, ...grupos].map((g) => {
            const activa = g === grupo
            return (
              <button
                key={g}
                type="button"
                onClick={() => setGrupo(g)}
                aria-current={activa ? 'page' : undefined}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
                  activa
                    ? 'border-primary font-semibold text-primary'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {g === TODOS ? 'Todos' : formatGrupo(g)}
              </button>
            )
          })}
        </nav>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left">
              <th className="px-4 py-2 font-semibold text-ink">Analito</th>
              <th className="px-3 py-2 font-semibold text-ink">Último valor</th>
              {/* Referencia SÍ se queda en móvil: un valor sin el rango contra el
                  que se lee no se puede interpretar, y es justo lo que esta
                  tabla viene a dar. Lo que se va son Variación, Tendencia y
                  Fecha, que son contexto. */}
              <th className="px-3 py-2 font-semibold text-ink">Referencia</th>
              <th className="px-3 py-2 font-semibold text-ink">Estado</th>
              <th className="hidden px-3 py-2 font-semibold text-ink sm:table-cell">Variación</th>
              <th className="hidden px-3 py-2 font-semibold text-ink sm:table-cell">Tendencia</th>
              <th className="hidden px-3 py-2 font-semibold text-ink sm:table-cell">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((a) => {
              const estado = calcularEstado(a)
              const v = calcularVariacion(a)
              const ultimo = a.serie.at(-1)
              // La ref va en la PRIMERA alterada de lo que se está viendo: es
              // a la que lleva el banner.
              const esPrimeraAlterada =
                estado === 'bad' && a.codigo === visibles.find((x) => calcularEstado(x) === 'bad')?.codigo
              return (
                <tr
                  key={a.codigo}
                  ref={esPrimeraAlterada ? primeraAlterada : undefined}
                  onClick={() => setAbierto(a)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setAbierto(a)
                    }
                  }}
                  aria-label={`Ver la tendencia de ${a.nombre}`}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2"
                >
                  <td className="px-4 py-2">
                    <span className="font-medium text-ink">{a.nombre}</span>
                    <span className="ml-1.5 hidden text-xs text-muted sm:inline">{a.codigo}</span>
                  </td>
                  <td
                    className="px-3 py-2 font-semibold tabular-nums"
                    style={{ color: estado === 'bad' ? COLOR_ESTADO.bad : 'var(--ink)' }}
                  >
                    {ultimoValor(a)}
                  </td>
                  <td className="px-3 py-2 text-muted">{textoReferencia(a)}</td>
                  <td className="px-3 py-2">
                    <Badge estado={estado} />
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">
                    {v ? <FlechaVariacion v={v} /> : <span className="text-muted">—</span>}
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">
                    <Sparkline a={a} estado={estado} />
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-muted sm:table-cell">
                    {ultimo ? fechaLarga(ultimo.fecha) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <TendenciaModal analito={abierto} onClose={() => setAbierto(null)} />
    </div>
  )
}
