-- migration: 031_alerta_config
--
-- RPM-03: los umbrales que el profesional vigila en cada paciente.
--
-- "Avisame si su glucosa pasa de 140" o "si lleva cinco dias sin apuntar
-- nada". La regla la pone el profesional, paciente a paciente: un umbral
-- de peso que es normal para uno es preocupante para otro.

create type alerta_metrica as enum (
  'peso',
  'glucosa',
  'presion_sistolica',
  'presion_diastolica',
  'bienestar',            -- escala 1-5 del parte diario
  'dias_sin_diario',
  'dias_sin_registro'     -- sin comidas, ni medidas, ni parte
);

create type alerta_operador as enum (
  'mayor_que',
  'menor_que',
  'mayor_igual_que',
  'menor_igual_que'
);

create table alerta_config (
  id             uuid            primary key default gen_random_uuid(),
  clinica_id     uuid            not null references clinica(id),
  profesional_id uuid            not null references profesional(id),
  paciente_id    uuid            not null references paciente(id),

  metrica        alerta_metrica  not null,
  operador       alerta_operador not null,
  umbral         numeric(8,2)    not null,

  -- ── La ventana de frescura ──────────────────────────────────────
  --
  -- Sin esto la regla "peso > 90" mira la ultima lectura que haya, tenga
  -- la edad que tenga. Un paciente que dejo de pesarse hace seis meses
  -- con 91 kg generaria una alerta nueva todos los dias, para siempre,
  -- sobre una medicion de hace seis meses.
  --
  -- Eso no es vigilar: es ruido, y el ruido hace que se dejen de mirar
  -- las alertas de verdad. Si la ultima lectura es mas vieja que esto,
  -- la regla no se evalua — el problema entonces es que no hay datos, y
  -- para eso estan las metricas `dias_sin_*`.
  --
  -- No aplica a `dias_sin_diario` ni `dias_sin_registro`: ahi la falta
  -- de datos ES lo que se mide.
  ventana_dias   smallint        not null default 14
                   check (ventana_dias between 1 and 365),

  -- Mensaje propio del profesional. Sin el se compone uno.
  mensaje        text            check (mensaje is null or char_length(mensaje) <= 300),

  activo         boolean         not null default true,
  created_at     timestamptz     not null default now(),
  updated_at     timestamptz     not null default now(),

  -- Una regla por paciente, metrica y operador. Permite el par natural
  -- "peso > 95" y "peso < 70" sobre la misma metrica.
  constraint uq_alerta_config unique (paciente_id, metrica, operador),

  -- El umbral de bienestar tiene que caer dentro de la escala; si no, la
  -- regla no se cumpliria nunca o se cumpliria siempre.
  constraint chk_umbral_bienestar check (
    metrica <> 'bienestar' or (umbral >= 1 and umbral <= 5)
  ),
  constraint chk_umbral_dias check (
    metrica not in ('dias_sin_diario','dias_sin_registro') or umbral >= 1
  )
);

create index idx_alerta_config_clinica on alerta_config (clinica_id)
  where activo = true;
create index idx_alerta_config_paciente on alerta_config (paciente_id)
  where activo = true;

create trigger trg_alerta_config_updated
  before update on alerta_config
  for each row execute function set_updated_at();
