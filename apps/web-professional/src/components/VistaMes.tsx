/**
 * Vista mensual de la agenda — AGE-04.
 *
 * Responde una tercera pregunta, distinta de las otras dos vistas: «cómo
 * viene el mes». No se leen horas aquí —para eso está la semana— sino
 * densidad: qué días están cargados y cuáles vacíos.
 *
 * Por eso cada día muestra como mucho tres citas y un contador: meter
 * ocho en una celda de 90 px no se lee, y quien necesita el detalle de
 * un día pulsa y salta a esa semana.
 */
import { useMemo } from 'react'
import type { Cita } from '../api/tipos'

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MAX_VISIBLES = 3

function clave(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function mismoDia(a: Date, b: Date): boolean {
  return clave(a) === clave(b)
}

function colorDe(estado: Cita['estado']): { fondo: string; texto: string } {
  switch (estado) {
    case 'confirmada':
      return { fondo: 'var(--primary)', texto: '#fff' }
    case 'completada':
      return {
        fondo: 'color-mix(in srgb, var(--status-normal) 20%, transparent)',
        texto: 'var(--ink)',
      }
    case 'no_asistio':
      return {
        fondo: 'color-mix(in srgb, var(--status-alert) 20%, transparent)',
        texto: 'var(--ink)',
      }
    case 'cancelada':
      return { fondo: 'var(--surface-2)', texto: 'var(--muted)' }
    default:
      return { fondo: 'var(--primary-tint)', texto: 'var(--primary)' }
  }
}

export function VistaMes({
  anio,
  mes,
  citas,
  onDia,
  onCita,
}: {
  anio: number
  /** Base 0, como en Date. */
  mes: number
  citas: Cita[]
  onDia: (dia: Date) => void
  onCita: (id: string) => void
}) {
  const { celdas, porDia } = useMemo(() => {
    const primero = new Date(anio, mes, 1)
    const ultimo = new Date(anio, mes + 1, 0)

    const celdas: (Date | null)[] = []
    // La semana empieza en lunes: getDay() da 0 para domingo.
    const relleno = (primero.getDay() + 6) % 7
    for (let i = 0; i < relleno; i++) celdas.push(null)
    for (let d = 1; d <= ultimo.getDate(); d++) celdas.push(new Date(anio, mes, d))
    while (celdas.length % 7 !== 0) celdas.push(null)

    const porDia = new Map<string, Cita[]>()
    for (const c of citas) {
      // Se agrupa por el día LOCAL de la cita, no por los diez primeros
      // caracteres del ISO: ese texto está en UTC y en América mete las
      // citas de la tarde en el día siguiente.
      const k = clave(new Date(c.inicio))
      porDia.set(k, [...(porDia.get(k) ?? []), c])
    }
    for (const lista of porDia.values()) {
      lista.sort((a, b) => a.inicio.localeCompare(b.inicio))
    }

    return { celdas, porDia }
  }, [anio, mes, citas])

  const hoy = new Date()

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="grid grid-cols-7 border-b border-border bg-surface-2">
        {DIAS.map((d) => (
          <div key={d} className="py-2 text-center text-xs font-semibold text-muted">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {celdas.map((dia, i) => {
          if (!dia) {
            return (
              <div
                key={`vacio-${i}`}
                className="min-h-[92px] border-b border-r border-border bg-surface-2"
              />
            )
          }

          const k = clave(dia)
          const delDia = porDia.get(k) ?? []
          const esHoy = mismoDia(dia, hoy)

          return (
            <div
              key={k}
              className={`min-h-[92px] border-b border-r border-border p-1 ${
                esHoy ? 'bg-primary-tint' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => onDia(dia)}
                title={`Ver la semana del ${dia.getDate()}`}
                className={`mb-1 block w-full rounded-sm px-1 text-left text-xs font-semibold hover:bg-surface-2 ${
                  esHoy ? 'text-primary' : 'text-muted'
                }`}
              >
                {dia.getDate()}
              </button>

              {delDia.slice(0, MAX_VISIBLES).map((c) => {
                const col = colorDe(c.estado)
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onCita(c.id)}
                    title={`${c.paciente.nombre} · ${c.duracionMinutos} min`}
                    style={{ backgroundColor: col.fondo, color: col.texto }}
                    className={`mb-0.5 block w-full truncate rounded-sm px-1 py-0.5 text-left text-[10px] ${
                      c.estado === 'cancelada' ? 'line-through' : ''
                    }`}
                  >
                    {new Date(c.inicio).toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    {c.paciente.nombre.split(' ')[0]}
                  </button>
                )
              })}

              {delDia.length > MAX_VISIBLES && (
                <button
                  type="button"
                  onClick={() => onDia(dia)}
                  className="w-full px-1 text-left text-[10px] font-semibold text-muted hover:text-ink"
                >
                  +{delDia.length - MAX_VISIBLES} más
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
