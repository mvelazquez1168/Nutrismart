# Rebanada 34 — Navbar y sidebar con color primario de clínica (APP-BRAND-01)

## Contexto

El design system ya define `--color-primary` y `--color-secondary` como variables CSS en `:root`, cargadas desde `brand_config` al iniciar sesión (vía el hook que consume `GET /api/profesional/yo`). Las paletas también usan este mismo mecanismo.

El problema: navbar (header superior) y sidebar (menú lateral izquierdo) de **ambas apps** tienen fondo blanco/gris neutro. Deben usar el color primario configurado por la clínica como fondo, con texto blanco sobre él.

No hay migración de base de datos. Solo cambios de presentación en los componentes React de ambas apps.

---

## Alcance

### `apps/web-professional`
- `src/components/Navbar.tsx` (o el archivo que renderiza el header superior)
- `src/components/Sidebar.tsx` (o el archivo que renderiza el menú lateral)
- Si el layout es un componente único, el archivo correspondiente (`Layout.tsx`, `AppShell.tsx`, o similar)

### `apps/web-patient`
- Mismos componentes equivalentes en la app del paciente

> Localiza los archivos reales con `grep -r "sidebar\|Sidebar\|navbar\|Navbar\|AppShell\|Layout" apps/web-professional/src/components --include="*.tsx" -l` antes de editar.

---

## Reglas de diseño a aplicar

### 1. Fondo con color primario

**No uses clases Tailwind de color fijo** (como `bg-green-700`, `bg-white`, `bg-gray-900`). Usa el CSS var directamente:

```tsx
// En el elemento raíz del navbar/sidebar:
style={{ backgroundColor: 'var(--color-primary)' }}
```

O si Tailwind ya está configurado para leer el CSS var en `tailwind.config`:

```tsx
className="bg-primary"  // solo si bg-primary → var(--color-primary) ya está en la config
```

Si no existe esa extensión en `tailwind.config.js`, usa `style={{ backgroundColor: 'var(--color-primary)' }}` directamente — es más explícito y no requiere tocar la config de Tailwind.

### 2. Texto blanco sobre el fondo primario

Todos los elementos dentro del navbar y sidebar que actualmente son oscuros o grises pasan a blanco:

```tsx
// Textos
className="text-white"

// Iconos SVG
className="text-white" // o fill="white" / stroke="white" si es SVG inline

// Texto secundario / muted dentro del sidebar
className="text-white/70"  // blanco al 70% de opacidad

// Texto de subsección / label de grupo en sidebar
className="text-white/50 uppercase tracking-widest text-xs"
```

### 3. Item activo del sidebar

El item de navegación activo (ruta actual) usa un fondo blanco semitransparente en lugar del resaltado de color fijo:

```tsx
// Item activo
className="bg-white/20 text-white font-semibold rounded-md"

// Item en hover (no activo)
className="hover:bg-white/10 text-white/80 hover:text-white transition-colors"

// Item inactivo (sin hover)
className="text-white/70"
```

### 4. Borde/divisor dentro del sidebar

Los separadores de sección usan blanco a baja opacidad:

```tsx
<hr className="border-white/20 my-2" />
// o
<div className="h-px bg-white/20 my-2" />
```

### 5. Logo de la clínica en el navbar (ya existente desde R6)

El logo ya tiene `object-contain` y altura fija. Solo verificar que tenga `filter: brightness(0) invert(1)` si el logo es oscuro y necesita verse sobre fondo de color:

```tsx
// Condicional: si hay logo, mostrarlo; si no, mostrar nombre de clínica en texto blanco
{yo?.clinica_logo_url ? (
  <img
    src={yo.clinica_logo_url}
    alt="Logo clínica"
    className="h-8 w-auto object-contain"
    // No aplicar filtro por defecto — el admin puede subir un logo blanco/transparente
    // Si el logo no se ve, el admin debe subir una versión blanca del logo
  />
) : (
  <span className="text-white font-bold text-sm">{yo?.clinica_nombre}</span>
)}
```

### 6. Indicador de carga antes de tener el color

Mientras el hook carga el perfil (antes de tener `--color-primary`), el fallback del CSS var es el color neutro que ya tenías. No necesitas un skeleton especial; simplemente pon un fallback en la var:

```css
/* En el CSS que define la var, o en tu index.css */
:root {
  --color-primary: #15803d;  /* fallback verde Clásico Salud mientras carga */
  --color-secondary: #0369a1;
}
```

Si el fallback ya está definido en `tokens.css` o equivalente, no toques nada.

---

## Verificación visual esperada

Después de los cambios:

1. Con la paleta **Clásico Salud** (`#15803d`): navbar y sidebar en verde oscuro, texto blanco.
2. Con la paleta **Índigo Clínico** (`#4338ca`): navbar y sidebar en índigo, texto blanco.
3. Con la paleta **Rosa Profesional** (`#be185d`): navbar y sidebar en rosa oscuro, texto blanco.
4. Al cambiar de paleta desde Admin → Configuración, el cambio debe verse en tiempo real porque el CSS var ya se actualiza en el DOM:
   ```ts
   document.documentElement.style.setProperty('--color-primary', paleta.primario)
   ```
   El navbar/sidebar cambia de color inmediatamente sin recargar.

---

## Qué NO tocar

- Los colores de las tarjetas de contenido, fondos de sección y tablas — esos siguen en blanco/gris claro.
- La lógica de carga del perfil (`useYo`, `GET /api/profesional/yo`) — no cambia.
- `brand_config` en la base de datos — no cambia.
- El selector de paletas del panel de administración — no cambia.
- `tokens.css` o el archivo donde se definen las variables CSS — no cambies los valores por defecto allí a menos que no exista ningún fallback definido.

---

## Resumen de cambios esperados

| Archivo | Cambio |
|---|---|
| `Navbar.tsx` (o equivalente) | `style={{ backgroundColor: 'var(--color-primary)' }}` + texto blanco |
| `Sidebar.tsx` (o equivalente) | `style={{ backgroundColor: 'var(--color-primary)' }}` + texto blanco + item activo `bg-white/20` |
| Componentes equivalentes en `web-patient` | Mismos cambios |

No es necesario tocar ningún archivo fuera de los componentes de layout.
