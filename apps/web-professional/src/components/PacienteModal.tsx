/**
 * Modal de alta y edición de paciente.
 *
 * Un solo componente para ambos casos: los campos son idénticos y
 * duplicarlos garantizaría que se desincronicen a la primera que se
 * añada uno nuevo.
 *
 * El alta es LIGERA a propósito (docs/REBANADA-02.md): identidad,
 * motivo, diagnósticos y alergias. El expediente clínico completo se
 * llena después, no al crear.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { Modal } from './Modal'
import { Campo, claseControl } from './Campo'
import { ChipsInput } from './ChipsInput'
import { ApiError } from '../api/client'
import { crearPaciente, actualizarPaciente } from '../api/pacientes'
import {
  DOCUMENTO_TIPOS,
  SEXOS_BIOLOGICOS,
  type DatosPacienteEnvio,
  type DocumentoTipo,
  type PacienteDetalle,
  type SexoBiologico,
} from '../api/tipos'

const ETIQUETA_DOCUMENTO: Record<DocumentoTipo, string> = {
  cedula: 'Cédula',
  dimex: 'DIMEX',
  pasaporte: 'Pasaporte',
  nite: 'NITE',
}

const ETIQUETA_SEXO: Record<SexoBiologico, string> = {
  masculino: 'Masculino',
  femenino: 'Femenino',
  intersexual: 'Intersexual',
}

interface Formulario {
  nombre: string
  documentoTipo: string
  documentoNumero: string
  fechaNacimiento: string
  sexoBiologico: string
  telefono: string
  correo: string
  motivoConsulta: string
  diagnosticos: string[]
  alergias: string[]
}

const VACIO: Formulario = {
  nombre: '',
  documentoTipo: '',
  documentoNumero: '',
  fechaNacimiento: '',
  sexoBiologico: '',
  telefono: '',
  correo: '',
  motivoConsulta: '',
  diagnosticos: [],
  alergias: [],
}

function desdeDetalle(p: PacienteDetalle): Formulario {
  return {
    nombre: p.nombre,
    documentoTipo: p.documento.tipo ?? '',
    documentoNumero: p.documento.numero ?? '',
    fechaNacimiento: p.fechaNacimiento ?? '',
    sexoBiologico: p.sexoBiologico ?? '',
    telefono: p.telefono ?? '',
    correo: p.correo ?? '',
    motivoConsulta: p.motivoConsulta ?? '',
    diagnosticos: p.diagnosticos.map((d) => d.descripcion),
    alergias: p.alergias.map((a) => a.descripcion),
  }
}

/** Cadena vacía viaja como null: la API la trata como "sin dato". */
function nulo(v: string): string | null {
  const t = v.trim()
  return t === '' ? null : t
}

function aEnvio(f: Formulario): DatosPacienteEnvio {
  return {
    nombre: f.nombre.trim(),
    documentoTipo: (nulo(f.documentoTipo) as DocumentoTipo | null) ?? null,
    documentoNumero: nulo(f.documentoNumero),
    fechaNacimiento: nulo(f.fechaNacimiento),
    sexoBiologico: (nulo(f.sexoBiologico) as SexoBiologico | null) ?? null,
    telefono: nulo(f.telefono),
    correo: nulo(f.correo),
    motivoConsulta: nulo(f.motivoConsulta),
    diagnosticos: f.diagnosticos,
    alergias: f.alergias,
  }
}

function edadDe(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const [a, m, d] = iso.split('-').map(Number)
  if (a === undefined || m === undefined || d === undefined) return null

  const hoy = new Date()
  let edad = hoy.getFullYear() - a
  const cumplioEsteAnio = hoy.getMonth() + 1 > m || (hoy.getMonth() + 1 === m && hoy.getDate() >= d)
  if (!cumplioEsteAnio) edad--

  return edad >= 0 && edad < 140 ? edad : null
}

interface Props {
  abierto: boolean
  /** null = alta; con detalle = edición pre-poblada. */
  paciente: PacienteDetalle | null
  onCerrar: () => void
  onGuardado: () => void
}

