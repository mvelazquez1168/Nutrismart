/**
 * Lo que se ve al abrir una pantalla de administración sin permiso.
 *
 * Antes, las cuatro rutas de administración —Dashboard, Clínica, Equipo y
 * Marca— hacían `<Navigate to="/pacientes">`. El resultado, visto desde
 * la pantalla, era que **los ítems del menú mostraban la lista de
 * pacientes**: el enlace llevaba a algún sitio, el sitio rebotaba, y
 * nadie decía por qué.
 *
 * Un rebote silencioso es el peor modo de negar un permiso, porque no se
 * distingue de un enlace mal configurado. Esta pantalla dice las tres
 * cosas que pueden faltar, y son distintas:
 *
 *  · el perfil no se pudo cargar (la causa más común, y no es de
 *    permisos: es que `/api/profesional/yo` no encontró la ficha del
 *    usuario en esta clínica);
 *  · falta el rol en Keycloak;
 *  · falta el rol en la base.
 *
 * `/api/profesional/yo` ya devolvía `adminEnToken` y `adminEnBase` por
 * separado justamente «para que la pantalla explique cuál falta». Esta es
 * esa pantalla.
 */
import { Link } from 'react-router-dom'
import type { Yo } from '../hooks/useYo'

export function SinPermisoAdmin({
  seccion,
  yo,
  cargado,
}: {
  /** Cómo se llama en el menú lo que se intentó abrir. */
  seccion: string
  yo: Yo | null
  cargado: boolean
}) {
  if (!cargado) {
    return <div className="h-48 animate-pulse rounded-lg bg-surface-2" />
  }

  // Sin perfil no hay nada que explicar sobre roles: lo que falla es más
  // abajo. Es el caso de un usuario de Keycloak que no tiene ficha de
  // profesional en esta clínica, y el 404 de `yo` es lo que lo delata.
  const sinPerfil = yo === null

  const faltaToken = yo !== null && !yo.adminEnToken
  const faltaBase = yo !== null && !yo.adminEnBase

  return (
    <div className="mx-auto max-w-xl rounded-lg border border-border bg-surface p-6">
      <h1 className="text-lg font-semibold text-ink">{seccion} no está disponible</h1>

      {sinPerfil ? (
        <>
          <p className="mt-2 text-sm text-muted">
            No se pudo leer tu ficha de profesional en esta clínica, así que la aplicación no puede
            comprobar si administras. No es un problema de permisos: es que tu usuario no está
            vinculado a un profesional de esta clínica.
          </p>
          <p className="mt-2 text-sm text-muted">
            Quien administre la clínica puede vincularlo desde Equipo. Si administras tú, hace falta
            que alguien lo haga desde la base o desde Keycloak.
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">
            Esta sección es solo para quien administra la clínica. Para abrirla hacen falta las dos
            condiciones, y te falta {faltaToken && faltaBase ? 'las dos' : 'una'}:
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            <li className="flex items-start gap-2">
              <span aria-hidden="true">{yo.adminEnToken ? '✓' : '✗'}</span>
              <span className={yo.adminEnToken ? 'text-muted' : 'text-ink'}>
                El rol <code>admin_clinica</code> en tu cuenta de acceso
                {yo.adminEnToken ? ': lo tienes' : ': falta'}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span aria-hidden="true">{yo.adminEnBase ? '✓' : '✗'}</span>
              <span className={yo.adminEnBase ? 'text-muted' : 'text-ink'}>
                El rol de administrador en tu ficha de profesional
                {yo.adminEnBase ? ': lo tienes' : ': falta'}
              </span>
            </li>
          </ul>
        </>
      )}

      <Link
        to="/pacientes"
        className="mt-5 inline-block rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2"
      >
        Volver a Pacientes
      </Link>
    </div>
  )
}
