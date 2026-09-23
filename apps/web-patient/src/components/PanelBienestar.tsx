/**
 * El parte diario — RPM-01.
 *
 * Toda la pantalla está construida sobre una idea: esto se contesta en
 * tres segundos o no se contesta. Cinco caras, una fila de síntomas que
 * se tocan, y ya. La nota es opcional y va plegada.
 *
 * Se puede corregir el día en curso las veces que haga falta: hay un
 * parte por día, no un histórico de cómo cambió de opinión.
 */
import { useEffect, useState } from 'react'
import {
  ApiError,
  ESTADOS_BIENESTAR,
  SINTOMAS_ETIQUETA,
  getBienestar,
  guardarBienestar,
  type Bienestar,
} from '../lib/api'

/** Color de estado, de los tokens FIJOS de estado clínico. */
function tokenDe(estado: number): string {
  if (estado <= 1) return '--status-critical'
  if (estado === 2) return '--status-serious'
  if (estado === 3) return '--status-alert'
  return '--status-normal'
}

/**
 * Los últimos días como una tira de puntos.
 *
 * Un hueco es un día sin parte, y se dibuja como hueco: rellenarlo con
 * el valor del día anterior inventaría un dato que nadie dio.
 */
function TiraDias({ datos }: { datos: Bienestar }) {
  const dias: { fecha: string; estado: number | null }[] = []
  const hoy = new Date(`${datos.hoy}T12:00:00`)
  for (let i = 13; i >= 0; i--) {
    const d = new Date(hoy)
    d.setDate(d.getDate() - i)
    const clave = d.toISOString().slice(0, 10)
    const p = datos.partes.find((x) => x.fecha === clave)
    dias.push({ fecha: clave, estado: p?.estado ?? null })
  }

  return (
    <div className="flex items-end gap-1" role="img" aria-label="Últimos 14 días">
      {dias.map((d) => (
        <span
          key={d.fecha}
          title={d.fecha}
          className="h-6 flex-1 rounded-sm"
          style={{
            backgroundColor:
              d.estado === null ? 'var(--surface-2)' : `var(${tokenDe(d.estado)})`,
            opacity: d.estado === null ? 1 : 0.35 + d.estado * 0.13,
          }}
        />
      ))}
    </div>
  )
}

