# R50 — Completación: ítems pendientes

## Contexto

R49 (migración + API + LaboratorioModal) ya está aplicado.
R50 (PanelAnalitica) está parcialmente implementado. Faltan estos 5 ítems:

1. `TendenciaModal.tsx` — componente nuevo, sin recharts (SVG a mano)
2. Pestañas en `PanelBioquimica.tsx` — wrapper con tabs [Estudios][Analítica]
3. Refinar `PanelAnalitica.tsx` — banner con scroll + columnas responsivas exactas
4. Verificación en el navegador
5. `docs/PRUEBAS.md` + commit + push

---

## Decisiones ya tomadas (no replantear)

- **Sin recharts**: `DashboardBioquimica.tsx` ya usa SVG inline para gráficas; hacer lo mismo en TendenciaModal.
- **No props `clinicaId`** en PanelAnalitica: `apiGet` resuelve el tenant del token, ningún componente de la app pasa clinicaId.
- **Rama de trabajo**: `r49-lab-dinamico` (ya existe). Hacer commits separados:
  - `feat(r49): migración catálogo dinámico, API y LaboratorioModal`
  - `feat(r50): panel de analítica con tendencias`

---

## 1. PRIMERO: leer los archivos existentes

Antes de escribir nada, leer:

```
apps/web-professional/src/components/eval/PanelBioquimica.tsx
apps/web-professional/src/components/eval/PanelAnalitica.tsx   (si existe)
apps/web-professional/src/components/eval/DashboardBioquimica.tsx  (patrón SVG)
apps/web-professional/src/components/Modal.tsx  (patrón de modal existente)
apps/web-professional/src/lib/grupos.ts  (si existe, para formatGrupo)
apps/web-professional/src/lib/api.ts  (para ver cómo se usa apiGet)
```

---

## 2. PanelBioquimica.tsx — agregar pestañas

**Estrategia:** renombrar la función actual como `ContenidoEstudios` (función interna, no exportada) y crear un nuevo componente exportado `PanelBioquimica` que envuelve con tabs.

```tsx
// ANTES (simplificado):
export function PanelBioquimica({ pacienteId, ... }) {
  // todo el contenido actual
}

// DESPUÉS:
function ContenidoEstudios({ pacienteId, ... }) {
  // todo el contenido actual, sin cambios
}

export function PanelBioquimica({ pacienteId, clinicaId, ... }) {
  const [tab, setTab] = useState<'estudios' | 'analitica'>('estudios');

  return (
    <div>
      {/* tabs */}
      <div className="flex border-b border-gray-200 mb-4">
        <button
          onClick={() => setTab('estudios')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'estudios'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Estudios
        </button>
        <button
          onClick={() => setTab('analitica')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'analitica'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Analítica
        </button>
      </div>

      {/* contenido — NO desmontar al cambiar tab */}
      <div style={{ display: tab === 'estudios' ? 'block' : 'none' }}>
        <ContenidoEstudios pacienteId={pacienteId} ... />
      </div>
      <div style={{ display: tab === 'analitica' ? 'block' : 'none' }}>
        <PanelAnalitica pacienteId={pacienteId} />
      </div>
    </div>
  );
}
```

**Importante:**
- Las clases CSS deben coincidir con el sistema de diseño existente. Mirar los tabs que ya existen en la app (p. ej. en PacienteEvaluacion o en el mismo PanelBioquimica si ya tiene tabs) y copiar las mismas clases.
- Usar `style={{ display: ... }}` en lugar de renderizado condicional, para no desmontar.
- Importar `PanelAnalitica` desde `./PanelAnalitica`.

---

## 3. TendenciaModal.tsx — componente nuevo

Crear `apps/web-professional/src/components/eval/TendenciaModal.tsx`.

**Patrón de referencia:** copiar la estructura de modal de `Modal.tsx` o del modal más parecido que exista en la app.

### Tipos (copiar de PanelAnalitica.tsx si ya están ahí)

