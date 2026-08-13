/**
 * Cifra grande con etiqueta, para el dashboard (CLI-08).
 *
 * Los colores salen de los tokens (`bg-surface`, `text-ink`, `text-muted`)
 * y no de la escala gris de Tailwind: un `bg-white` fijo ignora el
 * white-label de la Rebanada 6 y se queda blanco cuando la clínica
 * cambia su tema.
 *
 * `tabular-nums` alinea las cifras entre tiles: sin ello, un 1 ocupa
 * menos que un 8 y la fila de números baila al cambiar de período.
 */
export function KpiTile({
  etiqueta,
  valor,
  secundario,
  claseColor = 'text-ink',
  cargando = false,
}: {
  etiqueta: string
  valor: number
  secundario?: string | undefined
  /** Solo para resaltar; el valor por defecto es el color de texto normal. */
  claseColor?: string
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
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-5 shadow-sm">
      <span className="text-sm text-muted">{etiqueta}</span>
      <span className={`text-3xl font-bold tabular-nums ${claseColor}`}>
        {valor.toLocaleString('es-CR')}
      </span>
      {secundario && <span className="text-xs text-muted">{secundario}</span>}
    </div>
  )
}
