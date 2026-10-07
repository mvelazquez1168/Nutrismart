/**
 * Hábitos del paciente dentro de la valoración clínica — R36, R41.
 *
 * ── Qué hace aquí ───────────────────────────────────────────────────
 *
 * Sueño y descanso se leen en la consulta, no al rellenar la ficha
 * social, así que viven donde se usan: Valoración → Clínico.
 *
 * ── Qué dejó de preguntarse, y por qué (R41) ────────────────────────
 *
 * Nivel de actividad física, tabaco y alcohol salieron de aquí: los tres
 * ya se recogen unos centímetros más arriba, en esta misma pestaña
 * —«Actividad física» con su factor FAF, y «Sustancias» con fuma y
 * alcohol—. Preguntar lo mismo dos veces en la misma pantalla produce
 * dos respuestas que no concuerdan, y entonces ninguna sirve.
 *
 * No se borraron de la base: hay pacientes con el dato guardado y el PDF
 * del expediente lo imprime. Se leen, ya no se escriben desde aquí; por
 * eso `aEnvio` los devuelve intactos (ver la nota de abajo).
 *
 * En su lugar entra la CALIDAD del descanso. Ocho horas despertándose
 * cinco veces no son ocho horas de sueño, y el número solo no lo decía.
 *
 * ── Por qué NO se guardan con el resto del Clínico ──────────────────
 *
 * Siguen siendo del paciente, no de la consulta: se guardan donde
 * siempre, en `paciente_sociodemografico`, por el mismo endpoint que la
 * pestaña de Sociodemografía. Cambió el sitio donde se escriben, no
 * dónde se almacenan.
 *
 * De ahí que este bloque tenga su propio botón de guardar y no comparta
 * el del historial clínico: son dos destinos distintos, y un solo botón
 * que escribe en dos sitios falla a medias.
 *
 * ── El detalle que hay que respetar ─────────────────────────────────
 *
 * Ese endpoint REEMPLAZA el bloque entero: lo que no se envía queda
 * nulo. Por eso se carga el bloque completo y se devuelve intacto,
 * cambiando solo los campos de este formulario. Si solo se mandaran
 * esos, guardar aquí borraría la ocupación, la escolaridad y el resto.
 *
 * ── El consentimiento manda igual que en la otra pantalla ───────────
 *
 * Son los mismos datos protegidos. Sin consentimiento, la API no los
 * envía y aquí no hay formulario: se explica por qué está vacío y se
 * remite a Sociodemografía, que es donde se registra.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { getSociodemografico, guardarSociodemografico } from '../../api/sociodemografico'
import { useCambiosSinGuardar } from '../../contexts/CambiosSinGuardar'
import { Campo, claseControl } from '../Campo'
import { InputNumero } from '../InputNumero'
import type { DatosSocioEnvio, Sociodemografia } from '../../api/tipos'

interface Formulario {
  horasSueno: string
  calificacionDescanso: string
  vecesDespiertaNoche: string
  notasHabitos: string
}

const VACIO: Formulario = {
  horasSueno: '',
  calificacionDescanso: '',
  vecesDespiertaNoche: '',
  notasHabitos: '',
}

/** Dónde se planta el control cuando todavía no hay dato. */
const DESCANSO_NEUTRO = 5

function aFormulario(b: Sociodemografia | null): Formulario {
  const d = b?.datos
  if (!d) return VACIO
  return {
    horasSueno: d.horasSueno?.toString() ?? '',
    calificacionDescanso: d.calificacionDescanso?.toString() ?? '',
    vecesDespiertaNoche: d.vecesDespiertaNoche?.toString() ?? '',
    notasHabitos: d.notasHabitos ?? '',
  }
}

/**
 * El bloque completo de vuelta, con los campos de este formulario
 * cambiados.
 *
 * Los demás viajan tal como llegaron —incluidos actividad, tabaco y
 * alcohol, que ya no se editan aquí—. Ver la nota de arriba: omitirlos
 * los dejaría nulos.
 */
function aEnvio(bloque: Sociodemografia, f: Formulario): DatosSocioEnvio {
  const d = bloque.datos
  const numero = (v: string) => (v.trim() === '' ? null : Number(v))
  return {
    consentimientoOtorgado: true,
    horasSueno: numero(f.horasSueno),
    calificacionDescanso: numero(f.calificacionDescanso),
    vecesDespiertaNoche: numero(f.vecesDespiertaNoche),
    notasHabitos: f.notasHabitos.trim() === '' ? null : f.notasHabitos.trim(),
    nivelActividad: d?.nivelActividad ?? null,
    tabaco: d?.tabaco ?? null,
    alcohol: d?.alcohol ?? null,
    ocupacion: d?.ocupacion ?? null,
    escolaridad: d?.escolaridad ?? null,
    personasEnHogar: d?.personasEnHogar ?? null,
    tipoHogar: d?.tipoHogar ?? null,
    religion: d?.religion ?? null,
    nacionalidad: d?.nacionalidad ?? null,
    lugarTrabajo: d?.lugarTrabajo ?? null,
  }
}

