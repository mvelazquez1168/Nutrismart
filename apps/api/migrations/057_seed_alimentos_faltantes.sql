-- 057_seed_alimentos_faltantes.sql
--
-- R52 pedía sembrar 32 alimentos de consumo corriente en Costa Rica.
-- Contrastada la lista contra `alimento_catalogo`, 28 ya estaban desde
-- la migración 026 — unos con el mismo nombre y otros con uno distinto
-- que los sinónimos ya resuelven:
--
--   «Pan de molde blanco»     -> «Pan blanco», sinónimo "pan de molde"
--   «Carne molida res 90%»    -> «Carne molida de res»
--   «Tilapia al vapor»        -> «Tilapia»
--   «Huevo entero cocido»     -> «Huevo entero»
--   «Atún en agua (enlatado)» -> «Atún en agua»
--
-- Volver a insertarlos habría dado dos fichas del mismo alimento y dos
-- series de calorías que no se suman. Entran solo los cuatro que
-- faltaban.
--
-- Las categorías del encargo (Tubérculos, Panadería, Platos CR,
-- Pescados, Huevos) no existen: `alimento_catalogo.categoria` tiene un
-- CHECK con nueve valores fijos desde la 026. La yuca y el plátano
-- verde van a 'cereales', que es donde la 026 puso ya la papa y el
-- plátano maduro — por función en el plato, no por botánica.
--
-- Valores por 100 g / 100 ml derivados de USDA FoodData Central para el
-- alimento COCIDO. Son los cuatro primeros del catálogo con fibra: la
-- columna es nueva (056) y los 46 anteriores la tienen en NULL, a la
-- espera de una pasada de curación que no es de esta rebanada.

insert into alimento_catalogo
  (clinica_id, nombre, sinonimos, kcal_por_100g, proteina_por_100g, cho_por_100g,
   grasa_por_100g, fibra_por_100g, porcion_tipica_g, unidad_porcion, categoria, verificado)
values
  (null, 'Arroz integral cocido',  '{"arroz integral","arroz moreno"}',
   123, 2.7, 25.6, 1.0, 1.6, 150, 'g',  'cereales', true),

  (null, 'Yuca cocida',            '{"yuca","mandioca","casava"}',
   140, 1.2, 33.5, 0.3, 1.6, 150, 'g',  'cereales', true),

  -- El verde y el maduro tienen calorías y carbohidratos muy parecidos;
  -- lo que cambia es el reparto entre almidón y azúcar, que esta tabla
  -- no desglosa. Se siembran por separado porque el paciente los
  -- distingue y los busca por su nombre.
  (null, 'Plátano verde cocido',   '{"platano verde","plátano verde","verde cocido"}',
   122, 1.3, 31.9, 0.4, 2.3, 120, 'g',  'cereales', true),

  (null, 'Agua de pipa',           '{"agua de coco","pipa","coco"}',
   19,  0.7, 3.7,  0.2, 1.1, 330, 'ml', 'bebidas',  true)
on conflict do nothing;

/* ------------------------------------------------------------------ */
/* Unidades de los alimentos nuevos                                    */
/* ------------------------------------------------------------------ */

-- El mismo seed de la 056, repetido tal cual. Es idempotente por el
-- único (alimento_id, lower(nombre)), así que pasa por encima de los 46
-- que ya tienen unidad y solo crea las de estos cuatro. Repetirlo en
-- cada migración que siembre alimentos es más barato que acordarse.
with etiqueta as (
  select id,
         clinica_id,
         unidad_porcion,
         porcion_tipica_g,
         trim(trailing '.' from trim(trailing '0' from porcion_tipica_g::text)) as cifra
    from alimento_catalogo
)
insert into alimento_unidad (alimento_id, clinica_id, nombre, gramos_equivalentes, es_defecto)
select id,
       clinica_id,
       case unidad_porcion
         when 'pza' then '1 unidad (' || cifra || ' g)'
         when 'ml'  then '1 porcion (' || cifra || ' ml)'
         else            '1 porcion (' || cifra || ' g)'
       end,
       porcion_tipica_g,
       true
  from etiqueta
on conflict do nothing;

insert into alimento_unidad (alimento_id, clinica_id, nombre, gramos_equivalentes, es_defecto)
select id,
       clinica_id,
       case when unidad_porcion = 'ml' then '100 ml' else '100 g' end,
       100,
       false
  from alimento_catalogo
on conflict do nothing;

/* ------------------------------------------------------------------ */
/* Unidades caseras donde cambian la forma de apuntar                  */
/* ------------------------------------------------------------------ */

-- La porción típica y los 100 g sirven para todo, pero hay alimentos
-- que nadie mide así. Una tortilla se cuenta en tortillas y el arroz en
-- tazas; sin estas unidades el paciente tiene que traducir a gramos de
-- cabeza, que es justo lo que R52 viene a quitar.
--
-- Solo para los alimentos globales: las fichas que cargue una clínica
-- son suyas y no se les inventan unidades.
insert into alimento_unidad (alimento_id, clinica_id, nombre, gramos_equivalentes, es_defecto)
select a.id, a.clinica_id, u.nombre, u.gramos, false
  from alimento_catalogo a
  join (values
    ('Arroz blanco cocido',     '1 taza (160 g)',     160),
    ('Arroz integral cocido',   '1 taza (160 g)',     160),
    ('Gallo pinto',             '1 taza (180 g)',     180),
    ('Frijoles negros cocidos', '1 taza (170 g)',     170),
    ('Frijoles rojos cocidos',  '1 taza (170 g)',     170),
    ('Pasta cocida',            '1 taza (140 g)',     140),
    ('Avena cocida',            '1 taza (235 g)',     235),
    ('Tortilla de maíz',        '2 tortillas (60 g)',  60),
    ('Pan blanco',              '2 rebanadas (60 g)',  60),
    ('Pan integral',            '2 rebanadas (60 g)',  60),
    ('Huevo entero',            '2 unidades (110 g)', 110),
    ('Leche entera',            '1 vaso (240 ml)',    240),
    ('Leche descremada',        '1 vaso (240 ml)',    240),
    ('Aguacate',                '1/2 unidad (100 g)', 100),
    ('Aceite vegetal',          '1 cucharada (14 g)',  14),
    ('Aceite de oliva',         '1 cucharada (14 g)',  14),
    ('Maní',                    '1 puñado (28 g)',     28),
    ('Almendras',               '1 puñado (28 g)',     28)
  ) as u(alimento, nombre, gramos) on u.alimento = a.nombre
 where a.clinica_id is null
on conflict do nothing;
