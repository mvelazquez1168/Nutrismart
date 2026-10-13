/**
 * Shell de la app profesional: sidebar + topbar.
 * Layout tomado de disenos/CLI/shell-app-nutricion.png; todos los valores
 * visuales salen de los tokens, no de los pixeles del PNG.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useBrand, urlLogo } from '../contexts/BrandContext'
import { API_BASE } from '../api/client'
import { ROL_SUPER_ADMIN } from '../api/tipos'
import { NotificacionesCampana } from './notificaciones/NotificacionesCampana'

interface ItemNav {
  clave: string
  etiqueta: string
  /** Ruta destino; solo las secciones construidas la tienen. */
  ruta?: string
}

/**
 * Dashboard y Configuración solo llevan a algún sitio si quien mira es
 * administrador de la clínica. Para un nutricionista siguen apagadas,
 * como las secciones que aún no existen: mostrarle un enlace que la
 * API va a rechazar con 403 sería prometer algo que no puede hacer.
 *
 * esSuperAdmin añade una sección de plataforma al final: solo visible
 * para el super-admin de NutriSmart, nunca para los profesionales.
 *
 * ── Quién decide si eres administrador ──────────────────────────────
 *
 * `esAdmin` llega por PROP, desde quien monta las rutas. No se calcula
 * aquí, y el motivo es un defecto que estuvo en la aplicación:
 *
 * este archivo lo sacaba del rol en el token (`perfil.roles`), mientras
 * el router lo sacaba de `/api/profesional/yo`, donde `esAdmin` es el rol
 * en el token **y** el rol en la ficha de profesional. En cuanto las dos
 * respuestas diferían —y difieren siempre que el perfil no se puede
 * cargar—, el menú pintaba Clínica, Equipo y Marca como enlaces vivos y
 * el router los devolvía a Pacientes. Visto desde la pantalla: tres
 * ítems del menú que muestran la lista de pacientes.
 *
 * Una sola fuente, y la del router, que es la que manda.
 */
function navDe(esAdmin: boolean, esSuperAdmin: boolean): ItemNav[] {
  const items: ItemNav[] = [
    {
      clave: 'dashboard',
      etiqueta: 'Dashboard',
      ...(esAdmin ? { ruta: '/admin/dashboard' } : {}),
    },
    { clave: 'pacientes', etiqueta: 'Pacientes', ruta: '/pacientes' },
    { clave: 'agenda', etiqueta: 'Agenda', ruta: '/agenda' },
    // El seguimiento continuo es de cualquier profesional: cada uno ve
    // los suyos, y el servidor decide el alcance.
    { clave: 'monitoreo', etiqueta: 'Monitoreo', ruta: '/monitoreo' },
    { clave: 'mensajeria', etiqueta: 'Mensajería', ruta: '/mensajeria' },
    { clave: 'recursos', etiqueta: 'Biblioteca', ruta: '/recursos' },
    // «Laboratorios» se quito del menu: era un item apagado, sin ruta ni
    // pantalla, y la gestion de laboratorios del paciente ya vive dentro
    // de la valoracion (pestana «Laboratorios» de la consulta) y de la
    // ficha. Un item de primer nivel apagado prometia una seccion que no
    // existe y nunca se penso como tal.
    //
    // Solo se quito de AQUI: las rutas, las pantallas y los endpoints de
    // laboratorios siguen intactos.
    { clave: 'estrategias', etiqueta: 'Estrategias' },
    // Las reglas son de la clínica, no del administrador: cualquier
    // profesional necesita ver por qué llegan los avisos que recibe.
    { clave: 'reglas', etiqueta: 'Reglas automáticas', ruta: '/notificaciones/reglas' },
    // Tres entradas de administración, no una: los datos de la clínica,
    // el equipo y la identidad visual son cosas distintas y se buscan
    // por separado.
    {
      clave: 'clinica',
      etiqueta: 'Clínica',
      ...(esAdmin ? { ruta: '/ajustes/clinica' } : {}),
    },
    {
      clave: 'equipo',
      etiqueta: 'Equipo',
      ...(esAdmin ? { ruta: '/ajustes/equipo' } : {}),
    },
    {
      clave: 'configuracion',
      etiqueta: 'Marca',
      ...(esAdmin ? { ruta: '/ajustes/marca' } : {}),
    },
  ]

  // El panel de plataforma solo aparece para el super_admin: ningún
  // profesional de clínica, ni siquiera el administrador, lo ve.
  if (esSuperAdmin) {
    items.push({
      clave: 'superadmin',
      etiqueta: 'Plataforma',
      ruta: '/superadmin/clinicas',
    })
  }

  return items
}

