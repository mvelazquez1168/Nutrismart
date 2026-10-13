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
import { useCambiosSinGuardar, useSalidaSegura } from '../../contexts/CambiosSinGuardar'
import { TablaDietetica } from './TablaDietetica'
import { FormFrecuenciaConsumo } from './FormFrecuenciaConsumo'
import {
  FormEvaluacionDietetica,
  HABITOS_VACIOS,
  type Habitos,
} from './FormEvaluacionDietetica'
import { ResumenDietetico } from './ResumenDietetico'
import { TotalesRecordatorio } from './TotalesRecordatorio'
import { AvisoPrecarga } from './BannerSeguimiento'

// Orden R40: Frecuencia → Recordatorio 24h → Consumo Usual → Resumen.
//
// R41 pedía una sola pestaña llamada «Recordatorio 24h / Consumo Usual».
// Ya son dos, que es esa misma pareja con cada mitad accesible por su
// nombre; juntarlas ahora escondería una detrás de la otra. Lo que sí se
// unifica es cómo se escriben, para que coincidan con el resto de la
// aplicación y con el PDF.
const SUB = [
  /*
   * «Evaluación Dietética» va PRIMERA, antes de Frecuencia de consumo
   * (R50). Son los hábitos: cuántos tiempos hace, dónde come, cómo
   * cocina. Se pregunta antes de medir con qué frecuencia come cada
   * grupo, y por eso abre la carpeta.
   *
   * Comparte nombre con el contenedor —esta carpeta se llama
   * «Evaluación dietética» desde la EVAL-04— porque así lo pide el
   * requerimiento. Queda señalado: si algún día confunde, lo que hay que
   * renombrar es una de las dos, no reordenar las pestañas.
   */
  { clave: 'evaluacion', etiqueta: 'Evaluación Dietética' },
  { clave: 'frecuencia', etiqueta: 'Frecuencia de consumo' },
  { clave: 'r24', etiqueta: 'Recordatorio 24h' },
  { clave: 'consumo_usual', etiqueta: 'Consumo Usual' },
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
  const [sub, setSub] = useState<Sub>('evaluacion')
  const [comidas, setComidas] = useState<ComidaR24[]>([])
  const [frecuencia, setFrecuencia] = useState<Record<string, string>>({})
  const [hidratacion, setHidratacion] = useState('')
  const [macros, setMacros] = useState(MACROS_VACIOS)
  const [notas, setNotas] = useState('')
  const [habitos, setHabitos] = useState<Habitos>(HABITOS_VACIOS)

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
          /*
           * Los tres si/no se conservan como `null` cuando llegan en
           * null: es «no se preguntó». Pasarlos por `?? false` pondría
           * un «No» que nadie dijo.
           */
          setHabitos({
            tiemposPorDia: d.tiemposPorDia ?? null,
            tiemposRealizados: d.tiemposRealizados ?? [],
            lugarComidas: d.lugarComidas ?? null,
            quienPrepara: d.quienPrepara ?? '',
            apetito: d.apetito ?? null,
            grasasCocinar: d.grasasCocinar ?? '',
            tiposCoccion: d.tiposCoccion ?? [],
            agregaSal: d.agregaSal ?? null,
            consumeAzucar: d.consumeAzucar ?? null,
            usaEdulcorante: d.usaEdulcorante ?? null,
            dietasRealizadas: d.dietasRealizadas ?? '',
            consumeAgua: d.consumeAgua ?? null,
            cantidadAgua: d.cantidadAgua ?? '',
            alimentosNoConsume: d.alimentosNoConsume ?? '',
            alimentosPreferidos: d.alimentosPreferidos ?? '',
          })
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

  /**
   * Aviso al salir con cambios sin guardar (R46).
   *
   * Cubre lo que guarda ESTE contenedor: hábitos alimentarios,
   * frecuencia, hidratación, macros y notas. Las dos tablas dietéticas se
   * registran por su cuenta —se guardan solas— y el modal las nombra
   * aparte.
   */
  const { marcarGuardado } = useCambiosSinGuardar({
    nombre: 'Dietético',
    activo: !cargando && !bloqueada,
    valores: { habitos, frecuencia, hidratacion, macros, notas },
    guardar: () => guardar(),
  })

  /** Cambiar de sub-pestaña no cambia la URL: lo bloquea el hook. */
  const salidaSegura = useSalidaSegura()

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

        /*
         * Los hábitos van en la MISMA petición que el resto (R50), como
         * todo lo que guarda este contenedor. El texto vacío se manda
         * como null: una cadena vacía guardada se lee después como «se
         * respondió y está en blanco».
         */
        tiemposPorDia: habitos.tiemposPorDia,
        tiemposRealizados: habitos.tiemposRealizados,
        lugarComidas: habitos.lugarComidas,
        quienPrepara: habitos.quienPrepara.trim() || null,
        apetito: habitos.apetito,
        grasasCocinar: habitos.grasasCocinar.trim() || null,
        tiposCoccion: habitos.tiposCoccion,
        agregaSal: habitos.agregaSal,
        consumeAzucar: habitos.consumeAzucar,
        usaEdulcorante: habitos.usaEdulcorante,
        dietasRealizadas: habitos.dietasRealizadas.trim() || null,
        consumeAgua: habitos.consumeAgua,
        cantidadAgua: habitos.cantidadAgua.trim() || null,
        alimentosNoConsume: habitos.alimentosNoConsume.trim() || null,
        alimentosPreferidos: habitos.alimentosPreferidos.trim() || null,
      })
      setOk(true)
      marcarGuardado()
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
            onClick={() => salidaSegura(() => setSub(s.clave))}
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

      {/* Recordatorio 24 h y Consumo Usual son autónomos: cargan y
          guardan su propio registro (con IA), aparte del guardado de
          frecuencia/macros. */}
      {sub === 'r24' && (
        <TablaDietetica pacienteId={pacienteId} consultaId={consultaId} tipo="recordatorio_24h" readOnly={bloqueada} />
      )}
      {sub === 'consumo_usual' && (
        <TablaDietetica pacienteId={pacienteId} consultaId={consultaId} tipo="consumo_usual" readOnly={bloqueada} />
      )}
      {sub === 'evaluacion' && (
        <FormEvaluacionDietetica datos={habitos} onCambio={setHabitos} bloqueada={bloqueada} />
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
        <>
          <ResumenDietetico macros={macros} onCambio={setMacros} bloqueada={bloqueada} />
          {/* Debajo de lo declarado, no encima: el orden dice cuál manda
              (R41). Copiar deja los valores en el formulario sin
              guardarlos — el botón de abajo sigue siendo el que persiste. */}
          <TotalesRecordatorio
            pacienteId={pacienteId}
            consultaId={consultaId}
            {...(bloqueada
              ? {}
              : {
                  onCopiar: (s) =>
                    setMacros((m) => ({
                      ...m,
                      kcal: s.kcal.toFixed(0),
                      cho: s.cho.toFixed(1),
                      proteina: s.prot.toFixed(1),
                      grasa: s.grasas.toFixed(1),
                    })),
                })}
          />
        </>
      )}

      {/* La nota y el guardado por lote cubren frecuencia y macros; las
          tablas dietéticas se guardan solas. */}
      {(sub === 'frecuencia' || sub === 'macros') && (
        <>
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
        </>
      )}
    </div>
  )
}
