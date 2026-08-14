-- ============================================================
-- NutriSmart · Migración 017 — historial clínico y dietético (EVAL-03, EVAL-04)
--
-- Historial y evaluación dietética son UNO por paciente y se actualizan
-- consulta a consulta; `consulta_id` registra en cuál se tocaron por
-- última vez. Es distinto de la antropometría, que crea una fila por
-- consulta: un peso es de un día concreto, mientras que "el padre tiene
-- diabetes" no deja de ser cierto en la consulta siguiente.
--
-- Sin BEGIN/COMMIT: el runner envuelve cada migración en su transacción.
-- ============================================================

create table historial_clinico (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references clinica(id),
  paciente_id    uuid not null references paciente(id),
  -- Última consulta en la que se actualizó, no "la consulta a la que
  -- pertenece": el historial es del paciente.
  consulta_id    uuid references consulta(id),
  profesional_id uuid not null references profesional(id),

  -- APF: [{ "condicion": "diabetes", "parientes": "madre, padre" }]
  apf jsonb not null default '[]',
  -- APP: [{ "condicion": "hipertension", "desde": "2020" }]
  app jsonb not null default '[]',

  -- ---- Actividad física ----
  tipo_actividad    text,
  sesiones_semana   int check (sesiones_semana between 0 and 21),
  duracion_min      int check (duracion_min between 0 and 600),
  -- Factor de actividad física. Se guarda calculado para que el
  -- histórico conserve el valor que se usó, aunque la tabla de
  -- referencia cambie más adelante.
  faf               numeric(4,3) check (faf between 1 and 3),
  actividad_detalle text,

  -- ---- Sustancias ----
  fuma             boolean,
  alcohol          boolean,
  otras_sustancias text,

  -- ['distension','estrenimiento',…]
  sintomas_gi jsonb not null default '[]',
  gi_detalle  text,

  -- ---- Relación con los alimentos (tamizaje, escala 1-5) ----
  -- Nulos si no se respondió: "no preguntado" no es "nunca".
  alimentacion_emocional smallint check (alimentacion_emocional between 1 and 5),
  salteo_comidas         smallint check (salteo_comidas between 1 and 5),
  atracones              smallint check (atracones between 1 and 5),
  culpa_al_comer         smallint check (culpa_al_comer between 1 and 5),
  dietas_frecuentes      smallint check (dietas_frecuentes between 1 and 5),

  notas_adicionales text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /*
   * UN historial por paciente. Sin esta restricción el ON CONFLICT de
   * la API no tiene a qué agarrarse —Postgres exige un índice único que
   * coincida con la especificación del conflicto— y el guardado falla
   * con un error que no dice nada al profesional.
   */
  constraint historial_por_paciente unique (clinica_id, paciente_id)
);

create index idx_historial_paciente on historial_clinico (clinica_id, paciente_id);

create trigger historial_set_updated_at
  before update on historial_clinico
  for each row execute function set_updated_at();

create table farmacologia (
  id          uuid primary key default gen_random_uuid(),
  clinica_id  uuid not null references clinica(id),
  paciente_id uuid not null references paciente(id),

  nombre     text not null check (char_length(trim(nombre)) between 1 and 200),
  dosis      text,
  frecuencia text,
  desde      date,

  -- Baja lógica: un medicamento suspendido explica hallazgos pasados.
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_farm_paciente on farmacologia (clinica_id, paciente_id, activo);

create trigger farmacologia_set_updated_at
  before update on farmacologia
  for each row execute function set_updated_at();

create table evaluacion_dietetica (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references clinica(id),
  paciente_id    uuid not null references paciente(id),
  consulta_id    uuid references consulta(id),
  profesional_id uuid not null references profesional(id),

  -- [{ "hora":"07:00", "tipo":"desayuno",
  --    "alimentos":[{"nombre":"Avena","cantidad":40,"unidad":"g","kcal":150}] }]
  recordatorio_24h jsonb not null default '[]',

  -- { "cereales": "4-6_semana", "carnes_rojas": "1_semana", … }
  frecuencia_consumo jsonb not null default '{}',

  hidratacion_litros numeric(4,2) check (hidratacion_litros >= 0 and hidratacion_litros <= 20),

  -- Los macros los declara o ajusta el profesional. No se derivan del
  -- recordatorio: hacerlo exigiría una tabla de composición de
  -- alimentos, que es otra épica.
  kcal_estimadas int check (kcal_estimadas >= 0 and kcal_estimadas <= 20000),
  proteina_g numeric(6,2) check (proteina_g >= 0),
  cho_g      numeric(6,2) check (cho_g >= 0),
  grasa_g    numeric(6,2) check (grasa_g >= 0),
  fibra_g    numeric(6,2) check (fibra_g >= 0),

  notas_dieteticas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint dietetico_por_paciente unique (clinica_id, paciente_id)
);

create index idx_dietetico_paciente on evaluacion_dietetica (clinica_id, paciente_id);

create trigger dietetico_set_updated_at
  before update on evaluacion_dietetica
  for each row execute function set_updated_at();
