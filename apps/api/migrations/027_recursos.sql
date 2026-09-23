-- migration: 027_recursos
--
-- PAC-08: biblioteca de recursos. El profesional escribe material
-- educativo —como preparar la merienda, que mirar en una etiqueta, una
-- receta— y el paciente lo lee desde su aplicacion.
--
-- Es contenido de la CLINICA, no del paciente: por eso no cuelga de
-- `paciente` ni se duplica por persona. Se publica una vez y lo ve todo
-- el que pertenece a esa clinica.

create table recurso (
  id             uuid        primary key default gen_random_uuid(),
  clinica_id     uuid        not null references clinica(id),
  -- Quien lo escribio. Se conserva aunque despues lo edite otro: el
  -- material clinico lleva firma.
  profesional_id uuid        not null references profesional(id),

  titulo         text        not null check (char_length(trim(titulo)) between 1 and 200),
  resumen        text        check (resumen is null or char_length(resumen) <= 500),
  contenido      text        not null check (char_length(trim(contenido)) >= 1),
  categoria      text        not null default 'otro'
                   check (categoria in ('nutricion','ejercicio','habitos','recetas','otro')),

  -- Borrador vs publicado. Un borrador no lo ve ningun paciente, y esa
  -- es la unica razon por la que existe la columna: poder escribir a
  -- medias sin que se vea.
  publicado      boolean     not null default false,
  publicado_en   timestamptz,

  activo         boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Un recurso publicado sin fecha de publicacion ordena mal y no se
  -- puede decir desde cuando esta disponible.
  constraint chk_recurso_publicado check (
    (publicado and publicado_en is not null) or (not publicado)
  )
);

-- La consulta del paciente: lo publicado de su clinica, lo mas reciente
-- primero.
create index idx_recurso_publicado
  on recurso (clinica_id, publicado_en desc)
  where publicado = true and activo = true;

-- La del profesional: todo lo suyo, borradores incluidos.
create index idx_recurso_clinica
  on recurso (clinica_id, categoria, created_at desc)
  where activo = true;

create trigger trg_recurso_updated
  before update on recurso
  for each row execute function set_updated_at();

-- ── Lecturas ────────────────────────────────────────────────────────
--
-- Una fila por paciente y recurso, con el instante. Sirve para dos
-- cosas: marcar en la lista lo que ya leyo, y que el profesional sepa
-- si el material que manda lo abre alguien.
--
-- Se guarda la fecha y no un booleano, por lo mismo de siempre: un
-- booleano responde "lo leyo" y una fecha responde ademas "cuando", que
-- es la pregunta util cuando se acaba de publicar algo.
create table recurso_lectura (
  recurso_id  uuid        not null references recurso(id) on delete cascade,
  paciente_id uuid        not null references paciente(id),
  clinica_id  uuid        not null references clinica(id),
  leido_en    timestamptz not null default now(),
  primary key (recurso_id, paciente_id)
);

create index idx_lectura_paciente on recurso_lectura (paciente_id, clinica_id);
