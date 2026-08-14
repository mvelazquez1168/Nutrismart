-- migration: 025_metas_y_tareas
--
-- PAC-05 (metas y progreso) y PAC-06 (tareas del paciente).

-- ── La meta de peso ─────────────────────────────────────────────────
--
-- No existia en ningun sitio del esquema. En la Rebanada 16 se dejo
-- dicho: los deltas no podian decir si un cambio era bueno o malo
-- porque "sin un objetivo de peso registrado, el servidor no tiene con
-- que distinguirlos". Aqui se registra ese objetivo.
--
-- Va en conclusion_valoracion porque es parte de lo que el profesional
-- PRESCRIBE en consulta, junto a las calorias y los macros — no un
-- deseo que el paciente se pone. Y va con fecha: "llegar a 72 kg" sin
-- plazo no es una meta, es una aspiracion.
alter table conclusion_valoracion add column peso_objetivo numeric(5,2)
  check (peso_objetivo is null or (peso_objetivo > 20 and peso_objetivo < 400));
alter table conclusion_valoracion add column fecha_objetivo_peso date;

-- Una fecha sin peso no dice nada; un peso sin fecha es la mitad de una
-- meta, pero se admite: hay objetivos sin plazo cerrado.
alter table conclusion_valoracion add constraint chk_meta_peso_coherente
  check (fecha_objetivo_peso is null or peso_objetivo is not null);

-- ── Tareas ──────────────────────────────────────────────────────────
--
-- Distintas de los `acuerdos` de la Rebanada 15. Un acuerdo se pacta en
-- consulta, va dentro de la conclusion y lo firma el profesional. Una
-- tarea la asigna el profesional entre consultas, tiene fecha limite y
-- el paciente la marca. Meterlas en el mismo sitio obligaria a versionar
-- la conclusion cada vez que se manda una tarea.

create type prioridad_tarea as enum ('alta', 'normal', 'baja');
create type estado_tarea as enum ('pendiente', 'completada', 'archivada');

create table tarea_paciente (
  id             uuid            primary key default gen_random_uuid(),
  clinica_id     uuid            not null references clinica(id),
  paciente_id    uuid            not null references paciente(id),
  profesional_id uuid            not null references profesional(id),
  -- Opcional: de que consulta salio la tarea.
  consulta_id    uuid            references consulta(id),

  titulo         text            not null check (char_length(trim(titulo)) between 1 and 200),
  descripcion    text            check (descripcion is null or char_length(descripcion) <= 2000),
  fecha_limite   date,
  prioridad      prioridad_tarea not null default 'normal',

  estado         estado_tarea    not null default 'pendiente',
  completada_en  timestamptz,

  created_at     timestamptz     not null default now(),
  updated_at     timestamptz     not null default now(),

  -- El instante de completado y el estado no pueden discrepar: una
  -- tarea "pendiente" con fecha de completado es una contradiccion que
  -- alguien acabaria leyendo como buena.
  constraint chk_tarea_completada check (
    (estado = 'completada' and completada_en is not null)
    or (estado <> 'completada' and completada_en is null)
  )
);

-- Vista del paciente: lo pendiente, primero lo que vence antes.
create index idx_tarea_pendiente
  on tarea_paciente (clinica_id, paciente_id, fecha_limite nulls last)
  where estado = 'pendiente';

-- Vista del profesional: lo que ha mandado, por paciente.
create index idx_tarea_profesional
  on tarea_paciente (clinica_id, profesional_id, estado, created_at desc);

create trigger trg_tarea_updated
  before update on tarea_paciente
  for each row execute function set_updated_at();
