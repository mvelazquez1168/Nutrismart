-- migration: 024_registro_metrica
--
-- PAC · metricas que el PACIENTE se toma en casa.
--
-- Deliberadamente separado de `medicion_antropometrica`, que es lo que
-- mide el profesional en consulta. No son el mismo dato: la bascula de
-- la clinica esta calibrada y se usa siempre a la misma hora y en las
-- mismas condiciones; la de casa, no. Mezclarlos en una sola serie
-- convierte la linea de peso en ruido y nadie podria decir si una
-- bajada es progreso o es que hoy se peso vestido.
--
-- Se guardan juntos, se muestran juntos, se cuentan aparte.

create type tipo_metrica as enum ('peso', 'presion_arterial', 'glucosa', 'otro');

create table registro_metrica (
  id           uuid         primary key default gen_random_uuid(),
  clinica_id   uuid         not null references clinica(id),
  paciente_id  uuid         not null references paciente(id),

  tipo         tipo_metrica not null,
  -- Peso y glucosa usan `valor`; la presion necesita dos numeros.
  valor        numeric(8,2),
  sistolica    numeric(5,1),
  diastolica   numeric(5,1),
  unidad       text         not null check (char_length(unidad) between 1 and 20),

  medido_en    timestamptz  not null default now(),
  nota         text         check (nota is null or char_length(nota) <= 500),

  activo       boolean      not null default true,
  created_at   timestamptz  not null default now(),

  constraint chk_presion check (
    tipo <> 'presion_arterial'
    or (sistolica is not null and diastolica is not null and sistolica > diastolica)
  ),
  constraint chk_valor check (
    tipo = 'presion_arterial' or valor is not null
  ),
  -- Una medida del futuro no es una medida. Sin esto, un dedo torpe en
  -- el selector de fecha deja un punto que domina toda la grafica.
  constraint chk_no_futuro check (medido_en <= now() + interval '1 hour')
);

create index idx_registro_metrica_paciente
  on registro_metrica (clinica_id, paciente_id, tipo, medido_en desc)
  where activo = true;
