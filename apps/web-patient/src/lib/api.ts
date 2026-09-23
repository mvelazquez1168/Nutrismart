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

/* ------------------------------------------------------------------ */
/* PAC-07 — contador de porciones                                      */
/* ------------------------------------------------------------------ */

export type ModoDiario = 'simple' | 'detallado'

export interface Alimento {
  id: string
  nombre: string
  categoria: string
  kcalPor100g: number
  proteinaPor100g: number
  choPor100g: number
  grasaPor100g: number
  porcionTipicaG: number
  unidadPorcion: 'g' | 'ml' | 'pza'
  propio: boolean
}

export interface ItemComida {
  id: string
  alimentoId: string | null
  nombre: string
  cantidadG: number
  kcal: number | null
  proteinaG: number | null
  choG: number | null
  grasaG: number | null
  apuntadoEn: string
}

export function getModoDiario(): Promise<{ modoDiario: ModoDiario }> {
  return pedir('/api/paciente/configuracion', { conAuth: true })
}

export function setModoDiario(modoDiario: ModoDiario): Promise<{ modoDiario: ModoDiario }> {
  return pedir('/api/paciente/configuracion', {
    method: 'PATCH',
    conAuth: true,
    body: JSON.stringify({ modoDiario }),
  })
}

export function buscarAlimentos(q: string, categoria?: string): Promise<Alimento[]> {
  const p = new URLSearchParams()
  if (q.trim() !== '') p.set('q', q.trim())
  if (categoria) p.set('categoria', categoria)
  const cola = p.toString()
  return pedir(`/api/paciente/alimentos${cola ? `?${cola}` : ''}`, { conAuth: true })
}

export function getItems(registroId: string): Promise<ItemComida[]> {
  return pedir(`/api/paciente/diario/${registroId}/items`, { conAuth: true })
}

export function anadirItem(datos: {
  fecha: string
  tipoComida: Franja
  alimentoId?: string
  nombre?: string
  cantidadG: number
}): Promise<ItemComida & { registroId: string }> {
  return pedir('/api/paciente/diario/items', {
    method: 'POST',
    conAuth: true,
    body: JSON.stringify(datos),
  })
}

export async function quitarItem(registroId: string, itemId: string): Promise<void> {
  await pedir(`/api/paciente/diario/${registroId}/items/${itemId}`, {
    method: 'DELETE',
    conAuth: true,
  })
}

/* ------------------------------------------------------------------ */
/* PAC-08 — biblioteca                                                 */
/* ------------------------------------------------------------------ */

export const CATEGORIAS_RECURSO = [
  { clave: 'nutricion', etiqueta: 'Nutrición' },
  { clave: 'recetas', etiqueta: 'Recetas' },
  { clave: 'ejercicio', etiqueta: 'Ejercicio' },
  { clave: 'habitos', etiqueta: 'Hábitos' },
  { clave: 'otro', etiqueta: 'Otros' },
] as const

export type TipoRecurso = 'texto' | 'enlace' | 'archivo'

export interface RecursoResumen {
  id: string
  titulo: string
  resumen: string | null
  categoria: string
  tipo: TipoRecurso
  imagenPortadaUrl: string | null
  urlExterna: string | null
  tieneArchivo: boolean
  autor: string
  publicadoEn: string
  leido: boolean
}

export interface Recurso extends Omit<RecursoResumen, 'leido' | 'tieneArchivo'> {
  contenido: string | null
  archivo: { nombre: string; mime: string; tamanoBytes: number } | null
}

/**
 * Descarga el archivo de un recurso.
 *
 * No sirve un `<a href>`: la API exige la cabecera Authorization y un
 * enlace normal no la envía. Se pide con fetch y se entrega al navegador
 * como descarga.
 */
export async function descargarArchivoRecurso(id: string, nombre: string): Promise<void> {
  const token = await tokenVigente()
  const r = await fetch(`${BASE}/api/paciente/recursos/${id}/archivo`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) throw new ApiError(r.status, 'No se pudo descargar el archivo')
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Sin esto el blob se queda en memoria hasta recargar la página.
  URL.revokeObjectURL(url)
}

export function getRecursos(
  categoria?: string,
  pagina = 1,
): Promise<{ pagina: number; total: number; hayMas: boolean; recursos: RecursoResumen[] }> {
  const p = new URLSearchParams({ pagina: String(pagina) })
  if (categoria) p.set('categoria', categoria)
  return pedir(`/api/paciente/recursos?${p.toString()}`, { conAuth: true })
}

export function getRecurso(id: string): Promise<Recurso> {
  return pedir(`/api/paciente/recursos/${id}`, { conAuth: true })
}

/* ------------------------------------------------------------------ */
/* PAC-09 — perfil y fondo                                             */
/* ------------------------------------------------------------------ */

export interface Perfil {
  modoDiario: ModoDiario
  fondo: 'neutro' | 'verde' | 'azul' | 'morado' | 'salmon' | 'cafe' | 'noche'
  fotoUrl: string | null
  /** El que se muestra: el preferido si lo hay, si no el del expediente. */
  nombre: string
  nombrePreferido: string | null
  /** El del expediente clínico. No lo cambia el paciente. */
  nombreExpediente: string
}

export function getPerfil(): Promise<Perfil> {
  return pedir('/api/paciente/configuracion', { conAuth: true })
}

