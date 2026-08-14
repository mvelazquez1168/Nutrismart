/**
 * Espacio del paciente — PAC-02.
 *
 * Pensada para un móvil y para leerse de un vistazo. El orden de las
 * tarjetas es el de las preguntas que se hace el paciente: cuándo vuelvo,
 * cómo voy, qué me toca comer, qué acordé.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ApiError,
  getDashboard,
  getTareas,
  getYo,
  marcarTarea,
  type Dashboard,
  type Tarea,
  type Yo,
} from '../lib/api'
import { entrar, initKeycloak, salir } from '../lib/keycloak'
import { NavBar } from '../components/NavBar'

function Tarjeta({
  titulo,
  icono,
  children,
}: {
  titulo: string
  icono: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-primary">{icono}</span>
        <h2 className="text-sm font-semibold text-ink">{titulo}</h2>
      </div>
      {children}
    </section>
  )
}

const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth={2}>
    {children}
  </svg>
)

const IconCita = () => (
  <Svg>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </Svg>
)
const IconPeso = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 6v6l4 2" />
  </Svg>
)
const IconPlan = () => (
  <Svg>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
  </Svg>
)
const IconAcuerdo = () => (
  <Svg>
    <polyline points="9 11 12 14 22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </Svg>
)
const IconChat = () => (
  <Svg>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Svg>
)

/**
 * Línea de peso. Sin ejes ni cuadrícula: no es una gráfica para medir,
 * es para ver la forma. El número exacto está justo encima.
 */
