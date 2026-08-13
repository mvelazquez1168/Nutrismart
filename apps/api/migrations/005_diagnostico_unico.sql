-- ============================================================
-- NutriSmart · Migración 005 — unicidad en paciente_diagnostico
--
-- Cierra la asimetría que quedó en la 003: paciente_alergia recibió
-- entonces su restricción única y 'activo', pero paciente_diagnostico
-- solo tenía 'activo' (de la 002). Sin unique:
--
--   · el "on conflict do nothing" del seed no detecta nada, porque no
--     hay conflicto que detectar;
--   · dos ediciones simultáneas del mismo paciente pueden insertar el
--     mismo diagnóstico dos veces;
--   · la reconciliación de listas del PUT tiene que usar "not exists"
--     en lugar de un upsert, que es más frágil bajo concurrencia.
--
-- paciente_id ya identifica la clínica de forma unívoca, así que no
-- hace falta clinica_id en la clave — igual que en paciente_alergia.
-- ============================================================

alter table paciente_diagnostico
  add constraint paciente_diagnostico_unico unique (paciente_id, descripcion);
