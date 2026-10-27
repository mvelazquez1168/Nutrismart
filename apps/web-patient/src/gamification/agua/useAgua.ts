/**
 * El agua del día — R55.
 *
 * Pide el estado al montar y expone un `registrarMl` que suma.
 *
 * ── El total lo manda SIEMPRE el servidor ───────────────────────────
 *
 * `registrarMl` no hace `registrado + ml` por su cuenta: usa el total
 * que devuelve el POST. La suma la hace la base en la propia sentencia
 * (`ml_total = ml_total + $n`), y es la única cifra que vale si la
 * persona tiene la app abierta en el móvil y en otro sitio. Sumar aquí
 * también daría dos números distintos en cuanto hubiera dos pestañas.
 */
import { useCallback, useEffect, useState } from 'react'
import { getAguaHoy, registrarAgua, type AguaHoy } from '../../lib/api'

export interface EstadoAgua {
  /** Mililitros al día que indicó el profesional. `null` = no la fijó. */
  meta: number | null
  /** Lo que lleva bebido hoy. Siempre un número; 0 si no ha apuntado nada. */
  registrado: number
  /** 0–100, acotado. `0` cuando no hay meta: no hay nada contra qué medir. */
  pct: number
  cargando: boolean
  /** Null salvo que algo haya fallado; la pantalla decide si lo enseña. */
  error: string | null
  registrarMl: (ml: number) => Promise<void>
}

function porcentaje(registrado: number, meta: number | null): number {
  if (!meta || meta <= 0) return 0
  // Se recorta al 100: la botella no puede llenarse más que del todo, y
  // pasarse de la meta no es un error que haya que señalar.
  return Math.min(100, Math.round((registrado / meta) * 100))
}

export function useAgua(): EstadoAgua {
  const [datos, setDatos] = useState<AguaHoy | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    getAguaHoy()
      .then((d) => {
        if (vivo) setDatos(d)
      })
      .catch(() => {
        if (vivo) setError('No pudimos cargar tu agua de hoy.')
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [])

  const registrarMl = useCallback(async (ml: number) => {
    setError(null)
    try {
      setDatos(await registrarAgua(ml))
    } catch {
      setError('No se pudo apuntar. Inténtalo otra vez.')
    }
  }, [])

  const registrado = datos?.registradoHoyMl ?? 0
  const meta = datos?.metaMl ?? null

  return {
    meta,
    registrado,
    pct: porcentaje(registrado, meta),
    cargando,
    error,
    registrarMl,
  }
}
