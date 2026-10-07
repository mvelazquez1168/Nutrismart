/**
 * Historial clínico del paciente — EVAL-03.
 *
 * Uno por paciente, que se actualiza consulta a consulta. Al abrirlo se
 * precarga lo que ya hay: nadie debería reescribir los antecedentes
 * familiares en cada visita.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '../../api/client'
import {
  CONDICIONES,
  ESCALA_LIKERT,
  LIKERT,
  LIKERT_RETIRADOS,
  SINTOMAS_GI,
  getHistorial,
  guardarHistorial,
  type Historial,
} from '../../api/clinico'
import { Campo, claseControl } from '../Campo'
import { FormFarmacologia } from './FormFarmacologia'
import { AvisoPrecarga } from './BannerSeguimiento'

type Antecedente = { condicion: string; parientes?: string }

/**
 * Sección con título. **Tiene que vivir aquí, fuera del componente.**
 *
 * Estuvo declarado dentro del cuerpo de `FormHistorialClinico`, y eso le
 * daba una identidad de función nueva en cada render. Para React un tipo
 * de componente distinto no es el mismo componente con otras props: es
 * otro componente, así que desmontaba el subárbol entero y montaba uno
 * nuevo. Con el DOM recreado, el `<input>` que tenía el foco dejaba de
 * existir y el foco se iba al `<body>`.
 *
 * El síntoma era el campo «¿Quién?» de los antecedentes familiares:
 * escribir una letra llamaba a `setApf`, el render remontaba el bloque y
 * había que volver a hacer clic para la letra siguiente.
 */
function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
      <h3 className="font-semibold text-ink">{titulo}</h3>
      {children}
    </section>
  )
}

