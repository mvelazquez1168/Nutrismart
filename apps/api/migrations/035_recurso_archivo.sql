-- migration: 035_recurso_archivo
--
-- BIB-01: la biblioteca de la Rebanada 24 solo admitia texto escrito a
-- mano. Ahora un recurso puede ser tambien un enlace externo o un
-- archivo de verdad —un PDF con la lista de intercambios, la foto de una
-- receta— y todos pueden llevar imagen de portada.

create type recurso_tipo as enum ('texto', 'enlace', 'archivo');

alter table recurso
  add column tipo recurso_tipo not null default 'texto',

  -- Portada. Solo https, igual que la foto de perfil de la R25: este
  -- valor acaba en el atributo src de una etiqueta img de la aplicacion
  -- del paciente, y un http:// filtraria la peticion en claro.
  add column imagen_portada_url text
    check (imagen_portada_url is null
           or (imagen_portada_url like 'https://%' and char_length(imagen_portada_url) <= 500)),

  add column url_externa text
    check (url_externa is null
           or (url_externa like 'https://%' and char_length(url_externa) <= 1000)),

  -- ── El archivo NO se guarda aqui ────────────────────────────────
  --
  -- Apunta a `archivo`, la tabla generica de la Rebanada 5: nombre
  -- original, mime detectado por firma de bytes, tamano, sha256 y
  -- clinica. Los binarios los guarda el modulo `almacen`.
  --
  -- El encargo montaba MinIO y hablaba con S3 directamente desde estas
  -- rutas. Eso habria dejado DOS sistemas de archivos en el proyecto:
  -- los informes de laboratorio en disco y la biblioteca en S3, con dos
  -- copias de seguridad, dos formas de borrar y dos sitios donde mirar
  -- cuando algo no aparece.
  --
  -- Y no hace falta: el modulo de la R5 ya se escribio con una interfaz
  -- para esto. Su propia nota dice que "cambiar a S3 es anadir una clase
  -- que cumpla la interfaz"; ese cambio mueve TODOS los archivos a la
  -- vez y es una rebanada en si mismo, no media funcion de biblioteca.
  add column archivo_id uuid references archivo(id),

  -- Cada tipo exige lo suyo y prohibe lo demas. Sin esto cabria un
  -- recurso de tipo 'archivo' sin archivo, que en la pantalla del
  -- paciente es un boton de descarga que no descarga nada.
  add constraint chk_recurso_tipo check (
    (tipo = 'texto'   and url_externa is null and archivo_id is null)
    or (tipo = 'enlace'  and url_externa is not null and archivo_id is null)
    or (tipo = 'archivo' and archivo_id is not null and url_externa is null)
  );

-- El contenido deja de ser obligatorio: un enlace o un PDF se explican
-- con el titulo y el resumen. Seguia siendo `not null` de la R24, donde
-- todo recurso era texto.
alter table recurso alter column contenido drop not null;

alter table recurso drop constraint if exists recurso_contenido_check;
alter table recurso add constraint chk_recurso_contenido check (
  -- Un recurso de texto sin texto no es un recurso.
  (tipo <> 'texto' or (contenido is not null and char_length(trim(contenido)) >= 1))
  and (contenido is null or char_length(contenido) <= 20000)
);

create index idx_recurso_archivo on recurso (archivo_id) where archivo_id is not null;
