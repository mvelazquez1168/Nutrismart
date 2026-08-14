-- ============================================================
-- NutriSmart · Migración 018 — conclusiones de la valoración (EVAL-05)
--
-- Cierra el ABCD: diagnóstico nutricional, recomendaciones,
-- prescripción dietética y acuerdos con el paciente.
--
-- A diferencia del historial y del dietético, la conclusión es DE LA
-- CONSULTA, no del paciente: es el juicio de ese día. La siguiente
-- consulta emite el suyo, y ambos quedan.
--
-- Sin BEGIN/COMMIT: el runner envuelve cada migración en su transacción.
-- ============================================================

create table conclusion_valoracion (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references clinica(id),
  paciente_id    uuid not null references paciente(id),
  consulta_id    uuid not null references consulta(id),
  profesional_id uuid not null references profesional(id),

  -- ---- Diagnóstico nutricional ----
  diagnostico_principal  text,
  diagnostico_cie10      text check (diagnostico_cie10 is null or char_length(diagnostico_cie10) <= 10),
  diagnostico_secundario text,
  observaciones_clinicas text,

  -- ["Aumentar proteína", "Hidratación 2 L/día"]
  recomendaciones jsonb not null default '[]',

  -- ---- Prescripción dietética ----
  kcal_prescritas int check (kcal_prescritas > 0 and kcal_prescritas <= 20000),
  pct_proteina int check (pct_proteina between 0 and 100),
  pct_cho      int check (pct_cho between 0 and 100),
  pct_grasa    int check (pct_grasa between 0 and 100),

  -- Derivados de kcal y porcentajes; los calcula la API.
  proteina_g numeric(6,2) check (proteina_g >= 0),
  cho_g      numeric(6,2) check (cho_g >= 0),
  grasa_g    numeric(6,2) check (grasa_g >= 0),

  restricciones jsonb not null default '[]',
  suplementos   text,

  -- [{ "texto": "Registrar la ingesta", "cumplido": false }]
  acuerdos jsonb not null default '[]',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /*
   * Si se declaran los tres porcentajes, tienen que sumar 100.
   *
   * Sin esta comprobación se puede guardar una prescripción de
   * 20/50/40, que suma 110: los gramos derivados serían coherentes
   * entre sí y aun así describirían una dieta que no existe.
   * Se permite que falten (los tres nulos) mientras la prescripción
   * está a medio escribir.
   */
  constraint conclusion_macros_suman_100 check (
    (pct_proteina is null and pct_cho is null and pct_grasa is null)
    or (pct_proteina + pct_cho + pct_grasa = 100)
  )
);

-- Una conclusión por consulta. La segunda sería una corrección, y para
-- eso se edita la que hay.
create unique index uq_conclusion_consulta on conclusion_valoracion (consulta_id);

create index idx_conclusion_paciente
  on conclusion_valoracion (clinica_id, paciente_id, created_at desc);

create trigger conclusion_set_updated_at
  before update on conclusion_valoracion
  for each row execute function set_updated_at();
