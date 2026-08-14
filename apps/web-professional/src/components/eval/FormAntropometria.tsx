/**
 * Antropometría de la consulta — EVAL-01.
 *
 * IMC e ICC se muestran calculados en vivo, pero quien manda es la base:
 * son columnas generadas allí. Lo de aquí es la misma cuenta para que el
 * profesional vea el resultado mientras teclea, no una segunda fuente.
 */
import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '../../api/client'
import {
  getMediciones,
  getMedicionDeConsulta,
  guardarMedicion,
  type Medicion,
} from '../../api/valoracion'
import {
  FORMULAS,
  SITIOS_PLIEGUE,
  calcularPctGrasa,
  leerIcc,
  leerImc,
  sitiosDe,
  type Formula,
  type Sexo,
} from '../../lib/composicion'
import { Campo, claseControl } from '../Campo'
import { GraficaComposicion } from './GraficaComposicion'
import { AvisoPrecarga } from './BannerSeguimiento'
import type { FotoAntropometria } from '../../api/seguimiento'

type Campos = Record<string, string>

const BASICOS = [
  { clave: 'pesoKg', etiqueta: 'Peso', unidad: 'kg', paso: '0.1' },
  { clave: 'tallaCm', etiqueta: 'Talla', unidad: 'cm', paso: '0.1' },
  { clave: 'cinturaCm', etiqueta: 'Cintura', unidad: 'cm', paso: '0.1' },
  { clave: 'caderaCm', etiqueta: 'Cadera', unidad: 'cm', paso: '0.1' },
  { clave: 'brazoCm', etiqueta: 'Brazo', unidad: 'cm', paso: '0.1' },
  { clave: 'piernaCm', etiqueta: 'Pierna', unidad: 'cm', paso: '0.1' },
] as const

const BIA = [
  { clave: 'masaLibreGrasaKg', etiqueta: 'Masa libre de grasa', unidad: 'kg' },
  { clave: 'masaMuscularKg', etiqueta: 'Masa muscular', unidad: 'kg' },
  { clave: 'pctGrasa', etiqueta: 'Grasa corporal', unidad: '%' },
  { clave: 'masaGrasaKg', etiqueta: 'Masa grasa', unidad: 'kg' },
  { clave: 'aguaCorporalPct', etiqueta: 'Agua corporal', unidad: '%' },
  { clave: 'anguloFase', etiqueta: 'Ángulo de fase', unidad: '°' },
] as const

