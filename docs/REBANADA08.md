# Rebanada 8 — CLI-08: Dashboard Administrativo

## Alcance

Vista exclusiva para `admin_clinica` con métricas operativas de la clínica:
ocupación de agenda, pacientes activos, carga por profesional y actividad clínica.
Todo se calcula sobre datos que ya existen en el modelo — sin nuevas tablas de negocio.

**Fuera de alcance:**
- Alertas o notificaciones automáticas
- Exportación de métricas a Excel/PDF
- Comparativas entre períodos (gráficas de tendencia — v2)
- Métricas financieras / facturación

---

## Modelo de datos

Sin migraciones de negocio. Solo dos índices nuevos para que las queries
del dashboard no hagan seq-scans sobre tablas que crecen con el tiempo:

```sql
-- Migración 010_dashboard_indices.sql
BEGIN;

-- Filtros frecuentes en el dashboard: por clínica y por fecha de inicio de cita
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cita_clinica_inicio
  ON cita (clinica_id, inicio)
  WHERE activo = true;

-- Snapshots por clínica y fecha de creación
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_snapshot_clinica_created
  ON snapshot (clinica_id, created_at)
  WHERE activo = true;

COMMIT;
```

`CONCURRENTLY` permite crear el índice sin bloquear la tabla en producción.

---

## Endpoint

### `GET /api/admin/dashboard`

Solo `admin_clinica`. Retorna todas las métricas en una sola respuesta.

**Query params:**
- `periodo` — `hoy` | `semana` | `mes` (default: `mes`)

La ventana de tiempo se calcula en UTC desde el inicio del período hasta `now()`.

**Respuesta 200:**
```json
{
  "periodo": "mes",
  "generado_en": "2026-08-13T20:00:00Z",
  "kpis": {
    "citas_total":          42,
    "citas_completadas":    31,
    "citas_canceladas":      4,
    "citas_pendientes":      7,
    "pacientes_activos":    68,
    "pacientes_nuevos":      9,
    "snapshots_creados":    24,
    "examenes_subidos":     17
  },
  "agenda_hoy": [
    {
      "cita_id":        "uuid",
      "hora_inicio":    "2026-08-13T14:00:00Z",
      "hora_fin":       "2026-08-13T14:30:00Z",
      "paciente_nombre":"María López",
      "profesional_nombre": "Luis Mora",
      "estado":         "pendiente"
    }
  ],
  "por_profesional": [
    {
      "profesional_id":   "uuid",
      "nombre":           "Luis Mora",
      "citas_total":      28,
      "citas_completadas":21,
      "pacientes_activos":45
    }
  ]
}
```

**Notas de implementación:**

- `pacientes_activos`: COUNT de pacientes con `activo = true` en la clínica (no filtrado por período).
- `pacientes_nuevos`: COUNT de pacientes creados dentro del período.
- `agenda_hoy`: siempre citas del día calendario local de la clínica (Costa Rica = UTC-6).
  Como la DB guarda en UTC, el filtro es `inicio >= date_trunc('day', now() AT TIME ZONE 'America/Costa_Rica') AT TIME ZONE 'America/Costa_Rica'` para el día actual.
- `por_profesional`: ordenado por `citas_total DESC`.
- `snapshots_creados` y `examenes_subidos`: filtrados por el período seleccionado.
- Todas las queries llevan `clinica_id = $1` — sin excepción.

---

## SQL de referencia

```sql
-- KPIs de citas
SELECT
  COUNT(*)                                        AS citas_total,
  COUNT(*) FILTER (WHERE estado = 'completada')   AS citas_completadas,
  COUNT(*) FILTER (WHERE estado = 'cancelada')    AS citas_canceladas,
  COUNT(*) FILTER (WHERE estado = 'pendiente')    AS citas_pendientes
FROM cita
WHERE clinica_id  = $1
  AND activo      = true
  AND inicio     >= $2   -- inicio del período
  AND inicio     <  $3;  -- now()

-- Pacientes activos
SELECT COUNT(*) FROM paciente
WHERE clinica_id = $1 AND activo = true;

-- Pacientes nuevos en el período
SELECT COUNT(*) FROM paciente
WHERE clinica_id = $1 AND activo = true AND created_at >= $2;

-- Por profesional
SELECT
  p.id              AS profesional_id,
  p.nombre          AS nombre,
  COUNT(c.id)       AS citas_total,
  COUNT(c.id) FILTER (WHERE c.estado = 'completada') AS citas_completadas,
  (SELECT COUNT(*) FROM paciente pa
   WHERE pa.profesional_id = p.id
     AND pa.clinica_id     = $1
     AND pa.activo         = true)                   AS pacientes_activos
FROM profesional p
LEFT JOIN cita c ON c.profesional_id = p.id
                AND c.clinica_id     = $1
                AND c.activo         = true
                AND c.inicio        >= $2
WHERE p.clinica_id = $1
  AND p.activo     = true
GROUP BY p.id, p.nombre
ORDER BY citas_total DESC;

-- Snapshots creados
SELECT COUNT(*) FROM snapshot
WHERE clinica_id = $1 AND activo = true AND created_at >= $2;

-- Exámenes subidos
SELECT COUNT(*) FROM lab_exam
WHERE clinica_id = $1 AND created_at >= $2;
```

