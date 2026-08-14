/**
 * Lo que el paciente apunta en casa, visto por el profesional.
 *
 * Sin esta pantalla el diario es un cuaderno que nadie lee: el paciente
 * apunta lo que come para que su nutricionista lo mire en la siguiente
 * consulta, y si no hay forma de mirarlo no hay motivo para apuntarlo.
 */
import { useEffect, useState } from 'react'
import { ApiError, apiDelete, apiGet, apiPost } from '../api/client'

const FRANJA: Record<string, string> = {
  desayuno: 'Desayuno',
  media_manana: 'Media mañana',
  almuerzo: 'Almuerzo',
  merienda: 'Merienda',
  cena: 'Cena',
  extra: 'Otro',
}

const METRICA: Record<string, string> = {
  peso: 'Peso',
  presion_arterial: 'Presión arterial',
  glucosa: 'Glucosa',
  otro: 'Otra medida',
}

interface Comida {
  fecha: string
  tipoComida: string
  descripcion: string
  kcal: number | null
}

interface Medida {
  tipo: string
  valor: number | null
  sistolica: number | null
  diastolica: number | null
  unidad: string
  nota: string | null
  medidoEn: string
}

interface Respuesta {
  dias: number
  comidas: Comida[]
  metricas: Medida[]
}

interface Tarea {
  id: string
  titulo: string
  descripcion: string | null
  fechaLimite: string | null
  prioridad: 'alta' | 'normal' | 'baja'
  estado: 'pendiente' | 'completada' | 'archivada'
  completadaEn: string | null
}

const ETIQUETA_ESTADO: Record<string, { texto: string; token: string }> = {
  pendiente: { texto: 'Pendiente', token: '--muted' },
  completada: { texto: 'Hecha', token: '--status-normal' },
  archivada: { texto: 'Retirada', token: '--muted' },
}

/**
 * Tareas que el profesional manda entre consultas.
 *
 * Distintas de los acuerdos de la valoración: un acuerdo se pacta en
 * consulta y va firmado dentro de la conclusión; una tarea se manda
 * después, tiene fecha límite y el paciente la marca desde la app.
 */
