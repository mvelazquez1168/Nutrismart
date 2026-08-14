/**
 * Conclusiones de la valoración — EVAL-05.
 *
 * Cierra el ABCD: diagnóstico, recomendaciones, prescripción y acuerdos.
 * Los gramos de cada macro se muestran calculados pero los deriva el
 * servidor: aquí es un anticipo, no una segunda fuente.
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import {
  DIAGNOSTICOS,
  RECOMENDACIONES_FRECUENTES,
  RESTRICCIONES,
  getConclusion,
  guardarConclusion,
  type Acuerdo,
} from '../../api/valoracion'
import { getHistorial } from '../../api/clinico'
import { macrosEnGramos } from '../../lib/calculadora'
import { Campo, claseControl } from '../Campo'
import { PanelCalculadora, type ResultadoCalculadora } from './PanelCalculadora'

const ACUERDOS_INICIALES: Acuerdo[] = [
  { texto: 'Registrar la ingesta diaria', cumplido: false },
  { texto: 'Realizar la actividad física acordada', cumplido: false },
  { texto: 'Tomar los suplementos indicados', cumplido: false },
]

export function FormConclusion({
  pacienteId,
  consultaId,
  edad,
  sexo,
  bloqueada,
  onGuardado,
}: {
  pacienteId: string
  consultaId: string
  edad: number | null
  sexo: string | null
  bloqueada: boolean
  onGuardado: () => void | Promise<void>
}) {
  const [diagnostico, setDiagnostico] = useState('')
  const [cie10, setCie10] = useState('')
  const [secundario, setSecundario] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [recomendaciones, setRecomendaciones] = useState<string[]>([])
  const [personalizada, setPersonalizada] = useState('')
  const [kcal, setKcal] = useState('')
  const [pct, setPct] = useState({ proteina: 20, cho: 50, grasa: 30 })
  const [restricciones, setRestricciones] = useState<string[]>([])
  const [suplementos, setSuplementos] = useState('')
  const [acuerdos, setAcuerdos] = useState<Acuerdo[]>(ACUERDOS_INICIALES)
  const [fafHistorial, setFafHistorial] = useState<number | null>(null)

  const [calculadora, setCalculadora] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const cargar = useCallback(
    (signal?: AbortSignal) => {
      setCargando(true)
      Promise.allSettled([
        getConclusion(pacienteId, consultaId, signal),
        getHistorial(pacienteId, signal),
      ]).then(([conc, hist]) => {
        if (signal?.aborted) return
        if (conc.status === 'fulfilled') {
          const c = conc.value
          setDiagnostico(c.diagnosticoPrincipal ?? '')
          setCie10(c.diagnosticoCie10 ?? '')
          setSecundario(c.diagnosticoSecundario ?? '')
          setObservaciones(c.observacionesClinicas ?? '')
          setRecomendaciones(c.recomendaciones ?? [])
          setKcal(c.kcalPrescritas?.toString() ?? '')
          if (c.pctProteina !== null && c.pctCho !== null && c.pctGrasa !== null) {
            setPct({ proteina: c.pctProteina, cho: c.pctCho, grasa: c.pctGrasa })
          }
          setRestricciones(c.restricciones ?? [])
          setSuplementos(c.suplementos ?? '')
          // Solo se sustituyen los acuerdos si ya había alguno guardado:
          // si no, se dejan los tres de arranque.
          if (c.acuerdos.length > 0) setAcuerdos(c.acuerdos)
        }
        // El FAF del historial alimenta la calculadora sin volver a preguntarlo.
        if (hist.status === 'fulfilled') setFafHistorial(hist.value.faf)
        setCargando(false)
      })
    },
    [pacienteId, consultaId],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    cargar(ctrl.signal)
    return () => ctrl.abort()
  }, [cargar])

  const kcalNum = kcal.trim() === '' ? null : Number(kcal)
  const gramos =
    kcalNum !== null && Number.isFinite(kcalNum)
      ? macrosEnGramos(kcalNum, pct.proteina, pct.cho, pct.grasa)
      : null
  const suma = pct.proteina + pct.cho + pct.grasa

  function alternar(lista: string[], set: (v: string[]) => void, valor: string) {
    set(lista.includes(valor) ? lista.filter((x) => x !== valor) : [...lista, valor])
    setOk(false)
  }

  function recibirDeCalculadora(r: ResultadoCalculadora) {
    setKcal(String(r.kcal))
    setPct({ proteina: r.pctProteina, cho: r.pctCho, grasa: r.pctGrasa })
    setCalculadora(false)
    setOk(false)
  }

  async function guardar() {
    setGuardando(true)
    setError(null)
    setOk(false)
    try {
      await guardarConclusion(pacienteId, consultaId, {
        diagnosticoPrincipal: diagnostico || null,
        diagnosticoCie10: cie10 || null,
        diagnosticoSecundario: secundario || null,
        observacionesClinicas: observaciones || null,
        recomendaciones,
        kcalPrescritas: kcalNum,
        // Los tres o ninguno: el servidor rechaza un reparto incompleto.
        ...(kcalNum !== null
          ? { pctProteina: pct.proteina, pctCho: pct.cho, pctGrasa: pct.grasa }
          : {}),
        restricciones,
        suplementos: suplementos || null,
        acuerdos: acuerdos.filter((a) => a.texto.trim() !== ''),
      })
      setOk(true)
      await onGuardado()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar la conclusión')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <div className="h-96 animate-pulse rounded-lg bg-surface-2" />

  return (
    <div className="space-y-6">
      <fieldset disabled={bloqueada} className="space-y-6">
        {/* ---- Diagnóstico ---- */}
        <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <h3 className="font-semibold text-ink">Diagnóstico nutricional</h3>

          <Campo id="diag" etiqueta="Diagnóstico principal">
            <input
              id="diag"
              type="text"
              list="lista-diagnosticos"
              value={diagnostico}
              onChange={(e) => {
                setDiagnostico(e.target.value)
                // Si coincide con uno del catálogo, el código se rellena
                // solo; sigue siendo editable para los que no están.
                const encontrado = DIAGNOSTICOS.find((d) => d.nombre === e.target.value)
                if (encontrado) setCie10(encontrado.cie10)
                setOk(false)
              }}
              className={claseControl(false)}
            />
          </Campo>
          <datalist id="lista-diagnosticos">
            {DIAGNOSTICOS.map((d) => (
              <option key={d.cie10} value={d.nombre}>
                {d.cie10}
              </option>
            ))}
          </datalist>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo id="cie" etiqueta="Código CIE-10" ayuda="Editable">
              <input
                id="cie"
                type="text"
                maxLength={10}
                value={cie10}
                onChange={(e) => setCie10(e.target.value)}
                className={`${claseControl(false)} font-mono`}
              />
            </Campo>
            <Campo id="sec" etiqueta="Diagnóstico secundario" ayuda="Opcional">
              <input
                id="sec"
                type="text"
                value={secundario}
                onChange={(e) => setSecundario(e.target.value)}
                className={claseControl(false)}
              />
            </Campo>
          </div>

          <Campo id="obs" etiqueta="Observaciones clínicas">
            <textarea
              id="obs"
              rows={4}
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              className={`${claseControl(false)} resize-none`}
            />
          </Campo>
        </section>

        {/* ---- Recomendaciones ---- */}
        <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
          <h3 className="font-semibold text-ink">Recomendaciones</h3>
          <div className="flex flex-wrap gap-2">
            {RECOMENDACIONES_FRECUENTES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => alternar(recomendaciones, setRecomendaciones, r)}
                className={`rounded-pill border px-3 py-1 text-sm ${
                  recomendaciones.includes(r)
                    ? 'border-primary bg-primary-tint font-medium text-primary'
                    : 'border-border text-ink hover:bg-surface-2'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={personalizada}
              onChange={(e) => setPersonalizada(e.target.value)}
              placeholder="Recomendación propia…"
              aria-label="Recomendación personalizada"
              className={claseControl(false)}
            />
            <button
              type="button"
              onClick={() => {
                const t = personalizada.trim()
                if (t !== '' && !recomendaciones.includes(t)) {
                  setRecomendaciones([...recomendaciones, t])
                  setPersonalizada('')
                }
              }}
              className="shrink-0 rounded-md border border-border px-4 text-sm font-medium text-ink hover:bg-surface-2"
            >
              Añadir
            </button>
          </div>

          {recomendaciones.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {recomendaciones.map((r) => (
                <li
                  key={r}
                  className="flex items-center gap-1 rounded-pill bg-primary-tint px-2.5 py-1 text-xs text-primary"
                >
                  {r}
                  {!bloqueada && (
                    <button
                      type="button"
                      onClick={() => alternar(recomendaciones, setRecomendaciones, r)}
                      aria-label={`Quitar ${r}`}
                      className="font-bold"
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- Prescripción ---- */}
        <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-ink">Prescripción dietética</h3>
            <button
              type="button"
              onClick={() => setCalculadora(true)}
              className="rounded-md border border-primary px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary-tint"
            >
              Abrir calculadora →
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Campo id="kcal" etiqueta="Meta calórica (kcal/día)">
              <input
                id="kcal"
                type="number"
                min={0}
                value={kcal}
                onChange={(e) => setKcal(e.target.value)}
                className={claseControl(false)}
              />
            </Campo>
            {(['proteina', 'cho', 'grasa'] as const).map((k) => (
              <Campo
                key={k}
                id={`pct-${k}`}
                etiqueta={`${k === 'cho' ? 'Carbohidratos' : k === 'grasa' ? 'Grasa' : 'Proteína'} (%)`}
              >
                <input
                  id={`pct-${k}`}
                  type="number"
                  min={0}
                  max={100}
                  value={pct[k]}
                  onChange={(e) => {
                    setPct({ ...pct, [k]: Number(e.target.value) })
                    setOk(false)
                  }}
                  className={claseControl(suma !== 100)}
                />
              </Campo>
            ))}
          </div>

          {suma !== 100 && (
            <p className="text-sm" style={{ color: 'var(--status-critical)' }}>
              Los porcentajes suman {suma}. Deben sumar 100 para poder guardar.
            </p>
          )}

          {gramos && suma === 100 && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { e: 'Proteína', v: gramos.proteinaG },
                { e: 'Carbohidratos', v: gramos.choG },
                { e: 'Grasa', v: gramos.grasaG },
              ].map((g) => (
                <div key={g.e} className="rounded-md border border-border bg-surface-2 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted">{g.e}</p>
                  <p className="text-lg font-bold tabular-nums text-ink">{g.v} g</p>
                </div>
              ))}
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-medium text-ink">Restricciones</p>
            <div className="flex flex-wrap gap-2">
              {RESTRICCIONES.map((r) => (
                <button
                  key={r.clave}
                  type="button"
                  onClick={() => alternar(restricciones, setRestricciones, r.clave)}
                  className={`rounded-pill border px-3 py-1 text-sm ${
                    restricciones.includes(r.clave)
                      ? 'border-primary bg-primary-tint font-medium text-primary'
                      : 'border-border text-ink hover:bg-surface-2'
                  }`}
                >
                  {r.etiqueta}
                </button>
              ))}
            </div>
          </div>

          <Campo id="supl" etiqueta="Suplementos y preparados" ayuda="Opcional">
            <textarea
              id="supl"
              rows={2}
              value={suplementos}
              onChange={(e) => setSuplementos(e.target.value)}
              className={`${claseControl(false)} resize-none`}
            />
          </Campo>
        </section>

        {/* ---- Acuerdos ---- */}
        <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
          <h3 className="font-semibold text-ink">Acuerdos con el paciente</h3>
          <ul className="space-y-2">
            {acuerdos.map((a, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={a.cumplido}
                  onChange={() =>
                    setAcuerdos(
                      acuerdos.map((x, j) => (i === j ? { ...x, cumplido: !x.cumplido } : x)),
                    )
                  }
                  aria-label={`Cumplido: ${a.texto}`}
                  className="h-4 w-4 shrink-0 accent-[color:var(--primary)]"
                />
                <input
                  type="text"
                  value={a.texto}
                  onChange={(e) =>
                    setAcuerdos(
                      acuerdos.map((x, j) => (i === j ? { ...x, texto: e.target.value } : x)),
                    )
                  }
                  aria-label="Texto del acuerdo"
                  className={claseControl(false)}
                />
                {!bloqueada && (
                  <button
                    type="button"
                    onClick={() => setAcuerdos(acuerdos.filter((_, j) => j !== i))}
                    aria-label="Quitar acuerdo"
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-sm text-muted hover:text-ink"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!bloqueada && (
            <button
              type="button"
              onClick={() => setAcuerdos([...acuerdos, { texto: '', cumplido: false }])}
              className="text-sm font-medium text-primary hover:underline"
            >
              + Añadir acuerdo
            </button>
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
          Conclusión guardada. La sección queda marcada como completa.
        </p>
      )}

      {!bloqueada && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={guardando || (kcalNum !== null && suma !== 100)}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {guardando ? 'Guardando…' : 'Guardar conclusión'}
          </button>
        </div>
      )}

      <PanelCalculadora
        abierto={calculadora}
        pacienteId={pacienteId}
        edad={edad}
        sexo={sexo}
        fafHistorial={fafHistorial}
        onCerrar={() => setCalculadora(false)}
        onEnviar={recibirDeCalculadora}
      />
    </div>
  )
}
