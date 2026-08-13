import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { keycloak, initKeycloak } from './keycloak'

export interface Perfil {
  /** 'sub' del token. */
  id: string
  nombre: string
  correo: string | undefined
  roles: string[]
  /** clinica_id que la API usa para acotar todo. */
  tenantId: string | undefined
}

interface AuthState {
  estado: 'cargando' | 'autenticado' | 'error'
  perfil: Perfil | null
  error: string | null
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}

function leerPerfil(): Perfil {
  const t = keycloak.tokenParsed as
    | (Record<string, unknown> & {
        sub?: string
        name?: string
        preferred_username?: string
        email?: string
        tenant_id?: string
        realm_access?: { roles?: string[] }
      })
    | undefined

  return {
    id: t?.sub ?? '',
    nombre: t?.name ?? t?.preferred_username ?? 'Sin nombre',
    correo: t?.email,
    roles: t?.realm_access?.roles ?? [],
    tenantId: t?.tenant_id,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<AuthState['estado']>('cargando')
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false

    initKeycloak()
      .then((autenticado) => {
        if (cancelado) return

        if (!autenticado) {
          // Con onLoad:'login-required' esto no deberia ocurrir: Keycloak
          // redirige antes. Se contempla por si cambia la estrategia.
          setError('Keycloak no autentico la sesion')
          setEstado('error')
          return
        }

        setPerfil(leerPerfil())
        setEstado('autenticado')
      })
      .catch((e: unknown) => {
        if (cancelado) return
        setError(e instanceof Error ? e.message : 'Fallo al inicializar Keycloak')
        setEstado('error')
      })

    return () => {
      cancelado = true
    }
  }, [])

  const valor: AuthState = {
    estado,
    perfil,
    error,
    logout: () => void keycloak.logout({ redirectUri: window.location.origin }),
  }

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>
}
