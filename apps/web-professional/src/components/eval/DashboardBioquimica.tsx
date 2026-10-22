// DEPRECATED — reemplazado por PanelAnalitica (R50). Eliminar cuando se confirme que no hay referencias.
//
// Desconectado en R51: ya no hay ninguna ruta ni pestaña que lo monte. Se
// conserva el archivo a propósito —no se borra todavía— por si la pestaña
// Analítica necesita rescatar algo de aquí antes de la limpieza.
/**
 * Evolución de laboratorios — R46.
 *
 * Una gráfica de línea por biomarcador con todo su histórico. Responde a la
 * pregunta que una tabla de un solo estudio no puede responder: **hacia dónde
 * va**. Una glucosa de 112 no dice lo mismo si venía de 140 que si venía de 95,
 * y hasta aquí eso había que reconstruirlo abriendo estudio por estudio.
 *
 * ## Sin librería de gráficas
 *
 * SVG a mano, como `GraficaComposicion.tsx` y por lo mismo: son series cortas
 * sobre un eje de tiempo, y así los colores salen de los tokens igual que el
 * resto de la aplicación. Una dependencia de gráficas por esto no se sostiene.
 *
 * ## Los colores aquí NO son decorativos
 *
 * El punto se pinta con el color de su ESTADO —normal, alterado, sin
 * referencia—, que son los colores clínicos fijos del design system. Son los
 * mismos que usa la tabla de laboratorios, así que un punto naranja en la
 * gráfica y una fila naranja en la tabla significan lo mismo. El color nunca va
 * solo: cada punto lleva su `<title>` con fecha, valor y estado en palabras.
 *
 * ## Lo que no se dibuja
 *
 * Un biomarcador con **un solo** resultado sale con su tarjeta y su valor, pero
 * sin gráfica: una línea de un punto no es una tendencia, y dibujarla sugiere
 * una que nadie ha medido.
 *
 * ## De dónde salen los datos
 *
 * De `GET /api/pacientes/:id/laboratorios`, que ya existía. No hace falta
 * endpoint nuevo, y como el componente pide los datos al montarse, la gráfica
 * se actualiza sola en cuanto el profesional registra un estudio y vuelve a
 * esta pestaña.
 */
import { useEffect, useState } from 'react'
import { getBiomarcadores, getLaboratorios } from '../../api/laboratorios'
import { formatGrupo } from '../../lib/grupos'
import type { Biomarcador, EstadoResultado, EstudioLab } from '../../api/tipos'

/* ------------------------------------------------------------------ */
/* Las series                                                          */
/* ------------------------------------------------------------------ */

interface Punto {
  fecha: string
  valor: number
  estado: EstadoResultado
  rango: { minimo: number | null; maximo: number | null } | null
}

interface Serie {
  codigo: string
  nombre: string
  unidad: string
  grupo: string
  puntos: Punto[]
}

const SIN_GRUPO = 'Otros'

/**
 * Un punto por estudio en el que ese biomarcador se midió.
 *
 * Los estudios llegan en orden descendente —el más reciente primero, que es lo
 * que quiere una lista— y aquí se invierten: una gráfica de tiempo que avanza
 * hacia la izquierda se lee al revés de como se lee todo lo demás.
 *
 * El rango se toma del punto MÁS RECIENTE y no del primero: es el criterio con
 * el que se está valorando hoy, y es el que el profesional reconoce.
 */
function construirSeries(
  estudios: EstudioLab[],
  gruposPorCodigo: Map<string, { grupo: string; decimales: number }>,
): Serie[] {
  const porCodigo = new Map<string, Serie>()

  const ascendente = estudios
    .slice()
    .sort((a, b) => a.fecha.localeCompare(b.fecha))

  for (const e of ascendente) {
    for (const r of e.resultados) {
      /*
       * **Solo los catalogados y con número** — R49.
       *
       * Esta pantalla dibuja una evolución contra un rango. Un cualitativo
       * («No Reactiva») no tiene número que trazar, y un analito sin código
       * no se puede unir entre estudios: «IgG» e «Inmunoglobulina G»
       * escritos a mano no garantizan ser la misma medición. Los dos siguen
       * visibles en el detalle de su estudio, que es donde se leen.
       */
      if (r.codigo === null || r.valor === null) continue
      const codigo = r.codigo
      const serie = porCodigo.get(codigo) ?? {
        codigo,
        nombre: r.nombre,
        unidad: r.unidad,
        grupo: gruposPorCodigo.get(codigo)?.grupo ?? SIN_GRUPO,
        puntos: [],
      }
      serie.puntos.push({ fecha: e.fecha, valor: r.valor, estado: r.estado, rango: r.rango })
      porCodigo.set(codigo, serie)
    }
  }

  return [...porCodigo.values()]
}