export function guardarFondo(fondo: Perfil['fondo']): Promise<{ fondo: Perfil['fondo'] }> {
  return pedir('/api/paciente/configuracion', {
    method: 'PATCH',
    conAuth: true,
    body: JSON.stringify({ fondo }),
  })
}

export function guardarPerfil(datos: {
  fotoUrl?: string | null
  nombrePreferido?: string | null
}): Promise<{ fotoUrl: string | null; nombrePreferido: string | null }> {
  return pedir('/api/paciente/perfil', {
    method: 'PATCH',
    conAuth: true,
    body: JSON.stringify(datos),
  })
}

/* ------------------------------------------------------------------ */
/* RPM-01 — bienestar y medidas corporales                             */
/* ------------------------------------------------------------------ */

/**
 * Cinco escalones, no diez. Pedirle a alguien que distinga su ánimo
 * entre un 6 y un 7 produce un número inventado; cinco se contestan sin
 * pensar, que es la única forma de que se conteste todos los días.
 */
export const ESTADOS_BIENESTAR = [
  { valor: 1, etiqueta: 'Muy mal', cara: '😞' },
  { valor: 2, etiqueta: 'Mal', cara: '🙁' },
  { valor: 3, etiqueta: 'Regular', cara: '😐' },
  { valor: 4, etiqueta: 'Bien', cara: '🙂' },
  { valor: 5, etiqueta: 'Excelente', cara: '😄' },
] as const

export const SINTOMAS_ETIQUETA: Record<string, string> = {
  dolor_cabeza: 'Dolor de cabeza',
  fatiga: 'Cansancio',
  insomnio: 'Dormí mal',
  ansiedad: 'Ansiedad',
  estres: 'Estrés',
  hinchazon: 'Hinchazón',
  estrenimiento: 'Estreñimiento',
  diarrea: 'Diarrea',
  acidez: 'Acidez',
  nauseas: 'Náuseas',
  antojos: 'Antojos',
  mareo: 'Mareo',
  dolor_muscular: 'Dolor muscular',
}

export interface ParteBienestar {
  fecha: string
  estado: number
  sintomas: string[]
  nota: string | null
}

export interface Bienestar {
  dias: number
  hoy: string
  partes: ParteBienestar[]
  racha: number
  sintomasPosibles: string[]
}

export function getBienestar(dias = 30): Promise<Bienestar> {
  return pedir(`/api/paciente/bienestar?dias=${dias}`, { conAuth: true })
}

export function guardarBienestar(datos: {
  estado: number
  sintomas?: string[]
  nota?: string
  fecha?: string
}): Promise<ParteBienestar> {
  return pedir('/api/paciente/bienestar', {
    method: 'PUT',
    conAuth: true,
    body: JSON.stringify(datos),
  })
}

export const MEDIDAS_CUERPO = [
  { clave: 'cinturaCm', etiqueta: 'Cintura' },
  { clave: 'caderaCm', etiqueta: 'Cadera' },
  { clave: 'pechoCm', etiqueta: 'Pecho' },
  { clave: 'brazoCm', etiqueta: 'Brazo' },
  { clave: 'musloCm', etiqueta: 'Muslo' },
  { clave: 'cuelloCm', etiqueta: 'Cuello' },
] as const

export type ClaveMedida = (typeof MEDIDAS_CUERPO)[number]['clave']

export type MedidaCorporal = { fecha: string; nota: string | null } & {
  [K in ClaveMedida]: number | null
}

export interface Cambio {
  primero: number
  ultimo: number
  delta: number
}

export interface MedidasCorporales {
  dias: number
  registros: MedidaCorporal[]
  cambios: Record<ClaveMedida, Cambio | null>
}

export function getMedidasCorporales(dias = 180): Promise<MedidasCorporales> {
  return pedir(`/api/paciente/medidas-corporales?dias=${dias}`, { conAuth: true })
}

export function guardarMedidasCorporales(
  datos: Partial<Record<ClaveMedida, number>> & { fecha?: string; nota?: string },
): Promise<MedidaCorporal> {
  return pedir('/api/paciente/medidas-corporales', {
    method: 'PUT',
    conAuth: true,
    body: JSON.stringify(datos),
  })
}

/* ------------------------------------------------------------------ */
/* RPM-01 — pulseras y relojes                                         */
/* ------------------------------------------------------------------ */

export interface EstadoWearable {
  proveedor: 'fitbit' | 'google_fit' | 'withings'
  etiqueta: string
  /** Que datos aporta, para poder elegir entre bascula y pulsera. */
  queTrae: string
  /** `false` = este servidor no ofrece ese proveedor. Distinto de «no conectado». */
  disponible: boolean
  motivoNoDisponible: string | null
  conectado: boolean
  ultimoSync: string | null
  ultimoError: string | null
  lecturas: number
}

export function getWearables(): Promise<EstadoWearable[]> {
  return pedir('/api/paciente/wearables', { conAuth: true })
}

export function conectarWearable(proveedor: string): Promise<{ url: string }> {
  return pedir(`/api/paciente/wearables/${proveedor}/conectar`, {
    method: 'POST',
    conAuth: true,
  })
}

export function sincronizarWearable(
  proveedor: string,
): Promise<{ nuevas: number; dias: number }> {
  return pedir(`/api/paciente/wearables/${proveedor}/sincronizar`, {
    method: 'POST',
    conAuth: true,
  })
}

export async function desconectarWearable(proveedor: string): Promise<void> {
  await pedir(`/api/paciente/wearables/${proveedor}`, { method: 'DELETE', conAuth: true })
}
