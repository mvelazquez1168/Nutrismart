import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Activar } from './pages/Activar'
import { Inicio } from './pages/Inicio'
import { Mensajes } from './pages/Mensajes'
import { Plan } from './pages/Plan'
import { Citas } from './pages/Citas'
import { Registros } from './pages/Registros'
import { Progreso } from './pages/Progreso'
import { Biblioteca, RecursoDetalle } from './pages/Biblioteca'
import { Perfil } from './pages/Perfil'
import { Dispositivos } from './pages/Dispositivos'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/activar" element={<Activar />} />
        <Route path="/inicio" element={<Inicio />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/citas" element={<Citas />} />
        <Route path="/registros" element={<Registros />} />
        <Route path="/progreso" element={<Progreso />} />
        <Route path="/biblioteca" element={<Biblioteca />} />
        <Route path="/biblioteca/:id" element={<RecursoDetalle />} />
        <Route path="/perfil" element={<Perfil />} />
        <Route path="/dispositivos" element={<Dispositivos />} />
        <Route path="/mensajes" element={<Mensajes />} />
        {/* Cualquier otra ruta va a /activar: si ya hay sesion, esa
            pantalla redirige sola a /inicio. */}
        <Route path="*" element={<Navigate to="/activar" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
