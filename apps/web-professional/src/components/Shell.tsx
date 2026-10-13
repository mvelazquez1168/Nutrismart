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
  /**
   * Ruta destino. **Obligatoria**: en este menú no hay ítems apagados.
   *
   * O la sección existe y el ítem navega, o el ítem no se pinta. Un ítem
   * sin destino es indistinguible de uno roto —el usuario hace clic, no
   * pasa nada, y no tiene forma de saber si es que no existe o es que
   * falla—, y los tres de administración estuvieron así.
   */
  ruta: string
}

/**
 * El menú de la barra lateral.
 *
 * ── Nada apagado ────────────────────────────────────────────────────
 *
 * Las secciones de administración (Dashboard, Clínica, Equipo, Marca) se
 * AÑADEN cuando quien mira es administrador, y se omiten cuando no. Antes
 * se añadían siempre y se les quitaba la `ruta`, lo que las dejaba como
 * cuatro ítems grises que no llevaban a ningún sitio: un nutricionista no
 * sabía si le faltaba permiso o si la pantalla no existía, y un admin cuyo
 * perfil no se pudo cargar las veía igual de muertas.
 *
 * ── Quién decide si eres administrador ──────────────────────────────
 *
 * `esAdmin` llega por PROP, desde quien monta las rutas. No se calcula
 * aquí, y el motivo es un defecto que estuvo en la aplicación: este
 * archivo lo sacaba del rol en el token mientras el router lo sacaba de
 * `/api/profesional/yo`. En cuanto las dos respuestas diferían, el menú y
 * las rutas se contradecían.
 *
 * Una sola fuente, y la del router, que es la que manda.
 */
function navDe(esAdmin: boolean, esSuperAdmin: boolean): ItemNav[] {
  const items: ItemNav[] = []

  // El Dashboard de clínica es una vista agregada de toda la clínica: es
  // del administrador, y por eso abre el menú solo para él.
  if (esAdmin) {
    items.push({ clave: 'dashboard', etiqueta: 'Dashboard', ruta: '/admin/dashboard' })
  }

  items.push(
    { clave: 'pacientes', etiqueta: 'Pacientes', ruta: '/pacientes' },
    { clave: 'agenda', etiqueta: 'Agenda', ruta: '/agenda' },
    // El seguimiento continuo es de cualquier profesional: cada uno ve
    // los suyos, y el servidor decide el alcance.
    { clave: 'monitoreo', etiqueta: 'Monitoreo', ruta: '/monitoreo' },
    { clave: 'mensajeria', etiqueta: 'Mensajería', ruta: '/mensajeria' },
    { clave: 'recursos', etiqueta: 'Biblioteca', ruta: '/recursos' },
    // «Laboratorios» y «Estrategias» se quitaron del menu: eran items
    // apagados, sin ruta ni pantalla. La gestion de laboratorios del
    // paciente ya vive dentro de la valoracion (pestana «Laboratorios» de
    // la consulta) y de la ficha.
    //
    // Solo se quitaron de AQUI: las rutas, las pantallas y los endpoints
    // de laboratorios siguen intactos.
    //
    // Las reglas son de la clínica, no del administrador: cualquier
    // profesional necesita ver por qué llegan los avisos que recibe.
    { clave: 'reglas', etiqueta: 'Reglas automáticas', ruta: '/notificaciones/reglas' },
  )

  // Tres entradas de administración, no una: los datos de la clínica, el
  // equipo y la identidad visual son cosas distintas y se buscan por
  // separado.
  if (esAdmin) {
    items.push(
      { clave: 'clinica', etiqueta: 'Clínica', ruta: '/ajustes/clinica' },
      { clave: 'equipo', etiqueta: 'Equipo', ruta: '/ajustes/equipo' },
      { clave: 'configuracion', etiqueta: 'Marca', ruta: '/ajustes/marca' },
    )
  }

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

              // Sin rama de «apagado»: todo item que llega aqui tiene
              // ruta. Ver la nota de `ItemNav.ruta`.
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
