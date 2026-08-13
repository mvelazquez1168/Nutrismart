/**
 * Ficha del paciente — /pacientes/:id
 *
 * Pestaña Resumen con lo que existe hoy. Las demás pestañas y las
 * tarjetas de métricas se muestran como placeholders explícitos, no
 * maquetadas con datos falsos: un gráfico de ejemplo en una ficha
 * clínica se confunde con datos reales del paciente.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { getPaciente } from '../api/pacientes'
import type { PacienteDetalle } from '../api/tipos'
import { EstadoBadge } from '../components/EstadoBadge'
import { Avatar } from '../components/Avatar'
import { PacienteModal } from '../components/PacienteModal'
import { BajaModal } from '../components/BajaModal'

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'listo'; paciente: PacienteDetalle }
  | { tipo: 'error'; mensaje: string; status?: number }

const PESTANAS = [
  { clave: 'resumen', etiqueta: 'Resumen', disponible: true },
  { clave: 'citas', etiqueta: 'Citas', disponible: false },
  { clave: 'historial', etiqueta: 'Historial', disponible: false },
  { clave: 'socio', etiqueta: 'Sociodemografía', disponible: false },
]

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
  const [editando, setEditando] = useState(false)
  const [dandoBaja, setDandoBaja] = useState(false)

  const cargar = useCallback(
    (signal?: AbortSignal) => {
      setEstado({ tipo: 'cargando' })
      getPaciente(id, signal)
        .then((paciente) => {
          if (!signal?.aborted) setEstado({ tipo: 'listo', paciente })
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
            {esNoEncontrado
              ? 'No existe, o pertenece a otra clínica.'
              : estado.mensaje}
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

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link to="/pacientes" className="inline-block text-sm text-muted hover:text-ink">
        ← Pacientes
      </Link>

      {/* Encabezado */}
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

          <div className="flex gap-2">
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
            <span className="font-semibold text-ink">Archivado el {formatearFecha(p.baja.fecha)}</span>
            {p.baja.motivo && <span className="text-muted"> · {p.baja.motivo}</span>}
          </div>
        )}
      </header>

      {/* Pestañas */}
      <div className="flex gap-1 border-b border-border">
        {PESTANAS.map((t) =>
          t.disponible ? (
            <span
              key={t.clave}
              aria-current="page"
              className="-mb-px border-b-2 border-primary px-4 py-2 text-sm font-semibold text-primary"
            >
              {t.etiqueta}
            </span>
          ) : (
            <span
              key={t.clave}
              aria-disabled="true"
              title="Disponible en una rebanada posterior"
              className="cursor-not-allowed px-4 py-2 text-sm text-muted opacity-60"
            >
              {t.etiqueta}
            </span>
          ),
        )}
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="rounded-lg border border-border bg-surface p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-4 font-semibold text-ink">Datos del paciente</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Dato etiqueta="Documento">
              {p.documento.numero
                ? `${ETIQUETA_DOCUMENTO[p.documento.tipo ?? ''] ?? p.documento.tipo ?? ''} ${p.documento.numero}`.trim()
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
          {/*
            Las alergias van primero y destacadas: es el dato de esta
            pantalla que puede causar daño si se pasa por alto.
          */}
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
                    style={{ '--estado-color': 'var(--status-alert)' } as React.CSSProperties}
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

          <section className="rounded-lg border border-dashed border-border bg-surface p-5">
            <h2 className="mb-1 font-semibold text-muted">Métricas y evolución</h2>
            <p className="text-sm text-muted">
              Aún sin registros — se llenan en la primera valoración.
            </p>
          </section>
        </div>
      </div>

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
          // Tras la baja el paciente ya no está en la lista; volver allí
          // es lo que el profesional espera después de archivar.
          navigate('/pacientes')
        }}
      />
    </div>
  )
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  )
}
