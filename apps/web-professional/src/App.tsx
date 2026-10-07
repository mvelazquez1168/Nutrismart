import { useEffect, useState, type ReactNode } from 'react'
import {
  createBrowserRouter,
  RouterProvider,
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { BrandProvider } from './contexts/BrandContext'
import { CambiosSinGuardarProvider } from './contexts/CambiosSinGuardar'
import { Shell } from './components/Shell'
import { Pacientes } from './pages/Pacientes'
import { PacienteFicha } from './pages/PacienteFicha'
import { Agenda } from './pages/Agenda'
import { MarcaPage } from './pages/ajustes/MarcaPage'
import { DashboardPage } from './pages/DashboardPage'
import { BandejaMensajes } from './pages/BandejaMensajes'
import { Recursos } from './pages/Recursos'
import { Monitoreo } from './pages/Monitoreo'
import { useYo } from './hooks/useYo'
import { Login } from './pages/Login'
import { ClinicaPage } from './pages/ajustes/ClinicaPage'
import { EquipoPage } from './pages/ajustes/EquipoPage'
import { ReglasNotificacion } from './pages/ReglasNotificacion'
import { ValoracionPaciente } from './pages/ValoracionPaciente'
import { ClinicasPage } from './pages/superadmin/ClinicasPage'
import { getMe } from './api/pacientes'
import { ROL_ADMIN_CLINICA, ROL_SUPER_ADMIN } from './api/tipos'
import type { Me } from './api/tipos'

function Centrado({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <div className="max-w-md text-center">{children}</div>
    </div>
  )
}

/** Sección de la barra lateral que corresponde a la ruta actual. */
function seccionDe(pathname: string): string {
  if (pathname.startsWith('/agenda')) return 'agenda'
  if (pathname.startsWith('/ajustes/clinica')) return 'clinica'
  if (pathname.startsWith('/ajustes/equipo')) return 'equipo'
  if (pathname.startsWith('/ajustes')) return 'configuracion'
  if (pathname.startsWith('/admin')) return 'dashboard'
  if (pathname.startsWith('/mensajeria')) return 'mensajeria'
  if (pathname.startsWith('/notificaciones')) return 'reglas'
  if (pathname.startsWith('/recursos')) return 'recursos'
  if (pathname.startsWith('/monitoreo')) return 'monitoreo'
  if (pathname.startsWith('/superadmin')) return 'superadmin'
  return 'pacientes'
}

/**
 * Marco mínimo para el operador de la plataforma.
 *
 * El Shell no sirve aquí: se alimenta de la clínica del token —logo,
 * paleta, nombre en la cabecera, menú entero— y el operador no tiene
 * ninguna. Dentro del Shell, su menú llevaría a pantallas que responden
 * 401 y la cabecera mostraría una clínica inexistente.
 */
function MarcoPlataforma({ children }: { children: ReactNode }) {
  const { perfil, logout } = useAuth()

  return (
    <div className="min-h-full bg-background">
      <header
        className="flex items-center justify-between gap-4 px-6 py-3 text-white"
        style={{ backgroundColor: 'var(--nav)' }}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold">NutriSmart · Plataforma</p>
          <p className="truncate text-xs text-white/70">
            {perfil?.correo ?? perfil?.nombre ?? 'Operador'}
          </p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="shrink-0 rounded-md border border-white/35 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          Cerrar sesión
        </button>
      </header>
      <main className="p-6">{children}</main>
    </div>
  )
}

function Contenido() {
  const { estado, error, perfil } = useAuth()
  const location = useLocation()

  /**
   * Un operador de plataforma no pertenece a ninguna clínica: su token no
   * trae `tenant_id`, y tanto `/api/profesional/yo` como `/api/me` le
   * responden 404 porque no tiene ficha en ningún sitio.
   *
   * Por eso las dos peticiones se condicionan al tenant y no solo a la
   * sesión. Pedirlas igualmente pintaría un «no se pudo cargar el perfil»
   * sobre una pantalla que no necesita ningún perfil de clínica.
   */
  const tieneClinica = perfil?.tenantId !== undefined

  // `estado === 'autenticado'` NO es opcional: ver la nota del hook. Si
  // se pide el perfil antes de que Keycloak este listo, la peticion
  // acaba redirigiendo al login y la aplicacion entra en bucle.
  const { yo, cargado: cargadoYo } = useYo(estado === 'autenticado' && tieneClinica)
  const [me, setMe] = useState<Me | null>(null)
  const [errorMe, setErrorMe] = useState<string | null>(null)

  useEffect(() => {
    if (estado !== 'autenticado' || !tieneClinica) return

    const ctrl = new AbortController()
    getMe(ctrl.signal)
      .then(setMe)
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        setErrorMe(e instanceof Error ? e.message : 'No se pudo cargar el perfil')
      })
    return () => ctrl.abort()
  }, [estado, tieneClinica])

  if (estado === 'cargando') {
    return (
      <Centrado>
        <p className="text-muted">Conectando con Keycloak…</p>
      </Centrado>
    )
  }

  if (estado === 'error') {
    return (
      <Centrado>
        <h1 className="text-lg font-bold text-ink">No se pudo iniciar sesión</h1>
        <p className="mt-2 text-sm text-muted">{error}</p>
      </Centrado>
    )
  }

  // Sin sesión, la pantalla propia. Antes no se llegaba aquí nunca:
  // `login-required` redirigía a Keycloak antes de pintar nada.
  if (estado !== 'autenticado') return <Login />

  // Ser administrador exige las DOS cosas, igual que en la API: el rol
  // en el token de Keycloak (que es quien concede el acceso) y el rol en
  // la base (que puede quitarlo pero nunca darlo). Ver la nota de
  // `routes/equipo.ts`.
  //
  // Mientras llega `/api/profesional/yo` se usa solo el token: en el caso
  // normal coinciden, y esperar dejaría el menú vacío en cada carga. Al
  // llegar, si discrepan, la vista se corrige sola.
  //
  // Esto solo decide QUÉ se pinta. Quien manda es el 403 del servidor,
  // que no depende de nada que el navegador pueda alterar.
  const enToken = perfil?.roles.includes(ROL_ADMIN_CLINICA) ?? false
  const esAdmin = cargadoYo ? (yo?.esAdmin ?? false) : enToken
  const esSuperAdmin = perfil?.roles.includes(ROL_SUPER_ADMIN) ?? false

  /**
   * El operador de plataforma SIN clínica no pasa por el Shell ni por
   * BrandProvider: no hay marca que cargar ni sección que ofrecerle.
   *
   * Quien es operador Y además trabaja en una clínica sí ve el Shell, con
   * «Plataforma» como una sección más. Ese caso no necesita excepción.
   */
  if (esSuperAdmin && !tieneClinica) {
    return (
      <MarcoPlataforma>
        <Routes>
          <Route path="/superadmin/clinicas" element={<ClinicasPage />} />
          <Route path="*" element={<Navigate to="/superadmin/clinicas" replace />} />
        </Routes>
      </MarcoPlataforma>
    )
  }

  return (
    <BrandProvider clinicaId={perfil?.tenantId}>
      <Shell seccionActiva={seccionDe(location.pathname)} nombreClinica={me?.clinica.nombre ?? null} esSuperAdmin={esSuperAdmin}>
        {/*
          El fallo de /api/me no bloquea la pantalla: solo deja el nombre de
          la clinica sin mostrar. La lista de pacientes tiene su propio
          manejo de error, y son dos peticiones independientes.
        */}
        {errorMe && (
          <p className="mb-4 rounded-md border border-border bg-surface p-3 text-sm text-muted">
            No se pudo cargar el perfil: {errorMe}
          </p>
        )}

        <Routes>
          <Route path="/pacientes" element={<Pacientes />} />
          <Route path="/pacientes/:id" element={<PacienteFicha />} />
          <Route
            path="/pacientes/:id/valoracion/:consultaId"
            element={<ValoracionPaciente />}
          />
          <Route path="/agenda" element={<Agenda />} />
          {/* Ambas son de cualquier profesional: los hilos son propios y
              las reglas describen cómo trabaja la clínica entera. */}
          <Route path="/mensajeria" element={<BandejaMensajes />} />
          <Route path="/recursos" element={<Recursos />} />
          <Route path="/monitoreo" element={<Monitoreo />} />
          <Route path="/notificaciones/reglas" element={<ReglasNotificacion />} />
          {/* Un nutricionista que teclee la URL a mano vuelve a
              Pacientes. No es la defensa: la API responde 403 igual. */}
          <Route
            path="/ajustes/marca"
            element={esAdmin ? <MarcaPage /> : <Navigate to="/pacientes" replace />}
          />
          <Route
            path="/ajustes/clinica"
            element={esAdmin ? <ClinicaPage /> : <Navigate to="/pacientes" replace />}
          />
          <Route
            path="/ajustes/equipo"
            element={esAdmin ? <EquipoPage /> : <Navigate to="/pacientes" replace />}
          />
          <Route
            path="/admin/dashboard"
            element={esAdmin ? <DashboardPage /> : <Navigate to="/pacientes" replace />}
          />
          {/* Panel de plataforma: solo accesible con el rol super_admin. */}
          <Route
            path="/superadmin/clinicas"
            element={esSuperAdmin ? <ClinicasPage /> : <Navigate to="/pacientes" replace />}
          />
          {/* Cualquier otra ruta cae en Pacientes: es la unica seccion
              construida, y una pantalla de 404 aqui seria ruido. */}
          <Route path="*" element={<Navigate to="/pacientes" replace />} />
        </Routes>
      </Shell>
    </BrandProvider>
  )
}

/**
 * Todo lo de dentro, bajo una única ruta `*`.
 *
 * Las `<Routes>` de `Contenido` siguen tal cual: son rutas descendientes
 * y un data router las admite. Lo que cambia es que ahora existe el
 * contexto de data router, que es lo que `useBlocker` necesita para
 * atrapar los `<Link>` y el botón Atrás antes de desmontar el formulario
 * (R46, aviso de cambios sin guardar).
 */
function Raiz() {
  return (
    <AuthProvider>
      <CambiosSinGuardarProvider>
        <Contenido />
      </CambiosSinGuardarProvider>
    </AuthProvider>
  )
}

/**
 * `createBrowserRouter` y no `<BrowserRouter>`: solo el primero crea el
 * data router. Se construye una vez, a nivel de módulo; hacerlo dentro
 * del componente crearía un router nuevo en cada render y perdería el
 * historial.
 */
const router = createBrowserRouter([{ path: '*', element: <Raiz /> }])

export default function App() {
  return <RouterProvider router={router} />
}
