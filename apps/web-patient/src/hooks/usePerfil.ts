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
import { initKeycloak } from '../lib/keycloak'
import { aplicarFondo, type Fondo } from '../lib/temas'

let cache: Perfil | null = null
let cargando: Promise<Perfil> | null = null
const suscriptores = new Set<(p: Perfil) => void>()

function publicar(p: Perfil): void {
  cache = p
  aplicarFondo(p.fondo)
  for (const s of suscriptores) s(p)
}

/**
 * Una sola petición aunque monten tres componentes a la vez.
 *
 * ## La causa del spinner infinito — R47
 *
 * **Se espera a `initKeycloak()` antes de pedir nada.** Este hook vive en
 * `NavBar`, que monta en TODAS las pantallas; cada pantalla, por su parte,
 * inicializa Keycloak en su propio `useEffect`. Las dos cosas arrancaban a la
 * vez, así que el perfil salía a pedirse mientras Keycloak todavía no estaba
 * listo: `tokenVigente()` llama a `updateToken()`, que sin inicializar
 * **lanza**, y la petición moría antes de salir.
 *
 * Era una carrera, y por eso no fallaba siempre: en una máquina rápida o con
 * la sesión caliente, Keycloak ganaba. Cuando perdía, `perfil` se quedaba en
 * null para siempre y la pantalla giraba sin decir nada.
 *
 * ## Y si aun así falla, la promesa se suelta
 *
 * Antes se quedaba guardada en `cargando`, de modo que el primer fallo
 * envenenaba la caché: cada montaje posterior recibía la MISMA promesa ya
 * rechazada, sin volver a pedir nada. No se arreglaba ni navegando a otra
 * sección y volviendo — solo recargando la aplicación entera.
 */
function cargar(): Promise<Perfil> {
  cargando ??= initKeycloak()
    .then(() => getPerfil())
    .then((p) => {
      publicar(p)
      return p
    })
    .catch((e) => {
      cargando = null
      throw e
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

  /** Volver a intentarlo después de un fallo, sin recargar la aplicación. */
  const reintentar = useCallback(() => {
    setError(null)
    cargar().catch(() => setError('No hemos podido cargar tu perfil'))
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

  return { perfil, error, reintentar, cambiarFondo, cambiarPerfil }
}
