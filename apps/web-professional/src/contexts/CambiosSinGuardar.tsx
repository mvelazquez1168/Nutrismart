/**
 * Aviso al salir de un formulario con cambios sin guardar — R46.
 *
 * ── El problema ──────────────────────────────────────────────────────
 *
 * Media valoración se escribe sin pulsar «Guardar»: se rellena el
 * Clínico, se cambia de pestaña y lo escrito se va sin un solo aviso. En
 * un expediente clínico eso no es una molestia, es perder datos de una
 * consulta que ya ocurrió.
 *
 * ── Cómo se usa (dos líneas por formulario) ──────────────────────────
 *
 *   const { marcarGuardado } = useCambiosSinGuardar({
 *     nombre: 'Clínico',
 *     activo: !cargando && !bloqueada,
 *     valores: { apf, app, sesiones, duracion, fuma },  // lo que hay en pantalla
 *     guardar,                                          // su propio guardado
 *   })
 *
 * y, en el camino de éxito de `guardar`, un `marcarGuardado()`.
 *
 * El formulario NO lleva lógica de «sucio»: entrega sus valores y su
 * función de guardar. El hook serializa los valores, se queda con la
 * primera serialización como referencia y considera que hay cambios
 * cuando la de ahora difiere. `marcarGuardado()` mueve la referencia.
 *
 * **Llámalo DESPUÉS de cualquier recarga que haga el guardado.** Si el
 * formulario vuelve a leer del servidor tras guardar, la referencia debe
 * tomarse con los valores ya recargados; tomarla antes deja el
 * formulario marcado como sucio con lo mismo que acaba de guardar.
 *
 * El sesgo es deliberado: ante la duda, sucio. Un modal de más es una
 * molestia; un modal de menos es una consulta perdida.
 *
 * ── Cómo se bloquea la salida ────────────────────────────────────────
 *
 * Con `useBlocker` de react-router, que atrapa tanto los `<Link>` como
 * el botón Atrás del navegador y deja el formulario MONTADO mientras se
 * decide —si se desmontara, «Guardar» no tendría nada que guardar—.
 *
 * `useBlocker` exige un data router. La aplicación usa `<Routes>`
 * declarativas, así que `App.tsx` envuelve todo en un `RouterProvider`
 * con una única ruta `*`: las rutas de dentro no se tocan y aparece el
 * contexto que el bloqueo necesita.
 *
 * Lo que `useBlocker` NO cubre es cerrar la pestaña o recargar. Eso lo
 * tapa `beforeunload`, que solo puede sacar el diálogo del navegador: no
 * se puede ofrecer «Guardar» ahí, pero al menos no se pierde en silencio.
 *
 * ── Y lo que no es una ruta ──────────────────────────────────────────
 *
 * Cambiar de pestaña dentro de la valoración no cambia la URL, así que
 * `useBlocker` no lo ve. Para eso está `useSalidaSegura()`: envuelve
 * cualquier acción que abandone el formulario —cambio de pestaña,
 * `navigate()` a mano— y la pasa por el mismo modal.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useBlocker } from 'react-router-dom'

/** Lo que cada formulario deja registrado mientras está en pantalla. */
interface Registro {
  nombre: string
  sucio: boolean
  guardar: () => Promise<void> | void
}

interface Contexto {
  registrar: (id: string, r: Registro) => void
  olvidar: (id: string) => void
  /** Pide confirmación antes de ejecutar algo que abandona el formulario. */
  confirmar: (accion: () => void) => void
}

const Ctx = createContext<Contexto | null>(null)

/* ================================================================== */
/* Hook para los formularios                                          */
/* ================================================================== */

