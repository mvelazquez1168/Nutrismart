/**
 * Aviso de consulta de seguimiento — EVAL-08.
 *
 * Dice de dónde viene lo que ya está escrito en los formularios. Sin
 * esto, el profesional encuentra campos rellenos y no sabe si los puso
 * él en esta visita o vienen de la anterior — que es exactamente la
 * duda que hace desconfiar de un expediente.
 */
import type { FotoConsulta } from '../../api/seguimiento'

export function BannerSeguimiento({
  anterior,
  onVerBase,
}: {
  anterior: FotoConsulta
  onVerBase?: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary bg-primary-tint p-4">
      <p className="text-sm text-ink">
        <span className="font-semibold text-primary">Consulta de seguimiento. </span>
        Los datos que no cambian visita a visita —historial, hábitos, prescripción— vienen
        precargados de la valoración del{' '}
        <strong>{anterior.consulta.fechaConsulta}</strong> (consulta #
        {anterior.consulta.numeroConsulta}). Actualiza solo lo que sea distinto.
      </p>

      {onVerBase && (
        <button
          type="button"
          onClick={onVerBase}
          className="shrink-0 text-sm font-medium text-primary hover:underline"
        >
          Ver la valoración anterior →
        </button>
      )}
    </div>
  )
}

/**
 * Aviso corto, para la cabecera de un formulario concreto.
 *
 * Las medidas son la excepción: no se precargan. Un peso que aparece ya
 * escrito y se guarda sin tocar registra como medición de hoy algo que
 * se midió hace tres meses.
 */
export function AvisoPrecarga({
  fecha,
  medidas = false,
}: {
  fecha: string
  /** true cuando la sección contiene valores que se miden cada visita. */
  medidas?: boolean
}) {
  return (
    <p className="rounded-md border border-border bg-surface-2 p-3 text-sm text-muted">
      {medidas ? (
        <>
          A la izquierda, lo medido el <strong className="text-ink">{fecha}</strong>. Los campos de
          hoy empiezan vacíos a propósito: un peso precargado que se guarda sin tocar quedaría
          registrado como medición de hoy.
        </>
      ) : (
        <>
          Precargado de la consulta del <strong className="text-ink">{fecha}</strong>. Edita solo lo
          que haya cambiado.
        </>
      )}
    </p>
  )
}
