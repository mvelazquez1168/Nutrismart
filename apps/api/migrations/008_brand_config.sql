-- ============================================================
-- NutriSmart · Migración 008 — configuración de marca (CLI-06)
--
-- White-label por clínica: una fila por clínica, creada la primera
-- vez que se guarda algo. Si no existe fila, la API responde los
-- valores por defecto del design system; no se siembra nada.
--
-- Por qué no se siembra: una fila por clínica con los defaults sería
-- indistinguible de una clínica que eligió exactamente esos colores,
-- y "restaurar valores por defecto" dejaría de poder borrarse.
-- ============================================================

create table brand_config (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references clinica(id),

  -- Nombre visible de la aplicación para esta clínica. No es el
  -- nombre_comercial de `clinica`: una clínica puede llamarse
  -- "Centro Vida" y querer que su plataforma se llame "Vida Salud".
  nombre_app     text not null default 'NutriSmart',

  -- Ruta OPACA del almacén, no una URL. El navegador nunca la ve: el
  -- logo se sirve por /api/brand/logo. Mismo criterio que
  -- archivo.ruta_relativa — cambiar de disco a S3 no toca filas.
  logo_ruta      text,
  -- Tipo detectado al subir. Se guarda para no volver a olfatear el
  -- contenido en cada descarga.
  logo_mime      text,

  -- #rrggbb validado en la API. Los estados clínicos y los colores de
  -- gráfica NO se re-tematizan: son fijos por seguridad de lectura.
  color_primario text not null default '#0E7C66',
  color_acento   text not null default '#0EA5E9',

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Una sola configuración por clínica. Sin esto, dos peticiones
  -- concurrentes crearían dos filas y la lectura elegiría una al azar.
  constraint brand_config_clinica_unica unique (clinica_id),

  -- El default vive en el design system (tokens.css). Que la base
  -- acepte cualquier texto y la API valide es una defensa a medias:
  -- un color mal formado llega hasta el CSS y rompe el tema entero.
  constraint brand_config_primario_hex check (color_primario ~ '^#[0-9a-fA-F]{6}$'),
  constraint brand_config_acento_hex   check (color_acento   ~ '^#[0-9a-fA-F]{6}$'),
  constraint brand_config_nombre_app_no_vacio check (length(trim(nombre_app)) between 1 and 80),

  -- Una ruta sin tipo, o un tipo sin ruta, dejaría el logo en un
  -- estado que la descarga no sabe servir.
  constraint brand_config_logo_completo check (
    (logo_ruta is null and logo_mime is null) or
    (logo_ruta is not null and logo_mime is not null)
  )
);

create index idx_brand_config_clinica on brand_config(clinica_id);

-- set_updated_at() ya existe desde la migración 003 y escribe en
-- new.updated_at; de ahí que la columna se llame así y no
-- "actualizado_en".
create trigger brand_config_set_updated_at
  before update on brand_config
  for each row execute function set_updated_at();
