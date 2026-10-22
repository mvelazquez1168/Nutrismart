/**
 * Alta de un estudio de laboratorio, en dos pasos.
 *
 *   1. Archivo  → se sube y, si es CSV o PDF, se le leen los valores.
 *   2. Revisión → el profesional confirma o corrige ANTES de guardar.
 *
 * El segundo paso no es un trámite: lo que un parser dedujo de un CSV
 * no es un dato clínico hasta que alguien lo mira. Un decimal mal leído
 * en un laboratorio no es un error cosmético.
 *
 * El PDF también se lee — R43. Antes se pasaba directo a captura manual
 * con las casillas en blanco y sin decirlo, así que el estudio se
 * guardaba vacío y el expediente acababa con «Sin valores capturados;
 * solo el informe adjunto». Ahora el servidor le saca el texto y lo
 * mapea al catálogo con IA; lo leído entra COMO BORRADOR, con su aviso,
 * y sigue siendo el profesional quien lo confirma. Una imagen no se lee.
 *
 * ── El paso 2 ya no es un formulario de talla única ─────────────────
 *
 * Hasta R49 pintaba los 14 analitos del catálogo, siempre los mismos,
 * siempre todos. Con 93 en el catálogo eso sería una pared de casillas
 * vacías, y seguiría sin poder registrar lo que no estuviera en la
 * lista. Ahora se **busca y se agrega**: el profesional pone las filas
 * que su informe trae, y solo esas.
 *
 * Tres clases de fila, y la diferencia importa:
 *
 *   - **Catalogada cuantitativa** — valor numérico. Es la de siempre.
 *   - **Catalogada cualitativa** — valor de texto («No Reactiva»). Un
 *     VIH guardado como número sería una afirmación clínica falsa.
 *   - **Sin catalogar** — el analito que no está en ninguna lista. Se
 *     guarda con su nombre tal como se escribió y, desde R51, con el rango
 *     que el profesional quiera anotar. Ese rango va en sus propios campos
 *     (`ref_*_libre`) y **solo se enseña**: no entra en el cálculo del
 *     estado ni en la analítica, porque nadie lo ha validado contra un
 *     catálogo.
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Modal } from './Modal'
import { useCambiosSinGuardar } from '../contexts/CambiosSinGuardar'
import { Campo, claseControl } from './Campo'
import { ApiError } from '../api/client'
import { formatGrupo } from '../lib/grupos'
import {
  getBiomarcadores,
  subirArchivo,
  previsualizarCsv,
  previsualizarPdf,
  crearEstudio,
} from '../api/laboratorios'
import type {
  ArchivoSubido,
  Biomarcador,
  DatosEstudioEnvio,
  SexoBiologico,
} from '../api/tipos'

type Paso = 'archivo' | 'revision'

/**
 * Una fila del formulario.
 *
 * `valor` es SIEMPRE una cadena, también en los cuantitativos: mientras se
 * teclea se pasa por el vacío y por el «1.», y convertir a número en cada
 * pulsación pondría un 0 donde el profesional está a medio escribir. La
 * conversión ocurre una vez, al enviar.
 */
interface FilaResultado {
  /** Clave local de React. No viaja al servidor. */
  id: string
  codigo: string | null
  nombre: string
  es_cualitativo: boolean
  valor: string
  unidad: string
  refMin: number | null
  refMax: number | null
  esLibre: boolean
  /**
   * El rango que el profesional escribe para un analito libre — R51.
   *
   * Como TEXTO, igual que `valor`: al teclear se pasa por el vacío y por el
   * «1.», y convertir en cada pulsación pondría un 0 a medio escribir. Solo
   * se usa cuando `esLibre`; las filas del catálogo ya traen su rango.
   */
  refMinLibre?: string
  refMaxLibre?: string
  /** Lo trajo la lectura del archivo, no el teclado. Se marca en la fila. */
  delArchivo?: boolean
}

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

let contador = 0
function nuevoId(): string {
  contador += 1
  return `fila-${contador}`
}

/** «70 – 100 mg/dL», «≤ 200 mg/dL», «≥ 40 mg/dL» o «sin rango». */
function textoRango(min: number | null, max: number | null, unidad: string): string {
  if (min === null && max === null) return 'sin rango'
  const u = unidad && unidad !== '—' ? ` ${unidad}` : ''
  if (min !== null && max !== null) return `${min} – ${max}${u}`
  if (max !== null) return `≤ ${max}${u}`
  return `≥ ${min}${u}`
}

