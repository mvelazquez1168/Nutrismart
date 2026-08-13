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
import { ajustarLuz, derivarPaleta } from '../lib/color'

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
  // como re-tematizables. El tinte y el halo se derivan del primario
  // (ver lib/color.ts) en vez de pedirle a la clínica tres colores
  // coordinados.
  const paleta = derivarPaleta(brand.colorPrimario)
  fijar(root, '--primary', paleta.primary)
  fijar(root, '--primary-hover', paleta.primaryHover)
  fijar(root, '--primary-tint', paleta.primaryTint)
  fijar(root, '--ring', paleta.ring)

  // El acento no existe en tokens.css: lo declara index.css de esta
  // app, porque hoy solo lo usa la vista previa de la marca. Cuando el
  // PDF (CLI-05) y la app del paciente lo necesiten, subirá al paquete.
  fijar(root, '--accent', brand.colorAcento)
  fijar(root, '--accent-hover', ajustarLuz(brand.colorAcento, -0.12))
}

function fijar(root: HTMLElement, nombre: string, valor: string): void {
  root.style.setProperty(nombre, valor)
}