```typescript
type AnalitoHistorico = {
  codigo: string;
  nombre: string;
  grupo: string;
  unidad: string;
  es_cualitativo: boolean;
  refMin: number | null;
  refMax: number | null;
  serie: {
    fecha: string;       // 'YYYY-MM-DD'
    valor: number | null;
    valor_texto: string | null;
    estudio_id: string;
  }[];
};

interface TendenciaModalProps {
  analito: AnalitoHistorico | null; // null = cerrado
  onClose: () => void;
}
```

### Comportamiento de cierre

```tsx
useEffect(() => {
  if (!analito) return;
  const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [analito, onClose]);

if (!analito) return null;
```

### Badge de estado

```tsx
function BadgeEstado({ estado }: { estado: 'ok' | 'bad' | 'none' }) {
  const map = {
    ok:   { label: 'NORMAL',   cls: 'bg-green-100 text-green-800' },
    bad:  { label: 'ALTERADO', cls: 'bg-red-100 text-red-800' },
    none: { label: 'SIN REF.', cls: 'bg-gray-100 text-gray-600' },
  };
  const { label, cls } = map[estado];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>{label}</span>;
}
```

### KPI helpers

```tsx
function formatRef(a: AnalitoHistorico): { text: string; label: string } {
  if (a.es_cualitativo || (a.refMin === null && a.refMax === null))
    return { text: '—', label: '' };
  if (a.refMin !== null && a.refMax !== null)
    return { text: `${a.refMin} – ${a.refMax} ${a.unidad}`, label: 'rango normal' };
  if (a.refMax !== null)
    return { text: `≤ ${a.refMax} ${a.unidad}`, label: 'valor máximo' };
  return { text: `≥ ${a.refMin} ${a.unidad}`, label: 'valor mínimo' };
}
```

### Gráfica SVG (cuantitativos) — sin librería

Dimensiones fijas: `width="100%" height="200"`. Usar viewBox `"0 0 600 200"`.

**Zona del gráfico:** márgenes left=50, right=20, top=20, bottom=40. Área útil: x=[50,580], y=[20,160].

```tsx
function GraficaSVG({ a }: { a: AnalitoHistorico }) {
  // 1. filtrar puntos con valor no nulo
  const puntos = a.serie.filter(p => p.valor !== null) as (typeof a.serie[number] & { valor: number })[];
  if (puntos.length === 0) return <p className="text-sm text-gray-400 text-center py-8">Sin datos numéricos</p>;

  const W = 600, H = 200;
  const ML = 50, MR = 20, MT = 20, MB = 40;
  const pw = W - ML - MR;   // ancho de ploteo
  const ph = H - MT - MB;   // alto de ploteo

  const valores = puntos.map(p => p.valor);
  const vMin = Math.min(...valores);
  const vMax = Math.max(...valores);
  // incluir refMin/refMax en la escala Y
  const allY = [...valores];
  if (a.refMin !== null) allY.push(a.refMin);
  if (a.refMax !== null) allY.push(a.refMax);
  const dataMin = Math.min(...allY);
  const dataMax = Math.max(...allY);
  const margin = (dataMax - dataMin) * 0.10 || 1;
  const yLo = dataMin - margin;
  const yHi = dataMax + margin;

  const scaleX = (i: number) => ML + (i / (puntos.length - 1 || 1)) * pw;
  const scaleY = (v: number) => MT + ph - ((v - yLo) / (yHi - yLo)) * ph;

  // estado de cada punto
  function estadoPunto(v: number): 'ok' | 'bad' | 'none' {
    if (a.refMin === null && a.refMax === null) return 'none';
    if (a.refMin !== null && v < a.refMin) return 'bad';
    if (a.refMax !== null && v > a.refMax) return 'bad';
    return 'ok';
  }

  const colorMap = { ok: '#22c55e', bad: '#ef4444', none: '#9ca3af' };
  const estadoFinal = estadoPunto(puntos[puntos.length - 1].valor);
  const lineColor = colorMap[estadoFinal];

  // polyline points
  const polyPoints = puntos.map((p, i) => `${scaleX(i)},${scaleY(p.valor)}`).join(' ');

  // banda de referencia
  let bandEl: React.ReactNode = null;
  if (a.refMin !== null || a.refMax !== null) {
    const bandTop = scaleY(a.refMax ?? yHi);
    const bandBot = scaleY(a.refMin ?? yLo);
    bandEl = (
      <rect
        x={ML} y={bandTop}
        width={pw} height={bandBot - bandTop}
        fill="#22c55e" fillOpacity="0.10"
      />
    );
  }

  // eje X: fechas
  const fechaLabels = puntos.map((p, i) => {
    const d = new Date(p.fecha + 'T00:00:00');
    const label = d.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' });
    return (
      <text key={i} x={scaleX(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#6b7280">
        {label}
      </text>
    );
  });

  // eje Y: 3 líneas guía
  const yTicks = [yLo, (yLo + yHi) / 2, yHi].map((v, i) => (
    <g key={i}>
      <line x1={ML} y1={scaleY(v)} x2={W - MR} y2={scaleY(v)} stroke="#e5e7eb" strokeWidth="1" />
      <text x={ML - 6} y={scaleY(v) + 4} textAnchor="end" fontSize="10" fill="#6b7280">
        {v.toFixed(1)}
      </text>
    </g>
  ));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="200" style={{ overflow: 'visible' }}>
      {yTicks}
      {bandEl}
      <polyline points={polyPoints} stroke={lineColor} strokeWidth="2" fill="none" strokeLinejoin="round" />
      {puntos.map((p, i) => (
        <circle
          key={i}
          cx={scaleX(i)} cy={scaleY(p.valor)}
          r="4"
          fill={colorMap[estadoPunto(p.valor)]}
          stroke="white" strokeWidth="1.5"
        />
      ))}
      {fechaLabels}
    </svg>
  );
}
```

