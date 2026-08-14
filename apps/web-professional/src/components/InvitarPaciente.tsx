/**
 * Invitación del paciente a la app — PAC-01, lado del profesional.
 *
 * El enlace se muestra SIEMPRE, no solo cuando falla el correo. Aunque
 * el envío haya salido bien, un correo puede acabar en la carpeta de no
 * deseado, y entonces el profesional lo dicta por teléfono o lo pasa por
 * mensaje. Ocultar el enlace convierte un contratiempo en un callejón.
 */
import { useState } from 'react'
import { ApiError, apiPost } from '../api/client'

interface Respuesta {
  mensaje: string
  emailEnviado: boolean
  enlace: string
  expiraEn: string
}

export function InvitarPaciente({
  pacienteId,
  tieneCuenta,
  correo,
}: {
  pacienteId: string
  tieneCuenta: boolean
  correo: string | null
}) {
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<Respuesta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  if (tieneCuenta) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-pill"
          style={{ backgroundColor: 'var(--status-normal)' }}
        />
        Este paciente ya usa la app de NutriSmart
      </p>
    )
  }

  async function invitar() {
    setEnviando(true)
    setError(null)
    setCopiado(false)
    try {
      setResultado(await apiPost<Respuesta>(`/api/pacientes/${pacienteId}/invitar`, {}))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo crear la invitación')
    } finally {
      setEnviando(false)
    }
  }

  async function copiar() {
    if (!resultado) return
    try {
      await navigator.clipboard.writeText(resultado.enlace)
      setCopiado(true)
    } catch {
      setError('El navegador no dejó copiar. Selecciona el enlace a mano.')
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void invitar()}
        disabled={enviando || correo === null}
        title={correo === null ? 'Añade primero un correo al paciente' : undefined}
        className="inline-flex items-center gap-2 rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary-tint disabled:cursor-not-allowed disabled:opacity-50"
      >
        {enviando && (
          <span className="h-4 w-4 animate-spin rounded-pill border-2 border-primary border-t-transparent" />
        )}
        {resultado ? 'Reenviar invitación' : 'Invitar a la app'}
      </button>

      {correo === null && (
        <p className="text-xs text-muted">
          Necesita un correo registrado. Añádelo desde <strong>Editar</strong>.
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      )}

      {resultado && (
        <div className="space-y-2 rounded-md border border-border bg-surface-2 p-3">
          <p className="text-sm text-ink">{resultado.mensaje}</p>

          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs text-muted">
              {resultado.enlace}
            </code>
            <button
              type="button"
              onClick={() => void copiar()}
              className="shrink-0 rounded-md border border-border px-3 py-1 text-xs font-medium text-ink hover:bg-surface"
            >
              {copiado ? 'Copiado' : 'Copiar'}
            </button>
          </div>

          <p className="text-xs text-muted">
            Caduca el {new Date(resultado.expiraEn).toLocaleDateString('es-CR')}. Al reenviar, el
            enlace anterior deja de servir.
          </p>
        </div>
      )}
    </div>
  )
}
