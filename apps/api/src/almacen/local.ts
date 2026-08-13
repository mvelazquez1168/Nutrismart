/**
 * Almacen en disco, sobre un volumen de Docker.
 *
 * Estructura: <base>/<clinica_id>/<anio>/<mes>/<uuid><ext>
 *
 * El nombre original NO participa en la ruta. Se conserva como
 * metadato en la base para mostrarlo y para la descarga, pero un
 * nombre con '../', con caracteres de control o de 300 caracteres no
 * llega jamas al sistema de ficheros.
 *
 * La particion por clinica no es solo orden: hace que un fallo de
 * aislamiento sea visible al mirar el disco.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import {
  ArchivoNoEncontradoError,
  RutaFueraDelAlmacenError,
  type AlmacenArchivos,
  type ArchivoGuardado,
} from './tipos.js'
import { EXTENSION, type TipoPermitido } from './deteccion.js'

export class AlmacenLocal implements AlmacenArchivos {
  constructor(private readonly base: string) {}

  /**
   * Convierte una ruta relativa en absoluta comprobando que NO se sale
   * del almacen.
   *
   * Las rutas las genera esta misma clase, asi que en teoria siempre
   * son seguras. La comprobacion existe para que un error de
   * programacion o una fila manipulada no se conviertan en lectura
   * arbitraria del disco: es barata y cierra la clase de fallo entera.
   */
  private absoluta(rutaRelativa: string): string {
    const raiz = resolve(this.base)
    const destino = resolve(raiz, rutaRelativa)

    if (destino !== raiz && !destino.startsWith(raiz + sep)) {
      throw new RutaFueraDelAlmacenError(`Ruta fuera del almacen: ${rutaRelativa}`)
    }
    return destino
  }

  async guardar(
    clinicaId: string,
    contenido: Buffer,
    mime: string,
  ): Promise<ArchivoGuardado> {
    const ahora = new Date()
    const anio = ahora.getUTCFullYear()
    const mes = String(ahora.getUTCMonth() + 1).padStart(2, '0')

    // La extension sale del tipo DETECTADO, no del nombre que envio el
    // cliente: es lo unico que sabemos que es cierto sobre el archivo.
    const extension = EXTENSION[mime as TipoPermitido] ?? '.bin'
    const rutaRelativa = `${clinicaId}/${anio}/${mes}/${randomUUID()}${extension}`

    const destino = this.absoluta(rutaRelativa)
    await mkdir(dirname(destino), { recursive: true })
    await writeFile(destino, contenido)

    return {
      rutaRelativa,
      sha256: createHash('sha256').update(contenido).digest('hex'),
      tamanoBytes: contenido.byteLength,
      mime,
    }
  }

  async leer(rutaRelativa: string): Promise<Buffer> {
    try {
      return await readFile(this.absoluta(rutaRelativa))
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        throw new ArchivoNoEncontradoError(rutaRelativa)
      }
      throw error
    }
  }

  async eliminar(rutaRelativa: string): Promise<void> {
    try {
      await unlink(this.absoluta(rutaRelativa))
    } catch (error) {
      // Borrar algo que ya no esta no es un fallo: esta funcion se usa
      // para deshacer una subida cuyo registro en base fallo.
      if ((error as { code?: string }).code !== 'ENOENT') throw error
    }
  }

  /** Solo para diagnostico y pruebas. */
  rutaAbsolutaDe(rutaRelativa: string): string {
    return join(resolve(this.base), rutaRelativa)
  }
}
