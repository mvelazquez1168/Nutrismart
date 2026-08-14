/**
 * Notas SOAP del paciente — IA-02.
 *
 * Lista y tarjeta expandible en el mismo archivo: la tarjeta no se usa
 * en ningún otro sitio y separarlas obligaría a exportar tipos y estado
 * que solo se comparten aquí.
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import {
  editarSOAP,
  getNotaSOAP,
  getNotasSOAP,
  revisarSOAP,
  type NotaSOAP,
  type NotaSOAPResumen,
} from '../../api/ia'
import { GeneradorSOAP } from './GeneradorSOAP'

const SECCIONES = [
  { clave: 'subjetivo', letra: 'S', titulo: 'Subjetivo' },
  { clave: 'objetivo', letra: 'O', titulo: 'Objetivo' },
  { clave: 'analisis', letra: 'A', titulo: 'Análisis' },
  { clave: 'planSoap', letra: 'P', titulo: 'Plan' },
] as const

function Chip({ texto, token }: { texto: string; token: 'alert' | 'normal' }) {
  return (
    <span
      className="rounded-pill px-2 py-0.5 text-xs font-semibold"
      style={{
        color: `var(--status-${token})`,
        backgroundColor: `color-mix(in srgb, var(--status-${token}) 15%, transparent)`,
      }}
    >
      {texto}
    </span>
  )
}

function fecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function TarjetaSOAP({
  pacienteId,
  resumen,
  onCambio,
}: {
  pacienteId: string
  resumen: NotaSOAPResumen
  onCambio: () => void | Promise<void>
}) {
  const [abierta, setAbierta] = useState(false)
  const [nota, setNota] = useState<NotaSOAP | null>(null)
  const [editando, setEditando] = useState(false)
  const [borrador, setBorrador] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // El detalle se pide solo al desplegar: una lista de veinte notas no
  // necesita traer veinte cuerpos completos que nadie va a leer.
  useEffect(() => {
    if (!abierta || nota) return
    const ctrl = new AbortController()
    getNotaSOAP(pacienteId, resumen.id, ctrl.signal)
      .then((n) => {
        if (!ctrl.signal.aborted) setNota(n)
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setError('No se pudo cargar la nota')
      })
    return () => ctrl.abort()
  }, [abierta, nota, pacienteId, resumen.id])

  async function guardar() {
    if (!nota) return
    setOcupado(true)
    setError(null)
    try {
      const actualizada = await editarSOAP(pacienteId, nota.id, borrador)
      setNota({ ...nota, ...actualizada })
      setEditando(false)
      await onCambio()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar')
    } finally {
      setOcupado(false)
    }
  }

  async function revisar() {
    if (!nota) return
    setOcupado(true)
    try {
      await revisarSOAP(pacienteId, nota.id)
      setNota({ ...nota, revisada: true })
      await onCambio()
    } catch {
      setError('No se pudo marcar como revisada')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <li className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className="flex w-full items-start justify-between gap-3 p-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink">Nota SOAP</span>
            {resumen.generadaIa && <Chip texto="IA" token="alert" />}
            {resumen.revisada && <Chip texto="Revisada" token="normal" />}
            <span className="text-xs text-muted">
              {fecha(resumen.createdAt)}
              {resumen.profesional && ` · ${resumen.profesional}`}
            </span>
          </div>
          {!abierta && <p className="mt-1 truncate text-sm text-muted">{resumen.extracto}</p>}
        </div>
        <span aria-hidden="true" className="shrink-0 text-muted">
          {abierta ? '▲' : '▼'}
        </span>
      </button>

      {abierta && (
        <div className="space-y-3 border-t border-border p-4">
          {!nota && !error && <div className="h-24 animate-pulse rounded-md bg-surface-2" />}

          {error && (
            <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
              {error}
            </p>
          )}

          {nota &&
            SECCIONES.map((s) => (
              <div key={s.clave}>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-primary">
                  {s.letra} · {s.titulo}
                </p>
                {editando ? (
                  <textarea
                    rows={3}
                    aria-label={s.titulo}
                    value={borrador[s.clave] ?? nota[s.clave] ?? ''}
                    onChange={(e) => setBorrador({ ...borrador, [s.clave]: e.target.value })}
                    className="w-full resize-y rounded-md border border-border bg-surface p-2 text-sm text-ink outline-none focus:border-primary"
                  />
                ) : (
                  <p className="whitespace-pre-wrap text-sm text-ink">
                    {nota[s.clave] ?? <span className="text-muted">Sin contenido</span>}
                  </p>
                )}
              </div>
            ))}

          {nota && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
              {editando ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setEditando(false)
                      setBorrador({})
                    }}
                    className="rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:bg-surface-2"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void guardar()}
                    disabled={ocupado}
                    className="rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                  >
                    Guardar cambios
                  </button>
                </>
              ) : (
                <>
                  {/* Editar solo quien la escribió: la nota lleva su
                      firma. Cualquiera del equipo puede leerla y
                      marcarla revisada. */}
                  {nota.esAutor ? (
                    <button
                      type="button"
                      onClick={() => setEditando(true)}
                      className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2"
                    >
                      Editar
                    </button>
                  ) : (
                    <span className="self-center text-xs text-muted">
                      La escribió {nota.profesional ?? 'otro profesional'}; solo esa persona puede
                      editarla.
                    </span>
                  )}
                  {!nota.revisada && (
                    <button
                      type="button"
                      onClick={() => void revisar()}
                      disabled={ocupado}
                      className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
                    >
                      Marcar como revisada
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export function ListaSOAP({ pacienteId }: { pacienteId: string }) {
  const [notas, setNotas] = useState<NotaSOAPResumen[]>([])
  const [cargando, setCargando] = useState(true)
  const [creando, setCreando] = useState(false)

  const cargar = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const lista = await getNotasSOAP(pacienteId, signal)
        if (!signal?.aborted) setNotas(lista)
      } catch {
        /* la lista vacía ya comunica el estado */
      } finally {
        if (!signal?.aborted) setCargando(false)
      }
    },
    [pacienteId],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    void cargar(ctrl.signal)
    return () => ctrl.abort()
  }, [cargar])

  if (cargando) return <div className="h-40 animate-pulse rounded-lg bg-surface-2" />

  return (
    <div className="space-y-4">
      {creando ? (
        <GeneradorSOAP
          pacienteId={pacienteId}
          onCancelar={() => setCreando(false)}
          onGuardada={() => {
            setCreando(false)
            void cargar()
          }}
        />
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setCreando(true)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            + Nueva nota SOAP
          </button>
        </div>
      )}

      {notas.length === 0 && !creando ? (
        <section className="rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm font-medium text-ink">Sin notas SOAP</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            La nota SOAP resume la consulta en cuatro apartados. Puedes escribirla a mano o partir
            de un borrador generado con los datos del expediente.
          </p>
        </section>
      ) : (
        <ul className="space-y-2">
          {notas.map((n) => (
            <TarjetaSOAP
              key={n.id}
              pacienteId={pacienteId}
              resumen={n}
              onCambio={() => cargar()}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