export function HabitosClinicos({
  pacienteId,
  bloqueada = false,
}: {
  pacienteId: string
  /** La consulta está finalizada: se lee, no se escribe. */
  bloqueada?: boolean
}) {
  const [bloque, setBloque] = useState<Sociodemografia | null>(null)
  const [form, setForm] = useState<Formulario>(VACIO)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guardado, setGuardado] = useState(false)

  const cargar = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const b = await getSociodemografico(pacienteId, signal)
        setBloque(b)
        setForm(aFormulario(b))
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof ApiError ? e.message : 'No se pudieron cargar los hábitos')
      } finally {
        setCargando(false)
      }
    },
    [pacienteId],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    void cargar(ctrl.signal)
    return () => ctrl.abort()
  }, [cargar])

  function campo(k: keyof Formulario, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
    setGuardado(false)
  }

  // Aviso al salir con cambios sin guardar (R46).
  const { marcarGuardado } = useCambiosSinGuardar({
    nombre: 'Hábitos',
    activo: !cargando && !bloqueada && (bloque?.consentimientoOtorgado ?? false),
    valores: form,
    guardar: () => guardar(),
  })

  async function guardar() {
    if (!bloque) return
    setGuardando(true)
    setError(null)
    try {
      const b = await guardarSociodemografico(pacienteId, aEnvio(bloque, form))
      setBloque(b)
      setForm(aFormulario(b))
      setGuardado(true)
      // Después de `setForm(aFormulario(b))`: la referencia tiene que ser
      // la del bloque que devolvió el servidor, no la de antes de pedirlo.
      marcarGuardado()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudieron guardar los hábitos')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) {
    return <div className="h-32 animate-pulse rounded-lg bg-surface-2" />
  }

  const descansoSinDato = form.calificacionDescanso === ''

  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
      <div>
        <h3 className="font-semibold text-ink">Hábitos</h3>
        <p className="mt-0.5 text-xs text-muted">
          Son datos del paciente, no de esta consulta: se guardan en su ficha y se ven también
          desde Sociodemografía.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-border bg-surface-2 p-3 text-sm text-ink">
          {error}
        </p>
      )}

      {/* Sin consentimiento la API no manda los datos, así que no hay
          nada que editar. Se dice por qué en vez de enseñar un
          formulario vacío que no guardaría. */}
      {!bloque?.consentimientoOtorgado ? (
        <p className="text-sm text-muted">
          El paciente todavía no ha dado su consentimiento para registrar estos datos. Se
          recoge en{' '}
          <Link
            to={`/pacientes/${pacienteId}`}
            className="font-medium text-primary hover:underline"
          >
            su ficha, pestaña Sociodemografía
          </Link>
          .
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* InputNumero y no type="number": en tablet el spinner
                nativo no se pinta y el saneado del campo cerraba el
                teclado al escribir (R46). Las horas admiten medias. */}
            <Campo id="hab-sueno" etiqueta="Horas de sueño por noche" ayuda="1 a 24">
              <InputNumero
                id="hab-sueno"
                etiqueta="horas de sueño por noche"
                min={1}
                max={24}
                paso={0.5}
                decimales
                disabled={bloqueada}
                valor={form.horasSueno}
                onChange={(v) => campo('horasSueno', v)}
              />
            </Campo>

            <Campo
              id="hab-despertares"
              etiqueta="Veces que despierta durante la noche"
              ayuda="0 a 30"
            >
              <InputNumero
                id="hab-despertares"
                etiqueta="veces que despierta durante la noche"
                min={0}
                max={30}
                disabled={bloqueada}
                valor={form.vecesDespiertaNoche}
                onChange={(v) => campo('vecesDespiertaNoche', v)}
              />
            </Campo>
          </div>

          {/* Control deslizante nativo: hace lo mismo que un Slider de
              shadcn (teclado y lector de pantalla incluidos) sin sumar
              una dependencia de Radix solo para esto. El color sale del
              token de marca, como el resto de controles. */}
          <div>
            <label htmlFor="hab-descanso" className="mb-1 block text-sm font-medium text-ink">
              Calificación de descanso
            </label>
            <div className="flex items-center gap-3">
              <input
                id="hab-descanso"
                type="range"
                min={1}
                max={10}
                step={1}
                disabled={bloqueada}
                value={descansoSinDato ? DESCANSO_NEUTRO : form.calificacionDescanso}
                onChange={(e) => campo('calificacionDescanso', e.target.value)}
                aria-valuetext={
                  descansoSinDato ? 'Sin registrar' : `${form.calificacionDescanso} de 10`
                }
                className="h-2 w-full max-w-md cursor-pointer appearance-none rounded-pill bg-surface-2 accent-[color:var(--primary)] disabled:cursor-not-allowed disabled:opacity-60"
              />
              <span
                className={`w-24 shrink-0 text-sm font-semibold tabular-nums ${
                  descansoSinDato ? 'text-muted' : 'text-ink'
                }`}
              >
                {descansoSinDato ? 'Sin registrar' : `${form.calificacionDescanso} / 10`}
              </span>
              {/* Sin esto no habría vuelta atrás: el deslizante no tiene
                  posición para «no lo sé», y 5 no es una respuesta. */}
              {!bloqueada && !descansoSinDato && (
                <button
                  type="button"
                  onClick={() => campo('calificacionDescanso', '')}
                  className="shrink-0 text-xs text-muted underline hover:text-ink"
                >
                  Quitar
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-muted">
              1 = descanso muy malo · 10 = descanso excelente
            </p>
          </div>

          <div>
            <label htmlFor="hab-notas" className="mb-1 block text-sm font-medium text-ink">
              Notas de hábitos
            </label>
            <textarea
              id="hab-notas"
              rows={4}
              maxLength={4000}
              disabled={bloqueada}
              value={form.notasHabitos}
              onChange={(e) => campo('notasHabitos', e.target.value)}
              placeholder="Rutina de sueño, siestas, turnos de trabajo, pantallas antes de dormir…"
              className={`${claseControl(false)} resize-y`}
            />
          </div>

          {!bloqueada && (
            <div className="flex items-center justify-end gap-3">
              {guardado && <span className="text-xs text-muted">Guardado</span>}
              <button
                type="button"
                onClick={() => void guardar()}
                disabled={guardando}
                className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              >
                {guardando ? 'Guardando…' : 'Guardar hábitos'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
