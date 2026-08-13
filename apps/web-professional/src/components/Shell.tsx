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
import { ROL_ADMIN_CLINICA } from '../api/tipos'

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
 */
function navDe(esAdmin: boolean): ItemNav[] {
  return [
    {
      clave: 'dashboard',
      etiqueta: 'Dashboard',
      ...(esAdmin ? { ruta: '/admin/dashboard' } : {}),
    },
    { clave: 'pacientes', etiqueta: 'Pacientes', ruta: '/pacientes' },
    { clave: 'agenda', etiqueta: 'Agenda', ruta: '/agenda' },
    { clave: 'laboratorios', etiqueta: 'Laboratorios' },
    { clave: 'estrategias', etiqueta: 'Estrategias' },
    {
      clave: 'configuracion',
      etiqueta: 'Configuración',
      ...(esAdmin ? { ruta: '/ajustes/marca' } : {}),
    },
  ]
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
  children,
}: {
  seccionActiva: string
  nombreClinica: string | null
  children: ReactNode
}) {
  const { perfil, logout } = useAuth()
  const { brand } = useBrand()

  const esAdmin = perfil?.roles.includes(ROL_ADMIN_CLINICA) ?? false
  const logo = urlLogo(brand, API_BASE)

  return (
    <div className="flex min-h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
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
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-lg font-bold text-white">
              {brand.nombreApp.trim().charAt(0).toUpperCase() || 'N'}
            </span>
          )}
          <span className="truncate text-lg font-bold text-ink">{brand.nombreApp}</span>
        </div>

        <nav className="flex-1 px-3">
          <ul className="space-y-1">
            {navDe(esAdmin).map((item) => {
              const activo = item.clave === seccionActiva

              if (activo) {
                return (
                  <li key={item.clave}>
                    <span
                      aria-current="page"
                      className="flex items-center gap-2 rounded-md border-l-4 border-primary bg-primary-tint px-3 py-2 text-sm font-semibold text-primary"
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
                      className="flex items-center gap-2 rounded-md px-3 py-2 pl-4 text-sm text-ink transition-colors hover:bg-surface-2"
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
                    className="flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-2 pl-4 text-sm text-muted opacity-60"
                  >
                    {item.etiqueta}
                  </span>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="border-t border-border p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-pill bg-primary text-xs font-semibold text-white">
              {inicialesDe(perfil?.nombre ?? '')}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{perfil?.nombre}</p>
              <p className="truncate text-xs text-muted">{perfil?.correo ?? 'Sin correo'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="mt-3 w-full rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-6 py-3">
          <div className="text-sm text-muted">
            {nombreClinica ?? <span className="opacity-0">·</span>}
          </div>
          <div className="text-sm font-medium text-ink">{perfil?.nombre}</div>
        </header>

        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
