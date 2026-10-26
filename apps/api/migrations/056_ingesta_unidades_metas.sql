-- 056_ingesta_unidades_metas.sql
--
-- R52: la pantalla de ingesta diaria mide en PORCIONES ("1 taza",
-- "1 tortilla", "1 vaso"), no en gramos. Nadie pesa el arroz antes de
-- apuntarlo, y pedir gramos es la razon por la que la gente deja de
-- llevar el diario.
--
-- ## Por que no hay tablas nuevas de alimento ni de ingesta
--
-- El encargo de R52 proponia `alimento`, `alimento_unidad`,
-- `ingesta_diaria` y `plan_nutricional`. Tres de las cuatro ya existen
-- con otro nombre y se quedan donde estan:
--
--   * El catalogo es `alimento_catalogo` (migracion 026), con 46
--     alimentos, sinonimos regionales y busqueda sin acentos. Es
--     multi-tenant: clinica_id NULL = global.
--   * La ingesta son `registro_comida` + `registro_comida_item` (023 y
--     026). La 026 ya explica por que no se crea una tabla paralela de
--     comidas: seria la misma comida contada dos veces. Y hay un
--     trigger que deriva los totales de la fila padre, de la que leen
--     la ficha del profesional y la media de calorias del progreso.
--     Escribir la ingesta en otra tabla la haria invisible para el
--     nutricionista.
--   * Las metas de macros son la prescripcion dietetica de
--     `conclusion_valoracion` (018): kcal_prescritas, pct_proteina,
--     pct_cho, pct_grasa y los gramos derivados. El endpoint
--     GET /api/paciente/diario ya las devuelve como `objetivo`.
--
-- Lo que falta de verdad es la unidad de medida, que es esta migracion.

/* ------------------------------------------------------------------ */
/* 1. Lo que al catalogo le faltaba                                    */
/* ------------------------------------------------------------------ */

-- La fibra no estaba. Se anade como el resto de macros y sin NOT NULL:
-- de los 46 alimentos sembrados no se conoce, y poner 0 seria afirmar
-- que el frijol no tiene fibra.
alter table alimento_catalogo
  add column if not exists fibra_por_100g numeric(5,1)
    check (fibra_por_100g is null or fibra_por_100g >= 0);

-- Para el lector de codigo de barras. No funcional todavia; la columna
-- entra ahora para no volver a migrar cuando lo sea.
alter table alimento_catalogo
  add column if not exists codigo_barras text
    check (codigo_barras is null or char_length(trim(codigo_barras)) between 6 and 20);

-- Distingue una ficha contrastada contra una fuente (USDA, INCAP) de
-- una que cargo una clinica a ojo. La UI lo ensena; el calculo no lo
-- mira.
alter table alimento_catalogo
  add column if not exists verificado boolean not null default false;

-- Un codigo de barras identifica un producto: no puede haber dos
-- alimentos globales con el mismo. Parcial porque la inmensa mayoria
-- de las fichas no lo tienen.
create unique index if not exists uq_alimento_barras_global
  on alimento_catalogo (codigo_barras)
  where codigo_barras is not null and clinica_id is null;

create index if not exists idx_alimento_barras_clinica
  on alimento_catalogo (clinica_id, codigo_barras)
  where codigo_barras is not null and clinica_id is not null;

/* ------------------------------------------------------------------ */
/* 2. Unidades de medida por alimento                                  */
/* ------------------------------------------------------------------ */

-- `alimento_catalogo.porcion_tipica_g` daba UNA porcion por alimento.
-- Sirve para ofrecer un valor por defecto, no para que el paciente
-- elija: "media taza" o "dos tortillas" no se pueden expresar.
--
-- `clinica_id` se copia del alimento padre en vez de deducirse por
-- join. Es el mismo criterio que `registro_comida_item`, que tambien
-- lo lleva aunque su padre lo tenga: cada query que filtre por tenant
-- puede hacerlo sin un join mas.
create table if not exists alimento_unidad (
  id                  uuid         primary key default gen_random_uuid(),
  alimento_id         uuid         not null references alimento_catalogo(id) on delete cascade,
  clinica_id          uuid         references clinica(id),

  nombre              text         not null
                        check (char_length(trim(nombre)) between 1 and 60),
  -- Para los alimentos en 'ml' esto son mililitros. El catalogo ya
  -- mezcla las dos cosas en `porcion_tipica_g` (240 para un vaso de
  -- leche) y separarlas aqui obligaria a convertir en cada calculo
  -- contra `cantidad_g`, que es g o ml segun el alimento. A 1 g/ml el
  -- error es nulo en todo lo que bebe una persona.
  gramos_equivalentes numeric(7,1) not null
                        check (gramos_equivalentes > 0 and gramos_equivalentes <= 5000),
  -- La que se ofrece al abrir el detalle del alimento.
  es_defecto          boolean      not null default false,

  activo              boolean      not null default true,
  created_at          timestamptz  not null default now()
);

-- El seed tiene que poder reejecutarse. Sobre lower(nombre) porque
-- "1 Taza" y "1 taza" son la misma unidad escrita de dos formas.
create unique index if not exists uq_unidad_alimento_nombre
  on alimento_unidad (alimento_id, lower(nombre));

-- Dos unidades por defecto para el mismo alimento dejarian a la
-- pantalla eligiendo arbitrariamente cual preseleccionar.
create unique index if not exists uq_unidad_defecto
  on alimento_unidad (alimento_id)
  where es_defecto = true and activo = true;

create index if not exists idx_unidad_alimento
  on alimento_unidad (alimento_id)
  where activo = true;

/* ------------------------------------------------------------------ */
/* 3. Seed: la porcion tipica de cada alimento pasa a ser su unidad    */
/* ------------------------------------------------------------------ */

-- Dos unidades por alimento: la porcion tipica (por defecto) y la de
-- 100 g/ml, que es la que permite comparar fichas.
--
-- El nombre se compone con la cifra dentro -- "1 porcion (150 g)" --
-- porque el paciente necesita saber cuanto es una porcion sin tener
-- que abrir nada mas.
with etiqueta as (
  select id,
         clinica_id,
         unidad_porcion,
         porcion_tipica_g,
         -- 150.0 -> "150". El trim del punto no se come el cero de
         -- 100.0 porque el punto corta el trim de ceros antes.
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
/* 4. El item del diario recuerda en que unidad se apunto              */
/* ------------------------------------------------------------------ */

-- `cantidad_g` sigue siendo la verdad del calculo: las cifras se
-- congelan al apuntar y de ahi salen las kcal. Esto es para poder
-- volver a ensenar "1.5 tazas" en vez de "255 g" cuando el paciente
-- abre lo que escribio ayer.
--
-- `on delete set null`: si una clinica retira una unidad de su
-- catalogo, el item conserva sus gramos y sus kcal. Pierde la etiqueta,
-- no el dato clinico.
alter table registro_comida_item
  add column if not exists unidad_id uuid references alimento_unidad(id) on delete set null;

alter table registro_comida_item
  add column if not exists cantidad numeric(6,2)
    check (cantidad is null or (cantidad > 0 and cantidad <= 100));

comment on column registro_comida_item.cantidad is
  'Numero de unidades apuntadas (1.5 = una taza y media). NULL en las filas anteriores a R52, que se apuntaron en gramos.';
comment on column registro_comida_item.unidad_id is
  'Unidad elegida al apuntar. NULL si se apunto en gramos o si la unidad se retiro del catalogo.';
