-- ============================================================
-- NutriSmart · Migración 045 — nota del profesional (R41, cambio 2)
--
-- Una nota por PACIENTE, no por consulta: es la libreta del profesional
-- sobre esa persona —lo que conviene recordar antes de abrirle la puerta—
-- y por eso vive al pie del expediente y no dentro de una valoración.
--
-- No la sustituye a nada versionado: las notas de consulta siguen en
-- `clinical_note` (migr. 043) y las notas del historial clínico en
-- `historial_clinico.notas_adicionales`. Esta es la capa de arriba.
--
-- Nunca se expone al paciente: ninguna ruta de `apps/web-patient` la lee.
-- ============================================================

alter table paciente
  add column if not exists nota_profesional text;

comment on column paciente.nota_profesional is
  'Nota libre del profesional sobre el paciente. Solo visible para el equipo clínico. R41.';
