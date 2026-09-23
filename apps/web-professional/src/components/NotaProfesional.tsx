/**
 * Nota del profesional sobre el paciente — R41.
 *
 * ── Por qué está al pie y fuera de las pestañas ─────────────────────
 *
 * Es la libreta del profesional sobre esa persona: lo que conviene
 * recordar antes de abrirle la puerta. No pertenece a ninguna pestaña
 * porque no pertenece a ninguna consulta —es una sola nota por paciente,
 * que se relee y se reescribe— así que vive debajo de todas, siempre
 * visible sea cual sea la pestaña abierta.
 *
 * No sustituye a nada versionado: las notas de cada consulta siguen en
 * el punto de control y el historial clínico donde estaban.
 *
 * ── Guardado ───────────────────────────────────────────────────────
 *
 * Automático, un segundo después de dejar de escribir. El botón está
 * igualmente, porque «se guarda solo» solo tranquiliza a quien ya lo ha
 * visto guardar: el estado a la derecha dice en qué punto está.
 *
 * El temporizador se cancela al desmontar, pero lo tecleado en ese
 * último segundo se pierde — por eso el botón. Un `beforeunload` sería
 * peor: bloquear la navegación por una nota es un precio alto.
 *
 * ── Visibilidad ────────────────────────────────────────────────────
 *
 * Solo el equipo clínico. La API la sirve únicamente por las rutas de
 * profesional; ninguna ruta de la app del paciente la lee.
 */
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { guardarNotaProfesional } from '../api/pacientes'

const LIMITE = 10_000
const RETARDO_MS = 1000

type Estado = 'limpio' | 'pendiente' | 'guardando' | 'guardado' | 'error'

export function NotaProfesional({
  pacienteId,
  notaInicial,
}: {
  pacienteId: string
  notaInicial: string | null
}) {
  const [nota, setNota] = useState(notaInicial ?? '')
  const [estado, setEstado] = useState<Estado>('limpio')
  const [error, setError] = useState<string | null>(null)

  // Lo último que confirmó el servidor. Evita guardar lo mismo dos veces
  // y permite volver a 'limpio' si el usuario deshace lo que escribió.
  const guardado = useRef(notaInicial ?? '')
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  // `notaInicial` se lee UNA vez, al montar. Quien renderiza pasa
  // `key={pacienteId}` para que cambiar de paciente remonte esto; así un
  // refresco del expediente a media escritura no pisa lo tecleado.

  useEffect(() => () => {
    if (temporizador.current) clearTimeout(temporizador.current)
  }, [])

  async function persistir(valor: string) {
    if (valor === guardado.current) {
      setEstado('limpio')
      return
    }
    setEstado('guardando')
    setError(null)
    try {
      const r = await guardarNotaProfesional(pacienteId, valor.trim() === '' ? null : valor)
      guardado.current = r.notaProfesional ?? ''
      setEstado('guardado')
    } catch (e) {
      setEstado('error')
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar la nota')
    }
  }

  function escribir(valor: string) {
    setNota(valor)
    setEstado(valor === guardado.current ? 'limpio' : 'pendiente')
    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => void persistir(valor), RETARDO_MS)
  }

  function guardarYa() {
    if (temporizador.current) clearTimeout(temporizador.current)
    void persistir(nota)
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-ink">Notas del profesional</h2>
        <span
          aria-live="polite"
          className={`text-xs ${estado === 'error' ? 'text-[color:var(--status-critical)]' : 'text-muted'}`}
        >
          {estado === 'guardando'
            ? 'Guardando…'
            : estado === 'guardado'
              ? 'Guardado'
              : estado === 'pendiente'
                ? 'Sin guardar'
                : estado === 'error'
                  ? 'No se guardó'
                  : ''}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted">
        Una sola nota por paciente, para el equipo clínico. El paciente no la ve. Se guarda
        sola al dejar de escribir.
      </p>

      <textarea
        rows={5}
        value={nota}
        maxLength={LIMITE}
        onChange={(e) => escribir(e.target.value)}
        onBlur={guardarYa}
        aria-label="Notas del profesional sobre este paciente"
        placeholder="Lo que conviene tener presente de este paciente…"
        className="w-full resize-y rounded-md border border-border bg-surface p-3 text-sm text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
      />

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
        >
          {error}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-muted tabular-nums">
          {nota.length} / {LIMITE}
        </span>
        <button
          type="button"
          onClick={guardarYa}
          disabled={estado === 'guardando' || estado === 'limpio'}
          className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
        >
          Guardar nota
        </button>
      </div>
    </section>
  )
}
