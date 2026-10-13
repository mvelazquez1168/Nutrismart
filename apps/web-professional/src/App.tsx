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
import { SinPermisoAdmin } from './components/SinPermisoAdmin'
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

  /*
   * ── Quién es administrador, y por qué no es una sola condición ──────
   *
   * Ser administrador exige las DOS cosas, igual que en la API: el rol en
   * el token de Keycloak (que es quien CONCEDE el acceso) y el rol en la
   * ficha de profesional (que puede QUITARLO, nunca darlo). Ver la nota de
   * `routes/equipo.ts`.
   *
   * **Lo que no es un «no»: que el perfil no se haya podido leer.** Antes
   * esto decía `cargado ? (yo?.esAdmin ?? false) : enToken`, y ese
   * `?? false` convertía «no hubo respuesta» en «no eres administrador».
   * `/api/profesional/yo` devuelve 404 cuando ningún `profesional` casa
   * con el `sub` del token, que es exactamente lo que pasa cuando el
   * `keycloak_user_id` de la base y el usuario de Keycloak se separan —el
   * caso real que apagó Clínica, Equipo y Marca para los tres
   * profesionales de la base a la vez.
   *
   * Así que la base quita el rol solo cuando la base CONTESTA. Si no
   * contesta, manda el token, que es quien concede.
   *
   * El operador de plataforma cuenta como administrador de la clínica en
   * la que tiene ficha: las cuatro secciones son suyas por definición.
   *
   * Esto solo decide QUÉ se pinta. Quien manda es el 403 del servidor, que
   * no depende de nada que el navegador pueda alterar, y las rutas de
   * administración explican qué falta con `SinPermisoAdmin` en vez de
   * rebotar a Pacientes.
   */
  const enToken = perfil?.roles.includes(ROL_ADMIN_CLINICA) ?? false
  const esSuperAdmin = perfil?.roles.includes(ROL_SUPER_ADMIN) ?? false
  const esAdmin = esSuperAdmin || (yo !== null ? yo.esAdmin : enToken)

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
      {/*
        `esAdmin` se le pasa al Shell: el menú y las rutas tienen que
        responder lo mismo. Cuando el Shell lo calculaba por su cuenta
        —del token—, Clínica, Equipo y Marca aparecían como enlaces vivos
        y rebotaban a Pacientes.
      */}
      <Shell
        seccionActiva={seccionDe(location.pathname)}
        nombreClinica={me?.clinica.nombre ?? null}
        esAdmin={esAdmin}
        esSuperAdmin={esSuperAdmin}
      >
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
          {/*
            Sin permiso NO se rebota a Pacientes: se explica qué falta.
            El rebote silencioso es lo que hacía que estos tres ítems del
            menú «mostraran la lista de pacientes», sin forma de
            distinguirlo de una ruta mal configurada.
            No es la defensa: la API responde 403 igual.
          */}
          <Route
            path="/ajustes/marca"
            element={
              esAdmin ? (
                <MarcaPage />
              ) : (
                <SinPermisoAdmin seccion="Marca" yo={yo} cargado={cargadoYo} />
              )
            }
          />
          <Route
            path="/ajustes/clinica"
            element={
              esAdmin ? (
                <ClinicaPage />
              ) : (
                <SinPermisoAdmin seccion="Clínica" yo={yo} cargado={cargadoYo} />
              )
            }
          />
          <Route
            path="/ajustes/equipo"
            element={
              esAdmin ? (
                <EquipoPage />
              ) : (
                <SinPermisoAdmin seccion="Equipo" yo={yo} cargado={cargadoYo} />
              )
            }
          />
          <Route
            path="/admin/dashboard"
            element={
              esAdmin ? (
                <DashboardPage />
              ) : (
                <SinPermisoAdmin seccion="Dashboard" yo={yo} cargado={cargadoYo} />
              )
            }
          />
          {/*
            Atajos de primer nivel para las tres secciones de
            administración. El destino canónico sigue siendo `/ajustes/*`
            —es lo que pinta el menú, lo que reconoce `seccionDe` y lo que
            hay en los enlaces ya repartidos por la aplicación—, pero
            `/clinica`, `/equipo` y `/marca` son las URL que uno teclea, y
            caer en Pacientes al teclearlas era indistinguible de una ruta
            mal configurada.
          */}
          <Route path="/clinica" element={<Navigate to="/ajustes/clinica" replace />} />
          <Route path="/equipo" element={<Navigate to="/ajustes/equipo" replace />} />
          <Route path="/marca" element={<Navigate to="/ajustes/marca" replace />} />
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