/** Sin acentos ni mayúsculas: buscar «hemoglobina» escribiendo «hem». */
function normalizar(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
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
  const [filas, setFilas] = useState<FilaResultado[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [noReconocidos, setNoReconocidos] = useState<{ etiqueta: string; valor: string }[]>([])
  const [avisos, setAvisos] = useState<string[]>([])

  const [fecha, setFecha] = useState(hoyISO())
  const [laboratorio, setLaboratorio] = useState('')
  const [notas, setNotas] = useState('')

  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [arrastrando, setArrastrando] = useState(false)

  // El catálogo en una ref además del estado: `procesarArchivo` corre dentro
  // de un manejador y necesita el catálogo YA cargado para armar las filas,
  // sin esperar al siguiente render.
  const catalogoRef = useRef<Biomarcador[]>([])

  useEffect(() => {
    if (!abierto) return
    setPaso('archivo')
    setArchivo(null)
    setFilas([])
    setBusqueda('')
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
      .then((c) => {
        catalogoRef.current = c
        setCatalogo(c)
      })
      .catch(() => setError('No se pudo cargar el catálogo de biomarcadores'))
    return () => ctrl.abort()
  }, [abierto, sexoPaciente])

  /* ---------------------------------------------------------------- */
  /* Filas                                                             */
  /* ---------------------------------------------------------------- */

  function filaDeCatalogo(b: Biomarcador, valor = '', delArchivo = false): FilaResultado {
    return {
      id: nuevoId(),
      codigo: b.codigo,
      nombre: b.nombre,
      es_cualitativo: b.es_cualitativo,
      valor,
      unidad: b.unidad,
      refMin: b.minimo,
      refMax: b.maximo,
      esLibre: false,
      delArchivo,
    }
  }

  function agregar(b: Biomarcador) {
    // Agregar dos veces el mismo analito crearía dos filas que el servidor
    // rechazaría como repetidas al guardar. Se enfoca la que ya está.
    if (filas.some((f) => f.codigo === b.codigo)) {
      setBusqueda('')
      return
    }
    setFilas((prev) => [...prev, filaDeCatalogo(b)])
    setBusqueda('')
  }

  function agregarLibre() {
    setFilas((prev) => [
      ...prev,
      {
        id: nuevoId(),
        codigo: null,
        nombre: '',
        es_cualitativo: false,
        valor: '',
        unidad: '',
        refMin: null,
        refMax: null,
        esLibre: true,
        refMinLibre: '',
        refMaxLibre: '',
      },
    ])
  }

  function editar(
    id: string,
    campo: 'valor' | 'nombre' | 'unidad' | 'refMinLibre' | 'refMaxLibre',
    texto: string,
  ) {
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, [campo]: texto } : f)))
  }

  function quitar(id: string) {
    setFilas((prev) => prev.filter((f) => f.id !== id))
  }

  /* ---------------------------------------------------------------- */
  /* Archivo                                                           */
  /* ---------------------------------------------------------------- */

  async function procesarArchivo(f: File) {
    setOcupado(true)
    setError(null)
    try {
      const subido = await subirArchivo(f)
      setArchivo(subido)
      const porCodigo = new Map(catalogoRef.current.map((b) => [b.codigo, b]))

      if (subido.mime === 'text/csv') {
        const prev = await previsualizarCsv(subido.id)
        setFilas(
          prev.reconocidos
            .map((r) => {
              const b = porCodigo.get(r.codigo)
              return b ? filaDeCatalogo(b, String(r.valor), true) : null
            })
            .filter((x): x is FilaResultado => x !== null),
        )
        setNoReconocidos(prev.noReconocidos)
        setAvisos(prev.avisos)
      } else if (subido.mime === 'application/pdf') {
        /*
         * El PDF se intenta leer con IA (R43).
         *
         * El aviso de cuántos valores se encontraron NO es decoración: es lo
         * que distingue «el informe trae estos diez» de «esto lo escribí yo»,
         * y es lo que hace que el profesional los revise.
         */
        const prev = await previsualizarPdf(subido.id)
        setFilas(
          prev.reconocidos
            .map((r) => {
              const b = porCodigo.get(r.codigo)
              if (!b) return null
              const fila = filaDeCatalogo(b, String(r.valor), true)
              /*
               * El rango que el informe traía impreso gana sobre el del
               * catálogo — R44. Solo si lo traía: lo que no venía en el papel
               * se queda con el criterio de la clínica.
               */
              if (r.referencia) {
                fila.refMin = r.referencia.minimo
                fila.refMax = r.referencia.maximo
              }
              return fila
            })
            .filter((x): x is FilaResultado => x !== null),
        )
        setNoReconocidos(prev.noReconocidos)
        setAvisos(
          prev.reconocidos.length > 0
            ? [
                `Se leyeron ${prev.reconocidos.length} valores del PDF. Revísalos contra el informe antes de guardar: los puso un modelo, no el laboratorio.`,
                ...prev.avisos,
              ]
            : prev.avisos,
        )
      } else {
        setFilas([])
        setNoReconocidos([])
        setAvisos([
          'Este archivo es una imagen y no se puede leer automáticamente. Busca los analitos y captura los valores a mano.',
        ])
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

  /**
   * Aviso al salir con cambios sin guardar (R46). Solo con el modal
   * abierto, y cubre sobre todo el botón Atrás del navegador.
   */
  const { marcarGuardado } = useCambiosSinGuardar({
    nombre: 'Laboratorio',
    activo: abierto,
    valores: { paso, archivoId: archivo?.id ?? null, filas, fecha, laboratorio, notas },
    guardar: () => guardar(),
  })

  /* ---------------------------------------------------------------- */
  /* Guardar                                                           */
  /* ---------------------------------------------------------------- */

  const conValor = filas.filter(
    (f) => f.valor.trim() !== '' && (!f.esLibre || f.nombre.trim() !== ''),
  )

  async function guardar() {
    if (ocupado) return
    setOcupado(true)
    setError(null)

    try {
      const resultados: DatosEstudioEnvio['resultados'] = conValor.map((f) => {
        const texto = f.valor.trim()
        if (f.esLibre) {
          /*
           * **Sin catalogar: el valor siempre como texto.**
           *
           * Puede parecer un número («1240») y aun así no es comparable con
           * nada por su cuenta: no hay catálogo que diga su unidad. Guardarlo
           * como texto conserva exactamente lo que el informe decía.
           *
           * El rango SÍ viaja, si lo escribieron — R51. Va en sus propios
           * campos (`ref_*_libre`) y no en los del catálogo: solo se enseña,
           * no entra en el cálculo del estado ni en la analítica.
           */
          const min = Number((f.refMinLibre ?? '').trim().replace(',', '.'))
          const max = Number((f.refMaxLibre ?? '').trim().replace(',', '.'))
          return {
            nombre_libre: f.nombre.trim(),
            valor_texto: texto,
            ref_min_libre: (f.refMinLibre ?? '').trim() !== '' && Number.isFinite(min) ? min : null,
            ref_max_libre: (f.refMaxLibre ?? '').trim() !== '' && Number.isFinite(max) ? max : null,
          }
        }
        if (f.es_cualitativo) {
          return { codigo: f.codigo as string, valor_texto: texto }
        }
        return {
          codigo: f.codigo as string,
          valor: Number(texto.replace(',', '.')),
          refMinimo: f.refMin,
          refMaximo: f.refMax,
        }
      })

      await crearEstudio(pacienteId, {
        fecha,
        laboratorio: laboratorio.trim() === '' ? null : laboratorio.trim(),
        notas: notas.trim() === '' ? null : notas.trim(),
        archivoId: archivo?.id ?? null,
        snapshotId: null,
        resultados,
      })
      marcarGuardado()
      onGuardado()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el estudio')
    } finally {
      setOcupado(false)
    }
  }

  /* ---------------------------------------------------------------- */
  /* Buscador                                                          */
  /* ---------------------------------------------------------------- */

  const sugerencias = useMemo(() => {
    const q = normalizar(busqueda)
    if (q === '') return []
    const yaPuestos = new Set(filas.map((f) => f.codigo).filter(Boolean))
    return catalogo
      .filter((b) => !yaPuestos.has(b.codigo))
      .filter((b) => normalizar(b.nombre).includes(q) || normalizar(b.codigo).includes(q))
      .slice(0, 12)
  }, [busqueda, catalogo, filas])

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      bloqueado={ocupado}
      /*
        Un clic fuera no tira el estudio a medio capturar — R43. Para salir
        están Cancelar, Escape y el aviso de cambios sin guardar.
      */
      sinCierreAlFondo
      titulo="Registrar laboratorio"
      descripcion={
        paso === 'archivo'
          ? 'Adjunta el informe. Un CSV o un PDF con texto se leen automáticamente; una imagen se captura a mano.'
          : 'Busca los analitos del informe y captura sus valores.'
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
              disabled={ocupado || (conValor.length === 0 && !archivo)}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
            >
              {ocupado ? 'Guardando…' : `Guardar (${conValor.length} valores)`}
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
              {ocupado ? 'Procesando el informe…' : 'Arrastra el informe aquí'}
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
                Se muestran para que no se pierdan. Búscalos abajo si corresponden a algún
                analito, o agrégalos como resultado no catalogado.
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

          {/* ---- Buscador de analitos ---- */}
          <div>
            <Campo id="buscar-analito" etiqueta="Agregar analito">
              <input
                id="buscar-analito"
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar analito (ej: Hemoglobina, Glucosa…)"
                autoComplete="off"
                className={claseControl(false)}
              />
            </Campo>

            {busqueda.trim() !== '' && (
              <div className="mt-2">
                {sugerencias.length === 0 ? (
                  <p className="text-xs text-muted">
                    Ningún analito del catálogo coincide. Puedes agregarlo como resultado no
                    catalogado, abajo.
                  </p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {sugerencias.map((b) => (
                      <li key={b.codigo}>
                        <button
                          type="button"
                          onClick={() => agregar(b)}
                          className="rounded-pill border border-border bg-surface px-3 py-1 text-left text-xs text-ink hover:border-primary hover:bg-primary-tint hover:text-primary"
                        >
                          {b.nombre}
                          <span className="ml-1.5 text-muted">{formatGrupo(b.grupo)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* ---- Filas ---- */}
          {filas.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">
              Todavía no has agregado ningún analito. Búscalo arriba por su nombre.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-left">
                    <th className="px-3 py-2 font-semibold text-ink">Analito</th>
                    <th className="w-32 px-2 py-2 font-semibold text-ink">Valor</th>
                    <th className="w-24 px-2 py-2 font-semibold text-ink">Unidad</th>
                    <th className="w-48 px-2 py-2 font-semibold text-ink">Referencia</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.id} className="border-b border-border last:border-0 align-middle">
                      <td className="px-3 py-2">
                        {f.esLibre ? (
                          <input
                            value={f.nombre}
                            onChange={(e) => editar(f.id, 'nombre', e.target.value)}
                            placeholder="Nombre del analito"
                            aria-label="Nombre del analito"
                            className={claseControl(false)}
                          />
                        ) : (
                          <>
                            <span className="font-medium text-ink">{f.nombre}</span>
                            <span className="ml-1.5 text-xs text-muted">{f.codigo}</span>
                            {/* Lo que vino del archivo se marca: distingue
                                «lo leyó el sistema» de «lo escribí yo». */}
                            {f.delArchivo && (
                              <span className="ml-1.5 text-xs text-primary">· del informe</span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          // Los cualitativos y los libres son texto; el resto,
                          // un número con el teclado decimal del móvil.
                          type={f.es_cualitativo || f.esLibre ? 'text' : 'number'}
                          inputMode={f.es_cualitativo || f.esLibre ? 'text' : 'decimal'}
                          step="any"
                          value={f.valor}
                          onChange={(e) => editar(f.id, 'valor', e.target.value)}
                          placeholder={f.es_cualitativo ? 'No Reactiva' : '—'}
                          aria-label={`Valor de ${f.nombre || 'el analito'}`}
                          className={claseControl(false)}
                        />
                      </td>
                      <td className="px-2 py-2">
                        {f.esLibre ? (
                          <input
                            value={f.unidad}
                            onChange={(e) => editar(f.id, 'unidad', e.target.value)}
                            placeholder="unidad"
                            aria-label="Unidad"
                            className={claseControl(false)}
                          />
                        ) : (
                          <span className="text-muted">{f.unidad}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-xs text-muted">
                        {f.esLibre ? (
                          /*
                            El rango de un analito libre se escribe — R51.
                            Antes aquí iba un «—» y el profesional tenía que
                            recordar de memoria contra qué se lee un valor
                            que él mismo acababa de teclear. Son opcionales:
                            si el informe no lo trae, se dejan vacíos.
                          */
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              inputMode="decimal"
                              step="any"
                              value={f.refMinLibre ?? ''}
                              onChange={(e) => editar(f.id, 'refMinLibre', e.target.value)}
                              placeholder="mín"
                              aria-label={`Referencia mínima de ${f.nombre || 'el analito'}`}
                              className={`${claseControl(false)} w-20 px-1.5`}
                            />
                            <span aria-hidden="true">–</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              step="any"
                              value={f.refMaxLibre ?? ''}
                              onChange={(e) => editar(f.id, 'refMaxLibre', e.target.value)}
                              placeholder="máx"
                              aria-label={`Referencia máxima de ${f.nombre || 'el analito'}`}
                              className={`${claseControl(false)} w-20 px-1.5`}
                            />
                          </div>
                        ) : f.es_cualitativo ? (
                          '—'
                        ) : (
                          textoRango(f.refMin, f.refMax, f.unidad)
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => quitar(f.id)}
                          aria-label={`Quitar ${f.nombre || 'la fila'}`}
                          className="rounded-md px-2 py-1 text-muted hover:bg-surface-2 hover:text-ink"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            onClick={agregarLibre}
            className="text-sm font-medium text-primary hover:underline"
          >
            ＋ Agregar resultado no catalogado
          </button>

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
