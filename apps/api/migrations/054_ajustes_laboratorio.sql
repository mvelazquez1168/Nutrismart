-- 054 · R51: borrado de estudio en cascada y rangos para los analitos libres
--
-- Dos ajustes pequeños del módulo de laboratorio que comparten rebanada.
--
-- ## 1. El borrado del estudio tiene que arrastrar sus resultados
--
-- `lab_resultado.estudio_id` apuntaba a `lab_estudio(id)` **sin** `on delete
-- cascade` —comprobado antes de escribir esto, no supuesto—, así que un
-- `delete from lab_estudio` fallaba con una violación de clave ajena. La
-- alternativa era borrar los resultados a mano en el endpoint, dentro de una
-- transacción; se prefiere la cascada porque es la base quien garantiza que
-- no quedan resultados huérfanos, y lo garantiza también para cualquier otro
-- camino que mañana borre un estudio.
--
-- **Se borra de verdad, no se archiva.** La tabla tiene `estado` y
-- `anulado_motivo` desde la 007 para el caso clínico de «este estudio no
-- vale»; lo que R51 añade es otra cosa: deshacer una carga equivocada que no
-- debió existir. Un estudio subido al paciente que no era no se anula, se
-- quita.
--
-- ## 2. Los analitos sin catalogar también pueden traer su rango
--
-- R49 guarda los analitos libres con su nombre y su valor, y **sin rango**:
-- no hay catálogo que diga cuál es. Pero el informe sí lo trae impreso, y
-- dejarlo fuera obliga al profesional a recordar de memoria contra qué se lee
-- un valor que él mismo acaba de escribir.
--
-- Columnas aparte de `ref_minimo`/`ref_maximo` (R44) a propósito: aquéllas
-- son *la referencia que declaró el laboratorio para un analito del
-- catálogo*, y entran en el cálculo del estado y en la analítica. Éstas son
-- *lo que el profesional escribió al lado de un analito que no está en
-- ninguna lista*, y solo se enseñan en el detalle del estudio. Mezclarlas en
-- la misma columna haría que una serie histórica comparase contra un rango
-- que nadie validó.

/* ------------------------------------------------------------------ */
/* 1. Borrado en cascada                                               */
/* ------------------------------------------------------------------ */

alter table lab_resultado
  drop constraint if exists lab_resultado_estudio_id_fkey;

alter table lab_resultado
  add constraint lab_resultado_estudio_id_fkey
  foreign key (estudio_id) references lab_estudio(id) on delete cascade;

/* ------------------------------------------------------------------ */
/* 2. Rango escrito a mano para los analitos libres                    */
/* ------------------------------------------------------------------ */

alter table lab_resultado
  add column if not exists ref_min_libre numeric(10,4),
  add column if not exists ref_max_libre numeric(10,4);

-- Un rango invertido no acota nada: marcaría TODO como fuera de rango. Mismo
-- criterio que `rango_coherente` en `biomarcador_rango` (migración 007).
alter table lab_resultado drop constraint if exists lab_resultado_rango_libre_coherente;
alter table lab_resultado
  add constraint lab_resultado_rango_libre_coherente
  check (
    ref_min_libre is null
    or ref_max_libre is null
    or ref_min_libre <= ref_max_libre
  );

comment on column lab_resultado.ref_min_libre is
  'Rango minimo escrito a mano para una entrada libre (sin codigo de catalogo).';
comment on column lab_resultado.ref_max_libre is
  'Rango maximo escrito a mano para una entrada libre (sin codigo de catalogo).';