export function useCambiosSinGuardar({
  nombre,
  valores,
  guardar,
  activo = true,
}: {
  /** Nombre visible, para que el modal diga de qué formulario habla. */
  nombre: string
  /** Lo que hay en pantalla ahora mismo. Objeto literal, serializable. */
  valores: unknown
  /** El guardado del propio formulario. */
  guardar: () => Promise<void> | void
  /**
   * false mientras el formulario carga o está bloqueado.
   *
   * Importa: con `activo` en false no se toma la referencia, y así los
   * valores vacíos del primer render no se confunden con los de verdad.
   */
  activo?: boolean
}): { sucio: boolean; marcarGuardado: () => void } {
  const ctx = useContext(Ctx)
  const id = useId()

  const serie = JSON.stringify(valores)
  const serieRef = useRef(serie)
  serieRef.current = serie

  /** La serialización de referencia: lo último cargado o guardado. */
  const [referencia, setReferencia] = useState<string | null>(null)

  useEffect(() => {
    if (!activo) {
      // Al desactivarse —se bloquea la consulta, se recarga— se olvida la
      // referencia para que la próxima activación tome una nueva.
      setReferencia(null)
      return
    }
    setReferencia((r) => r ?? serieRef.current)
  }, [activo])

  const sucio = activo && referencia !== null && referencia !== serie

  /**
   * `marcarGuardado` NO toma la referencia en el momento de la llamada:
   * pide una toma y la hace un efecto.
   *
   * La diferencia importa en los formularios que al guardar recargan del
   * servidor (`setForm(aFormulario(b))`). React agrupa ese `setForm` con
   * el `setGuardados` de aquí en un solo re-render; el efecto corre
   * DESPUÉS, cuando `serieRef` ya tiene los valores recargados. Leyendo
   * la ref en la llamada se tomaría la serialización de antes de guardar,
   * y el formulario quedaría marcado como sucio con lo que acaba de
   * guardar.
   */
  const [guardados, setGuardados] = useState(0)
  const marcarGuardado = useCallback(() => setGuardados((n) => n + 1), [])

  useEffect(() => {
    if (guardados === 0) return
    setReferencia(serieRef.current)
    // Solo al pedirlo: depender de la serialización re-tomaría la
    // referencia en cada tecla y nada estaría nunca sucio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardados])

  // El registro se refresca en cada render en que cambie algo que el
  // provider usa. `guardar` suele ser una función nueva cada render, así
  // que se guarda por ref y el efecto no depende de ella.
  const guardarRef = useRef(guardar)
  guardarRef.current = guardar

  useEffect(() => {
    if (!ctx) return
    ctx.registrar(id, {
      nombre,
      sucio,
      guardar: () => guardarRef.current(),
    })
    return () => ctx.olvidar(id)
  }, [ctx, id, nombre, sucio])

  return { sucio, marcarGuardado }
}

/**
 * Envuelve una acción que abandona el formulario sin cambiar la URL.
 *
 * Sin cambios pendientes la ejecuta tal cual; con cambios, abre el modal
 * y la ejecuta según lo que se elija.
 */
export function useSalidaSegura(): (accion: () => void) => void {
  const ctx = useContext(Ctx)
  return useCallback(
    (accion: () => void) => {
      if (!ctx) {
        accion()
        return
      }
      ctx.confirmar(accion)
    },
    [ctx],
  )
}

/* ================================================================== */
/* Provider                                                           */
/* ================================================================== */

/** Qué hacer cuando se resuelva el modal. */
type Pendiente =
  | { tipo: 'ruta' }
  | { tipo: 'accion'; ejecutar: () => void }

export function CambiosSinGuardarProvider({ children }: { children: ReactNode }) {
  const registros = useRef(new Map<string, Registro>())
  /** Solo para re-renderizar: el Map vive en una ref. */
  const [version, setVersion] = useState(0)
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const registrar = useCallback((id: string, r: Registro) => {
    const previo = registros.current.get(id)
    registros.current.set(id, r)
    if (previo?.sucio !== r.sucio || previo?.nombre !== r.nombre) setVersion((v) => v + 1)
  }, [])

  const olvidar = useCallback((id: string) => {
    if (registros.current.delete(id)) setVersion((v) => v + 1)
  }, [])

  const sucios = useMemo(() => {
    void version
    return [...registros.current.values()].filter((r) => r.sucio)
  }, [version])

  const haySucios = sucios.length > 0

  /* ---- Navegación por rutas: Link y botón Atrás ---- */
  const bloqueo = useBlocker(haySucios)

  useEffect(() => {
    if (bloqueo.state === 'blocked') setPendiente({ tipo: 'ruta' })
  }, [bloqueo.state])

  /* ---- Cerrar la pestaña o recargar ---- */
  useEffect(() => {
    if (!haySucios) return
    function alCerrar(e: BeforeUnloadEvent) {
      // El navegador solo saca su propio diálogo: aquí no se puede
      // ofrecer «Guardar». Es el único caso que no pasa por el modal.
      e.preventDefault()
    }
    window.addEventListener('beforeunload', alCerrar)
    return () => window.removeEventListener('beforeunload', alCerrar)
  }, [haySucios])

  const confirmar = useCallback(
    (accion: () => void) => {
      if (registros.current.size === 0 || ![...registros.current.values()].some((r) => r.sucio)) {
        accion()
        return
      }
      setPendiente({ tipo: 'accion', ejecutar: accion })
    },
    [],
  )

  /** Sigue adelante con lo que estuviera pendiente. */
  const continuar = useCallback(() => {
    const p = pendiente
    setPendiente(null)
    setError(null)
    if (!p) return
    if (p.tipo === 'ruta') bloqueo.proceed?.()
    else p.ejecutar()
  }, [pendiente, bloqueo])

  /** Se queda donde está. */
  const quedarse = useCallback(() => {
    const p = pendiente
    setPendiente(null)
    setError(null)
    if (p?.tipo === 'ruta') bloqueo.reset?.()
  }, [pendiente, bloqueo])

  async function guardarYContinuar() {
    setGuardando(true)
    setError(null)
    try {
      // En serie y no en paralelo: son escrituras clínicas y, si una
      // falla, hay que poder decir cuál sin que las demás estén a medias.
      for (const r of [...registros.current.values()].filter((x) => x.sucio)) {
        await r.guardar()
      }
      setGuardando(false)
      continuar()
    } catch (e) {
      setGuardando(false)
      setError(
        e instanceof Error
          ? `No se pudo guardar: ${e.message}`
          : 'No se pudo guardar. Revisa el formulario.',
      )
    }
  }

  const valor = useMemo<Contexto>(
    () => ({ registrar, olvidar, confirmar }),
    [registrar, olvidar, confirmar],
  )

  return (
    <Ctx.Provider value={valor}>
      {children}
      {pendiente !== null && (
        <ModalSinGuardar
          nombres={sucios.map((r) => r.nombre)}
          guardando={guardando}
          error={error}
          onGuardar={() => void guardarYContinuar()}
          onAbandonar={continuar}
          onQuedarse={quedarse}
        />
      )}
    </Ctx.Provider>
  )
}

/* ================================================================== */
/* Modal                                                              */
/* ================================================================== */

function ModalSinGuardar({
  nombres,
  guardando,
  error,
  onGuardar,
  onAbandonar,
  onQuedarse,
}: {
  nombres: string[]
  guardando: boolean
  error: string | null
  onGuardar: () => void
  onAbandonar: () => void
  onQuedarse: () => void
}) {
  // Escape = quedarse. Es la salida de un clic por error en el menú, y no
  // decide nada: ni guarda ni descarta.
  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key === 'Escape' && !guardando) onQuedarse()
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [guardando, onQuedarse])

  const lista =
    nombres.length === 0
      ? 'este formulario'
      : nombres.length === 1
        ? `«${nombres[0]}»`
        : nombres.map((n) => `«${n}»`).join(', ')

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* El fondo NO cierra: un clic fuera no debe decidir por el
          profesional si lo escrito se guarda o se descarta. */}
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sin-guardar-titulo"
        className="relative w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg"
      >
        <h2 id="sin-guardar-titulo" className="text-base font-bold text-ink">
          Hay cambios sin guardar
        </h2>
        <p className="mt-2 text-sm text-muted">
          {nombres.length > 1 ? 'Los formularios' : 'El formulario'} {lista}{' '}
          {nombres.length > 1 ? 'tienen' : 'tiene'} cambios que todavía no se han guardado.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-md border p-2 text-sm text-ink"
            style={{
              borderColor: 'var(--status-critical)',
              backgroundColor: 'color-mix(in srgb, var(--status-critical) 8%, transparent)',
            }}
          >
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {/* «Seguir aquí» no estaba en el encargo —que pedía dos
              opciones— y se deja igualmente: sin ella, un clic por error
              en el menú obliga a guardar o a descartar, y descartar no
              tiene vuelta atrás. Va en tercer lugar y sin relieve. */}
          <button
            type="button"
            onClick={onQuedarse}
            disabled={guardando}
            className="rounded-md px-3 py-2 text-sm font-medium text-muted hover:text-ink disabled:opacity-60"
          >
            Seguir aquí
          </button>
          <button
            type="button"
            onClick={onAbandonar}
            disabled={guardando}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
          >
            Abandonar
          </button>
          <button
            type="button"
            onClick={onGuardar}
            disabled={guardando}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
