import { useEffect, useRef, useState } from 'react'
import {
  buscarAlimentos,
  type Alimento,
  type Franja,
  type FuenteAlimento,
} from '../../lib/api'
import { MACROS, calcularAporte } from './macros'
import DetalleAlimentoScreen from './DetalleAlimentoScreen'

/**
 * Buscador de alimentos, en panel deslizante — R52.
 *
 * Dos pantallas en un mismo panel: la lista de resultados y, al tocar
 * uno, su ficha. No son dos rutas porque volver de la ficha a la lista
 * tiene que conservar la búsqueda tecleada; con rutas habría que
 * guardarla en la URL o perderla, y lo segundo es lo que hacía la
 * versión anterior.
 */

/** Lo que se espera a que el paciente deje de teclear. */
const ESPERA_MS = 300

interface Props {
  franja: Franja
  franjaEtiqueta: string
  fecha: string
  onAgregado: () => void
  onCerrar: () => void
}

const PESTANAS: { clave: FuenteAlimento; etiqueta: string }[] = [
  { clave: 'biblioteca', etiqueta: 'Biblioteca' },
  { clave: 'mis-alimentos', etiqueta: 'Mis alimentos' },
]

export default function BuscarAlimentoSheet({
  franja,
  franjaEtiqueta,
  fecha,
  onAgregado,
  onCerrar,
}: Props) {
  const [q, setQ] = useState('')
  const [fuente, setFuente] = useState<FuenteAlimento>('biblioteca')
  const [resultados, setResultados] = useState<Alimento[]>([])
  const [cargando, setCargando] = useState(true)
  const [elegido, setElegido] = useState<Alimento | null>(null)
  // El panel entra desde abajo. Arranca fuera de pantalla y se sube en
  // el primer frame tras montar: sin ese salto el navegador no tiene dos
  // estados que interpolar y aparecería de golpe.
  const [visible, setVisible] = useState(false)

  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(t)
  }, [])

  useEffect(() => {
    function alTeclado(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Escape vuelve de la ficha a la lista antes de cerrar el panel:
      // cerrarlo entero desde la ficha haría perder la búsqueda.
      if (elegido) setElegido(null)
      else onCerrar()
    }
    window.addEventListener('keydown', alTeclado)
    return () => window.removeEventListener('keydown', alTeclado)
  }, [elegido, onCerrar])

  /*
   * La búsqueda, con espera.
   *
   * El `cancelado` del cleanup no es por cortesía: dos tecleos seguidos
   * lanzan dos peticiones y la primera puede contestar después. Sin
   * descartar la respuesta vieja, la lista termina enseñando los
   * resultados de un término que ya no está en el campo.
   */
  useEffect(() => {
    let cancelado = false
    setCargando(true)
    const t = setTimeout(() => {
      buscarAlimentos(q, { fuente, limite: 40 })
        .then((r) => {
          if (!cancelado) setResultados(r)
        })
        .catch(() => {
          if (!cancelado) setResultados([])
        })
        .finally(() => {
          if (!cancelado) setCargando(false)
        })
    }, ESPERA_MS)
    return () => {
      cancelado = true
      clearTimeout(t)
    }
  }, [q, fuente])

  useEffect(() => {
    if (!elegido) campo.current?.focus()
  }, [elegido])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Añadir alimento a ${franjaEtiqueta.toLowerCase()}`}
      className="fixed inset-0 z-50 flex items-end"
    >
      {/* El fondo cierra el panel. `aria-hidden` porque el botón de la
          cabecera ya ofrece la misma acción a un lector de pantalla. */}
      <div
        aria-hidden="true"
        onClick={onCerrar}
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div
        className={`relative flex h-[88vh] w-full flex-col rounded-t-lg bg-surface shadow-lg transition-transform duration-200 ${
          visible ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {elegido ? (
          <DetalleAlimentoScreen
            alimento={elegido}
            franja={franja}
            franjaEtiqueta={franjaEtiqueta}
            fecha={fecha}
            onAgregado={onAgregado}
            onVolver={() => setElegido(null)}
          />
        ) : (
          <>
            <div className="flex items-center gap-2 px-4 pb-3 pt-4">
              <button
                type="button"
                onClick={onCerrar}
                aria-label="Cerrar"
                className="-ml-1 rounded-md px-2 py-1 text-lg leading-none text-muted"
              >
                ✕
              </button>
              <input
                ref={campo}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Busca un alimento…"
                aria-label="Buscar alimento"
                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-primary"
              />
              {/* Sin función todavía: la columna `codigo_barras` existe
                  desde la 056 pero no hay fichas con código. Se deja
                  visible y deshabilitado para no mover el layout cuando
                  se active. */}
              <button
                type="button"
                disabled
                aria-label="Escanear código de barras (todavía no disponible)"
                title="Todavía no disponible"
                className="shrink-0 rounded-md border border-border px-2.5 py-2 text-muted opacity-50"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth={2}>
                  <path d="M4 7V5h3M20 7V5h-3M4 17v2h3M20 17v2h-3M7 9v6M11 9v6M15 9v6" />
                </svg>
              </button>
            </div>

            <div className="flex gap-1 px-4 pb-3">
              {PESTANAS.map((p) => (
                <button
                  key={p.clave}
                  type="button"
                  aria-pressed={fuente === p.clave}
                  onClick={() => setFuente(p.clave)}
                  className={`rounded-pill px-3 py-1.5 text-xs font-medium ${
                    fuente === p.clave
                      ? 'bg-primary text-white'
                      : 'border border-border bg-surface text-ink'
                  }`}
                >
                  {p.etiqueta}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              {cargando && resultados.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">Buscando…</p>
              ) : resultados.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  {fuente === 'mis-alimentos'
                    ? 'Tu nutricionista todavía no ha dado de alta alimentos propios de la clínica.'
                    : q.trim() === ''
                      ? 'Escribe para buscar en el catálogo.'
                      : `No encontramos nada para «${q.trim()}».`}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {resultados.map((a) => (
                    <li key={a.id}>
                      <FilaResultado alimento={a} onElegir={() => setElegido(a)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Un resultado de la búsqueda.
 *
 * Las cifras que se enseñan son las de la PORCIÓN por defecto, no las de
 * 100 g: «Arroz, 195 kcal» dice más que «Arroz, 130 kcal / 100 g» a
 * alguien que está decidiendo si lo apunta.
 */
function FilaResultado({ alimento, onElegir }: { alimento: Alimento; onElegir: () => void }) {
  const unidad = alimento.unidades.find((u) => u.esDefecto) ?? alimento.unidades[0]
  const aporte = calcularAporte(
    {
      kcal: alimento.kcalPor100g,
      cho: alimento.choPor100g,
      prot: alimento.proteinaPor100g,
      grasa: alimento.grasaPor100g,
    },
    unidad?.gramosEquivalentes ?? 100,
  )
  const gramosDe = (clave: string) =>
    clave === 'cho' ? aporte.cho : clave === 'prot' ? aporte.prot : aporte.grasa

  return (
    <button
      type="button"
      onClick={onElegir}
      className="flex w-full items-center gap-3 py-3 text-left"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{alimento.nombre}</p>
        <p className="mt-0.5 truncate text-xs capitalize text-muted">
          {alimento.categoria}
          {unidad && <span className="normal-case"> · {unidad.nombre}</span>}
        </p>
        <p className="mt-1 flex gap-2.5 text-[0.65rem] tabular-nums">
          {MACROS.map((m) => (
            <span key={m.clave} style={{ color: m.color }} className="font-semibold">
              {m.corto} {gramosDe(m.clave)}
            </span>
          ))}
        </p>
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-primary">
        {Math.round(aporte.kcal)}
        <span className="ml-0.5 text-xs font-normal text-muted">kcal</span>
      </span>
    </button>
  )
}
