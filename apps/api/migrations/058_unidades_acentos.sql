-- 058_unidades_acentos.sql
--
-- «1 porcion (150 g)» -> «1 porción (150 g)».
--
-- Las etiquetas de las unidades las compone la migración 056, que se
-- escribió en ASCII puro a propósito —los dos arreglos de encoding que
-- necesitó la 055 vinieron de ahí—. El efecto secundario es que el
-- texto generado salió sin tilde, y esto no es un comentario interno:
-- es lo que el paciente lee en las chips de medida y en la caja
-- «aportará a tu dieta».
--
-- No se corrige editando la 056: ya está aplicada, y el runner guarda
-- un checksum por fichero justo para que nadie lo haga. Se corrige con
-- una migración nueva, que de paso arregla las instalaciones donde la
-- 056 ya corrió.
--
-- Este fichero sí va en UTF-8, como la 026 y la 057: lleva datos en
-- español, y los datos no se pueden escribir en ASCII sin mentir.

/* ------------------------------------------------------------------ */
/* 1. Lo ya sembrado                                                   */
/* ------------------------------------------------------------------ */

-- El único de (alimento_id, lower(nombre)) no estorba: «porcion» y
-- «porción» son cadenas distintas, así que no hay colisión.
update alimento_unidad
   set nombre = replace(nombre, 'porcion', 'porción')
 where nombre like '%porcion%';

/* ------------------------------------------------------------------ */
/* 2. Lo que se siembre mañana                                         */
/* ------------------------------------------------------------------ */

-- La 056 y la 057 llevan la misma expresión copiada para componer la
-- etiqueta, y ahí estuvo el fallo: se arregla en un sitio y sigue mal
-- en el otro. Se saca a una función para que la siguiente migración que
-- siembre alimentos la llame en vez de volver a copiarla.
--
-- IMMUTABLE porque para los mismos argumentos devuelve siempre lo
-- mismo; eso permite usarla en un índice si algún día hace falta.
create or replace function alimento_unidad_etiqueta(
  unidad_porcion text,
  porcion_tipica_g numeric
) returns text as $$
  -- 150.0 -> «150». El trim del punto no se come el cero de 100.0
  -- porque el punto corta el trim de ceros antes de llegar.
  select case unidad_porcion
           when 'pza' then '1 unidad ('  || cifra || ' g)'
           when 'ml'  then '1 porción (' || cifra || ' ml)'
           else            '1 porción (' || cifra || ' g)'
         end
    from (
      select trim(trailing '.' from trim(trailing '0' from porcion_tipica_g::text)) as cifra
    ) t
$$ language sql immutable strict parallel safe;

comment on function alimento_unidad_etiqueta(text, numeric) is
  'Compone la etiqueta de la unidad por defecto de un alimento. Usala en cualquier migracion que siembre alimentos, en vez de copiar la expresion.';

comment on column alimento_unidad.nombre is
  'Etiqueta de la medida, tal como la ve el paciente: «1 porción (150 g)», «1 taza (160 g)». Lleva la cifra dentro para no tener que abrir nada más.';
