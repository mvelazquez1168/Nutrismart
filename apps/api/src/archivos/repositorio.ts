/**
 * Metadatos de archivos. Los binarios viven en el almacen.
 */
import { pool } from '../db.js'

export interface ArchivoMeta {
  id: string
  nombreOriginal: string
  mime: string
  tamanoBytes: number
  sha256: string
  rutaRelativa: string
}

interface Fila {
  id: string
  nombre_original: string
  mime: string
  tamano_bytes: string
  sha256: string
  ruta_relativa: string
}

function aMeta(f: Fila): ArchivoMeta {
  return {
    id: f.id,
    nombreOriginal: f.nombre_original,
    mime: f.mime,
    // bigint llega como string desde pg.
    tamanoBytes: Number(f.tamano_bytes),
    sha256: f.sha256,
    rutaRelativa: f.ruta_relativa,
  }
}

export async function registrarArchivo(
  tenantId: string,
  profesionalId: string | null,
  datos: {
    nombreOriginal: string
    mime: string
    tamanoBytes: number
    sha256: string
    rutaRelativa: string
  },
): Promise<ArchivoMeta> {
  const { rows } = await pool.query<Fila>(
    `insert into archivo
       (clinica_id, nombre_original, mime, tamano_bytes, sha256, ruta_relativa, subido_por)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, nombre_original, mime, tamano_bytes, sha256, ruta_relativa`,
    [
      tenantId,
      datos.nombreOriginal,
      datos.mime,
      datos.tamanoBytes,
      datos.sha256,
      datos.rutaRelativa,
      profesionalId,
    ],
  )
  const f = rows[0]
  if (!f) throw new Error('El insert de archivo no devolvio fila')
  return aMeta(f)
}

/**
 * Un archivo es visible si:
 *   · quien pregunta es administrador de la clinica, o
 *   · lo subio esa misma persona (caso de un adjunto recien subido que
 *     aun no se ha enlazado a ningun estudio), o
 *   · cuelga de un estudio de un paciente que esa persona puede ver.
 *
 * Sin la tercera condicion, un nutricionista con el id de un archivo
 * podria descargar el informe de laboratorio de un paciente ajeno: la
 * tabla `archivo` no sabe de quien es el documento, solo el estudio que
 * lo referencia lo sabe.
 */
export async function obtenerArchivo(
  tenantId: string,
  restringirA: string | null,
  archivoId: string,
): Promise<ArchivoMeta | null> {
  const { rows } = await pool.query<Fila>(
    `select a.id, a.nombre_original, a.mime, a.tamano_bytes, a.sha256, a.ruta_relativa
     from archivo a
     where a.id = $1
       and a.clinica_id = $2
       and (
         $3::uuid is null
         or a.subido_por = $3
         or exists (
           select 1
           from lab_estudio e
           join paciente p on p.id = e.paciente_id
           where e.archivo_id = a.id
             and p.nutricionista_id = $3
         )
       )
     limit 1`,
    [archivoId, tenantId, restringirA],
  )
  return rows[0] ? aMeta(rows[0]) : null
}
