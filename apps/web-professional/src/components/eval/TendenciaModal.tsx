/**
 * La historia de un analito, a tamaño de lectura — R49, R50.
 *
 * La tabla de analítica contesta «¿cómo está?» de un vistazo. Esto contesta
 * «¿cómo ha ido?»: el recorrido completo contra la banda de referencia, que
 * es la lectura que no cabe en una fila de tabla.
 *
 * ## Por qué SVG a mano y no una librería de gráficas
 *
 * El encargo proponía instalar `recharts`. No se hizo, y la decisión está
 * tomada a conciencia:
 *
 *   - `CLAUDE.md` pide justificar cualquier dependencia pesada, y media
 *     docena de puntos sobre un eje de fechas no la justifica.
 *   - Ya hay cuatro gráficas hechas así en esta aplicación
 *     (`GraficaComposicion`, `DashboardBioquimica`, `ResumenDietetico`), con
 *     el mismo patrón. Meter una librería para la quinta dejaría dos estilos
 *     conviviendo.
 *   - **El white-label.** Los colores tienen que salir de los tokens para que
 *     una gráfica signifique lo mismo en todas las clínicas. Con una librería
 *     hay que pasárselos a mano igual, así que el ahorro es menor de lo que
 *     parece.
 *
 * Lo que se pierde es el tooltip flotante; se sustituye por un `<title>` por
 * punto, que el navegador muestra al pasar por encima y que además leen los
 * lectores de pantalla — cosa que un tooltip pintado a mano no hace.
 *
 * ## Los cualitativos no llevan gráfica
 *
 * «No Reactiva» no se puede situar en un eje. En su lugar va una línea de
 * tiempo de lo que dijo cada estudio. Inventar un eje numérico para un
 * resultado que no lo tiene sería dibujar una tendencia que nadie midió.
 */
import type { ReactNode } from 'react'
import { Modal } from '../Modal'
import type { AnalitoHistorico } from '../../api/tipos'
import {
  COLOR_ESTADO,
  calcularEstado,
  calcularVariacion,
  fechaLarga,
  textoReferencia,
  ultimoValor,
  type EstadoAnalito,
} from './PanelAnalitica'

const TEXTO_ESTADO: Record<EstadoAnalito, string> = {
  ok: 'NORMAL',
  bad: 'ALTERADO',
  none: 'SIN REF.',
}

const ANCHO = 560
const ALTO = 200
const MARGEN = { arriba: 12, derecha: 14, abajo: 28, izquierda: 48 }

/** El estado de UN punto, no el del analito: cada medición tuvo el suyo. */
function estadoDePunto(v: number | null, a: AnalitoHistorico): EstadoAnalito {
  if (v === null) return 'none'
  if (a.refMin === null && a.refMax === null) return 'none'
  if (a.refMin !== null && v < a.refMin) return 'bad'
  if (a.refMax !== null && v > a.refMax) return 'bad'
  return 'ok'
}

/** «oct 26», para el eje de fechas. */
function mesCorto(iso: string): string {
  return new Date(`${iso}T12:00:00`)
    .toLocaleDateString('es-CR', { month: 'short', year: '2-digit' })
    .replace('.', '')
}

