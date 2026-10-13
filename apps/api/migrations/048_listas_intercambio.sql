-- migration: 048_listas_intercambio
--
-- El sistema de intercambios ADA + Valance como DATOS versionados, no como
-- una cadena dentro de un prompt.
--
-- Hasta ahora los once grupos vivian escritos a mano en la constante
-- SISTEMA_ADA de routes/registroDietetico.ts, y el modelo hacia todo:
-- identificaba el alimento, le asignaba un grupo, estimaba las porciones,
-- multiplicaba y sumaba. Con los valores en una tabla, la multiplicacion la
-- hace el servidor y "basarse exclusivamente en el documento" pasa a ser
-- verificable: si el codigo multiplica contra estas filas, el numero no
-- puede venir de otro lado. Mientras el modelo sumara, era una instruccion
-- en un prompt.
--
-- El patron es el de 026_alimentos: tabla de referencia sembrada en la
-- migracion, con clinica_id nulo para las filas globales y con valor para el
-- ajuste de una clinica. Y el sembrado va ACA y no en un script aparte
-- porque para datos de referencia clinica el historial de git es la
-- trazabilidad: se puede ver que valor cambio y cuando.
--
-- DOS DIFERENCIAS con lo que decia SISTEMA_ADA, y el documento manda:
--   azucar            CHO 5 -> 15, kcal 20 -> 60
--   lacteo descremado grasa 1 -> 1.5

-- ── Grupos de intercambio ───────────────────────────────────────────
--
-- Un grupo = los valores nutricionales de UN intercambio. Todo lo demas se
-- calcula multiplicando por porciones.

create table if not exists grupo_intercambio (
  id          uuid           primary key default gen_random_uuid(),
  nombre      text           not null,
  cho_g       numeric(6,2)   not null,
  chon_g      numeric(6,2)   not null,
  grasa_g     numeric(6,2)   not null,
  kcal        numeric(7,2)   not null,
  -- Nulo = grupo global. Con valor = ajuste de esa clinica, que no ensucia
  -- el de nadie mas. Mismo criterio que alimento_catalogo.
  clinica_id  uuid           references clinica(id),
  created_at  timestamptz    not null default now(),
  updated_at  timestamptz    not null default now()
);

-- Las dos unicidades que hacen idempotente el sembrado: un nombre global y
-- un nombre por clinica. Parciales porque un UNIQUE normal sobre
-- (clinica_id, nombre) deja pasar dos filas globales -- en SQL, null nunca
-- es igual a null.
create unique index if not exists uq_grupo_intercambio_global
  on grupo_intercambio (lower(nombre)) where clinica_id is null;
create unique index if not exists uq_grupo_intercambio_clinica
  on grupo_intercambio (clinica_id, lower(nombre)) where clinica_id is not null;

-- ── Equivalencias ───────────────────────────────────────────────────
--
-- Que cuenta como cuanto: "1/2 tz de frijoles" = 1 harina + 1 proteina
-- magra. Por eso hay dos cosas y no una:
--
--   grupo_intercambio_id  la LISTA del documento donde vive la fila -- su
--                         seccion. Los frijoles viven en la lista de
--                         harinas.
--   porciones_json        su COMPOSICION real, que puede tocar varios
--                         grupos. Es lo que se multiplica.
--
-- Confundir las dos es el error que hace que los frijoles cuenten como
-- harina y se pierdan siete gramos de proteina por porcion.

