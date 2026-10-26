import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { aplicarPaletaCacheada } from './lib/palette'
import './index.css'

/**
 * El color del paciente, antes de pintar nada — R53.
 *
 * Va aquí y no dentro de un componente porque el perfil tarda en llegar:
 * si se esperase, la app arrancaría verde y daría un salto de color en
 * cuanto contestara el servidor. Con la última elección en localStorage
 * se abre ya del color correcto, y cuando llega el perfil se confirma
 * (o se corrige, si cambió desde otro teléfono).
 */
aplicarPaletaCacheada()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
