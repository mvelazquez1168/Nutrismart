-- ============================================================
-- NutriSmart · Migración 011 — plan alimentario semanal (CLI-09)
--
-- Un plan es la prescripción de la semana: siete días por seis
-- momentos de comida. La rejilla es fija a propósito — no se modela
-- "comidas libres" porque el profesional necesita comparar el lunes de
-- un plan con el lunes de otro.
--
-- Sin BEGIN/COMMIT: el runner envuelve cada migración en su propia
-- transacción. Abrir otra aquí confirmaría la de fuera y se perdería la
-- garantía de que una migración fallida no deja nada a medias.
-- ============================================================

create type estado_plan as enum ('borrador', 'activo', 'archivado');

-- Sin acentos ni eñes: un valor de enum viaja por URL, JSON y volcados
-- de base. La etiqueta bonita ("Med. mañana") la pone la interfaz.
create type tipo_comida as enum (
  'desayuno', 'media_manana', 'almuerzo', 'merienda', 'cena', 'extra'
);

create table plan_alimentario (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references clinica(id),
  paciente_id    uuid not null references paciente(id),
  -- Quién lo prescribió. No es el dueño del paciente: un plan lo puede
  -- redactar un profesional distinto del nutricionista asignado.
  profesional_id uuid not null references profesional(id),

  nombre         text not null check (char_length(nombre) between 1 and 120),
  objetivo       text check (char_length(objetivo) <= 500),
  fecha_inicio   date,
  fecha_fin      date,
  estado         estado_plan not null default 'borrador',
  notas          text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Un plan que termina antes de empezar no es un error del usuario que
  -- convenga tolerar: es un dato que luego nadie sabe interpretar.
  constraint plan_fechas_coherentes check (
    fecha_inicio is null or fecha_fin is null or fecha_fin >= fecha_inicio
  )
);

create index idx_plan_paciente on plan_alimentario(clinica_id, paciente_id);

/*
 * Un solo plan ACTIVO por paciente.
 *
 * Índice parcial, no un check: dos planes activos serían dos
 * prescripciones simultáneas sin nada que decidiera cuál sigue el
 * paciente. Los borradores y los archivados no se limitan — se pueden
 * preparar varios y conservar el histórico entero.
 *
 * La API traduce la violación (23505) a un 409 con instrucciones, en
 * vez de dejar salir un error de base.
 */
create unique index idx_plan_activo_por_paciente
  on plan_alimentario (clinica_id, paciente_id)
  where estado = 'activo';

create trigger plan_alimentario_set_updated_at
  before update on plan_alimentario
  for each row execute function set_updated_at();

create table plan_comida (
  id          uuid primary key default gen_random_uuid(),

  -- clinica_id aunque se pueda deducir por el plan. Es la regla del
  -- proyecto —tenant en TODA tabla— y la misma decisión que ya tomaron
  -- lab_resultado y snapshot_metrica: deducirlo por join significa que
  -- el día que alguien escriba una consulta sin ese join, la fuga entre
  -- clínicas no dará ningún error.
  clinica_id  uuid not null references clinica(id),
  plan_id     uuid not null references plan_alimentario(id) on delete cascade,

  -- 1 = lunes … 7 = domingo (ISO-8601). Se fija el criterio aquí para
  -- que la interfaz no tenga que adivinar dónde empieza la semana.
  dia_semana  smallint not null check (dia_semana between 1 and 7),
  tipo_comida tipo_comida not null,

  descripcion text not null check (char_length(descripcion) between 1 and 1000),

  -- Los macros son OPCIONALES. Obligarlos convertiría cada celda en un
  -- ejercicio de cálculo y el profesional acabaría inventando cifras
  -- para poder guardar.
  calorias_kcal   smallint check (calorias_kcal > 0),
  proteinas_g     numeric(5,1) check (proteinas_g >= 0),
  carbohidratos_g numeric(5,1) check (carbohidratos_g >= 0),
  grasas_g        numeric(5,1) check (grasas_g >= 0),

  notas       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Una sola entrada por celda de la rejilla. Dos desayunos del lunes
  -- serían dos indicaciones para el mismo momento.
  unique (plan_id, dia_semana, tipo_comida)
);

create index idx_plan_comida_plan on plan_comida(plan_id);

create trigger plan_comida_set_updated_at
  before update on plan_comida
  for each row execute function set_updated_at();
