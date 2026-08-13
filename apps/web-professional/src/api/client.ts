/**
 * Cliente HTTP de la API.
 *
 * Adjunta el Bearer en cada peticion y refresca el token antes si esta a
 * punto de caducar. El tenant NO viaja aqui: sale del claim tenant_id que
 * la API lee del propio token. Si el front pudiera elegir la clinica,
 * bastaria con cambiar un parametro para leer datos de otra.
 */
import { tokenVigente } from '../auth/keycloak'

const BASE = import.meta.env.VITE_API_URL

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly codigo?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function mensajeSegunEstado(status: number, delServidor?: string): string {
  if (status === 401) return 'Tu sesion no es valida. Vuelve a iniciar sesion.'
  if (status === 403) return 'No tienes permiso para ver esto.'
  if (status === 404) return delServidor ?? 'No se encontro lo solicitado.'
  if (status >= 500) return 'El servidor tuvo un problema. Intentalo de nuevo.'
  return delServidor ?? `Error ${status}`
}

export async function apiGet<T>(ruta: string, signal?: AbortSignal): Promise<T> {
  const token = await tokenVigente()

  let respuesta: Response
  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    })
  } catch (e) {
    // fetch solo rechaza por fallo de red; un 500 llega como respuesta.
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, `No se pudo contactar con la API en ${BASE}. ¿Esta levantada?`)
  }

  if (!respuesta.ok) {
    let codigo: string | undefined
    let mensaje: string | undefined
    try {
      const cuerpo = (await respuesta.json()) as { error?: string; message?: string }
      codigo = cuerpo.error
      mensaje = cuerpo.message
    } catch {
      // El cuerpo no era JSON; nos quedamos con el estado HTTP.
    }
    throw new ApiError(respuesta.status, mensajeSegunEstado(respuesta.status, mensaje), codigo)
  }

  return (await respuesta.json()) as T
}
