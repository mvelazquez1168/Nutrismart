# r31-claudecode-prompt.md
# NutriSmart — Rebanada 31
# LOGIN-01: Pantalla de login propia + logo de clínica en navbar + selector de paletas curadas

## Contexto de continuidad

SaaS multi-tenant de nutrición clínica. Monorepo: `apps/api` (Fastify),
`apps/web-professional` (Vite + React, puerto 5173), `apps/web-patient` (Vite + React, puerto 5175).

**Reglas permanentes:**

1. Framework del servidor: **Fastify** (nunca Express).
2. Multi-tenancy profesional: `request.auth.tenantId` → `clinica_id`.
3. Borrado suave únicamente. Nunca `DELETE` físico.
4. Gráficas: **SVG puro**. Cero librerías de charting externas.
5. Colores: **CSS vars / tokens Tailwind**. Nunca hex en línea en JSX.
6. `TIMESTAMPTZ` → JSON: valor crudo del driver `pg`. Nunca `to_char(…OF)`.
7. Columna fecha de cita: **`cita.inicio`** (TIMESTAMPTZ único, no `fecha` + `hora_inicio`); duración: **`cita.duracion_minutos`** (no `duracion_min`).
8. `paciente.estado` y `profesional.estado` — enum texto, **NO booleano**. No usar `activo = true/false`.
9. `paciente.sexo_biologico` (no `sexo`).
10. `registro_metrica.medido_en` (no `fecha`).
11. `paciente.nutricionista_id` (no `profesional_id`).
12. Peso clínico: `medicion_antropometrica`. `registro_metrica` = báscula de casa. Fuentes distintas.
13. White-label en tabla **`brand_config`** (desde R6). No añadir campos de color a `clinica`.
14. `profesional.correo` (no `email`). `profesional.rol` = `admin_clinica` (no `admin`).

---

## Paso 0 — Leer antes de tocar nada

```bash
# 1. Cómo se inicializa Keycloak en cada frontend
grep -rn "keycloak\.init\|onLoad\|check-sso\|login-required" \
  apps/web-professional/src apps/web-patient/src

# 2. Componente Navbar / Layout principal en web-professional
find apps/web-professional/src -name "Navbar*" -o -name "Layout*" -o -name "Sidebar*" | head -10
# Leer el que maneje la barra superior / encabezado

# 3. Pantalla de configuración de marca (donde están los inputs de color actuales)
find apps/web-professional/src -name "Marca*" -o -name "Brand*" | head -5
# Leer ese archivo — entender la estructura actual del formulario de colores

# 4. Esquema real de brand_config
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'brand_config'
ORDER BY ordinal_position;

# 5. ¿Existe ya silent-check-sso.html?
ls apps/web-professional/public/ apps/web-patient/public/

# 6. Rutas del router en ambas apps — entender qué se renderiza cuando el usuario
#    no está autenticado
find apps/web-professional/src apps/web-patient/src \
  -name "App.tsx" -o -name "router.tsx" -o -name "routes.tsx" | head -6
# Leer esos archivos
```

Adapta todo lo que sigue a lo que encuentres en el Paso 0.

---

## Parte A — Pantalla de login propia (ambas apps)

### Por qué hace falta `check-sso`

Con `onLoad: 'login-required'`, Keycloak redirige al usuario a su propia pantalla antes de que
el navegador haya renderizado siquiera el `<div id="root">`. No hay oportunidad de mostrar una
pantalla propia. Con `onLoad: 'check-sso'`, la app arranca, comprueba silenciosamente si hay
sesión activa, y solo si no la hay renderiza la `LoginPage` personalizada con un botón que
llama a `keycloak.login()`.

### A1 — silent-check-sso.html

Crear en `apps/web-professional/public/` y en `apps/web-patient/public/`:

```html
<!DOCTYPE html>
<html>
  <head><title></title></head>
  <body>
    <script>
      parent.postMessage(location.href, location.origin)
    </script>
  </body>
</html>
```

### A2 — Inicialización de Keycloak

Busca donde se llama a `keycloak.init(…)` en cada app. Cambia (o añade) las opciones:

