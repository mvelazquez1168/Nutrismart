-- 052 · R47: las categorias de biblioteca que le interesan al paciente
--
-- ## Que resuelve
--
-- La biblioteca enseña todo lo que publica la clinica. A un paciente que
-- viene por control de diabetes le llegan igual las recetas veganas y las
-- rutinas de ejercicio, y lo suyo se diluye entre lo que no le toca. El
-- filtro por categoria ya existe en la pantalla, pero es un filtro que
-- hay que volver a poner cada vez; esto lo convierte en una preferencia
-- que se recuerda.
--
-- ## Una fila por categoria elegida, no un array
--
-- Podria ser un `text[]` en `paciente`. No lo es por dos motivos:
--
--   - La clave primaria `(paciente_id, categoria)` hace imposible
--     duplicar una categoria. Con un array, «recetas» dos veces entra sin
--     que nada se queje.
--   - Un dia habra que responder «cuantos pacientes siguen recetas», y
--     eso contra filas es un `group by` y contra un array es desenrollar
--     el array en cada consulta.
--
-- ## Sin preferencias = todo
--
-- La ausencia de filas significa «no ha elegido», y entonces ve la
-- biblioteca entera, que es lo que veia hasta hoy. **No significa «no
-- quiere nada».** Tratarlo como lista vacia dejaria a todos los pacientes
-- existentes con una biblioteca en blanco el dia del despliegue, sin que
-- ninguno hubiera tocado nada.
--
-- ## Por que no hay FK a una tabla de categorias
--
-- Porque no existe: las categorias viven como un CHECK en `recurso` y
-- como una constante en el codigo. Se repite aqui el mismo CHECK en vez
-- de inventar una tabla de catalogo que nadie mas usaria; si algun dia se
-- crea, las dos columnas apuntaran a ella.

create table if not exists paciente_preferencia_biblioteca (
  -- `clinica_id` aunque se pueda deducir del paciente: la regla del
  -- proyecto es que toda query de negocio se acote por tenant, y una
  -- columna que hay que ir a buscar a otra tabla es una que se olvida.
  clinica_id  uuid        not null references clinica(id),
  paciente_id uuid        not null references paciente(id) on delete cascade,
  categoria   text        not null
              check (categoria in ('nutricion','recetas','ejercicio','habitos','otro')),
  created_at  timestamptz not null default now(),

  primary key (paciente_id, categoria)
);

create index if not exists idx_pref_biblioteca_clinica
  on paciente_preferencia_biblioteca (clinica_id, paciente_id);
