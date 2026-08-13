/**
 * Agenda del día en el dashboard (CLI-08).
 *
 * Es siempre HOY, sin importar el período elegido arriba: responde a
 * "¿qué toca ahora?", que no es una estadística del rango.
 *
 * Las horas se formatean en el huso del NAVEGADOR con los mismos
 * ayudantes que la Agenda. La API entrega los instantes en UTC crudo a
 * propósito — formatearlos en el servidor es lo que hacía mostrar las
 * 21:00 para una cita de las 15:00.
 */
import { Link } from 'react-router-dom'
import { rangoHoras } from '../lib/fechas'
import { ChipEstadoCita } from './ChipEstadoCita'
import type { CitaEstado } from '../api/tipos'

export interface CitaHoy {
  citaId: string
  inicio: string
  fin: string
  estado: CitaEstado
  paciente: string
  profesional: string
}

export function AgendaHoy({ citas }: { citas: CitaHoy[] }) {
  if (citas.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
        No hay citas programadas para hoy.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      {citas.map((c) => (
        <li key={c.citaId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
          {/* Ancho fijo y cifras tabulares para que la columna de horas
              quede alineada y se pueda leer en vertical. */}
          <span className="w-32 shrink-0 text-sm font-semibold tabular-nums text-ink">
            {rangoHoras(c.inicio, c.fin)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.paciente}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted">{c.profesional}</span>
          <ChipEstadoCita estado={c.estado} />
        </li>
      ))}
      <li className="bg-surface-2 px-4 py-2 text-right">
        <Link to="/agenda" className="text-sm font-medium text-primary hover:underline">
          Ver la agenda completa →
        </Link>
      </li>
    </ul>
  )
}
