/**
 * Alta de un estudio de laboratorio, en dos pasos.
 *
 *   1. Archivo  → se sube y, si es CSV, se parsea.
 *   2. Revisión → el profesional confirma o corrige ANTES de guardar.
 *
 * El segundo paso no es un trámite: lo que un parser dedujo de un CSV
 * no es un dato clínico hasta que alguien lo mira. Un decimal mal leído
 * en un laboratorio no es un error cosmético.
 *
 * Con PDF no hay nada que parsear —esa es la frontera de la v1— así que
 * se pasa directamente a captura manual con el informe adjunto.
 */
import { useEffect, useState, type ChangeEvent, type DragEvent } from 'react'
import { Modal } from './Modal'
import { Campo, claseControl } from './Campo'
import { ApiError } from '../api/client'
import {
  getBiomarcadores,
  subirArchivo,
  previsualizarCsv,
  crearEstudio,
} from '../api/laboratorios'
import type { ArchivoSubido, Biomarcador, SexoBiologico } from '../api/tipos'

type Paso = 'archivo' | 'revision'

interface Props {
  abierto: boolean
  pacienteId: string
  /** Decide qué rangos se muestran como referencia al capturar. */
  sexoPaciente: SexoBiologico | null
  onCerrar: () => void
  onGuardado: () => void
}

function hoyISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function LaboratorioModal({
  abierto,
  pacienteId,
  sexoPaciente,
  onCerrar,
  onGuardado,
}: Props) {
  const [paso, setPaso] = useState<Paso>('archivo')
  const [catalogo, setCatalogo] = useState<Biomarcador[]>([])

  const [archivo, setArchivo] = useState<ArchivoSubido | null>(null)
  const [valores, setValores] = useState<Record<string, string>>({})
  const [noReconocidos, setNoReconocidos] = useState<{ etiqueta: string; valor: string }[]>([])
  const [avisos, setAvisos] = useState<string[]>([])

  const [fecha, setFecha] = useState(hoyISO())
  const [laboratorio, setLaboratorio] = useState('')
  const [notas, setNotas] = useState('')

  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [arrastrando, setArrastrando] = useState(false)

  useEffect(() => {
    if (!abierto) return
    setPaso('archivo')
    setArchivo(null)
    setValores({})
    setNoReconocidos([])
    setAvisos([])
    setFecha(hoyISO())
    setLaboratorio('')
    setNotas('')
    setError(null)
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    const ctrl = new AbortController()
    getBiomarcadores(sexoPaciente, ctrl.signal)
      .then(setCatalogo)
      .catch(() => setError('No se pudo cargar el catálogo de biomarcadores'))
    return () => ctrl.abort()
  }, [abierto, sexoPaciente])

  async function procesarArchivo(f: File) {
    setOcupado(true)
    setError(null)
    try {
      const subido = await subirArchivo(f)
      setArchivo(subido)

      if (subido.mime === 'text/csv') {
        const prev = await previsualizarCsv(subido.id)
        const iniciales: Record<string, string> = {}
        for (const r of prev.reconocidos) iniciales[r.codigo] = String(r.valor)
        setValores(iniciales)
        setNoReconocidos(prev.noReconocidos)
        setAvisos(prev.avisos)
      } else {
        setValores({})
        setNoReconocidos([])
        setAvisos([])
      }
      setPaso('revision')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo procesar el archivo')
    } finally {
      setOcupado(false)
    }
  }

  function alSoltar(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setArrastrando(false)
    const f = e.dataTransfer.files[0]
    if (f) void procesarArchivo(f)
  }

  function alElegir(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) void procesarArchivo(f)
  }

  async function guardar() {
    if (ocupado) return
    setOcupado(true)
    setError(null)

    try {
      const resultados = Object.entries(valores)
        .map(([codigo, bruto]) => ({ codigo, valor: Number(String(bruto).replace(',', '.')) }))
        // Un campo vacío significa "no se midió", no cero.
        .filter((r) => Number.isFinite(r.valor) && String(valores[r.codigo]).trim() !== '')

      await crearEstudio(pacienteId, {
        fecha,
        laboratorio: laboratorio.trim() === '' ? null : laboratorio.trim(),
        notas: notas.trim() === '' ? null : notas.trim(),
        archivoId: archivo?.id ?? null,
        snapshotId: null,
        resultados,
      })
      onGuardado()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el estudio')
    } finally {
      setOcupado(false)
    }
  }

  const porGrupo = new Map<string, Biomarcador[]>()
  for (const b of catalogo) {
    porGrupo.set(b.grupo, [...(porGrupo.get(b.grupo) ?? []), b])
  }

  const conValor = Object.values(valores).filter((v) => String(v).trim() !== '').length

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      bloqueado={ocupado}
      titulo="Registrar laboratorio"
      descripcion={
        paso === 'archivo'
          ? 'Adjunta el informe. Un CSV se lee automáticamente; un PDF se captura a mano.'
          : 'Revisa los valores antes de guardarlos.'
      }
      pie={
        paso === 'revision' ? (
          <>
            <button
              type="button"
              onClick={() => setPaso('archivo')}
              disabled={ocupado}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
            >
              Atrás
            </button>
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={ocupado}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
            >
              {ocupado ? 'Guardando…' : `Guardar (${conValor} valores)`}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onCerrar}
            disabled={ocupado}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
          >
            Cancelar
          </button>
        )
      }
    >
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-[color:var(--status-critical)] bg-surface-2 p-3 text-sm text-ink"
        >
          {error}
        </p>
      )}

      {paso === 'archivo' && (
        <div className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setArrastrando(true)
            }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={alSoltar}
            className={`rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
              arrastrando ? 'border-primary bg-primary-tint' : 'border-border bg-surface-2'
            }`}
          >
            <p className="text-sm font-medium text-ink">
              {ocupado ? 'Procesando…' : 'Arrastra el informe aquí'}
            </p>
            <p className="mt-1 text-xs text-muted">PDF, CSV, PNG o JPEG · máximo 10 MB</p>
            <label className="mt-4 inline-block cursor-pointer rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2">
              Elegir archivo
              <input
                type="file"
                accept=".pdf,.csv,.png,.jpg,.jpeg"
                onChange={alElegir}
                disabled={ocupado}
                className="hidden"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={() => setPaso('revision')}
            disabled={ocupado}
            className="w-full text-center text-sm text-muted underline hover:text-ink"
          >
            Capturar valores sin adjuntar archivo
          </button>
        </div>
      )}

      {paso === 'revision' && (
        <div className="space-y-5">
          {archivo && (
            <p className="rounded-md border border-border bg-surface-2 p-3 text-sm text-ink">
              Adjunto: <strong className="font-semibold">{archivo.nombreOriginal}</strong>{' '}
              <span className="text-muted">
                ({Math.round(archivo.tamanoBytes / 1024)} KB · {archivo.mime})
              </span>
            </p>
          )}

          {avisos.length > 0 && (
            <ul className="space-y-1 rounded-md border border-[color:var(--status-alert)] bg-surface-2 p-3 text-sm text-ink">
              {avisos.map((a) => (
                <li key={a}>· {a}</li>
              ))}
            </ul>
          )}

          {noReconocidos.length > 0 && (
            <div className="rounded-md border border-border bg-surface-2 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                No reconocidos en el archivo
              </p>
              <p className="mt-1 text-xs text-muted">
                Se muestran para que no se pierdan; captúralos abajo si corresponden a algún analito.
              </p>
              <ul className="mt-2 space-y-0.5 text-sm text-ink">
                {noReconocidos.map((n, i) => (
                  <li key={`${n.etiqueta}-${i}`}>
                    {n.etiqueta}: <span className="text-muted">{n.valor || '—'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo id="fecha-lab" etiqueta="Fecha de la muestra" requerido>
              <input
                id="fecha-lab"
                type="date"
                value={fecha}
                max={hoyISO()}
                onChange={(e) => setFecha(e.target.value)}
                className={claseControl(false)}
              />
            </Campo>
            <Campo id="laboratorio" etiqueta="Laboratorio">
              <input
                id="laboratorio"
                value={laboratorio}
                onChange={(e) => setLaboratorio(e.target.value)}
                placeholder="Lab Clínico Vida"
                className={claseControl(false)}
              />
            </Campo>
          </div>

          {[...porGrupo.entries()].map(([grupo, biomarcadores]) => (
            <fieldset key={grupo} disabled={ocupado}>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                {grupo}
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {biomarcadores.map((b) => (
                  <label key={b.codigo} className="text-sm">
                    <span className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="font-medium text-ink">{b.nombre}</span>
                      <span className="text-xs text-muted">
                        {b.origenRango === 'ninguno'
                          ? 'sin rango'
                          : `${b.minimo ?? '—'}–${b.maximo ?? '—'}`}{' '}
                        {b.unidad}
                      </span>
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step={b.decimales > 0 ? '0.01' : '1'}
                      value={valores[b.codigo] ?? ''}
                      onChange={(e) =>
                        setValores((prev) => ({ ...prev, [b.codigo]: e.target.value }))
                      }
                      placeholder="—"
                      className={claseControl(false)}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}

          <Campo id="notas-lab" etiqueta="Notas">
            <textarea
              id="notas-lab"
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              className={claseControl(false)}
              placeholder="Observaciones sobre la toma o el informe…"
            />
          </Campo>
        </div>
      )}
    </Modal>
  )
}
