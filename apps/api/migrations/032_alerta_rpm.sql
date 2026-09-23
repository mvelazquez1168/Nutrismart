-- migration: 032_alerta_rpm
--
-- Las alertas que se han disparado.

create type alerta_estado as enum ('activa', 'reconocida', 'resuelta');

create table alerta_rpm (
  id              uuid           primary key default gen_random_uuid(),
  clinica_id      uuid           not null references clinica(id),
  paciente_id     uuid           not null references paciente(id),
  profesional_id  uuid           not null references profesional(id),

  -- No admite null: toda alerta viene de una regla, y sin saber cual no
  -- se puede decidir si sigue cumpliendose. `on delete cascade` no: las
  -- reglas se archivan (activo = false), no se borran.
  config_id       uuid           not null references alerta_config(id),

  metrica         alerta_metrica not null,
  valor_observado numeric(8,2),
  umbral          numeric(8,2),
  -- El instante del dato que la disparo. Sirve para decir "su glucosa
  -- del martes", que es distinto de "su glucosa" a secas.
  observado_en    timestamptz,
  mensaje         text           not null,

  estado          alerta_estado  not null default 'activa',
  reconocida_en   timestamptz,
  resuelta_en     timestamptz,
  -- Cuando se resuelve sola porque el valor volvio a su sitio, en vez de
  -- porque el profesional la cerro. Se distinguen: una alerta que se
  -- arregla sola y una que alguien atendio no dicen lo mismo.
  resuelta_auto   boolean        not null default false,

  email_enviado   boolean        not null default false,
  fecha_deteccion date           not null default current_date,

  created_at      timestamptz    not null default now(),
  updated_at      timestamptz    not null default now(),

  -- Estado y fecha no pueden discrepar, igual que en las tareas de la
  -- Rebanada 23.
  constraint chk_alerta_fechas check (
    (estado = 'resuelta') = (resuelta_en is not null)
    and (estado <> 'activa' or reconocida_en is null)
  )
);

-- ── Una alerta ABIERTA por regla ────────────────────────────────────
--
-- El encargo ponia la clave en (paciente, metrica, dia): una alerta
-- nueva cada dia mientras el problema durase, y solo una por metrica
-- aunque el paciente tuviera dos reglas sobre ella (la de peso alto y la
-- de peso bajo) — la segunda no habria alertado nunca.
--
-- Aqui la unidad es el PROBLEMA, no el dia. Mientras la glucosa siga
-- alta hay una sola alerta viva; cuando vuelve a su sitio se resuelve, y
-- si vuelve a subir se abre otra. El profesional ve un problema por
-- problema, no treinta filas del mismo.
create unique index uq_alerta_abierta
  on alerta_rpm (config_id)
  where estado <> 'resuelta';

create index idx_alerta_activa
  on alerta_rpm (clinica_id, estado, created_at desc)
  where estado <> 'resuelta';

create index idx_alerta_paciente
  on alerta_rpm (paciente_id, estado, created_at desc);

create trigger trg_alerta_rpm_updated
  before update on alerta_rpm
  for each row execute function set_updated_at();
