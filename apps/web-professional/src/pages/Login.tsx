/**
 * Pantalla de acceso — LOGIN-01.
 *
 * Lo que se ve antes de entrar. Hasta ahora era la pantalla de Keycloak,
 * que es genérica y no lleva la marca de nadie.
 *
 * Lo que NO puede hacer, y conviene tenerlo claro: aquí no se piden
 * credenciales. El usuario y la contraseña se escriben en Keycloak, que
 * es quien los verifica. Un formulario propio que las recogiera para
 * mandárselas después convertiría esta página en un sitio que ve las
 * contraseñas de todo el mundo — justo lo que el flujo de código de
 * autorización evita.
 *
 * La marca de la clínica no está disponible todavía: sin sesión no hay
 * `tenant_id`, así que no se sabe de qué clínica es quien mira. Se pinta
 * la identidad de la plataforma, con los colores del design system.
 */
import { entrar } from '../auth/keycloak'

const IMAGEN = import.meta.env.VITE_LOGIN_IMAGE_URL as string | undefined

export function Login() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Panel izquierdo. Solo desde tablet: en un móvil quitaría sitio
          a lo único que importa, que es el botón. */}
      <div
        aria-hidden="true"
        className="hidden bg-primary bg-cover bg-center md:block md:w-3/5"
        style={IMAGEN ? { backgroundImage: `url(${IMAGEN})` } : undefined}
      />

      <div className="flex flex-1 flex-col items-center justify-center bg-background px-8 py-12">
        <div className="mb-8 flex flex-col items-center gap-1">
          <span className="text-3xl font-bold tracking-tight text-primary">NutriSmart</span>
          <span className="text-sm text-muted">Gestión clínica</span>
        </div>

        <div className="w-full max-w-sm space-y-4">
          <p className="text-center text-sm text-ink">
            Entra con la cuenta que te dio tu clínica.
          </p>

          <button
            type="button"
            onClick={entrar}
            className="w-full rounded-md bg-primary px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-primary-hover"
          >
            Iniciar sesión
          </button>

          {/* Quien no tiene cuenta no puede crearla: las da el
              administrador de la clínica (GAM-02). Decirlo evita que
              alguien busque un enlace de registro que no existe. */}
          <p className="text-center text-xs text-muted">
            ¿No tienes cuenta? Pídesela al administrador de tu clínica.
          </p>
        </div>

        <p className="mt-12 text-xs text-muted">
          © {new Date().getFullYear()} NutriSmart
        </p>
      </div>
    </div>
  )
}
