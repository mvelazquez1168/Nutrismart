/**
 * Generador de notas SOAP — IA-02.
 *
 * Cuatro fases: los datos de partida, la espera, la revisión del
 * borrador y el guardado. La fase de revisión NO se puede saltar: el
 * borrador nunca se guarda solo. Una nota SOAP en el expediente es un
 * texto firmado por una persona.
 *
 * Escribir la nota a mano, sin IA, es un camino de primera clase, no un
 * plan B: en muchas consultas es más rápido.
 */
import { useState } from 'react'
import { ApiError } from '../../api/client'
import {
  generarSOAP,
  guardarSOAP,
  motivoIaCaida,
  type BorradorSOAP,
  type NotaSOAP,
} from '../../api/ia'
import { Campo, claseControl } from '../Campo'

const VACIO: BorradorSOAP = { subjetivo: null, objetivo: null, analisis: null, planSoap: null }

const SECCIONES = [
  { clave: 'subjetivo', letra: 'S', titulo: 'Subjetivo', ayuda: 'Lo que refiere el paciente' },
  { clave: 'objetivo', letra: 'O', titulo: 'Objetivo', ayuda: 'Datos medibles y observables' },
  { clave: 'analisis', letra: 'A', titulo: 'Análisis', ayuda: 'Diagnóstico nutricional' },
  { clave: 'planSoap', letra: 'P', titulo: 'Plan', ayuda: 'Intervenciones y seguimiento' },
] as const

type Fase = 'inicio' | 'generando' | 'revisando'

export function GeneradorSOAP({
  pacienteId,
  onGuardada,
  onCancelar,
}: {
  pacienteId: string
  onGuardada: (nota: NotaSOAP) => void
  onCancelar: () => void
}) {
  const [fase, setFase] = useState<Fase>('inicio')
  const [motivo, setMotivo] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [borrador, setBorrador] = useState<BorradorSOAP>(VACIO)
  const [conIa, setConIa] = useState(false)
  const [modelo, setModelo] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generar() {
    setFase('generando')
    setError(null)
    try {
      const r = await generarSOAP(pacienteId, {
        ...(motivo.trim() !== '' ? { motivoConsulta: motivo.trim() } : {}),
        ...(observaciones.trim() !== '' ? { observacionesProfesional: observaciones.trim() } : {}),
      })
      setBorrador(r.borrador)
      setModelo(r.modelo)
      setConIa(true)
      setFase('revisando')
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 503
          ? motivoIaCaida(e.tipo)
          : e instanceof ApiError
            ? e.message
            : 'No se pudo generar el borrador',
      )
      setFase('inicio')
    }
  }

  function escribirAMano() {
    setBorrador(VACIO)
    setConIa(false)
    setModelo(null)
    setFase('revisando')
  }

  const hayContenido = SECCIONES.some((s) => (borrador[s.clave] ?? '').trim() !== '')

  async function guardar() {
    setGuardando(true)
    setError(null)
    try {
      // `generadaIa` viaja tal cual: aunque el profesional reescriba
      // cada palabra, la nota nació de una sugerencia y el expediente
      // debe poder decirlo.
      const nota = await guardarSOAP(pacienteId, { ...borrador, generadaIa: conIa })
      onGuardada(nota)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar la nota')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-ink">Nueva nota SOAP</h3>
        <button
          type="button"
          onClick={onCancelar}
          className="text-sm font-medium text-muted hover:text-ink"
        >
          Cancelar
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--status-alert)] bg-surface p-3 text-sm text-ink"
        >
          {error}
        </p>
      )}

      {fase === 'inicio' && (
        <>
          <Campo id="motivo" etiqueta="Motivo de consulta" ayuda="Opcional">
            <input
              id="motivo"
              type="text"
              maxLength={200}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Si lo dejas vacío se usa el del expediente"
              className={claseControl(false)}
            />
          </Campo>

          <Campo id="obs" etiqueta="Observaciones para la nota" ayuda="Opcional">
            <textarea
              id="obs"
              rows={3}
              maxLength={500}
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Lo que quieras que la nota recoja y no esté ya en el expediente…"
              className={`${claseControl(false)} resize-none`}
            />
          </Campo>

          <p className="text-sm text-muted">
            El borrador se redacta con los datos que ya hay en el expediente: última antropometría,
            laboratorios de los 90 días anteriores, historial, evaluación dietética y plan activo.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void generar()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
            >
              Generar borrador con IA
            </button>
            <button
              type="button"
              onClick={escribirAMano}
              className="text-sm font-medium text-primary hover:underline"
            >
              Escribirla a mano
            </button>
          </div>
        </>
      )}

      {fase === 'generando' && (
        <div className="space-y-3 py-6 text-center">
          <p className="text-sm font-medium text-ink">Redactando el borrador…</p>
          <div className="mx-auto h-2 w-48 overflow-hidden rounded-pill bg-surface-2">
            <div className="h-full w-1/3 animate-pulse rounded-pill bg-primary" />
          </div>
          <p className="text-xs text-muted">Puede tardar unos segundos.</p>
        </div>
      )}

      {fase === 'revisando' && (
        <>
          {conIa && (
            <p
              className="rounded-md border p-3 text-sm text-ink"
              style={{
                borderColor: 'var(--status-alert)',
                backgroundColor: 'color-mix(in srgb, var(--status-alert) 8%, transparent)',
              }}
            >
              <strong>Borrador generado por IA{modelo ? ` (${modelo})` : ''}.</strong> Revísalo y
              corrígelo antes de guardar: al guardarlo, la nota pasa a ser tuya y respondes de lo
              que dice. El modelo no ha visto al paciente.
            </p>
          )}

          {SECCIONES.map((s) => (
            <div key={s.clave}>
              <label
                htmlFor={`soap-${s.clave}`}
                className="mb-1 flex items-baseline gap-2 text-sm font-medium text-ink"
              >
                <span className="font-bold text-primary">{s.letra}</span>
                {s.titulo}
                <span className="text-xs font-normal text-muted">· {s.ayuda}</span>
              </label>
              <textarea
                id={`soap-${s.clave}`}
                rows={4}
                value={borrador[s.clave] ?? ''}
                onChange={(e) => setBorrador({ ...borrador, [s.clave]: e.target.value })}
                className={`${claseControl(false)} resize-y`}
              />
            </div>
          ))}

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setFase('inicio')}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2"
            >
              Descartar
            </button>
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={guardando || !hayContenido}
              className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
            >
              {guardando ? 'Guardando…' : 'Guardar nota'}
            </button>
          </div>

          {!hayContenido && (
            <p className="text-right text-xs text-muted">
              Rellena al menos una de las cuatro secciones.
            </p>
          )}
        </>
      )}
    </section>
  )
}
