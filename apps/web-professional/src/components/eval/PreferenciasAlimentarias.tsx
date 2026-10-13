/**
 * Alimentos que el paciente no consume y alimentos preferidos, en
 * Prescripción — R50.
 *
 * Son dos campos de la Evaluación Dietética que se muestran aquí en solo
 * lectura, debajo de las alergias: es donde hacen falta. Buscarlos en
 * otra carpeta mientras se escribe el plan es cómo se prescribe hígado a
 * quien no lo come.
 *
 * ── Por qué este bloque SÍ aparece vacío y el de alergias no ────────
 *
 * La tarjeta de alergias se oculta cuando no hay ninguna, a propósito:
 * un «Sin registrar» ahí se leería como «no tiene alergias», y eso es
 * una afirmación clínica que el sistema no puede hacer.
 *
 * Aquí es al revés. «Sin registros» significa «no se preguntó todavía»,
 * y eso es información útil: el profesional ve que falta completar la
 * Evaluación Dietética. Ocultar el bloque dejaría la pantalla idéntica
 * en los dos casos —preguntado y sin preferencias, o nunca preguntado— y
 * son cosas distintas.
 *
 * ── Trae sus propios datos ──────────────────────────────────────────
 *
 * A diferencia de las alergias, que llegan por prop porque la pantalla
 * contenedora ya tiene el paciente cargado, esto pide la evaluación
 * dietética por su cuenta. Es lo que hace que se actualice sola: cambiar
 * de carpeta desmonta y vuelve a montar este componente, así que al
 * volver a Prescripción después de editar la Evaluación Dietética se ve
 * lo nuevo sin recargar la página.
 */
import { useEffect, useState } from 'react'
import { getDietetico } from '../../api/clinico'

export function PreferenciasAlimentarias({ pacienteId }: { pacienteId: string }) {
  const [noConsume, setNoConsume] = useState<string | null>(null)
  const [preferidos, setPreferidos] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    const ctrl = new AbortController()
    setCargando(true)
    getDietetico(pacienteId, ctrl.signal)
      .then((d) => {
        if (ctrl.signal.aborted) return
        setNoConsume(d.alimentosNoConsume ?? null)
        setPreferidos(d.alimentosPreferidos ?? null)
      })
      /*
       * El 404 es «este paciente todavía no tiene evaluación dietética»,
       * que es el estado inicial de todos los pacientes y no un fallo.
       * Se trata igual que los campos en blanco: «Sin registros».
       *
       * Por eso no hay estado de error: no hay nada que el profesional
       * pueda hacer con un «falló la carga de dos campos de texto» que no
       * sea lo mismo que hace con «sin registros» — ir a completarlos.
       */
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false)
      })
    return () => ctrl.abort()
  }, [pacienteId])

  if (cargando) {
    return <div className="h-24 animate-pulse rounded-md bg-surface-2" />
  }

  const bloques = [
    { titulo: 'Alimentos que no consume', texto: noConsume },
    { titulo: 'Alimentos preferidos', texto: preferidos },
  ]

  return (
    <div className="rounded-md border border-border bg-surface-2 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink">
        Preferencias alimentarias
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {bloques.map((b) => (
          <div key={b.titulo} className="min-w-0">
            <p className="text-xs font-medium text-muted">{b.titulo}</p>
            {b.texto ? (
              // `whitespace-pre-line`: el profesional escribe una línea
              // por alimento y así se lee igual aquí.
              <p className="mt-0.5 whitespace-pre-line text-sm text-ink">{b.texto}</p>
            ) : (
              <p className="mt-0.5 text-sm italic text-muted">Sin registros</p>
            )}
          </div>
        ))}
      </div>

      {!noConsume && !preferidos && (
        <p className="mt-2 text-xs text-muted">
          Se registran en Dietético → Evaluación Dietética.
        </p>
      )}
    </div>
  )
}
