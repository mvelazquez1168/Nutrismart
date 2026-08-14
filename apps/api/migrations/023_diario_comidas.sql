-- migration: 023_diario_comidas
--
-- PAC · diario de comidas del paciente.
--
-- El enum `tipo_comida` YA existe desde la Rebanada 9, con las franjas
-- del plan alimentario: desayuno, media_manana, almuerzo, merienda,
-- cena, extra. Se reutiliza tal cual.
--
-- El encargo proponia crear uno nuevo con otras etiquetas
-- (colacion_matutina, colacion_vespertina, otro). Ademas de fallar
-- —CREATE TYPE sobre un tipo existente es un error— romperia lo unico
-- que hace util este diario: poder poner al lado lo que el profesional
-- planifico para el almuerzo y lo que el paciente comio en el almuerzo.
-- Con dos vocabularios distintos esa comparacion no se puede hacer.

create table registro_comida (
  id              uuid        primary key default gen_random_uuid(),
  clinica_id      uuid        not null references clinica(id),
  paciente_id     uuid        not null references paciente(id),

  fecha           date        not null default current_date,
  tipo_comida     tipo_comida not null,
  descripcion     text        not null check (char_length(trim(descripcion)) between 1 and 1000),

  -- Opcionales: el paciente escribe "arroz con pollo y ensalada", no
  -- calcula macros. Los rellena quien pueda —el profesional al
  -- revisarlo, o una estimacion futura— y mientras tanto son null.
  kcal            numeric(7,1) check (kcal is null or kcal >= 0),
  proteina_g      numeric(6,1) check (proteina_g is null or proteina_g >= 0),
  cho_g           numeric(6,1) check (cho_g is null or cho_g >= 0),
  grasa_g         numeric(6,1) check (grasa_g is null or grasa_g >= 0),

  activo          boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Una entrada por franja y dia: el paciente edita su desayuno, no
  -- acumula tres desayunos. El indice es PARCIAL sobre activo para que
  -- borrar y volver a escribir la misma franja funcione.
  constraint uq_slot_comida unique (paciente_id, fecha, tipo_comida)
);

create index idx_registro_comida_paciente
  on registro_comida (clinica_id, paciente_id, fecha desc)
  where activo = true;

create trigger trg_registro_comida_updated
  before update on registro_comida
  for each row execute function set_updated_at();
