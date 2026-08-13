/**
 * Contexto social del paciente — CLI-07.
 *
 * Tres estados, y el primero no es un vacío cualquiera: mientras no
 * haya consentimiento, no se enseña un formulario a medio rellenar,
 * se enseña la razón por la que está vacío.
 *
 *   sin consentimiento -> aviso y botón para registrarlo
 *   consentimiento + modo lectura -> lista de datos, Editar y Revocar
 *   modo edición -> formulario in situ, sin modal ni página nueva
 *
 * La API no envía `datos` mientras no haya consentimiento vigente, así
 * que este componente no puede enseñarlos aunque quisiera. Es
 * deliberado: si la promesa hecha al paciente dependiera de un `if` en
 * el navegador, cualquiera vería los datos en la respuesta.
 */
import { useCallback, useEffect, useState } from 'react'
import { getSociodemografico, guardarSociodemografico } from '../api/sociodemografico'
import { ApiError } from '../api/client'
import { Campo, claseControl } from '../components/Campo'
import {
  ESCOLARIDADES,
  FRECUENCIAS_ALCOHOL,
  NIVELES_ACTIVIDAD,
  TIPOS_HOGAR,
  type DatosSocioEnvio,
  type Sociodemografia,
} from '../api/tipos'

const ETIQUETA_ACTIVIDAD: Record<string, string> = {
  sedentario: 'Sedentario',
  leve: 'Leve',
  moderada: 'Moderada',
  intensa: 'Intensa',
}

const ETIQUETA_ALCOHOL: Record<string, string> = {
  nunca: 'Nunca',
  ocasional: 'Ocasional (≤ 2 veces por semana)',
  frecuente: 'Frecuente',
}

const ETIQUETA_ESCOLARIDAD: Record<string, string> = {
  ninguna: 'Ninguna',
  primaria: 'Primaria',
  secundaria: 'Secundaria',
  tecnica: 'Técnica',
  universitaria: 'Universitaria',
  posgrado: 'Posgrado',
}

const ETIQUETA_HOGAR: Record<string, string> = {
  solo: 'Solo',
  pareja: 'En pareja',
  familia_nuclear: 'Familia nuclear',
  familia_extendida: 'Familia extendida',
  companeros: 'Compañeros',
}

const TEXTO_CONSENTIMIENTO =
  'El paciente ha autorizado verbalmente la recopilación de esta información con fines de análisis nutricional.'

type Formulario = {
  nivelActividad: string
  horasSueno: string
  tabaco: string
  alcohol: string
  ocupacion: string
  escolaridad: string
  personasEnHogar: string
  tipoHogar: string
}

const VACIO: Formulario = {
  nivelActividad: '',
  horasSueno: '',
  tabaco: '',
  alcohol: '',
  ocupacion: '',
  escolaridad: '',
  personasEnHogar: '',
  tipoHogar: '',
}

function aFormulario(bloque: Sociodemografia | null): Formulario {
  const d = bloque?.datos
  if (!d) return VACIO
  return {
    nivelActividad: d.nivelActividad ?? '',
    horasSueno: d.horasSueno?.toString() ?? '',
    tabaco: d.tabaco === null || d.tabaco === undefined ? '' : String(d.tabaco),
    alcohol: d.alcohol ?? '',
    ocupacion: d.ocupacion ?? '',
    escolaridad: d.escolaridad ?? '',
    personasEnHogar: d.personasEnHogar?.toString() ?? '',
    tipoHogar: d.tipoHogar ?? '',
  }
}

/** Los vacíos viajan como null: "sin dato" no es lo mismo que cero. */
function aEnvio(f: Formulario, consentimiento: boolean): DatosSocioEnvio {
  const numero = (v: string) => (v.trim() === '' ? null : Number(v))
  const texto = (v: string) => (v.trim() === '' ? null : v.trim())
  return {
    consentimientoOtorgado: consentimiento,
    nivelActividad: (texto(f.nivelActividad) as DatosSocioEnvio['nivelActividad']) ?? null,
    horasSueno: numero(f.horasSueno),
    tabaco: f.tabaco === '' ? null : f.tabaco === 'true',
    alcohol: (texto(f.alcohol) as DatosSocioEnvio['alcohol']) ?? null,
    ocupacion: texto(f.ocupacion),
    escolaridad: (texto(f.escolaridad) as DatosSocioEnvio['escolaridad']) ?? null,
    personasEnHogar: numero(f.personasEnHogar),
    tipoHogar: (texto(f.tipoHogar) as DatosSocioEnvio['tipoHogar']) ?? null,
  }
}

