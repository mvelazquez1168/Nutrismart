/**
 * Tabla dietética estructurada — R40.
 *
 * Seis tiempos de comida con alimentos en texto libre. Sirve igual para
 * el Recordatorio de 24 horas y para el Consumo Usual: misma estructura y
 * lógica, distinto `tipo`, encabezado y textos guía.
 *
 * Cada fila puede mandarse a analizar: el modelo solo parte el texto en
 * alimentos con su cantidad, y los gramos y las kilocalorías salen de la
 * lista de intercambios ADA en la base (migración 048). El resultado se
 * cachea en la fila para no repetir la llamada mientras el texto no
 * cambie; el análisis lee el texto YA guardado en el servidor, así que
 * «Analizar» guarda primero y analiza después.
 *
 * ── Las cuatro casillas son del profesional ─────────────────────────
 *
 * CHO, proteínas, grasas y kcal se calculan y se pueden CORREGIR, las
 * cuatro. Antes solo las kcal, con el argumento de que corregir un macro
 * sin recalcular el conjunto da un reparto que no cuadra; el argumento se
 * cae cuando el alimento no está en la lista de intercambios, que es
 * justo cuando hace falta escribir a mano. Lo calculado nunca se pisa:
 * vaciar una casilla devuelve el número de la lista.
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

/* ------------------------------------------------------------------ */
/* Las cuatro columnas numéricas                                       */
/* ------------------------------------------------------------------ */

type Campo = 'cho' | 'prot' | 'grasas' | 'kcal'

/**
 * Los mismos topes que valida el servidor (`registroDietetico.ts`).
 *
 * Aquí no son la defensa —el servidor descarta lo que se pase— sino lo
 * que hace que el `type="number"` avise antes de guardar.
 */
const GRAMOS_MAX = 2_000
const KCAL_MAX = 20_000

const CAMPOS = [
  { campo: 'cho', etiqueta: 'CHO (g)', tope: GRAMOS_MAX, paso: '0.1', dec: 1 },
  { campo: 'prot', etiqueta: 'Prot (g)', tope: GRAMOS_MAX, paso: '0.1', dec: 1 },
  { campo: 'grasas', etiqueta: 'Grasas (g)', tope: GRAMOS_MAX, paso: '0.1', dec: 1 },
  { campo: 'kcal', etiqueta: 'kcal', tope: KCAL_MAX, paso: '1', dec: 0 },
] as const

/** El valor que calculó el servidor desde la lista de intercambios. */
function calculado(f: FilaDietetica, c: Campo): number | null {
  switch (c) {
    case 'cho':
      return f.ai_cho_g
    case 'prot':
      return f.ai_prot_g
    case 'grasas':
      return f.ai_grasas_g
    case 'kcal':
      return f.ai_kcal
  }
}

/** La corrección que ya estaba guardada en el servidor. */
function manualGuardado(f: FilaDietetica, c: Campo): number | null {
  switch (c) {
    case 'cho':
      return f.cho_g_manual
    case 'prot':
      return f.prot_g_manual
    case 'grasas':
      return f.grasas_g_manual
    case 'kcal':
      return f.kcal_manual
  }
}

interface FilaLocal extends FilaDietetica {
  analizando: boolean
  /**
   * Lo que hay escrito en cada casilla, como TEXTO.
   *
   * Un `number | null` no sirve mientras se teclea: borrar la casilla pasa
   * por la cadena vacía, y convertirla a 0 pondría un cero donde el
   * profesional está a medio escribir.
   */
  textos: Record<Campo, string>
}

