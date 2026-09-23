# Fix puntual — Agregar Dispositivos al ITEMS de NavBar.tsx

## Archivo a editar

`apps/web-patient/src/components/NavBar.tsx`

## Cambio exacto

### 1. Agrega este ícono después de `IconChat`:

```tsx
const IconDispositivos = () => (
  <Svg>
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <line x1="12" y1="18" x2="12.01" y2="18" />
  </Svg>
)
```

### 2. Agrega el ítem al array ITEMS (al final, antes del `as const`):

```tsx
{ to: '/dispositivos', etiqueta: 'Dispositivos', Icono: IconDispositivos },
```

El array `ITEMS` debe quedar así:

```tsx
const ITEMS = [
  { to: '/inicio', etiqueta: 'Inicio', Icono: IconInicio },
  { to: '/plan', etiqueta: 'Plan', Icono: IconPlan },
  { to: '/registros', etiqueta: 'Apuntar', Icono: IconApuntar },
  { to: '/citas', etiqueta: 'Citas', Icono: IconCita },
  { to: '/mensajes', etiqueta: 'Mensajes', Icono: IconChat },
  { to: '/dispositivos', etiqueta: 'Dispositivos', Icono: IconDispositivos },
] as const
```

### 3. Actualiza el comentario encima del array:

Cambia: `// Cinco es el máximo razonable en una barra inferior`
Por: `// Seis ítems: etiquetas cortas de máximo 11 caracteres para que quepan en 390 px.`

## Qué NO tocar

- El JSX de renderizado (el map sobre ITEMS)
- El `style={{ backgroundColor: 'var(--nav)' }}`
- Los otros íconos e ítems existentes
