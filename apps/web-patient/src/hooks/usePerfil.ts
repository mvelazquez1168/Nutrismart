/**
 * El perfil del paciente, compartido por toda la app — PAC-09.
 *
 * Se guarda a nivel de módulo y no en el estado de cada componente. Sin
 * esto, la cabecera de Inicio, el avatar de la barra y la pantalla de
 * perfil pedirían lo mismo tres veces, y al cambiar el fondo unas se
 * enterarían y otras no.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  getPerfil,
  guardarFondo,
  guardarPerfil,
  type Perfil,
} from '../lib/api'
import { aplicarFondo, type Fondo } from '../lib/temas'

let cache: Perfil | null = null
let cargando: Promise<Perfil> | null = null
const suscriptores = new Set<(p: Perfil) => void>()

function publicar(p: Perfil): void {
  cache = p
  aplicarFondo(p.fondo)
  for (const s of suscriptores) s(p)
}

/** Una sola petición aunque monten tres componentes a la vez. */
function cargar(): Promise<Perfil> {
  cargando ??= getPerfil().then((p) => {
    publicar(p)
    return p
  })
  return cargando
}

export function usePerfil() {
  const [perfil, setPerfil] = useState<Perfil | null>(cache)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    suscriptores.add(setPerfil)
    if (!cache) {
      cargar().catch(() => setError('No hemos podido cargar tu perfil'))
    }
    return () => {
      suscriptores.delete(setPerfil)
    }
  }, [])

  /**
   * El fondo se pinta ANTES de que conteste el servidor.
   *
   * Es una preferencia visual: esperar medio segundo a que viaje la
   * petición hace que el selector parezca roto. Si falla, se vuelve al
   * anterior.
   */
  const cambiarFondo = useCallback(
    async (fondo: Fondo) => {
      const previo = cache
      if (previo) publicar({ ...previo, fondo })
      try {
        const r = await guardarFondo(fondo)
        if (cache) publicar({ ...cache, fondo: r.fondo })
      } catch (e) {
        if (previo) publicar(previo)
        throw e
      }
    },
    [],
  )

  const cambiarPerfil = useCallback(
    async (datos: { fotoUrl?: string | null; nombrePreferido?: string | null }) => {
      const r = await guardarPerfil(datos)
      if (cache) {
        publicar({
          ...cache,
          fotoUrl: r.fotoUrl,
          nombrePreferido: r.nombrePreferido,
          nombre: r.nombrePreferido ?? cache.nombreExpediente,
        })
      }
    },
    [],
  )

  return { perfil, error, cambiarFondo, cambiarPerfil }
}
