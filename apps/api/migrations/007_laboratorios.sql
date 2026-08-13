-- ============================================================
-- NutriSmart · Migración 007 — laboratorios
-- Rebanada 5 (CLI-04).
--
-- El sistema CAPTURA y PRESENTA; no interpreta. Marcar un valor como
-- 'alterado' es aritmética contra un rango declarado, no un
-- diagnóstico. La interpretación de hallazgos y patrones es IA-01.
-- ============================================================

create type lab_estudio_estado as enum ('vigente','anulado');

-- ------------------------------------------------------------
-- Catálogo de biomarcadores (GLOBAL)
--
-- Global igual que el de métricas: son analitos estándar y un catálogo
-- por clínica haría incomparables las series entre clínicas.
--
-- Lo que SÍ es por clínica son los rangos: cada laboratorio reporta
-- los suyos y el nutricionista los conoce.
-- ------------------------------------------------------------
create table biomarcador (
  codigo    text primary key,
  nombre    text     not null,
  unidad    text     not null,
  decimales smallint not null default 1,
  grupo     text     not null,
  orden     smallint not null default 0,
  activo    boolean  not null default true
);

insert into biomarcador (codigo, nombre, unidad, decimales, grupo, orden) values
  ('glucosa_ayunas',   'Glucosa en ayunas',        'mg/dL', 0, 'Perfil glucémico', 10),
  ('hba1c',            'Hemoglobina glicosilada',  '%',     1, 'Perfil glucémico', 20),
  ('colesterol_total', 'Colesterol total',         'mg/dL', 0, 'Perfil lipídico',  30),
  ('hdl',              'Colesterol HDL',           'mg/dL', 0, 'Perfil lipídico',  40),
  ('ldl',              'Colesterol LDL',           'mg/dL', 0, 'Perfil lipídico',  50),
  ('trigliceridos',    'Triglicéridos',            'mg/dL', 0, 'Perfil lipídico',  60),
  ('hemoglobina',      'Hemoglobina',              'g/dL',  1, 'Hematología',      70),
  ('hierro_serico',    'Hierro sérico',            'µg/dL', 0, 'Hematología',      80),
  ('ferritina',        'Ferritina',                'ng/mL', 0, 'Hematología',      90),
  ('tsh',              'TSH',                      'mUI/L', 2, 'Tiroides',        100),
  ('vitamina_d',       'Vitamina D (25-OH)',       'ng/mL', 1, 'Vitaminas',       110),
  ('creatinina',       'Creatinina',               'mg/dL', 2, 'Función renal',   120),
  ('alt',              'ALT (TGP)',                'U/L',   0, 'Función hepática',130),
  ('ast',              'AST (TGO)',                'U/L',   0, 'Función hepática',140)
on conflict (codigo) do nothing;

-- ------------------------------------------------------------
-- Rangos de referencia, por CLÍNICA y por SEXO
--
-- sexo null = rango que aplica a cualquiera. La resolución busca
-- primero el del sexo del paciente y cae al general si no existe.
-- Sin ninguno de los dos, el resultado queda 'sin_referencia': no se
-- puede afirmar que un valor es normal sin un criterio contra el que
-- compararlo.
--
-- Sin tramos de edad en la v1: es donde está la mayor complejidad con
-- la menor parte de la diferencia clínica.
-- ------------------------------------------------------------
create table biomarcador_rango (
  id                 uuid primary key default gen_random_uuid(),
  clinica_id         uuid not null references clinica(id),
  biomarcador_codigo text not null references biomarcador(codigo),
  sexo               sexo_biologico,
  minimo             numeric,
  maximo             numeric,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Un rango sin ninguno de los dos extremos no acota nada. Y uno con
  -- el mínimo por encima del máximo marcaría TODO como alterado.
  constraint rango_coherente check (
    (minimo is not null or maximo is not null)
    and (minimo is null or maximo is null or minimo <= maximo)
  )
);

-- DOS índices únicos, no uno.
--
-- En Postgres dos NULL no colisionan en un unique, así que una clave
-- (clinica, biomarcador, sexo) permitiría varios rangos generales para
-- el mismo biomarcador y la resolución se volvería no determinista.
-- Es la misma trampa del documento_numero vacío en la migración 003.
create unique index biomarcador_rango_por_sexo
  on biomarcador_rango(clinica_id, biomarcador_codigo, sexo)
  where sexo is not null;

create unique index biomarcador_rango_general
  on biomarcador_rango(clinica_id, biomarcador_codigo)
  where sexo is null;

create index idx_rango_clinica on biomarcador_rango(clinica_id);

create trigger rango_set_updated_at
  before update on biomarcador_rango
  for each row execute function set_updated_at();