/** El color clínico del estado. Los mismos tres que usa la tabla. */
function colorEstado(estado: EstadoResultado): string {
  switch (estado) {
    case 'normal':
      return 'var(--status-normal)'
    case 'alterado':
      return 'var(--status-critical)'
    case 'sin_referencia':
      return 'var(--muted)'
  }
}

const TEXTO_ESTADO: Record<EstadoResultado, string> = {
  normal: 'dentro de referencia',
  alterado: 'fuera de referencia',
  sin_referencia: 'sin referencia',
}

function fechaCorta(iso: string): string {
  const [, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}

/** Suficientes decimales para que dos medidas distintas no se vean iguales. */
function formatear(valor: number, decimales: number): string {
  return valor.toFixed(decimales)
}

/* ------------------------------------------------------------------ */
/* La gráfica                                                          */
/* ------------------------------------------------------------------ */

const ANCHO = 320
const ALTO = 90
const MARGEN = { arriba: 8, derecha: 8, abajo: 20, izquierda: 38 }

/**
 * La escala vertical.
 *
 * **La banda de referencia entra siempre en el encuadre.** Si el eje se
 * ajustara solo a los valores medidos, un paciente con todo fuera de rango
 * vería una línea cómodamente centrada y el límite fuera de la imagen: la
 * gráfica diría «normal» con los datos de «alterado». Por eso el mínimo y el
 * máximo del rango participan del cálculo.
 *
 * El 10 % de aire evita que un punto quede pegado al borde, donde se corta a la
 * mitad y deja de poder compararse con el siguiente.
 */
function escala(puntos: Punto[]): { min: number; max: number } {
  const valores = puntos.map((p) => p.valor)
  const ref = puntos[puntos.length - 1]?.rango ?? null
  if (ref?.minimo !== null && ref?.minimo !== undefined) valores.push(ref.minimo)
  if (ref?.maximo !== null && ref?.maximo !== undefined) valores.push(ref.maximo)

  const bajo = Math.min(...valores)
  const alto = Math.max(...valores)
  // Todos los valores iguales: sin aire la línea caeria sobre el borde y la
  // division por cero dejaria la gráfica en blanco.
  if (alto === bajo) {
    const aire = Math.abs(alto) * 0.1 || 1
    return { min: bajo - aire, max: alto + aire }
  }
  const aire = (alto - bajo) * 0.1
  return { min: bajo - aire, max: alto + aire }
}

function Grafica({ serie, decimales }: { serie: Serie; decimales: number }) {
  const { puntos } = serie
  const { min, max } = escala(puntos)
  const anchoUtil = ANCHO - MARGEN.izquierda - MARGEN.derecha
  const altoUtil = ALTO - MARGEN.arriba - MARGEN.abajo

  const x = (i: number) =>
    MARGEN.izquierda + (i / (puntos.length - 1)) * anchoUtil
  const y = (v: number) =>
    MARGEN.arriba + altoUtil - ((v - min) / (max - min)) * altoUtil

  const ref = puntos[puntos.length - 1]?.rango ?? null
  const hayBanda = ref !== null && (ref.minimo !== null || ref.maximo !== null)
  // Un rango abierto por un lado se dibuja hasta el borde del encuadre: es
  // lo que significa «< 200», y cerrarlo en un numero inventado seria decir
  // otra cosa.
  const bandaDesde = hayBanda ? y(ref.maximo ?? max) : 0
  const bandaHasta = hayBanda ? y(ref.minimo ?? min) : 0

  /*
   * Las fechas del eje: todas si caben, las dos puntas si no.
   *
   * Con más de cinco estudios las etiquetas se solapan y dejan de leerse; la
   * primera y la última bastan para situar el recorrido, y cada punto lleva su
   * fecha exacta en el `<title>`.
   */
  const etiquetas =
    puntos.length <= 5 ? puntos.map((_, i) => i) : [0, puntos.length - 1]

  return (
    <svg
      viewBox={`0 0 ${ANCHO} ${ALTO}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Evolución de ${serie.nombre} en ${puntos.length} estudios, de ${formatear(
        puntos[0]!.valor,
        decimales,
      )} a ${formatear(puntos[puntos.length - 1]!.valor, decimales)} ${serie.unidad}`}
    >
      {/* La banda de referencia va debajo de todo: es el fondo contra el que
          se lee la línea, no un dato más que compita con ella. */}
      {hayBanda && (
        <rect
          x={MARGEN.izquierda}
          y={bandaDesde}
          width={anchoUtil}
          height={Math.max(0, bandaHasta - bandaDesde)}
          fill="color-mix(in srgb, var(--status-normal) 12%, transparent)"
        />
      )}
      {hayBanda &&
        [ref.minimo, ref.maximo].map((limite, i) =>
          limite === null ? null : (
            <line
              key={i}
              x1={MARGEN.izquierda}
              x2={ANCHO - MARGEN.derecha}
              y1={y(limite)}
              y2={y(limite)}
              stroke="var(--status-normal)"
              strokeWidth="0.8"
              strokeDasharray="3 2"
            />
          ),
        )}

      {/* Tres marcas en el eje: alto, medio y bajo del encuadre. Una cuarta
          en 90 px de alto empieza a pisarse con las de al lado. */}
      {[max, (max + min) / 2, min].map((v, i) => (
        <text
          key={i}
          x={MARGEN.izquierda - 5}
          y={y(v) + 3}
          textAnchor="end"
          fontSize="8"
          fill="var(--muted)"
        >
          {formatear(v, decimales)}
        </text>
      ))}

      <polyline
        points={puntos.map((p, i) => `${x(i)},${y(p.valor)}`).join(' ')}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="1.5"
      />

      {puntos.map((p, i) => (
        <circle key={`${p.fecha}-${i}`} cx={x(i)} cy={y(p.valor)} r="3" fill={colorEstado(p.estado)}>
          <title>
            {fechaCorta(p.fecha)} · {formatear(p.valor, decimales)} {serie.unidad} ·{' '}
            {TEXTO_ESTADO[p.estado]}
          </title>
        </circle>
      ))}

      {etiquetas.map((i) => (
        <text
          key={i}
          x={x(i)}
          y={ALTO - 6}
          textAnchor={i === 0 ? 'start' : i === puntos.length - 1 ? 'end' : 'middle'}
          fontSize="8"
          fill="var(--muted)"
        >
          {fechaCorta(puntos[i]!.fecha)}
        </text>
      ))}
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* La fila de un biomarcador                                           */
/* ------------------------------------------------------------------ */

function FilaBiomarcador({ serie, decimales }: { serie: Serie; decimales: number }) {
  const ultimo = serie.puntos[serie.puntos.length - 1]!
  const previo = serie.puntos.length > 1 ? serie.puntos[serie.puntos.length - 2]! : null
  const delta = previo === null ? null : ultimo.valor - previo.valor

  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface-2 p-4 sm:grid-cols-[minmax(0,13rem)_1fr] sm:items-center">
      <div>
        <p className="text-sm font-semibold text-ink">{serie.nombre}</p>
        <p className="text-2xl font-bold tabular-nums" style={{ color: colorEstado(ultimo.estado) }}>
          {formatear(ultimo.valor, decimales)}{' '}
          <span className="text-sm font-medium text-muted">{serie.unidad}</span>
        </p>
        <p className="text-xs text-muted">
          {fechaCorta(ultimo.fecha)}
          {/*
            El cambio respecto al estudio anterior, en números y con signo.
            La flecha sola no dice cuánto, y «subió» sin magnitud no permite
            decidir nada.
          */}
          {delta !== null && (
            <>
              {' · '}
              <span className="tabular-nums">
                {delta > 0 ? '+' : ''}
                {formatear(delta, decimales)} vs. anterior
              </span>
            </>
          )}
        </p>
        {/* El estado en palabras, no solo en color (los tres estados se
            distinguen por tono, y el tono solo no es accesible). */}
        <p className="mt-0.5 text-xs" style={{ color: colorEstado(ultimo.estado) }}>
          {TEXTO_ESTADO[ultimo.estado]}
        </p>
      </div>

      {serie.puntos.length < 2 ? (
        <p className="text-xs text-muted sm:text-right">
          Un solo estudio registrado. La evolución aparece a partir del segundo.
        </p>
      ) : (
        <Grafica serie={serie} decimales={decimales} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* El panel                                                            */
/* ------------------------------------------------------------------ */

export function DashboardBioquimica({ pacienteId }: { pacienteId: string }) {
  const [estudios, setEstudios] = useState<EstudioLab[]>([])
  const [catalogo, setCatalogo] = useState<Biomarcador[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setCargando(true)
    setError(null)
    /*
     * Los dos en paralelo: el catálogo solo aporta el grupo y los decimales,
     * y esperar a uno para pedir el otro duplicaría la espera sin motivo.
     *
     * El fallo del catálogo NO tumba el panel: sin él las series van a
     * «Otros» con un decimal, que es peor presentación pero los mismos datos.
     * Lo que no se puede es dejar de enseñar los laboratorios por no saber a
     * qué grupo pertenecen.
     */
    Promise.all([
      getLaboratorios(pacienteId, ctrl.signal),
      getBiomarcadores(null, ctrl.signal).catch(() => [] as Biomarcador[]),
    ])
      .then(([labs, bios]) => {
        if (ctrl.signal.aborted) return
        setEstudios(labs)
        setCatalogo(bios)
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError('No se pudieron cargar los laboratorios de este paciente.')
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false)
      })
    return () => ctrl.abort()
  }, [pacienteId])

  const metaPorCodigo = new Map(
    catalogo.map((b) => [b.codigo, { grupo: b.grupo, decimales: b.decimales }]),
  )
  const series = construirSeries(estudios, metaPorCodigo)

  // Agrupadas como en la pantalla de captura: el profesional busca por grupo
  // —«el perfil lipídico»—, no por nombre suelto. El orden del catálogo es el
  // clínico; las que no están en él van al final.
  const ordenGrupo = [...new Set(catalogo.map((b) => b.grupo))]
  const porGrupo = new Map<string, Serie[]>()
  for (const s of series) {
    porGrupo.set(s.grupo, [...(porGrupo.get(s.grupo) ?? []), s])
  }
  const gruposOrdenados = [...porGrupo.keys()].sort((a, b) => {
    const ia = ordenGrupo.indexOf(a)
    const ib = ordenGrupo.indexOf(b)
    return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
  })

  return (
    <div className="space-y-6 rounded-lg border border-border bg-surface p-5">
      <div>
        <h2 className="text-lg font-bold text-ink">Evolución de laboratorios</h2>
        <p className="text-sm text-muted">
          Histórico de todos los estudios cargados. El color de cada punto es su estado frente a la
          referencia de ese estudio.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--status-critical)] bg-surface-2 p-3 text-sm text-ink"
        >
          {error}
        </p>
      )}

      {cargando && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded bg-surface-2" />
          ))}
        </div>
      )}

      {!cargando && !error && series.length === 0 && (
        <p className="rounded-lg border border-border bg-surface-2 p-6 text-center text-sm text-muted">
          Aún no hay estudios de laboratorio registrados para este paciente.
        </p>
      )}

      {!cargando &&
        series.length > 0 &&
        gruposOrdenados.map((grupo) => (
          <section key={grupo} className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              {formatGrupo(grupo)}
            </h3>
            {(porGrupo.get(grupo) ?? []).map((s) => (
              <FilaBiomarcador
                key={s.codigo}
                serie={s}
                decimales={metaPorCodigo.get(s.codigo)?.decimales ?? 1}
              />
            ))}
          </section>
        ))}
    </div>
  )
}
