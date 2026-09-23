Implementa la Rebanada 8: dashboard administrativo de clínica (CLI-08).
Lee docs/REBANADA-08.md antes de empezar. Sigue el orden exacto y adapta
nombres al código real del proyecto (ya conoces la convención del proyecto).

────────────────────────────────────────────────────────────
PASO 1 — MIGRACIÓN
────────────────────────────────────────────────────────────

Crea apps/api/migrations/010_dashboard_indices.sql.

IMPORTANTE: verifica primero si el runner de migrate.ts envuelve cada archivo
en una transacción propia. Si lo hace, CREATE INDEX CONCURRENTLY fallará porque
CONCURRENTLY no puede ejecutarse dentro de una transacción explícita. En ese
caso usa CREATE INDEX IF NOT EXISTS (sin CONCURRENTLY). Examina migrate.ts y
decide antes de escribir el archivo.

Contenido (ajusta CONCURRENTLY según lo anterior):

```sql
-- migration: 010_dashboard_indices
BEGIN;

CREATE INDEX IF NOT EXISTS idx_cita_clinica_inicio
  ON cita (clinica_id, inicio)
  WHERE activo = true;

CREATE INDEX IF NOT EXISTS idx_snapshot_clinica_created
  ON snapshot (clinica_id, created_at)
  WHERE activo = true;

COMMIT;
```

Ejecuta npm run migrate en apps/api y confirma que ambos índices aparecen
en pg_indexes antes de continuar.

────────────────────────────────────────────────────────────
PASO 2 — RUTA API
────────────────────────────────────────────────────────────

Crea apps/api/src/routes/admin.ts.

Lee primero cómo las rutas existentes (por ejemplo laboratorios.ts o
sociodemografico.ts) extraen tenantId y verifican el rol del token.
Sigue ese mismo patrón exacto — no inventes uno nuevo.

El endpoint es GET /api/admin/dashboard con query param ?periodo=hoy|semana|mes
(default: mes). Responde 403 si el rol no es admin_clinica.

Lógica de ventana de tiempo:
- hoy: desde las 00:00:00 del día actual hasta now()
- semana: desde hace 7 días hasta now()
- mes: desde el día 1 del mes actual hasta now()

Ejecuta estas 7 queries en paralelo con Promise.all. Antes de escribirlas,
lee el schema real del proyecto para confirmar:
  - Nombre exacto de la tabla de exámenes de laboratorio (¿lab_exam? ¿otra?)
  - Si cita tiene columna fin o se calcula con trigger
  - Nombre exacto de la columna de estado en cita y sus valores posibles
  - Si profesional tiene columna nombre o nombre_completo

Queries (adapta nombres según lo que encuentres):

1. KPIs de citas:
SELECT
  COUNT(*)                                              AS citas_total,
  COUNT(*) FILTER (WHERE estado = 'completada')         AS citas_completadas,
  COUNT(*) FILTER (WHERE estado = 'cancelada')          AS citas_canceladas,
  COUNT(*) FILTER (WHERE estado NOT IN ('completada','cancelada')) AS citas_pendientes
FROM cita
WHERE clinica_id = $1 AND activo = true
  AND inicio >= $2 AND inicio < $3;

2. Pacientes activos (sin filtro de período):
SELECT COUNT(*) FROM paciente
WHERE clinica_id = $1 AND activo = true;

3. Pacientes nuevos en el período:
SELECT COUNT(*) FROM paciente
WHERE clinica_id = $1 AND activo = true AND created_at >= $2;

4. Snapshots creados en el período:
SELECT COUNT(*) FROM snapshot
WHERE clinica_id = $1 AND activo = true AND created_at >= $2;

5. Exámenes subidos en el período:
SELECT COUNT(*) FROM <tabla_real_lab_exam>
WHERE clinica_id = $1 AND created_at >= $2;

6. Agenda de hoy (siempre día actual en Costa Rica, ignora ?periodo):
SELECT
  c.id             AS cita_id,
  c.inicio         AS hora_inicio,
  c.fin            AS hora_fin,
  pac.nombre       AS paciente_nombre,
  pro.nombre       AS profesional_nombre,
  c.estado
FROM cita c
JOIN paciente    pac ON pac.id = c.paciente_id
JOIN profesional pro ON pro.id = c.profesional_id
WHERE c.clinica_id = $1
  AND c.activo = true
  AND (c.inicio AT TIME ZONE 'America/Costa_Rica')::date
      = (now() AT TIME ZONE 'America/Costa_Rica')::date
ORDER BY c.inicio ASC;

7. Por profesional (citas del período):
SELECT
  p.id   AS profesional_id,
  p.nombre,
  COUNT(c.id)                                            AS citas_total,
  COUNT(c.id) FILTER (WHERE c.estado = 'completada')     AS citas_completadas,
  (SELECT COUNT(*) FROM paciente pa
   WHERE pa.profesional_id = p.id
     AND pa.clinica_id     = $1
     AND pa.activo         = true)                       AS pacientes_activos
FROM profesional p
LEFT JOIN cita c ON c.profesional_id = p.id
               AND c.clinica_id      = $1
               AND c.activo          = true
               AND c.inicio         >= $2
               AND c.inicio          < $3
WHERE p.clinica_id = $1 AND p.activo = true
GROUP BY p.id, p.nombre
ORDER BY citas_total DESC;

Ensambla la respuesta con esta estructura:
{
  periodo, generado_en,
  kpis: { citas_total, citas_completadas, citas_canceladas, citas_pendientes,
          pacientes_activos, pacientes_nuevos, snapshots_creados, examenes_subidos },
  agenda_hoy: [...],
  por_profesional: [...]
}

