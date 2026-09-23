-- ============================================================
-- NutriSmart · Migración 041 — plan alimentario: patrón de un día (R38)
--
-- Reemplaza la rejilla semanal (7 días × 6 comidas, con macros) por un
-- PATRÓN DIARIO: seis tiempos fijos, cada uno con un «patrón» (qué grupos
-- de alimentos lo componen) y un «ejemplo de menú» concreto. Desaparecen
-- la dimensión semanal y los macros por comida.
--
-- Los planes existentes son datos de demostración sin valor clínico: se
-- descartan. No hay nada que conservar ni una conversión sensata de la
-- semana a un solo patrón.
--
-- Sin BEGIN/COMMIT: el runner envuelve cada migración en su transacción.
-- ============================================================

-- 1. Descartar la tabla de comidas vieja y los planes de demo.
--    Al soltar plan_comida se va también su FK contra plan_alimentario,
--    así que el delete de las cabeceras ya no choca con nada.
drop table if exists plan_comida;
delete from plan_alimentario;

-- 2. Nuevo enum PROPIO del plan. Ojo: el enum viejo `tipo_comida` NO se
--    toca — lo comparte `registro_comida` (el diario del paciente, migr.
--    023), que sigue con sus franjas. El plan estrena su propio tipo para
--    no arrastrar al diario en este cambio. El orden de declaración es el
--    cronológico del día: un ORDER BY sobre la columna enum devuelve las
--    comidas en ese orden sin criterio aparte.
create type tiempo_comida_plan as enum (
  'desayuno',
  'merienda_am',
  'almuerzo',
  'merienda_pm',
  'cena',
  'colacion_nocturna'
);

-- 3. plan_comida rehecha: una fila por tiempo de comida, no por día.
create table plan_comida (
  id           uuid primary key default gen_random_uuid(),

  -- clinica_id aunque se deduzca por el plan: es la regla del proyecto
  -- —tenant en TODA tabla— para que una consulta sin el join no filtre
  -- entre clínicas sin dar ningún error.
  clinica_id   uuid not null references clinica(id),
  plan_id      uuid not null references plan_alimentario(id) on delete cascade,

  tipo_comida  tiempo_comida_plan not null,

  -- Los dos textos son OPCIONALES: una franja del día puede quedar sin
  -- prescribir. Una fila con ambos vacíos no se guarda (lo filtra la API).
  patron        text check (patron is null or char_length(patron) <= 1000),
  ejemplo_menu  text check (ejemplo_menu is null or char_length(ejemplo_menu) <= 1000),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Una sola entrada por tiempo de comida dentro del plan.
  unique (plan_id, tipo_comida)
);

create index idx_plan_comida_plan on plan_comida(plan_id);

create trigger plan_comida_set_updated_at
  before update on plan_comida
  for each row execute function set_updated_at();
