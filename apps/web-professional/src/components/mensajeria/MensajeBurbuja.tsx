/**
 * Una burbuja del hilo — COM-01.
 *
 * El profesional a la derecha sobre el color de marca; el paciente a la
 * izquierda sobre superficie. El lado es lo que distingue al autor de un
 * vistazo, así que el color solo lo refuerza: en escala de grises el
 * hilo se sigue leyendo igual.
 */
import { hora } from '../../lib/fechas'
import type { Mensaje } from '../../api/mensajeria'

export function MensajeBurbuja({ mensaje }: { mensaje: Mensaje }) {
  const propio = mensaje.autorTipo === 'profesional'

  return (
    <li className={`flex ${propio ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[75%]">
        <div
          className={
            propio
              ? 'rounded-lg rounded-br-sm bg-primary px-3.5 py-2.5 text-sm text-white'
              : 'rounded-lg rounded-bl-sm border border-border bg-surface px-3.5 py-2.5 text-sm text-ink'
          }
        >
          {/* whitespace-pre-wrap: los saltos de línea que escribió la
              persona son parte del mensaje. */}
          <p className="whitespace-pre-wrap break-words">{mensaje.contenido}</p>
        </div>

        <div
          className={`mt-1 flex items-center gap-1 text-xs text-muted ${
            propio ? 'justify-end' : 'justify-start'
          }`}
        >
          <time dateTime={mensaje.createdAt}>{hora(mensaje.createdAt)}</time>
          {/* El doble tilde solo en los propios: en los del paciente
              diría que el paciente leyó lo que él mismo escribió. */}
          {propio && (
            <span
              aria-label={mensaje.leido ? 'Leído' : 'Enviado'}
              title={mensaje.leido ? 'Leído' : 'Enviado'}
              className={mensaje.leido ? 'text-primary' : 'text-muted'}
            >
              {mensaje.leido ? '✓✓' : '✓'}
            </span>
          )}
        </div>
      </div>
    </li>
  )
}