function TareasPaciente({ pacienteId }: { pacienteId: string }) {
  const [tareas, setTareas] = useState<Tarea[]>([])
  const [titulo, setTitulo] = useState('')
  const [limite, setLimite] = useState('')
  const [prioridad, setPrioridad] = useState<'alta' | 'normal' | 'baja'>('normal')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cargar() {
    try {
      setTareas(await apiGet<Tarea[]>(`/api/pacientes/${pacienteId}/tareas`))
    } catch {
      /* la lista vacía ya comunica el estado */
    }
  }

  useEffect(() => {
    void cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pacienteId])

  async function crear() {
    if (titulo.trim() === '' || ocupado) return
    setOcupado(true)
    setError(null)
    try {
      await apiPost(`/api/pacientes/${pacienteId}/tareas`, {
        titulo: titulo.trim(),
        prioridad,
        ...(limite !== '' ? { fechaLimite: limite } : {}),
      })
      setTitulo('')
      setLimite('')
      setPrioridad('normal')
      await cargar()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo crear la tarea')
    } finally {
      setOcupado(false)
    }
  }

  async function retirar(id: string) {
    setOcupado(true)
    try {
      await apiDelete(`/api/pacientes/${pacienteId}/tareas/${id}`)
      await cargar()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo retirar')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h3 className="font-semibold text-ink">Tareas</h3>
      <p className="-mt-2 text-xs text-muted">
        Las ve en su aplicación y las marca desde ahí. No sustituyen a los acuerdos de la
        valoración.
      </p>

      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={titulo}
          maxLength={200}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Caminar 30 minutos, 5 días"
          aria-label="Título de la tarea"
          className="min-w-[12rem] flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-primary"
        />
        <input
          type="date"
          value={limite}
          onChange={(e) => setLimite(e.target.value)}
          aria-label="Fecha límite"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
        />
        <select
          value={prioridad}
          onChange={(e) => setPrioridad(e.target.value as 'alta' | 'normal' | 'baja')}
          aria-label="Prioridad"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
        >
          <option value="alta">Alta</option>
          <option value="normal">Normal</option>
          <option value="baja">Baja</option>
        </select>
        <button
          type="button"
          onClick={() => void crear()}
          disabled={ocupado || titulo.trim() === ''}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          Añadir
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      )}

      {tareas.length === 0 ? (
        <p className="text-sm text-muted">Todavía no le has mandado ninguna tarea.</p>
      ) : (
        <ul className="divide-y divide-border">
          {tareas.map((t) => {
            const e = ETIQUETA_ESTADO[t.estado]!
            return (
              <li key={t.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p
                    className={`text-sm ${t.estado === 'archivada' ? 'text-muted line-through' : 'text-ink'}`}
                  >
                    {t.titulo}
                  </p>
                  <p className="text-xs text-muted">
                    {t.fechaLimite ? `Antes del ${t.fechaLimite}` : 'Sin fecha'}
                    {t.prioridad === 'alta' && ' · prioridad alta'}
                    {t.completadaEn &&
                      ` · marcada el ${new Date(t.completadaEn).toLocaleDateString('es-CR')}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className="rounded-pill px-2 py-0.5 text-xs font-medium"
                    style={{
                      color: `var(${e.token})`,
                      backgroundColor: `color-mix(in srgb, var(${e.token}) 14%, transparent)`,
                    }}
                  >
                    {e.texto}
                  </span>
                  {t.estado !== 'archivada' && (
                    <button
                      type="button"
                      onClick={() => void retirar(t.id)}
                      disabled={ocupado}
                      className="text-xs text-muted hover:text-ink"
                    >
                      Retirar
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function RegistrosPaciente({ pacienteId }: { pacienteId: string }) {
  const [dias, setDias] = useState(14)
  const [datos, setDatos] = useState<Respuesta | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setDatos(null)
    apiGet<Respuesta>(`/api/pacientes/${pacienteId}/registros?dias=${dias}`, ctrl.signal)
      .then((d) => {
        if (!ctrl.signal.aborted) setDatos(d)
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) {
          setError(e instanceof ApiError ? e.message : 'No se pudieron cargar los registros')
        }
      })
    return () => ctrl.abort()
  }, [pacienteId, dias])

  if (error) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-border bg-surface p-4 text-sm text-ink shadow-sm"
      >
        {error}
      </p>
    )
  }

  if (!datos) return <div className="h-64 animate-pulse rounded-lg bg-surface-2" />

  // Se agrupa por día en el cliente: la consulta ya viene ordenada por
  // fecha y franja, así que basta recorrerla una vez.
  const porDia = new Map<string, Comida[]>()
  for (const c of datos.comidas) {
    porDia.set(c.fecha, [...(porDia.get(c.fecha) ?? []), c])
  }

  return (
    <div className="space-y-5">
      <TareasPaciente pacienteId={pacienteId} />

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Lo que el paciente ha apuntado desde la aplicación.
        </p>
        <select
          value={dias}
          onChange={(e) => setDias(Number(e.target.value))}
          aria-label="Periodo"
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink"
        >
          <option value={7}>7 días</option>
          <option value={14}>14 días</option>
          <option value={30}>30 días</option>
        </select>
      </div>

      <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h3 className="mb-3 font-semibold text-ink">Diario de comidas</h3>

        {porDia.size === 0 ? (
          <p className="text-sm text-muted">
            No ha apuntado ninguna comida en este periodo.
          </p>
        ) : (
          <div className="space-y-4">
            {[...porDia.entries()].map(([fecha, comidas]) => (
              <div key={fecha}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  {new Date(`${fecha}T12:00:00`).toLocaleDateString('es-CR', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </p>
                <ul className="divide-y divide-border">
                  {comidas.map((c, i) => (
                    <li key={i} className="flex items-start justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-primary">
                          {FRANJA[c.tipoComida] ?? c.tipoComida}
                        </p>
                        <p className="text-sm text-ink">{c.descripcion}</p>
                      </div>
                      {c.kcal !== null && (
                        <span className="shrink-0 text-sm tabular-nums text-muted">
                          {c.kcal} kcal
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h3 className="mb-1 font-semibold text-ink">Medidas en casa</h3>
        {/* El aviso importa: si estas cifras se leen como si fueran de
            consulta, una bajada de peso puede ser solo otra báscula. */}
        <p className="mb-3 text-xs text-muted">
          Se las tomó el paciente por su cuenta. No sustituyen a las mediciones de consulta ni se
          mezclan con ellas en el expediente.
        </p>

        {datos.metricas.length === 0 ? (
          <p className="text-sm text-muted">No ha apuntado ninguna medida en este periodo.</p>
        ) : (
          <ul className="divide-y divide-border">
            {datos.metricas.map((m, i) => (
              <li key={i} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{METRICA[m.tipo] ?? m.tipo}</p>
                  {m.nota && <p className="text-xs text-muted">{m.nota}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-ink">
                    {m.tipo === 'presion_arterial' ? `${m.sistolica}/${m.diastolica}` : m.valor}{' '}
                    <span className="text-xs font-normal text-muted">{m.unidad}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {new Date(m.medidoEn).toLocaleDateString('es-CR', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
