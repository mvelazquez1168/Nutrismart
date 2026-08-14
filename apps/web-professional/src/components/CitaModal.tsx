/**
 * Modal de nueva cita y edición de una programada.
 *
 * Solo se editan las citas `programada`: una completada o cancelada es
 * el registro de lo que ocurrió (o no), y la API responde 409. El
 * detalle ni siquiera ofrece el botón, pero la regla vive en el
 * servidor, no en esconder un botón.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { Modal } from './Modal'
import { Campo, claseControl } from './Campo'
import { ApiError } from '../api/client'
import { crearCita, actualizarCita } from '../api/agenda'
import { getPacientes } from '../api/pacientes'
import { CITA_TIPOS, type Cita, type CitaTipo, type Paciente } from '../api/tipos'
import { ahoraInputLocal, desdeInputLocal, paraInputLocal } from '../lib/fechas'

const ETIQUETA_TIPO: Record<CitaTipo, string> = {
  primera_vez: 'Primera vez',
  seguimiento: 'Seguimiento',
  control: 'Control',
  urgencia: 'Urgencia',
}

/** Propuesta del formulario, no default del esquema (ver migración 006). */
const DURACION_PROPUESTA = 60

interface Props {
  abierto: boolean
  /** null = nueva cita; con cita = edición de una programada. */
  cita: Cita | null
  onCerrar: () => void
  onGuardado: () => void
}

export function CitaModal({ abierto, cita, onCerrar, onGuardado }: Props) {
  const esEdicion = cita !== null

  const [pacienteId, setPacienteId] = useState('')
  const [inicio, setInicio] = useState(ahoraInputLocal())
  const [duracion, setDuracion] = useState(String(DURACION_PROPUESTA))
  const [tipo, setTipo] = useState<CitaTipo>('seguimiento')
  const [notas, setNotas] = useState('')

  const [pacientes, setPacientes] = useState<Paciente[]>([])
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!abierto) return

    if (cita) {
      setPacienteId(cita.paciente.id)
      setInicio(paraInputLocal(cita.inicio))
      setDuracion(String(cita.duracionMinutos))
      setTipo(cita.tipo)
      setNotas(cita.notas ?? '')
    } else {
      setPacienteId('')
      setInicio(ahoraInputLocal())
      setDuracion(String(DURACION_PROPUESTA))
      setTipo('seguimiento')
      setNotas('')
    }
    setErrores({})
    setErrorGeneral(null)
  }, [abierto, cita])

  // Solo los pacientes visibles para quien agenda: la API rechaza con
  // 404 cualquier otro, así que ofrecerlos sería ofrecer un error.
  useEffect(() => {
    if (!abierto || esEdicion) return
    const ctrl = new AbortController()
    getPacientes({}, ctrl.signal)
      .then(setPacientes)
      .catch(() => setErrorGeneral('No se pudo cargar la lista de pacientes'))
    return () => ctrl.abort()
  }, [abierto, esEdicion])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (guardando) return

    setGuardando(true)
    setErrores({})
    setErrorGeneral(null)

    try {
      const datos = {
        inicio: desdeInputLocal(inicio),
        duracionMinutos: Number(duracion),
        tipo,
        notas: notas.trim() === '' ? null : notas.trim(),
      }

      if (esEdicion) await actualizarCita(cita.id, datos)
      else await crearCita({ ...datos, pacienteId })

      onGuardado()
    } catch (error) {
      if (error instanceof ApiError && error.esValidacion) {
        const mapa: Record<string, string> = {}
        for (const e of error.errores ?? []) mapa[e.campo] = e.mensaje
        setErrores(mapa)
      } else if (error instanceof ApiError && error.codigo === 'cita_solapada') {
        // El choque se señala en el campo de la hora, que es lo que hay
        // que mover para resolverlo.
        setErrores({ inicio: error.message })
      } else {
        setErrorGeneral(error instanceof Error ? error.message : 'No se pudo guardar')
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      bloqueado={guardando}
      titulo={esEdicion ? 'Editar cita' : 'Nueva cita'}
      descripcion={
        esEdicion
          ? 'Solo se pueden editar las citas programadas.'
          : 'La cita se agenda a tu nombre.'
      }
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
            form="form-cita"
            disabled={guardando}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Agendar'}
          </button>
        </>
      }
    >
      <form id="form-cita" onSubmit={enviar} className="space-y-4" noValidate>
        {errorGeneral && (
          <p
            role="alert"
            className="rounded-md border border-[color:var(--status-critical)] bg-surface-2 p-3 text-sm text-ink"
          >
            {errorGeneral}
          </p>
        )}

        <fieldset disabled={guardando} className="space-y-4">
          {esEdicion ? (
            <Campo id="paciente-fijo" etiqueta="Paciente">
              <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-ink">
                {cita.paciente.nombre}
              </p>
            </Campo>
          ) : (
            <Campo id="pacienteId" etiqueta="Paciente" requerido error={errores['pacienteId']}>
              <select
                id="pacienteId"
                value={pacienteId}
                onChange={(e) => setPacienteId(e.target.value)}
                className={claseControl(Boolean(errores['pacienteId']))}
              >
                <option value="">Selecciona…</option>
                {pacientes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo
              id="inicio"
              etiqueta="Fecha y hora"
              requerido
              error={errores['inicio']}
              ayuda="En tu hora local"
            >
              <input
                id="inicio"
                type="datetime-local"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
                className={claseControl(Boolean(errores['inicio']))}
              />
            </Campo>

            <Campo
              id="duracion"
              etiqueta="Duración (minutos)"
              requerido
              error={errores['duracionMinutos']}
            >
              <input
                id="duracion"
                type="number"
                min={5}
                max={480}
                step={5}
                value={duracion}
                onChange={(e) => setDuracion(e.target.value)}
                className={claseControl(Boolean(errores['duracionMinutos']))}
              />
            </Campo>
          </div>

          <Campo id="tipo" etiqueta="Tipo de consulta" requerido error={errores['tipo']}>
            <select
              id="tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as CitaTipo)}
              className={claseControl(Boolean(errores['tipo']))}
            >
              {CITA_TIPOS.map((t) => (
                <option key={t} value={t}>
                  {ETIQUETA_TIPO[t]}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="notas" etiqueta="Notas" error={errores['notas']}>
            <textarea
              id="notas"
              rows={3}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              className={claseControl(Boolean(errores['notas']))}
              placeholder="Traer laboratorios, revisar adherencia…"
            />
          </Campo>
        </fieldset>
      </form>
    </Modal>
  )
}
