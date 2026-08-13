-- ============================================================
-- NutriSmart · Migración 006 — agenda y citas
-- Rebanada 4 (CLI-03).
--
-- La regla que define esta tabla es "un profesional no puede estar en
-- dos sitios a la vez", y vive en la BASE, no en una comprobación
-- previa de la API: entre el SELECT que busca choques y el INSERT cabe
-- otra cita. Es la misma carrera que ya nos costó el numero_expediente.
-- ============================================================

-- Necesaria para combinar igualdad (uuid) con solape (rango) en un
-- mismo índice GiST. Sin ella, la restricción de exclusión no se puede
-- crear sobre profesional_id.
create extension if not exists btree_gist;

create type cita_tipo   as enum ('primera_vez','seguimiento','control');
create type cita_estado as enum ('programada','completada','cancelada');

comment on type cita_estado is
  'programada = pendiente. completada = ocurrió, puede generar un control '
  'clínico. cancelada = no ocurrió; libera la franja y NO se borra.';

create table cita (
  id               uuid primary key default gen_random_uuid(),
  clinica_id       uuid not null references clinica(id),
  paciente_id      uuid not null references paciente(id),
  profesional_id   uuid not null references profesional(id),

  inicio           timestamptz not null,

  -- SIN default a propósito. Un default en el esquema disimularía el
  -- dato faltante en cualquier inserción que lo omita, y de este campo
  -- depende la detección de solapes. Los 60 minutos los propone el
  -- formulario, que es donde el profesional puede verlos y cambiarlos.
  duracion_minutos integer not null,

  -- Derivada de inicio + duracion, pero NO es una columna generada:
  -- 'timestamptz + interval' está marcado STABLE en Postgres (el
  -- resultado depende del huso para componentes de día o mes) y una
  -- columna generada exige una expresión inmutable. Se mantiene con un
  -- disparador, que además garantiza que nadie pueda escribir aquí un
  -- fin que contradiga a sus dos orígenes.
  fin              timestamptz not null,

  tipo             cita_tipo   not null,
  estado           cita_estado not null default 'programada',
  notas            text,

  -- Control clínico que generó esta cita. Nullable: no toda cita
  -- produce uno. Único: un snapshot pertenece como mucho a una cita.
  snapshot_id      uuid unique references clinical_snapshot(id),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Cota de sensatez, no regla de negocio: 5 minutos es lo mínimo que
  -- tiene sentido agendar y 8 horas ya no es una consulta.
  constraint cita_duracion_razonable check (duracion_minutos between 5 and 480)
);

-- ------------------------------------------------------------
-- 'fin' siempre derivado, nunca escrito a mano.
--
-- BEFORE, para que el valor esté puesto antes de que se evalúen el NOT
-- NULL y la restricción de exclusión. Se recalcula también al editar:
-- mover una cita o cambiarle la duración debe reajustar el intervalo
-- que ocupa, o el control de solapes miraría una franja obsoleta.
-- ------------------------------------------------------------
create or replace function cita_calcular_fin() returns trigger as $$
begin
  new.fin := new.inicio + make_interval(mins => new.duracion_minutos);
  return new;
end;
$$ language plpgsql;

create trigger cita_fin
  before insert or update of inicio, duracion_minutos on cita
  for each row execute function cita_calcular_fin();

-- ------------------------------------------------------------
-- Sin solapes por profesional
--
-- Dos nutricionistas SÍ pueden atender a la vez, así que la igualdad va
-- sobre profesional_id y no sobre clinica_id.
--
-- Las canceladas quedan fuera: una cita que no va a ocurrir no debe
-- reservar la franja. Y como cancelar es un cambio de estado y nunca un
-- borrado, la fila sigue ahí para la trazabilidad.
--
-- El rango es [inicio, fin): una cita que acaba a las 16:00 no choca
-- con otra que empieza a las 16:00.
-- ------------------------------------------------------------
alter table cita
  add constraint cita_sin_solape
  exclude using gist (
    profesional_id         with =,
    tstzrange(inicio, fin) with &&
  ) where (estado <> 'cancelada');

create index idx_cita_clinica            on cita(clinica_id);
create index idx_cita_paciente           on cita(paciente_id);
-- Consulta principal de la agenda: las citas de un profesional en un rango.
create index idx_cita_profesional_inicio on cita(profesional_id, inicio);

create trigger cita_set_updated_at
  before update on cita
  for each row execute function set_updated_at();
