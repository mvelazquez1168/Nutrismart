/**
 * Actividad por profesional en el dashboard (CLI-08).
 *
 * Un profesional sin citas en el período aparece con ceros, no
 * desaparece: su ausencia de actividad es justamente lo que el
 * administrador viene a mirar.
 */

export interface FilaProfesional {
  profesionalId: string
  nombre: string
  citasTotal: number
  citasCompletadas: number
  pacientesActivos: number
}

/**
 * Sin citas no hay porcentaje que calcular.
 *
 * Un 0/0 mostrado como "0.0 %" leería como "no completó ninguna de las
 * que tenía", que es un juicio distinto de "no tenía ninguna". El
 * guion dice lo segundo, que es la verdad.
 */
function porcentaje(completadas: number, total: number): string {
  if (total === 0) return '—'
  return `${((completadas / total) * 100).toFixed(1)} %`
}

export function TablaProfesionales({ profesionales }: { profesionales: FilaProfesional[] }) {
  if (profesionales.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
        No hay profesionales registrados.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <Th>Profesional</Th>
            <Th alineado="right">Citas</Th>
            <Th alineado="right">% Completadas</Th>
            <Th alineado="right">Pacientes activos</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {profesionales.map((p) => (
            <tr key={p.profesionalId}>
              <td className="px-4 py-3 text-ink">{p.nombre}</td>
              <Td>{p.citasTotal}</Td>
              <Td>{porcentaje(p.citasCompletadas, p.citasTotal)}</Td>
              <Td>{p.pacientesActivos}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Th({
  children,
  alineado = 'left',
}: {
  children: React.ReactNode
  alineado?: 'left' | 'right'
}) {
  return (
    <th
      scope="col"
      className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted ${
        alineado === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 text-right tabular-nums text-ink">{children}</td>
}