export function PanelBienestar() {
  const [datos, setDatos] = useState<Bienestar | null>(null)
  const [estado, setEstado] = useState<number | null>(null)
  const [sintomas, setSintomas] = useState<string[]>([])
  const [nota, setNota] = useState('')
  const [verNota, setVerNota] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function cargar() {
    const d = await getBienestar(30)
    setDatos(d)
    // Si el día ya está contestado, la pantalla se abre con lo que puso:
    // así se corrige en vez de empezar de cero.
    const hoy = d.partes.find((p) => p.fecha === d.hoy)
    if (hoy) {
      setEstado(hoy.estado)
      setSintomas(hoy.sintomas)
      setNota(hoy.nota ?? '')
      if (hoy.nota) setVerNota(true)
    }
  }

  useEffect(() => {
    cargar().catch((e) =>
      setError(e instanceof ApiError ? e.message : 'No hemos podido cargar tu bienestar'),
    )
  }, [])

  async function guardar() {
    if (estado === null || ocupado) return
    setOcupado(true)
    setError(null)
    setAviso(null)
    try {
      await guardarBienestar({
        estado,
        sintomas,
        ...(nota.trim() !== '' ? { nota: nota.trim() } : {}),
      })
      await cargar()
      setAviso('Guardado')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar')
    } finally {
      setOcupado(false)
    }
  }

  if (!datos) return <div className="h-64 animate-pulse rounded-lg bg-surface-2" />

  const yaContestado = datos.partes.some((p) => p.fecha === datos.hoy)

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-ink">
          {yaContestado ? '¿Cambió algo?' : '¿Cómo te encuentras hoy?'}
        </h2>

        <div className="mt-3 flex gap-1.5">
          {ESTADOS_BIENESTAR.map((e) => {
            const activo = estado === e.valor
            return (
              <button
                key={e.valor}
                type="button"
                onClick={() => setEstado(e.valor)}
                aria-pressed={activo}
                aria-label={e.etiqueta}
                className={`flex flex-1 flex-col items-center gap-1 rounded-md border py-2.5 ${
                  activo ? 'border-primary bg-primary-tint' : 'border-border'
                }`}
              >
                <span className="text-2xl leading-none" aria-hidden="true">
                  {e.cara}
                </span>
                {/* La etiqueta va siempre, no solo en el seleccionado:
                    una fila de caras sin texto se interpreta distinto
                    según quién mire. */}
                <span
                  className={`text-[0.6rem] leading-tight ${activo ? 'text-primary' : 'text-muted'}`}
                >
                  {e.etiqueta}
                </span>
              </button>
            )
          })}
        </div>

        {estado !== null && (
          <>
            <p className="mb-2 mt-4 text-xs text-muted">¿Algo de esto? (opcional)</p>
            <div className="flex flex-wrap gap-1.5">
              {datos.sintomasPosibles.map((s) => {
                const puesto = sintomas.includes(s)
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() =>
                      setSintomas((prev) =>
                        puesto ? prev.filter((x) => x !== s) : [...prev, s],
                      )
                    }
                    aria-pressed={puesto}
                    className={`rounded-pill border px-3 py-1.5 text-xs ${
                      puesto
                        ? 'border-primary bg-primary-tint font-medium text-primary'
                        : 'border-border text-muted'
                    }`}
                  >
                    {SINTOMAS_ETIQUETA[s] ?? s}
                  </button>
                )
              })}
            </div>

            {verNota ? (
              <textarea
                rows={2}
                value={nota}
                maxLength={500}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Si quieres contarle algo a tu nutricionista"
                aria-label="Nota"
                className="mt-3 w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-primary"
              />
            ) : (
              <button
                type="button"
                onClick={() => setVerNota(true)}
                className="mt-3 text-xs text-primary underline"
              >
                + Añadir una nota
              </button>
            )}

            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void guardar()}
                disabled={ocupado}
                className="flex-1 rounded-md bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
              >
                {yaContestado ? 'Actualizar' : 'Guardar'}
              </button>
              {aviso && <span className="text-sm text-muted">{aviso}</span>}
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--status-critical)' }}>
            {error}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-ink">Tus últimos 14 días</h2>
          {datos.racha > 1 && (
            <span className="text-xs font-medium text-primary">
              {datos.racha} días seguidos
            </span>
          )}
        </div>
        <TiraDias datos={datos} />
        <p className="mt-2 text-xs text-muted">
          Los huecos son días sin parte. No pasa nada por saltarse alguno.
        </p>
      </section>

      {datos.partes.length > 0 && (
        <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-ink">Lo que has apuntado</h2>
          <ul className="divide-y divide-border">
            {datos.partes.slice(0, 10).map((p) => {
              const e = ESTADOS_BIENESTAR.find((x) => x.valor === p.estado)
              return (
                <li key={p.fecha} className="flex items-start gap-3 py-2">
                  <span className="text-xl leading-none" aria-hidden="true">
                    {e?.cara}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">
                      {new Date(`${p.fecha}T12:00:00`).toLocaleDateString('es-CR', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                      <span className="ml-2 text-xs text-muted">{e?.etiqueta}</span>
                    </p>
                    {p.sintomas.length > 0 && (
                      <p className="text-xs text-muted">
                        {p.sintomas.map((s) => SINTOMAS_ETIQUETA[s] ?? s).join(' · ')}
                      </p>
                    )}
                    {p.nota && <p className="mt-0.5 text-xs italic text-muted">{p.nota}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
