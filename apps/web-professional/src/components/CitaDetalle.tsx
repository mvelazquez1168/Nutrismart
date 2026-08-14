/**
 * Detalle de una cita: cambio de estado, edición y registro del control.
 *
 * Las transiciones permitidas son solo desde `programada`. Cancelar
 * pide confirmación porque libera la franja y no se deshace: una cita
 * cancelada no vuelve a `programada`, hay que agendar otra.
 */
import { useState } from 'react'
import { Modal } from './Modal'
import type { Cita } from '../api/tipos'
import { fechaLarga, rangoHoras } from '../lib/fechas'

const ETIQUETA_TIPO: Record<string, string> = {
  primera_vez: 'Primera vez',
  seguimiento: 'Seguimiento',
  control: 'Control',
}

interface Props {
  abierto: boolean
  cita: Cita | null
  ocupado: boolean
  error: string | null
  onCerrar: () => void
  onEditar: (c: Cita) => void
  onCompletar: (c: Cita) => void
  onCancelar: (c: Cita) => void
  /** Abre la valoración del paciente a partir de esta cita. */
  onIniciarConsulta?: (c: Cita) => void
  onRegistrarControl: (c: Cita) => void
  onVerControl: (c: Cita) => void
}

export function CitaDetalle({
  abierto,
  cita,
  ocupado,
  error,
  onCerrar,
  onEditar,
  onCompletar,
  onIniciarConsulta,
  onCancelar,
  onRegistrarControl,
  onVerControl,
}: Props) {
  const [confirmandoCancelar, setConfirmandoCancelar] = useState(false)

  if (!cita) return null

  // Una cita confirmada se edita igual que una programada: el paciente
  // avisó de que viene, no de que la hora sea inamovible.
  const abierta = cita.estado === 'programada' || cita.estado === 'confirmada'
  const programada = abierta
  const completada = cita.estado === 'completada'

  // Se abre la valoración desde la cita cuando ya toca: confirmada, o
  // programada y con la hora encima. Ofrecerlo para una cita de dentro
  // de tres semanas invita a abrir consultas que nadie va a atender.
  const puedeIniciarConsulta = abierta && new Date(cita.inicio) <= new Date(Date.now() + 3600_000)

  return (
    <Modal
      abierto={abierto}
      onCerrar={() => {
        setConfirmandoCancelar(false)
        onCerrar()
      }}
      bloqueado={ocupado}
      ancho="md"
      titulo={cita.paciente.nombre}
      descripcion={`${fechaLarga(cita.inicio)} · ${rangoHoras(cita.inicio, cita.fin)}`}
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Tipo</dt>
            <dd className="text-sm text-ink">{ETIQUETA_TIPO[cita.tipo] ?? cita.tipo}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Duración</dt>
            <dd className="text-sm text-ink">{cita.duracionMinutos} min</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Estado</dt>
            <dd className="text-sm capitalize text-ink">{cita.estado}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Profesional</dt>
            <dd className="text-sm text-ink">{cita.profesional ?? '—'}</dd>
          </div>
        </dl>

        {cita.notas && (
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Notas</p>
            <p className="mt-1 text-sm text-ink">{cita.notas}</p>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-md border border-[color:var(--status-critical)] bg-surface-2 p-3 text-sm text-ink"
          >
            {error}
          </p>
        )}

        {!programada && (
          <p className="text-xs text-muted">
            Una cita {cita.estado} ya no se edita: registra lo que{' '}
            {completada ? 'ocurrió' : 'no ocurrió'}. Si hace falta otra consulta, agenda una nueva.
          </p>
        )}

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {puedeIniciarConsulta && onIniciarConsulta && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => onIniciarConsulta(cita)}
              className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
            >
              Iniciar consulta
            </button>
          )}

          {programada && (
            <>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => onEditar(cita)}
                className="rounded-md border border-border px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
              >
                Editar
              </button>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => onCompletar(cita)}
                className="rounded-md border border-border px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
              >
                Marcar completada
              </button>

              {confirmandoCancelar ? (
                <span className="flex items-center gap-2">
                  <span className="text-xs text-ink">¿Cancelar la cita?</span>
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => setConfirmandoCancelar(false)}
                    className="rounded-md border border-border px-3 py-2 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
                  >
                    No
                  </button>
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => {
                      setConfirmandoCancelar(false)
                      onCancelar(cita)
                    }}
                    className="rounded-md px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
                    style={{ backgroundColor: 'var(--status-critical)' }}
                  >
                    Sí, cancelar
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => setConfirmandoCancelar(true)}
                  className="rounded-md border border-border px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-60"
                >
                  Cancelar cita
                </button>
              )}
            </>
          )}

          {completada &&
            (cita.snapshotId ? (
              <button
                type="button"
                disabled={ocupado}
                onClick={() => onVerControl(cita)}
                className="rounded-md border border-border px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
              >
                Ver control clínico
              </button>
            ) : (
              <button
                type="button"
                disabled={ocupado}
                onClick={() => onRegistrarControl(cita)}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
              >
                Registrar control
              </button>
            ))}
        </div>
      </div>
    </Modal>
  )
}
