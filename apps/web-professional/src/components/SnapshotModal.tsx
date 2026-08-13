/**
 * Modal de punto de control (alta y edición de borrador).
 *
 * Dos acciones de guardado, y la diferencia importa:
 *  · "Guardar borrador" deja el control abierto y editable.
 *  · "Guardar y cerrar" lo vuelve INMUTABLE. A partir de ahí solo se
 *    puede corregir creando una versión nueva.
 * El botón de cerrar lo advierte, porque no es una acción reversible.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { Modal } from './Modal'
import { Campo, claseControl } from './Campo'
import { ApiError } from '../api/client'
import {
  crearSnapshot,
  actualizarSnapshot,
  cerrarSnapshot,
} from '../api/expediente'
import type { MetricaCatalogo, SnapshotResumen } from '../api/tipos'

interface Props {
  abierto: boolean
  pacienteId: string
  catalogo: MetricaCatalogo[]
  /** null = nuevo control; con snapshot = edición de un borrador. */
  snapshot: SnapshotResumen | null
  onCerrar: () => void
  onGuardado: () => void
}

function hoyISO(): string {
  const d = new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

export function SnapshotModal({
  abierto,
  pacienteId,
  catalogo,
  snapshot,
  onCerrar,
  onGuardado,
}: Props) {
  const esEdicion = snapshot !== null

  const [fecha, setFecha] = useState(hoyISO())
  const [valores, setValores] = useState<Record<string, string>>({})
  const [nota, setNota] = useState('')
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  /**
   * Cerrar vuelve el control inmutable, así que pide confirmación. Se
   * hace EN LÍNEA y no con un segundo modal: apilar diálogos confunde
   * sobre qué cierra qué, y el Escape dejaría de tener un destino claro.
   */
  const [confirmandoCierre, setConfirmandoCierre] = useState(false)

  useEffect(() => {
    if (!abierto) return

    if (snapshot) {
      setFecha(snapshot.fecha)
      const v: Record<string, string> = {}
      for (const m of snapshot.metricas) {
        // El IMC es derivado: no se captura, se muestra.
        if (m.codigo === 'imc') continue
        v[m.codigo] = String(m.valor)
      }
      setValores(v)
      setNota(snapshot.nota ?? '')
    } else {
      setFecha(hoyISO())
      setValores({})
      setNota('')
    }
    setErrores({})
    setErrorGeneral(null)
    setConfirmandoCierre(false)
  }, [abierto, snapshot])

  function setValor(codigo: string, valor: string) {
    setValores((prev) => ({ ...prev, [codigo]: valor }))
    setErrores((prev) => {
      const clave = `metricas.${codigo}`
      if (!(clave in prev)) return prev
      const copia = { ...prev }
      delete copia[clave]
      return copia
    })
  }

  function construirEnvio() {
    const metricas: Record<string, number> = {}
    for (const [codigo, bruto] of Object.entries(valores)) {
      const limpio = bruto.trim()
      // Vacío significa "no se midió", que no es lo mismo que medir 0.
      if (limpio === '') continue
      const n = Number(limpio)
      if (Number.isFinite(n)) metricas[codigo] = n
    }
    return { fecha, metricas, nota: nota.trim() === '' ? null : nota.trim() }
  }

  async function enviar(e: FormEvent, cerrarTambien: boolean) {
    e.preventDefault()
    if (guardando) return

    setGuardando(true)
    setErrores({})
    setErrorGeneral(null)

    try {
      const datos = construirEnvio()
      const guardado = esEdicion
        ? await actualizarSnapshot(snapshot.id, datos)
        : await crearSnapshot(pacienteId, datos)

      if (cerrarTambien) await cerrarSnapshot(guardado.id)
      onGuardado()
    } catch (error) {
      if (error instanceof ApiError && error.esValidacion) {
        const mapa: Record<string, string> = {}
        for (const e of error.errores ?? []) mapa[e.campo] = e.mensaje
        setErrores(mapa)
      } else {
        setErrorGeneral(error instanceof Error ? error.message : 'No se pudo guardar')
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      bloqueado={guardando}
      titulo={esEdicion ? 'Editar punto de control' : 'Nuevo punto de control'}
      descripcion={
        esEdicion
          ? 'Sigue en borrador: puedes cambiarlo hasta que lo cierres.'
          : 'Deja constancia de esta consulta. Los campos que no midas se quedan vacíos.'
      }
      pie={
        confirmandoCierre ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <p className="max-w-sm text-sm text-ink">
              Al cerrar, este control queda{' '}
              <strong className="font-semibold">inmutable</strong>: para cambiar algo tendrás que
              crear una versión corregida.
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setConfirmandoCierre(false)}
                disabled={guardando}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={(e) => void enviar(e, true)}
                disabled={guardando}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
              >
                {guardando ? 'Cerrando…' : 'Sí, cerrar el control'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onCerrar}
              disabled={guardando}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={(e) => void enviar(e, false)}
              disabled={guardando}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
            >
              {guardando ? 'Guardando…' : 'Guardar borrador'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmandoCierre(true)}
              disabled={guardando}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
            >
              Guardar y cerrar
            </button>
          </>
        )
      }
    >
      <form onSubmit={(e) => void enviar(e, false)} className="space-y-5" noValidate>
        {errorGeneral && (
          <p
            role="alert"
            className="rounded-md border border-[color:var(--status-critical)] bg-surface-2 p-3 text-sm text-ink"
          >
            {errorGeneral}
          </p>
        )}

        <fieldset disabled={guardando}>
          <Campo
            id="fecha-control"
            etiqueta="Fecha del control"
            requerido
            error={errores['fecha']}
            ayuda="La fecha de la consulta, que puede no ser la de hoy"
          >
            <input
              id="fecha-control"
              type="date"
              value={fecha}
              max={hoyISO()}
              onChange={(e) => setFecha(e.target.value)}
              className={claseControl(Boolean(errores['fecha']))}
            />
          </Campo>
        </fieldset>

        <fieldset disabled={guardando}>
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
            Mediciones
          </legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {catalogo.map((m) => {
              const claveError = `metricas.${m.codigo}`
              return (
                <Campo
                  key={m.codigo}
                  id={`m-${m.codigo}`}
                  etiqueta={`${m.nombre} (${m.unidad})`}
                  error={errores[claveError]}
                >
                  <input
                    id={`m-${m.codigo}`}
                    type="number"
                    inputMode="decimal"
                    step={m.decimales > 0 ? '0.1' : '1'}
                    value={valores[m.codigo] ?? ''}
                    onChange={(e) => setValor(m.codigo, e.target.value)}
                    placeholder="—"
                    className={claseControl(Boolean(errores[claveError]))}
                  />
                </Campo>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-muted">
            El IMC se calcula solo a partir del peso y la talla de este mismo control.
          </p>
        </fieldset>

        <fieldset disabled={guardando}>
          <Campo id="nota-control" etiqueta="Nota de la consulta" error={errores['nota']}>
            <textarea
              id="nota-control"
              rows={4}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              className={claseControl(Boolean(errores['nota']))}
              placeholder="Evolución, adherencia, acuerdos con el paciente…"
            />
          </Campo>
        </fieldset>
      </form>
    </Modal>
  )
}
