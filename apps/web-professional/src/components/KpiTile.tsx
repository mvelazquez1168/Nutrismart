/**
 * Cifra grande con etiqueta, icono y tinte, para el dashboard (CLI-08).
 *
 * Dos reglas gobiernan el color aquí:
 *
 *  1. **El tono sale de los tokens, no de la escala de Tailwind.** Un
 *     `bg-blue-50` fijo ignora el white-label de la Rebanada 6: la
 *     clínica cambia su marca y la tarjeta sigue azul.
 *
 *  2. **La cifra NO se tiñe.** El número va en color de texto normal y
 *     el icono es el que lleva el tono. Teñir el número parece más
 *     vistoso y es justo lo que lo vuelve ilegible: el ámbar de la
 *     paleta de datos da 2.17:1 contra blanco, muy por debajo del
 *     mínimo para texto. El color acompaña; el dato se lee.
 */
import type { CSSProperties, ReactNode } from 'react'

/**
 * Tonos disponibles, todos anclados a un token.
 *
 * Los tres primeros son ESTADO —significan bien, mal y en espera— y
 * llevan los mismos tokens que el resto de la aplicación usa para eso:
 * el chip "Completada" de la agenda, que está en esta misma pantalla,
 * es exactamente el mismo verde. Que dos elementos de la misma página
 * usaran verdes distintos para lo mismo sería el defecto.
 *
 * Los `dato-*` son la paleta categórica del design system, validada e
 * independiente de la marca. Se usan para métricas que no significan
 * bien ni mal: un recuento de pacientes no es bueno ni malo.
 */
export type TonoKpi =
  | 'marca'
  | 'normal'
  | 'critico'
  | 'espera'
  | 'dato-1'
  | 'dato-2'
  | 'dato-3'
  | 'dato-4'

const TOKEN: Record<TonoKpi, string> = {
  marca: 'var(--primary)',
  normal: 'var(--status-normal)',
  critico: 'var(--status-critical)',
  espera: 'var(--status-alert)',
  'dato-1': 'var(--chart-1)',
  'dato-2': 'var(--chart-2)',
  'dato-3': 'var(--chart-3)',
  'dato-4': 'var(--chart-4)',
}

export function KpiTile({
  etiqueta,
  valor,
  secundario,
  icono,
  tono = 'marca',
  cargando = false,
}: {
  etiqueta: string
  valor: number
  secundario?: string | undefined
  icono?: ReactNode
  tono?: TonoKpi
  cargando?: boolean
}) {
  if (cargando) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5">
        <div className="h-3 w-20 animate-pulse rounded bg-surface-2" />
        <div className="h-8 w-14 animate-pulse rounded bg-surface-2" />
      </div>
    )
  }

  return (
    <div
      className="tile-kpi flex flex-col gap-1 rounded-lg border p-5"
      style={{ '--tono-kpi': TOKEN[tono] } as CSSProperties}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-muted">{etiqueta}</span>
        {/*
          Decorativo: la etiqueta de al lado ya dice qué es. Marcarlo
          como imagen haría que el lector de pantalla leyera un icono
          sin nombre entre el texto y la cifra.
        */}
        {icono && (
          <span aria-hidden="true" className="tile-kpi__icono shrink-0">
            {icono}
          </span>
        )}
      </div>

      {/* tabular-nums: sin ello un 1 ocupa menos que un 8 y la fila de
          cifras baila al cambiar de período. */}
      <span className="text-3xl font-bold tabular-nums text-ink">
        {valor.toLocaleString('es-CR')}
      </span>

      {secundario && <span className="text-xs text-muted">{secundario}</span>}
    </div>
  )
}
