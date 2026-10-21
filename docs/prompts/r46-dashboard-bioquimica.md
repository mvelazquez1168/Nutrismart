# R46 — Dashboard de Bioquímica: gráfica histórica de laboratorios por paciente

Crea la rama `r46-dashboard-bioquimica` desde `main` y aplica los siguientes cambios.

**Contexto:** Se agrega una nueva pestaña "Dashboards" en la valoración del paciente, ubicada entre "Laboratorios" y "Clínico". Esta pestaña muestra una gráfica de línea por cada biomarcador con histórico de resultados de laboratorio. Los datos vienen del endpoint que ya existe (`GET /api/pacientes/:id/laboratorios`). No requiere nuevos endpoints. La gráfica se actualiza automáticamente cada vez que el profesional agrega un nuevo estudio (porque el componente hace un nuevo fetch al montar).

No hay librería de gráficas en el proyecto: usar SVG inline, siguiendo el patrón de `GraficaComposicion.tsx`.

---

## Paso 0 — Pull de main

```
git checkout main && git pull origin main
git checkout -b r46-dashboard-bioquimica
```

---

## Bloque 1 — Agregar la sección al modelo de valoración

### Archivo: `apps/web-professional/src/api/valoracion.ts`

Leer el archivo completo.

Localizar el array `SECCIONES`. Insertar la nueva entrada **entre** `bioquim` y `clinico`:

```typescript
{ clave: 'dashboards', etiqueta: 'Dashboards' },
```

**Importante:** NO agregar `'dashboards'` a `SECCIONES_EXIGIDAS`. Esta sección es informativa y no bloquea finalizar la valoración.

El tipo `Seccion` se deriva de `as const`, por lo que se actualiza automáticamente.

---

## Bloque 2 — Integrar la pestaña en la valoración

### Archivo: `apps/web-professional/src/pages/ValoracionPaciente.tsx`

Leer el archivo completo.

**Cambio A — Import**

Agregar al bloque de imports:

```typescript
import { DashboardBioquimica } from '../components/eval/DashboardBioquimica'
```

**Cambio B — Panel de la sección**

Localizar el bloque `{tab === 'bioquim' && <PanelBioquimica ... />}`. Inmediatamente DESPUÉS de ese bloque agregar:

```tsx
{tab === 'dashboards' && (
  <DashboardBioquimica pacienteId={id} />
)}
```

---

## Bloque 3 — Componente DashboardBioquimica

### Archivo: `apps/web-professional/src/components/eval/DashboardBioquimica.tsx` (nuevo)

Crear el archivo con el siguiente comportamiento:

**Props:**
```typescript
interface Props {
  pacienteId: string
}
```

**Datos:**
- Llamar a `getLaboratorios(pacienteId)` (import de `../../api/laboratorios`)
- El tipo devuelto es `EstudioLab[]` (import de `../../api/tipos`), donde cada estudio tiene `fecha: string` y `resultados: ResultadoLab[]`
- Ordenar los estudios por fecha ASC para el eje X (el API devuelve DESC; invertir con `.slice().reverse()`)

**Procesamiento:**

Para cada biomarcador que aparece en al menos un estudio, construir una serie:
```typescript
interface Serie {
  codigo: string
  nombre: string
  unidad: string
  grupo: string          // si está disponible; si no, 'General'
  puntos: {
    fecha: string        // 'YYYY-MM-DD'
    valor: number
    estado: EstadoResultado
    rango: { minimo: number | null; maximo: number | null } | null
  }[]
}
```

Agrupar las series por `grupo` de biomarcador. El `grupo` no está directamente en `ResultadoLab`; leer `getBiomarcadores()` por separado para obtener el grupo de cada código, o bien mostrar todos los biomarcadores en un único bloque si el grupo no está disponible.

> **Simplificación aceptable:** si obtener el grupo requiere un segundo fetch complejo, mostrar todos los biomarcadores sin agrupar, uno debajo del otro.

**Layout:**

```
┌─────────────────────────────────────────┐
│ Evolución de laboratorios               │  ← h2
│ Histórico de todos los estudios         │  ← subtítulo muted
└─────────────────────────────────────────┘

[Glucosa 95 mg/dL  ←→ gráfica de línea ]
[HbA1c  5.6 %      ←→ gráfica de línea ]
...
```

