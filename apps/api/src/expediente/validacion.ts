/**
 * Validacion del cuerpo de POST y PUT de snapshots.
 *
 * Las cotas salen del catalogo (metrica_catalogo), no de constantes
 * aqui: anadir una metrica nueva no debe obligar a tocar codigo.
 */

export interface MetricaCatalogo {
  codigo: string
  nombre: string
  unidad: string
  decimales: number
  minPlausible: number | null
  maxPlausible: number | null
}

export interface DatosSnapshot {
  fecha: string
  /** codigo de metrica -> valor. Puede venir vacio. */
  metricas: Record<string, number>
  nota: string | null
}

export interface ErrorCampo {
  campo: string
  mensaje: string
}

export type Validacion =
  | { ok: true; datos: DatosSnapshot }
  | { ok: false; errores: ErrorCampo[] }

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

function fechaValida(iso: string): boolean {
  if (!FECHA_RE.test(iso)) return false
  const [a, m, d] = iso.split('-').map(Number)
  if (a === undefined || m === undefined || d === undefined) return false
  const f = new Date(Date.UTC(a, m - 1, d))
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d
}

export function validarSnapshot(cuerpo: unknown, catalogo: MetricaCatalogo[]): Validacion {
  const errores: ErrorCampo[] = []

  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return { ok: false, errores: [{ campo: '_', mensaje: 'El cuerpo debe ser un objeto JSON' }] }
  }
  const b = cuerpo as Record<string, unknown>

  // --- fecha ---
  const fechaRaw = typeof b['fecha'] === 'string' ? b['fecha'].trim() : ''
  let fecha = ''
  if (!fechaRaw) {
    errores.push({ campo: 'fecha', mensaje: 'La fecha del control es obligatoria' })
  } else if (!fechaValida(fechaRaw)) {
    errores.push({ campo: 'fecha', mensaje: 'Usa el formato AAAA-MM-DD' })
  } else if (fechaRaw > new Date().toISOString().slice(0, 10)) {
    // Un control no puede haber ocurrido en el futuro. Sí puede ser de
    // hace días: la fecha es la CLÍNICA, no la de captura.
    errores.push({ campo: 'fecha', mensaje: 'La fecha del control no puede ser futura' })
  } else {
    fecha = fechaRaw
  }

  // --- metricas ---
  const metricas: Record<string, number> = {}
  const crudas = b['metricas']

  if (crudas !== undefined && crudas !== null) {
    if (typeof crudas !== 'object' || Array.isArray(crudas)) {
      errores.push({ campo: 'metricas', mensaje: 'metricas debe ser un objeto codigo -> valor' })
    } else {
      const porCodigo = new Map(catalogo.map((m) => [m.codigo, m]))

      for (const [codigo, valorRaw] of Object.entries(crudas as Record<string, unknown>)) {
        // Un campo vacío en el formulario significa "no se midió", que
        // no es lo mismo que medir cero. Se omite, no se guarda 0.
        if (valorRaw === null || valorRaw === '' || valorRaw === undefined) continue

        const def = porCodigo.get(codigo)
        if (!def) {
          errores.push({ campo: `metricas.${codigo}`, mensaje: 'Métrica desconocida' })
          continue
        }

        const valor = typeof valorRaw === 'number' ? valorRaw : Number(valorRaw)
        if (!Number.isFinite(valor)) {
          errores.push({ campo: `metricas.${codigo}`, mensaje: `${def.nombre} debe ser un número` })
          continue
        }

        const bajo = def.minPlausible !== null && valor < def.minPlausible
        const alto = def.maxPlausible !== null && valor > def.maxPlausible
        if (bajo || alto) {
          errores.push({
            campo: `metricas.${codigo}`,
            mensaje: `${def.nombre} fuera de rango razonable (${def.minPlausible}–${def.maxPlausible} ${def.unidad}). Revisa el valor.`,
          })
          continue
        }

        metricas[codigo] = valor
      }
    }
  }

  // --- nota ---
  const notaRaw = b['nota']
  const nota = typeof notaRaw === 'string' && notaRaw.trim() !== '' ? notaRaw.trim() : null

  if (errores.length > 0) return { ok: false, errores }

  // Un control sin mediciones es válido: puede ser una consulta de
  // seguimiento en la que solo se conversó.
  return { ok: true, datos: { fecha, metricas, nota } }
}
