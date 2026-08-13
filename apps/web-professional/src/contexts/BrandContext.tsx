/**
 * Identidad visual de la clínica (CLI-06).
 *
 * Escribe los tokens del design system en :root. NO define un juego de
 * variables propio: `tokens.css` ya declara --primary/--primary-hover/
 * --primary-tint/--ring, y el preset de Tailwind mapea bg-primary,
 * text-primary, border-primary… contra ellas. Toda la app —cada botón,
 * cada badge, cada estado activo del menú— ya sigue esas variables.
 *
 * Inventar --color-primary aquí habría creado un segundo sistema de
 * color que nadie consume: la pantalla de ajustes mostraría el cambio
 * en su vista previa y el resto de la aplicación seguiría igual.
 *
 * Los ESTADOS CLÍNICOS (--status-*) y los COLORES DE GRÁFICA no se
 * tocan: se leen como semáforo y re-tematizarlos por clínica haría que
 * "alerta" significase un color distinto en cada instalación.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { apiGet } from '../api/client'

export interface Brand {
  nombreApp: string
  /** Ruta relativa a la API, o null. Usa `urlLogo()` para pintarla. */
  logoUrl: string | null
  colorPrimario: string
  colorAcento: string
  tieneLogo: boolean
  /** Cambia con cada guardado; sirve para invalidar la caché del logo. */
  version: string
}

/** Mismos valores que tokens.css y que los DEFAULTS de la API. */
const BRAND_DEFAULTS: Brand = {
  nombreApp: 'NutriSmart',
  logoUrl: null,
  colorPrimario: '#0E7C66',
  colorAcento: '#0EA5E9',
  tieneLogo: false,
  version: 'defaults',
}

interface BrandContextValue {
  brand: Brand
  cargando: boolean
  refrescar: () => Promise<void>
}

const BrandContext = createContext<BrandContextValue>({
  brand: BRAND_DEFAULTS,
  cargando: false,
  refrescar: async () => {},
})

export function useBrand(): BrandContextValue {
  return useContext(BrandContext)
}

export function BrandProvider({
  children,
  clinicaId,
}: {
  children: ReactNode
  clinicaId: string | null | undefined
}) {
  const [brand, setBrand] = useState<Brand>(BRAND_DEFAULTS)
  const [cargando, setCargando] = useState(false)

  const cargar = useCallback(async () => {
    if (!clinicaId) return
    setCargando(true)
    try {
      const datos = await apiGet<Brand>(`/api/brand?clinica=${encodeURIComponent(clinicaId)}`)
      setBrand(datos)
      aplicarTokens(datos)
      document.title = `${datos.nombreApp} · Panel profesional`
    } catch {
      // La marca no es funcionalidad clínica: si falla, la app se ve
      // con los colores por defecto y todo lo demás sigue trabajando.
      // Bloquear la pantalla por no poder pintar un logo sería absurdo.
    } finally {
      setCargando(false)
    }
  }, [clinicaId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <BrandContext.Provider value={{ brand, cargando, refrescar: cargar }}>
      {children}
    </BrandContext.Provider>
  )
}

/**
 * URL absoluta del logo, con la versión colgada para romper la caché.
 *
 * Sin el ?v=, cambiar el logo dejaría el anterior en pantalla hasta que
 * venciera el max-age del navegador: el administrador guardaría, no
 * vería nada distinto y volvería a guardar.
 */
export function urlLogo(brand: Brand, base: string): string | null {
  if (!brand.logoUrl) return null
  return `${base}${brand.logoUrl}&v=${encodeURIComponent(brand.version)}`
}

/* ------------------------------------------------------------------ */
/* Escritura de tokens                                                 */
/* ------------------------------------------------------------------ */

function aplicarTokens(brand: Brand): void {
  const root = document.documentElement

  // Marca principal: las cuatro variables que el design system declara
  // como re-tematizables.
  fijar(root, '--primary', brand.colorPrimario)
  fijar(root, '--primary-hover', ajustarLuz(brand.colorPrimario, -0.12))
  // El tinte es el fondo de los estados activos (menú, badges). Se
  // lleva a una luminosidad casi blanca conservando el tono, en vez de
  // ser un color aparte que la clínica tendría que elegir a juego.
  fijar(root, '--primary-tint', conLuz(brand.colorPrimario, 0.93))
  fijar(root, '--ring', rgba(brand.colorPrimario, 0.35))

  // El acento no existe en tokens.css: lo declara index.css de esta
  // app, porque hoy solo lo usa la vista previa de la marca. Cuando el
  // PDF (CLI-05) y la app del paciente lo necesiten, subirá al paquete.
  fijar(root, '--accent', brand.colorAcento)
  fijar(root, '--accent-hover', ajustarLuz(brand.colorAcento, -0.12))
}

function fijar(root: HTMLElement, nombre: string, valor: string): void {
  root.style.setProperty(nombre, valor)
}

/* ------------------------------------------------------------------ */
/* Color: hex <-> HSL                                                  */
/* ------------------------------------------------------------------ */

/**
 * Se opera en HSL y no en RGB porque oscurecer restando a cada canal
 * desatura: un verde intenso al 12% menos de rojo/verde/azul sale gris
 * verdoso, no verde oscuro. En HSL solo se mueve la luminosidad.
 */

interface Hsl {
  h: number
  s: number
  l: number
}

function aHsl(hex: string): Hsl {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2

  if (max === min) return { h: 0, s: 0, l }

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6

  return { h, s, l }
}

function canal(p: number, q: number, t: number): number {
  let x = t
  if (x < 0) x += 1
  if (x > 1) x -= 1
  if (x < 1 / 6) return p + (q - p) * 6 * x
  if (x < 1 / 2) return q
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
  return p
}

function aHex({ h, s, l }: Hsl): string {
  let r: number
  let g: number
  let b: number

  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = canal(p, q, h + 1 / 3)
    g = canal(p, q, h)
    b = canal(p, q, h - 1 / 3)
  }

  const dos = (n: number) =>
    Math.round(Math.min(1, Math.max(0, n)) * 255)
      .toString(16)
      .padStart(2, '0')

  return `#${dos(r)}${dos(g)}${dos(b)}`
}

/** Mueve la luminosidad manteniendo tono y saturación. */
function ajustarLuz(hex: string, delta: number): string {
  const hsl = aHsl(hex)
  return aHex({ ...hsl, l: Math.min(1, Math.max(0, hsl.l + delta)) })
}

/** Lleva el color a una luminosidad concreta (para el tinte). */
function conLuz(hex: string, luz: number): string {
  const hsl = aHsl(hex)
  // Un tinte muy claro con saturación alta chilla; se rebaja para que
  // funcione como fondo detrás de texto.
  return aHex({ h: hsl.h, s: Math.min(hsl.s, 0.45), l: luz })
}

function rgba(hex: string, alfa: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alfa})`
}
