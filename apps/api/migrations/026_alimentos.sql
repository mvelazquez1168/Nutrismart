-- migration: 026_alimentos
--
-- PAC-07: contador de porciones. El diario de la Rebanada 22 admite una
-- frase por comida ("arroz con pollo y ensalada") y, opcionalmente, las
-- calorias a ojo. Esto anade el modo DETALLADO: alimento por alimento,
-- con cantidad, y las kcal salen de una tabla en vez de una estimacion.
--
-- Los dos modos conviven. El simple es mas rapido y hay pacientes que
-- no van a hacer otra cosa; el detallado da datos con los que se puede
-- trabajar. Lo elige el paciente, no la clinica.

-- Sin acentos no hay busqueda util: nadie escribe "plátano" con tilde en
-- el movil, y "brocoli" tiene que encontrar "Brócoli".
create extension if not exists unaccent;
create extension if not exists pg_trgm;

-- El texto sobre el que busca el usuario: nombre y sinonimos juntos, sin
-- acentos y en minusculas.
--
-- Va en una funcion propia porque para indexar la expresion tiene que
-- ser IMMUTABLE, y ni `unaccent()` ni `array_to_string()` lo son —la
-- primera porque en teoria su diccionario puede cambiar, la segunda
-- porque depende de la funcion de salida del tipo—. Fijando el
-- diccionario y el tipo de entrada, el resultado sí es constante.
--
-- Tenerla como funcion tiene otra ventaja: la busqueda del endpoint usa
-- exactamente la misma expresion que el indice, así que no pueden
-- divergir.
create or replace function alimento_texto_busqueda(nombre text, sinonimos text[])
  returns text as
  $$ select lower(public.unaccent('public.unaccent',
                                  nombre || ' ' || coalesce(array_to_string(sinonimos, ' '), ''))) $$
language sql immutable strict parallel safe;

-- ── Catalogo de alimentos ───────────────────────────────────────────
--
-- clinica_id NULL = alimento global, visible para todas las clinicas.
-- Con valor = alimento propio de esa clinica. Asi una consulta puede
-- anadir "gallo pinto de la casa" sin ensuciar el catalogo de nadie.
create table alimento_catalogo (
  id                 uuid         primary key default gen_random_uuid(),
  clinica_id         uuid         references clinica(id),

  nombre             text         not null check (char_length(trim(nombre)) between 1 and 200),
  -- Como lo llama la gente. La busqueda mira aqui tambien: en Costa Rica
  -- se dice "tomate", en Mexico "jitomate", y las dos tienen que llevar
  -- al mismo alimento.
  sinonimos          text[]       not null default '{}',

  kcal_por_100g      numeric(6,1) not null check (kcal_por_100g >= 0 and kcal_por_100g <= 900),
  proteina_por_100g  numeric(5,1) not null default 0 check (proteina_por_100g >= 0),
  cho_por_100g       numeric(5,1) not null default 0 check (cho_por_100g >= 0),
  grasa_por_100g     numeric(5,1) not null default 0 check (grasa_por_100g >= 0),

  -- Cuanto es "una porcion" de esto. Es lo que se ofrece por defecto
  -- para que el paciente no tenga que pesar nada.
  porcion_tipica_g   numeric(6,1) not null check (porcion_tipica_g > 0),
  unidad_porcion     text         not null default 'g'
                       check (unidad_porcion in ('g', 'ml', 'pza')),
  categoria          text         not null default 'otro'
                       check (categoria in ('cereales','leguminosas','carnes','lacteos',
                                            'frutas','verduras','bebidas','grasas','otro')),

  activo             boolean      not null default true,
  created_at         timestamptz  not null default now(),
  updated_at         timestamptz  not null default now()
);

-- Trigramas para que `ilike '%pech%'` no acabe en un escaneo completo
-- cuando una clinica cargue su propio catalogo.
create index idx_alimento_busqueda on alimento_catalogo
  using gin (alimento_texto_busqueda(nombre, sinonimos) gin_trgm_ops)
  where activo = true;

create index idx_alimento_clinica on alimento_catalogo (clinica_id, categoria)
  where activo = true;

-- Que el seed pueda reejecutarse sin duplicar. Dos indices porque en un
-- UNIQUE normal los NULL no chocan entre si, y todos los alimentos
-- globales tienen clinica_id NULL.
create unique index uq_alimento_global on alimento_catalogo (lower(nombre))
  where clinica_id is null;