export function PacienteModal({ abierto, paciente, onCerrar, onGuardado }: Props) {
  const esEdicion = paciente !== null

  const [f, setF] = useState<Formulario>(VACIO)
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  // Se repuebla al abrir, no al montar: el modal permanece montado
  // entre aperturas y arrastraría los datos del paciente anterior.
  useEffect(() => {
    if (!abierto) return
    setF(paciente ? desdeDetalle(paciente) : VACIO)
    setErrores({})
    setErrorGeneral(null)
  }, [abierto, paciente])

  function set<K extends keyof Formulario>(campo: K, valor: Formulario[K]) {
    setF((prev) => ({ ...prev, [campo]: valor }))
    // El error de un campo se borra al tocarlo: mantenerlo mientras el
    // usuario corrige resulta acusatorio y confuso.
    setErrores((prev) => {
      if (!(campo in prev)) return prev
      const copia = { ...prev }
      delete copia[campo]
      return copia
    })
  }

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (guardando) return

    setGuardando(true)
    setErrores({})
    setErrorGeneral(null)

    try {
      const datos = aEnvio(f)
      if (esEdicion) {
        await actualizarPaciente(paciente.id, datos)
      } else {
        await crearPaciente(datos)
      }
      onGuardado()
    } catch (error) {
      if (error instanceof ApiError && error.esValidacion) {
        const mapa: Record<string, string> = {}
        for (const e of error.errores ?? []) mapa[e.campo] = e.mensaje
        setErrores(mapa)
      } else if (error instanceof ApiError && error.status === 409) {
        // El documento duplicado es un 409, no un 400: se asocia a mano
        // al campo que lo provoca para que el usuario lo vea donde toca.
        setErrores({ documentoNumero: error.message })
      } else {
        setErrorGeneral(error instanceof Error ? error.message : 'No se pudo guardar')
      }
    } finally {
      setGuardando(false)
    }
  }

  const edad = edadDe(f.fechaNacimiento)

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      bloqueado={guardando}
      titulo={esEdicion ? 'Editar paciente' : 'Nuevo paciente'}
      descripcion={
        esEdicion
          ? 'Actualiza los datos del paciente.'
          : 'Datos básicos para abrir el expediente. El resto se completa en la primera valoración.'
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
            form="form-paciente"
            disabled={guardando}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear paciente'}
          </button>
        </>
      }
    >
      <form id="form-paciente" onSubmit={enviar} className="space-y-6" noValidate>
        {errorGeneral && (
          <p
            role="alert"
            className="rounded-md border border-[color:var(--status-critical)] bg-surface-2 p-3 text-sm text-ink"
          >
            {errorGeneral}
          </p>
        )}

        <fieldset disabled={guardando} className="space-y-4">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Identidad
          </legend>

          <Campo id="nombre" etiqueta="Nombre completo" requerido error={errores['nombre']}>
            <input
              id="nombre"
              value={f.nombre}
              onChange={(e) => set('nombre', e.target.value)}
              className={claseControl(Boolean(errores['nombre']))}
              placeholder="Nombre y apellidos"
            />
          </Campo>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo id="documentoTipo" etiqueta="Tipo de documento" error={errores['documentoTipo']}>
              <select
                id="documentoTipo"
                value={f.documentoTipo}
                onChange={(e) => set('documentoTipo', e.target.value)}
                className={claseControl(Boolean(errores['documentoTipo']))}
              >
                <option value="">Sin especificar</option>
                {DOCUMENTO_TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETA_DOCUMENTO[t]}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo
              id="documentoNumero"
              etiqueta="Número de documento"
              error={errores['documentoNumero']}
              ayuda="Único dentro de tu clínica"
            >
              <input
                id="documentoNumero"
                value={f.documentoNumero}
                onChange={(e) => set('documentoNumero', e.target.value)}
                className={claseControl(Boolean(errores['documentoNumero']))}
                placeholder="1-1111-1111"
              />
            </Campo>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo
              id="fechaNacimiento"
              etiqueta="Fecha de nacimiento"
              error={errores['fechaNacimiento']}
              ayuda={edad !== null ? `${edad} años` : undefined}
            >
              <input
                id="fechaNacimiento"
                type="date"
                value={f.fechaNacimiento}
                onChange={(e) => set('fechaNacimiento', e.target.value)}
                className={claseControl(Boolean(errores['fechaNacimiento']))}
              />
            </Campo>

            <Campo
              id="sexoBiologico"
              etiqueta="Sexo biológico"
              error={errores['sexoBiologico']}
              ayuda="Dato clínico para requerimientos energéticos"
            >
              <select
                id="sexoBiologico"
                value={f.sexoBiologico}
                onChange={(e) => set('sexoBiologico', e.target.value)}
                className={claseControl(Boolean(errores['sexoBiologico']))}
              >
                <option value="">Sin especificar</option>
                {SEXOS_BIOLOGICOS.map((s) => (
                  <option key={s} value={s}>
                    {ETIQUETA_SEXO[s]}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo id="telefono" etiqueta="Teléfono" error={errores['telefono']}>
              <input
                id="telefono"
                value={f.telefono}
                onChange={(e) => set('telefono', e.target.value)}
                className={claseControl(Boolean(errores['telefono']))}
                placeholder="8888-8888"
              />
            </Campo>

            <Campo id="correo" etiqueta="Correo" error={errores['correo']}>
              <input
                id="correo"
                type="email"
                value={f.correo}
                onChange={(e) => set('correo', e.target.value)}
                className={claseControl(Boolean(errores['correo']))}
                placeholder="paciente@correo.cr"
              />
            </Campo>
          </div>
        </fieldset>

        <fieldset disabled={guardando} className="space-y-4">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Contexto inicial
          </legend>

          <Campo id="motivoConsulta" etiqueta="Motivo de consulta" error={errores['motivoConsulta']}>
            <textarea
              id="motivoConsulta"
              rows={2}
              value={f.motivoConsulta}
              onChange={(e) => set('motivoConsulta', e.target.value)}
              className={claseControl(Boolean(errores['motivoConsulta']))}
              placeholder="Bajar de peso, control de diabetes…"
            />
          </Campo>

          <Campo
            id="diagnosticos"
            etiqueta="Diagnósticos"
            error={errores['diagnosticos']}
            ayuda="Enter o coma para añadir cada uno"
          >
            <ChipsInput
              id="diagnosticos"
              valores={f.diagnosticos}
              onCambio={(v) => set('diagnosticos', v)}
              placeholder="Sobrepeso, Diabetes tipo 2…"
              hayError={Boolean(errores['diagnosticos'])}
              disabled={guardando}
            />
          </Campo>

          <Campo
            id="alergias"
            etiqueta="Alergias e intolerancias"
            requerido
            error={errores['alergias']}
            ayuda={'Si no tiene ninguna, márcalo explícitamente con "Ninguna"'}
          >
            <ChipsInput
              id="alergias"
              valores={f.alergias}
              onCambio={(v) => set('alergias', v)}
              placeholder="Penicilina, Lactosa…"
              hayError={Boolean(errores['alergias'])}
              sugerencias={['Ninguna']}
              disabled={guardando}
            />
          </Campo>
        </fieldset>
      </form>
    </Modal>
  )
}
