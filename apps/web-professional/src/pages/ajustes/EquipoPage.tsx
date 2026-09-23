/**
 * El equipo de la clínica — GAM-02.
 *
 * Dos cosas que esta pantalla tiene que decir en voz alta, porque si no
 * el administrador se lleva una sorpresa:
 *
 * **Dar de alta aquí no crea la cuenta.** La cuenta la crea el
 * administrador de Keycloak. Por eso el alta nace como «invitación
 * pendiente» y no como «activo»: decir «activo» sería afirmar que ya
 * puede entrar, y no puede.
 *
 * **Ascender a administrador aquí no basta.** El acceso lo concede el rol
 * en Keycloak; esta columna puede quitar pero nunca dar. Degradar surte
 * efecto de inmediato; ascender necesita además el rol en Keycloak.
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError, apiGet, apiPatch, apiPost } from '../../api/client'

interface Miembro {
  id: string
  nombre: string
  correo: string | null
  colegiatura: string | null
  rol: 'admin_clinica' | 'nutricionista'
  estado: 'activo' | 'invitacion_pendiente' | 'inactivo'
  tieneCuenta: boolean
  pacientes: number
  citas30d: number
}

const ROL: Record<string, string> = {
  admin_clinica: 'Administrador',
  nutricionista: 'Nutricionista',
}

const ESTADO: Record<string, { texto: string; token: string }> = {
  activo: { texto: 'Activo', token: '--status-normal' },
  invitacion_pendiente: { texto: 'Sin cuenta todavía', token: '--status-alert' },
  inactivo: { texto: 'Dado de baja', token: '--muted' },
}

const control =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-primary'

export function EquipoPage() {
  const [equipo, setEquipo] = useState<Miembro[] | null>(null)
  const [nombre, setNombre] = useState('')
  const [correo, setCorreo] = useState('')
  const [colegiatura, setColegiatura] = useState('')
  const [rol, setRol] = useState<'admin_clinica' | 'nutricionista'>('nutricionista')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Baja pendiente de decidir a quién pasan los pacientes. */
  const [reasignando, setReasignando] = useState<{ m: Miembro; cuantos: number } | null>(null)
  const [destino, setDestino] = useState('')

  const cargar = useCallback(async () => {
    try {
      setEquipo(await apiGet<Miembro[]>('/api/admin/profesionales'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cargar el equipo')
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function darDeAlta() {
    if (ocupado || nombre.trim() === '' || correo.trim() === '') return
    setOcupado(true)
    setError(null)
    try {
      await apiPost('/api/admin/profesionales', {
        nombre: nombre.trim(),
        correo: correo.trim(),
        rol,
        ...(colegiatura.trim() !== '' ? { colegiatura: colegiatura.trim() } : {}),
      })
      setNombre('')
      setCorreo('')
      setColegiatura('')
      setRol('nutricionista')
      await cargar()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo dar de alta')
    } finally {
      setOcupado(false)
    }
  }

  async function cambiar(m: Miembro, cambios: Record<string, unknown>) {
    setOcupado(true)
    setError(null)
    try {
      await apiPatch(`/api/admin/profesionales/${m.id}`, cambios)
      setReasignando(null)
      setDestino('')
      await cargar()
    } catch (e) {
      // El servidor puede pedir a quién pasan los pacientes. No es un
      // error del administrador: es una pregunta.
      if (e instanceof ApiError && e.codigo === 'tiene_pacientes') {
        setReasignando({ m, cuantos: m.pacientes })
      } else {
        setError(e instanceof ApiError ? e.message : 'No se pudo cambiar')
      }
    } finally {
      setOcupado(false)
    }
  }

  const candidatos = (equipo ?? []).filter(
    (x) => x.estado === 'activo' && x.id !== reasignando?.m.id,
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Equipo</h1>
        <p className="text-sm text-muted">Quién trabaja en la clínica y con qué permisos.</p>
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      )}

      {/* La pregunta de reasignación, cuando el servidor la pide. */}
      {reasignando && (
        <section
          className="rounded-lg border bg-surface p-5 shadow-sm"
          style={{ borderColor: 'var(--status-alert)' }}
        >
          <h2 className="text-sm font-semibold text-ink">
            {reasignando.m.nombre} tiene {reasignando.cuantos}{' '}
            {reasignando.cuantos === 1 ? 'paciente' : 'pacientes'} a su cargo
          </h2>
          <p className="mt-1 text-sm text-muted">
            Si le das de baja sin pasarlos a otro profesional, esos pacientes dejan de aparecer
            en la agenda y en el monitoreo de todo el mundo menos del administrador.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              aria-label="Pasar los pacientes a"
              className="min-w-[14rem] rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
            >
              <option value="">Pasar los pacientes a…</option>
              {candidatos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                void cambiar(reasignando.m, { estado: 'inactivo', reasignarA: destino })
              }
              disabled={ocupado || destino === ''}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
            >
              Dar de baja y pasar
            </button>
            <button
              type="button"
              onClick={() => setReasignando(null)}
              className="text-sm text-muted hover:text-ink"
            >
              Cancelar
            </button>
          </div>
        </section>
      )}

      {equipo === null ? (
        <div className="h-48 animate-pulse rounded-lg bg-surface-2" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Profesional</th>
                <th className="px-4 py-2 font-medium">Permisos</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium">Pacientes</th>
                <th className="px-4 py-2 font-medium">Citas (30 d)</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {equipo.map((m) => {
                const e = ESTADO[m.estado]!
                return (
                  <tr key={m.id}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-ink">{m.nombre}</p>
                      <p className="text-xs text-muted">
                        {m.correo}
                        {m.colegiatura && ` · ${m.colegiatura}`}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={m.rol}
                        disabled={ocupado || m.estado === 'inactivo'}
                        onChange={(ev) => void cambiar(m, { rol: ev.target.value })}
                        aria-label={`Permisos de ${m.nombre}`}
                        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink disabled:opacity-50"
                      >
                        {Object.entries(ROL).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="rounded-pill px-2 py-0.5 text-xs font-medium"
                        style={{
                          color: `var(${e.token})`,
                          backgroundColor: `color-mix(in srgb, var(${e.token}) 14%, transparent)`,
                        }}
                      >
                        {e.texto}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-ink">{m.pacientes}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted">{m.citas30d}</td>
                    <td className="px-4 py-2.5 text-right">
                      {m.estado === 'inactivo' ? (
                        <button
                          type="button"
                          onClick={() => void cambiar(m, { estado: 'activo' })}
                          disabled={ocupado}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Reactivar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void cambiar(m, { estado: 'inactivo' })}
                          disabled={ocupado}
                          className="text-xs text-muted hover:text-ink"
                        >
                          Dar de baja
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <section className="max-w-2xl space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-ink">Dar de alta a alguien</h2>
        {/* Lo que este formulario NO hace. Decirlo aquí ahorra el
            «lo di de alta y no puede entrar». */}
        <p className="-mt-1 text-xs text-muted">
          Esto crea su ficha en la clínica, no su cuenta de acceso. Esa la crea el administrador
          de Keycloak; al entrar por primera vez, su usuario queda vinculado a esta ficha.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <input
            type="text"
            value={nombre}
            maxLength={150}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre y apellidos"
            aria-label="Nombre"
            className={control}
          />
          <input
            type="email"
            value={correo}
            maxLength={150}
            onChange={(e) => setCorreo(e.target.value)}
            placeholder="correo@clinica.cr"
            aria-label="Correo"
            className={control}
          />
          <input
            type="text"
            value={colegiatura}
            maxLength={50}
            onChange={(e) => setColegiatura(e.target.value)}
            placeholder="Colegiatura (opcional)"
            aria-label="Colegiatura"
            className={control}
          />
          <select
            value={rol}
            onChange={(e) => setRol(e.target.value as typeof rol)}
            aria-label="Permisos"
            className={control}
          >
            <option value="nutricionista">Nutricionista</option>
            <option value="admin_clinica">Administrador</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => void darDeAlta()}
          disabled={ocupado || nombre.trim() === '' || correo.trim() === ''}
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          Dar de alta
        </button>
      </section>

      <p className="text-xs text-muted">
        Quitar permisos de administrador surte efecto de inmediato. Concederlos necesita además
        el rol en Keycloak: sin él, la persona seguirá entrando como nutricionista.
      </p>
    </div>
  )
}
