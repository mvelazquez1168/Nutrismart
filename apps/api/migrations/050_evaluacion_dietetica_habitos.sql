-- 050 · Habitos alimentarios: el formulario de Evaluacion Dietetica
--
-- Catorce preguntas sobre como come el paciente, que hasta ahora no se
-- registraban en ningun lado. Van en `evaluacion_dietetica`, que ya es
-- UNA fila por paciente y se actualiza consulta a consulta: son habitos,
-- no mediciones, y lo que interesa es el estado actual.
--
-- ## Por que columnas y no un jsonb
--
-- `frecuencia_consumo` es jsonb porque es un mapa abierto de grupo ->
-- frecuencia, con grupos que se agregan y se quitan. Estas catorce son
-- preguntas fijas con respuestas cerradas, y dos de ellas
-- —`alimentos_no_consume` y `alimentos_preferidos`— se leen desde otra
-- pantalla (la carpeta Prescripcion).
--
-- Con columnas, cada respuesta cerrada tiene su CHECK y la base rechaza
-- un valor que la pantalla no ofrece. Dentro de un jsonb, un 'Buenoo' en
-- el apetito entraria sin que nada se queje y apareceria en el
-- expediente.
--
-- ## Las de seleccion multiple son text[]
--
-- Los tiempos de comida que realiza y los tipos de coccion admiten
-- varias respuestas. Un `text[]` con un CHECK de contencion (`<@`) deja
-- que la base valide cada elemento; un jsonb no.
--
-- ## El agua son dos campos
--
-- La pregunta del diseno es «¿Consume agua diariamente? ¿Cuanta?»: un
-- si/no y una cantidad. Se guardan por separado porque son dos datos
-- distintos — «no» con la cantidad vacia dice algo; «si» con la cantidad
-- vacia dice otra cosa (se pregunto y no se anoto), y un solo campo de
-- texto los confundiria.

alter table evaluacion_dietetica
  -- ---- Tiempos de comida ----
  add column if not exists tiempos_por_dia text,
  add column if not exists tiempos_realizados text[] not null default '{}',

  -- ---- Entorno y preparacion ----
  add column if not exists lugar_comidas text,
  add column if not exists quien_prepara text,
  add column if not exists apetito text,
  add column if not exists grasas_cocinar text,
  add column if not exists tipos_coccion text[] not null default '{}',

  -- ---- Agregados a la mesa ----
  add column if not exists agrega_sal boolean,
  add column if not exists consume_azucar boolean,
  add column if not exists usa_edulcorante boolean,

  -- ---- Antecedentes y agua ----
  add column if not exists dietas_realizadas text,
  add column if not exists consume_agua boolean,
  add column if not exists cantidad_agua text,

  -- ---- Lo que se refleja en Prescripcion ----
  add column if not exists alimentos_no_consume text,
  add column if not exists alimentos_preferidos text;

-- Las respuestas cerradas, validadas en la base.
--
-- Todas admiten null: null es «no se pregunto todavia», que es distinto
-- de cualquier respuesta y es el estado en el que nacen las filas que ya
-- existian antes de esta migracion.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dietetico_tiempos_por_dia_valido') then
    alter table evaluacion_dietetica
      add constraint dietetico_tiempos_por_dia_valido
      check (tiempos_por_dia is null or tiempos_por_dia in ('1-2', '3-5', '6+'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'dietetico_lugar_comidas_valido') then
    alter table evaluacion_dietetica
      add constraint dietetico_lugar_comidas_valido
      check (lugar_comidas is null or lugar_comidas in ('casa', 'fuera', 'otro'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'dietetico_apetito_valido') then
    alter table evaluacion_dietetica
      add constraint dietetico_apetito_valido
      check (apetito is null or apetito in ('bueno', 'regular', 'malo'));
  end if;

  -- Los tiempos que realiza son los mismos seis del plan alimentario
  -- (enum `tiempo_comida_plan`), escritos igual: si no coincidieran, el
  -- plan y la evaluacion hablarian de desayunos distintos.
  if not exists (select 1 from pg_constraint where conname = 'dietetico_tiempos_realizados_validos') then
    alter table evaluacion_dietetica
      add constraint dietetico_tiempos_realizados_validos
      check (tiempos_realizados <@ array[
        'desayuno', 'merienda_am', 'almuerzo', 'merienda_pm', 'cena', 'colacion_nocturna'
      ]::text[]);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'dietetico_tipos_coccion_validos') then
    alter table evaluacion_dietetica
      add constraint dietetico_tipos_coccion_validos
      check (tipos_coccion <@ array[
        'asado', 'fritura', 'hervido', 'plancha', 'vapor'
      ]::text[]);
  end if;
end $$;
