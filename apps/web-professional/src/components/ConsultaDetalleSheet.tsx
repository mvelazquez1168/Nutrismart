/**
 * Panel lateral con el detalle de una consulta pasada — R43.
 *
 * Es SOLO LECTURA: ni un input, ni un botón de guardar. Lo que se abre
 * desde aquí es el registro de lo que se valoró ese día; editar se sigue
 * haciendo entrando a la valoración.
 *
 * Carga perezosa: la petición sale al abrirse, no al montar la lista.
 * Una ficha con quince consultas no debe traerse quince detalles para
 * que el profesional abra uno.
 *
 * Las secciones sin datos NO se dibujan vacías. Un bloque «Diagnósticos»
 * con un guion ocupa el mismo sitio que uno con contenido y obliga a
 * leerlo para descubrir que no dice nada; que el hueco no exista es más
 * rápido de recorrer. Al pie se nombran las que faltaron, para que no se
 * confunda «no se registró» con «no existe en el sistema».
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  etiquetaTipoConsulta,
  getConsultaDetalle,
  RESTRICCIONES,
  RESTRICCIONES_RETIRADAS,
  type ConsultaDetalle,
} from '../api/valoracion'
import { TIPOS_COMIDA } from '../api/planes'
import {
  METODOS_GEB,
  azucarLibreCdas,
  interpretarDE,
  salCdtas,
} from '../lib/calculadoraNutricion'

interface Props {
  pacienteId: string
  /** Consulta a mostrar; null = panel cerrado. */
  consultaId: string | null
  onCerrar: () => void
}

function formatearFecha(iso: string | null): string {
  if (!iso) return '—'
  const [anio, mes, dia] = iso.slice(0, 10).split('-')
  if (!anio || !mes || !dia) return iso
  return `${dia}/${mes}/${anio}`
}

const ETIQUETA_RESTRICCION: Record<string, string> = {
  ...Object.fromEntries(RESTRICCIONES.map((r) => [r.clave, r.etiqueta])),
  ...RESTRICCIONES_RETIRADAS,
}

const ETIQUETA_COMIDA: Record<string, string> = Object.fromEntries(
  TIPOS_COMIDA.map((t) => [t.clave, t.etiqueta]),
)

const ETIQUETA_METODO_GER: Record<string, string> = Object.fromEntries(
  METODOS_GEB.map((m) => [m.clave, m.etiqueta]),
)

const ETIQUETA_METODO_COMPOSICION: Record<string, string> = {
  bia: 'Bioimpedancia',
  pliegues: 'Pliegues cutáneos',
}

/* ------------------------------------------------------------------ */
/* Piezas de presentación                                              */
/* ------------------------------------------------------------------ */

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="border-t border-border px-6 py-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{titulo}</h3>
      {children}
    </section>
  )
}

function Dato({
  etiqueta,
  children,
}: {
  etiqueta: string
  children: ReactNode
}) {
  return (
    <div>
      <dt className="text-xs text-muted">{etiqueta}</dt>
      <dd className="text-sm font-medium tabular-nums text-ink">{children}</dd>
    </div>
  )
}

/** Párrafo que respeta los saltos de línea con que se escribió. */
function Texto({ children }: { children: string }) {
  return <p className="whitespace-pre-wrap text-sm text-ink">{children}</p>
}

function Lista({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <li key={`${i}-${t}`} className="flex gap-2 text-sm text-ink">
          <span aria-hidden="true" className="text-muted">
            •
          </span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  )
}

