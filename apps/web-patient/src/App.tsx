import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Activar } from './pages/Activar'
import { Inicio } from './pages/Inicio'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/activar" element={<Activar />} />
        <Route path="/inicio" element={<Inicio />} />
        {/* Cualquier otra ruta va a /activar: si ya hay sesion, esa
            pantalla redirige sola a /inicio. */}
        <Route path="*" element={<Navigate to="/activar" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