Ejecutar todo en paralelo (`Promise.all`) — son queries independientes.

---

## Frontend

### Ruta

`/admin/dashboard` — solo visible y accesible para `admin_clinica`.
Si un `nutricionista` accede directamente por URL → redirigir a `/`.

### Layout de la página

```
┌─────────────────────────────────────────────────────────────────┐
│  Dashboard                          [Hoy] [Semana] [Este mes]  │
├──────────┬──────────┬──────────┬──────────┬──────────┬─────────┤
│  Citas   │Completad.│Canceladas│Pendientes│ Pacientes│ Nuevos  │
│    42    │    31    │    4     │    7     │    68    │    9    │
│  del mes │  73.8%   │  9.5%   │  16.7%  │  activos │  mes   │
├──────────┴──────────┴──────────┴──────────┴──────────┴─────────┤
│  Agenda de hoy                                                  │
│  14:00  María López       Luis Mora      pendiente             │
│  15:30  Carlos Ramírez    Luis Mora      pendiente             │
├─────────────────────────────────────────────────────────────────┤
│  Por profesional          Citas  Completadas  Pacientes activos │
│  Luis Mora                  28        21           45           │
│  (sin asignar — si aplica)   4         4            —           │
└─────────────────────────────────────────────────────────────────┘
```

### Componentes

**`KpiTile`** — tarjeta reutilizable: número grande, etiqueta, valor secundario opcional (porcentaje o subtexto).

**`AgendaHoy`** — lista simple de citas del día. Si no hay citas: "No hay citas programadas para hoy." Horas en formato local (Costa Rica, UTC-6) usando `Intl.DateTimeFormat`.

**`TablaProfesionales`** — tabla con columnas: Profesional, Citas, % Completadas, Pacientes activos. Ordenada por citas descendente.

**`DashboardPage`** — orquesta los tres bloques. Al cambiar el selector de período, re-fetcha `/api/admin/dashboard?periodo=X`. Estado de carga con skeleton mientras llega la respuesta.

### Enlace de navegación

En el sidebar, visible solo para `admin_clinica`, enlace "Dashboard" arriba de "Identidad visual".

---

## Criterios de aceptación

### CA-08-01 — Solo admin ve la página
Dado que un `nutricionista` navega a `/admin/dashboard`,
entonces es redirigido a `/` sin ver datos.

### CA-08-02 — KPIs del período correcto
Dado que el admin selecciona "Este mes",
entonces todos los conteos corresponden al mes calendario actual en UTC.

### CA-08-03 — Aislamiento de tenant
Los KPIs, la agenda y la tabla de profesionales solo muestran datos de la clínica del admin.
Ninguna cifra de otras clínicas aparece aunque compartan Postgres.

### CA-08-04 — Agenda de hoy en hora local
Las citas de hoy se muestran en hora de Costa Rica (UTC-6),
no en UTC.

### CA-08-05 — Sin citas hoy
Dado que no hay citas para el día actual,
entonces la sección "Agenda de hoy" muestra "No hay citas programadas para hoy."

### CA-08-06 — Cambio de período recarga datos
Al hacer clic en "Hoy" / "Semana" / "Este mes",
los KPIs cambian sin recargar la página completa.

### CA-08-07 — Índices aplicados
La migración 010 crea ambos índices sin error y sin bloquear otras queries.

---

## Orden de implementación

1. `010_dashboard_indices.sql` — migración (índices CONCURRENTLY)
2. `apps/api/src/routes/admin.ts` — GET /api/admin/dashboard
3. `apps/api/src/server.ts` — registrar ruta
4. `KpiTile.tsx` — componente reutilizable
5. `AgendaHoy.tsx` — lista de citas de hoy
6. `TablaProfesionales.tsx` — tabla por profesional
7. `DashboardPage.tsx` — página principal con selector de período
8. Router + sidebar — ruta protegida y enlace de navegación
9. `docs/PRUEBAS.md` — sección Rebanada 8
10. Commit
