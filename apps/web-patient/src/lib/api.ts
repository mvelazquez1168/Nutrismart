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
  if (resto.body !== undefined) cabeceras['Content-Type'] = 'application/json'

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

  // 204 no trae cuerpo: intentar parsearlo lanzaría.
  if (respuesta.status === 204) return undefined as T
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

/* ---- PAC-03 · Mensajería ---- */

export interface Conversacion {
  id: string
  profesional: string
  mensajesSinLeer: number
}

export interface Mensaje {
  id: string
  autorTipo: 'profesional' | 'paciente'
  contenido: string
  leido: boolean
  createdAt: string
}

export function getConversacion(): Promise<Conversacion> {
  return pedir<Conversacion>('/api/paciente/conversacion', { conAuth: true })
}

/** `desde` filtra por marca de tiempo: se le pasa el createdAt del último. */
export function getMensajes(desde?: string): Promise<Mensaje[]> {
  const q = desde ? `?desde=${encodeURIComponent(desde)}` : ''
  return pedir<Mensaje[]>(`/api/paciente/conversacion/mensajes${q}`, { conAuth: true })
}

export function enviarMensaje(contenido: string): Promise<Mensaje> {
  return pedir<Mensaje>('/api/paciente/conversacion/mensajes', {
    method: 'POST',
    conAuth: true,
    body: JSON.stringify({ contenido }),
  })
}

/* ---- PAC-04 · Plan y acuerdos ---- */

export interface AcuerdoPaciente {
  index: number
  texto: string
  /** Lo que marcó el profesional en consulta. */
  cumplidoProfesional: boolean
  /** Lo que reporta el paciente desde la app. */
  cumplidoPaciente: boolean
  registradoEn: string | null
  notaPaciente: string | null
}

export interface PlanPaciente {
  consultaId: string
  numeroConsulta: number
  fecha: string
  profesional: string | null
  kcal: number | null
  pctProteina: number | null
  pctCho: number | null
  pctGrasa: number | null
  proteinaG: number | null
  choG: number | null
  grasaG: number | null
  restricciones: string[]
  suplementos: string | null
  acuerdos: AcuerdoPaciente[]
}

export function getPlan(): Promise<{ plan: PlanPaciente | null; mensaje?: string }> {
  return pedir('/api/paciente/plan', { conAuth: true })
}

export function cumplirAcuerdo(
  consultaId: string,
  index: number,
  cumplido: boolean,
): Promise<{ cumplido: boolean; registradoEn: string }> {
  return pedir(`/api/paciente/acuerdos/${consultaId}/${index}/cumplir`, {
    method: 'POST',
    conAuth: true,
    body: JSON.stringify({ cumplido }),
  })
}

/* ---- AGE-02 · Agenda del paciente ---- */

export interface CitaPaciente {
  id: string
  inicio: string
  duracionMinutos: number
  tipo: string
  estado: 'programada' | 'confirmada' | 'completada' | 'cancelada' | 'no_asistio'
  motivo: string | null
  profesional: string | null
}

export interface AgendaPaciente {
  proxima: CitaPaciente | null
  siguientes: CitaPaciente[]
  historial: CitaPaciente[]
}

export function getCitasPaciente(): Promise<AgendaPaciente> {
  return pedir<AgendaPaciente>('/api/paciente/citas', { conAuth: true })
}

export function confirmarCita(id: string): Promise<{ id: string; estado: string }> {
  return pedir(`/api/paciente/citas/${id}/confirmar`, { method: 'PATCH', conAuth: true })
}

/* ---- Diario de comidas y métricas ---- */

export const FRANJAS = [
  { clave: 'desayuno', etiqueta: 'Desayuno' },
  { clave: 'media_manana', etiqueta: 'Media mañana' },
  { clave: 'almuerzo', etiqueta: 'Almuerzo' },
  { clave: 'merienda', etiqueta: 'Merienda' },
  { clave: 'cena', etiqueta: 'Cena' },
  { clave: 'extra', etiqueta: 'Otro' },
] as const

export type Franja = (typeof FRANJAS)[number]['clave']

export interface Comida {
  id: string
  tipoComida: Franja
  descripcion: string
  kcal: number | null
  proteinaG: number | null
  choG: number | null
  grasaG: number | null
  actualizadoEn: string
}

