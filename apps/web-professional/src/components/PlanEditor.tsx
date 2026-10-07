/**
 * Plan alimentario en modo EDICIÓN (CLI-09 / R38).
 *
 * Seis filas fijas —los tiempos del día— con dos campos cada una: patrón
 * y ejemplo de menú. Se envía el patrón ENTERO y el servidor reemplaza lo
 * que había: es la única semántica honesta cuando el profesional puede
 * vaciar una franja.
 *
 * Las filas sin patrón ni ejemplo no viajan: una franja en blanco es «no
 * hay comida prescrita», no una comida vacía.
 */
import { useState } from 'react'
import { ApiError } from '../api/client'
import { TIPOS_COMIDA, guardarComidas, type ComidaPlan, type TipoComida } from '../api/planes'

interface Fila {
  patron: string
  ejemploMenu: string
}

const VACIA: Fila = { patron: '', ejemploMenu: '' }

function estadoInicial(comidas: ComidaPlan[]): Record<string, Fila> {
  const estado: Record<string, Fila> = {}
  for (const t of TIPOS_COMIDA) estado[t.clave] = { ...VACIA }
  for (const c of comidas) {
    estado[c.tipoComida] = { patron: c.patron ?? '', ejemploMenu: c.ejemploMenu ?? '' }
  }
  return estado
}

export function PlanEditor({
  planId,
  comidas,
  onGuardado,
  onCancelar,
}: {
  planId: string
  comidas: ComidaPlan[]
  onGuardado: () => void | Promise<void>
  onCancelar: () => void
}) {
  const [filas, setFilas] = useState<Record<string, Fila>>(() => estadoInicial(comidas))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function actualizar(clave: string, campo: keyof Fila, valor: string) {
    setFilas((prev) => ({ ...prev, [clave]: { ...(prev[clave] ?? VACIA), [campo]: valor } }))
  }

  const llenas = TIPOS_COMIDA.filter((t) => {
    const f = filas[t.clave] ?? VACIA
    return f.patron.trim() !== '' || f.ejemploMenu.trim() !== ''
  }).length

  async function guardar() {
    setGuardando(true)
    setError(null)
    try {
      const envio = []
      for (const t of TIPOS_COMIDA) {
        const f = filas[t.clave] ?? VACIA
        const patron = f.patron.trim()
        const ejemploMenu = f.ejemploMenu.trim()
        if (patron === '' && ejemploMenu === '') continue
        envio.push({
          tipoComida: t.clave as TipoComida,
          patron: patron === '' ? null : patron,
          ejemploMenu: ejemploMenu === '' ? null : ejemploMenu,
        })
      }
      await guardarComidas(planId, envio)
      await onGuardado()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudieron guardar las comidas')
    } finally {
      setGuardando(false)
    }
  }

  /**
   * La barra de acciones, arriba y abajo de la tabla.
   *
   * Es un ELEMENTO, no un componente declarado en el render: declararlo
   * como función aquí dentro le daba un tipo nuevo en cada render y React
   * remontaba los dos botones en cada pulsación de tecla de la tabla. Es
   * el mismo fallo que se corrigió en el Clínico, donde sí costaba el
   * foco del campo que se estaba escribiendo.
   */
  const acciones = (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-muted">
        {llenas === 0
          ? 'Sin comidas: guardar dejará el plan vacío.'
          : `${llenas} ${llenas === 1 ? 'tiempo de comida' : 'tiempos de comida'} con contenido.`}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancelar}
          disabled={guardando}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
        >
          {error}
        </p>
      )}

      {acciones}

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th
                scope="col"
                className="w-40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted"
              >
                Tiempo de comida
              </th>
              <th
                scope="col"
                className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted"
              >
                Patrón
              </th>
              <th
                scope="col"
                className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted"
              >
                Ejemplo de menú
              </th>
            </tr>
          </thead>
          <tbody>
            {TIPOS_COMIDA.map((tipo) => {
              const f = filas[tipo.clave] ?? VACIA
              return (
                <tr key={tipo.clave} className="border-t border-border align-top">
                  <th
                    scope="row"
                    className="w-40 whitespace-nowrap bg-surface-2 px-3 py-2 text-left text-xs font-medium text-ink"
                  >
                    {tipo.etiqueta}
                  </th>
                  <td className="px-2 py-2">
                    <textarea
                      rows={2}
                      value={f.patron}
                      maxLength={1000}
                      onChange={(e) => actualizar(tipo.clave, 'patron', e.target.value)}
                      placeholder="Un lácteo, una fruta, 1 cereal"
                      aria-label={`Patrón de ${tipo.etiqueta}`}
                      className="min-h-[3rem] w-full resize-y rounded-md border border-border bg-surface p-1.5 text-xs text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <textarea
                      rows={2}
                      value={f.ejemploMenu}
                      maxLength={1000}
                      onChange={(e) => actualizar(tipo.clave, 'ejemploMenu', e.target.value)}
                      placeholder="Una taza de yogurt + 1/4 de granola + 1 banano mediano"
                      aria-label={`Ejemplo de menú de ${tipo.etiqueta}`}
                      className="min-h-[3rem] w-full resize-y rounded-md border border-border bg-surface p-1.5 text-xs text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Repetidas abajo: la tabla es alta y obligar a subir para guardar
          es una fricción gratuita. */}
      {acciones}
    </div>
  )
}