Cada biomarcador ocupa una fila (grid 2 columnas en desktop: nombre/valor actual a la izquierda, gráfica SVG a la derecha). En móvil, una columna.

**Gráfica SVG por biomarcador** (seguir el patrón de `GraficaComposicion.tsx`):

- Dimensiones: `width="100%" viewBox="0 0 320 80"`
- Márgenes: `{ top: 8, right: 8, bottom: 20, left: 36 }`
- Eje X: fechas de los estudios como texto `DD/MM`
- Eje Y: escala automática entre `min(valores) * 0.85` y `max(valores) * 1.15`, o el rango de referencia si es más amplio
- Banda de referencia: si hay `rango.minimo` o `rango.maximo`, dibujar un rectángulo de fondo semitransparente con `fill="color-mix(in srgb, var(--status-normal) 12%, transparent)"`
- Línea: `stroke="var(--primary)"` con `strokeWidth={1.5}`, `fill="none"`, puntos conectados en orden de fecha
- Puntos: círculo `r={3}` con color según `estado`:
  - `normal` → `var(--status-normal)`
  - `alterado` → `var(--status-critical)` 
  - `sin_referencia` → `var(--muted)`
- Líneas de referencia (si existen): línea punteada `strokeDasharray="3 2"` horizontal en el mínimo y en el máximo del rango, con `stroke="var(--status-normal)"` y `strokeWidth={0.8}`
- Etiquetas del eje Y: 3–4 valores; eje X: solo primera y última fecha si hay muchos puntos, todas si son ≤ 5

**Estado de carga / vacío:**

- Cargando: mostrar 3 placeholders `animate-pulse rounded bg-surface-2 h-20`
- Sin estudios: tarjeta con texto "Aún no hay estudios de laboratorio registrados para este paciente."
- Biomarcadores con un solo punto: mostrar la tarjeta de nombre/valor pero omitir la gráfica (no se puede trazar una línea con un punto)

**Valor actual** (columna izquierda de cada fila):
- Nombre del biomarcador en `text-sm font-semibold text-ink`
- Valor más reciente + unidad en `text-2xl font-bold` con color según estado (`normal`=verde, `alterado`=naranja/rojo, `sin_referencia`=gris)
- Fecha del último estudio en `text-xs text-muted`

**Skeleton de la estructura JSX:**

```tsx
export function DashboardBioquimica({ pacienteId }: Props) {
  const [estudios, setEstudios] = useState<EstudioLab[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    const ctrl = new AbortController()
    getLaboratorios(pacienteId, ctrl.signal)
      .then((data) => { if (!ctrl.signal.aborted) setEstudios(data); setCargando(false) })
      .catch(() => { if (!ctrl.signal.aborted) setCargando(false) })
    return () => ctrl.abort()
  }, [pacienteId])

  // ... construir series desde estudios ...

  return (
    <div className="space-y-6 rounded-lg border border-border bg-surface p-5">
      <div>
        <h2 className="text-lg font-bold text-ink">Evolución de laboratorios</h2>
        <p className="text-sm text-muted">Histórico de todos los estudios cargados</p>
      </div>
      {cargando && <Placeholders />}
      {!cargando && series.length === 0 && <MensajeVacio />}
      {!cargando && series.length > 0 && (
        <div className="space-y-4">
          {series.map((s) => <FilaBiomarcador key={s.codigo} serie={s} />)}
        </div>
      )}
    </div>
  )
}
```

---

## Commit

```
git add apps/web-professional/src/api/valoracion.ts \
        apps/web-professional/src/pages/ValoracionPaciente.tsx \
        apps/web-professional/src/components/eval/DashboardBioquimica.tsx

git commit -m "feat(r46): tab Dashboards con gráfica histórica de laboratorios por paciente

- Nueva sección 'Dashboards' entre Laboratorios y Clínico
- DashboardBioquimica: gráfica SVG de línea por biomarcador
- Banda de referencia, color por estado, eje de fechas
- Datos de getLaboratorios() existente, sin nuevos endpoints

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ES8ko4NzY3HXWX6HJ2zwy6"

git push origin r46-dashboard-bioquimica
```
