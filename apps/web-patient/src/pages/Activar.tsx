/**
 * Activación de la cuenta del paciente — PAC-01.
 *
 * Cuatro estados: comprobando el enlace, enlace válido, enlace
 * inservible y cuenta lista. El paciente que llega aquí puede no haber
 * oído hablar de NutriSmart, así que la pantalla explica qué es y quién
 * le invita ANTES de pedirle nada.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, getInvitacion, vincular, type InfoInvitacion } from '../lib/api'
import { entrar, initKeycloak, keycloak, registrarse } from '../lib/keycloak'

type Fase = 'comprobando' | 'valida' | 'invalida' | 'lista'

function Marca() {
  return (
    <div className="mb-8 text-center">
      <p className="text-3xl font-bold">
        <span className="text-primary">Nutri</span>
        <span className="text-ink">Smart</span>
      </p>
      <p className="mt-1 text-sm text-muted">Tu nutrición, contigo</p>
    </div>
  )
}

function Icono({ tipo }: { tipo: 'persona' | 'error' | 'listo' }) {
  const fondo = tipo === 'error' ? 'var(--status-critical)' : 'var(--primary)'
  return (
    <div
      className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-pill"
      style={{ backgroundColor: `color-mix(in srgb, ${fondo} 14%, transparent)`, color: fondo }}
    >
      <svg viewBox="0 0 24 24" className="h-7 w-7 fill-none stroke-current" strokeWidth={2}>
        {tipo === 'persona' && (
          <>
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </>
        )}
        {tipo === 'error' && (
          <>
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </>
        )}
        {tipo === 'listo' && <polyline points="20 6 9 17 4 12" />}
      </svg>
    </div>
  )
}

export function Activar() {
  const [params] = useSearchParams()
  const navegar = useNavigate()
  const token = params.get('token') ?? ''

  const [fase, setFase] = useState<Fase>('comprobando')
  const [info, setInfo] = useState<InfoInvitacion | null>(null)
  const [error, setError] = useState('')
  const vinculando = useRef(false)

  useEffect(() => {
    let vivo = true

    async function arrancar() {
      // Keycloak primero: si volvemos de crear la cuenta, ya hay sesión y
      // lo que toca es vincular, no volver a enseñar la bienvenida.
      let autenticado = false
      try {
        autenticado = await initKeycloak()
      } catch (e) {
        if (!vivo) return
        setError(e instanceof Error ? e.message : 'No se pudo contactar con el servidor de acceso')
        setFase('invalida')
        return
      }
      if (!vivo) return

      if (!token) {
        // Sin token pero con sesión: es alguien que ya activó su cuenta y
        // vuelve a entrar. No hay nada que activar.
        if (autenticado) {
          navegar('/inicio', { replace: true })
          return
        }
        setError('El enlace está incompleto. Ábrelo desde el correo tal como te llegó.')
        setFase('invalida')
        return
      }

      if (autenticado) {
        if (vinculando.current) return
        vinculando.current = true
        try {
          await vincular(token)
          if (vivo) setFase('lista')
        } catch (e) {
          if (!vivo) return
          // Si el enlace ya se usó pero la sesión es válida, lo más
          // probable es que sea la misma persona volviendo. No es un
          // fallo: se le lleva a su espacio.
          if (e instanceof ApiError && e.codigo === 'caducado' && keycloak.authenticated) {
            navegar('/inicio', { replace: true })
            return
          }
          setError(e instanceof ApiError ? e.message : 'No se pudo activar la cuenta')
          setFase('invalida')
        }
        return
      }

      try {
        const datos = await getInvitacion(token)
        if (!vivo) return
        setInfo(datos)
        setFase('valida')
      } catch (e) {
        if (!vivo) return
        setError(e instanceof ApiError ? e.message : 'No se pudo comprobar el enlace')
        setFase('invalida')
      }
    }

    void arrancar()
    return () => {
      vivo = false
    }
  }, [token, navegar])

  // Al volver de Keycloak se vuelve a esta misma dirección CON el token,
  // para que el efecto de arriba encuentre sesión y enlace y los una.
  const volverA = `${window.location.origin}/activar?token=${encodeURIComponent(token)}`

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <Marca />

        <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
          {fase === 'comprobando' && (
            <div className="py-8 text-center">
              <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-pill border-4 border-primary border-t-transparent" />
              <p className="text-sm text-muted">Comprobando tu enlace…</p>
            </div>
          )}

          {fase === 'invalida' && (
            <>
              <div className="mb-6 text-center">
                <Icono tipo="error" />
                <h1 className="mb-1 text-lg font-semibold text-ink">No podemos abrir el enlace</h1>
                <p className="text-sm text-muted">{error}</p>
              </div>
              <button
                type="button"
                onClick={() => entrar(`${window.location.origin}/inicio`)}
                className="w-full rounded-md border border-border py-3 text-sm font-medium text-ink hover:bg-surface-2"
              >
                Ya tengo cuenta — entrar
              </button>
            </>
          )}

          {fase === 'valida' && info && (
            <>
              <div className="mb-6 text-center">
                <Icono tipo="persona" />
                <h1 className="mb-1 text-lg font-semibold text-ink">
                  Hola, {info.nombrePaciente.split(' ')[0]}
                </h1>
                <p className="text-sm text-muted">
                  Tu nutricionista de <strong className="text-ink">{info.nombreClinica}</strong> te
                  invita a NutriSmart.
                </p>
              </div>

              <div className="mb-5 rounded-md bg-primary-tint p-4 text-sm text-primary">
                <p className="mb-1 font-semibold">¿Qué vas a encontrar aquí?</p>
                <p>
                  Tu plan, los acuerdos de la última consulta, cómo evoluciona tu peso y cuándo es
                  tu próxima cita. Todo lo que ves aquí lo escribe tu nutricionista.
                </p>
              </div>

              <button
                type="button"
                onClick={() => registrarse(volverA)}
                className="mb-3 w-full rounded-md bg-primary py-3 text-sm font-semibold text-white hover:bg-primary-hover"
              >
                Crear mi cuenta
              </button>
              <button
                type="button"
                onClick={() => entrar(volverA)}
                className="w-full rounded-md border border-border py-3 text-sm font-medium text-ink hover:bg-surface-2"
              >
                Ya tengo cuenta — entrar
              </button>
            </>
          )}

          {fase === 'lista' && (
            <>
              <div className="mb-6 text-center">
                <Icono tipo="listo" />
                <h1 className="mb-1 text-lg font-semibold text-ink">Cuenta activada</h1>
                <p className="text-sm text-muted">Ya puedes entrar a tu espacio.</p>
              </div>
              <button
                type="button"
                onClick={() => navegar('/inicio')}
                className="w-full rounded-md bg-primary py-3 text-sm font-semibold text-white hover:bg-primary-hover"
              >
                Entrar
              </button>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-muted">
          ¿Algún problema? Pídele a tu nutricionista que te reenvíe el enlace.
        </p>
      </div>
    </main>
  )
}