export function FormHistorialClinico({
  pacienteId,
  consultaId,
  bloqueada,
  fechaAnterior,
  onGuardado,
}: {
  pacienteId: string
  consultaId: string
  bloqueada: boolean
  /** Fecha de la consulta anterior, en modo seguimiento. */
  fechaAnterior?: string | null
  onGuardado: () => void | Promise<void>
}) {
  const [apf, setApf] = useState<Antecedente[]>([])
  const [app, setApp] = useState<Antecedente[]>([])
  const [sesiones, setSesiones] = useState('')
  const [duracion, setDuracion] = useState('')
  const [actividadDetalle, setActividadDetalle] = useState('')
  const [fuma, setFuma] = useState<boolean | null>(null)
  const [alcohol, setAlcohol] = useState<boolean | null>(null)
  const [otrasSustancias, setOtrasSustancias] = useState('')
  const [sintomas, setSintomas] = useState<string[]>([])
  const [giDetalle, setGiDetalle] = useState('')
  const [likert, setLikert] = useState<Record<string, number>>({})

  /**
   * Las notas del historial ya no tienen campo (R41).
   *
   * El bloque «Notas» que había aquí se fue al pie del expediente, como
   * «Notas del profesional»: una por paciente en vez de una por
   * consulta. Pero la columna `notas_adicionales` sigue teniendo lo que
   * se escribió antes, y el guardado de esta pantalla **reemplaza la
   * fila entera**: si no viajara de vuelta, la primera vez que alguien
   * tocara un antecedente borraría esas notas sin pedirlo.
   *
   * Se carga, no se enseña, y se devuelve tal cual.
   */
  const notasPrevias = useRef<string | null>(null)

  /**
   * Tipo de actividad física, conservado sin interfaz (R44).
   *
   * Las tarjetas de selección —las que enseñaban «FAF 1.2», «FAF 1.375»…—
   * se retiraron: el factor de actividad se fija en la calculadora, que
   * es donde se usa, y tenerlo en dos sitios permitía que dijeran cosas
   * distintas.
   *
   * La columna sigue en la base con lo ya elegido, y el servidor deriva
   * `faf` de ella. Como este guardado reemplaza la fila entera, el valor
   * tiene que viajar de vuelta o se borraría —y con él el FAF del
   * histórico— al primer guardado del historial.
   */
  const tipoActividadPrevio = useRef<string | null>(null)

  /**
   * Respuestas de las tres preguntas que salieron del tamizaje (R44).
   *
   * Igual que arriba: no se preguntan, no se pintan, y se devuelven tal
   * cual para no borrarlas.
   */
  const likertRetirado = useRef<Record<string, number | null>>({})

  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const cargar = useCallback((signal?: AbortSignal) => {
    setCargando(true)
    getHistorial(pacienteId, signal)
      .then((h: Historial) => {
        if (signal?.aborted) return
        setApf(h.apf ?? [])
        setApp(h.app ?? [])
        tipoActividadPrevio.current = h.tipoActividad ?? null
        setSesiones(h.sesionesSemana?.toString() ?? '')
        setDuracion(h.duracionMin?.toString() ?? '')
        setActividadDetalle(h.actividadDetalle ?? '')
        setFuma(h.fuma)
        setAlcohol(h.alcohol)
        setOtrasSustancias(h.otrasSustancias ?? '')
        setSintomas(h.sintomasGi ?? [])
        setGiDetalle(h.giDetalle ?? '')
        notasPrevias.current = h.notasAdicionales ?? null
        likertRetirado.current = Object.fromEntries(
          LIKERT_RETIRADOS.map((k) => [k, h[k]]),
        )
        setLikert(
          Object.fromEntries(
            LIKERT.map((l) => [l.clave, h[l.clave]]).filter(([, v]) => v !== null),
          ) as Record<string, number>,
        )
      })
      // 404 = aún no hay historial. No es un error: es el primer día.
      .catch(() => {})
      .finally(() => {
        if (!signal?.aborted) setCargando(false)
      })
  }, [pacienteId])

  useEffect(() => {
    const ctrl = new AbortController()
    cargar(ctrl.signal)
    return () => ctrl.abort()
  }, [cargar])

  function alternarAntecedente(
    lista: Antecedente[],
    set: (v: Antecedente[]) => void,
    condicion: string,
  ) {
    const existe = lista.some((a) => a.condicion === condicion)
    set(existe ? lista.filter((a) => a.condicion !== condicion) : [...lista, { condicion }])
    setOk(false)
  }

  async function guardar() {
    setGuardando(true)
    setError(null)
    setOk(false)
    try {
      await guardarHistorial(pacienteId, {
        consultaId,
        apf,
        app,
        tipoActividad: tipoActividadPrevio.current,
        sesionesSemana: sesiones === '' ? null : Number(sesiones),
        duracionMin: duracion === '' ? null : Number(duracion),
        actividadDetalle: actividadDetalle || null,
        fuma,
        alcohol,
        otrasSustancias: otrasSustancias || null,
        sintomasGi: sintomas,
        giDetalle: giDetalle || null,
        ...likertRetirado.current,
        ...likert,
        notasAdicionales: notasPrevias.current,
      })
      setOk(true)
      await onGuardado()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar el historial')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <div className="h-96 animate-pulse rounded-lg bg-surface-2" />

  return (
    <div className="space-y-6">
      {fechaAnterior && <AvisoPrecarga fecha={fechaAnterior} />}

      <fieldset disabled={bloqueada} className="space-y-6">
        <Bloque titulo="Antecedentes familiares">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CONDICIONES.map((cond) => {
              const marcado = apf.find((a) => a.condicion === cond)
              return (
                <div key={cond} className="flex items-center gap-2">
                  <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={!!marcado}
                      onChange={() => alternarAntecedente(apf, setApf, cond)}
                      className="h-4 w-4 accent-[color:var(--primary)]"
                    />
                    {cond}
                  </label>
                  {/* El parentesco solo aparece si la condición está
                      marcada: preguntarlo antes no tiene respuesta. */}
                  {marcado && (
                    <input
                      type="text"
                      value={marcado.parientes ?? ''}
                      onChange={(e) =>
                        setApf(
                          apf.map((a) =>
                            a.condicion === cond ? { ...a, parientes: e.target.value } : a,
                          ),
                        )
                      }
                      placeholder="¿Quién?"
                      aria-label={`Parentesco para ${cond}`}
                      className="w-28 rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-primary"
                    />
                  )}
                </div>
              )
            })}
          </div>
        </Bloque>

        <Bloque titulo="Antecedentes personales">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CONDICIONES.map((cond) => (
              <label key={cond} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={app.some((a) => a.condicion === cond)}
                  onChange={() => alternarAntecedente(app, setApp, cond)}
                  className="h-4 w-4 accent-[color:var(--primary)]"
                />
                {cond}
              </label>
            ))}
          </div>
        </Bloque>

        {/* Actividad física SIN selector de factor (R44): las tarjetas
            «FAF 1.2 / 1.375 / …» y la lectura del factor se retiraron. El
            FA se fija en la calculadora, que es quien lo usa. */}
        <Bloque titulo="Actividad física">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo id="ses" etiqueta="Sesiones por semana">
              <input
                id="ses"
                type="number"
                min={0}
                max={21}
                value={sesiones}
                onChange={(e) => setSesiones(e.target.value)}
                className={claseControl(false)}
              />
            </Campo>
            <Campo id="dur" etiqueta="Duración media (min)">
              <input
                id="dur"
                type="number"
                min={0}
                max={600}
                value={duracion}
                onChange={(e) => setDuracion(e.target.value)}
                className={claseControl(false)}
              />
            </Campo>
          </div>

          <Campo id="act-det" etiqueta="Detalles" ayuda="Opcional">
            <textarea
              id="act-det"
              rows={2}
              value={actividadDetalle}
              onChange={(e) => setActividadDetalle(e.target.value)}
              className={`${claseControl(false)} resize-none`}
            />
          </Campo>
        </Bloque>

        <Bloque titulo="Sustancias">
          <div className="flex flex-wrap gap-6">
            {[
              { etiqueta: '¿Fuma?', valor: fuma, set: setFuma },
              { etiqueta: '¿Consume alcohol?', valor: alcohol, set: setAlcohol },
            ].map((s) => (
              <div key={s.etiqueta}>
                <p className="mb-1 text-sm font-medium text-ink">{s.etiqueta}</p>
                <div className="flex gap-2">
                  {[
                    { t: 'Sí', v: true },
                    { t: 'No', v: false },
                  ].map((o) => (
                    <button
                      key={o.t}
                      type="button"
                      onClick={() => {
                        s.set(s.valor === o.v ? null : o.v)
                        setOk(false)
                      }}
                      className={`rounded-pill border px-4 py-1 text-sm ${
                        s.valor === o.v
                          ? 'border-primary bg-primary-tint font-medium text-primary'
                          : 'border-border text-ink hover:bg-surface-2'
                      }`}
                    >
                      {o.t}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Campo id="otras" etiqueta="Otras sustancias" ayuda="Opcional">
            <input
              id="otras"
              type="text"
              value={otrasSustancias}
              onChange={(e) => setOtrasSustancias(e.target.value)}
              className={claseControl(false)}
            />
          </Campo>
        </Bloque>

        <Bloque titulo="Salud digestiva">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SINTOMAS_GI.map((s) => (
              <label key={s} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={sintomas.includes(s)}
                  onChange={() => {
                    setSintomas(
                      sintomas.includes(s) ? sintomas.filter((x) => x !== s) : [...sintomas, s],
                    )
                    setOk(false)
                  }}
                  className="h-4 w-4 accent-[color:var(--primary)]"
                />
                {s}
              </label>
            ))}
          </div>
          {sintomas.length > 0 && (
            <Campo id="gi-det" etiqueta="Detalles">
              <textarea
                id="gi-det"
                rows={2}
                value={giDetalle}
                onChange={(e) => setGiDetalle(e.target.value)}
                className={`${claseControl(false)} resize-none`}
              />
            </Campo>
          )}
        </Bloque>

        <Bloque titulo="Relación con los alimentos">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {/* Las preguntas de la R44 son frases enteras, no
                      etiquetas de dos palabras: la columna pasa de w-48 a
                      la mitad de la tabla para que no se parta cada una
                      en cuatro líneas. */}
                  <th className="w-1/2 min-w-[18rem]" />
                  {ESCALA_LIKERT.map((e) => (
                    <th
                      key={e}
                      className="px-1 pb-2 text-center text-xs font-medium text-muted"
                    >
                      {e}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LIKERT.map((item) => (
                  <tr key={item.clave} className="border-t border-border">
                    <td className="py-2 pr-3 text-sm text-ink">{item.etiqueta}</td>
                    {ESCALA_LIKERT.map((_, i) => (
                      <td key={i} className="px-1 py-2 text-center">
                        <input
                          type="radio"
                          name={item.clave}
                          checked={likert[item.clave] === i + 1}
                          onChange={() => {
                            setLikert({ ...likert, [item.clave]: i + 1 })
                            setOk(false)
                          }}
                          aria-label={`${item.etiqueta}: ${ESCALA_LIKERT[i]}`}
                          className="h-4 w-4 accent-[color:var(--primary)]"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            Tamizaje orientativo, no un instrumento clínico validado. Si algo aquí preocupa, la
            derivación a salud mental es la respuesta, no un ajuste del plan.
          </p>
        </Bloque>

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
          Historial guardado.
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
            {guardando ? 'Guardando…' : 'Guardar historial'}
          </button>
        </div>
      )}

      {/* Sin `onAnadirANotas`: el bloque de notas al que copiaba ya no
          está aquí (R41). El panel de interacciones sigue avisando; lo
          que se quiera conservar va a «Notas del profesional», al pie
          del expediente. */}
      <FormFarmacologia pacienteId={pacienteId} bloqueada={bloqueada} />
    </div>
  )
}
