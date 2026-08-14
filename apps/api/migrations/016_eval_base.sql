-- ============================================================
-- NutriSmart · Migración 016 — base de la valoración ABCD (EVAL-00, EVAL-01)
--
-- La `consulta` es el contenedor: agrupa las cuatro secciones del ABCD
-- (antropometría, bioquímica, clínico, dietético) y su conclusión. Las
-- dos últimas llegan en rebanadas posteriores; el contenedor ya las
-- contempla para no migrar la tabla cada vez.
--
-- Se salta el número 015, reservado para la Rebanada 12: el runner
-- ordena por nombre de archivo y tolera el hueco, así que R12 podrá
-- entrar después sin renumerar nada.
--
-- Sin BEGIN/COMMIT: el runner envuelve cada migración en su transacción.
-- ============================================================

create type estado_consulta as enum ('borrador', 'finalizada');
create type tipo_consulta   as enum ('inicial', 'seguimiento');

create table consulta (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references clinica(id),
  paciente_id    uuid not null references paciente(id),
  profesional_id uuid not null references profesional(id),

  tipo   tipo_consulta   not null default 'inicial',
  estado estado_consulta not null default 'borrador',

  -- Ordinal dentro del historial del paciente. Se materializa en vez de
  -- contarse al leer: es lo que el profesional dice en voz alta ("en la
  -- tercera consulta…") y no puede cambiar porque otra se anulara.
  numero_consulta int not null check (numero_consulta >= 1),

  fecha_consulta date not null default current_date,

  -- Progreso por sección: { "antrop": true, "bioquim": false, … }
  -- JSONB y no cinco booleanos porque el ABCD todavía puede ganar
  -- secciones, y cada una sería una migración.
  secciones_completas jsonb not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Dos consultas con el mismo ordinal para un paciente harían
  -- ambiguo cualquier "consulta #2".
  constraint consulta_numero_unico unique (clinica_id, paciente_id, numero_consulta)
);

create index idx_consulta_paciente
  on consulta (clinica_id, paciente_id, fecha_consulta desc);

create trigger consulta_set_updated_at
  before update on consulta
  for each row execute function set_updated_at();

create type metodo_composicion as enum ('bia', 'pliegues');

create table medicion_antropometrica (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references clinica(id),
  paciente_id    uuid not null references paciente(id),
  -- Anulable a propósito: una medición puede tomarse fuera de consulta
  -- —un control de peso rápido— y no por eso deja de ser válida.
  consulta_id    uuid references consulta(id),
  profesional_id uuid not null references profesional(id),

  fecha_medicion date not null default current_date,

  -- Rangos generosos pero no absurdos: atajan el dedo que teclea 780 kg
  -- sin discutirle al profesional un caso extremo real.
  peso_kg  numeric(5,2) check (peso_kg  > 0   and peso_kg  < 500),
  talla_cm numeric(5,1) check (talla_cm > 30  and talla_cm < 260),

  /*
   * IMC e ICC son COLUMNAS GENERADAS, no valores que envíe el cliente.
   *
   * Un índice que llegue desde fuera puede no corresponder con el peso y
   * la talla de su propia fila, y entonces el expediente contiene dos
   * verdades. Derivarlo en la base hace imposible esa discrepancia.
   */
  imc numeric(5,2) generated always as (
    case when peso_kg is not null and talla_cm is not null and talla_cm > 0
         then round(peso_kg / ((talla_cm / 100) ^ 2), 2)
    end
  ) stored,

  cintura_cm numeric(5,1) check (cintura_cm > 0 and cintura_cm < 250),
  cadera_cm  numeric(5,1) check (cadera_cm  > 0 and cadera_cm  < 250),

  icc numeric(4,3) generated always as (
    case when cintura_cm is not null and cadera_cm is not null and cadera_cm > 0
         then round(cintura_cm / cadera_cm, 3)
    end
  ) stored,

  brazo_cm  numeric(5,1) check (brazo_cm  > 0 and brazo_cm  < 100),
  pierna_cm numeric(5,1) check (pierna_cm > 0 and pierna_cm < 150),

  -- ---- Composición corporal ----
  metodo metodo_composicion,

  masa_libre_grasa_kg numeric(5,2) check (masa_libre_grasa_kg >= 0),
  masa_muscular_kg    numeric(5,2) check (masa_muscular_kg    >= 0),
  pct_grasa           numeric(5,2) check (pct_grasa  >= 0 and pct_grasa  <= 100),
  masa_grasa_kg       numeric(5,2) check (masa_grasa_kg >= 0),
  agua_corporal_pct   numeric(5,2) check (agua_corporal_pct >= 0 and agua_corporal_pct <= 100),
  angulo_fase         numeric(4,2) check (angulo_fase > 0 and angulo_fase < 20),

  -- Pliegues en mm cuando metodo = 'pliegues'. JSONB porque el juego de
  -- pliegues depende de la fórmula y no todas piden los mismos.
  pliegues_datos   jsonb,
  pliegues_formula text,

  created_at timestamptz not null default now(),

  -- La masa grasa no puede exceder el peso del paciente.
  constraint antrop_grasa_coherente check (
    masa_grasa_kg is null or peso_kg is null or masa_grasa_kg <= peso_kg
  ),
  constraint antrop_libre_grasa_coherente check (
    masa_libre_grasa_kg is null or peso_kg is null or masa_libre_grasa_kg <= peso_kg
  )
);

create index idx_antrop_paciente
  on medicion_antropometrica (clinica_id, paciente_id, fecha_medicion desc);

-- Una medición por consulta: la segunda sería una corrección, y para eso
-- se edita la que hay.
create unique index uq_antrop_consulta
  on medicion_antropometrica (consulta_id)
  where consulta_id is not null;
