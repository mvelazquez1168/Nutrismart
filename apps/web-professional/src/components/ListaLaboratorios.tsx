/**
 * Estudios de laboratorio de un paciente, del más reciente al más
 * antiguo, con su tabla de biomarcadores.
 *
 * Los alterados se muestran primero dentro de cada estudio: es lo que
 * el nutricionista busca al abrir la pestaña, y enterrarlos entre
 * quince valores normales convierte una tabla en un juego de "encuentra
 * la diferencia".
 */
import { useState } from 'react'
import type { EstudioLab, ResultadoLab } from '../api/tipos'
import { descargarArchivo } from '../api/laboratorios'
import { EstadoLab, RangoTexto } from './EstadoLab'
import { Tendencia } from './Tendencia'
import { PanelInterpretacionIA } from './ia/PanelInterpretacionIA'

function formatearFecha(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split('-')
  if (!anio || !mes || !dia) return iso
  return `${dia}/${mes}/${anio}`
}

/** Alterados arriba; dentro de cada bloque, el orden del catálogo. */
function ordenar(resultados: ResultadoLab[]): ResultadoLab[] {
  const peso = (r: ResultadoLab) =>
    r.estado === 'alterado' ? 0 : r.estado === 'sin_referencia' ? 2 : 1
  return [...resultados].sort((a, b) => peso(a) - peso(b))
}

