/**
 * Valoración nutricional ABCD — EVAL-00, contenedor.
 *
 * Cinco secciones; dos están construidas y tres llegan en rebanadas
 * posteriores. Las pendientes se muestran declaradas y vacías en vez de
 * ocultas: el profesional tiene que ver el alcance completo de la
 * valoración, no descubrirlo a plazos.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { getPaciente } from '../api/pacientes'
import {
  SECCIONES,
  SECCIONES_EXIGIDAS,
  finalizarConsulta,
  getConsulta,
  type Consulta,
  type Seccion,
} from '../api/valoracion'
import type { PacienteDetalle } from '../api/tipos'
import { TabsValoracion } from '../components/eval/TabsValoracion'
import { FormAntropometria } from '../components/eval/FormAntropometria'
import { PanelBioquimica } from '../components/eval/PanelBioquimica'

function EnConstruccion({ seccion }: { seccion: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center">
      <p className="text-sm font-medium text-ink">{seccion}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">
        Esta sección llega en una rebanada posterior. El contenedor ya la contempla para que la
        valoración no cambie de forma cuando se añada.
      </p>
    </div>
  )
}

export function ValoracionPaciente() {
  const { id = '', consultaId = '' } = useParams<{ id: string; consultaId: string }>()
  const navigate = useNavigate()

  const [consulta, setConsulta] = useState<Consulta | null>(null)
  const [paciente, setPaciente] = useState<PacienteDetalle | null>(null)
  const [tab, setTab] = useState<Seccion>('antrop')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [finalizando, setFinalizando] = useState(false)

  const refrescar = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const c = await getConsulta(id, consultaId, signal)
        if (!signal?.aborted) setConsulta(c)
      } catch (e) {
        if (signal?.aborted) return
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'No se pudo cargar la consulta')
      }
    },
    [id, consultaId],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    setCargando(true)
    Promise.allSettled([refrescar(ctrl.signal), getPaciente(id, ctrl.signal)]).then(([, pac]) => {
      if (ctrl.signal.aborted) return
      if (pac.status === 'fulfilled') setPaciente(pac.value)
      setCargando(false)
    })
    return () => ctrl.abort()
  }, [id, refrescar])

  async function finalizar() {
    setFinalizando(true)
    setError(null)
    try {
      const c = await finalizarConsulta(id, consultaId)
      setConsulta(c)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo finalizar la valoración')
    } finally {
      setFinalizando(false)
    }
  }

  if (cargando) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="h-20 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-96 animate-pulse rounded-lg bg-surface-2" />
      </div>
    )
  }

  if (!consulta) {
    return (
      <div className="mx-auto max-w-5xl rounded-lg border border-border bg-surface p-10 text-center">
        <p className="font-semibold text-ink">No se encontró la valoración</p>
        <p className="mt-1 text-sm text-muted">{error ?? 'No existe, o pertenece a otra clínica.'}</p>
        <Link
          to={`/pacientes/${id}`}
          className="mt-4 inline-block rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2"
        >
          Volver al expediente
        </Link>
      </div>
    )
  }

  const finalizada = consulta.estado === 'finalizada'
  const completas = consulta.seccionesCompletas
  const faltan = SECCIONES_EXIGIDAS.filter((s) => completas[s] !== true)

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link to={`/pacientes/${id}`} className="inline-block text-sm text-muted hover:text-ink">
        ← Expediente
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-surface p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-ink">{paciente?.nombre ?? 'Paciente'}</h1>
            <span
              className="rounded-pill px-2.5 py-0.5 text-xs font-semibold"
              style={{
                color: finalizada ? 'var(--status-normal)' : 'var(--status-alert)',
                backgroundColor: `color-mix(in srgb, ${
                  finalizada ? 'var(--status-normal)' : 'var(--status-alert)'
                } 14%, transparent)`,
              }}
            >
              {finalizada ? 'Finalizada' : 'En curso'}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted">
            Consulta #{consulta.numeroConsulta} ·{' '}
            {consulta.tipo === 'inicial' ? 'Inicial' : 'Seguimiento'} · {consulta.fechaConsulta}
          </p>
        </div>

        {!finalizada && (
          <button
            type="button"
            onClick={() => void finalizar()}
            disabled={finalizando || faltan.length > 0}
            title={
              faltan.length > 0
                ? `Faltan por completar: ${faltan
                    .map((f) => SECCIONES.find((s) => s.clave === f)?.etiqueta ?? f)
                    .join(', ')}`
                : undefined
            }
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {finalizando ? 'Finalizando…' : 'Finalizar valoración'}
          </button>
        )}
      </header>

      {finalizada && (
        <p className="rounded-md border border-border bg-surface-2 p-3 text-sm text-muted">
          Esta valoración está finalizada: se conserva como registro de lo que se valoró y no se
          puede editar.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
        >
          {error}
        </p>
      )}

      <TabsValoracion activa={tab} completas={completas} onCambiar={setTab} />

      {tab === 'antrop' && (
        <FormAntropometria
          pacienteId={id}
          consultaId={consultaId}
          edad={paciente?.edad ?? null}
          sexo={(paciente?.sexoBiologico ?? null) as never}
          bloqueada={finalizada}
          onGuardado={refrescar}
        />
      )}
      {tab === 'bioquim' && (
        <PanelBioquimica
          pacienteId={id}
          consultaId={consultaId}
          bloqueada={finalizada}
          onGuardado={refrescar}
        />
      )}
      {tab === 'clinico' && <EnConstruccion seccion="Valoración clínica" />}
      {tab === 'dietetico' && <EnConstruccion seccion="Valoración dietética" />}
      {tab === 'conclusion' && <EnConstruccion seccion="Conclusiones y diagnóstico nutricional" />}

      {/* Atajo de vuelta cuando la valoración ya se cerró. */}
      {finalizada && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => navigate(`/pacientes/${id}`)}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2"
          >
            Volver al expediente
          </button>
        </div>
      )}
    </div>
  )
}
