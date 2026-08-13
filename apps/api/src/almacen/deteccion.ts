/**
 * Deteccion del tipo de archivo POR CONTENIDO.
 *
 * Ni la extension ni la cabecera Content-Type del cliente son
 * evidencia: las controla quien sube el archivo. Un .pdf puede ser un
 * HTML con <script>, y si se sirviera desde nuestro origen seria XSS
 * con la sesion del profesional ya iniciada.
 *
 * Lo que se guarda como `mime` es SIEMPRE lo detectado aqui.
 */

export const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024 // 10 MB

/**
 * Lista blanca. Todo lo que no este aqui se rechaza, en vez de una
 * lista negra que siempre va por detras de lo que hay que bloquear.
 *
 * SVG queda FUERA a proposito pese a ser una imagen: admite <script>
 * embebido, asi que es HTML disfrazado.
 */
export const TIPOS_PERMITIDOS = [
  'application/pdf',
  'text/csv',
  'image/png',
  'image/jpeg',
] as const

export type TipoPermitido = (typeof TIPOS_PERMITIDOS)[number]

/** Extension canonica, derivada del tipo DETECTADO y nunca del nombre original. */
export const EXTENSION: Record<TipoPermitido, string> = {
  'application/pdf': '.pdf',
  'text/csv': '.csv',
  'image/png': '.png',
  'image/jpeg': '.jpg',
}

interface Firma {
  mime: TipoPermitido
  bytes: number[]
}

const FIRMAS: Firma[] = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
]

function coincideFirma(buffer: Buffer, firma: Firma): boolean {
  if (buffer.length < firma.bytes.length) return false
  return firma.bytes.every((b, i) => buffer[i] === b)
}

/**
 * Un CSV no tiene firma: es texto plano, y ningun byte inicial lo
 * distingue de cualquier otro texto. Asi que no se "detecta", se
 * DESCARTA que sea binario y se comprueba que sea texto legible.
 *
 * Se rechaza si trae bytes nulos o de control (senal de binario
 * disfrazado) o si no decodifica como UTF-8.
 */
function pareceTextoPlano(buffer: Buffer): boolean {
  if (buffer.length === 0) return false

  const muestra = buffer.subarray(0, Math.min(buffer.length, 8192))

  for (const byte of muestra) {
    if (byte === 0x00) return false
    // Permitidos: tabulador (09), salto (0A), retorno (0D).
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return false
  }

  // Ida y vuelta por UTF-8: si la decodificacion mete caracteres de
  // reemplazo, el contenido no era UTF-8 valido.
  const texto = muestra.toString('utf8')
  return !texto.includes('�')
}

/**
 * Devuelve el tipo real, o null si no es ninguno de los permitidos.
 *
 * `declarado` solo se usa para desempatar entre texto plano y CSV: el
 * contenido no puede distinguirlos, pero tampoco importa — ambos se
 * guardan y se sirven igual, como descarga.
 */
export function detectarTipo(buffer: Buffer, declarado?: string): TipoPermitido | null {
  for (const firma of FIRMAS) {
    if (coincideFirma(buffer, firma)) return firma.mime
  }

  if (pareceTextoPlano(buffer)) {
    // Un HTML es texto plano valido. Se acepta como text/csv porque se
    // servira SIEMPRE como descarga y nunca se interpretara, pero se
    // rechaza si se declara como HTML para no dar pie a confusion.
    if (declarado && /html|xml|svg/i.test(declarado)) return null
    return 'text/csv'
  }

  return null
}
