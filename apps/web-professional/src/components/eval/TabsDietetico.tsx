/**
 * Evaluación dietética — EVAL-04, contenedor.
 *
 * El estado de las tres sub-secciones vive aquí y se guarda en UNA
 * petición. Guardar por partes dejaría media evaluación si la red falla
 * a mitad, y obligaría a tres peticiones por cada cambio de pestaña.
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import { getDietetico, guardarDietetico, type ComidaR24 } from '../../api/clinico'
import { FormR24h } from './FormR24h'
import { FormFrecuenciaConsumo } from './FormFrecuenciaConsumo'
import { ResumenDietetico } from './ResumenDietetico'
import { AvisoPrecarga } from './BannerSeguimiento'

const SUB = [
  { clave: 'r24', etiqueta: 'Recordatorio 24 h' },
  { clave: 'frecuencia', etiqueta: 'Frecuencia de consumo' },
  { clave: 'macros', etiqueta: 'Resumen y macros' },
] as const

type Sub = (typeof SUB)[number]['clave']

const MACROS_VACIOS = { kcal: '', proteina: '', cho: '', grasa: '', fibra: '' }

export function TabsDietetico({
  pacienteId,
  consultaId,
  bloqueada,
  fechaAnterior,
  onGuardado,
}: {
  pacienteId: string
  consultaId: string
  bloqueada: boolean
  fechaAnterior?: string | null
  onGuardado: () => void | Promise<void>
}) {
  const [sub, setSub] = useState<Sub>('r24')
  const [comidas, setComidas] = useState<ComidaR24[]>([])
  const [frecuencia, setFrecuencia] = useState<Record<string, string>>({})
  const [hidratacion, setHidratacion] = useState('')
  const [macros, setMacros] = useState(MACROS_VACIOS)
  const [notas, setNotas] = useState('')

  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const cargar = useCallback(
    (signal?: AbortSignal) => {
      setCargando(true)
      getDietetico(pacienteId, signal)
        .then((d) => {
          if (signal?.aborted) return
          setComidas(d.recordatorio24h ?? [])
          setFrecuencia(d.frecuenciaConsumo ?? {})
          setHidratacion(d.hidratacionLitros?.toString() ?? '')
          setMacros({
            kcal: d.kcalEstimadas?.toString() ?? '',
            proteina: d.proteinaG?.toString() ?? '',
            cho: d.choG?.toString() ?? '',
            grasa: d.grasaG?.toString() ?? '',
            fibra: d.fibraG?.toString() ?? '',
          })
          setNotas(d.notasDieteticas ?? '')
        })
        // 404 = todavía no hay evaluación. Es el estado inicial, no un fallo.
        .catch(() => {})
        .finally(() => {
          if (!signal?.aborted) setCargando(false)
        })
    },
    [pacienteId],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    cargar(ctrl.signal)
    return () => ctrl.abort()
  }, [cargar])

  async function guardar() {
    setGuardando(true)
    setError(null)
    setOk(false)
    try {
      const num = (v: string) => (v.trim() === '' ? null : Number(v))
      await guardarDietetico(pacienteId, {
        consultaId,
        recordatorio24h: comidas,
        frecuenciaConsumo: frecuencia,
        hidratacionLitros: num(hidratacion),
        kcalEstimadas: num(macros.kcal),
        proteinaG: num(macros.proteina),
        choG: num(macros.cho),
        grasaG: num(macros.grasa),
        fibraG: num(macros.fibra),
        notasDieteticas: notas || null,
      })
      setOk(true)
      await onGuardado()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar la evaluación dietética')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <div className="h-96 animate-pulse rounded-lg bg-surface-2" />

  return (
    <div className="space-y-4">
      {fechaAnterior && <AvisoPrecarga fecha={fechaAnterior} />}

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {SUB.map((s) => (
          <button
            key={s.clave}
            type="button"
            onClick={() => setSub(s.clave)}
            aria-current={sub === s.clave ? 'page' : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm transition-colors ${
              sub === s.clave
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {s.etiqueta}
          </button>
        ))}
      </div>

      {sub === 'r24' && (
        <FormR24h comidas={comidas} onCambio={setComidas} bloqueada={bloqueada} />
      )}
      {sub === 'frecuencia' && (
        <FormFrecuenciaConsumo
          datos={frecuencia}
          hidratacion={hidratacion}
          onCambio={setFrecuencia}
          onHidratacion={setHidratacion}
          bloqueada={bloqueada}
        />
      )}
      {sub === 'macros' && (
        <ResumenDietetico macros={macros} onCambio={setMacros} bloqueada={bloqueada} />
      )}

      <div>
        <label htmlFor="notas-diet" className="mb-1 block text-sm font-medium text-ink">
          Notas dietéticas
        </label>
        <textarea
          id="notas-diet"
          rows={3}
          value={notas}
          disabled={bloqueada}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Observaciones sobre los hábitos alimentarios…"
          className="w-full resize-none rounded-md border border-border bg-surface p-3 text-sm text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
        >
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded-md border border-border bg-primary-tint p-3 text-sm text-primary">
          Evaluación dietética guardada.
        </p>
      )}

      {!bloqueada && (
        <div className="flex justify-end">
          {/* Un solo botón para las tres sub-secciones: el estado es uno
              y el guardado también. */}
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={guardando}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {guardando ? 'Guardando…' : 'Guardar evaluación dietética'}
          </button>
        </div>
      )}
    </div>
  )
}