function n(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

function Indice({
  etiqueta,
  valor,
  lectura,
}: {
  etiqueta: string
  valor: number | null
  lectura: { etiqueta: string; token: 'normal' | 'alert' | 'critical' | null } | null
}) {
  const color =
    lectura?.token === 'normal'
      ? 'var(--status-normal)'
      : lectura?.token === 'alert'
        ? 'var(--status-alert)'
        : lectura?.token === 'critical'
          ? 'var(--status-critical)'
          : 'var(--muted)'

  return (
    <div className="rounded-md border border-border bg-surface-2 p-3">
      <p className="text-xs uppercase tracking-wide text-muted">{etiqueta}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-ink">{valor ?? '—'}</p>
      {lectura && (
        // Texto + color, nunca color solo: el estado se lee aunque no se
        // distingan los tonos.
        <p className="mt-0.5 text-xs font-medium" style={{ color }}>
          {lectura.etiqueta}
        </p>
      )}
    </div>
  )
}

export function FormAntropometria({
  pacienteId,
  consultaId,
  edad,
  sexo,
  bloqueada,
  anterior,
  fechaAnterior,
  onGuardado,
}: {
  pacienteId: string
  consultaId: string
  edad: number | null
  sexo: Sexo
  bloqueada: boolean
  /** Medición de la consulta anterior, en modo seguimiento. */
  anterior?: FotoAntropometria | null
  fechaAnterior?: string | null
  onGuardado: () => void | Promise<void>
}) {
  const [campos, setCampos] = useState<Campos>({})
  const [metodo, setMetodo] = useState<'bia' | 'pliegues' | ''>('')
  const [formula, setFormula] = useState<Formula>('durnin_womersley')
  const [pliegues, setPliegues] = useState<Campos>({})
  const [historial, setHistorial] = useState<Medicion[]>([])
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setCargando(true)

    Promise.allSettled([
      getMedicionDeConsulta(pacienteId, consultaId, ctrl.signal),
      getMediciones(pacienteId, 20, ctrl.signal),
    ]).then(([medicion, lista]) => {
      if (ctrl.signal.aborted) return

      // Precarga solo si esta consulta YA tiene medición. No se copian
      // los valores de la consulta anterior: aparecerían como si se
      // hubieran medido hoy y bastaría con guardar para falsearlos.
      if (medicion.status === 'fulfilled') {
        const m = medicion.value
        setCampos({
          pesoKg: m.pesoKg?.toString() ?? '',
          tallaCm: m.tallaCm?.toString() ?? '',
          cinturaCm: m.cinturaCm?.toString() ?? '',
          caderaCm: m.caderaCm?.toString() ?? '',
          brazoCm: m.brazoCm?.toString() ?? '',
          piernaCm: m.piernaCm?.toString() ?? '',
          masaLibreGrasaKg: m.masaLibreGrasaKg?.toString() ?? '',
          masaMuscularKg: m.masaMuscularKg?.toString() ?? '',
          pctGrasa: m.pctGrasa?.toString() ?? '',
          masaGrasaKg: m.masaGrasaKg?.toString() ?? '',
          aguaCorporalPct: m.aguaCorporalPct?.toString() ?? '',
          anguloFase: m.anguloFase?.toString() ?? '',
        })
        if (m.metodo) setMetodo(m.metodo)
        if (m.plieguesFormula) setFormula(m.plieguesFormula as Formula)
        if (m.plieguesDatos) {
          setPliegues(
            Object.fromEntries(Object.entries(m.plieguesDatos).map(([k, v]) => [k, String(v)])),
          )
        }
      }
      if (lista.status === 'fulfilled') setHistorial(lista.value)
      setCargando(false)
    })

    return () => ctrl.abort()
  }, [pacienteId, consultaId])

  const peso = n(campos['pesoKg'])
  const talla = n(campos['tallaCm'])
  const cintura = n(campos['cinturaCm'])
  const cadera = n(campos['caderaCm'])

  const imc = peso !== null && talla !== null && talla > 0
    ? Math.round((peso / (talla / 100) ** 2) * 100) / 100
    : null
  const icc = cintura !== null && cadera !== null && cadera > 0
    ? Math.round((cintura / cadera) * 1000) / 1000
    : null

  const pctPliegues = useMemo(() => {
    if (metodo !== 'pliegues') return null
    const datos = Object.fromEntries(
      Object.entries(pliegues).map(([k, v]) => [k, n(v)]),
    ) as Record<string, number | null>
    return calcularPctGrasa(formula, datos, edad, sexo)
  }, [metodo, pliegues, formula, edad, sexo])

  function campo(clave: string, valor: string) {
    setCampos((c) => ({ ...c, [clave]: valor }))
    setOk(null)
  }

  /**
   * Texto de apoyo con el valor de la consulta anterior y, si hoy ya hay
   * uno distinto, cuánto ha cambiado.
   *
   * El delta va aquí y no en un panel aparte: el número que hay que
   * comparar está justo al lado del que se acaba de teclear.
   */
  function comparativa(clave: string, unidad: string): string | undefined {
    const previo = anterior ? (anterior as unknown as Record<string, number | null>)[clave] : null
    if (previo === null || previo === undefined) return undefined

    const hoy = n(campos[clave])
    if (hoy === null) return `Anterior: ${previo} ${unidad}`.trim()

    const delta = Math.round((hoy - previo) * 100) / 100
    if (delta === 0) return `Anterior: ${previo} ${unidad} · sin cambio`.trim()
    return `Anterior: ${previo} ${unidad} · ${delta > 0 ? '+' : ''}${delta} ${unidad}`.trim()
  }

  /** Copia las medidas anteriores como las de hoy, de forma explícita. */
  function copiarAnteriores() {
    if (!anterior) return
    if (
      !window.confirm(
        'Se registrarán las medidas de la consulta anterior como las de hoy. Úsalo solo si de verdad no hubo cambios.',
      )
    ) {
      return
    }
    const a = anterior as unknown as Record<string, number | null>
    setCampos((c) => {
      const copia = { ...c }
      for (const clave of [
        'pesoKg', 'tallaCm', 'cinturaCm', 'caderaCm', 'brazoCm', 'piernaCm',
        'masaLibreGrasaKg', 'masaMuscularKg', 'pctGrasa', 'masaGrasaKg',
        'aguaCorporalPct', 'anguloFase',
      ]) {
        const v = a[clave]
        if (v !== null && v !== undefined) copia[clave] = String(v)
      }
      return copia
    })
    if (anterior.metodo === 'bia' || anterior.metodo === 'pliegues') setMetodo(anterior.metodo)
    setOk(null)
  }

  async function guardar() {
    setGuardando(true)
    setError(null)
    setOk(null)
    try {
      const cuerpo: Record<string, unknown> = { consultaId }
      for (const [clave, valor] of Object.entries(campos)) {
        const num = n(valor)
        if (num !== null) cuerpo[clave] = num
      }
      if (metodo !== '') cuerpo['metodo'] = metodo
      if (metodo === 'pliegues') {
        const datos = Object.fromEntries(
          Object.entries(pliegues)
            .map(([k, v]) => [k, n(v)])
            .filter(([, v]) => v !== null),
        )
        if (Object.keys(datos).length > 0) {
          cuerpo['plieguesDatos'] = datos
          cuerpo['plieguesFormula'] = formula
        }
        // El porcentaje estimado solo se envía si el profesional no
        // escribió uno propio: su criterio manda sobre la ecuación.
        if (pctPliegues !== null && n(campos['pctGrasa']) === null) {
          cuerpo['pctGrasa'] = pctPliegues
        }
      }

      const guardada = await guardarMedicion(pacienteId, cuerpo)
      setOk(
        `Guardado · ${guardada.pesoKg ?? '—'} kg${guardada.imc !== null ? `, IMC ${guardada.imc}` : ''}`,
      )
      setHistorial(await getMediciones(pacienteId, 20))
      await onGuardado()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar la medición')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <div className="h-64 animate-pulse rounded-lg bg-surface-2" />

  const sitios = metodo === 'pliegues' ? sitiosDe(formula, sexo) : []

  return (
    <div className="space-y-6">
      {anterior && fechaAnterior && <AvisoPrecarga fecha={fechaAnterior} medidas />}

      <fieldset disabled={bloqueada} className="space-y-6">
        <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-ink">Medidas básicas</h3>
            {anterior && !bloqueada && (
              <button
                type="button"
                onClick={copiarAnteriores}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-ink"
              >
                Sin cambios: copiar las anteriores
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {BASICOS.map((b) => (
              <Campo
                key={b.clave}
                id={`ant-${b.clave}`}
                etiqueta={`${b.etiqueta} (${b.unidad})`}
                {...(comparativa(b.clave, b.unidad)
                  ? { ayuda: comparativa(b.clave, b.unidad) }
                  : {})}
              >
                <input
                  id={`ant-${b.clave}`}
                  type="number"
                  step={b.paso}
                  min={0}
                  value={campos[b.clave] ?? ''}
                  onChange={(e) => campo(b.clave, e.target.value)}
                  className={claseControl(false)}
                />
              </Campo>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Indice etiqueta="IMC" valor={imc} lectura={leerImc(imc)} />
            <Indice etiqueta="Índice cintura-cadera" valor={icc} lectura={leerIcc(icc, sexo)} />
          </div>
        </section>

        <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <h3 className="font-semibold text-ink">Composición corporal</h3>

          <div className="flex flex-wrap gap-2">
            {[
              { valor: 'bia', etiqueta: 'Bioimpedancia' },
              { valor: 'pliegues', etiqueta: 'Pliegues cutáneos' },
            ].map((o) => (
              <label
                key={o.valor}
                className={`cursor-pointer rounded-pill border px-4 py-1.5 text-sm ${
                  metodo === o.valor
                    ? 'border-primary bg-primary-tint font-medium text-primary'
                    : 'border-border text-ink hover:bg-surface-2'
                }`}
              >
                <input
                  type="radio"
                  name="metodo"
                  className="sr-only"
                  checked={metodo === o.valor}
                  onChange={() => setMetodo(o.valor as 'bia' | 'pliegues')}
                />
                {o.etiqueta}
              </label>
            ))}
          </div>

          {metodo === 'bia' && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {BIA.map((b) => (
                <Campo
                key={b.clave}
                id={`ant-${b.clave}`}
                etiqueta={`${b.etiqueta} (${b.unidad})`}
                {...(comparativa(b.clave, b.unidad)
                  ? { ayuda: comparativa(b.clave, b.unidad) }
                  : {})}
              >
                  <input
                    id={`ant-${b.clave}`}
                    type="number"
                    step="0.01"
                    min={0}
                    value={campos[b.clave] ?? ''}
                    onChange={(e) => campo(b.clave, e.target.value)}
                    className={claseControl(false)}
                  />
                </Campo>
              ))}
            </div>
          )}

          {metodo === 'pliegues' && (
            <div className="space-y-4">
              <Campo id="ant-formula" etiqueta="Fórmula">
                <select
                  id="ant-formula"
                  value={formula}
                  onChange={(e) => setFormula(e.target.value as Formula)}
                  className={claseControl(false)}
                >
                  {FORMULAS.map((f) => (
                    <option key={f.clave} value={f.clave}>
                      {f.etiqueta}
                    </option>
                  ))}
                </select>
              </Campo>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {SITIOS_PLIEGUE.filter((s) => sitios.includes(s.clave)).map((s) => (
                  <Campo key={s.clave} id={`pl-${s.clave}`} etiqueta={`${s.etiqueta} (mm)`}>
                    <input
                      id={`pl-${s.clave}`}
                      type="number"
                      step="0.1"
                      min={0}
                      value={pliegues[s.clave] ?? ''}
                      onChange={(e) => {
                        setPliegues((p) => ({ ...p, [s.clave]: e.target.value }))
                        setOk(null)
                      }}
                      className={claseControl(false)}
                    />
                  </Campo>
                ))}
              </div>

              {pctPliegues !== null ? (
                <p className="rounded-md border border-border bg-surface-2 p-3 text-sm text-ink">
                  Grasa corporal estimada:{' '}
                  <strong className="tabular-nums">{pctPliegues} %</strong>
                  <span className="ml-2 text-xs text-muted">
                    Estimación con {FORMULAS.find((f) => f.clave === formula)?.etiqueta}. Escribe un
                    valor en «Grasa corporal» para usar el tuyo.
                  </span>
                </p>
              ) : (
                (edad === null || sexo === null || sexo === 'intersexual') && (
                  <p className="rounded-md border border-[color:var(--status-alert)] bg-surface p-3 text-xs text-ink">
                    Las ecuaciones necesitan edad y sexo biológico registrados. Sin ellos no se
                    estima el porcentaje: se registran los pliegues tal cual.
                  </p>
                )
              )}
            </div>
          )}
        </section>
      </fieldset>

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
          {ok}
        </p>
      )}

      {!bloqueada && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={guardando}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {guardando ? 'Guardando…' : 'Guardar antropometría'}
          </button>
        </div>
      )}

      <GraficaComposicion mediciones={historial} />
    </div>
  )
}
