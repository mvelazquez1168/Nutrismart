/**
 * Ficha del paciente — /pacientes/:id
 *
 * Dos pestañas activas tras la Rebanada 3: Resumen (estado actual) e
 * Historial (timeline de puntos de control). Citas y Sociodemografía
 * siguen apagadas: pertenecen a CLI-03 y CLI-07.
 */
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { getPaciente } from '../api/pacientes'
import {
  getExpediente,
  getMetricas,
  getTimeline,
  cerrarSnapshot,
  corregirSnapshot,
} from '../api/expediente'
import type {
  Expediente,
  MetricaCatalogo,
  PacienteDetalle,
  SnapshotResumen,
} from '../api/tipos'
import { getLaboratorios } from '../api/laboratorios'
import type { EstudioLab } from '../api/tipos'
import { EstadoBadge } from '../components/EstadoBadge'
import { Avatar } from '../components/Avatar'
import { LaboratorioModal } from '../components/LaboratorioModal'
import { ListaLaboratorios, UltimosLaboratorios } from '../components/ListaLaboratorios'
import { PacienteModal } from '../components/PacienteModal'
import { BajaModal } from '../components/BajaModal'
import { SnapshotModal } from '../components/SnapshotModal'
import { Timeline } from '../components/Timeline'
import { MetricasVitales } from '../components/MetricasVitales'

type Pestana = 'resumen' | 'historial' | 'laboratorios'

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'listo'; paciente: PacienteDetalle }
  | { tipo: 'error'; mensaje: string; status?: number }

const ETIQUETA_SEXO: Record<string, string> = {
  masculino: 'Masculino',
  femenino: 'Femenino',
  intersexual: 'Intersexual',
}

const ETIQUETA_DOCUMENTO: Record<string, string> = {
  cedula: 'Cédula',
  dimex: 'DIMEX',
  pasaporte: 'Pasaporte',
  nite: 'NITE',
}

const ETIQUETA_ANTECEDENTE: Record<string, string> = {
  personal: 'Personal',
  familiar: 'Familiar',
  quirurgico: 'Quirúrgico',
}

function formatearFecha(iso: string | null): string {
  if (!iso) return '—'
  const [anio, mes, dia] = iso.slice(0, 10).split('-')
  if (!anio || !mes || !dia) return iso
  return `${dia}/${mes}/${anio}`
}

