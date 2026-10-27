-- 064_poblar_catalogo_usda.sql
--
-- R56: los 4 608 alimentos de USDA pasan al catálogo que ya usa la
-- aplicación, y las tablas paralelas desaparecen.
--
-- La 063 creó `alimento` y `alimento_porcion`, que cubren lo mismo que
-- `alimento_catalogo` y `alimento_unidad` (026 y 056) con otros
-- nombres. Dos catálogos del mismo dominio es la clase de duplicado
-- que acaba con media aplicación leyendo de uno y media del otro: el
-- buscador del paciente, el diario y `registro_comida_item.alimento_id`
-- apuntan todos al catálogo, así que es ahí donde tienen que estar los
-- datos.
--
-- ── Lo que hubo que arreglar al trasvasar ───────────────────────────
--
-- El catálogo tiene restricciones que los datos de USDA no cumplen tal
-- cual. Se comprobó cada una contra las 4 608 filas antes de escribir
-- esto; lo que sigue es lo que de verdad falla, no una precaución
-- teórica.
--
--  1. CATEGORÍAS. `alimento_catalogo.categoria` tiene un CHECK con
--     nueve valores en minúscula desde la 026. USDA trae doce, en
--     mayúscula y con otro reparto («Res», «Aves», «Cerdo»…). Se mapean.
--
--  2. OCHO ALIMENTOS CON 902 kcal. El CHECK exige <= 900. Son todos
--     grasa pura —manteca, sebo, aceites de pescado— con 100 g de
--     grasa; 100 g de grasa son 900 kcal por definición (9 kcal/g), así
--     que el 902 es un redondeo de los factores de Atwater de USDA, no
--     un alimento más calórico. Se recortan a 900: es el valor correcto,
--     no una mutilación para que pase el CHECK.
--
--  3. CINCO PORCIONES DE MÁS DE 5 KG (hasta 5 717 g). El CHECK de
--     `alimento_unidad` corta en 5 000. Se descartan: eso no es una
--     ración, es una pieza entera.
--
--  4. 287 ETIQUETAS DE MÁS DE 60 CARACTERES. El CHECK corta ahí. Se
--     truncan en vez de descartarse: perder la porción entera por el
--     texto sería peor que una etiqueta cortada.
--
--  5. UN DUPLICADO. «Tofu, firm…» trae dos veces «0 block», y el único
--     de `alimento_unidad` no lo admite. El DISTINCT ON lo resuelve, y
--     de paso cubre los choques que pueda crear el truncado del punto 4.
--
-- Lo que NO hizo falta: no hay nombres repetidos dentro de USDA, no
-- choca ninguno con los 50 globales que ya estaban, no hay macros
-- nulos y ningún nombre pasa de 200 caracteres.
--
-- ── El enlace entre las dos tablas ──────────────────────────────────
--
-- Por `lower(nombre)`. `alimento_catalogo` no tiene dónde guardar el
-- `fdc_id`, y añadir una columna solo para esto sería dejar una
-- referencia a una tabla que este mismo fichero borra. El nombre sirve:
-- es único entre los globales por índice, y se comprobó que no hay
-- repetidos ni colisiones.

/* ------------------------------------------------------------------ */
/* 1. Los alimentos                                                    */
/* ------------------------------------------------------------------ */

