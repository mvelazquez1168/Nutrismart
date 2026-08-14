/**
 * Exportación del expediente a PDF — CLI-05.
 *
 * El profesional elige qué secciones salen. La disponibilidad de cada
 * una se consulta al abrir, en vez de darla por supuesta: marcar «Plan
 * de alimentación» para un paciente que no tiene ninguno produciría un
 * documento con una sección ausente y ninguna explicación.
 */
import { useEffect, useState } from 'react'
import { ApiError, apiDescargarPost } from '../api/client'
import { getPlanes } from '../api/planes'
import { getSociodemografico } from '../api/sociodemografico'
import { getLaboratorios } from '../api/laboratorios'
import { Modal } from './Modal'

type ClaveSeccion = 'perfil' | 'plan' | 'laboratorios' | 'sociodemografico'

interface Disponibilidad {
  plan: boolean
  laboratorios: boolean
  sociodemografico: boolean
}

const MAX_NOTAS = 3000

export function ExportarPDFModal({
  abierto,
  pacienteId,
  pacienteNombre,
  onCerrar,
}: {
  abierto: boolean
  pacienteId: string
  pacienteNombre: string
  onCerrar: () => void
}) {
  const [disponible, setDisponible] = useState<Disponibilidad | null>(null)
  const [seleccion, setSeleccion] = useState<Set<ClaveSeccion>>(new Set(['perfil']))
  const [notas, setNotas] = useState('')
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  /*
   * Se consulta al abrir, no al montar la ficha: el profesional puede
   * haber creado un plan en otra pestaña y volver aquí. Tres peticiones
   * pequeñas y en paralelo cuestan menos que un documento equivocado.
   */
  useEffect(() => {
    if (!abierto) return
    let cancelado = false

    void Promise.allSettled([
      getPlanes(pacienteId),
      getSociodemografico(pacienteId),
      getLaboratorios(pacienteId),
    ]).then(([planes, socio, labs]) => {
      if (cancelado) return
      const d: Disponibilidad = {
        plan: planes.status === 'fulfilled' && planes.value.some((p) => p.estado === 'activo'),
        sociodemografico: socio.status === 'fulfilled' && socio.value.consentimientoOtorgado,
        laboratorios: labs.status === 'fulfilled' && labs.value.length > 0,
      }
      setDisponible(d)
      // El plan activo entra marcado por defecto: es lo que el paciente
      // se lleva a casa.
      setSeleccion(new Set<ClaveSeccion>(d.plan ? ['perfil', 'plan'] : ['perfil']))
    })

    return () => {
      cancelado = true
    }
  }, [abierto, pacienteId])

  // Estado limpio en cada apertura: un error de la vez anterior o unas
  // recomendaciones a medio escribir no pertenecen a esta exportación.
  useEffect(() => {
    if (!abierto) {
      setNotas('')
      setError(null)
      setAviso(null)
      setDisponible(null)
    }
  }, [abierto])

  const SECCIONES: {
    clave: ClaveSeccion
    etiqueta: string
    descripcion: string
    habilitada: boolean
    motivo?: string
  }[] = [
    {
      clave: 'perfil',
      etiqueta: 'Información del paciente',
      descripcion: 'Documento, contacto, diagnósticos y alergias',
      habilitada: true,
    },
    {
      clave: 'plan',
      etiqueta: 'Plan de alimentación',
      descripcion: 'La rejilla semanal del plan activo',
      habilitada: disponible?.plan ?? false,
      ...(disponible && !disponible.plan
        ? { motivo: 'Este paciente no tiene un plan activo' }
        : {}),
    },
    {
      clave: 'laboratorios',
      etiqueta: 'Resultados de laboratorio',
      descripcion: 'Valores con su rango de referencia y estado',
      habilitada: disponible?.laboratorios ?? false,
      ...(disponible && !disponible.laboratorios
        ? { motivo: 'No hay estudios registrados' }
        : {}),
    },
    {
      clave: 'sociodemografico',
      etiqueta: 'Contexto social',
      descripcion: 'Hábitos y contexto del paciente',
      habilitada: disponible?.sociodemografico ?? false,
      ...(disponible && !disponible.sociodemografico
        ? { motivo: 'Requiere el consentimiento del paciente' }
        : {}),
    },
  ]

  function alternar(clave: ClaveSeccion) {
    setSeleccion((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(clave)) siguiente.delete(clave)
      else siguiente.add(clave)
      return siguiente
    })
    setError(null)
  }

  async function exportar() {
    if (seleccion.size === 0) {
      setError('Selecciona al menos una sección.')
      return
    }
    setGenerando(true)
    setError(null)
    setAviso(null)
    try {
      const { tipo } = await apiDescargarPost(
        `/api/pacientes/${pacienteId}/pdf`,
        {
          secciones: [...seleccion],
          notasProfesional: notas.trim() === '' ? undefined : notas.trim(),
        },
        `Expediente_${pacienteNombre}.pdf`,
      )

      // El servidor avisa si tuvo que caer al HTML de reserva. Callarlo
      // dejaría al profesional con un archivo que su visor no abre y sin
      // saber por qué.
      if (tipo === 'html') {
        setAviso(
          'El generador de PDF no está disponible en el servidor: se descargó el documento en HTML. Ábrelo en el navegador e imprímelo a PDF.',
        )
        return
      }
      onCerrar()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo generar el documento')
    } finally {
      setGenerando(false)
    }
  }

  const cargando = disponible === null

  return (
    <Modal
      abierto={abierto}
      titulo="Exportar expediente"
      descripcion={pacienteNombre}
      bloqueado={generando}
      onCerrar={onCerrar}
      pie={
        <>
          <button
            type="button"
            onClick={onCerrar}
            disabled={generando}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={exportar}
            disabled={generando || cargando || seleccion.size === 0}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {generando ? 'Generando…' : 'Descargar'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">Secciones a incluir</p>
            <span className="text-xs text-muted">
              {seleccion.size} seleccionada{seleccion.size === 1 ? '' : 's'}
            </span>
          </div>

          {cargando ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-md bg-surface-2" />
              ))}
            </div>
          ) : (
            <ul className="space-y-2">
              {SECCIONES.map((s) => (
                <li key={s.clave}>
                  <label
                    className={`flex items-start gap-3 rounded-md border p-3 ${
                      !s.habilitada
                        ? 'cursor-not-allowed border-border bg-surface-2 opacity-60'
                        : seleccion.has(s.clave)
                          ? 'cursor-pointer border-primary bg-primary-tint'
                          : 'cursor-pointer border-border bg-surface hover:bg-surface-2'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={seleccion.has(s.clave)}
                      disabled={!s.habilitada}
                      onChange={() => alternar(s.clave)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--primary)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{s.etiqueta}</span>
                      <span className="block text-xs text-muted">{s.descripcion}</span>
                      {s.motivo && (
                        <span className="mt-1 block text-xs text-[color:var(--status-alert)]">
                          {s.motivo}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <label htmlFor="pdf-notas" className="mb-1 block text-sm font-semibold text-ink">
            Estrategia y recomendaciones
            <span className="ml-1 font-normal text-muted">(opcional)</span>
          </label>
          <textarea
            id="pdf-notas"
            rows={5}
            value={notas}
            maxLength={MAX_NOTAS}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Lo que quieras que aparezca en el documento: indicaciones, metas para la próxima consulta…"
            className="w-full resize-none rounded-md border border-border bg-surface p-3 text-sm text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
          />
          <p className="mt-1 text-right text-xs text-muted">
            {notas.length}/{MAX_NOTAS}
          </p>
          {/*
            Se guarda con la exportación, no en el expediente: es lo que
            se dijo en ESTE documento, y editarlo después falsearía lo
            que se entregó.
          */}
          <p className="text-xs text-muted">
            Este texto queda registrado junto a la exportación.
          </p>
        </div>

        {aviso && (
          <p
            role="alert"
            className="rounded-md border border-[color:var(--status-alert)] bg-surface p-3 text-sm text-ink"
          >
            {aviso}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
          >
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