create table if not exists equivalencia_intercambio (
  id                    uuid         primary key default gen_random_uuid(),
  grupo_intercambio_id  uuid         not null references grupo_intercambio(id),
  alimento              text         not null,
  cantidad_descripcion  text         not null,
  -- Nulo cuando el documento no da gramos: "1 rebanada", "1 paquete". No se
  -- inventa una conversion -- un gramaje supuesto se multiplica igual que uno
  -- medido y no se distingue del real.
  cantidad_g            numeric(7,1),
  -- Subtipo del documento: granos, panes y pastas, monoinsaturada,
  -- saturada... No esta en el pedido y lo agrego porque el documento lo
  -- distingue, y la diferencia entre una grasa mono y una saturada es
  -- clinica. Dejarlo afuera seria tirar informacion del documento.
  subtipo               text,
  -- [{"grupo_id": "harina", "cantidad_decimal": 1}, ...]
  --
  -- `grupo_id` lleva el NOMBRE del grupo y no su uuid, a proposito: asi el
  -- sembrado se puede leer y cotejar contra el documento sin resolver
  -- identificadores a mano. La integridad la pone el disparador de abajo,
  -- que es mas que lo que daria una FK dentro de un jsonb.
  porciones_json        jsonb        not null,
  clinica_id            uuid         references clinica(id),
  activo                boolean      not null default true,
  created_at            timestamptz  not null default now(),
  updated_at            timestamptz  not null default now(),
  constraint porciones_no_vacias check (jsonb_array_length(porciones_json) > 0)
);

create unique index if not exists uq_equivalencia_global
  on equivalencia_intercambio (lower(alimento)) where clinica_id is null;
create unique index if not exists uq_equivalencia_clinica
  on equivalencia_intercambio (clinica_id, lower(alimento))
  where clinica_id is not null;

-- La busqueda del profesional: sin acentos y por parecido, reusando la
-- funcion inmutable de 026 -- nadie escribe "ñampí" con tilde ni con ene.
create index if not exists idx_equivalencia_busqueda on equivalencia_intercambio
  using gin (alimento_texto_busqueda(alimento, '{}'::text[]) gin_trgm_ops)
  where activo = true;

create index if not exists idx_equivalencia_grupo
  on equivalencia_intercambio (grupo_intercambio_id) where activo = true;

-- ── Integridad de porciones_json ────────────────────────────────────
--
-- Un `grupo_id` que no existe deja una equivalencia que suma de menos en
-- silencio: el calculo no falla, devuelve un numero mas chico. Para datos
-- de referencia clinica eso es peor que un error.
--
-- Va como disparador y no como comprobacion al final de la migracion porque
-- una clinica puede agregar sus propias equivalencias despues, y entonces la
-- validacion de carga ya no alcanza.

create or replace function equivalencia_porciones_validas()
  returns trigger as $$
declare
  faltante text;
begin
  select p->>'grupo_id' into faltante
    from jsonb_array_elements(new.porciones_json) p
   where not exists (
     select 1 from grupo_intercambio g
      where lower(g.nombre) = lower(p->>'grupo_id')
        and (g.clinica_id is null or g.clinica_id = new.clinica_id))
      or (p->>'cantidad_decimal') is null
      or (p->>'cantidad_decimal')::numeric <= 0
   limit 1;

  if faltante is not null then
    raise exception 'porciones_json nombra un grupo inexistente o una cantidad no positiva: %', faltante;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_equivalencia_porciones on equivalencia_intercambio;
create trigger trg_equivalencia_porciones
  before insert or update on equivalencia_intercambio
  for each row execute function equivalencia_porciones_validas();

-- ── Sembrado: los once grupos ───────────────────────────────────────

insert into grupo_intercambio (clinica_id, nombre, cho_g, chon_g, grasa_g, kcal)
values
  (null, 'lácteo_descremado',          12,      8,    1.5,    100),
  (null, 'lácteo_semidescremado',      12,      8,      5,    120),
  (null, 'lácteo_entero',              12,      8,      8,    160),
  (null, 'fruta',                      15,      0,      0,     60),
  (null, 'vegetal',                     5,      2,      0,     25),
  (null, 'harina',                     15,      3,      1,     80),
  (null, 'azucar',                     15,      0,      0,     60),
  (null, 'proteina_magra',              0,      7,      2,     45),
  (null, 'proteina_semimagra',          0,      7,      5,     75),
  (null, 'proteina_alta_grasa',         0,      7,      8,    100),
  (null, 'grasa',                       0,      0,      5,     45)
on conflict do nothing;