### Timeline cualitativa

```tsx
function TimelineCualitativa({ a }: { a: AnalitoHistorico }) {
  const ordenado = [...a.serie].reverse();
  return (
    <ul className="space-y-2 py-2">
      {ordenado.map((p, i) => {
        const d = new Date(p.fecha + 'T00:00:00');
        const fecha = d.toLocaleDateString('es-MX', { month: 'short', year: 'numeric' });
        return (
          <li key={i} className="flex items-center gap-3 text-sm">
            <span className="text-blue-500">●</span>
            <span className="text-gray-400 w-20">{fecha}</span>
            <span className="font-medium text-gray-700">{p.valor_texto ?? '—'}</span>
          </li>
        );
      })}
    </ul>
  );
}
```

### Estructura del modal

```tsx
export function TendenciaModal({ analito: a, onClose }: TendenciaModalProps) {
  useEffect(() => {
    if (!a) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [a, onClose]);

  if (!a) return null;

  const ultimo = a.serie.at(-1);
  const estado = calcularEstado(a);    // importar de PanelAnalitica o redefinir aquí
  const variacion = calcularVariacion(a); // idem
  const ref = formatRef(a);

  const ultimoValorStr = a.es_cualitativo
    ? (ultimo?.valor_texto ?? '—')
    : (ultimo?.valor !== null && ultimo?.valor !== undefined ? `${ultimo.valor}` : '—');

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-lg sm:mx-4 max-h-[90vh] overflow-y-auto">
        {/* cabecera */}
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div>
            <p className="text-xs font-mono text-gray-400 uppercase tracking-widest mb-0.5">{a.codigo}</p>
            <h2 className="text-lg font-semibold text-gray-800">{a.nombre}</h2>
            <div className="mt-1"><BadgeEstado estado={estado} /></div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1">✕</button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-px bg-gray-100 border-b border-gray-100">
          <div className="bg-white p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{ultimoValorStr}</p>
            <p className="text-xs text-gray-400 mt-0.5">{a.es_cualitativo ? '' : a.unidad}</p>
            <p className="text-xs text-gray-500 mt-1">Último valor</p>
          </div>
          <div className="bg-white p-4 text-center">
            <p className="text-sm font-semibold text-gray-700 break-words">{ref.text}</p>
            <p className="text-xs text-gray-400 mt-0.5">{ref.label || '—'}</p>
            <p className="text-xs text-gray-500 mt-1">Referencia</p>
          </div>
          <div className="bg-white p-4 text-center">
            {variacion ? (
              <>
                <p className={`text-xl font-bold ${variacion.empeora ? 'text-red-600' : 'text-green-600'}`}>
                  {variacion.up ? '↑' : '↓'} {variacion.pct}%
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{variacion.up ? 'Subió' : 'Bajó'}</p>
              </>
            ) : (
              <p className="text-sm text-gray-400">—</p>
            )}
            <p className="text-xs text-gray-500 mt-1">Vs. anterior</p>
          </div>
        </div>

        {/* gráfica o timeline */}
        <div className="p-5">
          {a.es_cualitativo
            ? <TimelineCualitativa a={a} />
            : <GraficaSVG a={a} />
          }
        </div>
      </div>
    </div>
  );
}
```

