/**
 * Frecuencia de consumo por grupos — EVAL-04.
 *
 * Los grupos se agrupan por su lugar en la dieta, pero NO se pintan con
 * los tokens de estado clínico: «carnes procesadas» no es una alerta
 * médica del paciente, y usar el mismo rojo que un valor de laboratorio
 * fuera de rango mezclaría dos lenguajes. Van con la paleta de datos.
 */
import { claseControl } from '../Campo'

const FRECUENCIAS = [
  { clave: 'nunca', etiqueta: 'Nunca' },
  { clave: '1-2_mes', etiqueta: '1-2/mes' },
  { clave: '1_semana', etiqueta: '1/sem' },
  { clave: '2-3_semana', etiqueta: '2-3/sem' },
  { clave: '4-6_semana', etiqueta: '4-6/sem' },
  { clave: 'diario', etiqueta: 'Diario' },
  { clave: 'varias_dia', etiqueta: '+1/día' },
] as const

const GRUPOS = [
  {
    titulo: 'Base de la alimentación',
    tono: 'var(--chart-3)',
    items: [
      { clave: 'verduras', etiqueta: 'Verduras' },
      { clave: 'frutas', etiqueta: 'Frutas' },
      { clave: 'cereales', etiqueta: 'Cereales y tubérculos' },
      { clave: 'legumbres', etiqueta: 'Legumbres' },
      { clave: 'proteina_magra', etiqueta: 'Proteína animal magra' },
      { clave: 'huevos', etiqueta: 'Huevos' },
      { clave: 'lacteos_bajos', etiqueta: 'Lácteos bajos en grasa' },
      { clave: 'grasas_saludables', etiqueta: 'Grasas saludables' },
    ],
  },
  {
    titulo: 'Con moderación',
    tono: 'var(--chart-4)',
    items: [
      { clave: 'carnes_rojas', etiqueta: 'Carnes rojas' },
      { clave: 'lacteos_enteros', etiqueta: 'Lácteos enteros' },
    ],
  },
  {
    titulo: 'A limitar',
    tono: 'var(--chart-2)',
    items: [
      { clave: 'carnes_procesadas', etiqueta: 'Carnes procesadas' },
      { clave: 'bebidas_azucaradas', etiqueta: 'Bebidas azucaradas' },
      { clave: 'ultraprocesados', etiqueta: 'Ultraprocesados' },
      { clave: 'alcohol', etiqueta: 'Alcohol' },
    ],
  },
] as const

export function FormFrecuenciaConsumo({
  datos,
  hidratacion,
  onCambio,
  onHidratacion,
  bloqueada,
}: {
  datos: Record<string, string>
  hidratacion: string
  onCambio: (d: Record<string, string>) => void
  onHidratacion: (v: string) => void
  bloqueada: boolean
}) {
  const respondidos = Object.keys(datos).length
  const total = GRUPOS.reduce((t, g) => t + g.items.length, 0)

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Con qué frecuencia consume cada grupo.{' '}
        <span className="tabular-nums">
          {respondidos} de {total} respondidos
        </span>
        .
      </p>

      {GRUPOS.map((grupo) => (
        <section key={grupo.titulo} className="overflow-hidden rounded-lg border border-border bg-surface">
          <h3
            className="border-l-4 px-4 py-2 text-sm font-semibold text-ink"
            style={{ borderLeftColor: grupo.tono, backgroundColor: 'var(--surface-2)' }}
          >
            {grupo.titulo}
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="w-56" />
                  {FRECUENCIAS.map((f) => (
                    <th
                      key={f.clave}
                      className="px-1 py-2 text-center text-xs font-medium text-muted"
                    >
                      {f.etiqueta}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grupo.items.map((item) => (
                  <tr key={item.clave} className="border-t border-border">
                    <td className="px-4 py-2 text-ink">{item.etiqueta}</td>
                    {FRECUENCIAS.map((f) => (
                      <td key={f.clave} className="px-1 py-2 text-center">
                        <input
                          type="radio"
                          name={item.clave}
                          checked={datos[item.clave] === f.clave}
                          disabled={bloqueada}
                          onChange={() => onCambio({ ...datos, [item.clave]: f.clave })}
                          aria-label={`${item.etiqueta}: ${f.etiqueta}`}
                          className="h-4 w-4 accent-[color:var(--primary)]"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <div className="max-w-xs">
        <label htmlFor="hidratacion" className="mb-1 block text-sm font-medium text-ink">
          Hidratación (litros al día)
        </label>
        <input
          id="hidratacion"
          type="number"
          step="0.1"
          min={0}
          max={20}
          value={hidratacion}
          disabled={bloqueada}
          onChange={(e) => onHidratacion(e.target.value)}
          className={claseControl(false)}
        />
      </div>
    </div>
  )
}
