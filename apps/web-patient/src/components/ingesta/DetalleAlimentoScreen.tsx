import { useMemo, useState } from 'react'
import { anadirItem, type Alimento, type Franja } from '../../lib/api'
import {
  MACROS,
  calcularAporte,
  formatCantidad,
  repartoCalorico,
  type Aporte,
} from './macros'

/**
 * Ficha de un alimento y confirmación de lo que se va a apuntar — R52.
 *
 * Todo lo que se ve se recalcula al mover la cantidad o la unidad, en el
 * cliente, sin pedir nada al servidor. Y la cuenta es la misma que hace
 * la API al guardar, así que la caja «aportará a tu dieta» no promete
 * nada distinto de lo que va a quedar en el diario.
 */

/** Pasos del selector. El mínimo es un cuarto de porción. */
const PASO = 0.5
const MINIMO = 0.25
const MAXIMO = 100

/** Radio y grosor del donut. Fijos: el SVG es de 110×110. */
const R = 42
const GROSOR = 10
const CIRCUNFERENCIA = 2 * Math.PI * R

interface Props {
  alimento: Alimento
  franja: Franja
  franjaEtiqueta: string
  fecha: string
  onAgregado: () => void
  onVolver: () => void
}

export default function DetalleAlimentoScreen({
  alimento,
  franja,
  franjaEtiqueta,
  fecha,
  onAgregado,
  onVolver,
}: Props) {
  // La unidad por defecto viene marcada del servidor; si por lo que sea
  // no viniera ninguna, se toma la primera antes que dejar la pantalla
  // sin unidad seleccionada y el botón de guardar muerto.
  const unidadInicial =
    alimento.unidades.find((u) => u.esDefecto)?.id ?? alimento.unidades[0]?.id ?? ''

  const [unidadId, setUnidadId] = useState(unidadInicial)
  const [cantidad, setCantidad] = useState(1)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unidad = alimento.unidades.find((u) => u.id === unidadId)
  const gramos = unidad ? unidad.gramosEquivalentes * cantidad : 0

  const aporte = useMemo<Aporte>(
    () =>
      calcularAporte(
        {
          kcal: alimento.kcalPor100g,
          cho: alimento.choPor100g,
          prot: alimento.proteinaPor100g,
          grasa: alimento.grasaPor100g,
        },
        gramos,
      ),
    [alimento, gramos],
  )

  const reparto = useMemo(() => repartoCalorico(aporte), [aporte])

  const gramosDe = (clave: string) =>
    clave === 'cho' ? aporte.cho : clave === 'prot' ? aporte.prot : aporte.grasa

  async function agregar() {
    if (!unidad || guardando) return
    setGuardando(true)
    setError(null)
    try {
      await anadirItem({
        fecha,
        tipoComida: franja,
        alimentoId: alimento.id,
        unidadId: unidad.id,
        cantidad,
      })
      onAgregado()
    } catch (e) {
      // El mensaje del servidor es el que sabe por qué falló (una medida
      // retirada del catálogo, por ejemplo). Se enseña tal cual.
      setError(e instanceof Error ? e.message : 'No se pudo apuntar. Inténtalo otra vez.')
      setGuardando(false)
    }
  }

  // Offsets acumulados para que los tres arcos se encadenen. Se recorre
  // una sola vez y se guarda el acumulado, en vez de sumar dentro del
  // map: con tres elementos da igual, pero así se lee la intención.
  let acumulado = 0
  const arcos = reparto.map((m) => {
    const inicio = acumulado
    acumulado += m.fraccion
    return { ...m, inicio }
  })

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start gap-2 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onVolver}
          aria-label="Volver a la búsqueda"
          className="-ml-2 rounded-md px-2 py-1 text-xl leading-none text-muted"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-ink">{alimento.nombre}</h2>
          <p className="mt-0.5 text-xs capitalize text-muted">
            {alimento.categoria}
            {alimento.verificado && <span className="ml-1 text-primary">· verificado</span>}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {/* ---- Donut del reparto calórico ---- */}
        <div className="flex items-center justify-center gap-5 py-4">
          <svg viewBox="0 0 110 110" className="h-[110px] w-[110px] shrink-0" role="img"
               aria-label="Reparto de calorías entre macronutrientes">
            <g transform="rotate(-90 55 55)">
              <circle cx="55" cy="55" r={R} fill="none" stroke="var(--border)" strokeWidth={GROSOR} />
              {arcos.map((a) => {
                const macro = MACROS.find((m) => m.clave === a.clave)!
                if (a.fraccion <= 0) return null
                return (
                  <circle
                    key={a.clave}
                    cx="55"
                    cy="55"
                    r={R}
                    fill="none"
                    stroke={macro.color}
                    strokeWidth={GROSOR}
                    strokeDasharray={`${a.fraccion * CIRCUNFERENCIA} ${CIRCUNFERENCIA}`}
                    strokeDashoffset={-a.inicio * CIRCUNFERENCIA}
                  />
                )
              })}
            </g>
            <text
              x="55"
              y="51"
              textAnchor="middle"
              className="fill-ink text-[15px] font-bold tabular-nums"
            >
              {Math.round(aporte.kcal)}
            </text>
            <text x="55" y="66" textAnchor="middle" className="fill-current text-[9px] text-muted">
              kcal
            </text>
          </svg>

          <ul className="space-y-1.5 text-xs">
            {arcos.map((a) => {
              const macro = MACROS.find((m) => m.clave === a.clave)!
              return (
                <li key={a.clave} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-pill"
                    style={{ backgroundColor: macro.color }}
                  />
                  <span className="text-muted">{macro.etiqueta}</span>
                  <span className="font-semibold tabular-nums text-ink">
                    {Math.round(a.fraccion * 100)}%
                  </span>
                </li>
              )
            })}
          </ul>
        </div>

        {/* ---- Los cuatro números, en grande ---- */}
        <div className="grid grid-cols-2 gap-2">
          {MACROS.map((m) => (
            <div key={m.clave} className="rounded-md border border-border bg-surface-2 p-3">
              <p className="text-xs text-muted">{m.largo}</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums" style={{ color: m.color }}>
                {gramosDe(m.clave)}
                <span className="ml-0.5 text-xs font-normal text-muted">g</span>
              </p>
            </div>
          ))}
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <p className="text-xs text-muted">Calorías</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-ink">
              {Math.round(aporte.kcal)}
              <span className="ml-0.5 text-xs font-normal text-muted">kcal</span>
            </p>
          </div>
        </div>

        {/* ---- Cuánto ---- */}
        <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted">
          ¿Cuánto comiste?
        </h3>

        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            aria-label="Menos cantidad"
            disabled={cantidad <= MINIMO}
            onClick={() => setCantidad((c) => Math.max(MINIMO, Math.round((c - PASO) * 100) / 100))}
            className="h-11 w-11 rounded-pill border border-border bg-surface text-xl font-semibold text-primary disabled:opacity-40"
          >
            −
          </button>
          <input
            type="number"
            inputMode="decimal"
            step={PASO}
            min={MINIMO}
            max={MAXIMO}
            value={cantidad}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) setCantidad(Math.min(MAXIMO, Math.max(MINIMO, n)))
            }}
            aria-label="Cantidad"
            className="w-20 rounded-md border border-border bg-surface px-2 py-2 text-center text-lg font-semibold tabular-nums text-ink outline-none focus:border-primary"
          />
          <button
            type="button"
            aria-label="Más cantidad"
            disabled={cantidad >= MAXIMO}
            onClick={() => setCantidad((c) => Math.min(MAXIMO, Math.round((c + PASO) * 100) / 100))}
            className="h-11 w-11 rounded-pill border border-border bg-surface text-xl font-semibold text-primary disabled:opacity-40"
          >
            +
          </button>
        </div>

        {/* ---- En qué medida ---- */}
        <div className="mt-4 flex flex-wrap gap-2">
          {alimento.unidades.map((u) => (
            <button
              key={u.id}
              type="button"
              aria-pressed={u.id === unidadId}
              onClick={() => setUnidadId(u.id)}
              className={`rounded-pill border px-3 py-1.5 text-xs font-medium ${
                u.id === unidadId
                  ? 'border-primary bg-primary text-white'
                  : 'border-border bg-surface text-ink'
              }`}
            >
              {u.nombre}
            </button>
          ))}
        </div>

        {/* ---- Lo que se va a apuntar ---- */}
        <div className="mt-5 rounded-md bg-primary-tint p-3">
          <p className="text-xs font-semibold text-ink">Aportará a tu dieta</p>
          <p className="mt-1 text-xs text-muted">
            {formatCantidad(cantidad)} × {unidad?.nombre ?? '—'}
            {gramos > 0 && (
              <span className="tabular-nums">
                {' '}
                = {Math.round(gramos)} {alimento.unidadPorcion === 'ml' ? 'ml' : 'g'}
              </span>
            )}
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {MACROS.map((m) => (
              <li key={m.clave} className="tabular-nums">
                <span style={{ color: m.color }} className="font-semibold">
                  {m.corto}
                </span>{' '}
                {gramosDe(m.clave)} g
              </li>
            ))}
            <li className="tabular-nums font-semibold text-ink">
              {Math.round(aporte.kcal)} kcal
            </li>
          </ul>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-xs" style={{ color: 'var(--status-critical)' }}>
            {error}
          </p>
        )}
      </div>

      <div className="border-t border-border p-4">
        <button
          type="button"
          onClick={agregar}
          disabled={guardando || !unidad}
          className="w-full rounded-md bg-primary py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {guardando ? 'Apuntando…' : `Agregar al ${franjaEtiqueta.toLowerCase()}`}
        </button>
      </div>
    </div>
  )
}
