/**
 * Laboratorios de la valoración — EVAL-02, reorganizado en R36.
 *
 * ── Por qué esta sección se llamaba «Bioquímica» ────────────────────
 *
 * Nunca fueron dos cosas distintas: esta pantalla ya leía los mismos
 * estudios de laboratorio del expediente —`/labs/nutricional`—, solo
 * que filtrados a los marcadores de interés nutricional de los últimos
 * 90 días. Dos nombres para un dato invitan a buscar en el sitio
 * equivocado, así que se unifican bajo «Laboratorios».
 *
 * Ahora la sección tiene las dos mitades juntas: arriba la lectura
 * clínica por grupos de biomarcadores, abajo los estudios cargados, con
 * su descarga y el botón para registrar uno nuevo. Antes eso último
 * vivía en una pestaña aparte de la ficha y obligaba a salir de la
 * consulta para subir un PDF que se acababa de recibir.
 *
 * Los grupos son los del catálogo de biomarcadores, no una
 * clasificación propia: así el informe y la valoración hablan de lo
 * mismo.
 *
 * ── Dos pestañas desde R49 ──────────────────────────────────────────
 *
 * **Estudios** es todo lo anterior, sin un solo cambio. **Analítica**
 * es la vista traspuesta: en vez de «qué trajo cada informe», «cómo ha
 * ido cada analito». Son las dos preguntas de un seguimiento, y ninguna
 * se contesta bien con la forma de la otra.
 *
 * El contenido de Estudios se extrajo a `ContenidoEstudios` tal cual
 * estaba. Tiene tres salidas distintas —error, vacío y el panel
 * completo— y envolverlo en pestañas desde dentro habría obligado a
 * tocar las tres. Lo que decide qué se ve vive aquí fuera.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { getBioquimica, marcarSeccion, type Bioquimica, type EstadoMarcador } from '../../api/valoracion'
import { eliminarEstudio, getLaboratorios } from '../../api/laboratorios'
import type { EstudioLab, SexoBiologico } from '../../api/tipos'
import { ListaLaboratorios } from '../ListaLaboratorios'
import { LaboratorioModal } from '../LaboratorioModal'
import { PanelAnalitica } from './PanelAnalitica'

const COLOR: Record<EstadoMarcador, string> = {
  normal: 'var(--status-normal)',
  bajo: 'var(--status-alert)',
  alto: 'var(--status-alert)',
  sin_referencia: 'var(--muted)',
}

const ETIQUETA: Record<EstadoMarcador, string> = {
  normal: 'Normal',
  bajo: 'Bajo',
  alto: 'Alto',
  sin_referencia: 'Sin referencia',
}

function ChipEstado({ estado }: { estado: EstadoMarcador }) {
  return (
    <span
      className="rounded-pill px-2 py-0.5 text-xs font-semibold"
      style={{
        color: COLOR[estado],
        backgroundColor: `color-mix(in srgb, ${COLOR[estado]} 14%, transparent)`,
      }}
    >
      {ETIQUETA[estado]}
    </span>
  )
}

function rangoTexto(rango: { minimo: number | null; maximo: number | null } | null): string {
  if (!rango || (rango.minimo === null && rango.maximo === null)) return '—'
  if (rango.minimo !== null && rango.maximo !== null) return `${rango.minimo} – ${rango.maximo}`
  if (rango.minimo !== null) return `≥ ${rango.minimo}`
  return `≤ ${rango.maximo}`
}

interface Props {
  pacienteId: string
  consultaId: string
  bloqueada: boolean
  /** Decide qué rangos se ofrecen al capturar un estudio nuevo. */
  sexoPaciente: SexoBiologico | null
  onGuardado: () => void | Promise<void>
}

