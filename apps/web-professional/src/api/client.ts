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

/**
 * Origen de la API. Lo necesita cualquier recurso que el navegador
 * cargue por si mismo —un <img src>, por ejemplo—, donde no hay
 * peticion que interceptar y la ruta relativa apuntaria al front.
 */
export const API_BASE: string = BASE

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly codigo?: string,
    /** Errores por campo cuando la API responde 400 de validacion. */
    readonly errores?: ErrorCampo[],
    /** Subtipo del fallo. Lo usan los 503 de IA para explicar la causa. */
    readonly tipo?: string,
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
  metodo?: 'GET' | 'POST' | 'PUT' | 'DELETE'
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
    let tipo: string | undefined
    try {
      const cuerpoError = (await respuesta.json()) as {
        error?: string
        message?: string
        errores?: ErrorCampo[]
        tipo?: string
      }
      codigo = cuerpoError.error
      mensaje = cuerpoError.message
      errores = cuerpoError.errores
      tipo = cuerpoError.tipo
    } catch {
      // El cuerpo no era JSON; nos quedamos con el estado HTTP.
    }
    throw new ApiError(
      respuesta.status,
      mensajeSegunEstado(respuesta.status, mensaje),
      codigo,
      errores,
      tipo,
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

export function apiDelete<T = void>(ruta: string, signal?: AbortSignal): Promise<T> {
  return peticion<T>(ruta, { metodo: 'DELETE', ...(signal ? { signal } : {}) })
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
 * Envía un cuerpo JSON y descarga la respuesta como archivo.
 *
 * No sirve `apiDescargar`: aquel es un GET, y aquí el servidor necesita
 * saber qué secciones incluir antes de poder generar nada. Tampoco vale
 * un enlace: la API exige la cabecera Authorization y un `<a href>` no
 * la envía.
 *
 * El nombre sale del `Content-Disposition` que manda el servidor; el
 * parámetro es solo el respaldo si esa cabecera no llega.
 */
export async function apiDescargarPost(
  ruta: string,
  cuerpo: unknown,
  nombreRespaldo: string,
): Promise<{ nombre: string; tipo: string | null }> {
  const token = await tokenVigente()

  let respuesta: Response
  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cuerpo),
    })
  } catch {
    throw new ApiError(0, `No se pudo contactar con la API en ${BASE}. ¿Esta levantada?`)
  }

  if (!respuesta.ok) {
    let mensaje: string | undefined
    let codigo: string | undefined
    try {
      const error = (await respuesta.json()) as { error?: string; message?: string }
      codigo = error.error
      mensaje = error.message
    } catch {
      /* el cuerpo no era JSON */
    }
    throw new ApiError(respuesta.status, mensajeSegunEstado(respuesta.status, mensaje), codigo)
  }

  const disposicion = respuesta.headers.get('Content-Disposition') ?? ''
  const coincidencia = disposicion.match(/filename="([^"]+)"/)
  const nombre = coincidencia?.[1] ?? nombreRespaldo

  const blob = await respuesta.blob()
  const url = URL.createObjectURL(blob)
  try {
    const enlace = document.createElement('a')
    enlace.href = url
    enlace.download = nombre
    document.body.appendChild(enlace)
    enlace.click()
    enlace.remove()
  } finally {
    URL.revokeObjectURL(url)
  }

  return { nombre, tipo: respuesta.headers.get('X-Formato-Exportacion') }
}

/**
 * Subida multipart.
 *
 * NO se fija Content-Type a mano: el navegador tiene que añadirlo con
 * el `boundary` que él genera. Escribirlo rompe la petición de una
 * forma que el servidor reporta como "no multipart".
 */
export async function apiUpload<T>(
  ruta: string,
  archivo: File,
  opciones: { metodo?: 'POST' | 'PUT'; campo?: string } = {},
): Promise<T> {
  const { metodo = 'POST', campo = 'archivo' } = opciones
  const token = await tokenVigente()
  const datos = new FormData()
  datos.append(campo, archivo)

  let respuesta: Response
  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      method: metodo,
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
