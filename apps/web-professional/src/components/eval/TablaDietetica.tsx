/**
 * Tabla dietética estructurada — R40.
 *
 * Seis tiempos de comida con alimentos en texto libre. Sirve igual para
 * el Recordatorio de 24 horas y para el Consumo Usual: misma estructura y
 * lógica, distinto `tipo`, encabezado y textos guía.
 *
 * Cada fila puede mandarse a Claude (método ADA) para estimar
 * kcal/CHO/Prot/Grasas. El análisis lee el texto YA guardado en el
 * servidor, así que «Analizar» guarda primero y analiza después; el
 * servidor cachea el resultado mientras el texto no cambie.
 *
 * Autónomo: carga y guarda su propio registro (`registro_dietetico`),
 * aparte del guardado de frecuencia/macros del contenedor dietético.
 */
import { useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import { useCambiosSinGuardar } from '../../contexts/CambiosSinGuardar'
import {
  analizarFilaDietetica,
  getRegistroDietetico,
  guardarRegistroDietetico,
  type FilaDietetica,
  type RegistroDietetico,
  type TipoRegistro,
} from '../../api/registroDietetico'

const TIEMPOS = [
  { clave: 'desayuno', etiqueta: 'Desayuno' },
  { clave: 'merienda_manana', etiqueta: 'Merienda Mañana' },
  { clave: 'almuerzo', etiqueta: 'Almuerzo' },
  { clave: 'merienda_tarde', etiqueta: 'Merienda tarde' },
  { clave: 'cena', etiqueta: 'Cena' },
  { clave: 'colacion_nocturna', etiqueta: 'Colación nocturna' },
] as const

const TEXTOS: Record<TipoRegistro, { titulo: string; subtitulo: string; placeholder: string }> = {
  recordatorio_24h: {
    titulo: 'Recordatorio de 24 horas',
    subtitulo: '¿Qué comió el paciente ayer?',
    placeholder: 'Ej: 2 tazas de café con leche, 2 tostadas con mantequilla…',
  },
  consumo_usual: {
    titulo: 'Consumo Usual',
    subtitulo: '¿Qué consume el paciente habitualmente?',
    placeholder: 'Ej: Generalmente consume 1 taza de café, pan…',
  },
}

interface FilaLocal extends FilaDietetica {
  analizando: boolean
  /**
   * Lo que hay escrito en la casilla de kcal, como texto.
   *
   * Un `number | null` no sirve mientras se teclea: borrar el campo pasa
   * por la cadena vacía, y convertirla a 0 pondría un cero donde el
   * profesional está a medio escribir.
   */
  kcalTexto: string
}

/** kcal que vale para esta fila: la corrección manual manda sobre la IA. */
function kcalEfectivo(f: { ai_kcal: number | null; kcal_manual: number | null }): number | null {
  return f.kcal_manual ?? f.ai_kcal
}

function aLocal(filas: FilaDietetica[]): FilaLocal[] {
  const porTiempo = new Map(filas.map((f) => [f.tiempo_comida, f]))
  return TIEMPOS.map((t) => {
    const f = porTiempo.get(t.clave)
    const base = {
      tiempo_comida: t.clave,
      hora: f?.hora ?? null,
      alimentos_consumidos: f?.alimentos_consumidos ?? null,
      ai_kcal: f?.ai_kcal ?? null,
      ai_cho_g: f?.ai_cho_g ?? null,
      ai_prot_g: f?.ai_prot_g ?? null,
      ai_grasas_g: f?.ai_grasas_g ?? null,
      ai_calculado_en: f?.ai_calculado_en ?? null,
      kcal_manual: f?.kcal_manual ?? null,
    }
    const kcal = kcalEfectivo(base)
    return {
      ...base,
      analizando: false,
      kcalTexto: kcal === null ? '' : String(kcal),
    }
  })
}

/**
 * La corrección que hay que persistir para una fila.
 *
 * Vacío = sin corrección. Y si lo escrito coincide con lo que dijo la
 * IA, tampoco es corrección: guardarlo como tal congelaría la casilla y
 * un re-análisis posterior no se vería. Solo lo que difiere se guarda.
 */
function kcalManualDe(f: FilaLocal): number | null {
  const t = f.kcalTexto.trim()
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0) return null
  if (f.ai_kcal !== null && n === f.ai_kcal) return null
  return n
}