function aLocal(filas: FilaDietetica[]): FilaLocal[] {
  const porTiempo = new Map(filas.map((f) => [f.tiempo_comida, f]))
  return TIEMPOS.map((t) => {
    const f = porTiempo.get(t.clave)
    const base: FilaDietetica = {
      tiempo_comida: t.clave,
      hora: f?.hora ?? null,
      alimentos_consumidos: f?.alimentos_consumidos ?? null,
      ai_kcal: f?.ai_kcal ?? null,
      ai_cho_g: f?.ai_cho_g ?? null,
      ai_prot_g: f?.ai_prot_g ?? null,
      ai_grasas_g: f?.ai_grasas_g ?? null,
      ai_calculado_en: f?.ai_calculado_en ?? null,
      kcal_manual: f?.kcal_manual ?? null,
      cho_g_manual: f?.cho_g_manual ?? null,
      prot_g_manual: f?.prot_g_manual ?? null,
      grasas_g_manual: f?.grasas_g_manual ?? null,
      ai_no_encontrado: f?.ai_no_encontrado ?? null,
    }
    // La casilla arranca con lo que VALE: la corrección si la hay, y si no
    // lo calculado. Es el número que el profesional va a corregir.
    const textos = {} as Record<Campo, string>
    for (const c of CAMPOS) {
      const v = manualGuardado(base, c.campo) ?? calculado(base, c.campo)
      textos[c.campo] = v === null ? '' : String(v)
    }
    return { ...base, analizando: false, textos }
  })
}

/**
 * La corrección que hay que persistir para una casilla.
 *
 * Vacío = sin corrección. Y si lo escrito coincide con lo calculado,
 * tampoco es corrección: guardarlo como tal congelaría la casilla y un
 * re-análisis posterior no se vería. Solo lo que difiere se guarda.
 */
function manualDe(f: FilaLocal, c: Campo): number | null {
  const t = (f.textos[c] ?? '').trim()
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0) return null
  const calc = calculado(f, c)
  if (calc !== null && n === calc) return null
  return n
}

/** El valor que vale para una casilla: la corrección manda. */
function efectivo(f: FilaLocal, c: Campo): number | null {
  return manualDe(f, c) ?? calculado(f, c)
}

/**
 * Totales del día, calculados aquí: el pie tiene que seguir al teclado.
 *
 * Los cuatro se suman POR SEPARADO. Antes la fila entera se descartaba si
 * no tenía kcal, de modo que unos gramos escritos a mano sin kcal no
 * sumaban en ningún sitio.
 */
function totalesLocales(filas: FilaLocal[]): Record<Campo, number> | null {
  const t: Record<Campo, number> = { cho: 0, prot: 0, grasas: 0, kcal: 0 }
  let hayAlgo = false
  for (const f of filas) {
    for (const c of CAMPOS) {
      const v = efectivo(f, c.campo)
      if (v === null) continue
      hayAlgo = true
      t[c.campo] += v
    }
  }
  return hayAlgo ? t : null
}

const CTRL =
  'w-full rounded-md border border-border bg-surface p-1.5 text-sm text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]'

const NUM =
  'w-full rounded-md border bg-surface px-1.5 py-1 text-right text-sm tabular-nums text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]'

