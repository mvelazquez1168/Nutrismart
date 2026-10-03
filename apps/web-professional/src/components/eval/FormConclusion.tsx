/**
 * Conclusiones de la valoración — EVAL-05.
 *
 * Cierra el ABCD: diagnóstico, recomendaciones, prescripción y acuerdos.
 * Los gramos de cada macro se muestran calculados pero los deriva el
 * servidor: aquí es un anticipo, no una segunda fuente.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { ApiError } from '../../api/client'
import {
  DIAGNOSTICOS,
  RECOMENDACIONES_FRECUENTES,
  RESTRICCIONES,
  RESTRICCIONES_RETIRADAS,
  getConclusion,
  guardarConclusion,
  type Acuerdo,
} from '../../api/valoracion'
import { getHistorial } from '../../api/clinico'
import { macrosEnGramos } from '../../lib/calculadora'
import { Campo, claseControl } from '../Campo'
import { PanelCalculadora, type DatosCalculadora } from './PanelCalculadora'
import { PlanAlimentarioResumen } from './PlanAlimentarioResumen'
import { PlanAlimentarioCard } from './PlanAlimentarioCard'

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
  alergias,
  bloqueada,
  onGuardado,
}: {
  pacienteId: string
  consultaId: string
  edad: number | null
  sexo: string | null
  /**
   * Alergias e intolerancias del paciente (R44), de solo lectura.
   *
   * Llegan por prop y no por un fetch propio: la pantalla contenedora ya
   * tiene el paciente cargado, y pedirlo otra vez sería una segunda
   * petición para pintar lo mismo que el resumen del expediente.
   */
  alergias: { descripcion: string }[]
  bloqueada: boolean
  onGuardado: () => void | Promise<void>
}) {
  const [diagnostico, setDiagnostico] = useState('')
  const [secundario, setSecundario] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [objetivos, setObjetivos] = useState('')
  const [justificacion, setJustificacion] = useState('')
  const [recomendaciones, setRecomendaciones] = useState<string[]>([])
  const [personalizada, setPersonalizada] = useState('')
  const [kcal, setKcal] = useState('')
  const [pct, setPct] = useState({ proteina: 20, cho: 50, grasa: 30 })
  const [restricciones, setRestricciones] = useState<string[]>([])
  const [suplementos, setSuplementos] = useState('')
  const [pesoObjetivo, setPesoObjetivo] = useState('')
  const [fechaObjetivo, setFechaObjetivo] = useState('')
  const [acuerdos, setAcuerdos] = useState<Acuerdo[]>(ACUERDOS_INICIALES)
  const [fafHistorial, setFafHistorial] = useState<number | null>(null)

  const [calculadora, setCalculadora] = useState(false)
  const [datosCalculadora, setDatosCalculadora] = useState<DatosCalculadora | null>(null)
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
          setSecundario(c.diagnosticoSecundario ?? '')
          setObservaciones(c.observacionesClinicas ?? '')
          setObjetivos(c.objetivos ?? '')
          setJustificacion(c.justificacion ?? '')
          setRecomendaciones(c.recomendaciones ?? [])
          setKcal(c.kcalPrescritas?.toString() ?? '')
          if (c.pctProteina !== null && c.pctCho !== null && c.pctGrasa !== null) {
            setPct({ proteina: c.pctProteina, cho: c.pctCho, grasa: c.pctGrasa })
          }
          setRestricciones(c.restricciones ?? [])
          setSuplementos(c.suplementos ?? '')
          setPesoObjetivo(c.pesoObjetivo?.toString() ?? '')
          setFechaObjetivo(c.fechaObjetivoPeso ?? '')
          // Solo se sustituyen los acuerdos si ya había alguno guardado:
          // si no, se dejan los tres de arranque.
          if (c.acuerdos.length > 0) setAcuerdos(c.acuerdos)
          // Hidrata el encabezado del plan sin reabrir la calculadora.
          setDatosCalculadora(c.datosCalculadora ?? null)
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

  function recibirDeCalculadora(r: DatosCalculadora) {
    setKcal(String(r.metaCalorica))
    setPct({
      proteina: r.distribucionMacros.protPct,
      cho: r.distribucionMacros.choPct,
      grasa: r.distribucionMacros.grasaPct,
    })
    // El bloque completo alimenta el encabezado del plan y se persiste
    // junto a la conclusión al guardar.
    setDatosCalculadora(r)
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
        diagnosticoSecundario: secundario || null,
        observacionesClinicas: observaciones || null,
        objetivos: objetivos || null,
        justificacion: justificacion || null,
        recomendaciones,
        kcalPrescritas: kcalNum,
        // Los tres o ninguno: el servidor rechaza un reparto incompleto.
        ...(kcalNum !== null
          ? { pctProteina: pct.proteina, pctCho: pct.cho, pctGrasa: pct.grasa }
          : {}),
        restricciones,
        suplementos: suplementos || null,
        pesoObjetivo: pesoObjetivo.trim() === '' ? null : Number(pesoObjetivo),
        fechaObjetivoPeso: fechaObjetivo || null,
        acuerdos: acuerdos.filter((a) => a.texto.trim() !== ''),
        datosCalculadora,
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

          <Campo id="sec" etiqueta="Diagnóstico secundario" ayuda="Opcional">
            <input
              id="sec"
              type="text"
              value={secundario}
              onChange={(e) => setSecundario(e.target.value)}
              className={claseControl(false)}
            />
          </Campo>

          {/* Objetivos antes que observaciones: primero a dónde se va,
              después qué se vio. Y el objetivo es lo que la consulta de
              seguimiento va a buscar para comparar. */}
          <Campo
            id="objetivos"
            etiqueta="Objetivos del tratamiento"
            ayuda="En los términos del paciente: es lo que se revisa en la siguiente visita"
          >
            <textarea
              id="objetivos"
              rows={3}
              value={objetivos}
              onChange={(e) => setObjetivos(e.target.value)}
              className={`${claseControl(false)} resize-none`}
            />
          </Campo>

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

          {/* Las alergias, lo PRIMERO de la sección y de solo lectura
              (R44): son la restricción que no se negocia, y tenerlas que
              buscar en otra pestaña mientras se escribe el plan es cómo
              se prescribe lácteo a quien no lo tolera. Sin alergias
              registradas el bloque no aparece: un «Sin registrar» aquí se
              leería como «no tiene». */}
          {alergias.length > 0 && (
            <div
              className="rounded-md border p-3"
              style={{
                borderColor: 'var(--status-alert)',
                backgroundColor: 'color-mix(in srgb, var(--status-alert) 8%, transparent)',
              }}
            >
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink">
                Alergias e intolerancias
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {alergias.map((a) => (
                  <li
                    key={a.descripcion}
                    className="badge-estado"
                    style={{ '--estado-color': 'var(--status-alert)' } as CSSProperties}
                  >
                    {a.descripcion}
                  </li>
                ))}
              </ul>
            </div>
          )}

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

              {/* Restricciones que ya no se ofrecen pero que esta
                  conclusión tiene guardadas. Se pintan para poder
                  quitarlas a mano; sin esto quedarían invisibles y el
                  profesional creería haberlas borrado. */}
              {restricciones
                .filter((c) => RESTRICCIONES_RETIRADAS[c])
                .map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => alternar(restricciones, setRestricciones, c)}
                    title="Ya no se ofrece; se conserva porque estaba registrada"
                    className="rounded-pill border border-dashed border-primary bg-primary-tint px-3 py-1 text-sm font-medium text-primary"
                  >
                    {RESTRICCIONES_RETIRADAS[c]} ·
                  </button>
                ))}
            </div>
          </div>

          {/* La meta de peso vive aquí porque es parte de lo que se
              PRESCRIBE, no un deseo que el paciente se pone. Sin ella, la
              pantalla de progreso no puede decir cuánto lleva avanzado. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo id="meta-peso" etiqueta="Meta de peso (kg)" ayuda="Opcional">
              <input
                id="meta-peso"
                type="number"
                step="0.1"
                min={20}
                max={400}
                value={pesoObjetivo}
                onChange={(e) => {
                  setPesoObjetivo(e.target.value)
                  setOk(false)
                }}
                className={claseControl(false)}
              />
            </Campo>
            <Campo
              id="meta-fecha"
              etiqueta="Para cuándo"
              ayuda={pesoObjetivo.trim() === '' ? 'Necesita una meta de peso' : 'Opcional'}
            >
              <input
                id="meta-fecha"
                type="date"
                value={fechaObjetivo}
                disabled={pesoObjetivo.trim() === ''}
                onChange={(e) => setFechaObjetivo(e.target.value)}
                className={claseControl(false)}
              />
            </Campo>
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

        {/* ---- Justificación ---- */}
        {/* Entre la prescripción y el plan, y no dentro de la
            prescripción: se escribe DESPUÉS de haber decidido las kcal y
            los macros, mirándolos. Es el «por qué» de lo de arriba, no un
            campo más del formulario. */}
        <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
          <h3 className="font-semibold text-ink">Justificación</h3>
          <Campo
            id="justificacion"
            etiqueta="Razones clínicas de la prescripción"
            ayuda="Por qué estas kcal, estos macros y estas restricciones para este paciente"
          >
            <textarea
              id="justificacion"
              rows={4}
              value={justificacion}
              onChange={(e) => {
                setJustificacion(e.target.value)
                setOk(false)
              }}
              className={`${claseControl(false)} resize-y`}
            />
          </Campo>
        </section>

        {/* ---- Plan alimentario ---- */}
        {/* Encabezado con lo que dejó la calculadora (R39), persistido. */}
        <PlanAlimentarioCard datos={datosCalculadora} />
        <PlanAlimentarioResumen pacienteId={pacienteId} />

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
        datosGuardados={datosCalculadora}
        onCerrar={() => setCalculadora(false)}
        onEnviar={recibirDeCalculadora}
      />
    </div>
  )
}