with porciones_validas as (
  -- Las que caben en `alimento_unidad`. Se filtra aquí para que la
  -- porción típica del alimento salga de las mismas que luego van a
  -- existir como unidades.
  select p.alimento_id, p.etiqueta, p.gramos
    from alimento_porcion p
   where p.gramos is not null and p.gramos > 0 and p.gramos <= 5000
),
tipica as (
  -- Una por alimento: la más cercana a 100 g, que es la ración que
  -- mejor se interpreta de un vistazo y la que deja comparables las
  -- fichas entre sí. El desempate por etiqueta hace la elección
  -- estable entre ejecuciones.
  select distinct on (alimento_id)
         alimento_id, gramos
    from porciones_validas
   order by alimento_id, abs(gramos - 100), etiqueta
)
insert into alimento_catalogo (
  clinica_id, nombre, sinonimos,
  kcal_por_100g, proteina_por_100g, cho_por_100g, grasa_por_100g, fibra_por_100g,
  porcion_tipica_g, unidad_porcion, categoria, verificado
)
select
  null,
  a.nombre,
  -- El nombre en inglés como sinónimo: la búsqueda mira ahí también, y
  -- un profesional que busca «chicken breast» encuentra la pechuga.
  case
    when a.nombre_en is null or btrim(a.nombre_en) = '' then '{}'::text[]
    else array[btrim(a.nombre_en)]
  end,
  least(a.kcal, 900),
  a.proteina_g,
  a.carbs_g,
  a.grasa_g,
  a.fibra_g,
  -- Sin porciones utilizables, 100 g: es el patrón con el que vienen
  -- expresados todos los macros, así que no inventa nada.
  coalesce(t.gramos, 100),
  'g',
  case a.categoria
    when 'Res'                     then 'carnes'
    when 'Aves'                    then 'carnes'
    when 'Cerdo'                   then 'carnes'
    when 'Cordero, ternera y caza' then 'carnes'
    when 'Pescados y mariscos'     then 'carnes'
    when 'Verduras'                then 'verduras'
    when 'Frutas y jugos'          then 'frutas'
    when 'Lácteos y huevos'        then 'lacteos'
    when 'Legumbres'               then 'leguminosas'
    when 'Granos y pasta'          then 'cereales'
    when 'Grasas y aceites'        then 'grasas'
    -- Las nueces y semillas van a 'grasas', que es donde la 026 puso
    -- ya las almendras y el maní.
    when 'Nueces y semillas'       then 'grasas'
    else 'otro'
  end,
  -- Vienen de USDA FoodData Central, que es una fuente contrastada.
  true
from alimento a
left join tipica t on t.alimento_id = a.id
on conflict do nothing;

/* ------------------------------------------------------------------ */
/* 2. Las porciones                                                    */
/* ------------------------------------------------------------------ */

with porciones as (
  select distinct on (c.id, lower(left(p.etiqueta, 60)))
         c.id                      as alimento_id,
         left(btrim(p.etiqueta), 60) as nombre,
         round(p.gramos, 1)        as gramos
    from alimento_porcion p
    join alimento a           on a.id = p.alimento_id
    -- Solo si el alimento llegó al catálogo. Un INNER JOIN, no un
    -- LEFT: una unidad sin su alimento no tiene dónde colgar.
    join alimento_catalogo c  on lower(c.nombre) = lower(a.nombre)
                             and c.clinica_id is null
   where p.gramos is not null and p.gramos > 0 and p.gramos <= 5000
     and btrim(coalesce(p.etiqueta, '')) <> ''
   order by c.id, lower(left(p.etiqueta, 60)), p.gramos
)
insert into alimento_unidad (alimento_id, clinica_id, nombre, gramos_equivalentes, es_defecto)
select alimento_id, null, nombre, gramos, false
  from porciones
on conflict do nothing;

/* ------------------------------------------------------------------ */
/* 3. La unidad de 100 g y la unidad por defecto                       */
/* ------------------------------------------------------------------ */

-- Los 100 g: es lo que permite comparar dos fichas entre sí, y todos
-- los macros vienen expresados así. Mismo criterio que el seed de la
-- 056 para los 50 alimentos originales.
insert into alimento_unidad (alimento_id, clinica_id, nombre, gramos_equivalentes, es_defecto)
select c.id, null, '100 g', 100, false
  from alimento_catalogo c
 where c.clinica_id is null
on conflict do nothing;

-- Exactamente una por defecto por alimento: el único parcial
-- `uq_unidad_defecto` no admite dos, y sin ninguna la pantalla de
-- detalle no sabe cuál preseleccionar (cae a la primera de la lista,
-- que es arbitraria).
--
-- Se elige la más cercana a 100 g, el mismo criterio que la porción
-- típica de arriba, para que la ficha y la unidad digan lo mismo.
with elegida as (
  select distinct on (u.alimento_id)
         u.id
    from alimento_unidad u
    join alimento_catalogo c on c.id = u.alimento_id
   where c.clinica_id is null
     and u.activo = true
     and not exists (
       select 1 from alimento_unidad d
        where d.alimento_id = u.alimento_id and d.es_defecto = true and d.activo = true
     )
   order by u.alimento_id, abs(u.gramos_equivalentes - 100), u.nombre
)
update alimento_unidad u
   set es_defecto = true
  from elegida e
 where u.id = e.id;

/* ------------------------------------------------------------------ */
/* 4. Fuera las tablas paralelas                                       */
/* ------------------------------------------------------------------ */

-- Ya no las lee nadie: ningún endpoint ni componente las menciona —se
-- comprobó antes de escribir esto—. `alimento_porcion` primero por la
-- clave ajena.
drop table if exists alimento_porcion;
drop table if exists alimento;
