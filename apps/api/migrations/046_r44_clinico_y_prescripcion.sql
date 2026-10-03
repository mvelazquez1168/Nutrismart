-- ============================================================
-- NutriSmart · Migración 046 — ajustes clínicos y de prescripción (R44)
--
-- Tres bloques, todos aditivos. No se elimina ninguna columna: las que
-- dejan de usarse quedan con sus datos y sin interfaz, que es la regla
-- de trazabilidad del proyecto y lo que ya se hizo en la R41 con
-- `notas_adicionales`.
--
-- Sin BEGIN/COMMIT: el runner envuelve cada migración en su transacción.
-- ============================================================

-- ------------------------------------------------------------
-- A. Relación con los alimentos: cinco preguntas nuevas.
--
-- El tamizaje pasa de cinco preguntas a siete, y solo dos de las viejas
-- sobreviven al cambio de redacción:
--
--   «Come por emociones»  → «¿Las emociones influyen en cómo y qué comes?»
--   «Culpa al comer»      → «¿Hay alimentos que generen culpa o vergüenza?»
--
-- Esas dos SIGUEN en sus columnas (`alimentacion_emocional`,
-- `culpa_al_comer`): la pregunta se reformula, lo que mide es lo mismo, y
-- mover el dato a una columna nueva lo perdería.
--
-- Las otras tres —`salteo_comidas`, `atracones`, `dietas_frecuentes`— no
-- tienen equivalente en la lista nueva. Se quedan aquí con lo que tengan
-- registrado; la pantalla ya no las pregunta pero la API las devuelve y
-- las vuelve a escribir, porque el guardado del historial reemplaza la
-- fila entera y si no viajaran de vuelta se borrarían al primer guardado.
--
-- Mismo tipo y mismo CHECK que las que ya había: la escala es la misma.
-- Nulo = no preguntado, que no es «nunca».
-- ------------------------------------------------------------
alter table historial_clinico
  add column if not exists merece_comer_tras_ejercicio smallint
    check (merece_comer_tras_ejercicio between 1 and 5),
  add column if not exists identifica_hambre_saciedad smallint
    check (identifica_hambre_saciedad between 1 and 5),
  add column if not exists valor_personal_apariencia smallint
    check (valor_personal_apariencia between 1 and 5),
  add column if not exists comida_ocupa_pensamientos smallint
    check (comida_ocupa_pensamientos between 1 and 5),
  add column if not exists clasifica_alimentos_buenos_malos smallint
    check (clasifica_alimentos_buenos_malos between 1 and 5);

-- ------------------------------------------------------------
-- B. Observaciones clínicas del historial.
--
-- Columna NUEVA y no reutilizar `notas_adicionales`: esa guarda lo que
-- se escribió en el bloque «Notas» que la R41 retiró, y repintarlo bajo
-- otro rótulo presentaría texto viejo como si fuera una observación de
-- hoy.
--
-- Ojo: no es la misma que `conclusion_valoracion.observaciones_clinicas`.
-- Esta es del historial —del PACIENTE, se actualiza consulta a consulta—
-- y aquella es el juicio de UNA consulta. Comparten rótulo en pantalla
-- porque están en carpetas distintas.
-- ------------------------------------------------------------
alter table historial_clinico
  add column if not exists observaciones_clinicas text;

-- ------------------------------------------------------------
-- C. Justificación de la prescripción.
--
-- Las razones clínicas de lo que se prescribe, separadas del diagnóstico
-- (qué tiene) y de las observaciones (qué se vio). Texto libre y sin
-- límite, como el resto de los textos largos de esta tabla.
-- ------------------------------------------------------------
alter table conclusion_valoracion
  add column if not exists justificacion text;
