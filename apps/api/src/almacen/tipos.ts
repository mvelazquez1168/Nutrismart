/**
 * Contrato del almacen de archivos.
 *
 * El codigo de negocio habla SOLO con esta interfaz. La implementacion
 * de hoy escribe en un volumen; la de manana hablara con S3, y el
 * cambio no debe tocar rutas, repositorios ni migraciones: `rutaRelativa`
 * es opaca y solo el almacen sabe interpretarla.
 */

export interface ArchivoGuardado {
  /** Identificador interno del almacen. Nunca se muestra al usuario. */
  rutaRelativa: string
  sha256: string
  tamanoBytes: number
  /** Tipo REAL detectado por contenido, no el declarado por el cliente. */
  mime: string
}

export interface AlmacenArchivos {
  guardar(clinicaId: string, contenido: Buffer, mime: string): Promise<ArchivoGuardado>
  leer(rutaRelativa: string): Promise<Buffer>
  /** Para deshacer una subida cuyo registro en base fallo despues. */
  eliminar(rutaRelativa: string): Promise<void>
}

/** El almacen no encontro el archivo referenciado por la base. */
export class ArchivoNoEncontradoError extends Error {}

/**
 * La ruta pedida se sale del directorio del almacen. No deberia ocurrir
 * nunca —las rutas las genera el propio almacen— pero un error de
 * programacion o una fila manipulada no pueden convertirse en lectura
 * arbitraria del sistema de ficheros.
 */
export class RutaFueraDelAlmacenError extends Error {}