/** Totales del día calculados aquí: el pie tiene que seguir al teclado. */
function totalesLocales(filas: FilaLocal[]) {
  const t = { kcal: 0, cho: 0, prot: 0, grasas: 0 }
  let hayAlgo = false
  for (const f of filas) {
    const kcal = kcalManualDe(f) ?? f.ai_kcal
    if (kcal === null) continue
    hayAlgo = true
    t.kcal += kcal
    t.cho += f.ai_cho_g ?? 0
    t.prot += f.ai_prot_g ?? 0
    t.grasas += f.ai_grasas_g ?? 0
  }
  return hayAlgo ? t : null
}

const CTRL =
  'w-full rounded-md border border-border bg-surface p-1.5 text-sm text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]'

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-xs font-medium tabular-nums text-ink">
      {children}
    </span>
  )
}

function envio(filas: FilaLocal[]) {
  return {
    filas: filas.map((f) => ({
      tiempo_comida: f.tiempo_comida,
      hora: f.hora,
      alimentos_consumidos: f.alimentos_consumidos,
      kcal_manual: kcalManualDe(f),
    })),
  }
}

export function TablaDietetica({
  pacienteId,
  consultaId,
  tipo,
  readOnly = false,
}: {
  pacienteId: string
  consultaId: string
  tipo: TipoRegistro
  readOnly?: boolean
}) {
  const t = TEXTOS[tipo]
  const [filas, setFilas] = useState<FilaLocal[]>(() => aLocal([]))
  const [observaciones, setObservaciones] = useState('')

  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  /**
   * El fallo del análisis, en la FILA que se analizó — R46.
   *
   * El mensaje de `error` se pinta al pie del componente, debajo de las
   * observaciones. Pulsando «Analizar IA» en el Desayuno —arriba de una
   * tabla de seis filas— ese aviso cae fuera de la pantalla: el botón
   * dejaba de decir «Analizando…», no aparecía ningún macro y no se veía
   * nada más. De ahí el «no dispara ninguna llamada»: sí la dispara, y
   * falla donde nadie mira.
   */
  const [errorIa, setErrorIa] = useState<{ tiempo: string; mensaje: string } | null>(null)

  // Los totales del servidor no se guardan en estado: se recalculan aquí
  // a partir de las filas (`totalesLocales`). Si dependieran del guardado,
  // corregir un kcal dejaría el pie de la tabla contradiciendo a la
  // columna que se acaba de editar.
  function hidratar(r: RegistroDietetico) {
    setFilas(aLocal(r.filas))
    setObservaciones(r.observaciones ?? '')
  }

  useEffect(() => {
    const ctrl = new AbortController()
    setCargando(true)
    getRegistroDietetico(pacienteId, consultaId, tipo, ctrl.signal)
      .then((r) => {
        if (!ctrl.signal.aborted) hidratar(r)
      })
      /**
       * El fallo de carga SÍ se enseña (R46).
       *
       * Este `catch` decía «sin registro aún: quedan las seis filas en
       * blanco», y era un diagnóstico equivocado: cuando no hay registro
       * el servidor responde 200 con las seis filas vacías. Aquí solo
       * llegan fallos de verdad —403, consulta no encontrada, 500, red—,
       * y tragárselos dejaba una tabla en blanco indistinguible de una
       * consulta nueva. Sobre esa tabla, «Analizar IA» no podía más que
       * fallar.
       */
      .catch((e) => {
        if (ctrl.signal.aborted) return
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(
          e instanceof ApiError
            ? `No se pudo cargar ${t.titulo}: ${e.message}`
            : `No se pudo cargar ${t.titulo}`,
        )
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false)
      })
    return () => ctrl.abort()
  }, [pacienteId, consultaId, tipo])

  function editar(i: number, campo: 'hora' | 'alimentos_consumidos', valor: string) {
    setFilas((prev) =>
      prev.map((f, j) => (i === j ? { ...f, [campo]: valor === '' ? null : valor } : f)),
    )
    setOk(false)
  }

  /**
   * kcal a mano.
   *
   * Solo toca el texto de la casilla; qué se guarda lo decide
   * `kcalManualDe` al enviar. Vaciarla devuelve el número de la IA, que
   * nunca se pisó.
   */
  function editarKcal(i: number, valor: string) {
    setFilas((prev) => prev.map((f, j) => (i === j ? { ...f, kcalTexto: valor } : f)))
    setOk(false)
  }

  // Aviso al salir con cambios sin guardar (R46). `analizando` queda
  // fuera: es estado de la petición, no algo que el profesional escriba.
  const { marcarGuardado } = useCambiosSinGuardar({
    nombre: t.titulo,
    activo: !cargando && !readOnly,
    valores: {
      observaciones,
      filas: filas.map((f) => ({
        hora: f.hora,
        alimentos: f.alimentos_consumidos,
        kcal: f.kcalTexto,
      })),
    },
    guardar: () => guardar(),
  })

  async function guardar() {
    setGuardando(true)
    setError(null)
    setOk(false)
    try {
      const r = await guardarRegistroDietetico(pacienteId, consultaId, tipo, {
        observaciones: observaciones.trim() === '' ? null : observaciones.trim(),
        ...envio(filas),
      })
      hidratar(r)
      setOk(true)
      // Tras `hidratar(r)`: la referencia es la del registro que devolvió
      // el servidor.
      marcarGuardado()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar el registro dietético')
    } finally {
      setGuardando(false)
    }
  }

  async function analizar(i: number) {
    const fila = filas[i]
    if (!fila || !fila.alimentos_consumidos || fila.alimentos_consumidos.trim() === '') return
    setError(null)
    setErrorIa(null)
    setFilas((prev) => prev.map((f, j) => (i === j ? { ...f, analizando: true } : f)))
    try {
      // El servidor analiza el texto GUARDADO: se guarda primero para que
      // no analice una versión vieja.
      await guardarRegistroDietetico(pacienteId, consultaId, tipo, {
        observaciones: observaciones.trim() === '' ? null : observaciones.trim(),
        ...envio(filas),
      })
      const r = await analizarFilaDietetica(pacienteId, consultaId, tipo, fila.tiempo_comida)
      hidratar(r)
    } catch (e) {
      setFilas((prev) => prev.map((f, j) => (i === j ? { ...f, analizando: false } : f)))
      // El mensaje de la API ya nombra el motivo y dice si esperar sirve
      // de algo (ver MENSAJE_FALLO_IA en routes/registroDietetico.ts).
      const mensaje =
        e instanceof ApiError ? e.message : 'No se pudo analizar el tiempo de comida'
      setErrorIa({ tiempo: fila.tiempo_comida, mensaje })
      setError(mensaje)
    }
  }

  if (cargando) return <div className="h-96 animate-pulse rounded-lg bg-surface-2" />

  const suma = totalesLocales(filas)

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-ink">{t.titulo}</h3>
        <p className="text-sm text-muted">{t.subtitulo}</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left">
              <th className="w-40 px-3 py-2 font-semibold text-ink">Tiempo de comida</th>
              <th className="w-28 px-3 py-2 font-semibold text-ink">Hora</th>
              <th className="px-3 py-2 font-semibold text-ink">Alimentos consumidos</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => {
              const tiempo = TIEMPOS[i]
              const tieneTexto = (f.alimentos_consumidos ?? '').trim() !== ''
              const analizado = f.ai_kcal !== null
              const corregido = analizado && kcalManualDe(f) !== null
              return (
                <tr key={f.tiempo_comida} className="border-b border-border align-top">
                  <td className="w-40 bg-surface-2 px-3 py-2 font-medium text-ink">{tiempo?.etiqueta}</td>
                  <td className="w-28 px-2 py-2">
                    <input
                      type="time"
                      value={f.hora ?? ''}
                      disabled={readOnly}
                      onChange={(e) => editar(i, 'hora', e.target.value)}
                      aria-label={`Hora de ${tiempo?.etiqueta}`}
                      className={CTRL}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <textarea
                      rows={2}
                      value={f.alimentos_consumidos ?? ''}
                      disabled={readOnly}
                      onChange={(e) => editar(i, 'alimentos_consumidos', e.target.value)}
                      placeholder={t.placeholder}
                      aria-label={`Alimentos de ${tiempo?.etiqueta}`}
                      className={`${CTRL} resize-y`}
                    />

                    {/* Macros de la IA + kcal, que sí se puede corregir */}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {/* kcal es un campo, no una etiqueta: el método ADA
                          estima, y quien firma la valoración tiene que
                          poder decir otra cosa. Los macros siguen siendo
                          de la IA: corregirlos uno a uno sin recalcular
                          el conjunto daría un reparto que no cuadra. */}
                      <label className="flex items-center gap-1 text-xs text-muted">
                        <input
                          type="number"
                          min={0}
                          step="1"
                          inputMode="numeric"
                          value={f.kcalTexto}
                          disabled={readOnly}
                          onChange={(e) => editarKcal(i, e.target.value)}
                          placeholder="—"
                          aria-label={`Kilocalorías de ${tiempo?.etiqueta}`}
                          className={`w-20 rounded-md border bg-surface px-1.5 py-0.5 text-xs tabular-nums text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)] ${
                            corregido ? 'border-primary font-semibold' : 'border-border'
                          }`}
                        />
                        kcal
                      </label>
                      {corregido && (
                        <span
                          className="text-xs text-muted"
                          title={`La IA estimó ${f.ai_kcal?.toFixed(0)} kcal`}
                        >
                          (IA: {f.ai_kcal?.toFixed(0)})
                        </span>
                      )}
                      {analizado && (
                        <>
                          <Badge>CHO {f.ai_cho_g?.toFixed(1)} g</Badge>
                          <Badge>Prot {f.ai_prot_g?.toFixed(1)} g</Badge>
                          <Badge>Grasas {f.ai_grasas_g?.toFixed(1)} g</Badge>
                        </>
                      )}
                      {!readOnly && tieneTexto && (
                        <button
                          type="button"
                          onClick={() => void analizar(i)}
                          disabled={f.analizando}
                          className="rounded-md border border-primary px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary-tint disabled:opacity-60"
                        >
                          {f.analizando ? 'Analizando…' : analizado ? '↻ Re-analizar' : 'Analizar IA'}
                        </button>
                      )}
                    </div>

                    {/* El fallo, junto al botón que lo provocó. Al pie de la
                        página no se ve: la tabla tiene seis filas (R46). */}
                    {errorIa?.tiempo === f.tiempo_comida && (
                      <p
                        role="alert"
                        className="mt-1 rounded-md border p-2 text-xs"
                        style={{
                          borderColor: 'var(--status-alert)',
                          backgroundColor: 'color-mix(in srgb, var(--status-alert) 8%, transparent)',
                        }}
                      >
                        {errorIa.mensaje}
                      </p>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-surface-2">
              <td colSpan={3} className="px-3 py-2">
                <p className="text-sm font-semibold text-ink">
                  Consumo calórico aproximado:{' '}
                  <span className="tabular-nums text-primary">
                    {suma !== null ? suma.kcal.toFixed(0) : '—'}
                  </span>{' '}
                  kcal/día
                </p>
                <p className="text-xs text-muted">
                  CHO: {suma !== null ? suma.cho.toFixed(1) : '—'} g · Prot:{' '}
                  {suma !== null ? suma.prot.toFixed(1) : '—'} g · Grasas:{' '}
                  {suma !== null ? suma.grasas.toFixed(1) : '—'} g
                </p>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div>
        <label htmlFor={`obs-${tipo}`} className="mb-1 block text-sm font-medium text-ink">
          Observaciones
        </label>
        <textarea
          id={`obs-${tipo}`}
          rows={4}
          value={observaciones}
          disabled={readOnly}
          onChange={(e) => {
            setObservaciones(e.target.value)
            setOk(false)
          }}
          className={`${CTRL} resize-y`}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded-md border border-border bg-primary-tint p-3 text-sm text-primary">
          {t.titulo} guardado.
        </p>
      )}

      {!readOnly && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={guardando}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      )}
    </div>
  )
}
