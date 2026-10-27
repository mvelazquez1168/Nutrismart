-- 062_meta_agua.sql
--
-- R55: el agua del día. La meta la pone el profesional en la
-- prescripción; lo bebido lo apunta el paciente desde su app.
--
-- ## El número de migración
--
-- El encargo decía 057. Ese número lo ocupa
-- `057_seed_alimentos_faltantes.sql` desde R52, y el runner lleva una
-- tabla de control con checksum: dos ficheros con la misma versión no
-- es un conflicto que se resuelva solo, es uno que rompe el arranque.
-- Se usa el siguiente libre.
--
-- ## Por qué `meta_agua_ml` va en `conclusion_valoracion`
--
-- Porque es prescripción: algo que el profesional INDICA, igual que
-- `kcal_prescritas` o `peso_objetivo`, y se versiona con la consulta
-- en la que se decidió. Mirando una consulta de marzo se ve la meta
-- que estaba vigente en marzo.
--
-- No se confunde con `evaluacion_clinica.hidratacion_litros` (017),
-- que es lo CONTRARIO: cuánto bebe hoy el paciente, según lo que él
-- mismo cuenta en la anamnesis. Una es el punto de partida y la otra
-- el objetivo; guardarlas en la misma columna haría imposible medir el
-- avance.
--
-- ## Y por qué `registro_agua` es una tabla aparte
--
-- Lo que el paciente bebe no es prescripción ni consulta: es un dato
-- diario suyo, que llega muchas veces al día y nunca lo escribe un
-- profesional. En `registro_comida` tampoco cabe —esa tabla tiene
-- `UNIQUE (paciente, fecha, franja)` y descripción obligatoria, y el
-- agua no pertenece a ninguna franja—.

/* ------------------------------------------------------------------ */
/* 1. La meta, en la prescripción                                      */
/* ------------------------------------------------------------------ */

-- Sin NOT NULL: una prescripción puede no fijar meta de agua, y un
-- cero significaría «no beber». La API distingue los dos casos y la
-- pantalla del paciente dice «tu nutricionista aún no la definió».
alter table conclusion_valoracion
  add column if not exists meta_agua_ml integer
    check (meta_agua_ml is null or (meta_agua_ml > 0 and meta_agua_ml <= 10000));

comment on column conclusion_valoracion.meta_agua_ml is
  'Mililitros de agua al dia que indica el profesional. NULL = no se fijo meta. Distinto de evaluacion_clinica.hidratacion_litros, que es lo que el paciente bebe hoy.';

/* ------------------------------------------------------------------ */
/* 2. Lo que el paciente bebe                                          */
/* ------------------------------------------------------------------ */

-- Una fila POR DÍA, no una por trago.
--
-- Guardar cada toma daría el detalle de a qué hora bebe cada paciente,
-- que es más de lo que hace falta para una botella que se llena: lo
-- que se enseña es el total del día contra la meta. Y con un acumulado
-- el UPSERT es atómico —`ml_total = ml_total + $1` en una sola
-- sentencia—, así que dos toques seguidos en el móvil no se pisan.
create table if not exists registro_agua (
  id          uuid        primary key default gen_random_uuid(),
  paciente_id uuid        not null references paciente(id),
  clinica_id  uuid        not null references clinica(id),

  -- La fecha la decide la API en la zona horaria de la clínica, no
  -- `current_date`, que es la del servidor. Un paciente que bebe agua
  -- a las once de la noche en Costa Rica no debe sumarla al día
  -- siguiente porque el contenedor corra en UTC.
  fecha       date        not null,

  ml_total    integer     not null default 0 check (ml_total >= 0 and ml_total <= 20000),
  updated_at  timestamptz not null default now(),

  -- Lo que hace que el UPSERT funcione: un día, un paciente, una fila.
  constraint uq_agua_dia unique (paciente_id, clinica_id, fecha)
);

-- Para la consulta de «los últimos N días», que es la del progreso.
-- El único de arriba ya resuelve la del día de hoy.
create index if not exists idx_agua_paciente_fecha
  on registro_agua (paciente_id, clinica_id, fecha desc);

drop trigger if exists trg_agua_updated on registro_agua;
create trigger trg_agua_updated
  before update on registro_agua
  for each row execute function set_updated_at();