create unique index uq_alimento_clinica on alimento_catalogo (clinica_id, lower(nombre))
  where clinica_id is not null;

create trigger trg_alimento_updated
  before update on alimento_catalogo
  for each row execute function set_updated_at();

-- ── Items de una comida ─────────────────────────────────────────────
--
-- Cuelgan de `registro_comida`, que ya tiene UNIQUE (paciente, fecha,
-- franja): la comida es el hueco del dia y los items son lo que hubo
-- dentro. No se crea una tabla paralela de comidas para el modo
-- detallado — seria la misma comida contada dos veces.
create table registro_comida_item (
  id                 uuid         primary key default gen_random_uuid(),
  registro_comida_id uuid         not null references registro_comida(id) on delete cascade,
  clinica_id         uuid         not null references clinica(id),

  -- NULL = alimento escrito a mano, fuera del catalogo. Se admite: el
  -- catalogo nunca va a tener todo, y obligar a elegir de una lista hace
  -- que la gente deje de apuntar.
  alimento_id        uuid         references alimento_catalogo(id),
  -- Se copia el nombre en vez de leerlo por join. Si manana se corrige
  -- una ficha del catalogo, lo que el paciente apunto en marzo sigue
  -- diciendo lo que apunto.
  nombre_alimento    text         not null check (char_length(trim(nombre_alimento)) between 1 and 200),

  cantidad_g         numeric(7,1) not null check (cantidad_g > 0 and cantidad_g <= 5000),
  -- Congelados en el momento de apuntar, por lo mismo.
  kcal               numeric(7,1) check (kcal is null or kcal >= 0),
  proteina_g         numeric(6,1) check (proteina_g is null or proteina_g >= 0),
  cho_g              numeric(6,1) check (cho_g is null or cho_g >= 0),
  grasa_g            numeric(6,1) check (grasa_g is null or grasa_g >= 0),

  activo             boolean      not null default true,
  created_at         timestamptz  not null default now()
);

create index idx_item_registro on registro_comida_item (registro_comida_id, created_at)
  where activo = true;

-- ── Los totales de la comida se DERIVAN de sus items ────────────────
--
-- Esta es la decision que sostiene toda la rebanada. `registro_comida`
-- ya tiene kcal y macros, y de ahi leen la ficha del profesional
-- (Rebanada 22) y la media de calorias del progreso (Rebanada 23).
--
-- Si los items se guardasen aparte y la fila padre conservase lo que el
-- paciente tecleo a ojo, las dos cifras discreparian y ninguna pantalla
-- sabria cual creer. Asi que en cuanto una comida tiene items, sus
-- totales y su descripcion los calcula el trigger. Ninguna pantalla
-- existente se toca y todas quedan bien.
create or replace function recalcular_totales_comida() returns trigger as $$
declare
  -- Se distingue por TG_OP y no con coalesce(new, old): en un trigger de
  -- DELETE la variable NEW no llega a asignarse y leerla revienta.
  reg_id uuid := case when tg_op = 'DELETE'
                      then old.registro_comida_id
                      else new.registro_comida_id end;
  n      integer;
begin
  select count(*) into n
    from registro_comida_item
   where registro_comida_id = reg_id and activo = true;

  -- Sin items, la comida vuelve a ser del modo simple y se deja como
  -- estaba: no es tarea del trigger borrar lo que escribio el paciente.
  if n = 0 then
    return null;
  end if;

  update registro_comida rc
     set descripcion = t.descripcion,
         kcal        = t.kcal,
         proteina_g  = t.proteina_g,
         cho_g       = t.cho_g,
         grasa_g     = t.grasa_g,
         updated_at  = now()
    from (
      select left(string_agg(i.nombre_alimento, ', ' order by i.created_at, i.id), 1000) as descripcion,
             round(sum(i.kcal), 1)       as kcal,
             round(sum(i.proteina_g), 1) as proteina_g,
             round(sum(i.cho_g), 1)      as cho_g,
             round(sum(i.grasa_g), 1)    as grasa_g
        from registro_comida_item i
       where i.registro_comida_id = reg_id and i.activo = true
    ) t
   where rc.id = reg_id;

  return null;
end;
$$ language plpgsql;

create trigger trg_item_totales
  after insert or update or delete on registro_comida_item
  for each row execute function recalcular_totales_comida();

