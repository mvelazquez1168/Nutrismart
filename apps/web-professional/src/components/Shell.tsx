/**
 * Shell de la app profesional: sidebar + topbar.
 * Layout tomado de disenos/CLI/shell-app-nutricion.png; todos los valores
 * visuales salen de los tokens, no de los pixeles del PNG.
 */
import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'

interface ItemNav {
  clave: string
  etiqueta: string
  /** Solo "Pacientes" existe en la Rebanada 1. */
  disponible: boolean
}

const NAV: ItemNav[] = [
  { clave: 'dashboard', etiqueta: 'Dashboard', disponible: false },
  { clave: 'pacientes', etiqueta: 'Pacientes', disponible: true },
  { clave: 'agenda', etiqueta: 'Agenda', disponible: false },
  { clave: 'laboratorios', etiqueta: 'Laboratorios', disponible: false },
  { clave: 'estrategias', etiqueta: 'Estrategias', disponible: false },
  { clave: 'configuracion', etiqueta: 'Configuración', disponible: false },
]

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

  return (
    <div className="flex min-h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-lg font-bold text-white">
            N
          </span>
          <span className="text-lg font-bold text-ink">NutriSmart</span>
        </div>

        <nav className="flex-1 px-3">
          <ul className="space-y-1">
            {NAV.map((item) => {
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