```typescript
await keycloak.init({
  onLoad:                    'check-sso',
  silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
  pkceMethod:                'S256',
  checkLoginIframe:          false,   // evita problemas de CORS en mobile/iframe
})
```

Después del `init`, si `keycloak.authenticated` es `false`, el árbol de rutas debe renderizar
`<LoginPage />` en lugar del contenido protegido. Si es `true`, flujo normal.

### A3 — LoginPage (crear en ambas apps)

Ruta del archivo:
- `apps/web-professional/src/pages/LoginPage.tsx`
- `apps/web-patient/src/pages/LoginPage.tsx`

Layout: split-screen en pantallas ≥ 768px; columna única en móvil.

```tsx
import { keycloak } from '../lib/keycloak'   // ajusta la ruta según la app

const LOGIN_IMAGE = import.meta.env.VITE_LOGIN_IMAGE_URL as string | undefined

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col md:flex-row">

      {/* Panel izquierdo — imagen de fondo */}
      <div
        className="hidden md:block md:w-3/5 bg-[var(--color-primary)] bg-cover bg-center"
        style={LOGIN_IMAGE ? { backgroundImage: `url(${LOGIN_IMAGE})` } : undefined}
        aria-hidden="true"
      />

      {/* Panel derecho — formulario */}
      <div className="flex flex-1 flex-col items-center justify-center
                      px-8 py-12 bg-[var(--color-bg)]">

        {/* Logo de plataforma */}
        <div className="mb-8 flex flex-col items-center gap-2">
          <span className="text-3xl font-bold tracking-tight text-[var(--color-primary)]">
            NutriSmart
          </span>
          <span className="text-sm text-[var(--color-muted)]">
            Gestión clínica inteligente
          </span>
        </div>

        <div className="w-full max-w-sm space-y-4">
          <p className="text-center text-[var(--color-text)]">
            Inicia sesión para continuar
          </p>

          <button
            onClick={() => keycloak.login()}
            className="w-full rounded-xl bg-[var(--color-primary)] px-6 py-3
                       text-base font-semibold text-white shadow
                       hover:opacity-90 transition-opacity"
          >
            Iniciar sesión
          </button>
        </div>

        <p className="mt-12 text-xs text-[var(--color-muted)]">
          © {new Date().getFullYear()} NutriSmart
        </p>
      </div>
    </div>
  )
}
```

### A4 — Variable de entorno

En `apps/web-professional/.env` y `apps/web-patient/.env` (crear si no existe):

```
# URL de la imagen del panel izquierdo de login
# Dejar vacío para mostrar el color primario como fondo
VITE_LOGIN_IMAGE_URL=
```

En `.env.local` (para pruebas locales) puede ponerse una URL pública o dejarse vacío.

### A5 — Integración en el árbol de rutas

Busca el punto de entrada donde se decide si mostrar la app o el login.
La lógica exacta depende de cómo esté construido el router; la idea general:

```tsx
// Pseudo-código — adapta a la estructura real
function App() {
  if (!keycloak.authenticated) {
    return <LoginPage />
  }
  return <AppRouter />   // el router normal con todas las rutas protegidas
}
```

Si el proyecto usa React Router con rutas `<PrivateRoute>` o similar, encaja `LoginPage`
en ese flujo sin duplicar lógica de guardado de ruta (`redirect_uri` ya lo maneja Keycloak
automáticamente al volver del login).

---

## Parte B — Logo de clínica en navbar

Después del login, el navbar debe mostrar el logo de la clínica del profesional autenticado.
El dato viene de `useYo()` que ya existe desde R28.

### B1 — Leer el tipo de retorno de useYo

El hook retorna los datos del profesional incluyendo información de la clínica.
Verifica si `useYo()` ya expone `clinica_logo_url`; si no, añádelo al endpoint
`GET /api/profesional/yo` y al tipo TypeScript.

En el backend (`apps/api/src/profesional/yo.ts`), el SELECT debe incluir:

```sql
SELECT
  p.*,
  c.nombre       AS clinica_nombre,
  b.logo_url     AS clinica_logo_url
FROM profesional p
JOIN clinica c     ON c.id = p.clinica_id
LEFT JOIN brand_config b ON b.clinica_id = p.clinica_id
WHERE p.keycloak_user_id = $1
```

