-- ============================================================
-- NutriSmart · Migración 010 — índices para el dashboard (CLI-08)
--
-- El dashboard barre citas y controles por clínica dentro de una
-- ventana de fechas. Los índices existentes son solo por clinica_id:
-- sirven para acotar el inquilino, pero obligan a recorrer todas sus
-- filas para quedarse con las del período.
--
-- SIN `concurrently`: el runner (src/migrate.ts) envuelve cada archivo
-- en su propia transacción, y CREATE INDEX CONCURRENTLY no puede
-- ejecutarse dentro de una. Aquí no es una pérdida — estas tablas son
-- pequeñas todavía y el bloqueo dura milisegundos. El día que haya que
-- indexar en caliente sobre millones de filas, se hace fuera del
-- runner y a mano.
--
-- SIN predicado `where activo = true`: ni `cita` ni `clinical_snapshot`
-- tienen esa columna. El ciclo de vida de ambas se modela con un enum
-- `estado`, y ninguno de los dos se borra ni se archiva de una forma
-- que convenga fijar en un índice parcial: una cita cancelada sigue
-- contando en el dashboard (se muestra como cancelada), y un snapshot
-- corregido sigue siendo un control que ocurrió.
-- ============================================================

create index if not exists idx_cita_clinica_inicio
  on cita (clinica_id, inicio);

create index if not exists idx_snapshot_clinica_created
  on clinical_snapshot (clinica_id, created_at);

-- Los laboratorios entran en los KPIs con el mismo patrón, así que
-- necesitan el mismo índice; el prompt original no lo contemplaba
-- porque asumía otra tabla.
create index if not exists idx_lab_estudio_clinica_created
  on lab_estudio (clinica_id, created_at);