**Funciones `calcularEstado` y `calcularVariacion`:** Si ya están en `PanelAnalitica.tsx`, importarlas de ahí. Si no, copiarlas al inicio de `TendenciaModal.tsx` antes de los subcomponentes.

---

## 4. PanelAnalitica.tsx — refinamientos

### 4a. Banner con scroll al primer analito alterado

El banner ya debe existir (o existe parcialmente). El comportamiento exacto:

```tsx
// Ref para el primer analito alterado
const primeraFilaAlteradaRef = useRef<HTMLTableRowElement>(null);
const tabsRef = useRef<HTMLDivElement>(null);

function handleBannerClick() {
  setTabGrupo('todos');
  // Esperar a que React renderice con tab 'todos' para que el elemento exista
  setTimeout(() => {
    primeraFilaAlteradaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

// En el banner:
{altCount > 0 && (
  <button
    onClick={handleBannerClick}
    className="w-full text-left flex items-center gap-2 mb-3 px-4 py-2.5 rounded-lg bg-red-50 text-red-700 text-sm font-medium hover:bg-red-100 transition-colors"
  >
    <span>⚠</span>
    <span>{altCount} analito{altCount !== 1 ? 's' : ''} fuera de rango en el último estudio</span>
  </button>
)}

// En la fila de la tabla, agregar ref al primer alterado:
// (dentro del .map de los analitos del grupo)
const esPrimeroAlterado = calcularEstado(a) === 'bad' && primerAlteradoIdx === idx;
<tr ref={esPrimeroAlterado ? primeraFilaAlteradaRef : undefined} ...>
```

### 4b. Columnas responsivas

Las columnas Variación, Tendencia y Fecha se ocultan en móvil (< 640px). Usar clases Tailwind:

```tsx
// En los <th>:
<th className="hidden sm:table-cell">Variación</th>
<th className="hidden sm:table-cell">Tendencia</th>
<th className="hidden sm:table-cell">Fecha</th>

// En los <td> correspondientes:
<td className="hidden sm:table-cell">...</td>
```

Los tabs de grupos deben tener scroll horizontal en móvil:

```tsx
<div className="flex gap-1 overflow-x-auto pb-1 mb-3 scrollbar-hide">
  {/* tabs de grupos */}
</div>
```

Si la clase `scrollbar-hide` no existe en el proyecto, usar:
```tsx
<div className="flex gap-1 overflow-x-auto pb-1 mb-3" style={{ scrollbarWidth: 'none' }}>
```

### 4c. Verificar estado vacío y skeleton

- Skeleton: 3 filas con `animate-pulse` mientras carga.
- Estado vacío: `"Este paciente aún no tiene estudios registrados con analitos del catálogo."` centrado con ícono.

---

## 5. Verificación en el navegador

Después de implementar todos los cambios anteriores, arrancar el servidor de desarrollo:

```bash
cd apps/web-professional && npm run dev
```

Y verificar manualmente los 7 casos del spec:

1. La pestaña "Analítica" aparece junto a "Estudios" en el panel de laboratorio.
2. Con un paciente con 3 estudios (Hemoglobina, Glucosa, Colesterol): tabla muestra valores, estados, sparklines y variación.
3. Analito cualitativo (VIH): muestra `valor_texto`, badge "SIN REF.", sin sparkline.
4. Clic en Hemoglobina: modal con gráfica SVG y banda de referencia sombreada.
5. Banner de alertas muestra el número correcto de analitos alterados.
6. En 375px: tabs con scroll horizontal, tabla con 4 columnas, modal como drawer desde abajo.
7. Escape y clic en backdrop cierran el modal.

