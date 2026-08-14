/**
 * Calculadora nutricional — EVAL-06.
 *
 * Panel lateral sobre la valoración: se calcula sin salir del
 * formulario de conclusiones, porque lo que se calcula aquí es
 * exactamente lo que se prescribe allí.
 *
 * Todo ocurre en el cliente. Los datos del paciente se traen ya
 * medidos —peso, talla, masa libre de grasa— y se marcan como
 * precargados: el profesional debe poder ver de dónde sale cada cifra.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  FACTORES_ACTIVIDAD,
  FORMULAS_TMB,
  REPARTOS,
  ajustarReparto,
  azucarACucharaditas,
  calcularGastoTotal,
  calcularIntercambios,
  calcularTmb,
  kcalDeIntercambios,
  macrosEnGramos,
  pesoAjustado,
  pesoIdealHamwi,
  proyeccionPeso,
  sexoParaCalculo,
  sodioASal,
  ETIQUETA_INTERCAMBIO,
  type FormulaTmb,
} from '../../lib/calculadora'
import { getMediciones, type Medicion } from '../../api/valoracion'
import { claseControl } from '../Campo'

export interface ResultadoCalculadora {
  kcal: number
  pctProteina: number
  pctCho: number
  pctGrasa: number
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border py-1.5 last:border-0">
      <span className="text-sm text-muted">{etiqueta}</span>
      <span className="text-sm font-semibold tabular-nums text-ink">{valor}</span>
    </div>
  )
}

function Acordeon({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between bg-surface-2 px-3 py-2 text-left text-sm font-medium text-ink"
      >
        {titulo}
        <span aria-hidden="true" className="text-muted">
          {abierto ? '−' : '+'}
        </span>
      </button>
      {abierto && <div className="space-y-3 p-3">{children}</div>}
    </div>
  )
}

export function PanelCalculadora({
  abierto,
  pacienteId,
  edad,
  sexo,
  fafHistorial,
  onCerrar,
  onEnviar,
}: {
  abierto: boolean
  pacienteId: string
  edad: number | null
  sexo: string | null
  /** Factor de actividad que ya está en el historial clínico, si existe. */
  fafHistorial: number | null
  onCerrar: () => void
  onEnviar: (r: ResultadoCalculadora) => void
}) {
  const [medicion, setMedicion] = useState<Medicion | null>(null)
  const [formula, setFormula] = useState<FormulaTmb>('mifflin')
  const [faf, setFaf] = useState<number>(fafHistorial ?? 1.55)
  const [meta, setMeta] = useState('')
  const [reparto, setReparto] = useState({ proteina: 20, cho: 50, grasa: 30 })
  const [ajuste, setAjuste] = useState('')
  const [azucar, setAzucar] = useState('')
  const [sodio, setSodio] = useState('')

  useEffect(() => {
    if (!abierto) return
    const ctrl = new AbortController()
    getMediciones(pacienteId, 1, ctrl.signal)
      .then((lista) => {
        if (!ctrl.signal.aborted) setMedicion(lista[0] ?? null)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [abierto, pacienteId])

  useEffect(() => {
    if (fafHistorial !== null) setFaf(fafHistorial)
  }, [fafHistorial])

  const sexoCalc = sexoParaCalculo(sexo)
  const peso = medicion?.pesoKg ?? null
  const talla = medicion?.tallaCm ?? null
  const mlg = medicion?.masaLibreGrasaKg ?? null

  const tmb = useMemo(
    () => calcularTmb({ formula, peso, talla, edad, sexo: sexoCalc, masaLibreGrasa: mlg }),
    [formula, peso, talla, edad, sexoCalc, mlg],
  )
  const tee = calcularGastoTotal(tmb, faf)

  // La meta arranca en el gasto total y el profesional la ajusta desde
  // ahí: es el punto de partida, no una imposición.
  useEffect(() => {
    if (tee !== null && meta === '') setMeta(String(tee))
  }, [tee, meta])

  const kcalMeta = meta.trim() === '' ? null : Number(meta)
  const gramos =
    kcalMeta !== null && Number.isFinite(kcalMeta)
      ? macrosEnGramos(kcalMeta, reparto.proteina, reparto.cho, reparto.grasa)
      : null

  const ideal = talla !== null && sexoCalc !== null ? pesoIdealHamwi(talla, sexoCalc) : null
  const ajustado = peso !== null && ideal !== null ? pesoAjustado(peso, ideal) : null

  if (!abierto) return null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onCerrar} aria-hidden="true" />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Calculadora nutricional"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-lg"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-bold text-ink">Calculadora nutricional</h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar calculadora"
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* ---- Datos de partida ---- */}
          <section className="rounded-md border border-border bg-surface-2 p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              Datos del paciente
            </p>
            <Fila etiqueta="Peso" valor={peso !== null ? `${peso} kg` : '— sin medición'} />
            <Fila etiqueta="Talla" valor={talla !== null ? `${talla} cm` : '—'} />
            <Fila etiqueta="Edad" valor={edad !== null ? `${edad} años` : '—'} />
            <Fila
              etiqueta="Sexo"
              valor={sexoCalc === 'masculino' ? 'Masculino' : sexoCalc === 'femenino' ? 'Femenino' : '— no registrado'}
            />
            <Fila etiqueta="Masa libre de grasa" valor={mlg !== null ? `${mlg} kg` : '—'} />
            <p className="mt-2 text-xs text-muted">
              Tomados de la última medición antropométrica y del expediente.
            </p>
          </section>

          {/* ---- TMB ---- */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">Metabolismo basal</h3>
            <div className="flex flex-wrap gap-2">
              {FORMULAS_TMB.map((f) => {
                const disponible = f.clave !== 'katch' || mlg !== null
                return (
                  <button
                    key={f.clave}
                    type="button"
                    disabled={!disponible}
                    onClick={() => setFormula(f.clave)}
                    title={disponible ? f.descripcion : 'Requiere masa libre de grasa'}
                    className={`rounded-pill border px-3 py-1 text-xs ${
                      formula === f.clave
                        ? 'border-primary bg-primary-tint font-medium text-primary'
                        : 'border-border text-ink hover:bg-surface-2'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {f.etiqueta}
                  </button>
                )
              })}
            </div>

            {tmb === null ? (
              <p className="rounded-md border border-[color:var(--status-alert)] bg-surface p-2 text-xs text-ink">
                {formula === 'katch'
                  ? 'Necesita masa libre de grasa registrada en antropometría.'
                  : 'Necesitan peso, talla, edad y sexo biológico. Sin sexo registrado no se estima: la diferencia entre las constantes de hombre y mujer es de 166 kcal.'}
              </p>
            ) : (
              <p className="rounded-md bg-primary-tint p-3 text-center">
                <span className="block text-2xl font-bold tabular-nums text-primary">{tmb}</span>
                <span className="text-xs text-primary">kcal/día en reposo</span>
              </p>
            )}
          </section>

          {/* ---- Gasto total ---- */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">
              Gasto total
              {fafHistorial !== null && (
                <span className="ml-2 rounded-pill bg-surface-2 px-2 py-0.5 text-xs font-normal text-muted">
                  historial: {fafHistorial}
                </span>
              )}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {FACTORES_ACTIVIDAD.map((f) => (
                <button
                  key={f.clave}
                  type="button"
                  onClick={() => setFaf(f.faf)}
                  className={`rounded-md border p-2 text-left text-xs ${
                    faf === f.faf
                      ? 'border-primary bg-primary-tint'
                      : 'border-border hover:bg-surface-2'
                  }`}
                >
                  <span className="block font-medium text-ink">{f.etiqueta}</span>
                  <span className="block text-muted">{f.faf}</span>
                </button>
              ))}
            </div>
            {tee !== null && <Fila etiqueta="Gasto total estimado" valor={`${tee} kcal/día`} />}

            <label htmlFor="meta" className="mt-2 block text-sm font-medium text-ink">
              Meta calórica
            </label>
            <input
              id="meta"
              type="number"
              min={0}
              value={meta}
              onChange={(e) => setMeta(e.target.value)}
              className={claseControl(false)}
            />
          </section>

          {/* ---- Pesos de referencia ---- */}
          <section className="rounded-md border border-border p-3">
            <h3 className="mb-1 text-sm font-semibold text-ink">Pesos de referencia</h3>
            <Fila etiqueta="Peso ideal (Hamwi)" valor={ideal !== null ? `${ideal} kg` : '—'} />
            <Fila
              etiqueta="Peso ajustado"
              valor={ajustado !== null ? `${ajustado} kg` : 'no aplica'}
            />
            {ajustado === null && ideal !== null && (
              <p className="mt-1 text-xs text-muted">
                Solo se usa cuando el peso real supera al ideal en más de un 20 %.
              </p>
            )}
          </section>

          {/* ---- Reparto de macros ---- */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">Reparto de macronutrientes</h3>
            <div className="flex flex-wrap gap-1.5">
              {REPARTOS.map((r) => (
                <button
                  key={r.clave}
                  type="button"
                  onClick={() => setReparto({ proteina: r.proteina, cho: r.cho, grasa: r.grasa })}
                  className="rounded-pill border border-border px-2.5 py-1 text-xs text-ink hover:bg-surface-2"
                >
                  {r.etiqueta}
                </button>
              ))}
            </div>

            {(['proteina', 'cho', 'grasa'] as const).map((k) => (
              <div key={k}>
                <label htmlFor={`sl-${k}`} className="flex justify-between text-xs text-ink">
                  <span>{k === 'cho' ? 'Carbohidratos' : k === 'grasa' ? 'Grasa' : 'Proteína'}</span>
                  <span className="tabular-nums">{reparto[k]} %</span>
                </label>
                <input
                  id={`sl-${k}`}
                  type="range"
                  min={0}
                  max={100}
                  value={reparto[k]}
                  // Los otros dos se reajustan en proporción para que la
                  // suma siga siendo 100 sin que haya que cuadrarla a mano.
                  onChange={(e) => setReparto(ajustarReparto(reparto, k, Number(e.target.value)))}
                  className="w-full accent-[color:var(--primary)]"
                />
              </div>
            ))}

            {gramos && (
              <div className="rounded-md bg-surface-2 p-2">
                <Fila etiqueta="Proteína" valor={`${gramos.proteinaG} g`} />
                <Fila etiqueta="Carbohidratos" valor={`${gramos.choG} g`} />
                <Fila etiqueta="Grasa" valor={`${gramos.grasaG} g`} />
              </div>
            )}
          </section>

          <Acordeon titulo="Listas de intercambio">
            {kcalMeta !== null && Number.isFinite(kcalMeta) ? (
              <>
                {Object.entries(calcularIntercambios(kcalMeta)).map(([g, n]) => (
                  <Fila key={g} etiqueta={ETIQUETA_INTERCAMBIO[g] ?? g} valor={`${n}`} />
                ))}
                <p className="text-xs text-muted">
                  Suman {kcalDeIntercambios(calcularIntercambios(kcalMeta))} kcal. Reparto
                  orientativo: un menú por intercambios se ajusta a mano.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted">Indica una meta calórica.</p>
            )}
          </Acordeon>

          <Acordeon titulo="Proyección de peso">
            <label htmlFor="ajuste" className="block text-xs text-ink">
              Déficit (negativo) o superávit diario, en kcal
            </label>
            <input
              id="ajuste"
              type="number"
              value={ajuste}
              onChange={(e) => setAjuste(e.target.value)}
              placeholder="-500"
              className={claseControl(false)}
            />
            {ajuste.trim() !== '' &&
              Number(ajuste) !== 0 &&
              (() => {
                const p = proyeccionPeso(Number(ajuste))
                return (
                  <>
                    <Fila etiqueta="Días por kilo" valor={`${p.diasPorKilo ?? '—'}`} />
                    <Fila etiqueta="Cambio semanal" valor={`${p.kgPorSemana} kg`} />
                    <p className="text-xs text-muted">
                      Aproximación lineal de 7700 kcal por kilo. No contempla la adaptación
                      metabólica: da una escala, no una fecha.
                    </p>
                  </>
                )
              })()}
          </Acordeon>

          <Acordeon titulo="Conversores">
            <label htmlFor="az" className="block text-xs text-ink">
              Azúcares libres (g/día)
            </label>
            <input
              id="az"
              type="number"
              min={0}
              value={azucar}
              onChange={(e) => setAzucar(e.target.value)}
              className={claseControl(false)}
            />
            {azucar.trim() !== '' &&
              (() => {
                const a = azucarACucharaditas(Number(azucar))
                return (
                  <>
                    <Fila etiqueta="Equivale a" valor={`${a.cucharaditas} cucharaditas`} />
                    <Fila etiqueta="Aporte" valor={`${a.kcal} kcal`} />
                    {a.excedeRecomendacion && (
                      <p className="text-xs" style={{ color: 'var(--status-alert)' }}>
                        Supera los 25 g diarios que recomienda la OMS.
                      </p>
                    )}
                  </>
                )
              })()}

            <label htmlFor="na" className="mt-2 block text-xs text-ink">
              Sodio (mg/día)
            </label>
            <input
              id="na"
              type="number"
              min={0}
              value={sodio}
              onChange={(e) => setSodio(e.target.value)}
              className={claseControl(false)}
            />
            {sodio.trim() !== '' &&
              (() => {
                const s = sodioASal(Number(sodio))
                return (
                  <>
                    <Fila etiqueta="Equivale a" valor={`${s.gramosSal} g de sal`} />
                    {s.excedeRecomendacion && (
                      <p className="text-xs" style={{ color: 'var(--status-alert)' }}>
                        Supera los 2000 mg diarios que recomienda la OMS.
                      </p>
                    )}
                  </>
                )
              })()}
          </Acordeon>

          <p className="text-xs text-muted">
            Todas las ecuaciones son estimaciones poblacionales. El requerimiento real de un
            paciente concreto lo decide quien lo atiende.
          </p>
        </div>

        <footer className="border-t border-border p-4">
          <button
            type="button"
            disabled={kcalMeta === null || !Number.isFinite(kcalMeta)}
            onClick={() =>
              onEnviar({
                kcal: Math.round(kcalMeta as number),
                pctProteina: reparto.proteina,
                pctCho: reparto.cho,
                pctGrasa: reparto.grasa,
              })
            }
            className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            Llevar a la prescripción
          </button>
        </footer>
      </aside>
    </>
  )
}
