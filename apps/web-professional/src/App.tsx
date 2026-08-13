import { useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { Shell } from './components/Shell'
import { Pacientes } from './pages/Pacientes'
import { PacienteFicha } from './pages/PacienteFicha'
import { getMe } from './api/pacientes'
import type { Me } from './api/tipos'

function Centrado({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <div className="max-w-md text-center">{children}</div>
    </div>
  )
}

function Contenido() {
  const { estado, error } = useAuth()
  const [me, setMe] = useState<Me | null>(null)
  const [errorMe, setErrorMe] = useState<string | null>(null)

  useEffect(() => {
    if (estado !== 'autenticado') return

    const ctrl = new AbortController()
    getMe(ctrl.signal)
      .then(setMe)
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        setErrorMe(e instanceof Error ? e.message : 'No se pudo cargar el perfil')
      })
    return () => ctrl.abort()
  }, [estado])

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

  return (
    <Shell seccionActiva="pacientes" nombreClinica={me?.clinica.nombre ?? null}>
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
        {/* Cualquier otra ruta cae en Pacientes: es la unica seccion
            construida, y una pantalla de 404 aqui seria ruido. */}
        <Route path="*" element={<Navigate to="/pacientes" replace />} />
      </Routes>
    </Shell>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Contenido />
      </AuthProvider>
    </BrowserRouter>
  )
}
