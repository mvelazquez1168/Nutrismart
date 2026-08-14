-- migration: 015_ia
--
-- IA clinica: interpretacion de laboratorios (IA-01) y notas SOAP (IA-02).
--
-- Tres tablas. Las dos primeras guardan lo que la IA produjo; la tercera
-- registra CADA llamada aunque su salida no se persista, porque el
-- medidor de consumo de la clinica tiene que cuadrar con la factura y un
-- borrador descartado tambien se cobro.

create table interpretacion_ia (
  id               uuid        primary key default gen_random_uuid(),
  clinica_id       uuid        not null references clinica(id),
  -- La tabla real se llama lab_estudio, no lab_exam.
  estudio_id       uuid        not null references lab_estudio(id),
  paciente_id      uuid        not null references paciente(id),
  profesional_id   uuid        not null references profesional(id),
  modelo           text        not null,
  prompt_usado     text        not null,
  interpretacion   text        not null,
  tokens_entrada   int,
  tokens_salida    int,
  -- Quien la reviso, no solo que fue revisada: una interpretacion que
  -- entra al expediente la avala una persona con nombre.
  revisada         boolean     not null default false,
  revisada_en      timestamptz,
  revisada_por     uuid        references profesional(id),
  created_at       timestamptz not null default now(),

  constraint interp_revision_coherente check (
    (revisada = false and revisada_en is null and revisada_por is null)
    or (revisada = true and revisada_en is not null)
  )
);

create index idx_interp_estudio   on interpretacion_ia (estudio_id, created_at desc);
create index idx_interp_paciente  on interpretacion_ia (clinica_id, paciente_id, created_at desc);

create table nota_soap (
  id               uuid        primary key default gen_random_uuid(),
  clinica_id       uuid        not null references clinica(id),
  paciente_id      uuid        not null references paciente(id),
  profesional_id   uuid        not null references profesional(id),
  consulta_id      uuid        references consulta(id),
  subjetivo        text,
  objetivo         text,
  analisis         text,
  plan_soap        text,
  generada_ia      boolean     not null default false,
  revisada         boolean     not null default false,
  revisada_en      timestamptz,
  revisada_por     uuid        references profesional(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Una nota sin ninguna de las cuatro secciones no es una nota.
  constraint soap_no_vacia check (
    coalesce(subjetivo, '') <> '' or coalesce(objetivo, '') <> ''
    or coalesce(analisis, '') <> '' or coalesce(plan_soap, '') <> ''
  ),
  constraint soap_revision_coherente check (
    (revisada = false and revisada_en is null and revisada_por is null)
    or (revisada = true and revisada_en is not null)
  )
);

create index idx_soap_paciente on nota_soap (clinica_id, paciente_id, created_at desc);

create trigger trg_soap_updated
  before update on nota_soap
  for each row execute function set_updated_at();

-- Medidor de consumo (regla de CLAUDE.md: registrar cada llamada de IA
-- con modelo, tokens y costo). El borrador SOAP no se persiste, asi que
-- sin esta tabla su gasto seria invisible.
create table uso_ia (
  id              uuid        primary key default gen_random_uuid(),
  clinica_id      uuid        not null references clinica(id),
  profesional_id  uuid        references profesional(id),
  funcion         text        not null,   -- 'interpretacion_labs' | 'nota_soap'
  modelo          text        not null,
  tokens_entrada  int         not null default 0,
  tokens_salida   int         not null default 0,
  -- Se registra tambien lo que fallo: una llamada que agoto el tiempo
  -- de espera consumio cuota aunque no devolviera nada util.
  exito           boolean     not null default true,
  error_tipo      text,
  created_at      timestamptz not null default now()
);

create index idx_uso_ia_clinica on uso_ia (clinica_id, created_at desc);
