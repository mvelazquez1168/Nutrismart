/** Cliente de API de la app del paciente. */
import { tokenVigente } from './keycloak'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4001'

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

async function pedir<T>(ruta: string, opciones: RequestInit & { conAuth: boolean }): Promise<T> {
  const { conAuth, ...resto } = opciones
  const cabeceras: Record<string, string> = { Accept: 'application/json' }
  if (conAuth) cabeceras['Authorization'] = `Bearer ${await tokenVigente()}`

  let respuesta: Response
  try {
    respuesta = await fetch(`${BASE}${ruta}`, { ...resto, headers: cabeceras })
  } catch {
    throw new ApiError(0, 'No hay conexión con el servidor. Revisa tu red.')
  }

  if (!respuesta.ok) {
    let mensaje = 'Algo no ha salido bien'
    let codigo: string | undefined
    try {
      const cuerpo = (await respuesta.json()) as { error?: string; message?: string }
      mensaje = cuerpo.message ?? mensaje
      codigo = cuerpo.error
    } catch {
      /* el cuerpo no era JSON: nos quedamos con el estado */
    }
    throw new ApiError(respuesta.status, mensaje, codigo)
  }

  return (await respuesta.json()) as T
}

export interface InfoInvitacion {
  nombrePaciente: string
  nombreClinica: string
  expiraEn: string
}

export interface Yo {
  id: string
  nombre: string
  correo: string | null
  telefono: string | null
  fechaNacimiento: string | null
  sexo: string | null
  clinica: { nombre: string; colorPrimario: string | null; tieneLogo: boolean }
}

export interface Dashboard {
  pesoActual: { pesoKg: number; fecha: string } | null
  historialPeso: { pesoKg: number; fecha: string }[]
  proximaCita: {
    inicio: string
    duracionMinutos: number | null
    tipo: string | null
    profesional: string | null
  } | null
  plan: {
    kcal: number | null
    pctProteina: number | null
    pctCho: number | null
    pctGrasa: number | null
    proteinaG: number | null
    choG: number | null
    grasaG: number | null
    fecha: string
  } | null
  acuerdos: { texto: string; cumplido: boolean }[]
  mensajesSinLeer: number
}

/** Pública: el paciente aún no tiene cuenta cuando la llama. */
export function getInvitacion(token: string): Promise<InfoInvitacion> {
  return pedir<InfoInvitacion>(`/api/invitacion/${encodeURIComponent(token)}`, { conAuth: false })
}

export function vincular(token: string): Promise<{ mensaje: string }> {
  return pedir(`/api/invitacion/${encodeURIComponent(token)}/vincular`, {
    method: 'POST',
    conAuth: true,
  })
}

export function getYo(): Promise<Yo> {
  return pedir<Yo>('/api/paciente/yo', { conAuth: true })
}

export function getDashboard(): Promise<Dashboard> {
  return pedir<Dashboard>('/api/paciente/dashboard', { conAuth: true })
}
