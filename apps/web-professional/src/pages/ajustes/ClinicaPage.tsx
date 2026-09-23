/**
 * Datos de la clínica — GAM-01.
 *
 * Aquí NO están los colores ni el logo: eso vive en /ajustes/marca desde
 * la Rebanada 6, con su comprobación de contraste. Duplicarlo dejaría dos
 * sitios donde cambiar lo mismo y ninguna pantalla sabría cuál gana. Se
 * enlaza en vez de repetirse.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, apiGet, apiPatch } from '../../api/client'

interface Clinica {
  id: string
  nombreComercial: string
  nombreFiscal: string | null
  pais: string | null
  subdominio: string | null
  direccion: string | null
  telefono: string | null
  sitioWeb: string | null
  zonaHoraria: string
}

const control =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-primary'

function Campo({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: string
  ayuda?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{etiqueta}</label>
      {children}
      {ayuda && <p className="mt-1 text-xs text-muted">{ayuda}</p>}
    </div>
  )
}

export function ClinicaPage() {
  const [datos, setDatos] = useState<Clinica | null>(null)
  const [zonas, setZonas] = useState<string[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiGet<Clinica>('/api/admin/clinica')
      .then(setDatos)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar'))
    apiGet<string[]>('/api/admin/zonas-horarias')
      .then(setZonas)
      .catch(() => {
        /* sin la lista se deja el valor actual, que es válido */
      })
  }, [])

  function set<K extends keyof Clinica>(k: K, v: Clinica[K]) {
    setDatos((d) => (d ? { ...d, [k]: v } : d))
    setAviso(null)
  }

  async function guardar() {
    if (!datos || ocupado) return
    setOcupado(true)
    setError(null)
    setAviso(null)
    try {
      await apiPatch('/api/admin/clinica', {
        nombreComercial: datos.nombreComercial,
        direccion: datos.direccion ?? null,
        telefono: datos.telefono ?? null,
        sitioWeb: datos.sitioWeb ?? null,
        zonaHoraria: datos.zonaHoraria,
      })
      setAviso('Guardado')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar')
    } finally {
      setOcupado(false)
    }
  }

  if (error && !datos) {
    return (
      <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
        {error}
      </p>
    )
  }
  if (!datos) return <div className="h-64 animate-pulse rounded-lg bg-surface-2" />

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Datos de la clínica</h1>
        <p className="text-sm text-muted">Lo que aparece en informes y correos a pacientes.</p>
      </div>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <Campo etiqueta="Nombre comercial" ayuda="Es el que ven los pacientes.">
          <input
            type="text"
            value={datos.nombreComercial}
            maxLength={150}
            onChange={(e) => set('nombreComercial', e.target.value)}
            className={control}
          />
        </Campo>

        {/* El nombre fiscal, el país y el subdominio no se editan aquí:
            los fija el operador de la plataforma al dar de alta la
            clínica y cambiarlos afecta a facturación y a la URL. */}
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['Nombre fiscal', datos.nombreFiscal],
            ['País', datos.pais],
            ['Subdominio', datos.subdominio],
          ].map(([et, v]) => (
            <Campo key={et as string} etiqueta={et as string}>
              <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">{v ?? '—'}</p>
            </Campo>
          ))}
        </div>
        <p className="-mt-1 text-xs text-muted">
          Estos tres los gestiona el operador de la plataforma.
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-ink">Contacto</h2>

        <Campo etiqueta="Dirección">
          <input
            type="text"
            value={datos.direccion ?? ''}
            maxLength={300}
            onChange={(e) => set('direccion', e.target.value)}
            placeholder="Calle, número, ciudad"
            className={control}
          />
        </Campo>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Teléfono">
            <input
              type="tel"
              value={datos.telefono ?? ''}
              maxLength={40}
              onChange={(e) => set('telefono', e.target.value)}
              placeholder="+506 0000-0000"
              className={control}
            />
          </Campo>
          <Campo etiqueta="Sitio web" ayuda="Tiene que empezar por https://">
            <input
              type="url"
              value={datos.sitioWeb ?? ''}
              maxLength={200}
              onChange={(e) => set('sitioWeb', e.target.value)}
              placeholder="https://…"
              className={control}
            />
          </Campo>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-ink">Zona horaria</h2>
        <select
          value={datos.zonaHoraria}
          onChange={(e) => set('zonaHoraria', e.target.value)}
          className={control}
        >
          {(zonas.length > 0 ? zonas : [datos.zonaHoraria]).map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
        {/* Honestidad sobre el alcance real: la columna se guarda, pero
            las consultas todavía escriben America/Costa_Rica a mano.
            Prometer que cambiarla mueve las agendas sería falso. */}
        <p className="text-xs text-muted">
          Queda registrada para cuando la plataforma opere en varios husos. Hoy las agendas y
          los recordatorios siguen usando la hora de Costa Rica.
        </p>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void guardar()}
          disabled={ocupado}
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          Guardar
        </button>
        {aviso && <span className="text-sm text-muted">{aviso}</span>}
        {error && (
          <span role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
            {error}
          </span>
        )}
      </div>

      <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-ink">Identidad visual</h2>
        <p className="mt-1 text-sm text-muted">
          El logo y los colores de la clínica se configuran en su propia pantalla, que además
          comprueba que el texto siga leyéndose sobre el color elegido.
        </p>
        <Link
          to="/ajustes/marca"
          className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
        >
          Ir a Marca →
        </Link>
      </section>
    </div>
  )
}
