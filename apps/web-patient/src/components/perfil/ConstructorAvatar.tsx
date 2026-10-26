import { useState } from 'react'
import type { AvatarPaciente } from '../../lib/api'
import { CaraSVG } from './CaraSVG'
import {
  COLORES_CABELLO,
  ESTILOS_CABELLO,
  EXPRESIONES,
  GALERIA,
  PIELES,
  configSegura,
  type ConfigAvatar,
  type EstiloCabello,
  type Expresion,
} from './avatar'

/**
 * Galería de personajes y constructor — R53.
 *
 * Dos pasos en la misma pantalla y no dos: elegir un personaje es
 * elegir un punto de partida, y lo que se guarda es siempre el
 * resultado de personalizarlo. Separarlos obligaría a un «siguiente»
 * que no decide nada.
 *
 * Tocar un personaje PISA lo personalizado, a propósito: es la forma de
 * volver a empezar cuando uno se ha liado con los peinados.
 */
export function ConstructorAvatar({
  inicial,
  onGuardar,
}: {
  inicial: ConfigAvatar
  onGuardar: (a: AvatarPaciente) => Promise<void>
}) {
  const [cfg, setCfg] = useState<ConfigAvatar>(() => configSegura(inicial))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guardado, setGuardado] = useState(false)

  const cambiar = (parcial: Partial<ConfigAvatar>) => {
    setCfg((c) => ({ ...c, ...parcial }))
    setGuardado(false)
  }

  async function guardar() {
    if (guardando) return
    setGuardando(true)
    setError(null)
    try {
      await onGuardar(cfg)
      setGuardado(true)
    } catch {
      setError('No se pudo guardar tu avatar. Vuelve a intentarlo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* ---- Previo ---- */}
      <div className="flex justify-center">
        <div
          className="h-[104px] w-[104px] overflow-hidden rounded-pill border-[3px] border-primary"
          style={{ boxShadow: '0 0 0 6px var(--primary-tint)' }}
        >
          <CaraSVG config={cfg} className="block h-full w-full" />
        </div>
      </div>

      {/* ---- Galería ---- */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Elige una cara
        </h3>
        <ul className="grid grid-cols-4 gap-2.5">
          {GALERIA.map((g) => {
            const activo = g.personaje === cfg.personaje
            return (
              <li key={g.personaje}>
                <button
                  type="button"
                  onClick={() => cambiar(g)}
                  aria-pressed={activo}
                  aria-label={`Personaje ${g.personaje + 1}`}
                  className={`block w-full rounded-pill ${
                    activo ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface' : ''
                  }`}
                >
                  <CaraSVG config={g} className="block h-full w-full rounded-pill" />
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {/* ---- Piel ---- */}
      <Grupo titulo="Tono de piel">
        <div className="flex flex-wrap gap-2.5">
          {PIELES.map((p) => (
            <button
              key={p.hex}
              type="button"
              onClick={() => cambiar({ piel: p.hex })}
              aria-pressed={cfg.piel === p.hex}
              aria-label={p.etiqueta}
              title={p.etiqueta}
              className={`h-9 w-9 rounded-pill border border-border ${
                cfg.piel === p.hex ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : ''
              }`}
              style={{ backgroundColor: p.hex }}
            />
          ))}
        </div>
      </Grupo>

      {/* ---- Peinado ---- */}
      <Grupo titulo="Peinado">
        <div className="flex flex-wrap gap-2">
          {ESTILOS_CABELLO.map((e) => (
            <button
              key={e.clave}
              type="button"
              onClick={() => cambiar({ cabelloEstilo: e.clave as EstiloCabello })}
              aria-pressed={cfg.cabelloEstilo === e.clave}
              className={`rounded-pill border px-3 py-1.5 text-xs font-medium ${
                cfg.cabelloEstilo === e.clave
                  ? 'border-primary bg-primary text-white'
                  : 'border-border bg-surface text-ink'
              }`}
            >
              {e.etiqueta}
            </button>
          ))}
        </div>
      </Grupo>

      {/* ---- Color de pelo ---- */}
      <Grupo titulo="Color de pelo">
        <div className="flex flex-wrap gap-2.5">
          {COLORES_CABELLO.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => cambiar({ cabelloColor: c })}
              aria-pressed={cfg.cabelloColor === c}
              aria-label={`Color ${c}`}
              className={`h-8 w-8 rounded-pill border border-border ${
                cfg.cabelloColor === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : ''
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </Grupo>

      {/* ---- Expresión y gafas ---- */}
      <Grupo titulo="Expresión">
        <div className="flex flex-wrap gap-2">
          {EXPRESIONES.map((e) => (
            <button
              key={e.clave}
              type="button"
              onClick={() => cambiar({ expresion: e.clave as Expresion })}
              aria-pressed={cfg.expresion === e.clave}
              className={`rounded-pill border px-3 py-1.5 text-xs font-medium ${
                cfg.expresion === e.clave
                  ? 'border-primary bg-primary text-white'
                  : 'border-border bg-surface text-ink'
              }`}
            >
              {e.etiqueta}
            </button>
          ))}
          <button
            type="button"
            onClick={() => cambiar({ lentes: !cfg.lentes })}
            aria-pressed={cfg.lentes}
            className={`rounded-pill border px-3 py-1.5 text-xs font-medium ${
              cfg.lentes
                ? 'border-primary bg-primary text-white'
                : 'border-border bg-surface text-ink'
            }`}
          >
            Gafas
          </button>
        </div>
      </Grupo>

      {error && (
        <p role="alert" className="text-xs" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void guardar()}
        disabled={guardando}
        className="w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {guardando ? 'Guardando…' : guardado ? 'Guardado ✓' : 'Guardar avatar'}
      </button>
    </div>
  )
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{titulo}</h3>
      {children}
    </div>
  )
}
