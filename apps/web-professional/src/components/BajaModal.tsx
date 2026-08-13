/**
 * Confirmación de baja del paciente.
 *
 * El texto insiste en que es ARCHIVAR, no borrar. `CLAUDE.md` prohíbe
 * el borrado físico, y si el diálogo no lo dice con claridad el
 * profesional dudará antes de usarlo — o peor, creerá que destruyó un
 * expediente clínico.
 */
import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Campo, claseControl } from './Campo'
import { darDeBajaPaciente } from '../api/pacientes'

interface Props {
  abierto: boolean
  pacienteId: string
  nombrePaciente: string
  onCerrar: () => void
  onConfirmado: () => void
}

export function BajaModal({
  abierto,
  pacienteId,
  nombrePaciente,
  onCerrar,
  onConfirmado,
}: Props) {
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!abierto) return
    setMotivo('')
    setError(null)
  }, [abierto])

  async function confirmar() {
    if (enviando) return
    setEnviando(true)
    setError(null)

    try {
      await darDeBajaPaciente(pacienteId, motivo.trim() === '' ? null : motivo.trim())
      onConfirmado()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo dar de baja')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      bloqueado={enviando}
      ancho="md"
      titulo="Dar de baja al paciente"
      pie={
        <>
          <button
            type="button"
            onClick={onCerrar}
            disabled={enviando}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={enviando}
            className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ backgroundColor: 'var(--status-critical)' }}
          >
            {enviando ? 'Archivando…' : 'Dar de baja'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink">
          <strong className="font-semibold">{nombrePaciente}</strong> dejará de aparecer en la
          lista de pacientes.
        </p>

        <div className="rounded-md border border-border bg-surface-2 p-3 text-sm text-muted">
          El expediente <strong className="font-semibold text-ink">no se borra</strong>. Toda la
          información clínica se conserva por trazabilidad y el paciente puede reactivarse más
          adelante.
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-[color:var(--status-critical)] bg-surface-2 p-3 text-sm text-ink"
          >
            {error}
          </p>
        )}

        <Campo id="motivo-baja" etiqueta="Motivo" ayuda="Opcional, pero ayuda a entender el archivo después">
          <input
            id="motivo-baja"
            value={motivo}
            disabled={enviando}
            onChange={(e) => setMotivo(e.target.value)}
            className={claseControl(false)}
            placeholder="No continúa tratamiento"
          />
        </Campo>
      </div>
    </Modal>
  )
}