function inicialesDe(nombre: string): string {
  const p = nombre.trim().split(/\s+/).filter(Boolean)
  if (p.length === 0) return '?'
  if (p.length === 1) return (p[0] ?? '').slice(0, 2).toUpperCase()
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase()
}

export function Shell({
  seccionActiva,
  nombreClinica,
  esAdmin,
  esSuperAdmin = false,
  children,
}: {
  seccionActiva: string
  nombreClinica: string | null
  /**
   * Si quien mira administra la clínica. La MISMA respuesta que usa el
   * router para dejar entrar; ver la nota sobre `navDe`.
   */
  esAdmin: boolean
  esSuperAdmin?: boolean
  children: ReactNode
}) {
  const { perfil, logout } = useAuth()
  const { brand } = useBrand()

  const _superAdmin = esSuperAdmin || (perfil?.roles.includes(ROL_SUPER_ADMIN) ?? false)
  const logo = urlLogo(brand, API_BASE)

  return (
    <div className="flex min-h-full">
      {/* La navegación se viste con el color de la clínica (APP-BRAND-01).
          El color y la tinta salen de las variables, nunca de un valor
          fijo: cambiar la paleta desde Ajustes → Marca se ve al momento,
          sin recargar. */}
      <aside
        className="flex w-60 shrink-0 flex-col text-white"
        style={{ backgroundColor: 'var(--nav)' }}
      >
        <div className="flex items-center gap-2 px-5 py-5">
          {logo ? (
            // object-contain y altura fija: un logo apaisado y uno
            // cuadrado tienen que convivir en la misma barra sin
            // deformarse ni empujar el nombre fuera.
            <img
              src={logo}
              alt={brand.nombreApp}
              className="h-9 w-auto max-w-[7rem] object-contain"
            />
          ) : (
            // Sobre el fondo de marca, la inicial ya no puede ir en
            // primario: se volvería invisible.
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-white/20 text-lg font-bold">
              {brand.nombreApp.trim().charAt(0).toUpperCase() || 'N'}
            </span>
          )}
          <span className="truncate text-lg font-bold">{brand.nombreApp}</span>
        </div>

        <nav className="flex-1 px-3">
          <ul className="space-y-1">
            {navDe(esAdmin, _superAdmin).map((item) => {
              const activo = item.clave === seccionActiva

              if (activo) {
                return (
                  <li key={item.clave}>
                    {/* El borde izquierdo se queda: la sección actual no
                        puede distinguirse solo por el tono del fondo. */}
                    <span
                      aria-current="page"
                      className="flex items-center gap-2 rounded-md border-l-4 border-white bg-white/20 px-3 py-2 text-sm font-semibold"
                    >
                      {item.etiqueta}
                    </span>
                  </li>
                )
              }

              if (item.ruta) {
                return (
                  <li key={item.clave}>
                    <Link
                      to={item.ruta}
                      className="flex items-center gap-2 rounded-md px-3 py-2 pl-4 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      {item.etiqueta}
                    </Link>
                  </li>
                )
              }

              return (
                <li key={item.clave}>
                  {/*
                    Las secciones que aun no existen se muestran apagadas y
                    sin enlace, en vez de llevar a una pantalla vacia. Es
                    mas honesto que fingir navegacion.
                  */}
                  <span
                    aria-disabled="true"
                    title="Disponible en una rebanada posterior"
                    className="flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-2 pl-4 text-sm text-white/50"
                  >
                    {item.etiqueta}
                  </span>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="border-t border-white/20 p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-pill bg-white/20 text-xs font-semibold">
              {inicialesDe(perfil?.nombre ?? '')}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{perfil?.nombre}</p>
              <p className="truncate text-xs text-white/70">{perfil?.correo ?? 'Sin correo'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="mt-3 w-full rounded-md border border-white/35 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* El filo de abajo: sin el, la barra lateral y la superior se
            funden en un unico bloque de color. */}
        <header
          className="flex items-center justify-between gap-4 border-b border-white/20 px-6 py-3 text-white"
          style={{ backgroundColor: 'var(--nav)' }}
        >
          <div className="text-sm text-white/70">
            {nombreClinica ?? <span className="opacity-0">·</span>}
          </div>
          <div className="flex items-center gap-3">
            <NotificacionesCampana />
            <span className="text-sm font-medium">{perfil?.nombre}</span>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