/** Medida con unidad; devuelve null para que la rejilla la omita. */
function medida(valor: number | null, unidad: string): string | null {
  if (valor === null || valor === undefined) return null
  return `${valor} ${unidad}`
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function ConsultaDetalleSheet({ pacienteId, consultaId, onCerrar }: Props) {
  const [detalle, setDetalle] = useState<ConsultaDetalle | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cerrarRef = useRef<HTMLButtonElement>(null)
  const focoPrevioRef = useRef<HTMLElement | null>(null)

  const cerrar = useCallback(() => onCerrar(), [onCerrar])

  // Un solo efecto por consultaId: pide los datos y deja el panel en
  // estado de carga. El AbortController cubre el caso de cerrar —o
  // cambiar de consulta— antes de que llegue la respuesta.
  useEffect(() => {
    if (!consultaId) {
      setDetalle(null)
      setError(null)
      return
    }
    const ctrl = new AbortController()
    setDetalle(null)
    setError(null)
    setCargando(true)
    getConsultaDetalle(pacienteId, consultaId, ctrl.signal)
      .then((d) => {
        if (!ctrl.signal.aborted) setDetalle(d)
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'No se pudo cargar el detalle de la consulta')
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false)
      })
    return () => ctrl.abort()
  }, [pacienteId, consultaId])

  // Lo mismo que hace Modal.tsx: Escape cierra, el foco entra al abrir y
  // vuelve de donde vino, y el fondo no se mueve detrás del panel.
  useEffect(() => {
    if (!consultaId) return

    focoPrevioRef.current = document.activeElement as HTMLElement | null
    cerrarRef.current?.focus()

    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar()
    }
    document.addEventListener('keydown', alTeclear)

    const overflowPrevio = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', alTeclear)
      document.body.style.overflow = overflowPrevio
      focoPrevioRef.current?.focus()
    }
  }, [consultaId, cerrar])

  if (!consultaId) return null

  const c = detalle?.consulta
  const a = detalle?.antropometria
  const k = detalle?.conclusion
  const plan = detalle?.plan
  const calc = k?.datosCalculadora ?? null

  /* ---- Antropometría: solo las medidas que se tomaron ---- */
  const antropometricos: { etiqueta: string; valor: string }[] = a
    ? (
        [
          ['Peso', medida(a.pesoKg, 'kg')],
          ['Talla', medida(a.tallaCm, 'cm')],
          ['IMC', medida(a.imc, 'kg/m²')],
          ['% Grasa', medida(a.pctGrasa, '%')],
          ['Masa grasa', medida(a.masaGrasaKg, 'kg')],
          ['Masa libre de grasa', medida(a.masaLibreGrasaKg, 'kg')],
          ['Masa muscular', medida(a.masaMuscularKg, 'kg')],
          ['Agua corporal', medida(a.aguaCorporalPct, '%')],
          ['Ángulo de fase', medida(a.anguloFase, '°')],
          ['Cintura', medida(a.cinturaCm, 'cm')],
          ['Cadera', medida(a.caderaCm, 'cm')],
          ['ICC', a.icc === null ? null : String(a.icc)],
          ['Brazo', medida(a.brazoCm, 'cm')],
          ['Pierna', medida(a.piernaCm, 'cm')],
        ] as [string, string | null][]
      )
        .filter((p): p is [string, string] => p[1] !== null)
        .map(([etiqueta, valor]) => ({ etiqueta, valor }))
    : []

  const hayDiagnosticos = Boolean(k?.diagnosticoPrincipal || k?.diagnosticoSecundario)
  const hayPrescripcion = Boolean(
    k &&
      (k.kcalPrescritas !== null ||
        k.pctProteina !== null ||
        k.restricciones.length > 0 ||
        k.pesoObjetivo !== null ||
        k.suplementos),
  )
  const comidasConContenido = (plan?.comidas ?? []).filter((m) => m.patron || m.ejemploMenu)
  const lecturaDE =
    calc?.disponibilidadEnergetica !== null && calc?.disponibilidadEnergetica !== undefined
      ? interpretarDE(calc.disponibilidadEnergetica)
      : null

  /* ---- Lo que no se registró, nombrado al pie ---- */
  const ausentes = detalle
    ? [
        antropometricos.length === 0 ? 'Antropometría' : null,
        hayDiagnosticos ? null : 'Diagnósticos',
        k?.objetivos ? null : 'Objetivos del tratamiento',
        k?.observacionesClinicas ? null : 'Observaciones clínicas',
        hayPrescripcion ? null : 'Prescripción dietética',
        k?.justificacion ? null : 'Justificación',
        comidasConContenido.length > 0 ? null : 'Plan alimentario',
        (k?.recomendaciones.length ?? 0) > 0 ? null : 'Recomendaciones',
        (k?.acuerdos.length ?? 0) > 0 ? null : 'Acuerdos',
      ].filter((x): x is string => x !== null)
    : []

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40"
      onMouseDown={(e) => {
        // Solo si el clic empieza Y termina en el fondo: arrastrar para
        // seleccionar texto dentro del panel no debe cerrarlo.
        if (e.target === e.currentTarget) cerrar()
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="consulta-detalle-titulo"
        className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-border bg-surface shadow-lg"
      >
        {/* ---- Cabecera ---- */}
        <header className="flex shrink-0 items-start justify-between gap-4 px-6 py-4">
          <div className="min-w-0">
            <h2 id="consulta-detalle-titulo" className="text-lg font-bold text-ink">
              {c ? `Consulta #${c.numeroConsulta}` : 'Consulta'}
              {c && (
                <span className="ml-2 text-sm font-normal text-muted">
                  {etiquetaTipoConsulta(c.tipo)} · {formatearFecha(c.fechaConsulta)}
                </span>
              )}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {c?.profesional ? `Atendió ${c.profesional}` : 'Solo lectura'}
            </p>
          </div>

          <button
            ref={cerrarRef}
            type="button"
            onClick={cerrar}
            aria-label="Cerrar el detalle de la consulta"
            className="shrink-0 rounded-md border border-border px-2 py-1 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"
          >
            ✕
          </button>
        </header>

        {/* ---- Cuerpo con scroll propio ---- */}
        <div className="flex-1 overflow-y-auto pb-6">
          {cargando && (
            <div className="space-y-3 px-6 py-4" aria-busy="true">
              <p className="text-sm text-muted">Cargando el detalle…</p>
              <div className="h-20 animate-pulse rounded-md bg-surface-2" />
              <div className="h-32 animate-pulse rounded-md bg-surface-2" />
              <div className="h-24 animate-pulse rounded-md bg-surface-2" />
            </div>
          )}

          {error && (
            <div className="px-6 py-4">
              <p
                role="alert"
                className="rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
              >
                {error}
              </p>
            </div>
          )}

          {detalle && (
            <>
              {antropometricos.length > 0 && (
                <Seccion titulo="Datos antropométricos">
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                    {antropometricos.map((m) => (
                      <Dato key={m.etiqueta} etiqueta={m.etiqueta}>
                        {m.valor}
                      </Dato>
                    ))}
                  </dl>
                  {(a?.metodo || a?.plieguesFormula) && (
                    <p className="mt-3 text-xs text-muted">
                      Composición corporal por{' '}
                      {a?.metodo
                        ? (ETIQUETA_METODO_COMPOSICION[a.metodo] ?? a.metodo)
                        : 'pliegues cutáneos'}
                      {a?.plieguesFormula ? ` · fórmula ${a.plieguesFormula}` : ''}
                    </p>
                  )}
                </Seccion>
              )}

              {hayDiagnosticos && (
                <Seccion titulo="Diagnósticos">
                  <dl className="space-y-3">
                    {k?.diagnosticoPrincipal && (
                      <Dato etiqueta="Diagnóstico nutricional principal">
                        <span className="font-medium">{k.diagnosticoPrincipal}</span>
                        {k.diagnosticoCie10 && (
                          <span className="ml-2 rounded-pill bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                            {k.diagnosticoCie10}
                          </span>
                        )}
                      </Dato>
                    )}
                    {k?.diagnosticoSecundario && (
                      <Dato etiqueta="Diagnóstico secundario">{k.diagnosticoSecundario}</Dato>
                    )}
                  </dl>
                </Seccion>
              )}

              {k?.objetivos && (
                <Seccion titulo="Objetivos del tratamiento">
                  <Texto>{k.objetivos}</Texto>
                </Seccion>
              )}

              {k?.observacionesClinicas && (
                <Seccion titulo="Observaciones clínicas">
                  <Texto>{k.observacionesClinicas}</Texto>
                </Seccion>
              )}

              {hayPrescripcion && k && (
                <Seccion titulo="Prescripción dietética">
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                    {k.kcalPrescritas !== null && (
                      <Dato etiqueta="Meta calórica">{k.kcalPrescritas} kcal/día</Dato>
                    )}
                    {k.pctProteina !== null && (
                      <Dato etiqueta="Proteína">
                        {k.pctProteina}%
                        {k.proteinaG !== null && (
                          <span className="ml-1 text-xs font-normal text-muted">
                            ({k.proteinaG} g)
                          </span>
                        )}
                      </Dato>
                    )}
                    {k.pctCho !== null && (
                      <Dato etiqueta="Carbohidratos">
                        {k.pctCho}%
                        {k.choG !== null && (
                          <span className="ml-1 text-xs font-normal text-muted">({k.choG} g)</span>
                        )}
                      </Dato>
                    )}
                    {k.pctGrasa !== null && (
                      <Dato etiqueta="Grasas">
                        {k.pctGrasa}%
                        {k.grasaG !== null && (
                          <span className="ml-1 text-xs font-normal text-muted">
                            ({k.grasaG} g)
                          </span>
                        )}
                      </Dato>
                    )}
                    {k.pesoObjetivo !== null && (
                      <Dato etiqueta="Meta de peso">
                        {k.pesoObjetivo} kg
                        {k.fechaObjetivoPeso && (
                          <span className="ml-1 text-xs font-normal text-muted">
                            (al {formatearFecha(k.fechaObjetivoPeso)})
                          </span>
                        )}
                      </Dato>
                    )}
                  </dl>

                  {k.restricciones.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-1.5 text-xs text-muted">Restricciones dietéticas</p>
                      <ul className="flex flex-wrap gap-1.5">
                        {k.restricciones.map((r) => (
                          <li
                            key={r}
                            className="rounded-pill bg-primary-tint px-2.5 py-0.5 text-xs font-medium text-primary"
                          >
                            {ETIQUETA_RESTRICCION[r] ?? r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {k.suplementos && (
                    <div className="mt-4">
                      <p className="mb-1 text-xs text-muted">Suplementos</p>
                      <Texto>{k.suplementos}</Texto>
                    </div>
                  )}
                </Seccion>
              )}

              {k?.justificacion && (
                <Seccion titulo="Justificación">
                  <Texto>{k.justificacion}</Texto>
                </Seccion>
              )}

              {comidasConContenido.length > 0 && plan && (
                <Seccion titulo="Plan alimentario vigente">
                  <p className="mb-2 text-sm font-medium text-ink">
                    {plan.nombre}
                    <span className="ml-2 text-xs font-normal text-muted">
                      {plan.fechaInicio ? `desde ${formatearFecha(plan.fechaInicio)}` : 'sin fecha de inicio'}
                      {plan.fechaFin ? ` hasta ${formatearFecha(plan.fechaFin)}` : ''}
                    </span>
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                          <th scope="col" className="py-1.5 pr-3 font-semibold">
                            Tiempo de comida
                          </th>
                          <th scope="col" className="py-1.5 pr-3 font-semibold">
                            Patrón
                          </th>
                          <th scope="col" className="py-1.5 font-semibold">
                            Ejemplo de menú
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {comidasConContenido.map((m) => (
                          <tr key={m.tipoComida} className="align-top">
                            <td className="py-2 pr-3 font-medium text-ink">
                              {ETIQUETA_COMIDA[m.tipoComida] ?? m.tipoComida}
                            </td>
                            <td className="whitespace-pre-wrap py-2 pr-3 text-ink">
                              {m.patron ?? <span className="text-muted">—</span>}
                            </td>
                            <td className="whitespace-pre-wrap py-2 text-ink">
                              {m.ejemploMenu ?? <span className="text-muted">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Seccion>
              )}

              {(k?.recomendaciones.length ?? 0) > 0 && k && (
                <Seccion titulo="Recomendaciones">
                  <Lista items={k.recomendaciones} />
                </Seccion>
              )}

              {(k?.acuerdos.length ?? 0) > 0 && k && (
                <Seccion titulo="Acuerdos con el paciente">
                  <ul className="space-y-2">
                    {k.acuerdos.map((ac, i) => (
                      <li
                        key={`${i}-${ac.texto}`}
                        className="flex flex-wrap items-start justify-between gap-2"
                      >
                        <span className="min-w-0 flex-1 text-sm text-ink">{ac.texto}</span>
                        {/* El estado va escrito, no solo en color. */}
                        <span
                          className="shrink-0 rounded-pill px-2 py-0.5 text-xs font-semibold"
                          style={{
                            color: ac.cumplido ? 'var(--status-normal)' : 'var(--status-alert)',
                            backgroundColor: `color-mix(in srgb, ${
                              ac.cumplido ? 'var(--status-normal)' : 'var(--status-alert)'
                            } 14%, transparent)`,
                          }}
                        >
                          {ac.cumplido ? 'Cumplido' : 'No cumplido'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Seccion>
              )}

              {/* La calculadora se enseña solo si quedó constancia del
                  método: sin él, el bloque guardado es anterior a la R42
                  y no trae ni GET ni disponibilidad energética. */}
              {calc?.metodoGer && (
                <Seccion titulo="Calculadora de requerimiento">
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                    <Dato etiqueta="Método (GER)">
                      {ETIQUETA_METODO_GER[calc.metodoGer] ?? calc.metodoGer}
                    </Dato>
                    {calc.mlgKg !== null && calc.mlgKg !== undefined && (
                      <Dato etiqueta="MLG utilizada">{calc.mlgKg} kg</Dato>
                    )}
                    {calc.geeTotal !== null && calc.geeTotal !== undefined && (
                      <Dato etiqueta="GEE (ejercicio)">{calc.geeTotal} kcal</Dato>
                    )}
                    {calc.getCunningham !== null && calc.getCunningham !== undefined && (
                      <Dato etiqueta="GET">{calc.getCunningham} kcal</Dato>
                    )}
                    <Dato etiqueta="Meta calórica">{calc.metaCalorica} kcal</Dato>
                    <Dato etiqueta="Método de dieta">{calc.metodoDieta}</Dato>
                    {/* Azúcar y sal (R44). El azúcar sale de la meta
                        calórica; la sal, del sodio que se eligió. Se
                        derivan al pintar, igual que en la calculadora. */}
                    {azucarLibreCdas(calc.metaCalorica) !== null && (
                      <Dato etiqueta="Azúcar libre">
                        {azucarLibreCdas(calc.metaCalorica)} cdas/día
                      </Dato>
                    )}
                    {calc.sodioMg != null && (
                      <>
                        <Dato etiqueta="Meta de sodio">{calc.sodioMg} mg/día</Dato>
                        {salCdtas(calc.sodioMg) !== null && (
                          <Dato etiqueta="Sal">{salCdtas(calc.sodioMg)} cdtas/día</Dato>
                        )}
                      </>
                    )}
                  </dl>

                  {lecturaDE && calc.disponibilidadEnergetica !== null && (
                    <div
                      className="mt-4 rounded-md border p-3"
                      style={{
                        borderColor: lecturaDE.color,
                        backgroundColor: `color-mix(in srgb, ${lecturaDE.color} 8%, transparent)`,
                      }}
                    >
                      <p className="text-xs font-semibold text-ink">Disponibilidad energética</p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
                        {calc.disponibilidadEnergetica}{' '}
                        <span className="text-xs font-medium text-muted">
                          kcal / kg MLG / día
                        </span>
                      </p>
                      <span
                        className="mt-1 inline-block rounded-pill px-2 py-0.5 text-xs font-semibold"
                        style={{
                          color: lecturaDE.color,
                          backgroundColor: `color-mix(in srgb, ${lecturaDE.color} 16%, transparent)`,
                        }}
                      >
                        {lecturaDE.etiqueta}
                      </span>
                      <p className="mt-1.5 text-xs text-muted">{lecturaDE.descripcion}</p>
                    </div>
                  )}

                  {calc.listasIntercambio.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-1.5 text-xs text-muted">Listas de intercambio</p>
                      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                        {calc.listasIntercambio.map((l) => (
                          <li key={l.grupo} className="flex justify-between gap-2 text-sm text-ink">
                            <span className="min-w-0 truncate">{l.grupo}</span>
                            <span className="shrink-0 font-semibold tabular-nums">
                              {l.porciones}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Seccion>
              )}

              {ausentes.length > 0 && (
                <p className="border-t border-border px-6 pt-4 text-xs text-muted">
                  Sin registrar en esta consulta: {ausentes.join(' · ')}
                </p>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
