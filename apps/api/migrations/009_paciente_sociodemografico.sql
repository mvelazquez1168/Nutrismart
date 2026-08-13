-- ============================================================
-- NutriSmart · Migración 009 — sociodemografía del paciente (CLI-07)
--
-- Tabla aparte, 1-a-1 con paciente, en vez de columnas en `paciente`:
--   · Se puede leer el expediente sin traer estos datos.
--   · El consentimiento vive junto a lo que autoriza, no disperso.
--   · Ausencia de fila = no recolectado, que NO es lo mismo que
--     recolectado y vacío.
--   · Añadir o renombrar campos no toca la tabla del paciente.
--
-- Sin BEGIN/COMMIT: el runner envuelve cada migración en su propia
-- transacción. Abrir otra aquí confirmaría la de fuera y se perdería
-- la garantía de que una migración fallida no deja nada a medias.
-- ============================================================

-- ---- Tipos ----
-- Valores en español porque son dominio clínico que el profesional lee
-- y elige, no identificadores internos. Sin acentos ni eñes: un valor
-- de enum viaja por URL, JSON y volcados de base, y 'compañeros' se
-- rompe en el primer sistema que no hable UTF-8. La etiqueta bonita la
-- pone la interfaz.
create type nivel_actividad_fisica as enum ('sedentario', 'leve', 'moderada', 'intensa');
create type frecuencia_alcohol     as enum ('nunca', 'ocasional', 'frecuente');
create type nivel_escolaridad      as enum
  ('ninguna', 'primaria', 'secundaria', 'tecnica', 'universitaria', 'posgrado');
create type tipo_hogar             as enum
  ('solo', 'pareja', 'familia_nuclear', 'familia_extendida', 'companeros');

-- ---- Tabla ----
create table paciente_sociodemografico (
  paciente_id uuid primary key references paciente(id),

  -- clinica_id, aunque se pueda deducir por el paciente. Es la regla
  -- del proyecto: tenant en TODA tabla y en TODA query. Deducirlo por
  -- join significa que el día que alguien escriba una consulta sin ese
  -- join, la fuga entre clínicas no dará ningún error.
  clinica_id  uuid not null references clinica(id),

  -- ---- Actividad y hábitos ----
  nivel_actividad   nivel_actividad_fisica,
  horas_sueno       smallint check (horas_sueno between 1 and 24),
  tabaco            boolean,
  alcohol           frecuencia_alcohol,

  -- ---- Contexto social ----
  ocupacion         text check (char_length(ocupacion) <= 80),
  escolaridad       nivel_escolaridad,
  personas_en_hogar smallint check (personas_en_hogar between 1 and 20),
  tipo_hogar        tipo_hogar,

  -- ---- Consentimiento ----
  -- Lo único NOT NULL. Todo lo demás es opcional a propósito: la épica
  -- pide minimización, y un campo obligatorio empuja a inventar un
  -- valor cuando el paciente no lo ha dicho.
  consentimiento_otorgado       boolean not null default false,
  consentimiento_fecha          timestamptz,
  consentimiento_profesional_id uuid references profesional(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- La fecha y el profesional solo existen si hay consentimiento. Sin
  -- esto podría quedar una fila revocada que conserva quién y cuándo,
  -- que es justo el rastro que revocar debe borrar.
  constraint socio_consentimiento_coherente check (
    (consentimiento_otorgado = false
      and consentimiento_fecha is null
      and consentimiento_profesional_id is null)
    or
    (consentimiento_otorgado = true and consentimiento_fecha is not null)
  )
);

create index idx_socio_clinica on paciente_sociodemografico(clinica_id);

-- ---- Disparadores ----
-- set_updated_at() existe desde la migración 003.
create trigger socio_set_updated_at
  before update on paciente_sociodemografico
  for each row execute function set_updated_at();

/*
 * Invariante del consentimiento.
 *
 * Va en INSERT **y** en UPDATE. Solo en UPDATE —como se especificó
 * primero— el caso más común quedaría roto: la primera vez que un
 * profesional marca el consentimiento y guarda, la fila NACE con
 * otorgado = true, no hay UPDATE, y la fecha se quedaría nula. Se
 * estaría afirmando que hay consentimiento sin poder decir de cuándo.
 *
 * La fecha la pone la base, no la API: es un dato con valor probatorio
 * y no debe depender del reloj de quien llama.
 */
create or replace function fn_socio_consentimiento() returns trigger
language plpgsql as $$
begin
  if new.consentimiento_otorgado then
    -- Se sella al otorgar. En un UPDATE que ya venía otorgado NO se
    -- refresca: la fecha es la del consentimiento, no la del último
    -- retoque de un campo.
    if tg_op = 'INSERT' or not old.consentimiento_otorgado then
      new.consentimiento_fecha := now();
    end if;
  else
    -- Revocar borra el rastro de quién y cuándo autorizó. Los datos de
    -- contenido se conservan —trazabilidad clínica: aquí nada se borra
    -- físicamente— pero la API deja de exponerlos.
    new.consentimiento_fecha          := null;
    new.consentimiento_profesional_id := null;
  end if;
  return new;
end;
$$;

create trigger socio_consentimiento
  before insert or update on paciente_sociodemografico
  for each row execute function fn_socio_consentimiento();