(Adapta según la estructura real del archivo.)

### B2 — Logo en el componente Navbar

En el Navbar o Layout principal de `web-professional`, añade la sección del logo de clínica.

```tsx
// Dentro del componente Navbar — ajusta la posición y estructura real
import { useYo } from '../hooks/useYo'

// En el render:
const { data: yo } = useYo()

// En el JSX, en el extremo izquierdo/superior del navbar:
{yo?.clinica_logo_url ? (
  <img
    src={yo.clinica_logo_url}
    alt={yo.clinica_nombre ?? 'Logo de clínica'}
    className="h-8 w-auto object-contain"
  />
) : (
  <span className="text-sm font-semibold text-[var(--color-text)]">
    {yo?.clinica_nombre ?? ''}
  </span>
)}
```

Posición: izquierda del navbar, antes de los ítems de navegación.
Tamaño máximo: `h-8` (32 px de alto). Ancho libre (`w-auto`).

---

## Parte C — Selector de paletas curadas (reemplaza picker libre)

### Contexto

La pantalla de configuración de marca (`/ajustes/marca` o similar) actualmente muestra
`<input type="color">` para `color_primario` y `color_secundario`. Esto permite cualquier
color, incluidos los que no pasan WCAG AA. Se reemplaza por un selector de paletas prediseñadas.

Internamente `brand_config` sigue guardando los mismos campos (`color_primario`, `color_secundario`).
La diferencia es que los valores llegan de una lista fija verificada.

### C1 — Constante de paletas (archivo compartido)

Crear `apps/web-professional/src/lib/paletas.ts`:

```typescript
export interface Paleta {
  id:          string
  nombre:      string
  primario:    string   // hex, WCAG AA verificado con texto blanco
  secundario:  string   // hex, WCAG AA verificado con texto blanco
}

// Todas verificadas con contraste ≥ 4.5:1 contra texto blanco
export const PALETAS: Paleta[] = [
  { id: 'clasico-salud',     nombre: 'Clásico Salud',     primario: '#15803d', secundario: '#0369a1' },
  { id: 'indigo-clinico',    nombre: 'Índigo Clínico',    primario: '#4338ca', secundario: '#0e7490' },
  { id: 'teal-moderno',      nombre: 'Teal Moderno',      primario: '#0f766e', secundario: '#7c3aed' },
  { id: 'azul-oceano',       nombre: 'Azul Océano',       primario: '#1d4ed8', secundario: '#047857' },
  { id: 'bosque-profundo',   nombre: 'Bosque Profundo',   primario: '#166534', secundario: '#1e40af' },
  { id: 'violeta-suave',     nombre: 'Violeta Suave',     primario: '#6d28d9', secundario: '#0f766e' },
  { id: 'rosa-profesional',  nombre: 'Rosa Profesional',  primario: '#be185d', secundario: '#0369a1' },
  { id: 'naranja-vital',     nombre: 'Naranja Vital',     primario: '#c2410c', secundario: '#15803d' },
  { id: 'pizarra-moderna',   nombre: 'Pizarra Moderna',   primario: '#1e40af', secundario: '#7c3aed' },
  { id: 'cobre-esmeralda',   nombre: 'Cobre y Esmeralda', primario: '#92400e', secundario: '#065f46' },
]

/** Devuelve la paleta cuyo primario coincide, o undefined si no coincide ninguna. */
export function detectarPaleta(primario: string): Paleta | undefined {
  return PALETAS.find(p => p.primario.toLowerCase() === primario?.toLowerCase())
}
```

### C2 — Componente PaletaSelector

Crear `apps/web-professional/src/components/PaletaSelector.tsx`:

