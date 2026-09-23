/**
 * Cifrado de los tokens OAuth de wearables — RPM-01.
 *
 * ── Por qué se cifran ───────────────────────────────────────────────
 *
 * Un `access_token` de Fitbit da acceso de lectura al historial de salud
 * completo de una persona: pulso, sueño, actividad, peso. Guardado en
 * claro, una copia de la base de datos —o un volcado hecho para
 * depurar— entrega ese acceso a quien la tenga, sin que el paciente se
 * entere ni pueda revocarlo.
 *
 * AES-256-GCM y no CBC: GCM además AUTENTICA. Si alguien altera un byte
 * del texto cifrado, el descifrado falla en vez de devolver basura que
 * el resto del código trataría como un token.
 *
 * ── Por qué falla al USARSE y no al cargarse ────────────────────────
 *
 * El encargo comprobaba la clave a nivel de módulo y lanzaba si faltaba.
 * Importar este archivo desde cualquier ruta habría impedido arrancar la
 * API entera cuando la integración no está configurada — y con ella el
 * acceso a expedientes y agenda. La regla de oro del proyecto dice justo
 * lo contrario: lo accesorio no bloquea lo clínico.
 *
 * El formato de la clave sí se valida al arrancar, en `config.ts`: una
 * clave mal copiada es peor que ninguna.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { config } from '../config.js'

const ALGORITMO = 'aes-256-gcm'
/** 96 bits es el tamaño recomendado para el vector de GCM. */
const BYTES_IV = 12
const BYTES_TAG = 16

export class CifradoNoConfigurado extends Error {
  constructor() {
    super('Falta WEARABLE_ENCRYPTION_KEY: la conexión con dispositivos está desactivada')
  }
}

function clave(): Buffer {
  const hex = config.wearables.claveCifrado
  if (!hex) throw new CifradoNoConfigurado()
  return Buffer.from(hex, 'hex')
}

/** Devuelve `iv + tag + cifrado` en base64, todo en una cadena. */
export function cifrar(texto: string): string {
  const iv = randomBytes(BYTES_IV)
  const cifrador = createCipheriv(ALGORITMO, clave(), iv)
  const cuerpo = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()])
  return Buffer.concat([iv, cifrador.getAuthTag(), cuerpo]).toString('base64')
}

export function descifrar(guardado: string): string {
  const buf = Buffer.from(guardado, 'base64')
  // Una cadena más corta que iv+tag no puede ser válida: sin esta
  // comprobación, `subarray` devolvería buffers vacíos y el error
  // llegaría más adelante, disfrazado.
  if (buf.length <= BYTES_IV + BYTES_TAG) {
    throw new Error('El token guardado está incompleto')
  }
  const iv = buf.subarray(0, BYTES_IV)
  const tag = buf.subarray(BYTES_IV, BYTES_IV + BYTES_TAG)
  const cuerpo = buf.subarray(BYTES_IV + BYTES_TAG)

  const descifrador = createDecipheriv(ALGORITMO, clave(), iv)
  descifrador.setAuthTag(tag)
  return Buffer.concat([descifrador.update(cuerpo), descifrador.final()]).toString('utf8')
}
