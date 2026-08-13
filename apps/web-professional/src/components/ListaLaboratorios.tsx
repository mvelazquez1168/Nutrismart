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

export function ListaLaboratorios({ estudios }: { estudios: EstudioLab[] }) {
  const [descargando, setDescargando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
            </header>

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
                  {ordenar(e.resultados).map((r) => (
                    <tr key={r.codigo} className="border-b border-border last:border-0">
                      <td className="px-5 py-2 text-ink">{r.nombre}</td>
                      <td className="px-5 py-2 font-semibold text-ink">
                        {r.valor} <span className="font-normal text-muted">{r.unidad}</span>
                      </td>
                      <td className="px-5 py-2">
                        <RangoTexto rango={r.rango} unidad={r.unidad} />
                      </td>
                      <td className="px-5 py-2">
                        <EstadoLab estado={r.estado} />
                      </td>
                      <td className="px-5 py-2">
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {e.notas && (
              <p className="border-t border-border px-5 py-3 text-sm text-ink">{e.notas}</p>
            )}
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
        {destacados.map((r) => (
          <li key={r.codigo} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm text-ink">{r.nombre}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-sm font-semibold text-ink">
                {r.valor} <span className="font-normal text-muted">{r.unidad}</span>
              </span>
              <EstadoLab estado={r.estado} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
