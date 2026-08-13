-- ============================================================
-- NutriSmart · Migración 004 — expediente y timeline clínico
-- Rebanada 3 (CLI-01). Define el modelo clínico central del que
-- dependerán EVAL, RPM, la IA y las gráficas.
--
-- Regla que atraviesa todo: nada se borra ni se reescribe. Un snapshot
-- cerrado es inmutable; corregirlo crea una versión nueva enlazada.
-- ============================================================

create type snapshot_estado  as enum ('borrador','cerrado','corregido');
create type antecedente_tipo as enum ('personal','familiar','quirurgico');

-- ------------------------------------------------------------
-- Catálogo de métricas
--
-- Tabla y no enum: añadir "circunferencia de cadera" o "porcentaje de
-- músculo" no debe costar una migración.
--
-- Es GLOBAL, no por clínica: son medidas antropométricas estándar y un
-- catálogo por tenant haría incomparables las series entre clínicas sin
-- ninguna ganancia real.
--
-- OJO con min/max: son cotas de SENSATEZ para atajar erratas de tecleo
-- (un peso de 700 kg), no rangos clínicos de normalidad. Marcar a un
-- paciente como anómalo es competencia del motor de monitoreo, no de
-- una restricción de captura.
-- ------------------------------------------------------------
create table metrica_catalogo (
  codigo        text primary key,
  nombre        text     not null,
  unidad        text     not null,
  decimales     smallint not null default 1,
  min_plausible numeric,
  max_plausible numeric,
  orden         smallint not null default 0,
  activo        boolean  not null default true
);

comment on column metrica_catalogo.min_plausible is
  'Cota de sensatez para detectar erratas de captura, NO rango clínico.';

insert into metrica_catalogo (codigo, nombre, unidad, decimales, min_plausible, max_plausible, orden) values
  ('peso',               'Peso',                      'kg',    1,  2,  400, 10),
  ('talla',              'Talla',                     'cm',    1, 30,  260, 20),
  ('cintura',            'Circunferencia de cintura', 'cm',    1, 30,  250, 30),
  ('presion_sistolica',  'Presión sistólica',         'mmHg',  0, 50,  300, 40),
  ('presion_diastolica', 'Presión diastólica',        'mmHg',  0, 30,  200, 50),
  ('glucosa_ayunas',     'Glucosa en ayunas',         'mg/dL', 0, 20,  800, 60),
  ('grasa_corporal',     'Grasa corporal',            '%',     1,  1,   80, 70)
on conflict (codigo) do nothing;

-- El IMC NO está en el catálogo a propósito: se calcula (peso/talla²) en
-- cada consulta y nunca se almacena. Un IMC guardado puede acabar
-- contradiciendo al peso que lo originó.

-- ------------------------------------------------------------
-- Snapshot clínico: la unidad temporal del timeline
-- ------------------------------------------------------------
create table clinical_snapshot (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references clinica(id),
  paciente_id    uuid not null references paciente(id),
  profesional_id uuid references profesional(id),
  -- Fecha CLÍNICA del control, que no tiene por qué ser la de captura:
  -- una consulta del viernes puede registrarse el lunes.
  fecha          date not null,
  estado         snapshot_estado not null default 'borrador',
  cerrado_at     timestamptz,
  corrige_a_id   uuid references clinical_snapshot(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index idx_snapshot_paciente on clinical_snapshot(paciente_id, fecha desc);
create index idx_snapshot_clinica  on clinical_snapshot(clinica_id);
create index idx_snapshot_corrige  on clinical_snapshot(corrige_a_id);

-- Un solo borrador abierto por paciente. Dos serían dos versiones de la
-- verdad, sin nada que decidiera cuál gana. El índice parcial lo impide
-- en la base, no solo en la API.
create unique index idx_snapshot_un_borrador
  on clinical_snapshot(paciente_id)
  where estado = 'borrador';

-- Cerrado o corregido implica que hubo cierre, y por tanto fecha.
alter table clinical_snapshot
  add constraint snapshot_cerrado_con_fecha
  check (estado = 'borrador' or cerrado_at is not null);

-- Un snapshot no puede corregirse a sí mismo.
alter table clinical_snapshot
  add constraint snapshot_no_se_autocorrige
  check (corrige_a_id is null or corrige_a_id <> id);

-- Reutiliza la función creada en la migración 003.
create trigger snapshot_set_updated_at
  before update on clinical_snapshot
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- Métricas del snapshot
--
-- Esta tabla ES la serie longitudinal: una fila por (snapshot, métrica).
-- No hace falta una tabla aparte de series temporales — la consulta con
-- lag() sobre los snapshots ordenados por fecha da la evolución.
-- ------------------------------------------------------------
create table snapshot_metrica (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references clinica(id),
  snapshot_id    uuid not null references clinical_snapshot(id),
  metrica_codigo text not null references metrica_catalogo(codigo),
  valor          numeric not null,
  created_at     timestamptz not null default now(),
  unique (snapshot_id, metrica_codigo)
);

create index idx_snapmetrica_snapshot on snapshot_metrica(snapshot_id);
-- Para recorrer la serie de una métrica concreta de un paciente.
create index idx_snapmetrica_codigo   on snapshot_metrica(metrica_codigo);

-- ------------------------------------------------------------
-- Nota narrativa
--
-- Una por snapshot (de ahí el unique). El versionado lo aporta el propio
-- snapshot: dos mecanismos de versionado conviviendo acabarían
-- contradiciéndose sobre cuál es la nota vigente.
-- ------------------------------------------------------------
create table clinical_note (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references clinica(id),
  snapshot_id    uuid not null references clinical_snapshot(id) unique,
  profesional_id uuid references profesional(id),
  texto          text not null,
  created_at     timestamptz not null default now()
);

create index idx_note_clinica on clinical_note(clinica_id);

-- ------------------------------------------------------------
-- Antecedentes
--
-- CLI-01 los pide en el expediente y hasta ahora no tenían dónde vivir.
-- Baja lógica por 'activo', como diagnósticos y alergias.
-- ------------------------------------------------------------
create table paciente_antecedente (
  id          uuid primary key default gen_random_uuid(),
  clinica_id  uuid not null references clinica(id),
  paciente_id uuid not null references paciente(id),
  tipo        antecedente_tipo not null,
  descripcion text not null,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (paciente_id, tipo, descripcion)
);

create index idx_antecedente_paciente on paciente_antecedente(paciente_id);
create index idx_antecedente_clinica  on paciente_antecedente(clinica_id);
