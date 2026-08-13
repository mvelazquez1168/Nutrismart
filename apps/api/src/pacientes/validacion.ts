/**
 * Validacion del cuerpo de POST y PUT /api/pacientes.
 *
 * Se valida ANTES de tocar la base por dos motivos: los mensajes de
 * Postgres no sirven para un formulario (un valor fuera de un enum da
 * un 500 opaco), y se devuelven TODOS los errores juntos en vez de uno
 * por peticion, para que el formulario los marque de una vez.
 */

export const DOCUMENTO_TIPOS = ['cedula', 'dimex', 'pasaporte', 'nite'] as const
export type DocumentoTipo = (typeof DOCUMENTO_TIPOS)[number]

export const SEXOS_BIOLOGICOS = ['masculino', 'femenino', 'intersexual'] as const
export type SexoBiologico = (typeof SEXOS_BIOLOGICOS)[number]

export interface DatosPaciente {
  nombre: string
  documentoTipo: DocumentoTipo | null
  documentoNumero: string | null
  fechaNacimiento: string | null
  sexoBiologico: SexoBiologico | null
  telefono: string | null
  correo: string | null
  motivoConsulta: string | null
  diagnosticos: string[]
  alergias: string[]
}

export interface ErrorCampo {
  campo: string
  mensaje: string
}

export type Validacion =
  | { ok: true; datos: DatosPaciente }
  | { ok: false; errores: ErrorCampo[] }

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

/** Recorta y convierte la cadena vacia en null. */
function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const t = valor.trim()
  return t === '' ? null : t
}

/**
 * Normaliza una lista de chips: recorta, descarta vacios y quita
 * repetidos sin distinguir mayusculas, conservando la primera grafia
 * que escribio el profesional.
 */
function listaTexto(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []

  const vistos = new Set<string>()
  const salida: string[] = []

  for (const item of valor) {
    const t = texto(item)
    if (!t) continue
    const clave = t.toLowerCase()
    if (vistos.has(clave)) continue
    vistos.add(clave)
    salida.push(t)
  }
  return salida
}

/** Comprueba que la fecha exista de verdad: 2026-02-30 encaja con el patron pero no existe. */
function fechaValida(iso: string): boolean {
  if (!FECHA_RE.test(iso)) return false

  const [a, m, d] = iso.split('-').map(Number)
  if (a === undefined || m === undefined || d === undefined) return false

  const fecha = new Date(Date.UTC(a, m - 1, d))
  return (
    fecha.getUTCFullYear() === a && fecha.getUTCMonth() === m - 1 && fecha.getUTCDate() === d
  )
}

export function validarPaciente(cuerpo: unknown): Validacion {
  const errores: ErrorCampo[] = []

  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return { ok: false, errores: [{ campo: '_', mensaje: 'El cuerpo debe ser un objeto JSON' }] }
  }
  const b = cuerpo as Record<string, unknown>

  // --- nombre ---
  const nombre = texto(b['nombre'])
  if (!nombre) {
    errores.push({ campo: 'nombre', mensaje: 'El nombre es obligatorio' })
  } else if (nombre.length > 200) {
    errores.push({ campo: 'nombre', mensaje: 'El nombre no puede pasar de 200 caracteres' })
  }

  // --- documento ---
  const documentoTipoRaw = texto(b['documentoTipo'])
  let documentoTipo: DocumentoTipo | null = null
  if (documentoTipoRaw) {
    if ((DOCUMENTO_TIPOS as readonly string[]).includes(documentoTipoRaw)) {
      documentoTipo = documentoTipoRaw as DocumentoTipo
    } else {
      errores.push({
        campo: 'documentoTipo',
        mensaje: `Debe ser uno de: ${DOCUMENTO_TIPOS.join(', ')}`,
      })
    }
  }

  // Vacio se guarda como NULL, nunca como cadena vacia: en Postgres dos
  // NULL no colisionan en un unique, pero dos cadenas vacias SI. Sin
  // esto, el segundo paciente sin documento chocaria con el primero.
  const documentoNumero = texto(b['documentoNumero'])

  if (documentoNumero && !documentoTipo) {
    errores.push({
      campo: 'documentoTipo',
      mensaje: 'Indica el tipo de documento si escribes un número',
    })
  }

  // --- fecha de nacimiento ---
  const fechaRaw = texto(b['fechaNacimiento'])
  let fechaNacimiento: string | null = null
  if (fechaRaw) {
    if (!fechaValida(fechaRaw)) {
      errores.push({ campo: 'fechaNacimiento', mensaje: 'Usa el formato AAAA-MM-DD' })
    } else {
      const hoy = new Date().toISOString().slice(0, 10)
      if (fechaRaw > hoy) {
        errores.push({ campo: 'fechaNacimiento', mensaje: 'No puede estar en el futuro' })
      } else if (Number(fechaRaw.slice(0, 4)) < new Date().getUTCFullYear() - 130) {
        errores.push({ campo: 'fechaNacimiento', mensaje: 'La fecha parece incorrecta' })
      } else {
        fechaNacimiento = fechaRaw
      }
    }
  }

  // --- sexo biologico ---
  const sexoRaw = texto(b['sexoBiologico'])
  let sexoBiologico: SexoBiologico | null = null
  if (sexoRaw) {
    if ((SEXOS_BIOLOGICOS as readonly string[]).includes(sexoRaw)) {
      sexoBiologico = sexoRaw as SexoBiologico
    } else {
      errores.push({
        campo: 'sexoBiologico',
        mensaje: `Debe ser uno de: ${SEXOS_BIOLOGICOS.join(', ')}`,
      })
    }
  }

  // --- correo ---
  const correo = texto(b['correo'])
  if (correo && !CORREO_RE.test(correo)) {
    errores.push({ campo: 'correo', mensaje: 'El correo no tiene un formato válido' })
  }

  // --- listas ---
  const diagnosticos = listaTexto(b['diagnosticos'])
  const alergias = listaTexto(b['alergias'])

  // Regla de negocio de docs/REBANADA-02.md: las alergias son
  // obligatorias. "Ninguna" es una respuesta valida y explicita; un
  // campo vacio es una respuesta que nadie dio, y en un dato de
  // seguridad clinica esa diferencia importa.
  if (alergias.length === 0) {
    errores.push({
      campo: 'alergias',
      mensaje: 'Indica las alergias del paciente o marca "Ninguna"',
    })
  }

  if (errores.length > 0) return { ok: false, errores }

  return {
    ok: true,
    datos: {
      nombre: nombre as string,
      documentoTipo,
      documentoNumero,
      fechaNacimiento,
      sexoBiologico,
      telefono: texto(b['telefono']),
      correo,
      motivoConsulta: texto(b['motivoConsulta']),
      diagnosticos,
      alergias,
    },
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Un :id malformado no puede existir. Se comprueba antes de la query
 * porque pasarselo a Postgres como uuid provoca un error de casteo
 * (500) en lugar del 404 que corresponde.
 */
export function esUuid(valor: string): boolean {
  return UUID_RE.test(valor)
}
