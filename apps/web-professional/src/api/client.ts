/**
 * Cliente HTTP de la API.
 *
 * Adjunta el Bearer en cada peticion y refresca el token antes si esta
 * a punto de caducar. El tenant NO viaja aqui: sale del claim tenant_id
 * que la API lee del propio token. Si el front pudiera elegir la
 * clinica, bastaria con cambiar un parametro para leer datos de otra.
 */
import { tokenVigente } from '../auth/keycloak'
import type { ErrorCampo } from './tipos'

const BASE = import.meta.env.VITE_API_URL

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly codigo?: string,
    /** Errores por campo cuando la API responde 400 de validacion. */
    readonly errores?: ErrorCampo[],
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** true cuando el formulario puede marcar campos concretos. */
  get esValidacion(): boolean {
    return this.status === 400 && Array.isArray(this.errores) && this.errores.length > 0
  }
}

function mensajeSegunEstado(status: number, delServidor?: string): string {
  if (status === 401) return 'Tu sesion no es valida. Vuelve a iniciar sesion.'
  if (status === 403) return delServidor ?? 'No tienes permiso para hacer esto.'
  if (status === 404) return delServidor ?? 'No se encontro lo solicitado.'
  if (status === 409) return delServidor ?? 'Ese dato ya existe.'
  if (status === 413) return delServidor ?? 'El archivo es demasiado grande.'
  if (status === 415) return delServidor ?? 'Ese tipo de archivo no se admite.'
  if (status >= 500) return delServidor ?? 'El servidor tuvo un problema. Intentalo de nuevo.'
  return delServidor ?? `Error ${status}`
}

interface Opciones {
  metodo?: 'GET' | 'POST' | 'PUT'
  cuerpo?: unknown
  signal?: AbortSignal
}

async function peticion<T>(ruta: string, opciones: Opciones = {}): Promise<T> {
  const { metodo = 'GET', cuerpo, signal } = opciones
  const token = await tokenVigente()

  const cabeceras: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }
  if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json'

  let respuesta: Response
  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: cabeceras,
      ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
      ...(signal ? { signal } : {}),
    })
  } catch (e) {
    // fetch solo rechaza por fallo de red; un 500 llega como respuesta.
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, `No se pudo contactar con la API en ${BASE}. ¿Esta levantada?`)
  }

  if (respuesta.status === 204) return undefined as T

  if (!respuesta.ok) {
    let codigo: string | undefined
    let mensaje: string | undefined
    let errores: ErrorCampo[] | undefined
    try {
      const cuerpoError = (await respuesta.json()) as {
        error?: string
        message?: string
        errores?: ErrorCampo[]
      }
      codigo = cuerpoError.error
      mensaje = cuerpoError.message
      errores = cuerpoError.errores
    } catch {
      // El cuerpo no era JSON; nos quedamos con el estado HTTP.
    }
    throw new ApiError(
      respuesta.status,
      mensajeSegunEstado(respuesta.status, mensaje),
      codigo,
      errores,
    )
  }

  return (await respuesta.json()) as T
}

export function apiGet<T>(ruta: string, signal?: AbortSignal): Promise<T> {
  return peticion<T>(ruta, signal ? { signal } : {})
}

export function apiPost<T>(ruta: string, cuerpo: unknown, signal?: AbortSignal): Promise<T> {
  return peticion<T>(ruta, { metodo: 'POST', cuerpo, ...(signal ? { signal } : {}) })
}

export function apiPut<T>(ruta: string, cuerpo: unknown, signal?: AbortSignal): Promise<T> {
  return peticion<T>(ruta, { metodo: 'PUT', cuerpo, ...(signal ? { signal } : {}) })
}

/**
 * Descarga un archivo protegido y dispara el guardado en el navegador.
 *
 * No se puede usar un <a href> normal: la API exige la cabecera
 * Authorization y un enlace no la envía — respondería 401. Hay que
 * pedir el blob y crear una URL temporal, que se revoca enseguida para
 * no retener el archivo en memoria.
 */
export async function apiDescargar(ruta: string, nombreSugerido: string): Promise<void> {
  const token = await tokenVigente()
  const respuesta = await fetch(`${BASE}${ruta}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!respuesta.ok) {
    throw new ApiError(respuesta.status, mensajeSegunEstado(respuesta.status))
  }

  const blob = await respuesta.blob()
  const url = URL.createObjectURL(blob)
  try {
    const enlace = document.createElement('a')
    enlace.href = url
    enlace.download = nombreSugerido
    document.body.appendChild(enlace)
    enlace.click()
    enlace.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Subida multipart.
 *
 * NO se fija Content-Type a mano: el navegador tiene que añadirlo con
 * el `boundary` que él genera. Escribirlo rompe la petición de una
 * forma que el servidor reporta como "no multipart".
 */
export async function apiUpload<T>(ruta: string, archivo: File): Promise<T> {
  const token = await tokenVigente()
  const datos = new FormData()
  datos.append('archivo', archivo)

  let respuesta: Response
  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      body: datos,
    })
  } catch {
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
      /* cuerpo no JSON */
    }
    throw new ApiError(
      respuesta.status,
      mensajeSegunEstado(respuesta.status, mensaje),
      codigo,
    )
  }

  return (await respuesta.json()) as T
}