-- ── Preferencia del paciente ────────────────────────────────────────
--
-- Por paciente y clinica, no por paciente: la misma persona podria ser
-- paciente de dos clinicas y llevar el diario distinto en cada una.
create table configuracion_paciente (
  paciente_id  uuid        not null references paciente(id),
  clinica_id   uuid        not null references clinica(id),
  modo_diario  text        not null default 'simple'
                 check (modo_diario in ('simple', 'detallado')),
  updated_at   timestamptz not null default now(),
  primary key (paciente_id, clinica_id)
);

-- ── Seed del catalogo global ────────────────────────────────────────
--
-- 35 alimentos de consumo corriente en Costa Rica y Centroamerica, con
-- los sinonimos regionales que hacen falta para encontrarlos. Valores
-- por 100 g / 100 ml.
--
-- Va en la migracion y no en un seed aparte porque sin catalogo el modo
-- detallado no existe: es esquema, no datos de ejemplo.
insert into alimento_catalogo
  (clinica_id, nombre, sinonimos, kcal_por_100g, proteina_por_100g, cho_por_100g,
   grasa_por_100g, porcion_tipica_g, unidad_porcion, categoria)
values
  -- Cereales
  (null, 'Arroz blanco cocido',      '{"arroz","arroz cocido"}',                130, 2.7,  28.2, 0.3,  150, 'g',   'cereales'),
  (null, 'Gallo pinto',              '{"pinto","arroz con frijoles"}',          150, 5.0,  25.0, 3.0,  200, 'g',   'cereales'),
  (null, 'Tortilla de maíz',         '{"tortilla","taco"}',                     218, 5.7,  44.6, 2.5,  30,  'pza', 'cereales'),
  (null, 'Pan blanco',               '{"pan cuadrado","pan de molde"}',         265, 9.0,  49.0, 3.2,  30,  'pza', 'cereales'),
  (null, 'Pan integral',             '{"pan negro","pan de trigo"}',            247, 13.0, 41.3, 4.2,  30,  'pza', 'cereales'),
  (null, 'Avena cocida',             '{"avena","oatmeal"}',                     71,  2.5,  12.0, 1.5,  250, 'g',   'cereales'),
  (null, 'Pasta cocida',             '{"fideos","espagueti","macarrones"}',     158, 5.8,  30.9, 0.9,  180, 'g',   'cereales'),
  (null, 'Papa cocida',              '{"papa","patata"}',                       87,  1.9,  20.1, 0.1,  150, 'g',   'cereales'),
  (null, 'Plátano maduro cocido',    '{"platano","plátano","maduro"}',                    116, 0.8,  31.2, 0.2,  120, 'g',   'cereales'),
  -- Leguminosas
  (null, 'Frijoles negros cocidos',  '{"frijoles","frijol negro","porotos"}',   132, 8.9,  23.7, 0.5,  120, 'g',   'leguminosas'),
  (null, 'Frijoles rojos cocidos',   '{"frijol rojo","frijoles colorados"}',    127, 8.7,  22.8, 0.5,  120, 'g',   'leguminosas'),
  (null, 'Lentejas cocidas',         '{"lentejas"}',                            116, 9.0,  20.1, 0.4,  100, 'g',   'leguminosas'),
  (null, 'Garbanzos cocidos',        '{"garbanzo"}',                            164, 8.9,  27.4, 2.6,  100, 'g',   'leguminosas'),
  -- Carnes y proteina
  (null, 'Pechuga de pollo',         '{"pollo","filete de pollo"}',             165, 31.0, 0.0,  3.6,  100, 'g',   'carnes'),
  (null, 'Carne molida de res',      '{"carne molida","res","picadillo"}',      218, 26.1, 0.0,  12.3, 100, 'g',   'carnes'),
  (null, 'Bistec de res',            '{"bistec","carne asada"}',                187, 27.0, 0.0,  8.2,  120, 'g',   'carnes'),
  (null, 'Atún en agua',             '{"atun","tuna"}',                         108, 23.6, 0.0,  0.9,  100, 'g',   'carnes'),
  (null, 'Tilapia',                  '{"pescado","filete de pescado"}',         96,  20.1, 0.0,  1.7,  120, 'g',   'carnes'),
  (null, 'Huevo entero',             '{"huevo","huevos"}',                      155, 12.6, 1.1,  10.6, 55,  'pza', 'carnes'),
  (null, 'Claras de huevo',          '{"claras","clara de huevo"}',             52,  10.9, 0.7,  0.2,  100, 'ml',  'carnes'),
  -- Lacteos
  (null, 'Leche entera',             '{"leche"}',                               61,  3.2,  4.8,  3.3,  240, 'ml',  'lacteos'),
  (null, 'Leche descremada',         '{"leche light","leche semidescremada"}',  34,  3.4,  5.0,  0.1,  240, 'ml',  'lacteos'),
  (null, 'Yogur natural',            '{"yogurt","yogur"}',                      61,  3.5,  4.7,  3.3,  150, 'g',   'lacteos'),
  (null, 'Yogur griego natural',     '{"yogurt griego","griego"}',              59,  10.2, 3.6,  0.4,  150, 'g',   'lacteos'),
  (null, 'Queso turrialba',          '{"queso fresco","queso blanco","palmito"}', 264, 17.5, 3.0, 20.0, 40, 'g',   'lacteos'),
  (null, 'Queso mozzarella',         '{"mozzarella","queso pizza"}',            300, 22.2, 2.2,  22.4, 40,  'g',   'lacteos'),
  -- Frutas
  (null, 'Banano',                   '{"banana","guineo","platano de seda"}',   89,  1.1,  22.8, 0.3,  120, 'pza', 'frutas'),
  (null, 'Manzana',                  '{"manzana roja"}',                        52,  0.3,  13.8, 0.2,  180, 'pza', 'frutas'),
  (null, 'Naranja',                  '{"naranja dulce"}',                       47,  0.9,  11.8, 0.1,  180, 'pza', 'frutas'),
  (null, 'Papaya',                   '{"lechosa","fruta bomba"}',               43,  0.5,  10.8, 0.3,  150, 'g',   'frutas'),
  (null, 'Piña',                     '{"pina","anana","ananás"}',                       50,  0.5,  13.1, 0.1,  150, 'g',   'frutas'),
  (null, 'Sandía',                   '{"sandia","patilla"}',                    30,  0.6,  7.6,  0.2,  200, 'g',   'frutas'),
  -- Verduras
  (null, 'Brócoli cocido',           '{"brocoli"}',                             35,  2.4,  7.2,  0.4,  150, 'g',   'verduras'),
  (null, 'Zanahoria',                '{"zanahoria cruda"}',                     41,  0.9,  9.6,  0.2,  80,  'g',   'verduras'),
  (null, 'Tomate',                   '{"jitomate","tomate rojo"}',              18,  0.9,  3.9,  0.2,  120, 'g',   'verduras'),
  (null, 'Lechuga',                  '{"ensalada verde"}',                      15,  1.4,  2.9,  0.2,  60,  'g',   'verduras'),
  (null, 'Chayote cocido',           '{"chayote"}',                             24,  0.6,  5.1,  0.1,  120, 'g',   'verduras'),
  (null, 'Aguacate',                 '{"aguacate","palta"}',                    160, 2.0,  8.5,  14.7, 80,  'g',   'verduras'),
  -- Bebidas
  (null, 'Agua',                     '{"agua natural"}',                        0,   0.0,  0.0,  0.0,  250, 'ml',  'bebidas'),
  (null, 'Café negro',               '{"cafe","café americano"}',               2,   0.3,  0.0,  0.0,  240, 'ml',  'bebidas'),
  (null, 'Fresco natural en agua',   '{"fresco","refresco natural","jugo"}',    45,  0.3,  11.0, 0.1,  240, 'ml',  'bebidas'),
  (null, 'Gaseosa',                  '{"soda","refresco","cola"}',              42,  0.0,  10.6, 0.0,  355, 'ml',  'bebidas'),
  -- Grasas
  (null, 'Aceite vegetal',           '{"aceite","aceite de girasol"}',          884, 0.0,  0.0,  100.0, 10, 'ml',  'grasas'),
  (null, 'Aceite de oliva',          '{"aove","oliva"}',                        884, 0.0,  0.0,  100.0, 10, 'ml',  'grasas'),
  (null, 'Almendras',                '{"almendra"}',                            579, 21.2, 21.6, 49.9, 30,  'g',   'grasas'),
  (null, 'Maní',                     '{"mani","cacahuate"}',                    567, 25.8, 16.1, 49.2, 30,  'g',   'grasas')
on conflict do nothing;
