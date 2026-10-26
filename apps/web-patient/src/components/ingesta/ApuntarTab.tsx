import { useCallback, useEffect, useState } from 'react'
import {
  FRANJAS,
  getDiario,
  quitarItem,
  type Comida,
  type Diario,
  type Franja,
  type ItemComida,
} from '../../lib/api'
import { MACROS, formatCantidad } from './macros'
import BuscarAlimentoSheet from './BuscarAlimentoSheet'

/**
 * Ingesta del día, comida por comida — R52.
 *
 * Sustituye al desglose del modo detallado anterior, que pedía gramos y
 * escondía los alimentos detrás de un acordeón. Aquí las seis franjas
 * están siempre a la vista y la cantidad se dice en porciones.
 *
 * Son SEIS y no las cuatro del encargo: `tipo_comida` es un enum de la
 * base desde la migración 011 con media mañana y extra incluidas, y el
 * plan alimentario las usa. Dejar fuera dos franjas habría hecho
 * invisible lo que el paciente ya tiene apuntado en ellas.
 */

const ICONOS: Record<Franja, string> = {
  desayuno: '🌅',
  media_manana: '☕',
  almuerzo: '☀️',
  merienda: '🍎',
  cena: '🌙',
  extra: '🍪',
}

const DIAS = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic']

/**
 * Aritmética de fechas sobre la cadena, en UTC.
 *
 * Con `new Date('2026-10-25')` y métodos locales, un huso al oeste de
 * Greenwich devuelve el día anterior. Se opera en UTC y se vuelve a
 * cadena, que es lo que entiende la API.
 */
function sumarDias(iso: string, n: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

function etiquetaFecha(iso: string, hoy: string | null): string {
  if (hoy && iso === hoy) return 'Hoy'
  if (hoy && iso === sumarDias(hoy, -1)) return 'Ayer'
  const [a, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1))
  return `${DIAS[dt.getUTCDay()]} ${d} ${MESES[(m ?? 1) - 1]}`
}

