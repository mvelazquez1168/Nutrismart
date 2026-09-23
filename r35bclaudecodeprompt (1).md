# Rebanada 35b — Corrección de texto en navbar y sidebar (texto blanco sobre color primario)

## Contexto

La r34 aplicó `var(--color-primary)` como fondo del navbar y sidebar en ambas apps. Sin embargo, el texto quedó en negro/oscuro, lo que no se ve bien sobre fondos de color verde, azul o cualquier color primario de la clínica. Todo el texto dentro del navbar y sidebar debe ser blanco.

No hay migración. Solo ajuste de clases CSS en los mismos archivos que tocó r34.

---

## Alcance

Los mismos archivos que se editaron en r34:

- Navbar/header de `apps/web-professional`
- Sidebar de `apps/web-professional`
- Navbar/header de `apps/web-patient`
- Menú/nav de `apps/web-patient`

Localízalos con:

```bash
grep -r "var(--color-primary)\|color-primary" apps/web-professional/src apps/web-patient/src --include="*.tsx" -l
```

---

## Cambios a aplicar

### 1. Texto principal — blanco

Cualquier clase de texto oscuro dentro del navbar/sidebar (`text-gray-*`, `text-zinc-*`, `text-slate-*`, `text-black`, `text-neutral-*`) debe cambiarse a:

```tsx
className="text-white"
```

### 2. Texto secundario / muted — blanco semitransparente

Subtítulos, labels de sección, textos de apoyo dentro del navbar/sidebar:

```tsx
className="text-white/70"
```

### 3. Íconos SVG — blancos

Íconos dentro del navbar/sidebar que tengan clases de color oscuro:

```tsx
className="text-white"  // si el ícono hereda color del padre, ya queda
// o si es SVG inline:
// stroke="white" / fill="white"
```

### 4. Ítem activo del sidebar/menú

```tsx
className="bg-white/20 text-white font-semibold rounded-md"
```

### 5. Ítem en hover (no activo)

```tsx
className="hover:bg-white/10 text-white/80 hover:text-white transition-colors"
```

### 6. Separadores / bordes internos

```tsx
className="border-white/20"
// o
className="bg-white/20"
```

### 7. Nombre/logo de clínica en navbar

```tsx
<span className="text-white font-bold text-sm">{yo?.clinica_nombre}</span>
```

---

## Qué NO tocar

- El fondo (`var(--color-primary)`) ya está correcto — no lo quites
- Los colores de contenido fuera del navbar/sidebar (tarjetas, tablas, formularios) — siguen en oscuro sobre fondo blanco
- `tokens.css` y la lógica de carga de marca

---

## Verificación esperada

Con la paleta **Clásico Salud** (`#15803d`): navbar y sidebar en verde, **todo el texto en blanco**, íconos blancos, ítem activo con fondo blanco/20.

Con la paleta **Índigo Clínico** (`#4338ca`): mismo resultado sobre fondo índigo.
