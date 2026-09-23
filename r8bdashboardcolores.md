Mejora visual del dashboard: los KpiTile deben tener colores distintos por métrica.
No es una rebanada nueva — es un refinamiento de R8. No crees migración ni nuevo commit de especificación.

────────────────────────────────────────────────────────────
PASO 1 — Actualizar KpiTile
────────────────────────────────────────────────────────────

Lee apps/web-professional/src/components/KpiTile.tsx y reemplázalo con esta versión:

```tsx
interface KpiTileProps {
  label: string;
  valor: number;
  secundario?: string;
  icono: React.ReactNode;
  color: 'blue' | 'green' | 'red' | 'amber' | 'teal' | 'purple';
}

const colorMap = {
  blue:   { bg: 'bg-blue-50',   border: 'border-blue-200',  num: 'text-blue-700',   icon: 'text-blue-500'   },
  green:  { bg: 'bg-green-50',  border: 'border-green-200', num: 'text-green-700',  icon: 'text-green-500'  },
  red:    { bg: 'bg-red-50',    border: 'border-red-200',   num: 'text-red-700',    icon: 'text-red-500'    },
  amber:  { bg: 'bg-amber-50',  border: 'border-amber-200', num: 'text-amber-700',  icon: 'text-amber-500'  },
  teal:   { bg: 'bg-teal-50',   border: 'border-teal-200',  num: 'text-teal-700',   icon: 'text-teal-500'   },
  purple: { bg: 'bg-purple-50', border: 'border-purple-200',num: 'text-purple-700', icon: 'text-purple-500' },
};

export default function KpiTile({ label, valor, secundario, icono, color }: KpiTileProps) {
  const c = colorMap[color];
  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} p-5 flex flex-col gap-2`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-600">{label}</span>
        <span className={`${c.icon}`}>{icono}</span>
      </div>
      <span className={`text-3xl font-bold tabular-nums ${c.num}`}>
        {valor.toLocaleString('es-CR')}
      </span>
      {secundario && (
        <span className="text-xs text-gray-500">{secundario}</span>
      )}
    </div>
  );
}
```

────────────────────────────────────────────────────────────
PASO 2 — Actualizar DashboardPage
────────────────────────────────────────────────────────────

Lee apps/web-professional/src/pages/DashboardPage.tsx.

Reemplaza el bloque donde se renderizan los KpiTile con esta versión que
asigna color e icono a cada métrica. Usa SVG inline de Heroicons (outline,
24x24) — ya son parte del proyecto si se usan en otras pantallas; si no,
usa estos SVGs inline directamente:

```tsx
// Íconos SVG inline — 24x24 outline
const IconCalendar = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
    strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
  </svg>
);

const IconCheck = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
    strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
);

const IconX = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
    strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
    <path strokeLinecap="round" strokeLinejoin="round"
      d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
);

const IconClock = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
    strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
);

const IconUsers = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
    strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
  </svg>
);

const IconUserPlus = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
    strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM4 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 10.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
  </svg>
);
```

Bloque de los 6 tiles (reemplaza el grid existente):

```tsx
// Calcular % completadas para el secundario
const pctCompletadas = datos.kpis.citas_total > 0
  ? ((datos.kpis.citas_completadas / datos.kpis.citas_total) * 100).toFixed(1) + '% del total'
  : '—';

const labelPeriodo = periodo === 'hoy' ? 'hoy' : periodo === 'semana' ? 'esta semana' : 'este mes';

<div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
  <KpiTile
    label="Citas"
    valor={datos.kpis.citas_total}
    secundario={labelPeriodo}
    icono={<IconCalendar />}
    color="blue"
  />
  <KpiTile
    label="Completadas"
    valor={datos.kpis.citas_completadas}
    secundario={pctCompletadas}
    icono={<IconCheck />}
    color="green"
  />
  <KpiTile
    label="Canceladas"
    valor={datos.kpis.citas_canceladas}
    secundario={labelPeriodo}
    icono={<IconX />}
    color="red"
  />
  <KpiTile
    label="Pendientes"
    valor={datos.kpis.citas_pendientes}
    secundario={labelPeriodo}
    icono={<IconClock />}
    color="amber"
  />
  <KpiTile
    label="Pacientes"
    valor={datos.kpis.pacientes_activos}
    secundario="activos en total"
    icono={<IconUsers />}
    color="teal"
  />
  <KpiTile
    label="Nuevos"
    valor={datos.kpis.pacientes_nuevos}
    secundario={labelPeriodo}
    icono={<IconUserPlus />}
    color="purple"
  />
</div>
```

────────────────────────────────────────────────────────────
PASO 3 — VERIFICACIÓN
────────────────────────────────────────────────────────────

1. npm run build en apps/web-professional → sin errores TypeScript.
2. En el navegador con ana@vida.cr → /admin/dashboard muestra los 6 tiles
   con fondos de colores distintos (azul, verde, rojo, ámbar, teal, morado).
3. Los colores de fondo son suaves (tint), no saturados — texto legible en todos.

────────────────────────────────────────────────────────────
PASO 4 — COMMIT
────────────────────────────────────────────────────────────

git add apps/web-professional/src/components/KpiTile.tsx \
        apps/web-professional/src/pages/DashboardPage.tsx

git commit -m "R8b: KpiTile con colores e íconos por métrica"

git push origin main y reporta el hash.
