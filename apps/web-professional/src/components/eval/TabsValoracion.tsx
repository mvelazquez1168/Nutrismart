/**
 * Barra de secciones de la valoración — EVAL-00.
 *
 * Cada pestaña indica si su sección está completa. La marca no es solo
 * color: lleva un símbolo y el estado va en el `aria-label`, para que
 * el progreso se siga sin distinguir tonos.
 */
import { SECCIONES, type Seccion } from '../../api/valoracion'

export function TabsValoracion({
  activa,
  completas,
  onCambiar,
}: {
  activa: Seccion
  completas: Record<string, boolean>
  onCambiar: (s: Seccion) => void
}) {
  return (
    // Scroll horizontal en pantallas estrechas: cinco pestañas no caben
    // en un móvil y partirlas en dos filas descoloca el subrayado.
    <div className="overflow-x-auto border-b border-border">
      <nav className="flex min-w-max gap-1" aria-label="Secciones de la valoración">
        {SECCIONES.map((s) => {
          const completa = completas[s.clave] === true
          const esActiva = s.clave === activa
          return (
            <button
              key={s.clave}
              type="button"
              onClick={() => onCambiar(s.clave)}
              aria-current={esActiva ? 'page' : undefined}
              aria-label={`${s.etiqueta}${completa ? ', completada' : ', pendiente'}`}
              className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition-colors ${
                esActiva
                  ? 'border-primary font-semibold text-primary'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-pill text-[10px] font-bold ${
                  completa
                    ? 'bg-[color:var(--status-normal)] text-white'
                    : 'border border-border text-transparent'
                }`}
              >
                ✓
              </span>
              {s.etiqueta}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