function formatearFecha(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-CR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function SociodemografiaBloque({ pacienteId }: { pacienteId: string }) {
  const [bloque, setBloque] = useState<Sociodemografia | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorCampos, setErrorCampos] = useState<Record<string, string>>({})

  const [editando, setEditando] = useState(false)
  const [form, setForm] = useState<Formulario>(VACIO)
  const [consentimiento, setConsentimiento] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(
    (signal?: AbortSignal) => {
      setCargando(true)
      getSociodemografico(pacienteId, signal)
        .then((b) => {
          if (signal?.aborted) return
          setBloque(b)
          setForm(aFormulario(b))
          setConsentimiento(b.consentimientoOtorgado)
          setError(null)
        })
        .catch((e: unknown) => {
          if (signal?.aborted) return
          if (e instanceof DOMException && e.name === 'AbortError') return
          setError(e instanceof Error ? e.message : 'No se pudo cargar el contexto social')
        })
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

  function campo(nombre: keyof Formulario, valor: string) {
    setForm((f) => ({ ...f, [nombre]: valor }))
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!consentimiento) return

    setGuardando(true)
    setError(null)
    setErrorCampos({})
    try {
      const guardado = await guardarSociodemografico(pacienteId, aEnvio(form, true))
      setBloque(guardado)
      setForm(aFormulario(guardado))
      setEditando(false)
    } catch (e) {
      if (e instanceof ApiError && e.esValidacion) {
        setErrorCampos(Object.fromEntries((e.errores ?? []).map((x) => [x.campo, x.mensaje])))
        setError('Revisa los campos marcados.')
      } else {
        setError(e instanceof Error ? e.message : 'No se pudo guardar')
      }
    } finally {
      setGuardando(false)
    }
  }

  /**
   * Revocar es una acción aparte, no "guardar sin marcar la casilla".
   *
   * El formulario exige el consentimiento para guardar, así que sin
   * esto no habría forma de retirarlo: la casilla desmarcada
   * bloquearía el botón en vez de revocar.
   */
  async function revocar() {
    if (
      !window.confirm(
        'Al revocar el consentimiento, estos datos dejarán de mostrarse. Se conservan en el expediente por trazabilidad, pero no serán visibles hasta que el paciente vuelva a autorizarlos. ¿Continuar?',
      )
    ) {
      return
    }

    setGuardando(true)
    setError(null)
    try {
      const guardado = await guardarSociodemografico(pacienteId, aEnvio(form, false))
      setBloque(guardado)
      setConsentimiento(false)
      setEditando(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo revocar el consentimiento')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) {
    return <div className="h-40 animate-pulse rounded-lg bg-surface-2" />
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-ink">Contexto social</h2>
        {bloque?.consentimientoOtorgado && !editando && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditando(true)}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2"
            >
              Editar
            </button>
            <button
              type="button"
              onClick={revocar}
              disabled={guardando}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-60"
            >
              Revocar consentimiento
            </button>
          </div>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
        >
          {error}
        </p>
      )}

      {/* ---- Estado 1: sin consentimiento ---- */}
      {!bloque?.consentimientoOtorgado && !editando && (
        <div
          className="rounded-md border bg-surface p-4"
          style={{ borderColor: 'var(--status-alert)' }}
        >
          <p className="text-sm text-ink">
            <span className="font-semibold">
              No se ha registrado el consentimiento del paciente
            </span>{' '}
            para recopilar esta información.
          </p>
          {bloque?.recolectado && (
            <p className="mt-2 text-sm text-muted">
              Se recogieron datos anteriormente y siguen en el expediente, pero no se muestran
              mientras el consentimiento esté revocado.
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              setConsentimiento(false)
              setEditando(true)
            }}
            className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
          >
            Registrar consentimiento y completar datos
          </button>
        </div>
      )}

      {/* ---- Estado 2: lectura ---- */}
      {bloque?.consentimientoOtorgado && !editando && (
        <>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Dato etiqueta="Nivel de actividad física">
              {ETIQUETA_ACTIVIDAD[bloque.datos?.nivelActividad ?? ''] ?? '—'}
            </Dato>
            <Dato etiqueta="Horas de sueño por noche">
              {bloque.datos?.horasSueno !== null && bloque.datos?.horasSueno !== undefined
                ? `${bloque.datos.horasSueno} h`
                : '—'}
            </Dato>
            <Dato etiqueta="Fuma actualmente">
              {bloque.datos?.tabaco === null || bloque.datos?.tabaco === undefined
                ? '—'
                : bloque.datos.tabaco
                  ? 'Sí'
                  : 'No'}
            </Dato>
            <Dato etiqueta="Consumo de alcohol">
              {ETIQUETA_ALCOHOL[bloque.datos?.alcohol ?? ''] ?? '—'}
            </Dato>
            <Dato etiqueta="Ocupación">{bloque.datos?.ocupacion ?? '—'}</Dato>
            <Dato etiqueta="Escolaridad">
              {ETIQUETA_ESCOLARIDAD[bloque.datos?.escolaridad ?? ''] ?? '—'}
            </Dato>
            <Dato etiqueta="Personas en el hogar">{bloque.datos?.personasEnHogar ?? '—'}</Dato>
            <Dato etiqueta="Tipo de hogar">
              {ETIQUETA_HOGAR[bloque.datos?.tipoHogar ?? ''] ?? '—'}
            </Dato>
          </dl>
          <p className="mt-4 border-t border-border pt-3 text-xs text-muted">
            Consentimiento registrado el {formatearFecha(bloque.consentimientoFecha)}.
          </p>
        </>
      )}

      {/* ---- Estado 3: edición ---- */}
      {editando && (
        <form onSubmit={guardar} className="space-y-5">
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface-2 p-4">
            <input
              type="checkbox"
              checked={consentimiento}
              onChange={(e) => setConsentimiento(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--primary)]"
            />
            <span className="text-sm text-ink">{TEXTO_CONSENTIMIENTO}</span>
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Seleccion
              id="socio-actividad"
              etiqueta="Nivel de actividad física"
              valor={form.nivelActividad}
              opciones={NIVELES_ACTIVIDAD}
              etiquetas={ETIQUETA_ACTIVIDAD}
              error={errorCampos['nivelActividad']}
              onChange={(v) => campo('nivelActividad', v)}
            />

            <Campo
              id="socio-sueno"
              etiqueta="Horas de sueño por noche"
              {...(errorCampos['horasSueno'] ? { error: errorCampos['horasSueno'] } : {})}
            >
              <input
                id="socio-sueno"
                type="number"
                min={1}
                max={24}
                value={form.horasSueno}
                onChange={(e) => campo('horasSueno', e.target.value)}
                className={claseControl(!!errorCampos['horasSueno'])}
              />
            </Campo>

            <Seleccion
              id="socio-tabaco"
              etiqueta="Fuma actualmente"
              valor={form.tabaco}
              opciones={['true', 'false'] as const}
              etiquetas={{ true: 'Sí', false: 'No' }}
              error={errorCampos['tabaco']}
              onChange={(v) => campo('tabaco', v)}
            />

            <Seleccion
              id="socio-alcohol"
              etiqueta="Consumo de alcohol"
              valor={form.alcohol}
              opciones={FRECUENCIAS_ALCOHOL}
              etiquetas={ETIQUETA_ALCOHOL}
              error={errorCampos['alcohol']}
              onChange={(v) => campo('alcohol', v)}
            />

            <Campo
              id="socio-ocupacion"
              etiqueta="Ocupación"
              {...(errorCampos['ocupacion']
                ? { error: errorCampos['ocupacion'] }
                : { ayuda: `${form.ocupacion.length}/80` })}
            >
              <input
                id="socio-ocupacion"
                type="text"
                maxLength={80}
                value={form.ocupacion}
                onChange={(e) => campo('ocupacion', e.target.value)}
                className={claseControl(!!errorCampos['ocupacion'])}
              />
            </Campo>

            <Seleccion
              id="socio-escolaridad"
              etiqueta="Escolaridad"
              valor={form.escolaridad}
              opciones={ESCOLARIDADES}
              etiquetas={ETIQUETA_ESCOLARIDAD}
              error={errorCampos['escolaridad']}
              onChange={(v) => campo('escolaridad', v)}
            />

            <Campo
              id="socio-personas"
              etiqueta="Personas en el hogar"
              {...(errorCampos['personasEnHogar']
                ? { error: errorCampos['personasEnHogar'] }
                : {})}
            >
              <input
                id="socio-personas"
                type="number"
                min={1}
                max={20}
                value={form.personasEnHogar}
                onChange={(e) => campo('personasEnHogar', e.target.value)}
                className={claseControl(!!errorCampos['personasEnHogar'])}
              />
            </Campo>

            <Seleccion
              id="socio-hogar"
              etiqueta="Tipo de hogar"
              valor={form.tipoHogar}
              opciones={TIPOS_HOGAR}
              etiquetas={ETIQUETA_HOGAR}
              error={errorCampos['tipoHogar']}
              onChange={(v) => campo('tipoHogar', v)}
            />
          </div>

          <p className="text-xs text-muted">
            Todos los campos son opcionales: se registra solo lo que el paciente haya querido
            compartir.
          </p>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditando(false)
                setForm(aFormulario(bloque))
                setConsentimiento(bloque?.consentimientoOtorgado ?? false)
                setErrorCampos({})
                setError(null)
              }}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando || !consentimiento}
              title={consentimiento ? undefined : 'Marca el consentimiento para poder guardar'}
              className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
            >
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

function Seleccion({
  id,
  etiqueta,
  valor,
  opciones,
  etiquetas,
  error,
  onChange,
}: {
  id: string
  etiqueta: string
  valor: string
  opciones: readonly string[]
  etiquetas: Record<string, string>
  error: string | undefined
  onChange: (v: string) => void
}) {
  return (
    <Campo id={id} etiqueta={etiqueta} {...(error ? { error } : {})}>
      <select
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className={claseControl(!!error)}
      >
        {/* Sin dato es una respuesta válida, no un placeholder: la
            épica pide minimización, y forzar una opción inventaría
            información que el paciente no dio. */}
        <option value="">— Sin registrar</option>
        {opciones.map((o) => (
          <option key={o} value={o}>
            {etiquetas[o] ?? o}
          </option>
        ))}
      </select>
    </Campo>
  )
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  )
}
