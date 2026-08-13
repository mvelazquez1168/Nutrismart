-- ============================================================
-- NutriSmart · Migración 003 — ciclo de vida del paciente
-- Prepara la Rebanada 2 (alta, edición, baja lógica) cerrando los
-- huecos entre el contrato de docs/REBANADA-02.md y el esquema real.
-- ============================================================

-- ------------------------------------------------------------
-- 1. documento_tipo pasa de texto libre a enum
--
-- Como texto libre acabarían conviviendo 'cedula', 'Cédula' y 'CED'
-- para el mismo concepto, y ningún filtro los agruparía.
--
-- El USING convierte lo existente; el nullif() trata la cadena vacía
-- como ausencia de dato. Si alguna fila tuviera un valor fuera de la
-- lista, la migración FALLA — es lo correcto: mejor detenerse que
-- descartar datos en silencio.
-- ------------------------------------------------------------
create type documento_tipo as enum ('cedula','dimex','pasaporte','nite');

comment on type documento_tipo is
  'Identificaciones de Costa Rica: cedula (nacional), dimex (extranjero '
  'residente), pasaporte, nite (identificación tributaria especial).';

alter table paciente
  alter column documento_tipo type documento_tipo
  using nullif(btrim(documento_tipo), '')::documento_tipo;

-- ------------------------------------------------------------
-- 2. Semántica de paciente.estado
--
-- Los tres valores existen desde la 001 pero nadie había definido qué
-- significan, y la diferencia decide qué ve el nutricionista en su
-- lista. Se documenta EN LA BASE (no solo en un .md) para que quede
-- junto al dato que describe.
-- ------------------------------------------------------------
comment on type paciente_estado is
  'activo = en seguimiento activo. '
  'inactivo = sin citas activas, puede volver; sigue en la lista. '
  'baja = archivado o alta definitiva; desaparece de la lista.';

comment on column paciente.estado is
  'Baja LÓGICA. La lista filtra estado <> ''baja'', asi que activo e '
  'inactivo aparecen ambos (con estilo distinto en la UI). Nunca se '
  'borra la fila: la trazabilidad clínica lo exige.';

-- ------------------------------------------------------------
-- 3. Motivo y fecha de la baja
--
-- El contrato de POST /api/pacientes/:id/baja acepta un motivo, pero
-- no existía columna donde guardarlo: se habría descartado en
-- silencio. Saber por qué y cuándo se archivó un paciente es
-- exactamente el tipo de dato que la trazabilidad clínica exige.
-- ------------------------------------------------------------
alter table paciente
  add column baja_motivo text,
  add column baja_fecha  timestamptz;

comment on column paciente.baja_motivo is
  'Texto libre indicado al archivar. Opcional.';
comment on column paciente.baja_fecha is
  'Cuándo se archivó. Se conserva aunque el paciente se reactive, '
  'como histórico de que hubo una baja previa.';

-- Un paciente en baja SIEMPRE tiene fecha. Al revés no se exige: si
-- se reactiva, los datos de la baja anterior permanecen como historia.
alter table paciente
  add constraint paciente_baja_con_fecha
  check (estado <> 'baja' or baja_fecha is not null);

-- ------------------------------------------------------------
-- 4. updated_at con disparador
--
-- A partir de la Rebanada 2 los pacientes se editan, y solo había
-- created_at. Se pone por TRIGGER y no a cargo de la aplicación: un
-- updated_at que cada UPDATE debe acordarse de escribir es un
-- updated_at que tarde o temprano miente.
-- ------------------------------------------------------------
alter table paciente
  add column updated_at timestamptz not null default now();

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger paciente_set_updated_at
  before update on paciente
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- 5. Unicidad en paciente_alergia
--
-- Sin restricción única, el "on conflict do nothing" del seed no
-- detectaba nada (no había conflicto que detectar) y cada corrida
-- duplicaba filas. Con esto, la misma alergia no puede registrarse
-- dos veces para un paciente.
--
-- paciente_id ya identifica la clínica de forma unívoca, así que no
-- hace falta incluir clinica_id en la clave.
-- ------------------------------------------------------------
alter table paciente_alergia
  add constraint paciente_alergia_unica unique (paciente_id, descripcion);

-- ------------------------------------------------------------
-- 6. Baja lógica también en las alergias
--
-- paciente_diagnostico ya tenía 'activo'; las alergias no, así que
-- quitar una habría borrado la fila. Una alergia es un dato de
-- SEGURIDAD clínica: que alguien la registrara y luego se retirara es
-- información que puede importar. Ahora ambas listas se comportan
-- igual y ninguna pierde historia.
--
-- Junto con la restricción de arriba, reactivar una alergia retirada
-- es un UPDATE de 'activo', no una fila nueva.
-- ------------------------------------------------------------
alter table paciente_alergia
  add column activo boolean not null default true;

comment on column paciente_alergia.activo is
  'false = retirada del listado vigente, se conserva como histórico. '
  'Las consultas de la ficha filtran activo = true.';

-- ------------------------------------------------------------
-- 7. numero_expediente único por clínica
--
-- Sin esto, dos altas simultáneas leen ambas max(numero_expediente)=N
-- y asignan ambas N+1. Una transacción NO lo evita en el nivel de
-- aislamiento por defecto de Postgres (read committed): ninguna de las
-- dos ve la fila aún no confirmada de la otra.
--
-- Y sin restricción no falla nada: entran dos pacientes con el mismo
-- expediente y nadie se entera hasta que alguien los busca. Con la
-- restricción, la segunda inserción choca y el endpoint reintenta.
--
-- numero_expediente admite NULL y en Postgres dos NULL no colisionan,
-- así que las filas sin número no se ven afectadas.
-- ------------------------------------------------------------
alter table paciente
  add constraint paciente_expediente_unico unique (clinica_id, numero_expediente);
