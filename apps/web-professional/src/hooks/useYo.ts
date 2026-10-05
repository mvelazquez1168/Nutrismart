/**
 * Quién soy, compartido por la aplicación.
 *
 * Se guarda a nivel de módulo: la barra lateral, la guardia de rutas y
 * las pantallas de administración preguntan lo mismo, y sin esto lo
 * pedirían tres veces por carga.
 *
 * Esto decide qué se PINTA. Quien manda es el 403 del servidor, que no
 * depende de nada que el navegador pueda alterar.
 */
import { useEffect, useState } from 'react'
import { apiGet } from '../api/client'

export interface Yo {
  id: string
  nombre: string
  correo: string | null
  colegiatura: string | null
  fotoUrl: string | null
  rol: 'admin_clinica' | 'nutricionista'
  estado: string
  clinica: { id: string; nombre: string; zonaHoraria: string }
  /** Las dos condiciones a la vez. Es lo que abre las pantallas de admin. */
  esAdmin: boolean
  /** Rol en el token de Keycloak: lo que concede el acceso. */
  adminEnToken: boolean
  /** Rol en la base: puede quitar, nunca dar. */
  adminEnBase: boolean
  /**
   * Si la API puede crear cuentas de Keycloak por su cuenta.
   *
   * La pantalla de Equipo cambia lo que PROMETE según este valor: con él
   * activo, dar de alta crea la cuenta y manda el correo de activación;
   * sin él, solo crea la ficha y alguien tiene que ir a Keycloak. Decir
   * lo contrario de lo que va a pasar es peor que no decir nada.
   */
  cuentasAutomaticas: boolean
  /** Operador de plataforma. Solo es true si además tiene ficha aquí. */
  esSuperAdmin: boolean
}

let cache: Yo | null = null
let cargando: Promise<Yo> | null = null
const suscriptores = new Set<(y: Yo) => void>()

/**
 * @param activo Solo pide datos cuando hay sesion. Es OBLIGATORIO
 *   respetarlo: `apiGet` pasa por `tokenVigente()`, y esa funcion, si
 *   `updateToken` falla —lo que ocurre con Keycloak todavia sin
 *   inicializar—, llama a `keycloak.login()`, que es una redireccion
 *   completa del navegador.
 *
 *   Llamar a este hook antes de que la sesion este lista produce un
 *   bucle: se pide el perfil, la peticion redirige al login, Keycloak
 *   devuelve al usuario, la pagina vuelve a montar, se pide el perfil
 *   otra vez. Varias vueltas por segundo, sin un solo error en el log
 *   porque cada login es correcto.
 */
export function useYo(activo: boolean): { yo: Yo | null; cargado: boolean } {
  const [yo, setYo] = useState<Yo | null>(cache)
  const [cargado, setCargado] = useState(cache !== null)

  useEffect(() => {
    if (!activo) return
    suscriptores.add(setYo)
    if (cache) {
      setCargado(true)
    } else {
      cargando ??= apiGet<Yo>('/api/profesional/yo')
      cargando
        .then((y) => {
          cache = y
          for (const s of suscriptores) s(y)
        })
        .catch(() => {
          /* sin perfil se pinta como no-admin, que es lo que menos promete */
        })
        .finally(() => setCargado(true))
    }
    return () => {
      suscriptores.delete(setYo)
    }
  }, [activo])

  return { yo, cargado }
}
