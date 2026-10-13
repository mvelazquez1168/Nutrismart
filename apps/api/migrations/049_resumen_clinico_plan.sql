-- 049 · El resumen clinico del plan alimentario
--
-- Cada vez que el profesional guarda el plan de una consulta, la IA
-- redacta un resumen de siete bloques y se guarda AQUI, junto al plan.
-- Despues se lee tal cual: no se vuelve a generar al visualizarlo.
--
-- ## Por que una tabla aparte y no columnas en plan_alimentario
--
-- Un plan es un patron diario que se edita; un resumen es lo que se dijo
-- en un momento, con los datos que habia en ese momento. Son dos cosas
-- con distinto ciclo de vida. Metidos en la misma fila, editar el plan
-- manana dejaria el resumen de ayer pegado a un plan que ya cambio, sin
-- modo de saberlo.
--
-- ## Por que se INSERTA y no se actualiza
--
-- El plan se puede guardar varias veces. Cada guardado genera su
-- resumen y lo inserta: el de hoy no borra el de la semana pasada. Se
-- lee el ultimo por `generado_en`, y el historial queda. Es la misma
-- regla que el resto del expediente — nada se borra — y aqui importa
-- mas: un resumen clinico sobreescrito es una version del juicio del
-- profesional que desaparece sin dejar rastro.
--
-- ## Los siete bloques son siete columnas
--
-- Y no un jsonb. Un bloque que falta tiene que verse en el esquema: si
-- el modelo no devuelve «Justificacion», la columna queda en null y la
-- pantalla lo dice. Dentro de un jsonb, una clave ausente y una clave
-- vacia se confunden, y el requerimiento pide que los siete encabezados
-- aparezcan siempre.
--
-- `distribucion_macros` es el unico bloque que el modelo NO escribe:
-- lo arma el servidor con los numeros de `conclusion_valoracion`. Ver
-- `apps/api/src/plan/resumenClinico.ts`.

create table if not exists resumen_clinico_plan (
  id              uuid primary key default gen_random_uuid(),
  clinica_id      uuid not null references clinica(id),
  plan_id         uuid not null references plan_alimentario(id),

  -- La consulta de la que salieron los datos clinicos, si se pudo
  -- determinar. Un plan no la lleva (plan_alimentario no tiene
  -- consulta_id), asi que se resuelve por la ultima conclusion de
  -- valoracion del paciente y se deja escrita aqui: el resumen SI sabe
  -- de donde leyo.
  consulta_id     uuid references consulta(id),
  profesional_id  uuid references profesional(id),

  -- ---- Los siete bloques ----
  objetivos               text,
  observaciones_clinicas  text,
  justificacion           text,
  plan_alimentario        text,
  distribucion_macros     text,
  recomendaciones         text,
  tareas                  text,

  -- Los numeros del bloque 5, aparte del texto, para que la pantalla
  -- pueda presentarlos en tabla sin volver a parsear prosa.
  macros_json     jsonb,

  -- Trazabilidad de la IA (regla de oro: la salida de IA va marcada).
  -- `origen` distingue el resumen redactado por el modelo del armado
  -- solo con los datos cuando la IA no estaba disponible.
  origen          text not null default 'ia',
  modelo          text,
  tokens_salida   integer,

  generado_en     timestamp with time zone not null default now(),

  constraint resumen_origen_valido check (origen in ('ia', 'datos'))
);

-- Se lee siempre igual: el ultimo resumen de un plan.
create index if not exists idx_resumen_plan
  on resumen_clinico_plan (plan_id, generado_en desc);

create index if not exists idx_resumen_clinica
  on resumen_clinico_plan (clinica_id, generado_en desc);
