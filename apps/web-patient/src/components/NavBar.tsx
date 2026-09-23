/**
 * Navegación inferior de la app del paciente.
 *
 * Abajo y fija: esta app se usa con una mano y el pulgar no llega a la
 * parte alta de un móvil grande. `env(safe-area-inset-bottom)` la separa
 * de la barra de gestos del sistema.
 *
 * Aquí se carga también el perfil (PAC-09). No es asunto de una barra de
 * navegación, pero es el único componente que aparece en TODAS las
 * pantallas con sesión y en ninguna sin ella: es el sitio donde el fondo
 * elegido se aplica una vez y vale para las ocho, sin que cada pantalla
 * tenga que acordarse de pedirlo.
 */
import { NavLink } from 'react-router-dom'
import { usePerfil } from '../hooks/usePerfil'
import { asegurarMarca } from '../lib/marca'

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
const IconCita = () => (
  <Svg>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </Svg>
)
const IconApuntar = () => (
  <Svg>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Svg>
)
const IconChat = () => (
  <Svg>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Svg>
)
const IconDispositivos = () => (
  <Svg>
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <line x1="12" y1="18" x2="12.01" y2="18" />
  </Svg>
)

/**
 * Seis secciones en la barra.
 *
 * Cinco era el máximo cómodo; la sexta entra porque «Dispositivos» solo
 * se alcanzaba desde un botón de Inicio, y una sección a la que hay que
 * saber llegar es una sección que no se usa.
 *
 * Pero no cabe sola. A 390 px —un iPhone corriente— seis columnas dejan
 * 57 px útiles por item, y «Dispositivos» a 11 px mide unos 59: se
 * partiría en dos líneas y desalinearía toda la barra. A 360 px, peor.
 * Por eso la etiqueta baja a 10 px y, sobre todo, lleva `truncate`: si
 * una fuente del sistema o un idioma futuro vuelve a pasarse de ancho,
 * el texto se recorta en una línea en vez de romper el alto de la barra.
 */
const ITEMS = [
  { to: '/inicio', etiqueta: 'Inicio', Icono: IconInicio },
  { to: '/plan', etiqueta: 'Plan', Icono: IconPlan },
  { to: '/registros', etiqueta: 'Apuntar', Icono: IconApuntar },
  { to: '/citas', etiqueta: 'Citas', Icono: IconCita },
  { to: '/mensajes', etiqueta: 'Mensajes', Icono: IconChat },
  { to: '/dispositivos', etiqueta: 'Dispositivos', Icono: IconDispositivos },
] as const

export function NavBar({ mensajesSinLeer = 0 }: { mensajesSinLeer?: number }) {
  // Carga el perfil y aplica el fondo elegido. Ver la nota de arriba.
  usePerfil()
  // Y el color de la clínica, por el mismo motivo: es el único
  // componente presente en todas las pantallas con sesión. Antes se
  // aplicaba solo en Inicio, y la barra habría cambiado de color al
  // navegar.
  asegurarMarca()

  return (
    <nav
      aria-label="Secciones"
      // El filo de arriba, sin el cual la barra y el contenido se tocan
      // sin transicion cuando la pagina llega hasta abajo.
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-white/20 text-white"
      style={{ backgroundColor: 'var(--nav)' }}
    >
      <ul className="flex">
        {ITEMS.map(({ to, etiqueta, Icono }) => (
          <li key={to} className="min-w-0 flex-1">
            <NavLink
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center px-0.5 pb-2 pt-3 font-medium transition-colors ${
                  isActive ? 'text-white' : 'text-white/70'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <Icono />
                    {etiqueta === 'Mensajes' && mensajesSinLeer > 0 && (
                      // Invertido: sobre la barra teñida, un contador en
                      // --primary se confundiría con el fondo.
                      <span
                        className="absolute -right-1.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-pill bg-white px-1 text-[10px] font-bold"
                        style={{ color: 'var(--nav)' }}
                      >
                        {mensajesSinLeer > 9 ? '9+' : mensajesSinLeer}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 w-full truncate text-center text-[10px]">{etiqueta}</span>
                  {/* Color y subrayado: la pestaña activa no se distingue
                      solo por el tono. */}
                  <span
                    aria-hidden="true"
                    className={`mt-1 h-0.5 w-6 rounded-pill ${isActive ? 'bg-white' : 'bg-transparent'}`}
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
