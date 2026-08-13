/** Avatar de iniciales, como en disenos/CLI/pacientes-lista-nutrismart.png */

function iniciales(nombre: string): string {
  const partes = nombre
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0)

  if (partes.length === 0) return '?'
  if (partes.length === 1) return (partes[0] ?? '').slice(0, 2).toUpperCase()

  const primera = partes[0]?.[0] ?? ''
  const segunda = partes[1]?.[0] ?? ''
  return (primera + segunda).toUpperCase()
}

export function Avatar({ nombre }: { nombre: string }) {
  return (
    <span
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-primary-tint text-xs font-semibold text-primary"
      aria-hidden="true"
    >
      {iniciales(nombre)}
    </span>
  )
}