export default function ApuntarTab() {
  // `null` = el día de hoy según el servidor. No se calcula aquí: la
  // API resuelve «hoy» en la zona horaria de la clínica y es la misma
  // fecha con la que va a guardar.
  const [fecha, setFecha] = useState<string | null>(null)
  const [hoy, setHoy] = useState<string | null>(null)
  const [diario, setDiario] = useState<Diario | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(false)
  const [franjaAbierta, setFranjaAbierta] = useState<Franja | null>(null)

  const cargar = useCallback(() => {
    setCargando(true)
    setError(false)
    getDiario(fecha ?? undefined)
      .then((d) => {
        setDiario(d)
        setHoy((h) => h ?? d.fecha)
      })
      .catch(() => setError(true))
      .finally(() => setCargando(false))
  }, [fecha])

  useEffect(cargar, [cargar])

  const dia = diario?.fecha ?? null
  // El futuro no se apunta: no hay nada que recordar todavía.
  const haySiguiente = dia !== null && hoy !== null && dia < hoy

  async function borrar(comida: Comida, item: ItemComida) {
    await quitarItem(comida.id, item.id)
    cargar()
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4 text-center shadow-sm">
        <p className="text-sm text-muted">No pudimos cargar tu diario.</p>
        <button
          type="button"
          onClick={cargar}
          className="mt-3 rounded-md border border-border px-3 py-2 text-sm font-medium text-primary"
        >
          Volver a intentar
        </button>
      </div>
    )
  }

  const objetivo = diario?.objetivo ?? null
  const totales = diario?.totales ?? null

  const consumido = (clave: string) =>
    clave === 'cho' ? (totales?.choG ?? 0)
    : clave === 'prot' ? (totales?.proteinaG ?? 0)
    : (totales?.grasaG ?? 0)

  const meta = (clave: string) =>
    clave === 'cho' ? objetivo?.choG
    : clave === 'prot' ? objetivo?.proteinaG
    : objetivo?.grasaG

  return (
    <div>
      {/* ---- Resumen del día ---- */}
      <section className="rounded-lg bg-primary p-4 text-white shadow-sm">
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label="Día anterior"
            onClick={() => dia && setFecha(sumarDias(dia, -1))}
            disabled={!dia}
            className="rounded-md px-3 py-1 text-lg leading-none disabled:opacity-40"
          >
            ‹
          </button>
          <p className="text-sm font-semibold">{dia ? etiquetaFecha(dia, hoy) : '…'}</p>
          <button
            type="button"
            aria-label="Día siguiente"
            onClick={() => dia && setFecha(sumarDias(dia, 1))}
            disabled={!haySiguiente}
            className="rounded-md px-3 py-1 text-lg leading-none disabled:opacity-40"
          >
            ›
          </button>
        </div>

        <ul className="mt-3 space-y-2">
          {MACROS.map((m) => {
            const v = consumido(m.clave)
            const t = meta(m.clave)
            const pct = t && t > 0 ? Math.min(100, (v / t) * 100) : 0
            return (
              <li key={m.clave} className="flex items-center gap-2">
                <span className="w-[60px] shrink-0 text-xs opacity-90">{m.etiqueta}</span>
                <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-pill bg-white/25">
                  <div
                    className="h-full rounded-pill transition-[width] duration-300"
                    style={{ width: `${pct}%`, backgroundColor: m.color }}
                  />
                </div>
                <span className="shrink-0 text-xs tabular-nums opacity-90">
                  {Math.round(v)}
                  {t && t > 0 ? `/${Math.round(t)}` : ''} g
                </span>
              </li>
            )
          })}
        </ul>

        <div className="mt-3 flex items-baseline gap-1.5">
          <span className="text-3xl font-bold tabular-nums">
            {Math.round(totales?.kcal ?? 0)}
          </span>
          {objetivo?.kcal ? (
            <span className="text-sm opacity-90 tabular-nums">/ {objetivo.kcal} kcal</span>
          ) : (
            <span className="text-sm opacity-90">kcal</span>
          )}
        </div>

        {/* Dos avisos distintos y por eso separados: sin prescripción no
            hay con qué comparar; con comidas sin estimar el total es
            real pero incompleto. */}
        {!objetivo && (
          <p className="mt-1 text-xs opacity-90">
            Tu nutricionista todavía no te ha puesto metas de macros.
          </p>
        )}
        {totales && totales.sinEstimar > 0 && (
          <p className="mt-1 text-xs opacity-90">
            {totales.sinEstimar === 1
              ? '1 comida sin calorías: no entra en el total.'
              : `${totales.sinEstimar} comidas sin calorías: no entran en el total.`}
          </p>
        )}
      </section>

      {/* ---- Las comidas ---- */}
      <ul className="mt-4 space-y-3">
        {FRANJAS.map((f) => {
          const comida = diario?.registros.find((r) => r.tipoComida === f.clave)
          const items = comida?.items ?? []
          return (
            <li key={f.clave} className="rounded-lg border border-border bg-surface shadow-sm">
              <div className="flex items-center gap-2 px-4 pt-3">
                <span aria-hidden="true">{ICONOS[f.clave]}</span>
                <h3 className="flex-1 text-sm font-semibold text-ink">{f.etiqueta}</h3>
                {comida?.kcal != null && (
                  <span className="text-sm font-semibold tabular-nums text-primary">
                    {Math.round(comida.kcal)} kcal
                  </span>
                )}
              </div>

              {/* Comida del modo simple: una frase, sin alimentos que
                  desglosar. Se enseña igual — es lo que el paciente
                  apuntó y esconderlo sería perderlo. */}
              {items.length === 0 && comida?.descripcion && (
                <p className="px-4 pt-2 text-sm text-ink">{comida.descripcion}</p>
              )}

              {items.length > 0 && (
                <ul className="mt-2 divide-y divide-border">
                  {items.map((it) => (
                    <li key={it.id} className="flex items-center gap-2 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink">{it.nombre}</p>
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {it.cantidad != null && it.unidadNombre
                            ? `${formatCantidad(it.cantidad)} × ${it.unidadNombre}`
                            : `${Math.round(it.cantidadG)} g`}
                        </p>
                        <p className="mt-1 flex gap-2.5 text-[0.65rem] tabular-nums">
                          {MACROS.map((m) => {
                            const g =
                              m.clave === 'cho' ? it.choG
                              : m.clave === 'prot' ? it.proteinaG
                              : it.grasaG
                            if (g == null) return null
                            return (
                              <span
                                key={m.clave}
                                style={{ color: m.color }}
                                className="font-semibold"
                              >
                                {m.corto} {g}
                              </span>
                            )
                          })}
                        </p>
                      </div>
                      {it.kcal != null && (
                        <span className="shrink-0 text-sm tabular-nums text-ink">
                          {Math.round(it.kcal)}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => comida && borrar(comida, it)}
                        aria-label={`Quitar ${it.nombre}`}
                        className="shrink-0 rounded-md px-1.5 py-1 text-sm text-muted"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="px-4 pb-3 pt-2">
                <button
                  type="button"
                  onClick={() => setFranjaAbierta(f.clave)}
                  className="w-full rounded-md border border-dashed border-border py-2.5 text-sm font-medium text-primary"
                >
                  + Agregar alimento
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {cargando && !diario && <p className="mt-4 text-center text-sm text-muted">Cargando…</p>}

      {franjaAbierta && dia && (
        <BuscarAlimentoSheet
          franja={franjaAbierta}
          franjaEtiqueta={
            FRANJAS.find((f) => f.clave === franjaAbierta)?.etiqueta ?? 'comida'
          }
          fecha={dia}
          onAgregado={() => {
            setFranjaAbierta(null)
            cargar()
          }}
          onCerrar={() => setFranjaAbierta(null)}
        />
      )}
    </div>
  )
}