function Grafica({ a }: { a: AnalitoHistorico }) {
  const puntos = a.serie.filter((p) => p.valor !== null)
  if (puntos.length === 0) return null

  const valores = puntos.map((p) => p.valor as number)
  /*
   * **La banda de referencia entra siempre en el encuadre.**
   *
   * Si la escala se ajustara solo a los valores medidos, un paciente con todo
   * fuera de rango vería su línea cómodamente centrada y el límite fuera de
   * la imagen: la gráfica diría «normal» con los datos de «alterado».
   */
  const candidatos = [...valores]
  if (a.refMin !== null) candidatos.push(a.refMin)
  if (a.refMax !== null) candidatos.push(a.refMax)
  const bajo = Math.min(...candidatos)
  const alto = Math.max(...candidatos)
  const aire = (alto - bajo) * 0.1 || Math.abs(alto) * 0.1 || 1
  const min = bajo - aire
  const max = alto + aire

  const anchoUtil = ANCHO - MARGEN.izquierda - MARGEN.derecha
  const altoUtil = ALTO - MARGEN.arriba - MARGEN.abajo
  const x = (i: number) =>
    MARGEN.izquierda +
    (puntos.length === 1 ? anchoUtil / 2 : (i / (puntos.length - 1)) * anchoUtil)
  const y = (v: number) => MARGEN.arriba + altoUtil - ((v - min) / (max - min)) * altoUtil

  const hayBanda = a.refMin !== null || a.refMax !== null
  // Un rango abierto por un lado se dibuja hasta el borde del encuadre: es lo
  // que significa «< 200», y cerrarlo en un número inventado diría otra cosa.
  const bandaArriba = hayBanda ? y(a.refMax ?? max) : 0
  const bandaAbajo = hayBanda ? y(a.refMin ?? min) : 0

  const estadoActual = calcularEstado(a)
  const etiquetas =
    puntos.length <= 6
      ? puntos.map((_, i) => i)
      : [0, Math.floor((puntos.length - 1) / 2), puntos.length - 1]
  const dec = Math.max(0, Math.min(2, (String(valores[0]).split('.')[1] ?? '').length))

  return (
    <svg
      viewBox={`0 0 ${ANCHO} ${ALTO}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Evolución de ${a.nombre} en ${puntos.length} ${
        puntos.length === 1 ? 'estudio' : 'estudios'
      }, de ${valores[0]} a ${valores[valores.length - 1]} ${a.unidad}`}
    >
      {/* La banda va debajo de todo: es el fondo contra el que se lee la
          línea, no un dato más que compita con ella. */}
      {hayBanda && (
        <rect
          x={MARGEN.izquierda}
          y={bandaArriba}
          width={anchoUtil}
          height={Math.max(0, bandaAbajo - bandaArriba)}
          fill="color-mix(in srgb, var(--status-normal) 12%, transparent)"
        />
      )}
      {hayBanda &&
        [a.refMin, a.refMax].map((limite, i) =>
          limite === null ? null : (
            <line
              key={i}
              x1={MARGEN.izquierda}
              x2={ANCHO - MARGEN.derecha}
              y1={y(limite)}
              y2={y(limite)}
              stroke="var(--status-normal)"
              strokeWidth="1"
              strokeDasharray="4 3"
            />
          ),
        )}

      {[max, (max + min) / 2, min].map((v, i) => (
        <text
          key={i}
          x={MARGEN.izquierda - 6}
          y={y(v) + 3}
          textAnchor="end"
          fontSize="10"
          fill="var(--muted)"
        >
          {v.toFixed(dec)}
        </text>
      ))}

      {puntos.length > 1 && (
        <polyline
          points={puntos.map((p, i) => `${x(i)},${y(p.valor as number)}`).join(' ')}
          fill="none"
          stroke={COLOR_ESTADO[estadoActual]}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {puntos.map((p, i) => {
        const e = estadoDePunto(p.valor, a)
        return (
          <circle
            key={p.estudio_id}
            cx={x(i)}
            cy={y(p.valor as number)}
            r="4"
            fill={COLOR_ESTADO[e]}
          >
            {/* El tooltip: nativo, y además lo leen los lectores de pantalla. */}
            <title>
              {fechaLarga(p.fecha)} · {p.valor} {a.unidad} ·{' '}
              {e === 'bad'
                ? 'fuera de referencia'
                : e === 'ok'
                  ? 'dentro de referencia'
                  : 'sin referencia'}
            </title>
          </circle>
        )
      })}

      {etiquetas.map((i) => (
        <text
          key={i}
          x={x(i)}
          y={ALTO - 8}
          textAnchor={i === 0 ? 'start' : i === puntos.length - 1 ? 'end' : 'middle'}
          fontSize="10"
          fill="var(--muted)"
        >
          {mesCorto(puntos[i]!.fecha)}
        </text>
      ))}
    </svg>
  )
}

function Kpi({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{etiqueta}</p>
      <div className="mt-1">{children}</div>
    </div>
  )
}

export function TendenciaModal({
  analito,
  onClose,
}: {
  analito: AnalitoHistorico | null
  onClose: () => void
}) {
  // `Modal` ya cierra con Escape, cierra con clic en el fondo, mete el foco
  // dentro y lo devuelve al salir. Rehacer eso aquí sería repetirlo peor.
  if (!analito) {
    return (
      <Modal abierto={false} onCerrar={onClose} titulo="">
        {null}
      </Modal>
    )
  }

  const a = analito
  const estado = calcularEstado(a)
  const v = calcularVariacion(a)
  const ultimo = a.serie.at(-1)

  const etiquetaRango = a.es_cualitativo
    ? 'no aplica'
    : a.refMin !== null && a.refMax !== null
      ? 'rango normal'
      : a.refMax !== null
        ? 'valor máximo'
        : a.refMin !== null
          ? 'valor mínimo'
          : 'sin referencia'

  return (
    <Modal
      abierto
      onCerrar={onClose}
      titulo={a.nombre}
      descripcion={`${a.codigo} · ${a.serie.length} ${
        a.serie.length === 1 ? 'estudio' : 'estudios'
      }`}
    >
      <div className="space-y-4">
        <div>
          <span
            className="inline-block rounded-pill px-2 py-0.5 text-[10px] font-bold tracking-wide"
            style={{
              color: COLOR_ESTADO[estado],
              backgroundColor: `color-mix(in srgb, ${COLOR_ESTADO[estado]} 14%, transparent)`,
            }}
          >
            {TEXTO_ESTADO[estado]}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi etiqueta="Último valor">
            <p
              className="text-xl font-bold tabular-nums"
              style={{ color: estado === 'bad' ? COLOR_ESTADO.bad : 'var(--ink)' }}
            >
              {ultimoValor(a)}
            </p>
            {ultimo && <p className="text-xs text-muted">{fechaLarga(ultimo.fecha)}</p>}
          </Kpi>

          <Kpi etiqueta="Referencia">
            <p className="text-xl font-bold tabular-nums text-ink">{textoReferencia(a)}</p>
            <p className="text-xs text-muted">{etiquetaRango}</p>
          </Kpi>

          <Kpi etiqueta="Vs. anterior">
            {v ? (
              <>
                <p
                  className="text-xl font-bold tabular-nums"
                  style={{ color: v.empeora ? COLOR_ESTADO.bad : COLOR_ESTADO.ok }}
                >
                  {v.up ? '▲' : '▼'} {v.pct} %
                </p>
                <p className="text-xs text-muted">{v.up ? 'Subió' : 'Bajó'}</p>
              </>
            ) : (
              <>
                <p className="text-xl font-bold text-muted">—</p>
                <p className="text-xs text-muted">
                  {a.serie.length < 2 ? 'Un solo estudio' : 'Sin cambio'}
                </p>
              </>
            )}
          </Kpi>
        </div>

        {a.es_cualitativo ? (
          /*
           * Línea de tiempo, lo más reciente primero: es el orden en que se
           * lee un historial cuando lo que importa es si algo cambió.
           */
          <ul className="space-y-1.5">
            {[...a.serie].reverse().map((p) => (
              <li key={p.estudio_id} className="flex items-center gap-3 text-sm">
                <span aria-hidden="true" style={{ color: 'var(--primary)' }}>
                  ●
                </span>
                <span className="w-28 shrink-0 text-xs text-muted">{fechaLarga(p.fecha)}</span>
                <span className="rounded-pill border border-border px-2.5 py-0.5 text-ink">
                  {p.valor_texto ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <figure className="rounded-md border border-border bg-surface p-2">
            <Grafica a={a} />
            <figcaption className="px-2 pb-1 text-xs text-muted">
              La banda verde es el rango de referencia. Cada punto lleva su fecha y su estado;
              pasa por encima para verlos.
            </figcaption>
          </figure>
        )}
      </div>
    </Modal>
  )
}
