/**
 * Reglas de alerta y alertas abiertas de un paciente — RPM-03.
 *
 * Se edita desde el detalle de monitoreo, que es donde el profesional
 * está mirando los datos: poner el umbral justo al lado de la cifra que
 * lo motiva es lo que hace que se ponga.
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError, apiDelete, apiGet, apiPatch, apiPut } from '../../api/client'
import { useCambiosSinGuardar } from '../../contexts/CambiosSinGuardar'

export const METRICAS = [
  { clave: 'peso', etiqueta: 'Peso', unidad: 'kg', silencio: false },
  { clave: 'glucosa', etiqueta: 'Glucosa', unidad: 'mg/dL', silencio: false },
  { clave: 'presion_sistolica', etiqueta: 'Presión sistólica', unidad: 'mmHg', silencio: false },
  { clave: 'presion_diastolica', etiqueta: 'Presión diastólica', unidad: 'mmHg', silencio: false },
  { clave: 'bienestar', etiqueta: 'Bienestar reportado', unidad: 'de 5', silencio: false },
  { clave: 'dias_sin_diario', etiqueta: 'Días sin apuntar comidas', unidad: 'días', silencio: true },
  { clave: 'dias_sin_registro', etiqueta: 'Días sin apuntar nada', unidad: 'días', silencio: true },
] as const

const OPERADORES = [
  { clave: 'mayor_que', etiqueta: 'sube por encima de' },
  { clave: 'mayor_igual_que', etiqueta: 'llega o pasa de' },
  { clave: 'menor_que', etiqueta: 'baja por debajo de' },
  { clave: 'menor_igual_que', etiqueta: 'llega o baja de' },
] as const

interface Regla {
  id: string
  metrica: string
  operador: string
  umbral: number
  ventanaDias: number
  mensaje: string | null
  autor: string
  abiertas: number
}

interface Alerta {
  id: string
  metrica: string
  mensaje: string
  estado: 'activa' | 'reconocida' | 'resuelta'
  resueltaAuto: boolean
  observadoEn: string | null
  creadaEn: string
}

function etiquetaMetrica(m: string): string {
  return METRICAS.find((x) => x.clave === m)?.etiqueta ?? m
}

export function AlertasPaciente({ pacienteId }: { pacienteId: string }) {
  const [reglas, setReglas] = useState<Regla[]>([])
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [metrica, setMetrica] = useState<string>('peso')
  const [operador, setOperador] = useState<string>('mayor_que')
  const [umbral, setUmbral] = useState('')
  const [ventana, setVentana] = useState('14')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const [r, a] = await Promise.all([
      apiGet<Regla[]>(`/api/pacientes/${pacienteId}/alertas/config`),
      apiGet<Alerta[]>(`/api/alertas?pacienteId=${pacienteId}`),
    ])
    setReglas(r)
    setAlertas(a)
  }, [pacienteId])

  useEffect(() => {
    cargar().catch((e) =>
      setError(e instanceof ApiError ? e.message : 'No se pudieron cargar las alertas'),
    )
  }, [cargar])

  const esDeSilencio = METRICAS.find((m) => m.clave === metrica)?.silencio ?? false

  // Aviso al salir con cambios sin guardar (R46).
  const { marcarGuardado } = useCambiosSinGuardar({
    nombre: 'Umbral de alerta',
    valores: { metrica, operador, umbral, ventana },
    guardar: () => guardar(),
  })

  async function guardar() {
    if (ocupado || umbral.trim() === '') return
    setOcupado(true)
    setError(null)
    try {
      await apiPut(`/api/pacientes/${pacienteId}/alertas/config`, {
        metrica,
        operador,
        umbral: Number(umbral),
        ...(esDeSilencio ? {} : { ventanaDias: Number(ventana) }),
      })
      setUmbral('')
      await cargar()
      marcarGuardado()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar la regla')
    } finally {
      setOcupado(false)
    }
  }

  async function retirar(id: string) {
    setOcupado(true)
    try {
      await apiDelete(`/api/pacientes/${pacienteId}/alertas/config/${id}`)
      await cargar()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo retirar')
    } finally {
      setOcupado(false)
    }
  }

  async function marcar(id: string, estado: 'reconocida' | 'resuelta') {
    setOcupado(true)
    try {
      await apiPatch(`/api/alertas/${id}`, { estado })
      await cargar()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cambiar el estado')
    } finally {
      setOcupado(false)
    }
  }

  const abiertas = alertas.filter((a) => a.estado !== 'resuelta')

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h3 className="mb-3 font-semibold text-ink">Alertas abiertas</h3>

        {abiertas.length === 0 ? (
          <p className="text-sm text-muted">
            {reglas.length === 0
              ? 'No has puesto ninguna regla para este paciente.'
              : 'Ninguna regla se está cumpliendo ahora mismo.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {abiertas.map((a) => (
              <li key={a.id} className="py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{a.mensaje}</p>
                    <p className="text-xs text-muted">
                      {etiquetaMetrica(a.metrica)} ·{' '}
                      {new Date(a.creadaEn).toLocaleDateString('es-CR', {
                        day: 'numeric',
                        month: 'short',
                      })}
                      {a.estado === 'reconocida' && ' · vista'}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {a.estado === 'activa' && (
                      <button
                        type="button"
                        onClick={() => void marcar(a.id, 'reconocida')}
                        disabled={ocupado}
                        className="text-xs text-muted hover:text-ink"
                      >
                        Vista
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void marcar(a.id, 'resuelta')}
                      disabled={ocupado}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Atendida
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Que se vea que el sistema cierra solo lo que se arregla: si no,
            el profesional cerraría a mano cosas que ya no pasan. */}
        {alertas.some((a) => a.estado === 'resuelta' && a.resueltaAuto) && (
          <p className="mt-3 border-t border-border pt-2 text-xs text-muted">
            Las alertas se cierran solas cuando el valor vuelve a su sitio.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h3 className="font-semibold text-ink">Qué vigilar</h3>
        <p className="mb-3 mt-0.5 text-xs text-muted">
          Se comprueba cada mañana y al guardar la regla.
        </p>

        <div className="space-y-2">
          <select
            value={metrica}
            onChange={(e) => setMetrica(e.target.value)}
            aria-label="Métrica"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
          >
            {METRICAS.map((m) => (
              <option key={m.clave} value={m.clave}>
                {m.etiqueta}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <select
              value={operador}
              onChange={(e) => setOperador(e.target.value)}
              aria-label="Condición"
              className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
            >
              {OPERADORES.map((o) => (
                <option key={o.clave} value={o.clave}>
                  {o.etiqueta}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={umbral}
              onChange={(e) => setUmbral(e.target.value)}
              placeholder="valor"
              aria-label="Umbral"
              className="w-24 rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
            />
          </div>

          {/* La ventana no se pregunta en las métricas de silencio: ahí la
              falta de datos ES lo que se mide. */}
          {!esDeSilencio && (
            <label className="block text-xs text-muted">
              Solo si la última lectura tiene menos de
              <input
                type="number"
                min={1}
                max={365}
                value={ventana}
                onChange={(e) => setVentana(e.target.value)}
                className="mx-1.5 w-16 rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink"
              />
              días
            </label>
          )}

          <button
            type="button"
            onClick={() => void guardar()}
            disabled={ocupado || umbral.trim() === ''}
            className="w-full rounded-md bg-primary py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            Guardar regla
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--status-critical)' }}>
            {error}
          </p>
        )}

        {reglas.length > 0 && (
          <ul className="mt-3 divide-y divide-border border-t border-border pt-1">
            {reglas.map((r) => {
              const m = METRICAS.find((x) => x.clave === r.metrica)
              const o = OPERADORES.find((x) => x.clave === r.operador)
              return (
                <li key={r.id} className="flex items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      {m?.etiqueta} {o?.etiqueta} <strong>{r.umbral}</strong>{' '}
                      <span className="text-xs font-normal text-muted">{m?.unidad}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {m?.silencio ? `Puesta por ${r.autor}` : `Datos de hasta ${r.ventanaDias} días · ${r.autor}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void retirar(r.id)}
                    disabled={ocupado}
                    className="shrink-0 text-xs text-muted hover:text-ink"
                  >
                    Retirar
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