export function PacienteFicha() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' })
  const [expediente, setExpediente] = useState<Expediente | null>(null)
  const [timeline, setTimeline] = useState<SnapshotResumen[]>([])
  const [laboratorios, setLaboratorios] = useState<EstudioLab[]>([])
  const [catalogo, setCatalogo] = useState<MetricaCatalogo[]>([])
  const [labModal, setLabModal] = useState(false)

  const [pestana, setPestana] = useState<Pestana>('resumen')
  const [editando, setEditando] = useState(false)
  const [dandoBaja, setDandoBaja] = useState(false)
  const [snapshotModal, setSnapshotModal] = useState<{ abierto: boolean; snapshot: SnapshotResumen | null }>(
    { abierto: false, snapshot: null },
  )
  const [ocupado, setOcupado] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)

  const cargar = useCallback(
    (signal?: AbortSignal) => {
      setEstado({ tipo: 'cargando' })

      // Las tres peticiones van juntas: son independientes y encadenarlas
      // triplicaría la espera antes de pintar nada.
      Promise.all([
        getPaciente(id, signal),
        getExpediente(id, signal),
        getTimeline(id, signal),
        getLaboratorios(id, signal),
      ])
        .then(([paciente, exp, tl, labs]) => {
          if (signal?.aborted) return
          setEstado({ tipo: 'listo', paciente })
          setExpediente(exp)
          setTimeline(tl)
          setLaboratorios(labs)
        })
        .catch((e: unknown) => {
          if (signal?.aborted) return
          if (e instanceof DOMException && e.name === 'AbortError') return
          const status = (e as { status?: number }).status
          setEstado({
            tipo: 'error',
            mensaje: e instanceof Error ? e.message : 'Error desconocido',
            ...(status !== undefined ? { status } : {}),
          })
        })
    },
    [id],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    cargar(ctrl.signal)
    return () => ctrl.abort()
  }, [cargar])

  // El catálogo cambia rara vez: se pide una sola vez, no en cada recarga.
  useEffect(() => {
    const ctrl = new AbortController()
    getMetricas(ctrl.signal)
      .then(setCatalogo)
      .catch(() => {
        /* sin catálogo el modal no se puede abrir; se avisa al intentarlo */
      })
    return () => ctrl.abort()
  }, [])

  async function accion(fn: () => Promise<unknown>) {
    if (ocupado) return
    setOcupado(true)
    setErrorAccion(null)
    try {
      await fn()
      cargar()
    } catch (e) {
      setErrorAccion(e instanceof Error ? e.message : 'No se pudo completar la acción')
    } finally {
      setOcupado(false)
    }
  }

  if (estado.tipo === 'cargando') {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="h-24 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-64 animate-pulse rounded-lg bg-surface-2" />
      </div>
    )
  }

  if (estado.tipo === 'error') {
    const esNoEncontrado = estado.status === 404
    return (
      <div className="mx-auto max-w-5xl">
        <div className="rounded-lg border border-border bg-surface p-10 text-center shadow-md">
          <p className="font-semibold text-ink">
            {esNoEncontrado ? 'Paciente no encontrado' : 'No se pudo cargar el paciente'}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {esNoEncontrado ? 'No existe, o pertenece a otra clínica.' : estado.mensaje}
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Link
              to="/pacientes"
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2"
            >
              Volver a Pacientes
            </Link>
            {!esNoEncontrado && (
              <button
                type="button"
                onClick={() => cargar()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
              >
                Reintentar
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const p = estado.paciente
  const hayBorrador = timeline.some((s) => s.estado === 'borrador')

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link to="/pacientes" className="inline-block text-sm text-muted hover:text-ink">
        ← Pacientes
      </Link>

      <header className="rounded-lg border border-border bg-surface p-5 shadow-md">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar nombre={p.nombre} />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-ink">{p.nombre}</h1>
                <EstadoBadge estado={p.estadoClinico} />
                {p.estado !== 'activo' && (
                  <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                    {p.estado === 'baja' ? 'Archivado' : 'Inactivo'}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted">
                {p.edad !== null ? `${p.edad} años · ` : ''}
                Expediente #{p.numeroExpediente ?? '—'}
                {p.nutricionista ? ` · ${p.nutricionista}` : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={ocupado}
              onClick={() => setSnapshotModal({ abierto: true, snapshot: null })}
              title={
                hayBorrador
                  ? 'Ya hay un control en borrador: ciérralo o edítalo antes de crear otro'
                  : undefined
              }
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
            >
              + Punto de control
            </button>
            <button
              type="button"
              onClick={() => setEditando(true)}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2"
            >
              Editar
            </button>
            {p.estado !== 'baja' && (
              <button
                type="button"
                onClick={() => setDandoBaja(true)}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"
              >
                Dar de baja
              </button>
            )}
          </div>
        </div>

        {p.baja && (
          <div className="mt-4 rounded-md border border-border bg-surface-2 p-3 text-sm">
            <span className="font-semibold text-ink">
              Archivado el {formatearFecha(p.baja.fecha)}
            </span>
            {p.baja.motivo && <span className="text-muted"> · {p.baja.motivo}</span>}
          </div>
        )}
      </header>

      {errorAccion && (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
        >
          {errorAccion}
        </p>
      )}

      <div className="flex gap-1 border-b border-border">
        <Tab activa={pestana === 'resumen'} onClick={() => setPestana('resumen')}>
          Resumen
        </Tab>
        <Tab activa={pestana === 'historial'} onClick={() => setPestana('historial')}>
          Historial ({timeline.length})
        </Tab>
        <Tab activa={pestana === 'laboratorios'} onClick={() => setPestana('laboratorios')}>
          Laboratorios ({laboratorios.length})
        </Tab>
        <TabApagada>Citas</TabApagada>
        <TabApagada>Sociodemografía</TabApagada>
      </div>

      {pestana === 'resumen' ? (
        <div className="space-y-5">
          <MetricasVitales metricas={expediente?.metricas ?? []} />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <section className="rounded-lg border border-border bg-surface p-5 shadow-sm lg:col-span-2">
              <h2 className="mb-4 font-semibold text-ink">Datos del paciente</h2>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <Dato etiqueta="Documento">
                  {p.documento.numero
                    ? `${ETIQUETA_DOCUMENTO[p.documento.tipo ?? ''] ?? ''} ${p.documento.numero}`.trim()
                    : '—'}
                </Dato>
                <Dato etiqueta="Fecha de nacimiento">{formatearFecha(p.fechaNacimiento)}</Dato>
                <Dato etiqueta="Sexo biológico">
                  {p.sexoBiologico ? (ETIQUETA_SEXO[p.sexoBiologico] ?? p.sexoBiologico) : '—'}
                </Dato>
                <Dato etiqueta="Teléfono">{p.telefono ?? '—'}</Dato>
                <Dato etiqueta="Correo">{p.correo ?? '—'}</Dato>
                <Dato etiqueta="Nutricionista">{p.nutricionista ?? '— Sin asignar'}</Dato>
              </dl>

              <div className="mt-5 border-t border-border pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Motivo de consulta
                </h3>
                <p className="mt-1 text-sm text-ink">{p.motivoConsulta ?? '— Sin registrar'}</p>
              </div>
            </section>

            <div className="space-y-5">
              <section
                className="rounded-lg border bg-surface p-5 shadow-sm"
                style={{ borderColor: 'var(--status-alert)' }}
              >
                <h2 className="mb-3 font-semibold text-ink">Alergias e intolerancias</h2>
                {p.alergias.length === 0 ? (
                  <p className="text-sm text-muted">Sin registrar</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {p.alergias.map((a) => (
                      <li
                        key={a.descripcion}
                        className="badge-estado"
                        style={{ '--estado-color': 'var(--status-alert)' } as CSSProperties}
                      >
                        {a.descripcion}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
                <h2 className="mb-3 font-semibold text-ink">Diagnósticos activos</h2>
                {p.diagnosticos.length === 0 ? (
                  <p className="text-sm text-muted">Sin diagnósticos registrados</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {p.diagnosticos.map((d) => (
                      <li
                        key={d.descripcion}
                        className="rounded-pill bg-primary-tint px-2.5 py-0.5 text-xs font-medium text-primary"
                      >
                        {d.descripcion}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <UltimosLaboratorios estudios={laboratorios} />

              <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
                <h2 className="mb-3 font-semibold text-ink">Antecedentes</h2>
                {(expediente?.antecedentes.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted">Sin antecedentes registrados</p>
                ) : (
                  <ul className="space-y-1.5">
                    {expediente?.antecedentes.map((a) => (
                      <li key={`${a.tipo}-${a.descripcion}`} className="text-sm text-ink">
                        <span className="text-xs uppercase tracking-wide text-muted">
                          {ETIQUETA_ANTECEDENTE[a.tipo] ?? a.tipo}
                        </span>
                        <br />
                        {a.descripcion}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : pestana === 'laboratorios' ? (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setLabModal(true)}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
            >
              + Registrar laboratorio
            </button>
          </div>
          <ListaLaboratorios estudios={laboratorios} />
        </div>
      ) : (
        <Timeline
          snapshots={timeline}
          ocupado={ocupado}
          onEditar={(s) => setSnapshotModal({ abierto: true, snapshot: s })}
          onCerrar={(s) => void accion(() => cerrarSnapshot(s.id))}
          onCorregir={(s) =>
            void accion(async () => {
              await corregirSnapshot(s.id)
              // La corrección nace en borrador; se lleva al usuario al
              // Historial para que vea qué acaba de crearse.
              setPestana('historial')
            })
          }
        />
      )}

      <PacienteModal
        abierto={editando}
        paciente={p}
        onCerrar={() => setEditando(false)}
        onGuardado={() => {
          setEditando(false)
          cargar()
        }}
      />

      <BajaModal
        abierto={dandoBaja}
        pacienteId={p.id}
        nombrePaciente={p.nombre}
        onCerrar={() => setDandoBaja(false)}
        onConfirmado={() => {
          setDandoBaja(false)
          navigate('/pacientes')
        }}
      />

      <LaboratorioModal
        abierto={labModal}
        pacienteId={p.id}
        sexoPaciente={p.sexoBiologico}
        onCerrar={() => setLabModal(false)}
        onGuardado={() => {
          setLabModal(false)
          setPestana('laboratorios')
          cargar()
        }}
      />

      <SnapshotModal
        abierto={snapshotModal.abierto}
        pacienteId={p.id}
        catalogo={catalogo}
        snapshot={snapshotModal.snapshot}
        onCerrar={() => setSnapshotModal({ abierto: false, snapshot: null })}
        onGuardado={() => {
          setSnapshotModal({ abierto: false, snapshot: null })
          setPestana('historial')
          cargar()
        }}
      />
    </div>
  )
}

function Tab({
  activa,
  onClick,
  children,
}: {
  activa: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={activa ? 'page' : undefined}
      className={
        activa
          ? '-mb-px border-b-2 border-primary px-4 py-2 text-sm font-semibold text-primary'
          : '-mb-px border-b-2 border-transparent px-4 py-2 text-sm text-muted hover:text-ink'
      }
    >
      {children}
    </button>
  )
}

function TabApagada({ children }: { children: ReactNode }) {
  return (
    <span
      aria-disabled="true"
      title="Disponible en una rebanada posterior"
      className="cursor-not-allowed px-4 py-2 text-sm text-muted opacity-60"
    >
      {children}
    </span>
  )
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  )
}
