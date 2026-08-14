/**
 * Rejilla semanal de la agenda — AGE-01.
 *
 * La Rebanada 4 dejó esto fuera a propósito: la lista agrupada por día
 * resuelve «qué tengo hoy», que es la pregunta del día a día. La rejilla
 * responde otra: «dónde me cabe una cita de 45 minutos esta semana», y
 * para eso hay que ver los huecos, no las citas.
 *
 * Se apoya en el mismo `GET /api/citas?desde=&hasta=` que la lista. No
 * hace falta un `?semana=YYYY-WW`: sería una segunda forma de decir lo
 * mismo, y el cálculo de semana ISO es justo donde se cuelan los fallos
 * de un día.
 */
import { useMemo } from 'react'
import type { Cita } from '../api/tipos'

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

/** Franja visible. Fuera de estas horas no se agenda en una clínica. */
const HORA_INICIO = 7
const HORA_FIN = 21
const ALTO_HORA = 52 // px

/**
 * Lunes de la semana que contiene `fecha`, a las 00:00 LOCALES.
 *
 * En hora local a propósito: el profesional piensa en «esta semana» en
 * su huso, y la API recibe el instante ya convertido. Calcularlo en UTC
 * desplaza la rejilla un día para media Europa cada domingo por la noche.
 */
export function lunesDe(fecha: Date): Date {
  const d = new Date(fecha)
  d.setHours(0, 0, 0, 0)
  // getDay(): 0 es domingo. Se lleva al lunes anterior.
  const desplazamiento = d.getDay() === 0 ? -6 : 1 - d.getDay()
  d.setDate(d.getDate() + desplazamiento)
  return d
}

function mismoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** Color del bloque según el estado, con los tokens del design system. */
function colorDe(estado: Cita['estado']): { fondo: string; borde: string; texto: string } {
  switch (estado) {
    case 'confirmada':
      return { fondo: 'var(--primary)', borde: 'var(--primary)', texto: '#fff' }
    case 'completada':
      return {
        fondo: 'color-mix(in srgb, var(--status-normal) 16%, transparent)',
        borde: 'var(--status-normal)',
        texto: 'var(--ink)',
      }
    case 'no_asistio':
      return {
        fondo: 'color-mix(in srgb, var(--status-alert) 16%, transparent)',
        borde: 'var(--status-alert)',
        texto: 'var(--ink)',
      }
    case 'cancelada':
      return { fondo: 'var(--surface-2)', borde: 'var(--border)', texto: 'var(--muted)' }
    default:
      return { fondo: 'var(--primary-tint)', borde: 'var(--primary)', texto: 'var(--primary)' }
  }
}

export function VistaSemana({
  citas,
  lunes,
  onAbrir,
}: {
  citas: Cita[]
  lunes: Date
  onAbrir: (id: string) => void
}) {
  const dias = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(lunes)
        d.setDate(lunes.getDate() + i)
        return d
      }),
    [lunes],
  )

  const horas = useMemo(
    () => Array.from({ length: HORA_FIN - HORA_INICIO }, (_, i) => HORA_INICIO + i),
    [],
  )

  const hoy = new Date()

  /**
   * Cada cita a su columna y su posición vertical.
   *
   * Una cita que empieza antes de las 7 o acaba después de las 21 se
   * recorta a la franja visible en vez de desaparecer: es preferible
   * verla mal colocada que no verla.
   */
  const bloques = useMemo(() => {
    return citas
      .map((c) => {
        const inicio = new Date(c.inicio)
        const columna = dias.findIndex((d) => mismoDia(d, inicio))
        if (columna === -1) return null

        const minutosDesdeInicio =
          (inicio.getHours() - HORA_INICIO) * 60 + inicio.getMinutes()
        const alto = Math.max((c.duracionMinutos / 60) * ALTO_HORA, 22)
        const top = (minutosDesdeInicio / 60) * ALTO_HORA

        const maxTop = (HORA_FIN - HORA_INICIO) * ALTO_HORA
        if (top + alto < 0 || top > maxTop) return null

        return { cita: c, columna, top: Math.max(top, 0), alto, inicio }
      })
      .filter((b): b is NonNullable<typeof b> => b !== null)
  }, [citas, dias])

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <div className="min-w-[720px]">
        {/* Cabecera de días */}
        <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-border">
          <div />
          {dias.map((d, i) => {
            const esHoy = mismoDia(d, hoy)
            return (
              <div
                key={i}
                className={`border-l border-border px-2 py-2 text-center ${
                  esHoy ? 'bg-primary-tint' : ''
                }`}
              >
                <p className={`text-xs ${esHoy ? 'font-semibold text-primary' : 'text-muted'}`}>
                  {DIAS[i]}
                </p>
                <p className={`text-sm font-semibold ${esHoy ? 'text-primary' : 'text-ink'}`}>
                  {d.getDate()}
                </p>
              </div>
            )
          })}
        </div>

        {/* Rejilla */}
        <div className="relative grid grid-cols-[56px_repeat(7,1fr)]">
          {/* Columna de horas */}
          <div>
            {horas.map((h) => (
              <div
                key={h}
                style={{ height: ALTO_HORA }}
                className="border-b border-border pr-2 text-right text-[11px] text-muted"
              >
                <span className="relative -top-1.5">{String(h).padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>

          {/* Siete columnas de día */}
          {dias.map((_, col) => (
            <div key={col} className="relative border-l border-border">
              {horas.map((h) => (
                <div key={h} style={{ height: ALTO_HORA }} className="border-b border-border" />
              ))}

              {bloques
                .filter((b) => b.columna === col)
                .map((b) => {
                  const c = colorDe(b.cita.estado)
                  return (
                    <button
                      key={b.cita.id}
                      type="button"
                      onClick={() => onAbrir(b.cita.id)}
                      title={`${b.cita.paciente.nombre} · ${b.cita.duracionMinutos} min`}
                      style={{
                        top: b.top,
                        height: b.alto,
                        backgroundColor: c.fondo,
                        borderLeftColor: c.borde,
                        color: c.texto,
                      }}
                      className="absolute inset-x-1 overflow-hidden rounded-sm border-l-[3px] px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm"
                    >
                      <span className="block font-semibold">
                        {b.inicio.toLocaleTimeString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span
                        className={`block truncate ${b.cita.estado === 'cancelada' ? 'line-through' : ''}`}
                      >
                        {b.cita.paciente.nombre}
                      </span>
                    </button>
                  )
                })}
            </div>
          ))}
        </div>
      </div>

      {citas.length === 0 && (
        <p className="border-t border-border py-6 text-center text-sm text-muted">
          No hay citas esta semana.
        </p>
      )}
    </div>
  )
}
