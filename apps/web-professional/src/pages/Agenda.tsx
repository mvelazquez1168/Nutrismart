/**
 * Agenda — CLI-03.
 *
 * Lista con filtros, agrupada por día. La vista de calendario mensual
 * queda fuera de la v1, como marca la épica.
 *
 * Todas las horas se formatean en el huso del NAVEGADOR: la API entrega
 * instantes en UTC crudo precisamente para no adivinar el huso del
 * profesional desde el servidor.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import {
  getCitas,
  getProfesionales,
  cambiarEstadoCita,
  registrarControl,
} from '../api/agenda'
import { getSnapshot } from '../api/expediente'
import { ChipEstadoCita } from '../components/ChipEstadoCita'
import { CITA_ESTADOS, type Cita, type CitaEstado, type Profesional } from '../api/tipos'
import { CitaModal } from '../components/CitaModal'
import { CitaDetalle } from '../components/CitaDetalle'
import { SnapshotModal } from '../components/SnapshotModal'
import { getMetricas } from '../api/expediente'
import type { MetricaCatalogo, SnapshotResumen } from '../api/tipos'
import {
  claveDia,
  etiquetaDia,
  hoyLocal,
  inicioDelDiaISO,
  rangoHoras,
  sumarDias,
} from '../lib/fechas'

const ETIQUETA_TIPO: Record<string, string> = {
  primera_vez: 'Primera vez',
  seguimiento: 'Seguimiento',
  control: 'Control',
}

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'listo'; citas: Cita[] }
  | { tipo: 'error'; mensaje: string }

export function Agenda() {
  const { perfil } = useAuth()
  const navigate = useNavigate()
  const esAdmin = perfil?.roles.includes('admin_clinica') ?? false

  const [desde, setDesde] = useState(hoyLocal())
  const [hasta, setHasta] = useState(sumarDias(hoyLocal(), 7))
  const [estado, setEstado] = useState<CitaEstado | ''>('')
  const [profesionalId, setProfesionalId] = useState('')

  const [profesionales, setProfesionales] = useState<Profesional[]>([])
  const [datos, setDatos] = useState<Estado>({ tipo: 'cargando' })
  const [recarga, setRecarga] = useState(0)

  const [creando, setCreando] = useState(false)
  const [editando, setEditando] = useState<Cita | null>(null)
  const [detalle, setDetalle] = useState<Cita | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)

  const [catalogo, setCatalogo] = useState<MetricaCatalogo[]>([])
  const [snapshotAbierto, setSnapshotAbierto] = useState<{
    snapshot: SnapshotResumen
    pacienteId: string
  } | null>(null)

  const cargar = useCallback(
    (signal?: AbortSignal) => {
      setDatos({ tipo: 'cargando' })
      getCitas(
        {
          desde: inicioDelDiaISO(desde),
          // `hasta` es exclusivo en la API, así que se pide el inicio del
          // día siguiente para que el último día del rango entre entero.
          hasta: inicioDelDiaISO(sumarDias(hasta, 1)),
          estado: estado === '' ? null : estado,
          profesionalId: profesionalId === '' ? null : profesionalId,
        },
        signal,
      )
        .then((citas) => {
          if (!signal?.aborted) setDatos({ tipo: 'listo', citas })
        })
        .catch((e: unknown) => {
          if (signal?.aborted) return
          if (e instanceof DOMException && e.name === 'AbortError') return
          setDatos({ tipo: 'error', mensaje: e instanceof Error ? e.message : 'Error desconocido' })
        })
    },
    [desde, hasta, estado, profesionalId],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    cargar(ctrl.signal)
    return () => ctrl.abort()
  }, [cargar, recarga])

  useEffect(() => {
    const ctrl = new AbortController()
    if (esAdmin) getProfesionales(ctrl.signal).then(setProfesionales).catch(() => {})
    getMetricas(ctrl.signal).then(setCatalogo).catch(() => {})
    return () => ctrl.abort()
  }, [esAdmin])

  async function accion(fn: () => Promise<unknown>) {
    if (ocupado) return
    setOcupado(true)
    setErrorAccion(null)
    try {
      await fn()
      setRecarga((n) => n + 1)
    } catch (e) {
      setErrorAccion(e instanceof Error ? e.message : 'No se pudo completar la acción')
    } finally {
      setOcupado(false)
    }
  }

  /** Crea el control desde la cita y abre el modal del snapshot recién creado. */
  async function abrirControl(cita: Cita, snapshotId?: string) {
    const id = snapshotId ?? (await registrarControl(cita.id)).snapshotId
    const snapshot = await getSnapshot(id)
    setDetalle(null)
    setSnapshotAbierto({ snapshot, pacienteId: cita.paciente.id })
  }

  const porDia = new Map<string, Cita[]>()
  if (datos.tipo === 'listo') {
    for (const c of datos.citas) {
      const clave = claveDia(c.inicio)
      porDia.set(clave, [...(porDia.get(clave) ?? []), c])
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Agenda</h1>
          <p className="text-sm text-muted">
            {esAdmin
              ? 'Citas de toda la clínica. Las horas se muestran en tu zona horaria.'
              : 'Tus citas. Las horas se muestran en tu zona horaria.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreando(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
        >
          + Nueva cita
        </button>
      </header>

      <section className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-ink">Desde</span>
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-primary"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-ink">Hasta</span>
          <input
            type="date"
            value={hasta}
            min={desde}
            onChange={(e) => setHasta(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-primary"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-ink">Estado</span>
          <select
            value={estado}
            onChange={(e) => setEstado(e.target.value as CitaEstado | '')}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-primary"
          >
            <option value="">Todos</option>
            {CITA_ESTADOS.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </label>

        {/* Solo para admin_clinica: un nutricionista solo se ve a sí mismo,
            así que el filtro no le ofrecería ninguna alternativa. */}
        {esAdmin && (
          <label className="text-sm">
            <span className="mb-1 block font-medium text-ink">Profesional</span>
            <select
              value={profesionalId}
              onChange={(e) => setProfesionalId(e.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-primary"
            >
              <option value="">Todos</option>
              {profesionales.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {errorAccion && (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
        >
          {errorAccion}
        </p>
      )}

      {datos.tipo === 'cargando' && (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      )}

      {datos.tipo === 'error' && (
        <div className="rounded-lg border border-border bg-surface p-10 text-center shadow-sm">
          <p className="font-semibold text-ink">No se pudo cargar la agenda</p>
          <p className="mt-1 text-sm text-muted">{datos.mensaje}</p>
          <button
            type="button"
            onClick={() => setRecarga((n) => n + 1)}
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
          >
            Reintentar
          </button>
        </div>
      )}

      {datos.tipo === 'listo' && datos.citas.length === 0 && (
        <div className="rounded-lg border border-border bg-surface p-10 text-center shadow-sm">
          <p className="font-semibold text-ink">No hay citas en este rango</p>
          <p className="mt-1 text-sm text-muted">Prueba con otras fechas o quita los filtros.</p>
        </div>
      )}

      {datos.tipo === 'listo' &&
        [...porDia.entries()].map(([dia, citas]) => (
          <section key={dia}>
            <h2 className="mb-2 text-sm font-semibold capitalize text-muted">
              {etiquetaDia(dia)}
            </h2>
            <ul className="space-y-2">
              {citas.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorAccion(null)
                      setDetalle(c)
                    }}
                    className="flex w-full flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4 text-left shadow-sm transition-colors hover:bg-surface-2"
                  >
                    <span className="w-28 shrink-0 text-sm font-semibold text-ink">
                      {rangoHoras(c.inicio, c.fin)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink">{c.paciente.nombre}</span>
                      <span className="block text-xs text-muted">
                        {ETIQUETA_TIPO[c.tipo] ?? c.tipo} · {c.duracionMinutos} min
                        {c.profesional ? ` · ${c.profesional}` : ''}
                      </span>
                    </span>
                    <ChipEstadoCita estado={c.estado} />
                    {c.snapshotId && (
                      <span className="rounded-pill bg-primary-tint px-2 py-0.5 text-xs font-medium text-primary">
                        Control registrado
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}

      <CitaModal
        abierto={creando || editando !== null}
        cita={editando}
        onCerrar={() => {
          setCreando(false)
          setEditando(null)
        }}
        onGuardado={() => {
          setCreando(false)
          setEditando(null)
          setRecarga((n) => n + 1)
        }}
      />

      <CitaDetalle
        abierto={detalle !== null}
        cita={detalle}
        ocupado={ocupado}
        error={errorAccion}
        onCerrar={() => setDetalle(null)}
        onEditar={(c) => {
          setDetalle(null)
          setEditando(c)
        }}
        onCompletar={(c) =>
          void accion(async () => {
            await cambiarEstadoCita(c.id, 'completada')
            setDetalle({ ...c, estado: 'completada' })
          })
        }
        onCancelar={(c) =>
          void accion(async () => {
            await cambiarEstadoCita(c.id, 'cancelada')
            setDetalle(null)
          })
        }
        onRegistrarControl={(c) => void accion(() => abrirControl(c))}
        onVerControl={(c) => void accion(() => abrirControl(c, c.snapshotId ?? undefined))}
      />

      {snapshotAbierto && (
        <SnapshotModal
          abierto
          pacienteId={snapshotAbierto.pacienteId}
          catalogo={catalogo}
          snapshot={snapshotAbierto.snapshot}
          onCerrar={() => setSnapshotAbierto(null)}
          onGuardado={() => {
            const pacienteId = snapshotAbierto.pacienteId
            setSnapshotAbierto(null)
            // Tras rellenar el control, la ficha del paciente es donde
            // tiene sentido seguir: allí está el timeline completo.
            navigate(`/pacientes/${pacienteId}`)
          }}
        />
      )}
    </div>
  )
}