export interface Diario {
  fecha: string
  registros: Comida[]
  totales: {
    kcal: number
    proteinaG: number
    choG: number
    grasaG: number
    /** Comidas apuntadas sin calorías: el total no las incluye. */
    sinEstimar: number
  }
  objetivo: {
    kcal: number | null
    proteinaG: number | null
    choG: number | null
    grasaG: number | null
  } | null
}

export interface DiaSemana {
  fecha: string
  kcal: number
  comidas: number
}

export type TipoMetrica = 'peso' | 'presion_arterial' | 'glucosa' | 'otro'

export interface Metrica {
  id: string
  tipo: TipoMetrica
  valor: number | null
  sistolica: number | null
  diastolica: number | null
  unidad: string
  nota: string | null
  medidoEn: string
}

export function getDiario(fecha?: string): Promise<Diario> {
  const q = fecha ? `?fecha=${encodeURIComponent(fecha)}` : ''
  return pedir<Diario>(`/api/paciente/diario${q}`, { conAuth: true })
}

export function guardarComida(datos: {
  tipoComida: Franja
  descripcion: string
  fecha?: string
  kcal?: number | null
}): Promise<Comida> {
  return pedir('/api/paciente/diario', {
    method: 'POST',
    conAuth: true,
    body: JSON.stringify(datos),
  })
}

export async function borrarComida(id: string): Promise<void> {
  await pedir<unknown>(`/api/paciente/diario/${id}`, { method: 'DELETE', conAuth: true })
}

export function getSemanaDiario(dias = 7): Promise<DiaSemana[]> {
  return pedir<DiaSemana[]>(`/api/paciente/diario/semana?dias=${dias}`, { conAuth: true })
}

export function getMetricas(tipo?: TipoMetrica, limite = 30): Promise<Metrica[]> {
  const q = new URLSearchParams({ limite: String(limite) })
  if (tipo) q.set('tipo', tipo)
  return pedir<Metrica[]>(`/api/paciente/metricas?${q.toString()}`, { conAuth: true })
}

export function guardarMetrica(datos: {
  tipo: TipoMetrica
  valor?: number
  sistolica?: number
  diastolica?: number
  nota?: string
}): Promise<Metrica> {
  return pedir('/api/paciente/metricas', {
    method: 'POST',
    conAuth: true,
    body: JSON.stringify(datos),
  })
}

/* ---- Progreso y tareas ---- */

export interface Progreso {
  meses: number
  meta: { pesoObjetivo: number | null; fechaObjetivo: string | null; kcalObjetivo: number | null }
  avance: {
    pesoInicial: number
    pesoActual: number
    objetivo: number
    recorrido: number
    restante: number
    pctCompletado: number
  } | null
  /** Serie medida en consulta: la que cuenta contra la meta. */
  pesoEnConsulta: { fecha: string; pesoKg: number }[]
  /** Promedio semanal de lo que el paciente se pesa en casa. */
  pesoEnCasa: { semana: string; promedio: number; lecturas: number }[]
  calorias: { semana: string; kcalDia: number | null; diasConRegistro: number }[]
  otrasMetricas: {
    tipo: string
    valor: number | null
    sistolica: number | null
    diastolica: number | null
    unidad: string
    medidoEn: string
  }[]
}

export interface Tarea {
  id: string
  titulo: string
  descripcion: string | null
  fechaLimite: string | null
  prioridad: 'alta' | 'normal' | 'baja'
  estado: 'pendiente' | 'completada' | 'archivada'
  completadaEn: string | null
  createdAt: string
  profesional: string | null
}

export function getProgreso(meses = 6): Promise<Progreso> {
  return pedir<Progreso>(`/api/paciente/progreso?meses=${meses}`, { conAuth: true })
}

export function getTareas(soloPendientes = false): Promise<Tarea[]> {
  const q = soloPendientes ? '?estado=pendiente' : ''
  return pedir<Tarea[]>(`/api/paciente/tareas${q}`, { conAuth: true })
}

export function marcarTarea(id: string, completada: boolean): Promise<Tarea> {
  return pedir(`/api/paciente/tareas/${id}`, {
    method: 'PATCH',
    conAuth: true,
    body: JSON.stringify({ completada }),
  })
}
