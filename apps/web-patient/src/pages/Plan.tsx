/**
 * Plan y acuerdos del paciente — PAC-04.
 *
 * Lo que el paciente marca aquí NO cambia el acuerdo que pactó con su
 * nutricionista: se guarda aparte, con fecha. Por eso la pantalla dice
 * «lo que has ido haciendo» y no «completado».
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, cumplirAcuerdo, getPlan, type PlanPaciente } from '../lib/api'
import { entrar, initKeycloak } from '../lib/keycloak'
import { NavBar } from '../components/NavBar'

const RESTRICCIONES: Record<string, string> = {
  bajo_sodio: 'Bajo en sodio',
  sin_gluten: 'Sin gluten',
  sin_lactosa: 'Sin lactosa',
  vegetariana: 'Vegetariana',
  vegana: 'Vegana',
  renal: 'Renal',
  diabetica: 'Para diabetes',
  bajo_purinas: 'Bajo en purinas',
}

function Tarjeta({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-ink">{titulo}</h2>
      {children}
    </section>
  )
}

export function Plan() {
  const navegar = useNavigate()
  const [plan, setPlan] = useState<PlanPaciente | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState<number | null>(null)

  useEffect(() => {
    let vivo = true
    async function cargar() {
      try {
        if (!(await initKeycloak())) {
          entrar(`${window.location.origin}/plan`)
          return
        }
        const r = await getPlan()
        if (!vivo) return
        setPlan(r.plan)
        setAviso(r.mensaje ?? null)
      } catch (e) {
        if (!vivo) return
        if (e instanceof ApiError && e.codigo === 'sin_vincular') {
          navegar('/activar', { replace: true })
          return
        }
        setError(e instanceof ApiError ? e.message : 'No hemos podido cargar tu plan')
      } finally {
        if (vivo) setCargando(false)
      }
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [navegar])

  async function alternar(index: number, cumplidoAhora: boolean) {
    if (!plan || guardando !== null) return
    setGuardando(index)
    setError(null)

    // Se pinta en cuanto se pulsa y se revierte si el servidor dice que
    // no: en un móvil con mala cobertura, esperar la respuesta para
    // mover la casilla hace que parezca que no ha funcionado.
    const antes = plan
    setPlan({
      ...plan,
      acuerdos: plan.acuerdos.map((a) =>
        a.index === index ? { ...a, cumplidoPaciente: !cumplidoAhora } : a,
      ),
    })

    try {
      await cumplirAcuerdo(plan.consultaId, index, !cumplidoAhora)
    } catch (e) {
      setPlan(antes)
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar. Inténtalo otra vez.')
    } finally {
      setGuardando(null)
    }
  }

  if (cargando) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-pill border-4 border-primary border-t-transparent" />
      </main>
    )
  }

  const hechos = plan?.acuerdos.filter((a) => a.cumplidoPaciente).length ?? 0

  return (
    <main className="min-h-screen bg-background pb-nav">
      <header className="bg-primary px-4 pb-8 pt-10 text-white">
        <h1 className="text-xl font-bold">Mi plan</h1>
        {plan && (
          <p className="mt-1 text-sm opacity-90">
            {plan.profesional ?? 'Tu nutricionista'} · consulta del {plan.fecha}
          </p>
        )}
      </header>

      <div className="-mt-4 space-y-4 px-4">
        {!plan && (
          <section className="rounded-lg border border-border bg-surface p-8 text-center shadow-sm">
            <p className="font-medium text-ink">Todavía no tienes plan</p>
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted">
              {aviso ?? 'Tu nutricionista lo preparará después de tu consulta.'}
            </p>
          </section>
        )}

        {plan && (
          <>
            <Tarjeta titulo="Cuánto comer">
              <p className="text-3xl font-bold text-primary">
                {plan.kcal ?? '—'}
                <span className="ml-1 text-base font-normal text-muted">kcal al día</span>
              </p>

              {plan.pctProteina !== null && (
                <>
                  {/* Colores de gráfica del design system: fijos, para que
                      una barra de macros signifique lo mismo en todas las
                      clínicas aunque cambie la marca. */}
                  <div className="mt-3 flex h-3 overflow-hidden rounded-pill" role="presentation">
                    <div
                      style={{ width: `${plan.pctProteina}%`, backgroundColor: 'var(--chart-1)' }}
                    />
                    <div style={{ width: `${plan.pctCho}%`, backgroundColor: 'var(--chart-2)' }} />
                    <div style={{ width: `${plan.pctGrasa}%`, backgroundColor: 'var(--chart-3)' }} />
                  </div>

                  <ul className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    {[
                      { n: 'Proteína', p: plan.pctProteina, g: plan.proteinaG, c: 1 },
                      { n: 'Carbohidratos', p: plan.pctCho, g: plan.choG, c: 2 },
                      { n: 'Grasas', p: plan.pctGrasa, g: plan.grasaG, c: 3 },
                    ].map((m) => (
                      <li key={m.n} className="flex flex-col items-center gap-1">
                        <span
                          aria-hidden="true"
                          className="h-3 w-3 rounded-pill"
                          style={{ backgroundColor: `var(--chart-${m.c})` }}
                        />
                        <span className="text-muted">{m.n}</span>
                        <span className="font-semibold text-ink">{m.p} %</span>
                        {m.g !== null && <span className="text-muted">{m.g} g</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Tarjeta>

            {plan.restricciones.length > 0 && (
              <Tarjeta titulo="Qué evitar">
                <ul className="flex flex-wrap gap-2">
                  {plan.restricciones.map((r) => (
                    <li
                      key={r}
                      className="rounded-pill px-3 py-1 text-xs font-medium"
                      style={{
                        color: 'var(--status-alert)',
                        backgroundColor: 'color-mix(in srgb, var(--status-alert) 14%, transparent)',
                      }}
                    >
                      {RESTRICCIONES[r] ?? r}
                    </li>
                  ))}
                </ul>
              </Tarjeta>
            )}

            {plan.suplementos && (
              <Tarjeta titulo="Suplementos">
                <p className="whitespace-pre-wrap text-sm text-ink">{plan.suplementos}</p>
              </Tarjeta>
            )}

            {plan.acuerdos.length > 0 && (
              <Tarjeta titulo="Lo que acordaste">
                <p className="-mt-2 mb-3 text-xs text-muted">
                  Marca lo que vayas haciendo. Es tu registro: lo comentaréis en la próxima
                  consulta.
                </p>

                <ul className="space-y-1">
                  {plan.acuerdos.map((a) => (
                    <li key={a.index}>
                      <button
                        type="button"
                        onClick={() => void alternar(a.index, a.cumplidoPaciente)}
                        aria-pressed={a.cumplidoPaciente}
                        disabled={guardando !== null}
                        className="flex w-full items-start gap-3 rounded-md py-2 text-left disabled:opacity-60"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-pill border-2 transition-colors"
                          style={{
                            borderColor: a.cumplidoPaciente ? 'var(--primary)' : 'var(--border)',
                            backgroundColor: a.cumplidoPaciente ? 'var(--primary)' : 'transparent',
                          }}
                        >
                          {a.cumplidoPaciente && (
                            <svg
                              viewBox="0 0 24 24"
                              className="h-3 w-3 fill-none stroke-white"
                              strokeWidth={3}
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </span>
                        <span className="flex-1">
                          <span
                            className={`block text-sm leading-relaxed ${
                              a.cumplidoPaciente ? 'text-muted line-through' : 'text-ink'
                            }`}
                          >
                            {a.texto}
                          </span>
                          {/* Lo que marcó el profesional en consulta es
                              otra cosa, y se dice aparte para que el
                              paciente no crea que lo suyo lo cambia. */}
                          {a.cumplidoProfesional && (
                            <span className="mt-0.5 block text-xs text-muted">
                              Tu nutricionista ya lo dio por hecho en consulta
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>

                <p className="mt-3 text-xs text-muted">
                  Llevas {hechos} de {plan.acuerdos.length}.
                </p>
              </Tarjeta>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="text-center text-sm" style={{ color: 'var(--status-critical)' }}>
            {error}
          </p>
        )}
      </div>

      <NavBar />
    </main>
  )
}
