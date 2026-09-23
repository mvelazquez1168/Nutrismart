/**
 * Foto del paciente, o sus iniciales — PAC-09.
 *
 * Si la foto no carga —la dirección caducó, no hay red, el servidor la
 * bloquea— se cae a las iniciales en vez de dejar el icono roto del
 * navegador. Es una URL externa: que algún día falle no es la excepción.
 */
import { useEffect, useState } from 'react'

const TAMANOS = {
  sm: 'h-9 w-9 text-xs',
  md: 'h-12 w-12 text-sm',
  lg: 'h-20 w-20 text-xl',
} as const

/** Dos iniciales como mucho; una si el nombre es de una sola palabra. */
function inicialesDe(nombre: string): string {
  const p = nombre.trim().split(/\s+/).filter(Boolean)
  if (p.length === 0) return '?'
  if (p.length === 1) return (p[0] ?? '').slice(0, 2).toUpperCase()
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase()
}

export function Avatar({
  nombre,
  fotoUrl,
  size = 'md',
}: {
  nombre: string
  fotoUrl?: string | null
  size?: keyof typeof TAMANOS
}) {
  const [falla, setFalla] = useState(false)

  // Si cambia la foto hay que volver a intentarlo: si no, una dirección
  // corregida seguiría mostrando las iniciales.
  useEffect(() => setFalla(false), [fotoUrl])

  const base = `${TAMANOS[size]} shrink-0 rounded-pill object-cover`

  if (fotoUrl && !falla) {
    return (
      <img
        src={fotoUrl}
        alt=""
        onError={() => setFalla(true)}
        className={`${base} border border-border bg-surface-2`}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={`${base} flex items-center justify-center bg-primary font-semibold text-white`}
    >
      {inicialesDe(nombre)}
    </span>
  )
}
