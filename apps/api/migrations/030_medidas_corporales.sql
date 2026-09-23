-- migration: 030_medidas_corporales
--
-- RPM-01: las medidas que el paciente se toma en casa con una cinta.
--
-- Importan porque el peso solo miente a corto plazo: quien empieza a
-- entrenar puede perder cintura y no perder ni un gramo, y si la unica
-- cifra que ve es la bascula concluye que no sirve de nada y lo deja.

create table registro_medida_corporal (
  id          uuid         primary key default gen_random_uuid(),
  clinica_id  uuid         not null references clinica(id),
  paciente_id uuid         not null references paciente(id),

  fecha       date         not null default current_date,

  cintura_cm  numeric(5,1) check (cintura_cm is null or (cintura_cm > 20 and cintura_cm < 300)),
  cadera_cm   numeric(5,1) check (cadera_cm  is null or (cadera_cm  > 20 and cadera_cm  < 300)),
  pecho_cm    numeric(5,1) check (pecho_cm   is null or (pecho_cm   > 20 and pecho_cm   < 300)),
  brazo_cm    numeric(5,1) check (brazo_cm   is null or (brazo_cm   > 10 and brazo_cm   < 100)),
  muslo_cm    numeric(5,1) check (muslo_cm   is null or (muslo_cm   > 10 and muslo_cm   < 150)),
  cuello_cm   numeric(5,1) check (cuello_cm  is null or (cuello_cm  > 10 and cuello_cm  < 100)),

  nota        text         check (nota is null or char_length(nota) <= 300),

  activo      boolean      not null default true,
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now(),

  -- Una fila sin ninguna medida no es un registro, es ruido: ocuparia un
  -- dia en la grafica sin aportar un punto.
  constraint chk_alguna_medida check (
    num_nonnulls(cintura_cm, cadera_cm, pecho_cm, brazo_cm, muslo_cm, cuello_cm) > 0
  ),

  -- Un juego de medidas por dia.
  --
  -- El encargo anadia una columna `fuente` ('paciente' | 'consulta') y
  -- metia la clave de unicidad ahi, para que convivieran las medidas de
  -- casa y las de consulta. Aqui NO: las de consulta ya viven en
  -- `medicion_antropometrica` desde la Rebanada 3, y es de donde lee la
  -- ficha del profesional.
  --
  -- Tener la cintura en dos tablas dejaria dos cifras para lo mismo sin
  -- que ninguna pantalla supiera cual creer — el mismo error que la
  -- Rebanada 24 evito con los totales del diario. Y es la misma linea
  -- que la Rebanada 22 trazo con el peso: lo que mide una cinta metrica
  -- en casa, delante del espejo, no es lo que mide el profesional con
  -- puntos anatomicos. Se cuentan aparte y se dibujan aparte.
  constraint uq_medidas_dia unique (paciente_id, fecha)
);

create index idx_medida_paciente
  on registro_medida_corporal (clinica_id, paciente_id, fecha desc)
  where activo = true;

create trigger trg_medida_updated
  before update on registro_medida_corporal
  for each row execute function set_updated_at();