```tsx
import { PALETAS, detectarPaleta, type Paleta } from '../lib/paletas'

interface Props {
  primarioActual:    string
  onSeleccionar:     (paleta: Paleta) => void
}

export function PaletaSelector({ primarioActual, onSeleccionar }: Props) {
  const seleccionada = detectarPaleta(primarioActual)

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-[var(--color-text)]">
        Paleta de colores
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {PALETAS.map(paleta => {
          const activa = seleccionada?.id === paleta.id

          return (
            <button
              key={paleta.id}
              type="button"
              onClick={() => onSeleccionar(paleta)}
              className={[
                'rounded-xl border-2 p-3 text-left transition-all',
                activa
                  ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)] ring-offset-2'
                  : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/50',
              ].join(' ')}
              aria-pressed={activa}
              aria-label={paleta.nombre}
            >
              {/* Swatches de color */}
              <div className="mb-2 flex gap-1">
                <span
                  className="h-6 w-6 rounded-full"
                  style={{ backgroundColor: paleta.primario }}
                  aria-hidden="true"
                />
                <span
                  className="h-6 w-6 rounded-full"
                  style={{ backgroundColor: paleta.secundario }}
                  aria-hidden="true"
                />
              </div>
              <span className="text-xs font-medium text-[var(--color-text)]">
                {paleta.nombre}
              </span>
              {activa && (
                <span className="mt-1 block text-xs text-[var(--color-primary)]">
                  Activa
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

### C3 — Integrar PaletaSelector en la pantalla de marca

En el archivo de configuración de marca (el que encontraste en el Paso 0):

1. **Importa** `PaletaSelector` y `PALETAS`.
2. **Reemplaza** los `<input type="color">` por `<PaletaSelector>`.
3. Al seleccionar una paleta, actualiza el estado local con `primario` y `secundario`.
4. El botón "Guardar" envía esos valores al API como antes — no cambia nada en el backend.

Esquema de la lógica de estado (adapta al código existente):

```tsx
// En el componente de la pantalla de marca:
const [primario,   setPrimario]   = useState(brandConfig.color_primario   ?? '#15803d')
const [secundario, setSecundario] = useState(brandConfig.color_secundario ?? '#0369a1')

function handlePaleta(paleta: Paleta) {
  setPrimario(paleta.primario)
  setSecundario(paleta.secundario)
  // Opcional: aplicar inmediatamente el preview actualizando las CSS vars
  document.documentElement.style.setProperty('--color-primary',   paleta.primario)
  document.documentElement.style.setProperty('--color-secondary',  paleta.secundario)
}

// En el JSX, donde estaban los <input type="color">:
<PaletaSelector
  primarioActual={primario}
  onSeleccionar={handlePaleta}
/>

// El botón guardar sigue enviando { color_primario: primario, color_secundario: secundario }
```

---

## Sin migraciones nuevas

`brand_config` ya tiene `color_primario` y `color_secundario` desde R6.
`VITE_LOGIN_IMAGE_URL` es una variable de entorno del frontend — no toca la base de datos.
El logo en navbar usa datos que ya devuelve `GET /api/profesional/yo` (quizás añadiendo
`clinica_logo_url` al SELECT si no estaba).

---

## Lista de verificación

```
[ ] silent-check-sso.html existe en public/ de ambas apps
[ ] keycloak.init usa onLoad: 'check-sso' en ambas apps
[ ] Sin autenticar → se ve LoginPage, no el dashboard ni un error
[ ] Clic en "Iniciar sesión" → redirige al login de Keycloak → vuelve autenticado
[ ] Ya autenticado → silent check-sso funciona, no pide login otra vez
[ ] Panel izquierdo muestra la imagen de VITE_LOGIN_IMAGE_URL si está definida
[ ] Panel izquierdo muestra el color primario como fondo si la variable está vacía
[ ] En móvil: layout de columna única, panel de imagen oculto
[ ] Navbar muestra el logo de la clínica (brand_config.logo_url) tras el login
[ ] Si la clínica no tiene logo, muestra el nombre de la clínica en texto
[ ] Logo acotado a h-8 (32px alto); ancho libre sin deformar
[ ] Pantalla de marca: los input type="color" han sido reemplazados por PaletaSelector
[ ] PaletaSelector muestra 10 paletas en grid
[ ] La paleta actualmente guardada en brand_config aparece marcada al abrir la pantalla
[ ] Al seleccionar una paleta: preview inmediato en la página (CSS vars)
[ ] Guardar → brand_config se actualiza con los colores de la paleta elegida
[ ] Cambiar de paleta y refrescar → la paleta correcta queda marcada como activa
```
