/**
 * Cabecera Content-Disposition para descargas.
 *
 * Vive aparte porque la usan dos rutas —archivos clínicos y exportación
 * de expediente— y es una defensa: duplicarla es cómo una de las dos
 * copias acaba sin la parte que sanea.
 */

/**
 * Construye la cabecera sin dejar que el nombre inyecte otra.
 *
 * Se emiten las dos formas: `filename` con un ASCII saneado para
 * clientes antiguos, y `filename*` en UTF-8 para que "Informe
 * glucémico.pdf" conserve su tilde. El saneado elimina todo lo que no
 * sea ASCII imprimible —lo que de paso descarta CR y LF, los caracteres
 * con los que se parte una cabecera— y las comillas.
 */
export function cabeceraDescarga(nombre: string): string {
  const ascii = nombre.replace(/[^\x20-\x7E]/g, '_').replace(/["\\;]/g, '_') || 'archivo'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`
}

/**
 * Recorta y limpia un nombre de archivo propuesto.
 *
 * Los separadores de ruta se sustituyen: un nombre solo describe el
 * archivo, nunca dónde vive.
 */
export function nombreArchivoSeguro(nombre: string, maximo = 120): string {
  const limpio = nombre
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[/\\]/g, '-')
    .trim()
  return limpio.slice(0, maximo) || 'documento'
}