function envio(filas: FilaLocal[]) {
  return {
    filas: filas.map((f) => ({
      tiempo_comida: f.tiempo_comida,
      hora: f.hora,
      alimentos_consumidos: f.alimentos_consumidos,
      kcal_manual: manualDe(f, 'kcal'),
      cho_g_manual: manualDe(f, 'cho'),
      prot_g_manual: manualDe(f, 'prot'),
      grasas_g_manual: manualDe(f, 'grasas'),
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
  // corregir un valor dejaría el pie de la tabla contradiciendo a la
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

  /**
   * Hora y alimentos.
   *
   * **Cambiar el texto de los alimentos vacía las cuatro casillas**, y se
   * ve vaciarse. Los números describían lo que estaba escrito antes: unos
   * gramos de «gallo pinto con huevo» no son los de lo que se escriba
   * encima. El servidor hacía este borrado por su cuenta y en silencio, lo
   * que dejaba al profesional mirando unos valores que el guardado iba a
   * tirar.
   *
   * La hora no toca nada: cambiarla no cambia lo que se comió.
   */
  function editar(i: number, campo: 'hora' | 'alimentos_consumidos', valor: string) {
    setFilas((prev) =>
      prev.map((f, j) => {
        if (i !== j) return f
        const nuevo = { ...f, [campo]: valor === '' ? null : valor }
        if (campo !== 'alimentos_consumidos') return nuevo
        if ((f.alimentos_consumidos ?? '') === valor) return nuevo
        return { ...nuevo, textos: { cho: '', prot: '', grasas: '', kcal: '' } }
      }),
    )
    setOk(false)
  }

  /**
   * Una casilla numérica a mano.
   *
   * Solo toca el texto; qué se guarda lo decide `manualDe` al enviar.
   * Vaciarla devuelve el número calculado, que nunca se pisó.
   */
  function editarNumero(i: number, campo: Campo, valor: string) {
    setFilas((prev) =>
      prev.map((f, j) => (i === j ? { ...f, textos: { ...f.textos, [campo]: valor } } : f)),
    )
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
        textos: f.textos,
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
              <th className="w-36 px-3 py-2 font-semibold text-ink">Tiempo de comida</th>
              <th className="w-24 px-3 py-2 font-semibold text-ink">Hora</th>
              <th className="min-w-56 px-3 py-2 font-semibold text-ink">Alimentos consumidos</th>
              {CAMPOS.map((c) => (
                <th key={c.campo} className="w-24 px-2 py-2 text-right font-semibold text-ink">
                  {c.etiqueta}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => {
              const tiempo = TIEMPOS[i]
              const tieneTexto = (f.alimentos_consumidos ?? '').trim() !== ''
              const analizado = f.ai_kcal !== null
              const noEncontrados = f.ai_no_encontrado ?? []
              return (
                <tr key={f.tiempo_comida} className="border-b border-border align-top">
                  <td className="w-36 bg-surface-2 px-3 py-2 font-medium text-ink">
                    {tiempo?.etiqueta}
                  </td>
                  <td className="w-24 px-2 py-2">
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

                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {/*
                        El aviso de que estos números NO salen de la lista.
                        Se pinta desde `ai_no_encontrado`, que el servidor
                        persiste en la fila: un aviso que se pierde al
                        recargar es un aviso que solo ve quien estaba
                        mirando (R48).
                      */}
                      {noEncontrados.length > 0 && (
                        <span
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium"
                          style={{
                            color: 'var(--status-alert)',
                            backgroundColor:
                              'color-mix(in srgb, var(--status-alert) 12%, transparent)',
                          }}
                          title={`No encontrado en la lista de intercambios: ${noEncontrados.join(
                            ', ',
                          )}. Ajusta los valores manualmente.`}
                        >
                          <span aria-hidden="true">⚠</span>
                          {noEncontrados.length === 1
                            ? '1 alimento sin equivalencia'
                            : `${noEncontrados.length} alimentos sin equivalencia`}
                        </span>
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

                  {/*
                    Las cuatro casillas. El borde de color marca la que
                    está corregida, y el `title` dice contra qué: sin eso,
                    un número escrito a mano y uno calculado se ven igual.
                  */}
                  {CAMPOS.map((c) => {
                    const calc = calculado(f, c.campo)
                    const corregido = manualDe(f, c.campo) !== null
                    return (
                      <td key={c.campo} className="w-24 px-2 py-2">
                        <input
                          type="number"
                          min={0}
                          max={c.tope}
                          step={c.paso}
                          inputMode="decimal"
                          value={f.textos[c.campo]}
                          disabled={readOnly}
                          onChange={(e) => editarNumero(i, c.campo, e.target.value)}
                          placeholder="—"
                          aria-label={`${c.etiqueta} de ${tiempo?.etiqueta}`}
                          title={
                            corregido && calc !== null
                              ? `Corregido a mano. Calculado desde la lista: ${calc.toFixed(c.dec)}`
                              : corregido
                                ? 'Escrito a mano: este alimento no está en la lista de intercambios'
                                : undefined
                          }
                          className={`${NUM} ${
                            corregido ? 'border-primary font-semibold' : 'border-border'
                          }`}
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            {/*
              La fila de totales, alineada con sus columnas y recalculada
              en cada pulsación. Antes esto era un párrafo al pie con los
              cuatro números en prosa: no se podía seguir la columna hasta
              su suma, que es justo lo que se hace al revisar una tabla.
            */}
            <tr className="border-t-2 border-border bg-surface-2 font-semibold">
              <td colSpan={3} className="px-3 py-2 text-right text-ink">
                Totales del día
              </td>
              {CAMPOS.map((c) => (
                <td
                  key={c.campo}
                  className="w-24 px-2 py-2 text-right tabular-nums text-primary"
                >
                  {suma !== null ? suma[c.campo].toFixed(c.dec) : '—'}
                </td>
              ))}
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
