-- 059_personalizacion.sql
--
-- R53: el paciente elige el color de su app y su avatar, y un
-- profesional puede pertenecer a más de una clínica.
--
-- ## Dónde van las preferencias del paciente
--
-- El encargo pedía estas columnas en `paciente`. Van en
-- `configuracion_paciente` (migración 026), que es donde ya viven
-- `modo_diario`, `fondo`, `foto_url` y `nombre_preferido`. Esa tabla
-- tiene clave primaria (paciente_id, clinica_id) a propósito: la misma
-- persona puede ser paciente de dos clínicas y querer la app distinta
-- en cada una. Ponerlas en `paciente` perdería esa distinción y dejaría
-- las preferencias repartidas entre dos tablas.
--
-- Por lo mismo NO se añade `paciente.foto_url`: ya existe
-- `configuracion_paciente.foto_url`.
--
-- ## Dónde va el logo de la clínica
--
-- En ningún sitio nuevo. `brand_config` ya guarda `logo_ruta`,
-- `logo_mime`, `nombre_app` y `color_primario` por clínica, y la sirven
-- `GET /api/brand` (lectura pública) y `PUT /api/brand/logo`. Añadir
-- `clinica.logo_url` habría dado dos logos y ninguna regla sobre cuál
-- gana.
--
-- ## El color del paciente y el de la clínica
--
-- `brand_config.color_primario` ya pinta `--primary` en la app del
-- paciente (`asegurarMarca()`). La paleta que elige el paciente lo
-- sobrescribe, y solo en SU app: es su teléfono. Sin elección suya,
-- manda la marca de la clínica. Queda anotado porque es una decisión de
-- producto, no un detalle de esta tabla.

/* ------------------------------------------------------------------ */
/* 1. Paleta de color elegida por el paciente                          */
/* ------------------------------------------------------------------ */

-- Diez paletas cerradas, no un color libre. Un selector de color
-- arbitrario deja elegir amarillo sobre blanco, y el texto de la app
-- deja de leerse. Estas diez están contrastadas contra `--on-primary`.
--
-- `fondo` (026) es otra cosa y convive: aquél es el degradado de la
-- cabecera, éste es el color de acción — botones, barra inferior,
-- cifras destacadas.
alter table configuracion_paciente
  add column if not exists paleta_color text not null default 'verde'
    check (paleta_color in (
      'verde','azul-oceano','azul-cielo','turquesa',
      'indigo','violeta','rosa','naranja','rojo','gris'
    ));

/* ------------------------------------------------------------------ */
/* 2. Avatar ilustrado                                                 */
/* ------------------------------------------------------------------ */

-- El avatar se dibuja como SVG en el cliente a partir de estos
-- parámetros: no se guarda ninguna imagen. Son seis campos y no un
-- jsonb porque cada uno tiene su dominio cerrado y se quiere que la
-- base lo haga cumplir; un jsonb admitiría `{"piel": "rojo"}` sin
-- rechistar.
--
-- Conviven con `foto_url`: si hay foto se enseña la foto, y el avatar
-- queda guardado por debajo. Quitar la foto devuelve el avatar que el
-- paciente había construido, no uno por defecto.
alter table configuracion_paciente
  -- Cuál de los 12 personajes de la galería eligió. Se guarda aunque
  -- luego personalice: es lo que se vuelve a marcar al abrir la
  -- pantalla.
  add column if not exists avatar_personaje smallint not null default 0
    check (avatar_personaje between 0 and 11),

  add column if not exists avatar_piel text not null default '#FDDCB5'
    check (avatar_piel ~ '^#[0-9a-fA-F]{6}$'),

  add column if not exists avatar_cabello_estilo text not null default 'Largo'
    check (avatar_cabello_estilo in
      ('Corto','Largo','Rizado','Ondulado','Moño','Corto M','Calvo')),

  add column if not exists avatar_cabello_color text not null default '#2C1B18'
    check (avatar_cabello_color ~ '^#[0-9a-fA-F]{6}$'),

  -- No estaba en el encargo, y el generador lo necesita: los 12
  -- personajes de la galería se distinguen también por el color de ojos.
  -- Sin la columna, elegir un personaje y guardarlo lo cambiaba.
  add column if not exists avatar_ojos text not null default '#3D2B1A'
    check (avatar_ojos ~ '^#[0-9a-fA-F]{6}$'),

  add column if not exists avatar_expresion text not null default 'Sonrisa'
    check (avatar_expresion in ('Sonrisa','Neutral','Amplia')),

  -- Mismo caso que los ojos: dos de los doce personajes llevan gafas.
  add column if not exists avatar_lentes boolean not null default false;

comment on column configuracion_paciente.avatar_personaje is
  'Personaje de la galeria (0-11) que eligio el paciente. Los demas campos avatar_* pueden haberse personalizado despues.';

/* ------------------------------------------------------------------ */
/* 3. Un profesional en varias clínicas                                */
/* ------------------------------------------------------------------ */

-- `profesional.clinica_id` ata cada profesional a una sola clínica.
-- Esta tabla es la relación N:M que lo sustituye.
--
-- Tipos: `uuid`, no `serial`/`integer` como decía el encargo.
-- `clinica.id` y `profesional.id` son uuid desde la 001, y la tabla tal
-- como venía escrita no llega a crearse —falla con un error de tipo en
-- la clave ajena—.
create table if not exists clinica_profesional (
  id              uuid        primary key default gen_random_uuid(),
  clinica_id      uuid        not null references clinica(id) on delete cascade,
  profesional_id  uuid        not null references profesional(id) on delete cascade,

  -- El MISMO vocabulario que `profesional.rol`, reusando su enum. El
  -- encargo proponía 'admin'/'profesional', que son los mismos dos
  -- papeles con otro nombre: dos vocabularios para lo mismo obligan a
  -- traducir en cada consulta y a la larga uno se queda sin actualizar.
  --
  -- Y aquí es donde el rol tiene sentido: ser administrador es algo que
  -- se es EN UNA CLÍNICA, no en abstracto. Cuando toda la API lea de
  -- esta tabla, `profesional.rol` se podrá deprecar.
  rol             profesional_rol not null default 'nutricionista',

  activo          boolean     not null default true,
  created_at      timestamptz not null default now(),

  unique (clinica_id, profesional_id)
);

create index if not exists idx_clinica_profesional_clinica
  on clinica_profesional (clinica_id) where activo = true;
create index if not exists idx_clinica_profesional_profesional
  on clinica_profesional (profesional_id) where activo = true;

-- Copia de la relación actual.
--
-- El rol se copia del profesional; el encargo ponía 'admin' para todos,
-- y eso habría hecho administrador de la clínica a cada nutricionista
-- que hubiera dentro. `activo` sale del estado: un profesional inactivo
-- no es miembro activo de nada.
--
-- `clinica_id` es NOT NULL en `profesional`, así que el `where ... is
-- not null` del encargo no filtraba nada y se omite.
insert into clinica_profesional (clinica_id, profesional_id, rol, activo)
select clinica_id, id, rol, estado <> 'inactivo'
  from profesional
on conflict (clinica_id, profesional_id) do nothing;

-- `profesional.clinica_id` NO se elimina. Queda como columna legada
-- hasta que toda la API lea de `clinica_profesional`; hoy la lee
-- `resolverAlcance()` y poco más, pero el resto del código la usa para
-- acotar por tenant y quitarla ahora rompería medio expediente.
comment on column profesional.clinica_id is
  'LEGADO (R53): la pertenencia a una clinica vive en clinica_profesional. Se conserva para el codigo que todavia no migro.';
