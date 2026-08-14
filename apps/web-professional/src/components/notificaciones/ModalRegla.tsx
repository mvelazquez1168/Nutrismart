/**
 * Alta y edición de una regla — COM-03.
 *
 * El tipo solo se elige al CREAR. Cambiarlo en una edición convertiría
 * la regla en otra distinta arrastrando el historial de la anterior, y
 * las notificaciones ya emitidas dejarían de tener explicación.
 */
import { useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import {
  TIPOS_REGLA,
  actualizarRegla,
  crearRegla,
  type Regla,
  type TipoRegla,
} from '../../api/notificaciones'
import { Campo, claseControl } from '../Campo'
import { Modal } from '../Modal'

interface Formulario {
  nombre: string
  hora: string
  diasAntes: string
  intervaloDias: string
  fecha: string
  mensaje: string
}

const VACIO: Formulario = {
  nombre: '',
  hora: '09:00',
  diasAntes: '1',
  intervaloDias: '30',
  fecha: '',
  mensaje: '',
}

function desdeRegla(regla: Regla | null): Formulario {
  if (!regla) return VACIO
  const p = regla.parametros
  return {
    nombre: regla.nombre,
    hora: typeof p['hora'] === 'string' ? p['hora'] : '09:00',
    diasAntes: p['diasAntes'] !== undefined ? String(p['diasAntes']) : '1',
    intervaloDias: p['intervaloDias'] !== undefined ? String(p['intervaloDias']) : '30',
    fecha: typeof p['fecha'] === 'string' ? p['fecha'] : '',
    mensaje: typeof p['mensaje'] === 'string' ? p['mensaje'] : '',
  }
}

export function ModalRegla({
  abierto,
  regla,
  onCerrar,
  onGuardado,
}: {
  abierto: boolean
  /** null = creación. */
  regla: Regla | null
  onCerrar: () => void
  onGuardado: () => void | Promise<void>
}) {
  const [tipo, setTipo] = useState<TipoRegla>('cumpleanos')
  const [form, setForm] = useState<Formulario>(VACIO)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setForm(desdeRegla(regla))
    setTipo(regla?.tipo ?? 'cumpleanos')
    setError(null)
  }, [abierto, regla])

  function campo(clave: keyof Formulario, valor: string) {
    setForm((f) => ({ ...f, [clave]: valor }))
  }

  function parametrosDe(): Record<string, unknown> {
    if (tipo === 'cumpleanos') return { hora: form.hora }
    if (tipo === 'reminder') return { diasAntes: Number(form.diasAntes), hora: form.hora }
    if (tipo === 'checkup') return { intervaloDias: Number(form.intervaloDias) }
    return { fecha: form.fecha, mensaje: form.mensaje.trim() }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (form.nombre.trim() === '') return
    setGuardando(true)
    setError(null)
    try {
      if (regla) {
        await actualizarRegla(regla.id, { nombre: form.nombre.trim(), parametros: parametrosDe() })
      } else {
        await crearRegla({ nombre: form.nombre.trim(), tipo, parametros: parametrosDe() })
      }
      await onGuardado()
      onCerrar()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar la regla')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      abierto={abierto}
      titulo={regla ? 'Editar regla' : 'Nueva regla'}
      descripcion={
        regla
          ? 'El tipo no se cambia: sería otra regla con el historial de esta.'
          : 'Se ejecutará cuando se evalúen las reglas de la clínica.'
      }
      bloqueado={guardando}
      onCerrar={onCerrar}
      pie={
        <>
          <button
            type="button"
            onClick={onCerrar}
            disabled={guardando}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="form-regla"
            disabled={guardando || form.nombre.trim() === ''}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <form id="form-regla" onSubmit={guardar} className="space-y-5">
        <Campo id="regla-nombre" etiqueta="Nombre de la regla" requerido>
          <input
            id="regla-nombre"
            type="text"
            value={form.nombre}
            maxLength={120}
            onChange={(e) => campo('nombre', e.target.value)}
            placeholder="Felicitación de cumpleaños"
            className={claseControl(false)}
          />
        </Campo>

        <fieldset disabled={!!regla}>
          <legend className="mb-2 text-sm font-medium text-ink">Tipo</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TIPOS_REGLA.map((t) => (
              <label
                key={t.clave}
                className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 ${
                  tipo === t.clave
                    ? 'border-primary bg-primary-tint'
                    : 'border-border bg-surface hover:bg-surface-2'
                } ${regla ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <input
                  type="radio"
                  name="tipo-regla"
                  value={t.clave}
                  checked={tipo === t.clave}
                  onChange={() => setTipo(t.clave)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--primary)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{t.etiqueta}</span>
                  <span className="block text-xs text-muted">{t.descripcion}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Sub-formulario por tipo */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(tipo === 'cumpleanos' || tipo === 'reminder') && (
            <Campo id="regla-hora" etiqueta="Hora del aviso">
              <input
                id="regla-hora"
                type="time"
                value={form.hora}
                onChange={(e) => campo('hora', e.target.value)}
                className={claseControl(false)}
              />
            </Campo>
          )}

          {tipo === 'reminder' && (
            <Campo id="regla-dias" etiqueta="Días de antelación" ayuda="Entre 1 y 30">
              <input
                id="regla-dias"
                type="number"
                min={1}
                max={30}
                value={form.diasAntes}
                onChange={(e) => campo('diasAntes', e.target.value)}
                className={claseControl(false)}
              />
            </Campo>
          )}

          {tipo === 'checkup' && (
            <Campo
              id="regla-intervalo"
              etiqueta="Días sin consulta"
              ayuda="Entre 7 y 365"
            >
              <input
                id="regla-intervalo"
                type="number"
                min={7}
                max={365}
                value={form.intervaloDias}
                onChange={(e) => campo('intervaloDias', e.target.value)}
                className={claseControl(false)}
              />
            </Campo>
          )}

          {tipo === 'fecha_importante' && (
            <>
              <Campo id="regla-fecha" etiqueta="Fecha" requerido>
                <input
                  id="regla-fecha"
                  type="date"
                  value={form.fecha}
                  onChange={(e) => campo('fecha', e.target.value)}
                  className={claseControl(false)}
                />
              </Campo>
              <Campo id="regla-mensaje" etiqueta="Mensaje del aviso" requerido>
                <input
                  id="regla-mensaje"
                  type="text"
                  value={form.mensaje}
                  maxLength={200}
                  onChange={(e) => campo('mensaje', e.target.value)}
                  placeholder="La clínica cierra por festivo"
                  className={claseControl(false)}
                />
              </Campo>
            </>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
          >
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