────────────────────────────────────────────────────────────
PASO 3 — REGISTRAR RUTA
────────────────────────────────────────────────────────────

Lee apps/api/src/server.ts y registra adminRoutes siguiendo el mismo
patrón que las otras rutas. Importa del archivo que acabas de crear.

────────────────────────────────────────────────────────────
PASO 4 — KpiTile
────────────────────────────────────────────────────────────

Crea apps/web-professional/src/components/KpiTile.tsx:

```tsx
interface KpiTileProps {
  label: string;
  valor: number;
  secundario?: string;
  colorClass?: string;
}

export default function KpiTile({ label, valor, secundario, colorClass = 'text-gray-900' }: KpiTileProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-1">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-3xl font-bold tabular-nums ${colorClass}`}>
        {valor.toLocaleString('es-CR')}
      </span>
      {secundario && <span className="text-xs text-gray-400">{secundario}</span>}
    </div>
  );
}
```

────────────────────────────────────────────────────────────
PASO 5 — AgendaHoy
────────────────────────────────────────────────────────────

Crea apps/web-professional/src/components/AgendaHoy.tsx.

Recibe un array de citas. Formatea hora_inicio con Intl.DateTimeFormat en
'America/Costa_Rica', formato HH:MM. Si el array está vacío muestra:
"No hay citas programadas para hoy."

Cada fila: hora · nombre del paciente · nombre del profesional · badge de estado.
Usa los mismos colores de badge de estado que ya existen en el proyecto
(busca cómo se renderizan en la vista de agenda o en la ficha del paciente).

────────────────────────────────────────────────────────────
PASO 6 — TablaProfesionales
────────────────────────────────────────────────────────────

Crea apps/web-professional/src/components/TablaProfesionales.tsx.

Columnas: Profesional · Citas · % Completadas · Pacientes activos.
% Completadas: (completadas / total * 100).toFixed(1) + '%'; si total = 0 → '—'.
Si el array está vacío: "No hay profesionales registrados."

────────────────────────────────────────────────────────────
PASO 7 — DashboardPage
────────────────────────────────────────────────────────────

Crea apps/web-professional/src/pages/DashboardPage.tsx.

Estado: periodo ('hoy'|'semana'|'mes'), datos (respuesta de la API), cargando.

Al montar y al cambiar periodo: fetch a /api/admin/dashboard?periodo=X
con el token del auth context del proyecto (sigue el patrón de las otras páginas).

Mientras cargando: muestra divs grises animados (skeleton) en lugar de los tiles.

Layout:
1. Encabezado con título "Dashboard" y selector de tres botones
   [Hoy] [Semana] [Este mes] — el activo con bg-primary text-white,
   los inactivos con border border-gray-200.

2. Grid de 6 KpiTiles (2 columnas en móvil, 3 en tablet, 6 en desktop):
   - Citas del período        → kpis.citas_total
   - Completadas              → kpis.citas_completadas  (secundario: porcentaje)
   - Canceladas               → kpis.citas_canceladas   (colorClass rojo si > 0)
   - Pendientes               → kpis.citas_pendientes
   - Pacientes activos        → kpis.pacientes_activos  (secundario: "activos")
   - Nuevos en el período     → kpis.pacientes_nuevos

3. Sección "Agenda de hoy" con <AgendaHoy citas={datos.agenda_hoy} />

4. Sección "Por profesional" con <TablaProfesionales profesionales={datos.por_profesional} />

────────────────────────────────────────────────────────────
PASO 8 — ROUTER Y SIDEBAR
────────────────────────────────────────────────────────────

Lee el archivo de rutas del proyecto.
Agrega la ruta /admin/dashboard apuntando a DashboardPage.
Protégela: si el rol del usuario no es admin_clinica, redirige a /.
Sigue el mismo patrón de protección por rol que ya existe en el proyecto.

En el sidebar, agrega enlace "Dashboard" visible solo para admin_clinica,
encima del enlace "Identidad visual" (Configuración de marca, R6).

────────────────────────────────────────────────────────────
PASO 9 — VERIFICACIÓN
────────────────────────────────────────────────────────────

1. npm run migrate → índices creados sin error.
2. GET /api/admin/dashboard?periodo=mes con token de ana@vida.cr → 200 con estructura completa.
3. GET con token de luis@vida.cr → 403.
4. Compila el frontend sin errores TypeScript: npm run build en apps/web-professional.
5. En el navegador con ana@vida.cr → /admin/dashboard carga tiles, agenda y tabla.
6. Cambiar entre Hoy / Semana / Este mes → números cambian sin recargar página.
7. Con luis@vida.cr → /admin/dashboard redirige a /.

────────────────────────────────────────────────────────────
PASO 10 — PRUEBAS.md Y COMMIT
────────────────────────────────────────────────────────────

Agrega al final de docs/PRUEBAS.md la sección "Rebanada 8 — Dashboard
Administrativo" con los casos CA-08-01 a CA-08-07 en formato PowerShell,
siguiendo el estilo de las secciones anteriores.

Commit con este mensaje exacto:

R8: dashboard administrativo de clínica (CLI-08)

- Índices en cita y snapshot para queries del dashboard
- GET /api/admin/dashboard con KPIs, agenda de hoy y métricas por profesional
- KpiTile, AgendaHoy, TablaProfesionales como componentes reutilizables
- DashboardPage con selector de período (hoy/semana/mes)
- Ruta /admin/dashboard protegida para admin_clinica
- Enlace en sidebar solo visible para admin_clinica
- docs/REBANADA-08.md y sección R8 en PRUEBAS.md

git push origin main y reporta el hash del commit.
