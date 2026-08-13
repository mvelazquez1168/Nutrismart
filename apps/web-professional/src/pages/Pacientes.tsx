/**
 * Pantalla "Pacientes".
 *
 * Layout de disenos/CLI/pacientes-lista-nutrismart.png. Se muestran solo
 * las columnas que la API entrega hoy; "Próxima cita" y la nota bajo el
 * badge (adherencia, biomarcadores) llegan en rebanadas posteriores y no
 * se maquetan en falso.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPacientes } from '../api/pacientes'
import type { EstadoClinico, Paciente } from '../api/tipos'
import { EstadoBadge } from '../components/EstadoBadge'
import { Avatar } from '../components/Avatar'
import { PacienteModal } from '../components/PacienteModal'

const FILTROS: { clave: EstadoClinico | null; etiqueta: string }[] = [
  { clave: null, etiqueta: 'Todos' },
  { clave: 'normal', etiqueta: 'Normal' },
  { clave: 'alerta', etiqueta: 'Alerta' },
  { clave: 'critico', etiqueta: 'Crítico' },
]

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'listo'; pacientes: Paciente[] }
  | { tipo: 'error'; mensaje: string }

function formatearFecha(iso: string | null): string {
  if (!iso) return '—'
  // La API ya envia 'YYYY-MM-DD'. Se parte a mano en vez de usar
  // new Date(iso), que interpreta la cadena como UTC y puede mostrar el
  // dia anterior segun la zona horaria del navegador.
  const [anio, mes, dia] = iso.split('-')
  if (!anio || !mes || !dia) return iso
  return `${dia}/${mes}/${anio}`
}

export function Pacientes() {
  const navigate = useNavigate()

  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState<EstadoClinico | null>(null)
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' })
  const [recarga, setRecarga] = useState(0)
  const [creando, setCreando] = useState(false)

  const abortRef = useRef<AbortController | null>(null)

  const cargar = useCallback((search: string, estadoClinico: EstadoClinico | null) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setEstado({ tipo: 'cargando' })

    getPacientes({ search, estadoClinico }, ctrl.signal)
      .then((pacientes) => {
        if (!ctrl.signal.aborted) setEstado({ tipo: 'listo', pacientes })
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        if (e instanceof DOMException && e.name === 'AbortError') return
        setEstado({ tipo: 'error', mensaje: e instanceof Error ? e.message : 'Error desconocido' })
      })
  }, [])

  // Debounce de la busqueda: sin el, cada tecla dispara una peticion.
  useEffect(() => {
    const id = setTimeout(() => cargar(busqueda, filtro), 250)
    return () => clearTimeout(id)
  }, [busqueda, filtro, recarga, cargar])

  useEffect(() => () => abortRef.current?.abort(), [])

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Pacientes</h1>
          <p className="text-sm text-muted">
            Gestiona el catálogo clínico de tu clínica y revisa el estado de cada paciente.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreando(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
        >
          + Agregar paciente
        </button>
      </header>

      <section className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o documento…"
          aria-label="Buscar pacientes"
          className="min-w-64 flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
        />

        <div
          className="flex gap-1 rounded-md bg-surface-2 p-1"
          role="group"
          aria-label="Filtrar por estado clínico"
        >
          {FILTROS.map((f) => {
            const activo = f.clave === filtro
            return (
              <button
                key={f.etiqueta}
                type="button"
                aria-pressed={activo}
                onClick={() => setFiltro(f.clave)}
                className={
                  activo
                    ? 'rounded-sm bg-surface px-3 py-1.5 text-sm font-semibold text-ink shadow-sm'
                    : 'rounded-sm px-3 py-1.5 text-sm text-muted hover:text-ink'
                }
              >
                {f.etiqueta}
              </button>
            )
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-md">
        {estado.tipo === 'cargando' && <Skeleton />}

        {estado.tipo === 'error' && (
          <div className="p-10 text-center">
            <p className="font-semibold text-ink">No se pudieron cargar los pacientes</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">{estado.mensaje}</p>
            <button
              type="button"
              onClick={() => setRecarga((n) => n + 1)}
              className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
            >
              Reintentar
            </button>
          </div>
        )}

        {estado.tipo === 'listo' && estado.pacientes.length === 0 && (
          <div className="p-10 text-center">
            <p className="font-semibold text-ink">
              {busqueda || filtro ? 'Ningún paciente coincide' : 'Aún no tienes pacientes'}
            </p>
            <p className="mt-1 text-sm text-muted">
              {busqueda || filtro
                ? 'Prueba con otro texto o quita el filtro de estado.'
                : 'Cuando registres pacientes en tu clínica aparecerán aquí.'}
            </p>
          </div>
        )}

        {estado.tipo === 'listo' && estado.pacientes.length > 0 && (
          <>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted">
                  <th className="px-5 py-3">Nombre</th>
                  <th className="px-5 py-3">Edad</th>
                  <th className="px-5 py-3">Última visita</th>
                  <th className="px-5 py-3">Estado clínico</th>
                  <th className="px-5 py-3">Nutricionista</th>
                </tr>
              </thead>
              <tbody>
                {estado.pacientes.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/pacientes/${p.id}`)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/pacientes/${p.id}`)
                    }}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar nombre={p.nombre} />
                        <span className="font-semibold text-ink">{p.nombre}</span>
                        {/*
                          Un inactivo sigue en la lista (puede volver), pero no
                          debe leerse igual que uno en seguimiento. Se marca
                          explicitamente en vez de solo atenuar el color: un
                          gris mas claro se confunde con un estilo decorativo.
                        */}
                        {p.estado === 'inactivo' && (
                          <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                            Inactivo
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-ink">
                      {p.edad === null ? '—' : `${p.edad} años`}
                    </td>
                    <td className="px-5 py-3 text-muted">{formatearFecha(p.ultimaVisita)}</td>
                    <td className="px-5 py-3">
                      <EstadoBadge estado={p.estadoClinico} />
                    </td>
                    <td className="px-5 py-3 text-ink">{p.nutricionista ?? '— Sin asignar'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="border-t border-border px-5 py-3 text-sm text-muted">
              Mostrando {estado.pacientes.length}{' '}
              {estado.pacientes.length === 1 ? 'paciente' : 'pacientes'}
            </div>
          </>
        )}
      </section>

      <PacienteModal
        abierto={creando}
        paciente={null}
        onCerrar={() => setCreando(false)}
        onGuardado={() => {
          setCreando(false)
          setRecarga((n) => n + 1)
        }}
      />
    </div>
  )
}

function Skeleton() {
  return (
    <div className="divide-y divide-border" aria-busy="true" aria-label="Cargando pacientes">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-4">
          <div className="h-9 w-9 animate-pulse rounded-pill bg-surface-2" />
          <div className="h-4 flex-1 animate-pulse rounded-sm bg-surface-2" />
          <div className="h-4 w-16 animate-pulse rounded-sm bg-surface-2" />
          <div className="h-5 w-20 animate-pulse rounded-pill bg-surface-2" />
          <div className="h-4 w-40 animate-pulse rounded-sm bg-surface-2" />
        </div>
      ))}
    </div>
  )
}
