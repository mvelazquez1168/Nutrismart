/**
 * Fila de la lista de conversaciones — COM-01.
 *
 * Con mensajes sin leer, el nombre va en negrita Y hay contador: el
 * número dice cuántos y la negrita se ve sin leerlo. Dos señales para
 * el mismo hecho, porque es el que decide qué hilo abrir primero.
 */
import { Avatar } from '../Avatar'
import { horaOFecha } from '../../lib/fechas'
import type { Conversacion } from '../../api/mensajeria'

export function ConversacionItem({
  conversacion,
  activa,
  onClick,
}: {
  conversacion: Conversacion
  activa: boolean
  onClick: () => void
}) {
  const sinLeer = conversacion.noLeidos > 0

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={activa ? 'true' : undefined}
        className={`flex w-full items-start gap-3 border-l-4 px-3 py-3 text-left transition-colors ${
          activa
            ? 'border-primary bg-primary-tint'
            : 'border-transparent hover:bg-surface-2'
        }`}
      >
        <Avatar nombre={conversacion.paciente.nombre} />

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={`truncate text-sm text-ink ${sinLeer ? 'font-bold' : 'font-medium'}`}
            >
              {conversacion.paciente.nombre}
            </span>
            {conversacion.ultimoMensajeAt && (
              <span className="shrink-0 text-xs text-muted">
                {horaOFecha(conversacion.ultimoMensajeAt)}
              </span>
            )}
          </span>

          <span className="mt-0.5 flex items-center justify-between gap-2">
            <span className="truncate text-xs text-muted">
              {conversacion.ultimoContenido ? (
                <>
                  {conversacion.ultimoAutor === 'profesional' && (
                    <span className="text-muted">Tú: </span>
                  )}
                  {conversacion.ultimoContenido}
                </>
              ) : (
                <span className="italic">Sin mensajes todavía</span>
              )}
            </span>

            {sinLeer && (
              <span className="flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-pill bg-primary px-1.5 text-xs font-semibold text-white">
                {conversacion.noLeidos}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  )
}
