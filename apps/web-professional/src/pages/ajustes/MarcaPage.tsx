/**
 * Identidad visual de la clínica (CLI-06).
 *
 * Solo la ve un admin_clinica. El guardado es en dos peticiones —los
 * campos por JSON y el logo por multipart— porque son cosas distintas:
 * cambiar un color no debe obligar a resubir la imagen, y borrar el
 * logo no debe tocar los colores.
 */
import { useEffect, useRef, useState } from 'react'
import { apiDelete, apiPut, apiUpload, API_BASE, ApiError } from '../../api/client'
import { Campo, claseControl } from '../../components/Campo'
import { useBrand, urlLogo, type Brand } from '../../contexts/BrandContext'

/** Mismos valores que tokens.css y que los DEFAULTS de la API. */
const DEFAULTS = {
  nombreApp: 'NutriSmart',
  colorPrimario: '#0e7c66',
  colorAcento: '#0ea5e9',
} as const

const MAX_LOGO_BYTES = 512 * 1024

/**
 * SVG no está: el logo se sirve inline desde el origen de la API, y un
 * SVG puede llevar <script> dentro. La API lo rechaza igualmente; esto
 * solo evita que el administrador elija un archivo que va a fallar.
 */
const TIPOS_ACEPTADOS = ['image/png', 'image/jpeg', 'image/webp']

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function MarcaPage() {
  const { brand, refrescar } = useBrand()

  const [nombre, setNombre] = useState(brand.nombreApp)
  const [primario, setPrimario] = useState(brand.colorPrimario)
  const [acento, setAcento] = useState(brand.colorAcento)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  /*
   * El formulario se siembra cuando llega la configuración, no en el
   * primer render: BrandProvider la pide de forma asíncrona, así que
   * al montar esta página `brand` todavía puede ser el valor por
   * defecto. Sin esto, abrir Configuración recién cargada la app
   * mostraría "NutriSmart" y el verde de fábrica sobre una clínica ya
   * personalizada — y guardar habría revertido su marca.
   */
  useEffect(() => {
    setNombre(brand.nombreApp)
    setPrimario(brand.colorPrimario)
    setAcento(brand.colorAcento)
    setLogoFile(null)
    setLogoPreview(null)
  }, [brand])

  const logoActual = urlLogo(brand, API_BASE)
  const logoMostrado = logoPreview ?? logoActual
  const nombreValido = nombre.trim().length > 0 && nombre.length <= 80
  const coloresValidos = HEX_RE.test(primario) && HEX_RE.test(acento)

  function elegirLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!TIPOS_ACEPTADOS.includes(file.type)) {
      setError('El logo debe ser PNG, JPEG o WebP.')
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError(`El logo no puede superar ${MAX_LOGO_BYTES / 1024} KB.`)
      return
    }

    setError(null)
    setOk(false)
    setLogoFile(file)

    const lector = new FileReader()
    lector.onload = (ev) => setLogoPreview(ev.target?.result as string)
    lector.readAsDataURL(file)
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!nombreValido || !coloresValidos) return

    setError(null)
    setOk(false)
    setGuardando(true)
    try {
      await apiPut<Brand>('/api/brand', {
        nombreApp: nombre.trim(),
        colorPrimario: primario,
        colorAcento: acento,
      })

      if (logoFile) {
        await apiUpload<Brand>('/api/brand/logo', logoFile, { metodo: 'PUT', campo: 'logo' })
      }

      // refrescar() reescribe los tokens en :root: el cambio se ve en
      // toda la app sin recargar.
      await refrescar()
      setOk(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar la identidad visual')
    } finally {
      setGuardando(false)
    }
  }

  async function borrarLogo() {
    setError(null)
    setOk(false)
    setGuardando(true)
    try {
      await apiDelete('/api/brand/logo')
      setLogoFile(null)
      setLogoPreview(null)
      if (fileRef.current) fileRef.current.value = ''
      await refrescar()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo eliminar el logo')
    } finally {
      setGuardando(false)
    }
  }

  async function restaurar() {
    if (!window.confirm('¿Restaurar el nombre, los colores y el logo por defecto?')) return

    setError(null)
    setOk(false)
    setGuardando(true)
    try {
      await apiPut<Brand>('/api/brand', DEFAULTS)
      await apiDelete('/api/brand/logo')
      if (fileRef.current) fileRef.current.value = ''
      await refrescar()
      setOk(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo restaurar la configuración')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink">Identidad visual</h1>
        <p className="mt-1 text-sm text-muted">
          Personaliza el nombre, el logo y los colores de la plataforma para tu clínica. Los colores
          de estado clínico y de las gráficas no cambian: se leen como un semáforo y deben significar
          lo mismo en todas las clínicas.
        </p>
      </div>

      <form onSubmit={guardar} className="space-y-6">
        <div className="space-y-5 rounded-lg border border-border bg-surface p-5 shadow-sm">
          <Campo
            id="nombre-app"
            etiqueta="Nombre de la aplicación"
            requerido
            {...(nombre.length > 0 && !nombreValido
              ? { error: 'Debe tener entre 1 y 80 caracteres' }
              : { ayuda: `${nombre.length}/80` })}
          >
            <input
              id="nombre-app"
              type="text"
              value={nombre}
              maxLength={80}
              onChange={(e) => setNombre(e.target.value)}
              className={claseControl(nombre.length > 0 && !nombreValido)}
            />
          </Campo>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectorColor
              id="color-primario"
              etiqueta="Color primario"
              ayuda="Botones, enlaces y elementos activos"
              valor={primario}
              onChange={setPrimario}
            />
            <SelectorColor
              id="color-acento"
              etiqueta="Color de acento"
              ayuda="Realces secundarios"
              valor={acento}
              onChange={setAcento}
            />
          </div>
        </div>

        {/* ---- Logo ---- */}
        <div className="space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-ink">Logo de la clínica</h2>

          <div className="flex items-center gap-4">
            {logoMostrado ? (
              <img
                src={logoMostrado}
                alt="Logo de la clínica"
                className="h-16 w-auto max-w-[10rem] rounded-md border border-border object-contain p-1"
              />
            ) : (
              <div className="flex h-16 w-32 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted">
                Sin logo
              </div>
            )}

            {brand.tieneLogo && !logoFile && (
              <button
                type="button"
                onClick={borrarLogo}
                disabled={guardando}
                className="text-sm font-medium text-[color:var(--status-critical)] underline disabled:opacity-60"
              >
                Eliminar logo
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-md border-2 border-dashed border-border p-4 text-center transition-colors hover:border-primary"
          >
            <input
              ref={fileRef}
              type="file"
              accept={TIPOS_ACEPTADOS.join(',')}
              onChange={elegirLogo}
              className="hidden"
            />
            <p className="text-sm text-ink">
              {logoFile ? logoFile.name : 'Haz clic para seleccionar un logo'}
            </p>
            <p className="mt-1 text-xs text-muted">
              PNG, JPEG o WebP · máximo {MAX_LOGO_BYTES / 1024} KB
            </p>
          </button>

          <p className="text-xs text-muted">
            SVG no se admite: puede contener código ejecutable y el logo se sirve directamente al
            navegador.
          </p>
        </div>

        {/* ---- Vista previa ---- */}
        <div className="overflow-hidden rounded-lg border border-border shadow-sm">
          <div className="flex items-center gap-3 p-4" style={{ backgroundColor: primario }}>
            {logoMostrado ? (
              <img src={logoMostrado} alt="" className="h-8 w-auto max-w-[6rem] object-contain" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white/30 text-xs font-bold text-white">
                {nombre.trim().charAt(0).toUpperCase() || 'N'}
              </span>
            )}
            <span className="truncate text-lg font-semibold text-white">
              {nombre.trim() || 'NutriSmart'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 bg-surface p-4">
            <span
              className="rounded-md px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: primario }}
            >
              Botón primario
            </span>
            <span
              className="rounded-md px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: acento }}
            >
              Acento
            </span>
            {/* Recordatorio visible de que el semáforo clínico no se
                re-tematiza: es la duda que llega siempre. */}
            <span className="badge-estado" style={{ ['--estado-color' as string]: 'var(--status-alert)' }}>
              Alerta (fijo)
            </span>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-[color:var(--status-critical)]"
          >
            {error}
          </p>
        )}
        {ok && (
          <p className="rounded-md border border-border bg-primary-tint p-3 text-sm text-primary">
            Identidad visual guardada.
          </p>
        )}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={restaurar}
            disabled={guardando}
            className="text-sm text-muted underline transition-colors hover:text-ink disabled:opacity-60"
          >
            Restaurar valores por defecto
          </button>
          <button
            type="submit"
            disabled={guardando || !nombreValido || !coloresValidos}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  )
}

function SelectorColor({
  id,
  etiqueta,
  ayuda,
  valor,
  onChange,
}: {
  id: string
  etiqueta: string
  ayuda: string
  valor: string
  onChange: (v: string) => void
}) {
  const invalido = valor.length > 0 && !HEX_RE.test(valor)

  return (
    <Campo
      id={id}
      etiqueta={etiqueta}
      {...(invalido ? { error: 'Debe ser #rrggbb' } : { ayuda })}
    >
      <div className="flex items-center gap-2">
        {/*
          El selector nativo solo entiende #rrggbb en minúsculas; si el
          texto de al lado no es válido todavía, se le da un color
          neutro para que no quede en negro y parezca un valor elegido.
        */}
        <input
          type="color"
          aria-label={`${etiqueta}: selector`}
          value={HEX_RE.test(valor) ? valor.toLowerCase() : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-border p-0.5"
        />
        <input
          id={id}
          type="text"
          value={valor}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          className={`${claseControl(invalido)} font-mono`}
        />
      </div>
    </Campo>
  )
}
