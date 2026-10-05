/**
 * Panel super-administrador — gestión de clínicas.
 *
 * Solo accesible para usuarios con el rol `super_admin` en Keycloak.
 * Permite crear clínicas y asignarles su primer usuario administrador.
 *
 * La API (POST /api/superadmin/clinicas/:id/admin) crea el usuario en
 * Keycloak con el rol `admin_clinica` y le envía el correo de activación
 * para que establezca su contraseña — sin intervención manual.
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import {
  crearAdminClinica,
  crearClinica as crearClinicaApi,
  getClinicas,
  type Clinica,
} from '../../api/superadmin'

const control =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-primary'

const btnPrimario =
  'rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60'

const btnSecundario =
  'rounded-md border border-border px-4 py-2 text-sm text-ink hover:bg-surface-2 disabled:opacity-60'

export function ClinicasPage() {
  const [clinicas, setClinicas] = useState<Clinica[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Formulario nueva clínica ──────────────────────────────────────
  const [nombreClinica, setNombreClinica] = useState('')
  const [paisClinica, setPaisClinica] = useState('')
  const [cargandoClinica, setCargandoClinica] = useState(false)
  const [errorClinica, setErrorClinica] = useState<string | null>(null)

  // ── Panel de asignación de admin ─────────────────────────────────
  const [clinicaSeleccionada, setClinicaSeleccionada] = useState<Clinica | null>(null)
  const [nombreAdmin, setNombreAdmin] = useState('')
  const [correoAdmin, setCorreoAdmin] = useState('')
  const [cargandoAdmin, setCargandoAdmin] = useState(false)
  const [errorAdmin, setErrorAdmin] = useState<string | null>(null)
  const [exitoAdmin, setExitoAdmin] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setClinicas(await getClinicas())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cargar la lista de clínicas')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function crearClinica() {
    if (cargandoClinica || nombreClinica.trim() === '' || paisClinica.trim() === '') return
    setCargandoClinica(true)
    setErrorClinica(null)
    try {
      await crearClinicaApi({
        nombre_comercial: nombreClinica.trim(),
        pais: paisClinica.trim(),
      })
      setNombreClinica('')
      setPaisClinica('')
      await cargar()
    } catch (e) {
      setErrorClinica(e instanceof ApiError ? e.message : 'No se pudo crear la clínica')
    } finally {
      setCargandoClinica(false)
    }
  }

  async function crearAdmin() {
    if (!clinicaSeleccionada || cargandoAdmin || nombreAdmin.trim() === '' || correoAdmin.trim() === '') return
    setCargandoAdmin(true)
    setErrorAdmin(null)
    setExitoAdmin(null)
    try {
      await crearAdminClinica(clinicaSeleccionada.id, {
        nombre: nombreAdmin.trim(),
        correo: correoAdmin.trim(),
      })
      setNombreAdmin('')
      setCorreoAdmin('')
      setExitoAdmin(
        `Usuario administrador creado. Se envió un correo a ${correoAdmin.trim()} para que establezca su contraseña.`,
      )
    } catch (e) {
      setErrorAdmin(e instanceof ApiError ? e.message : 'No se pudo crear el administrador')
    } finally {
      setCargandoAdmin(false)
    }
  }

  function abrirAdmin(c: Clinica) {
    setClinicaSeleccionada(c)
    setNombreAdmin('')
    setCorreoAdmin('')
    setErrorAdmin(null)
    setExitoAdmin(null)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Clínicas</h1>
        <p className="text-sm text-muted">
          Panel de plataforma. Solo visible para el super-administrador de NutriSmart.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      )}

      {/* Lista de clínicas */}
      {clinicas === null || cargando ? (
        <div className="h-32 animate-pulse rounded-lg bg-surface-2" />
      ) : clinicas.length === 0 ? (
        <p className="text-sm text-muted">No hay clínicas registradas todavía.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Nombre</th>
                <th className="px-4 py-2 font-medium">País</th>
                <th className="px-4 py-2 font-medium">Creada</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clinicas.map((c) => (
                <tr key={c.id} className={clinicaSeleccionada?.id === c.id ? 'bg-surface-2' : ''}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-ink">{c.nombre_comercial}</p>
                    {c.nombre_fiscal && (
                      <p className="text-xs text-muted">{c.nombre_fiscal}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{c.pais}</td>
                  <td className="px-4 py-2.5 text-muted">
                    {new Date(c.created_at).toLocaleDateString('es-CR', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => abrirAdmin(c)}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Crear admin
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Panel de creación de admin de clínica */}
      {clinicaSeleccionada && (
        <section className="max-w-xl space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">
                Crear administrador para {clinicaSeleccionada.nombre_comercial}
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                Se crea el usuario en Keycloak con rol <code>admin_clinica</code> y se le envía un
                correo para que establezca su contraseña.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setClinicaSeleccionada(null)}
              className="ml-4 shrink-0 text-xs text-muted hover:text-ink"
            >
              Cancelar
            </button>
          </div>

          {errorAdmin && (
            <p role="alert" className="text-xs" style={{ color: 'var(--status-critical)' }}>
              {errorAdmin}
            </p>
          )}
          {exitoAdmin && (
            <p role="status" className="text-xs" style={{ color: 'var(--status-normal)' }}>
              {exitoAdmin}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              value={nombreAdmin}
              maxLength={150}
              onChange={(e) => setNombreAdmin(e.target.value)}
              placeholder="Nombre y apellidos"
              aria-label="Nombre del administrador"
              className={control}
            />
            <input
              type="email"
              value={correoAdmin}
              maxLength={150}
              onChange={(e) => setCorreoAdmin(e.target.value)}
              placeholder="admin@clinica.cr"
              aria-label="Correo del administrador"
              className={control}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void crearAdmin()}
              disabled={cargandoAdmin || nombreAdmin.trim() === '' || correoAdmin.trim() === ''}
              className={btnPrimario}
            >
              {cargandoAdmin ? 'Creando…' : 'Crear administrador'}
            </button>
            <button
              type="button"
              onClick={() => setClinicaSeleccionada(null)}
              className={btnSecundario}
            >
              Cancelar
            </button>
          </div>
        </section>
      )}

      {/* Formulario nueva clínica */}
      <section className="max-w-xl space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-ink">Registrar nueva clínica</h2>

        {errorClinica && (
          <p role="alert" className="text-xs" style={{ color: 'var(--status-critical)' }}>
            {errorClinica}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <input
            type="text"
            value={nombreClinica}
            maxLength={200}
            onChange={(e) => setNombreClinica(e.target.value)}
            placeholder="Nombre comercial"
            aria-label="Nombre de la clínica"
            className={control}
          />
          <input
            type="text"
            value={paisClinica}
            maxLength={100}
            onChange={(e) => setPaisClinica(e.target.value)}
            placeholder="País (ej: Costa Rica)"
            aria-label="País"
            className={control}
          />
        </div>

        <button
          type="button"
          onClick={() => void crearClinica()}
          disabled={cargandoClinica || nombreClinica.trim() === '' || paisClinica.trim() === ''}
          className={btnPrimario}
        >
          {cargandoClinica ? 'Creando…' : 'Crear clínica'}
        </button>
      </section>
    </div>
  )
}