-- ── Sembrado: las equivalencias ─────────────────────────────────────
--
-- Cada alimento que el documento junta con "/" es una fila propia: el
-- documento los agrupa para ahorrar tinta, y la busqueda necesita encontrar
-- "gallo pinto" sin que nadie escriba los otros cinco de su renglon.
--
-- El grupo se resuelve por nombre en un `select`, no con un uuid escrito a
-- mano: un identificador copiado mal apunta a otro grupo y el calculo sale
-- plausible y equivocado.

insert into equivalencia_intercambio
  (clinica_id, grupo_intercambio_id, alimento, cantidad_descripcion,
   cantidad_g, subtipo, porciones_json)
select null, g.id, v.alimento, v.cantidad_descripcion, v.cantidad_g,
       v.subtipo, v.porciones::jsonb
  from (values
    -- harina / granos,
    ('harina', 'arroz blanco', '½ tz', 90, 'granos', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'arroz integral', '½ tz', 90, 'granos', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'gallo pinto', '½ tz', 90, 'granos', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'maíz', '½ tz', 90, 'granos', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'petit pois', '½ tz', 90, 'granos', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'maíz dulce', '½ tz', 90, 'granos', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'frijoles', '½ tz', 90, 'granos', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('harina', 'garbanzos', '½ tz', 90, 'granos', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('harina', 'lentejas', '½ tz', 90, 'granos', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('harina', 'arvejas', '½ tz', 90, 'granos', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('harina', 'cubaces', '½ tz', 90, 'granos', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('harina', 'avena integral', '¼ tz', 30, 'granos', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'avena instantánea sin azúcar', '¼ tz', 30, 'granos', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'hojuelas de avena', '¼ tz', 30, 'granos', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'granola sin azúcar', '¼ tz', 30, 'granos', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'avena instantánea con azúcar', '¼ tz', 30, 'granos', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('harina', 'granola con azúcar', '¼ tz', 30, 'granos', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "azucar", "cantidad_decimal": 1}]'),

    -- harina / verduras harinosas,
    ('harina', 'camote', '½ tz', 90, 'verduras harinosas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'yuca', '½ tz', 90, 'verduras harinosas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'tiquizque', '½ tz', 90, 'verduras harinosas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'ñampí', '½ tz', 90, 'verduras harinosas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'ñame', '½ tz', 90, 'verduras harinosas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'papa', '½ tz', 90, 'verduras harinosas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'tacaco', '½ tz', 90, 'verduras harinosas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'arracache', '½ tz', 90, 'verduras harinosas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'ayote', '½ tz', 90, 'verduras harinosas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'picadillos', '½ tz', 90, 'verduras harinosas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'plátano verde', '4 dedos', 60, 'verduras harinosas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'plátano maduro', '4 dedos', 60, 'verduras harinosas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'elote', '1 unidad de 15 cm', null, 'verduras harinosas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'pejibayes', '1 unidad mediana', 80, 'verduras harinosas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'frijoles molidos de paquete', '½ tz', null, 'verduras harinosas', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 2}, {"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),

    -- harina / panes y pastas,
    ('harina', 'pan cuadrado blanco', '1 rebanada', null, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'pan cuadrado integral', '1 rebanada', null, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'pan cuadrado light', '2 rebanadas', null, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'pan de masa madre', '1 rebanada', 50, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'pan thins', '1 unidad', null, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'pan artesano', '1 unidad', null, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 2}]'),
    ('harina', 'pan pita', '1 unidad', null, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 2}]'),
    ('harina', 'pan konig', '1 unidad', null, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 2}]'),
    ('harina', 'pan figazza', '1 unidad', null, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 3}, {"grupo_id": "proteina_magra", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('harina', 'pan de hamburguesa Bimbo', '1 unidad', null, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 3}, {"grupo_id": "proteina_magra", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('harina', 'pan de hot dog Bimbo', '1 unidad', null, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'pan de hamburguesa Konig', '1 unidad', null, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 1.5}]'),
    ('harina', 'pan baguette', '4 dedos', 30, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'pan casero dulce', '1 unidad mediana', null, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 2}, {"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('harina', 'pasta cocida', '½ tz', 55, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'pasta cruda', '½ tz', 30, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'canelones', '2 unidades', null, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'harina de avena', '3 cdas', 30, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'harina de maíz', '3 cdas', 30, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'harina de trigo', '3 cdas', 30, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'harina de cebada', '3 cdas', 30, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'harina de arroz', '3 cdas', 30, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'harina de yuca', '3 cdas', 30, 'panes y pastas', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),

    -- harina / tortillas y cereales,
    ('harina', 'tortillas TortiRicas', '2 unidades', null, 'tortillas y cereales', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'tortillas Fogón', '1 unidad', null, 'tortillas y cereales', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'tortillas gruesas', '1 unidad', null, 'tortillas y cereales', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'tortilla de trigo mediana', '1 unidad', null, 'tortillas y cereales', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'tortilla de trigo para burrito', '1 unidad', null, 'tortillas y cereales', '[{"grupo_id": "harina", "cantidad_decimal": 3}, {"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('harina', 'tortillas chalupa', '2 unidades', null, 'tortillas y cereales', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'tortillas taco', '2 unidades', null, 'tortillas y cereales', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'cereales sin azúcar', '⅔ tz', 25, 'tortillas y cereales', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'cereales Tosh', '⅓ tz', 35, 'tortillas y cereales', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "azucar", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('harina', 'cereales con azúcar', '½ tz', 23, 'tortillas y cereales', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('harina', 'Honey Monster', '½ tz', 23, 'tortillas y cereales', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('harina', 'Zucaritas', '½ tz', 23, 'tortillas y cereales', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "azucar", "cantidad_decimal": 1}]'),

    -- harina / galletas y snacks,
    ('harina', 'Salmas', '1 paquete', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'galletas de arroz', '2 grandes', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'galleta María', '1 paquete', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'galleta Soda', '1 paquete', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'galleta Campechanas', '1 paquete', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'galletas Tosh', '1 paquete', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('harina', 'galletas Club', '1 paquete', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('harina', 'galletas de fibra con miel', '1 paquete', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('harina', 'Cosecha Dorada', '2 galletas', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('harina', 'Nutrisnacks', '1 galleta', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('harina', 'Oreo', '1 paquete', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 2}, {"grupo_id": "azucar", "cantidad_decimal": 2}, {"grupo_id": "grasa", "cantidad_decimal": 2}]'),
    ('harina', 'Recreo', '1 paquete', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 2}, {"grupo_id": "azucar", "cantidad_decimal": 2}, {"grupo_id": "grasa", "cantidad_decimal": 2}]'),
    ('harina', 'Chicky', '1 paquete', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 2}, {"grupo_id": "azucar", "cantidad_decimal": 2}, {"grupo_id": "grasa", "cantidad_decimal": 2}]'),
    ('harina', 'Cremita', '1 paquete', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 1}, {"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('harina', 'Julieta', '5 galletas', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 2}]'),
    ('harina', 'Merendina', '1 paquete', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 1}, {"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('harina', 'Canasta', '1 paquete', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 1}, {"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('harina', 'Sorbeto', '1 paquete', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('harina', 'barrita NutriSnacks proteína', '1 paquete', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('harina', 'barritas Special K', '1 paquete', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 2}, {"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('harina', 'barritas Nature Valley', '1 paquete', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 2}, {"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('harina', 'barritas Tosh', '1 paquete', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('harina', 'Pop Corners', '20 unidades', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('harina', 'palomitas Act II light', '3 tazas', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}]'),
    ('harina', 'bizcochos zarcereña', '5 unidades', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 2}, {"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('harina', 'Pringles', '19 unidades', null, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 2}, {"grupo_id": "grasa", "cantidad_decimal": 2}]'),
    ('harina', 'Rumbas', '5 unidades', 25, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('harina', 'Patacones Rumba', '5 unidades', 25, 'galletas y snacks', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 1}]'),

    -- vegetal / sin almidón,
    ('vegetal', 'vegetal cocido', '½ tz', null, 'sin almidón', '[{"grupo_id": "vegetal", "cantidad_decimal": 1}]'),
    ('vegetal', 'vegetal crudo', '1 tz', null, 'sin almidón', '[{"grupo_id": "vegetal", "cantidad_decimal": 1}]'),
    ('vegetal', 'salsa de tomate Naturas', '¼ tz', null, 'sin almidón', '[{"grupo_id": "vegetal", "cantidad_decimal": 1}, {"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('vegetal', 'crema de vegetales con leche', '1 tz', null, 'sin almidón', '[{"grupo_id": "vegetal", "cantidad_decimal": 1}, {"grupo_id": "lácteo_descremado", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 2}]'),

    -- fruta / -,
    ('fruta', 'banano', '1 unidad mediana', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),
    ('fruta', 'manzana', '1 unidad mediana', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),
    ('fruta', 'mandarina', '1 unidad mediana', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),
    ('fruta', 'naranja', '1 unidad mediana', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),
    ('fruta', 'kiwi', '1 unidad mediana', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),
    ('fruta', 'marañón (fruta)', '1 unidad mediana', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),
    ('fruta', 'ciruela', '1 unidad mediana', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),
    ('fruta', 'durazno', '1 unidad mediana', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),
    ('fruta', 'pera', '1 unidad mediana', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),
    ('fruta', 'papaya', '1 tz', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),
    ('fruta', 'piña', '1 tz', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),
    ('fruta', 'melón', '1 tz', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),
    ('fruta', 'sandía', '1 tz', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),
    ('fruta', 'fresas', '1 tz', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),
    ('fruta', 'mango', '1 tz', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),
    ('fruta', 'moras', '1 tz', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),
    ('fruta', 'uvas', '16 pequeñas u 8 grandes', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),
    ('fruta', 'frutas deshidratadas', '2 cdas', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),
    ('fruta', 'jugos de fruta sin azúcar', '120 ml', null, null, '[{"grupo_id": "fruta", "cantidad_decimal": 1}]'),

    -- lácteo_descremado / descremados,
    ('lácteo_descremado', 'leche 0% grasa', '1 tz', null, 'descremados', '[{"grupo_id": "lácteo_descremado", "cantidad_decimal": 1}]'),
    ('lácteo_descremado', 'leche agria', '1 tz', null, 'descremados', '[{"grupo_id": "lácteo_descremado", "cantidad_decimal": 1}]'),
    ('lácteo_descremado', 'leche con proteína', '1 tz', null, 'descremados', '[{"grupo_id": "lácteo_descremado", "cantidad_decimal": 1}, {"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('lácteo_descremado', 'yogurt sin azúcar', '1 tz', null, 'descremados', '[{"grupo_id": "lácteo_descremado", "cantidad_decimal": 1}]'),
    ('lácteo_descremado', 'yogurt griego sin azúcar', '1 tz', null, 'descremados', '[{"grupo_id": "lácteo_descremado", "cantidad_decimal": 1}]'),
    ('lácteo_descremado', 'yogurt alto en proteína sin azúcar Nikkos', '1 tz', null, 'descremados', '[{"grupo_id": "lácteo_descremado", "cantidad_decimal": 1}, {"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('lácteo_descremado', 'yogurt alto en proteína sin azúcar Dos Pinos fit', '1 tz', null, 'descremados', '[{"grupo_id": "lácteo_descremado", "cantidad_decimal": 1}, {"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('lácteo_descremado', 'leche en polvo descremada', '3 cdas', null, 'descremados', '[{"grupo_id": "lácteo_descremado", "cantidad_decimal": 1}]'),
    ('lácteo_descremado', 'leche evaporada', '½ tz', null, 'descremados', '[{"grupo_id": "lácteo_descremado", "cantidad_decimal": 1}]'),
    ('lácteo_descremado', 'kéfir', '½ tz', null, 'descremados', '[{"grupo_id": "lácteo_descremado", "cantidad_decimal": 1}]'),
    ('lácteo_descremado', 'helados sin azúcar', '½ tz', null, 'descremados', '[{"grupo_id": "lácteo_descremado", "cantidad_decimal": 1}]'),

    -- lácteo_semidescremado / semidescremados,
    ('lácteo_semidescremado', 'leche 2% grasa', '1 tz', null, 'semidescremados', '[{"grupo_id": "lácteo_descremado", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('lácteo_semidescremado', 'helados regulares', '½ tz', null, 'semidescremados', '[{"grupo_id": "lácteo_descremado", "cantidad_decimal": 1}, {"grupo_id": "azucar", "cantidad_decimal": 3}, {"grupo_id": "grasa", "cantidad_decimal": 2}]'),
    ('lácteo_semidescremado', 'yogurt regular azucarado', '½ tz', null, 'semidescremados', '[{"grupo_id": "lácteo_descremado", "cantidad_decimal": 1}, {"grupo_id": "azucar", "cantidad_decimal": 5}]'),
    ('lácteo_semidescremado', 'leche en polvo Delactomy', '3 cdas', null, 'semidescremados', '[{"grupo_id": "lácteo_descremado", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 1}]'),

    -- lácteo_entero / enteros,
    ('lácteo_entero', 'leche entera', '1 tz', null, 'enteros', '[{"grupo_id": "lácteo_descremado", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 2}]'),
    ('lácteo_entero', 'leche en polvo regular', '3 cdas', null, 'enteros', '[{"grupo_id": "lácteo_descremado", "cantidad_decimal": 1}, {"grupo_id": "grasa", "cantidad_decimal": 2}]'),

    -- proteina_magra / magra,
    ('proteina_magra', 'pollo sin piel', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'pavo sin piel', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'res sin grasa', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'res molida Premium', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'lomito de res', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'T-bone', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'bacalao', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'tilapia', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'trucha', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'atún', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'salmón', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'sardina', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'lomito de cerdo', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'lomo de cerdo', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'pierna de cerdo', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'posta de cerdo sin piel', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'queso cottage', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'queso ricotta', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'queso Monterico light', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'jamón de pavo', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'jamón de pollo', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'jamón de cerdo light', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'camarones', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'ostras', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'almejas', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),
    ('proteina_magra', 'cangrejo', '30 g o 1 oz', 30, 'magra', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),

    -- proteina_semimagra / semimagra,
    ('proteina_semimagra', 'aves con piel', '30 g o 1 oz', 30, 'semimagra', '[{"grupo_id": "proteina_semimagra", "cantidad_decimal": 1}]'),
    ('proteina_semimagra', 'res molida especial', '30 g o 1 oz', 30, 'semimagra', '[{"grupo_id": "proteina_semimagra", "cantidad_decimal": 1}]'),
    ('proteina_semimagra', 'cecina', '30 g o 1 oz', 30, 'semimagra', '[{"grupo_id": "proteina_semimagra", "cantidad_decimal": 1}]'),
    ('proteina_semimagra', 'lengua', '30 g o 1 oz', 30, 'semimagra', '[{"grupo_id": "proteina_semimagra", "cantidad_decimal": 1}]'),
    ('proteina_semimagra', 'pescuezo', '30 g o 1 oz', 30, 'semimagra', '[{"grupo_id": "proteina_semimagra", "cantidad_decimal": 1}]'),
    ('proteina_semimagra', 'trocitos de res', '30 g o 1 oz', 30, 'semimagra', '[{"grupo_id": "proteina_semimagra", "cantidad_decimal": 1}]'),
    ('proteina_semimagra', 'cerdo molido', '30 g o 1 oz', 30, 'semimagra', '[{"grupo_id": "proteina_semimagra", "cantidad_decimal": 1}]'),
    ('proteina_semimagra', 'milanesa de cerdo', '30 g o 1 oz', 30, 'semimagra', '[{"grupo_id": "proteina_semimagra", "cantidad_decimal": 1}]'),
    ('proteina_semimagra', 'paleta de cerdo', '30 g o 1 oz', 30, 'semimagra', '[{"grupo_id": "proteina_semimagra", "cantidad_decimal": 1}]'),
    ('proteina_semimagra', 'trocitos de cerdo', '30 g o 1 oz', 30, 'semimagra', '[{"grupo_id": "proteina_semimagra", "cantidad_decimal": 1}]'),
    ('proteina_semimagra', 'chuleta de cerdo', '30 g o 1 oz', 30, 'semimagra', '[{"grupo_id": "proteina_semimagra", "cantidad_decimal": 1}]'),
    ('proteina_semimagra', 'queso ricotta regular', '30 g o 1 oz', 30, 'semimagra', '[{"grupo_id": "proteina_semimagra", "cantidad_decimal": 1}]'),
    ('proteina_semimagra', 'queso Turrialba', '30 g o 1 oz', 30, 'semimagra', '[{"grupo_id": "proteina_semimagra", "cantidad_decimal": 1}]'),
    ('proteina_semimagra', 'queso mozzarella', '30 g o 1 oz', 30, 'semimagra', '[{"grupo_id": "proteina_semimagra", "cantidad_decimal": 1}]'),
    ('proteina_semimagra', 'huevo entero', '1 unidad', null, 'semimagra', '[{"grupo_id": "proteina_semimagra", "cantidad_decimal": 1}]'),

    -- proteina_alta_grasa / alta en grasa,
    ('proteina_alta_grasa', 'menudos de pollo', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'mondongo de res', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'res molida popular', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'costilla de res', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'jarrete', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'rabo', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'costilla de cerdo', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'cabeza de chuleta de cerdo', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'tocineta', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'mortadela', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'salchicha', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'chorizo', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'salchichón', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'queso americano', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'queso cheddar', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'queso parmesano', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'queso Monterico regular', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'queso rico', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'queso tico', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'queso pizzero', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'queso amarillo', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),
    ('proteina_alta_grasa', 'queso maduro', '30 g o 1 oz', 30, 'alta en grasa', '[{"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),

    -- proteina_magra / vegetal,
    ('proteina_magra', 'embutidos vegetarianos', '30 g', 30, 'vegetal', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),

    -- proteina_alta_grasa / vegetal,
    ('proteina_alta_grasa', 'falafel', '3 unidades', null, 'vegetal', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "proteina_alta_grasa", "cantidad_decimal": 1}]'),

    -- proteina_magra / vegetal,
    ('proteina_magra', 'edamame', '½ tz', null, 'vegetal', '[{"grupo_id": "harina", "cantidad_decimal": 0.5}, {"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),

    -- proteina_semimagra / vegetal,
    ('proteina_semimagra', 'tofu regular', '½ tz', null, 'vegetal', '[{"grupo_id": "proteina_semimagra", "cantidad_decimal": 1}]'),

    -- proteina_magra / vegetal,
    ('proteina_magra', 'tofu light', '½ tz', null, 'vegetal', '[{"grupo_id": "proteina_magra", "cantidad_decimal": 1}]'),

    -- proteina_semimagra / vegetal,
    ('proteina_semimagra', 'hummus', '⅓ tz', null, 'vegetal', '[{"grupo_id": "harina", "cantidad_decimal": 1}, {"grupo_id": "proteina_semimagra", "cantidad_decimal": 1}]'),

    -- grasa / monoinsaturada,
    ('grasa', 'aceite de oliva', '1 cdta', null, 'monoinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'aceite de canola', '1 cdta', null, 'monoinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'aceitunas', '10 unidades', null, 'monoinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'aguacate', '¼ unidad', null, 'monoinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'mantequilla de almendra', '2 cdtas', null, 'monoinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'mantequilla de marañón', '2 cdtas', null, 'monoinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'mantequilla de maní', '2 cdtas', null, 'monoinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'maní', '10 unidades', null, 'monoinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'nueces', '10 unidades', null, 'monoinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'almendras', '10 unidades', null, 'monoinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'marañón (semilla)', '10 unidades', null, 'monoinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'pistachos', '10 unidades', null, 'monoinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),

    -- grasa / poliinsaturada,
    ('grasa', 'chía', '1 cda', null, 'poliinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'semillas de girasol', '1 cda', null, 'poliinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'ajonjolí', '1 cda', null, 'poliinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'linaza', '1 cda', null, 'poliinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'aderezo regular', '2 cdas', null, 'poliinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'aderezo light', '1 cda', null, 'poliinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'mayonesa regular', '1 cda', null, 'poliinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'mayonesa light', '2 cdas', null, 'poliinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'margarina regular', '1 cdta', null, 'poliinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'margarina light', '1 cda', null, 'poliinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'aceite de soya', '1 cdta', null, 'poliinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'aceite de maíz', '1 cdta', null, 'poliinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'aceite de girasol', '1 cdta', null, 'poliinsaturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),

    -- grasa / saturada,
    ('grasa', 'queso crema regular', '1 cda', null, 'saturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'queso crema light', '2 cdas', null, 'saturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'natilla regular', '2 cdas', null, 'saturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'natilla light', '3 cdas', null, 'saturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'mantequilla regular', '1 cdta', null, 'saturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'lactocrema regular', '1 cdta', null, 'saturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'mantequilla light', '1 cda', null, 'saturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'lactocrema light', '1 cda', null, 'saturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'aceite de coco', '1 cdta', null, 'saturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),
    ('grasa', 'aceite de palma', '1 cdta', null, 'saturada', '[{"grupo_id": "grasa", "cantidad_decimal": 1}]'),

    -- azucar / -,
    ('azucar', 'azúcar blanca', '1 cda', null, null, '[{"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('azucar', 'azúcar morena', '1 cda', null, null, '[{"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('azucar', 'azúcar granulada', '1 cda', null, null, '[{"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('azucar', 'mermelada', '1 cda', null, null, '[{"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('azucar', 'jalea', '1 cda', null, null, '[{"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('azucar', 'miel', '1 cda', null, null, '[{"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('azucar', 'agua dulce', '1 cda', null, null, '[{"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('azucar', 'sirope', '1 cda', null, null, '[{"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('azucar', 'gelatina regular', '½ tz', null, null, '[{"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('azucar', 'Morenitos', '3 unidades', null, null, '[{"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('azucar', 'Frutinis', '3 unidades', null, null, '[{"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('azucar', 'Mentas', '3 unidades', null, null, '[{"grupo_id": "azucar", "cantidad_decimal": 1}]'),
    ('azucar', 'Guayabitas Gallito', '3 unidades', null, null, '[{"grupo_id": "azucar", "cantidad_decimal": 1}]')
  ) as v(grupo, alimento, cantidad_descripcion, cantidad_g, subtipo, porciones)
  join grupo_intercambio g on lower(g.nombre) = lower(v.grupo) and g.clinica_id is null
on conflict do nothing;

-- ── Notas de transcripcion ──────────────────────────────────────────
--
-- 1. El documento da un RANGO para el yogurt alto en proteina sin azucar
--    (Nikkos, Dos Pinos fit): "1 a 3 proteinas magras". Un rango no se
--    puede multiplicar, asi que se sembro el extremo BAJO (1). Subestima
--    proteina en lugar de sobreestimarla, que es el error que el
--    profesional puede corregir hacia arriba viendo el alimento. Hace falta
--    decidir el valor definitivo, o partirlo en una fila por producto.
--
-- 2. Las equivalencias de lacteo semidescremado y entero se expresan en el
--    documento como "1 lacteo descremado + N grasas", no contra su propio
--    grupo. Se transcribio tal cual. Los grupos lacteo_semidescremado y
--    lacteo_entero quedan sembrados -- el documento los define -- pero
--    ninguna equivalencia los usa todavia.

