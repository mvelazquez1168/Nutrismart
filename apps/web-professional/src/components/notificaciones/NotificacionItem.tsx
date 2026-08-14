/**
 * Una notificación del panel — COM-02.
 *
 * Cada tipo lleva icono y color, pero el color NUNCA es lo único que
 * distingue: el rótulo lo dice con palabras. Los tonos salen de los
 * tokens, así que una clínica con otra marca los sigue.
 */
import type { CSSProperties } from 'react'
import { tiempoRelativo } from '../../lib/fechas'
import type { Notificacion, TipoNotificacion } from '../../api/notificaciones'

interface Presentacion {
  rotulo: string
  color: string
  icono: string
}

const POR_TIPO: Record<TipoNotificacion, Presentacion> = {
  mensaje_nuevo: { rotulo: 'Nuevo mensaje', color: 'var(--primary)', icono: '💬' },
  lab_cargado: { rotulo: 'Laboratorio', color: 'var(--chart-1)', icono: '🧪' },
  cita_proxima: { rotulo: 'Cita próxima', color: 'var(--status-alert)', icono: '📅' },
  cita_hoy: { rotulo: 'Cita de hoy', color: 'var(--status-alert)', icono: '📅' },
  plan_actualizado: { rotulo: 'Plan actualizado', color: 'var(--chart-3)', icono: '🍽️' },
  paciente_nuevo: { rotulo: 'Paciente nuevo', color: 'var(--chart-1)', icono: '👤' },
  cumpleanos: { rotulo: 'Cumpleaños', color: 'var(--chart-2)', icono: '🎂' },
  reminder: { rotulo: 'Recordatorio', color: 'var(--status-alert)', icono: '⏰' },
  checkup: { rotulo: 'Seguimiento', color: 'var(--chart-3)', icono: '🩺' },
  fecha_importante: { rotulo: 'Fecha señalada', color: 'var(--chart-4)', icono: '📌' },
}

export function NotificacionItem({
  notificacion,
  onAbrir,
}: {
  notificacion: Notificacion
  onAbrir: (n: Notificacion) => void
}) {
  const p = POR_TIPO[notificacion.tipo]

  return (
    <li>
      <button
        type="button"
        onClick={() => onAbrir(notificacion)}
        style={{ ['--tono' as string]: p.color } as CSSProperties}
        className={`flex w-full gap-3 border-l-4 px-4 py-3 text-left transition-colors hover:bg-surface-2 ${
          notificacion.leida
            ? 'border-l-transparent bg-surface'
            : 'border-l-[color:var(--tono)] bg-primary-tint'
        }`}
      >
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-base leading-none">
          {p.icono}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: 'var(--tono)' }}
            >
              {p.rotulo}
            </span>
            <time dateTime={notificacion.createdAt} className="shrink-0 text-xs text-muted">
              {tiempoRelativo(notificacion.createdAt)}
            </time>
          </span>

          <span
            className={`mt-0.5 block text-sm text-ink ${notificacion.leida ? '' : 'font-semibold'}`}
          >
            {notificacion.titulo}
          </span>

          {notificacion.contenido && (
            <span className="mt-0.5 block truncate text-xs text-muted">
              {notificacion.contenido}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
