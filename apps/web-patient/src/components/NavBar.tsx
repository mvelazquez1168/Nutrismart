/**
 * Navegación inferior de la app del paciente.
 *
 * Abajo y fija: esta app se usa con una mano y el pulgar no llega a la
 * parte alta de un móvil grande. `env(safe-area-inset-bottom)` la separa
 * de la barra de gestos del sistema.
 */
import { NavLink } from 'react-router-dom'

const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current" strokeWidth={2}>
    {children}
  </svg>
)

const IconInicio = () => (
  <Svg>
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </Svg>
)
const IconPlan = () => (
  <Svg>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </Svg>
)
const IconChat = () => (
  <Svg>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Svg>
)

const ITEMS = [
  { to: '/inicio', etiqueta: 'Inicio', Icono: IconInicio },
  { to: '/plan', etiqueta: 'Mi plan', Icono: IconPlan },
  { to: '/mensajes', etiqueta: 'Mensajes', Icono: IconChat },
] as const

export function NavBar({ mensajesSinLeer = 0 }: { mensajesSinLeer?: number }) {
  return (
    <nav
      aria-label="Secciones"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface"
    >
      <ul className="flex">
        {ITEMS.map(({ to, etiqueta, Icono }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center px-2 pb-2 pt-3 text-xs font-medium transition-colors ${
                  isActive ? 'text-primary' : 'text-muted'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <Icono />
                    {etiqueta === 'Mensajes' && mensajesSinLeer > 0 && (
                      <span
                        className="absolute -right-1.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-pill px-1 text-[10px] font-bold text-white"
                        style={{ backgroundColor: 'var(--primary)' }}
                      >
                        {mensajesSinLeer > 9 ? '9+' : mensajesSinLeer}
                      </span>
                    )}
                  </span>
                  <span className="mt-1">{etiqueta}</span>
                  {/* Color y subrayado: la pestaña activa no se distingue
                      solo por el tono. */}
                  <span
                    aria-hidden="true"
                    className={`mt-1 h-0.5 w-6 rounded-pill ${isActive ? 'bg-primary' : 'bg-transparent'}`}
                  />
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