function LineaPeso({ datos }: { datos: { pesoKg: number; fecha: string }[] }) {
  const W = 280
  const H = 64
  const P = 10
  const pesos = datos.map((d) => d.pesoKg)
  const min = Math.min(...pesos)
  const max = Math.max(...pesos)
  const rango = max - min || 1

  const puntos = datos.map((d, i) => ({
    x: P + (i / (datos.length - 1)) * (W - P * 2),
    y: P + (1 - (d.pesoKg - min) / rango) * (H - P * 2),
  }))

  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Evolución del peso: de ${datos[0]!.pesoKg} a ${datos[datos.length - 1]!.pesoKg} kilos`}
      >
        <polyline
          points={puntos.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {puntos.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={i === puntos.length - 1 ? 4 : 2.5} fill="var(--primary)" />
        ))}
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-muted">
        <span>{datos[0]!.fecha}</span>
        <span>{datos[datos.length - 1]!.fecha}</span>
      </figcaption>
    </figure>
  )
}

function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export function Inicio() {
  const navegar = useNavigate()
  const [yo, setYo] = useState<Yo | null>(null)
  const [datos, setDatos] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tareas, setTareas] = useState<Tarea[]>([])

  useEffect(() => {
    let vivo = true
    async function cargar() {
      try {
        const autenticado = await initKeycloak()
        if (!autenticado) {
          entrar(`${window.location.origin}/inicio`)
          return
        }
        const [perfil, panel, pendientes] = await Promise.all([
          getYo(),
          getDashboard(),
          // Las tareas no bloquean el panel: si fallan, el resto se
          // pinta igual.
          getTareas(true).catch(() => [] as Tarea[]),
        ])
        if (!vivo) return
        setYo(perfil)
        setDatos(panel)
        setTareas(pendientes)

        // La app se viste con el color de la clínica del paciente. Es el
        // white-label de la Rebanada 6 visto desde el otro lado.
        if (perfil.clinica.colorPrimario) {
          document.documentElement.style.setProperty('--primary', perfil.clinica.colorPrimario)
        }
      } catch (e) {
        if (!vivo) return
        if (e instanceof ApiError && e.codigo === 'sin_vincular') {
          navegar('/activar', { replace: true })
          return
        }
        setError(e instanceof ApiError ? e.message : 'No hemos podido cargar tus datos')
      }
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [navegar])

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
        <div>
          <p className="mb-3 font-medium text-ink">{error}</p>
          <button type="button" onClick={salir} className="text-sm text-muted underline">
            Salir
          </button>
        </div>
      </main>
    )
  }

  if (!yo || !datos) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-pill border-4 border-primary border-t-transparent" />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background pb-nav">
      <header className="bg-primary px-4 pb-8 pt-10 text-white">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-sm opacity-90">{yo.clinica.nombre}</p>
          <button type="button" onClick={salir} className="text-xs underline opacity-90">
            Salir
          </button>
        </div>
        <h1 className="text-2xl font-bold">Hola, {yo.nombre.split(' ')[0]}</h1>
        <p className="mt-1 text-sm capitalize opacity-90">
          {new Date().toLocaleDateString('es-CR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </header>

      <div className="-mt-4 space-y-4 px-4">
        <Tarjeta titulo="Tu próxima cita" icono={<IconCita />}>
          {datos.proximaCita ? (
            <>
              <p className="font-semibold capitalize text-ink">
                {fechaLarga(datos.proximaCita.inicio)}
              </p>
              <p className="text-sm text-muted">
                {new Date(datos.proximaCita.inicio).toLocaleTimeString('es-CR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {datos.proximaCita.profesional && ` · ${datos.proximaCita.profesional}`}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">
              No tienes ninguna cita agendada. Habla con tu nutricionista para reservar la
              siguiente.
            </p>
          )}
          <button
            type="button"
            onClick={() => navegar('/citas')}
            className="mt-2 text-sm font-medium text-primary hover:underline"
          >
            Ver todas mis citas →
          </button>
        </Tarjeta>

        <Tarjeta titulo="Tu peso" icono={<IconPeso />}>
          {datos.pesoActual ? (
            <>
              <p className="text-3xl font-bold text-ink">
                {datos.pesoActual.pesoKg}
                <span className="ml-1 text-base font-normal text-muted">kg</span>
              </p>
              <p className="mb-3 text-xs text-muted">Medido el {datos.pesoActual.fecha}</p>
              {datos.historialPeso.length > 1 && <LineaPeso datos={datos.historialPeso} />}
            </>
          ) : (
            <p className="text-sm text-muted">
              Todavía no hay ninguna medición. Se registra en consulta.
            </p>
          )}
        </Tarjeta>

        {datos.plan && (
          <Tarjeta titulo="Tu plan" icono={<IconPlan />}>
            <p className="text-3xl font-bold text-primary">
              {datos.plan.kcal}
              <span className="ml-1 text-base font-normal text-muted">kcal al día</span>
            </p>

            {datos.plan.pctProteina !== null && (
              <>
                <div className="mt-3 flex h-3 overflow-hidden rounded-pill" role="presentation">
                  {/* Colores de gráfica del design system: son fijos y no
                      cambian con la marca de la clínica, para que una
                      barra de macros signifique siempre lo mismo. */}
                  <div
                    style={{
                      width: `${datos.plan.pctProteina}%`,
                      backgroundColor: 'var(--chart-1)',
                    }}
                  />
                  <div
                    style={{ width: `${datos.plan.pctCho}%`, backgroundColor: 'var(--chart-2)' }}
                  />
                  <div
                    style={{ width: `${datos.plan.pctGrasa}%`, backgroundColor: 'var(--chart-3)' }}
                  />
                </div>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  {[
                    { n: 'Proteína', p: datos.plan.pctProteina, g: datos.plan.proteinaG, c: 1 },
                    { n: 'Carbohidratos', p: datos.plan.pctCho, g: datos.plan.choG, c: 2 },
                    { n: 'Grasas', p: datos.plan.pctGrasa, g: datos.plan.grasaG, c: 3 },
                  ].map((m) => (
                    <li key={m.n} className="flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-pill"
                        style={{ backgroundColor: `var(--chart-${m.c})` }}
                      />
                      {m.n} {m.p} %{m.g !== null && ` · ${m.g} g`}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Tarjeta>
        )}

        {datos.acuerdos.length > 0 && (
          <Tarjeta titulo="Lo que acordaste" icono={<IconAcuerdo />}>
            <ul className="space-y-2">
              {datos.acuerdos.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-ink">
                  <span
                    aria-hidden="true"
                    className="mt-1 h-3.5 w-3.5 shrink-0 rounded-pill border-2"
                    style={{
                      borderColor: a.cumplido ? 'var(--status-normal)' : 'var(--border)',
                      backgroundColor: a.cumplido ? 'var(--status-normal)' : 'transparent',
                    }}
                  />
                  <span className={a.cumplido ? 'text-muted line-through' : ''}>{a.texto}</span>
                </li>
              ))}
            </ul>
            {/* Marcarlos es de la R18: enseñarlos aquí sin poder tocarlos
                es honesto, fingir un botón que no guarda nada no. */}
            <p className="mt-3 text-xs text-muted">
              Los revisáis juntos en la próxima consulta.
            </p>
          </Tarjeta>
        )}

        {tareas.length > 0 && (
          <Tarjeta titulo="Lo que te pidió tu nutricionista" icono={<IconAcuerdo />}>
            <ul className="space-y-1">
              {tareas.slice(0, 4).map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      // Se pinta al pulsar; si falla se restaura.
                      const antes = tareas
                      setTareas(tareas.filter((x) => x.id !== t.id))
                      marcarTarea(t.id, true).catch(() => setTareas(antes))
                    }}
                    className="flex w-full items-start gap-2 py-1.5 text-left"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded-pill border-2"
                      style={{
                        borderColor:
                          t.prioridad === 'alta' ? 'var(--status-alert)' : 'var(--border)',
                      }}
                    />
                    <span className="flex-1 text-sm text-ink">
                      {t.titulo}
                      {t.fechaLimite && (
                        <span className="ml-1 text-xs text-muted">· antes del {t.fechaLimite}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {tareas.length > 4 && (
              <p className="mt-2 text-xs text-muted">Y {tareas.length - 4} más.</p>
            )}
          </Tarjeta>
        )}

        <Tarjeta titulo="Tu progreso" icono={<IconPeso />}>
          <button
            type="button"
            onClick={() => navegar('/progreso')}
            className="text-sm font-medium text-primary hover:underline"
          >
            Ver cómo vas hacia tu meta →
          </button>
        </Tarjeta>

        <Tarjeta titulo="Mensajes" icono={<IconChat />}>
          {datos.mensajesSinLeer > 0 ? (
            <p className="flex items-center gap-2 text-sm text-ink">
              <span className="flex h-6 w-6 items-center justify-center rounded-pill bg-primary text-xs font-bold text-white">
                {datos.mensajesSinLeer}
              </span>
              {datos.mensajesSinLeer === 1 ? 'mensaje sin leer' : 'mensajes sin leer'}
            </p>
          ) : (
            <p className="text-sm text-muted">No tienes mensajes nuevos.</p>
          )}
          <button
            type="button"
            onClick={() => navegar('/mensajes')}
            className="mt-2 text-sm font-medium text-primary hover:underline"
          >
            Abrir mensajes →
          </button>
        </Tarjeta>
      </div>

      <NavBar mensajesSinLeer={datos.mensajesSinLeer} />
    </main>
  )
}
