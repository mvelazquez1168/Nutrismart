/**
 * Quién es el paciente, en un círculo — PAC-09, ampliado en R53.
 *
 * Tres niveles, en este orden:
 *
 *   1. Su foto, si subió una.
 *   2. Su avatar ilustrado, construido en la pantalla de perfil.
 *   3. Sus iniciales, si no hay ninguna de las dos cosas.
 *
 * El tercer nivel no es solo el caso de «no ha elegido nada»: también es
 * la red de seguridad de la foto. Es una URL externa y que algún día
 * falle —caducó, no hay red, el servidor la bloquea— no es la excepción.
 * Cayendo al avatar o a las iniciales nunca se ve el icono roto del
 * navegador.
 */
import { useEffect, useState } from 'react'
import { CaraSVG } from './perfil/CaraSVG'
import { configSegura, type ConfigAvatarBruta } from './perfil/avatar'

const TAMANOS = {
  sm: 'h-9 w-9 text-xs',
  md: 'h-12 w-12 text-sm',
  lg: 'h-20 w-20 text-xl',
  // 104 px: el tamaño del previo del constructor de avatar (R53). Va en
  // valor arbitrario porque Tailwind salta de 96 a 112 y ninguno de los
  // dos deja el círculo centrado con el anillo de `--primary-tint`.
  xl: 'h-[104px] w-[104px] text-2xl',
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
  avatar,
  size = 'md',
}: {
  nombre: string
  fotoUrl?: string | null
  /** Los campos `avatar_*` del perfil. Sin ellos se cae a iniciales. */
  avatar?: ConfigAvatarBruta | null
  size?: keyof typeof TAMANOS
}) {
  const [falla, setFalla] = useState(false)

  // Si cambia la foto hay que volver a intentarlo: si no, una dirección
  // corregida seguiría mostrando lo de debajo.
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

  if (avatar) {
    return <CaraSVG config={configSegura(avatar)} className={`${base} block`} />
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