---

## 6. docs/PRUEBAS.md — sección R49 + R50

Agregar (o crear) el archivo `docs/PRUEBAS.md` con una sección para R49 y otra para R50.

### Sección R49

```markdown
## R49 — Catálogo dinámico de analitos y formulario de laboratorio

### Tipos de resultado soportados

1. **Cuantitativo con código de catálogo**: biomarcador del catálogo global (clinica_id IS NULL) o de la clínica. Guarda `biomarcador_codigo` + `valor` numérico.
2. **Cualitativo con código de catálogo**: biomarcador con `es_cualitativo = true`. Guarda `biomarcador_codigo` + `valor_texto`.
3. **Entrada libre (sin código)**: analito no presente en el catálogo. Guarda `nombre_libre` + `valor` como texto.

### Exclusión de entradas libres de analítica

Las entradas libres (`nombre_libre IS NOT NULL`) se excluyen del endpoint `GET /api/pacientes/:id/analitica` porque no tienen código de biomarcador para agregar su serie histórica. Sí aparecen en el detalle del estudio individual.

### Rangos de referencia

Los rangos registrados en la tabla `biomarcador_rango` son **orientativos** (valores poblacionales generales). Para la interpretación clínica el profesional debe considerar el contexto de cada paciente.

### Migración aplicada

`053_lab_dinamico.sql` — extiende `biomarcador` y `lab_resultado`, inserta 93 analitos globales activos en 11 grupos con 162 rangos.

### Verificación

- [ ] Formulario de laboratorio carga el catálogo de analitos con buscador.
- [ ] Se puede guardar un estudio con mezcla de filas cuantitativas, cualitativas y libres.
- [ ] La IA solo interpreta los resultados numéricos; si no hay ninguno, devuelve 400 en lugar de llamar a la IA.

---

## R50 — Panel de analítica

### Verificación

- [ ] Tab "Analítica" visible junto a "Estudios" en PanelBioquimica.
- [ ] Tabla de resumen con grupos, sparklines, variación y badge de estado.
- [ ] Banner de alertas muestra conteo de analitos fuera de rango; clic hace scroll al primer alterado.
- [ ] Clic en fila abre TendenciaModal con gráfica SVG y banda de referencia sombreada.
- [ ] Analito cualitativo muestra timeline de chips en lugar de gráfica.
- [ ] En 375px: tabs scrolleables, 4 columnas, modal como drawer desde abajo.
- [ ] Escape y backdrop cierran el modal.
```

---

## 7. Commits

```bash
# Asegurarse de estar en la rama correcta
git checkout r49-lab-dinamico   # o la rama activa

# Commit R49 (si aún no está commiteado)
git add apps/api/migrations/053_lab_dinamico.sql \
        apps/api/src/routes/laboratorios.ts \
        apps/api/src/laboratorios/repositorio.ts \
        apps/web-professional/src/components/LaboratorioModal.tsx \
        apps/web-professional/src/lib/grupos.ts
git commit -m "feat(r49): catálogo dinámico de analitos, API histórica y formulario de laboratorio"

# Commit R50
git add apps/web-professional/src/components/eval/PanelAnalitica.tsx \
        apps/web-professional/src/components/eval/TendenciaModal.tsx \
        apps/web-professional/src/components/eval/PanelBioquimica.tsx \
        docs/PRUEBAS.md
git commit -m "feat(r50): panel de analítica con tendencias y modal de detalles"

git push origin r49-lab-dinamico
```

Si algunos archivos de R49 ya estaban commiteados en sesiones anteriores, omitir los que ya tienen commit y solo agregar los nuevos.

---

## Orden de ejecución

1. Leer archivos existentes (paso 1)
2. `TendenciaModal.tsx` (nuevo)
3. `PanelBioquimica.tsx` (agregar tabs)
4. `PanelAnalitica.tsx` (refinamientos)
5. Verificación en navegador
6. `docs/PRUEBAS.md`
7. Commits y push
