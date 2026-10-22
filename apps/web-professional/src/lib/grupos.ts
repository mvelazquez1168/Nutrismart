/**
 * Los grupos de analitos: su nombre y su orden — R49.
 *
 * ## Por qué el grupo viaja en código y no ya escrito
 *
 * Hasta R49 la columna `biomarcador.grupo` guardaba la etiqueta tal cual se
 * leía («Perfil lipídico»), y el catálogo nuevo la nombra en código
 * (`perfil_lipidico`). Conviviendo, la pantalla habría mostrado las dos como
 * grupos DISTINTOS y el perfil lipídico habría salido partido en dos
 * pestañas. La migración 053 normalizó los catorce originales a código, y lo
 * que el profesional lee lo pone esta función.
 *
 * Es además lo que permite ordenar por criterio clínico sin que el orden
 * dependa del alfabeto del idioma.
 */

const NOMBRES: Record<string, string> = {
  hematologia: 'Hematología',
  perfil_lipidico: 'Perfil Lipídico',
  perfil_glucemico: 'Glucémico',
  tiroides: 'Tiroides',
  funcion_hepatica: 'Función Hepática',
  funcion_renal: 'Función Renal',
  electrolitos: 'Electrolitos',
  hormonas: 'Hormonas',
  vitaminas: 'Vitaminas',
  inflamacion: 'Inflamación',
  inmunologia: 'Inmunología',
}

/**
 * El orden en que se recorren los grupos en una consulta.
 *
 * No es alfabético ni el de la base: es el orden en que un informe de
 * laboratorio los imprime y en que el profesional los repasa. Un grupo que no
 * esté aquí —uno propio de la clínica, cuando exista esa pantalla— va al
 * final, no se esconde.
 */
export const ORDEN_GRUPOS = [
  'hematologia',
  'perfil_lipidico',
  'perfil_glucemico',
  'tiroides',
  'funcion_hepatica',
  'funcion_renal',
  'electrolitos',
  'hormonas',
  'vitaminas',
  'inflamacion',
  'inmunologia',
] as const

/** El nombre legible de un grupo. Uno desconocido se capitaliza y ya. */
export function formatGrupo(grupo: string): string {
  const conocido = NOMBRES[grupo]
  if (conocido) return conocido
  const limpio = grupo.replace(/_/g, ' ').trim()
  return limpio.charAt(0).toUpperCase() + limpio.slice(1)
}

/** Ordena una lista de códigos de grupo por el criterio clínico de arriba. */
export function ordenarGrupos(grupos: string[]): string[] {
  const peso = (g: string) => {
    const i = (ORDEN_GRUPOS as readonly string[]).indexOf(g)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return [...grupos].sort((a, b) => peso(a) - peso(b) || a.localeCompare(b, 'es'))
}
