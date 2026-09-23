-- ============================================================
-- NutriSmart · Migración 042 — datos de la calculadora en la conclusión
--
-- La calculadora de requerimiento y dieta (R39) produce un bloque que
-- debe persistir junto a la conclusión y volver a cargarse al abrir la
-- valoración, sin reabrir la calculadora: meta calórica, método de dieta,
-- distribución de macros (con g/kg) y las líneas de intercambio con
-- porciones > 0.
--
-- Un solo campo jsonb: es un documento cerrado que se lee y escribe
-- entero, no se consulta por sus partes. Modelarlo en columnas o tablas
-- aparte no aportaría nada y ataría el esquema a una versión del cálculo.
-- ============================================================

alter table conclusion_valoracion
  add column if not exists datos_calculadora jsonb;