-- Semilla de rangos para las clínicas existentes. Son valores de
-- referencia habituales en adulto, ORIENTATIVOS: cada clínica los
-- ajusta a lo que reporta su laboratorio.
--
-- La mezcla es deliberada: unos generales y otros por sexo, para que
-- la lógica de resolución se ejercite desde el primer día.
insert into biomarcador_rango (clinica_id, biomarcador_codigo, sexo, minimo, maximo)
select c.id, v.codigo, v.sexo::sexo_biologico, v.minimo, v.maximo
from clinica c
cross join (values
  ('glucosa_ayunas',   null,        70,   100),
  ('hba1c',            null,        4.0,  5.6),
  ('colesterol_total', null,        null, 200),
  ('ldl',              null,        null, 100),
  ('trigliceridos',    null,        null, 150),
  ('hdl',              'masculino', 40,   null),
  ('hdl',              'femenino',  50,   null),
  ('hemoglobina',      'masculino', 13.5, 17.5),
  ('hemoglobina',      'femenino',  12.0, 15.5),
  ('hierro_serico',    null,        60,   170),
  ('ferritina',        'masculino', 24,   336),
  ('ferritina',        'femenino',  11,   307),
  ('tsh',              null,        0.4,  4.0),
  ('vitamina_d',       null,        30,   100),
  ('creatinina',       'masculino', 0.7,  1.3),
  ('creatinina',       'femenino',  0.6,  1.1),
  ('alt',              'masculino', 7,    55),
  ('alt',              'femenino',  7,    45),
  ('ast',              null,        8,    48)
) as v(codigo, sexo, minimo, maximo)
on conflict do nothing;

-- ------------------------------------------------------------
-- Archivos
--
-- Los binarios NO viven aquí: 'ruta_relativa' es interna al almacén,
-- y cambiar de disco a S3 no debe tocar ninguna fila. Guardarlos como
-- bytea infla cada copia de seguridad y cada réplica.
-- ------------------------------------------------------------
create table archivo (
  id              uuid primary key default gen_random_uuid(),
  clinica_id      uuid   not null references clinica(id),
  -- Se conserva como METADATO para mostrarlo y para la descarga. Nunca
  -- se usa como ruta: un nombre con '../' o caracteres de control no
  -- debe llegar al sistema de ficheros.
  nombre_original text   not null,
  mime            text   not null,
  tamano_bytes    bigint not null,
  -- Permite detectar que el mismo informe se subió dos veces y
  -- comprobar que lo descargado es idéntico a lo subido.
  sha256          text   not null,
  ruta_relativa   text   not null unique,
  subido_por      uuid references profesional(id),
  created_at      timestamptz not null default now(),

  constraint archivo_tamano_positivo check (tamano_bytes > 0)
);

create index idx_archivo_clinica on archivo(clinica_id);
create index idx_archivo_sha     on archivo(clinica_id, sha256);

-- ------------------------------------------------------------
-- Estudio de laboratorio
--
-- Cuelga del PACIENTE. snapshot_id es opcional: un paciente trae
-- laboratorios entre consultas, y obligar a abrir un punto de control
-- generaría borradores vacíos que además chocarían con la regla de un
-- solo borrador por paciente.
-- ------------------------------------------------------------
create table lab_estudio (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references clinica(id),
  paciente_id    uuid not null references paciente(id),
  profesional_id uuid references profesional(id),
  snapshot_id    uuid references clinical_snapshot(id),
  -- Fecha de TOMA DE MUESTRA, no de captura: ordena el histórico y
  -- calcula las tendencias.
  fecha          date not null,
  laboratorio    text,
  archivo_id     uuid references archivo(id),
  notas          text,

  -- Sin borrado: un estudio cargado por error se anula con motivo,
  -- igual que la baja de un paciente.
  estado         lab_estudio_estado not null default 'vigente',
  anulado_motivo text,
  anulado_fecha  timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint estudio_anulado_con_fecha
    check (estado <> 'anulado' or anulado_fecha is not null)
);

create index idx_estudio_paciente on lab_estudio(paciente_id, fecha desc);
create index idx_estudio_clinica  on lab_estudio(clinica_id);
create index idx_estudio_snapshot on lab_estudio(snapshot_id);

create trigger estudio_set_updated_at
  before update on lab_estudio
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- Resultados
--
-- El ESTADO no se almacena: se calcula al leer contra el rango
-- vigente. Guardado quedaría obsoleto en cuanto la clínica corrigiera
-- un rango, y nadie recordaría recalcular el histórico. Mismo
-- razonamiento que el IMC de la migración 004.
-- ------------------------------------------------------------
create table lab_resultado (
  id                 uuid primary key default gen_random_uuid(),
  clinica_id         uuid not null references clinica(id),
  estudio_id         uuid not null references lab_estudio(id),
  biomarcador_codigo text not null references biomarcador(codigo),
  valor              numeric not null,
  created_at         timestamptz not null default now(),

  unique (estudio_id, biomarcador_codigo)
);

create index idx_resultado_estudio on lab_resultado(estudio_id);
-- Para recorrer la serie de un analito concreto de un paciente.
create index idx_resultado_codigo  on lab_resultado(biomarcador_codigo);