/** Lo que había antes de R49, sin cambios. */
function ContenidoEstudios({
  pacienteId,
  consultaId,
  bloqueada,
  sexoPaciente,
  onGuardado,
}: Props) {
  const [datos, setDatos] = useState<Bioquimica | null>(null)
  const [cargando, setCargando] = useState(true)
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [marcando, setMarcando] = useState(false)
  // Los estudios cargados, que antes vivían en la pestaña Laboratorios
  // de la ficha. Se piden aparte de la lectura por marcadores: son la
  // misma fuente vista de dos maneras, y una puede fallar sin la otra.
  const [estudios, setEstudios] = useState<EstudioLab[]>([])
  const [modal, setModal] = useState(false)

  const cargarEstudios = useCallback(
    (signal?: AbortSignal) =>
      getLaboratorios(pacienteId, signal)
        .then((e) => {
          if (!signal?.aborted) setEstudios(e)
        })
        .catch(() => {
          // Que no se pueda listar los estudios no puede tapar la
          // lectura de marcadores, que es lo que se mira en consulta.
        }),
    [pacienteId],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    void cargarEstudios(ctrl.signal)
    return () => ctrl.abort()
  }, [cargarEstudios])

  useEffect(() => {
    const ctrl = new AbortController()
    setCargando(true)
    getBioquimica(pacienteId, 90, ctrl.signal)
      .then((d) => {
        if (ctrl.signal.aborted) return
        setDatos(d)
        // Se despliegan solos los grupos con algo alterado: es lo que hay
        // que mirar, y obligar a abrirlos uno a uno esconde justo eso.
        setAbiertos(new Set(d.grupos.filter((g) => g.tieneAlterados).map((g) => g.nombre)))
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) {
          setError(e instanceof ApiError ? e.message : 'No se pudieron cargar los laboratorios')
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false)
      })
    return () => ctrl.abort()
  }, [pacienteId])

  async function marcarCompleta() {
    setMarcando(true)
    try {
      await marcarSeccion(pacienteId, consultaId, 'bioquim', true)
      await onGuardado()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo marcar la sección')
    } finally {
      setMarcando(false)
    }
  }

  if (cargando) return <div className="h-64 animate-pulse rounded-lg bg-surface-2" />

  if (error) {
    return (
      <p
        role="alert"
        className="rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
      >
        {error}
      </p>
    )
  }

  if (!datos || datos.totalMarcadores === 0) {
    return (
      <div
        className="rounded-lg border bg-surface p-6 text-center"
        style={{ borderColor: 'var(--status-alert)' }}
      >
        <p className="text-sm font-medium text-ink">Sin laboratorios en los últimos 90 días</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">
          La lectura por marcadores se construye con los estudios cargados en el expediente.
          Se puede registrar uno aquí mismo.
        </p>
        {!bloqueada && (
          <button
            type="button"
            onClick={() => setModal(true)}
            className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
          >
            + Registrar laboratorio
          </button>
        )}
        <p className="mt-3 text-xs text-muted">
          O revisar el <Link to={`/pacientes/${pacienteId}`} className="text-primary hover:underline">expediente completo</Link>.
        </p>

        <LaboratorioModal
          abierto={modal}
          pacienteId={pacienteId}
          sexoPaciente={sexoPaciente}
          onCerrar={() => setModal(false)}
          onGuardado={() => {
            setModal(false)
            void cargarEstudios()
            void onGuardado()
          }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
        <div>
          <p className="text-sm font-semibold text-ink">
            Último estudio: {datos.fechaMasReciente ?? '—'}
          </p>
          <p className="text-xs text-muted">
            {datos.totalMarcadores} marcadores · se muestra el valor más reciente de cada uno
          </p>
        </div>
        <span
          className="rounded-pill px-3 py-1 text-xs font-semibold"
          style={{
            color: datos.marcadoresAlterados > 0 ? 'var(--status-alert)' : 'var(--status-normal)',
            backgroundColor: `color-mix(in srgb, ${
              datos.marcadoresAlterados > 0 ? 'var(--status-alert)' : 'var(--status-normal)'
            } 14%, transparent)`,
          }}
        >
          {datos.marcadoresAlterados > 0
            ? `${datos.marcadoresAlterados} fuera de rango`
            : 'Todo dentro de rango'}
        </span>
      </div>

      {datos.alterados.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Marcadores a revisar
          </p>
          <ul className="flex flex-wrap gap-2">
            {datos.alterados.map((m) => (
              <li key={m.codigo}>
                <span className="rounded-pill bg-surface-2 px-2.5 py-1 text-xs text-ink">
                  {m.nombre} · {ETIQUETA[m.estado].toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="space-y-2">
        {datos.grupos.map((g) => {
          const abierto = abiertos.has(g.nombre)
          return (
            <li key={g.nombre} className="overflow-hidden rounded-lg border border-border bg-surface">
              <button
                type="button"
                aria-expanded={abierto}
                onClick={() =>
                  setAbiertos((prev) => {
                    const s = new Set(prev)
                    if (s.has(g.nombre)) s.delete(g.nombre)
                    else s.add(g.nombre)
                    return s
                  })
                }
                className="flex w-full items-center justify-between gap-2 bg-surface-2 px-4 py-2.5 text-left"
              >
                <span className="text-sm font-semibold text-ink">
                  {g.nombre}
                  <span className="ml-2 font-normal text-muted">
                    {g.marcadores.length} marcador{g.marcadores.length === 1 ? '' : 'es'}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {g.tieneAlterados && (
                    <span
                      className="rounded-pill px-2 py-0.5 text-xs font-semibold"
                      style={{
                        color: 'var(--status-alert)',
                        backgroundColor: 'color-mix(in srgb, var(--status-alert) 14%, transparent)',
                      }}
                    >
                      Revisar
                    </span>
                  )}
                  <span aria-hidden="true" className="text-muted">
                    {abierto ? '−' : '+'}
                  </span>
                </span>
              </button>

              {abierto && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                          Marcador
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted">
                          Valor
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted">
                          Referencia
                        </th>
                        <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                          Estado
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {g.marcadores.map((m) => (
                        <tr key={m.codigo}>
                          <td className="px-4 py-2 text-ink">{m.nombre}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-ink">
                            {m.valor} {m.unidad}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-muted">
                            {rangoTexto(m.rango)}
                          </td>
                          <td className="px-4 py-2">
                            <ChipEstado estado={m.estado} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <p className="text-xs text-muted">
        «Bajo» y «alto» son aritmética contra el rango declarado por la clínica, no un diagnóstico.
      </p>

      {/* ---- Estudios cargados (antes: pestaña Laboratorios) ---- */}
      <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-ink">Estudios cargados</h3>
            <p className="mt-0.5 text-xs text-muted">
              {estudios.length === 0
                ? 'Ninguno todavía.'
                : `${estudios.length} ${estudios.length === 1 ? 'estudio' : 'estudios'} en el expediente.`}
            </p>
          </div>
          {!bloqueada && (
            <button
              type="button"
              onClick={() => setModal(true)}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
            >
              + Registrar laboratorio
            </button>
          )}
        </div>
        {estudios.length > 0 && (
          <ListaLaboratorios
            estudios={estudios}
            /*
              Se quita del estado local y ADEMÁS se recarga — R51.
              Lo primero hace que desaparezca al instante; lo segundo pone al
              día lo que el borrado cambia y esta pantalla no puede deducir:
              la lectura por marcadores de arriba y las series de Analítica.
            */
            onEliminar={async (estudioId) => {
              await eliminarEstudio(pacienteId, estudioId)
              setEstudios((prev) => prev.filter((x) => x.id !== estudioId))
              void cargarEstudios()
              void onGuardado()
            }}
          />
        )}
      </section>

      {!bloqueada && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void marcarCompleta()}
            disabled={marcando}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {marcando ? 'Guardando…' : 'Marcar laboratorios revisados'}
          </button>
        </div>
      )}

      <LaboratorioModal
        abierto={modal}
        pacienteId={pacienteId}
        sexoPaciente={sexoPaciente}
        onCerrar={() => setModal(false)}
        onGuardado={() => {
          setModal(false)
          // Recargar las dos mitades: un estudio nuevo cambia la lista y
          // puede cambiar la lectura por marcadores.
          void cargarEstudios()
          void onGuardado()
        }}
      />
    </div>
  )
}

type Pestana = 'estudios' | 'analitica'

/**
 * Las dos vistas del laboratorio — R49, R50.
 *
 * La pestaña activa vive aquí y no en la URL: es una preferencia de lectura
 * dentro de una sección, no un sitio al que se llega con un enlace. Y las dos
 * mitades se montan y desmontan al cambiar, que es lo que hace que la
 * analítica pida sus datos cuando de verdad se va a mirar.
 */
export function PanelBioquimica(props: Props) {
  const [pestana, setPestana] = useState<Pestana>('estudios')

  const tabs: { clave: Pestana; etiqueta: string }[] = [
    { clave: 'estudios', etiqueta: 'Estudios' },
    { clave: 'analitica', etiqueta: 'Analítica' },
  ]

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto border-b border-border">
        <nav className="flex min-w-max gap-1" aria-label="Vistas del laboratorio">
          {tabs.map((t) => {
            const activa = t.clave === pestana
            return (
              <button
                key={t.clave}
                type="button"
                onClick={() => setPestana(t.clave)}
                aria-current={activa ? 'page' : undefined}
                className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition-colors ${
                  activa
                    ? 'border-primary font-semibold text-primary'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {t.etiqueta}
              </button>
            )
          })}
        </nav>
      </div>

      {/*
        **`display: none`, no renderizado condicional.**

        Las dos mitades se montan una vez y se quedan montadas. Con el
        condicional, volver a «Estudios» y regresar perdía el grupo elegido en
        la analítica y la volvía a pedir al servidor; y al revés, cambiar de
        pestaña remontaba la lista de estudios. Una pestaña es un cambio de
        vista, no de pantalla: lo que se deja a medias debe seguir ahí.

        El precio es que la analítica pide sus datos al cargar el panel aunque
        nadie llegue a abrirla. Es una lectura, y se paga una vez.
      */}
      <div style={{ display: pestana === 'estudios' ? 'block' : 'none' }}>
        <ContenidoEstudios {...props} />
      </div>
      <div style={{ display: pestana === 'analitica' ? 'block' : 'none' }}>
        <PanelAnalitica pacienteId={props.pacienteId} />
      </div>
    </div>
  )
}