export function ListaLaboratorios({
  estudios,
  onEliminar,
}: {
  estudios: EstudioLab[]
  /**
   * Borra el estudio y refresca la lista — R51.
   *
   * Opcional: sin ella no se pinta el botón. `UltimosLaboratorios`, que es la
   * tira de la ficha, no la pasa — ahí no se borra, se consulta.
   */
  onEliminar?: (estudioId: string) => Promise<void>
}) {
  const [descargando, setDescargando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * Qué estudio está preguntando si de verdad se borra — R51.
   *
   * Un diálogo propio y no un `confirm()` del navegador: el nativo no se
   * puede redactar en el tono del resto de la aplicación, bloquea la pestaña
   * entera y en algunos navegadores se puede silenciar. Y en dos pasos
   * porque esto **no se deshace**: el botón va al lado del de descargar, y un
   * clic de más no puede llevarse un informe.
   */
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [eliminando, setEliminando] = useState<string | null>(null)

  async function eliminar(id: string) {
    if (!onEliminar || eliminando) return
    setEliminando(id)
    setError(null)
    try {
      await onEliminar(id)
      setConfirmando(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar el estudio')
    } finally {
      setEliminando(null)
    }
  }

  async function descargar(id: string, nombre: string) {
    setDescargando(id)
    setError(null)
    try {
      await descargarArchivo(id, nombre)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo descargar el archivo')
    } finally {
      setDescargando(null)
    }
  }

  if (estudios.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-10 text-center shadow-sm">
        <p className="font-semibold text-ink">Aún sin laboratorios registrados</p>
        <p className="mt-1 text-sm text-muted">
          Adjunta un informe o captura los valores a mano.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
        >
          {error}
        </p>
      )}

      {estudios.map((e) => {
        const alterados = e.resultados.filter((r) => r.estado === 'alterado').length

        return (
          <section key={e.id} className="rounded-lg border border-border bg-surface shadow-sm">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-ink">{formatearFecha(e.fecha)}</h3>
                {e.laboratorio && <span className="text-sm text-muted">· {e.laboratorio}</span>}
                {alterados > 0 && (
                  <span
                    className="badge-estado"
                    style={{ '--estado-color': 'var(--status-alert)' } as React.CSSProperties}
                  >
                    {alterados} alterado{alterados === 1 ? '' : 's'}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {e.archivo && (
                  <button
                    type="button"
                    disabled={descargando === e.archivo.id}
                    onClick={() => void descargar(e.archivo!.id, e.archivo!.nombreOriginal)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
                  >
                    {descargando === e.archivo.id ? 'Descargando…' : `↓ ${e.archivo.nombreOriginal}`}
                  </button>
                )}

                {/* Discreto a propósito: gris, pequeño y sin texto. Lo normal
                    es consultar un estudio, no borrarlo. */}
                {onEliminar && confirmando !== e.id && (
                  <button
                    type="button"
                    onClick={() => setConfirmando(e.id)}
                    aria-label={`Eliminar el estudio del ${formatearFecha(e.fecha)}`}
                    title="Eliminar estudio"
                    className="rounded-md px-2 py-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-[color:var(--status-critical)]"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      className="h-4 w-4 fill-none stroke-current"
                      strokeWidth={2}
                      strokeLinecap="round"
                    >
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6M14 11v6" />
                    </svg>
                  </button>
                )}
              </div>
            </header>

            {/* La pregunta, en la propia tarjeta del estudio que se va a
                borrar: un diálogo flotante deja de decir CUÁL. */}
            {confirmando === e.id && (
              <div
                role="group"
                aria-label="Confirmar eliminación"
                className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-2 px-5 py-3"
              >
                <p className="text-sm text-ink">
                  ¿Eliminar este estudio? Esta acción no se puede deshacer.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmando(null)}
                    disabled={eliminando === e.id}
                    className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void eliminar(e.id)}
                    disabled={eliminando === e.id}
                    className="rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                    style={{ backgroundColor: 'var(--status-critical)' }}
                  >
                    {eliminando === e.id ? 'Eliminando…' : 'Eliminar'}
                  </button>
                </div>
              </div>
            )}

            {e.resultados.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">
                Sin valores capturados; solo el informe adjunto.
              </p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted">
                    <th className="px-5 py-2">Biomarcador</th>
                    <th className="px-5 py-2">Valor</th>
                    <th className="px-5 py-2">Referencia</th>
                    <th className="px-5 py-2">Estado</th>
                    <th className="px-5 py-2">vs. anterior</th>
                  </tr>
                </thead>
                <tbody>
                  {/*
                    **El detalle del estudio los enseña TODOS** — R49.

                    Es la única pantalla donde aparece un analito sin
                    catalogar, y la única donde se lee un cualitativo. El
                    resumen y la analítica los dejan fuera porque comparan
                    contra rangos; aquí no se compara nada, se transcribe lo
                    que trajo el informe.
                  */}
                  {ordenar(e.resultados).map((r, i) => (
                    <tr
                      key={r.codigo ?? `libre-${i}`}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-5 py-2 text-ink">
                        {r.nombre}
                        {r.codigo === null && (
                          <span className="ml-1.5 text-xs text-muted">· sin catalogar</span>
                        )}
                      </td>
                      <td className="px-5 py-2 font-semibold text-ink">
                        {r.valor !== null ? (
                          <>
                            {r.valor} <span className="font-normal text-muted">{r.unidad}</span>
                          </>
                        ) : (
                          // Un cualitativo se enseña con sus palabras. Ponerle
                          // un número aquí sería inventar una medición.
                          <span>{r.valor_texto ?? '—'}</span>
                        )}
                      </td>
                      <td className="px-5 py-2">
                        {/*
                          Un analito libre enseña el rango que escribieron
                          con él — R51. Se lee igual que el del catálogo, y
                          con su unidad, que en un libre también la escribe
                          el profesional.
                        */}
                        {r.rangoLibre ? (
                          <RangoTexto rango={r.rangoLibre} unidad={r.unidad} />
                        ) : r.valor === null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <RangoTexto rango={r.rango} unidad={r.unidad} />
                        )}
                      </td>
                      <td className="px-5 py-2">
                        {/*
                          Ojo a una lectura que puede chirriar: una fila libre
                          con rango escrito enseña «700 – 1600» y a la vez el
                          estado «Sin referencia». No es una incoherencia, es
                          lo que pasa: el rango lo escribió el profesional y
                          **el sistema no evalúa contra él**, porque nadie lo
                          ha validado contra un catálogo y el valor de un
                          libre se guarda como texto. Evaluarlo convertiría
                          una nota suelta en un criterio clínico; es una
                          decisión de producto, no un detalle de esta tabla.
                        */}
                        <EstadoLab estado={r.estado} />
                      </td>
                      <td className="px-5 py-2">
                        {r.codigo !== null && r.valor !== null && (
                          <Tendencia
                            metrica={{
                              codigo: r.codigo,
                              nombre: r.nombre,
                              unidad: r.unidad,
                              valor: r.valor,
                              anterior: r.anterior,
                              delta: r.delta,
                              tendencia: r.tendencia,
                            }}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {e.notas && (
              <p className="border-t border-border px-5 py-3 text-sm text-ink">{e.notas}</p>
            )}

            {/* Al pie del estudio, no en un panel lateral: la
                interpretacion se lee DESPUES de la tabla de valores,
                que es lo que la sustenta. */}
            <div className="border-t border-border p-5">
              <PanelInterpretacionIA estudioId={e.id} />
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** Tarjeta del Resumen: solo el último estudio, con los alterados primero. */
export function UltimosLaboratorios({ estudios }: { estudios: EstudioLab[] }) {
  const ultimo = estudios[0]

  if (!ultimo) {
    return (
      <section className="rounded-lg border border-dashed border-border bg-surface p-5">
        <h2 className="mb-1 font-semibold text-muted">Laboratorios</h2>
        <p className="text-sm text-muted">Aún sin registros.</p>
      </section>
    )
  }

  const destacados = ordenar(ultimo.resultados).slice(0, 5)

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="mb-1 font-semibold text-ink">Últimos laboratorios</h2>
      <p className="mb-3 text-xs text-muted">{formatearFecha(ultimo.fecha)}</p>
      <ul className="space-y-2">
        {destacados.map((r, i) => (
          <li key={r.codigo ?? `libre-${i}`} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm text-ink">{r.nombre}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-sm font-semibold text-ink">
                {/* Un cualitativo se lee con sus palabras — R49. */}
                {r.valor !== null ? (
                  <>
                    {r.valor} <span className="font-normal text-muted">{r.unidad}</span>
                  </>
                ) : (
                  (r.valor_texto ?? '—')
                )}
              </span>
              <EstadoLab estado={r.estado} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
