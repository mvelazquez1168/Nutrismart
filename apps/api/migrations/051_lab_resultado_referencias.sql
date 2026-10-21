-- 051 · R44: el rango de referencia que declara el informe, por resultado
--
-- ## El problema
--
-- Desde R43 el PDF del laboratorio se lee y los valores entran bien. Pero
-- el expediente seguia diciendo «Sin referencia» en TODOS los
-- biomarcadores: `biomarcador_rango` —el catalogo de rangos de la
-- clinica— esta vacio, y sin minimo ni maximo no hay con que comparar.
-- Un valor sin referencia no se puede marcar como alterado, y sin eso la
-- IA tampoco tiene que interpretar.
--
-- ## Por que en `lab_resultado` y no en el catalogo
--
-- El informe YA trae sus rangos, en su propia columna, y son los del
-- laboratorio que hizo la medicion. Esos son los que corresponden a ESE
-- resultado: cambian entre laboratorios, entre metodos y con el tiempo.
-- Guardarlos en el catalogo global los aplicaria retroactivamente a
-- estudios de otros laboratorios, que es afirmar algo que nadie dijo.
--
-- Guardados junto al resultado, cada medicion lleva el criterio con el
-- que se emitio, y queda fijo: reinterpretar un laboratorio de hace dos
-- anios con el rango de hoy es como se construye un historial que cambia
-- solo.
--
-- ## La prioridad
--
-- Al listar, lo que trae el resultado gana sobre el catalogo; el catalogo
-- sigue sirviendo para los estudios capturados a mano. El origen viaja a
-- la pantalla en `origen_rango` ('por_resultado' | 'por_sexo' | 'general'
-- | 'ninguno'), porque de donde sale un limite clinico no es un detalle
-- de implementacion: es parte del dato.
--
-- Nulos a proposito: un informe puede declarar solo un lado («< 200»,
-- «> 40»), y un cero en el lado que falta seria un limite inventado.

alter table lab_resultado
  add column if not exists ref_minimo numeric,
  add column if not exists ref_maximo numeric;

comment on column lab_resultado.ref_minimo is
  'Limite inferior declarado por el laboratorio emisor. Tiene prioridad sobre biomarcador_rango al calcular estado.';
comment on column lab_resultado.ref_maximo is
  'Limite superior declarado por el laboratorio emisor. Tiene prioridad sobre biomarcador_rango al calcular estado.';
