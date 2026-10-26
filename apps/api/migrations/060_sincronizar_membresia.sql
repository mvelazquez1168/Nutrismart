-- 060_sincronizar_membresia.sql
--
-- R53: mantener `clinica_profesional` al día mientras siga existiendo
-- `profesional.clinica_id`.
--
-- ## Por qué un trigger y no tres INSERT más
--
-- Desde la 059, `resolverAlcance()` decide si un profesional pertenece
-- a la clínica del token mirando `clinica_profesional`. Un profesional
-- dado de alta sin su fila en esa tabla NO PUEDE ENTRAR: la API le
-- responde 403 y el mensaje habla de permisos, no de una fila que
-- falta.
--
-- Hay tres sitios que insertan en `profesional` —dos en `equipo.ts`
-- (alta directa e invitación) y uno en `superadmin.ts`— y nada impide
-- que mañana haya un cuarto. Añadir el INSERT en cada uno deja el
-- sistema a un despiste de que alguien no pueda iniciar sesión, y el
-- síntoma no se parece a la causa.
--
-- Con el trigger, la pertenencia se deriva del alta, que es lo que de
-- verdad ocurre: dar de alta a un profesional EN una clínica ES hacerlo
-- miembro de ella.
--
-- ## Qué NO hace
--
-- No borra membresías. Si un profesional se añade a una segunda clínica
-- —que es el objetivo de R53—, esa fila vive solo en
-- `clinica_profesional` y el trigger no la toca: solo escribe la que
-- corresponde a `profesional.clinica_id`.
--
-- Cuando toda la API lea de la tabla de unión, se cae el trigger y
-- detrás la columna.

create or replace function sincronizar_clinica_profesional() returns trigger as $$
begin
  insert into clinica_profesional (clinica_id, profesional_id, rol, activo)
  values (new.clinica_id, new.id, new.rol, new.estado <> 'inactivo')
  on conflict (clinica_id, profesional_id) do update
     set rol    = excluded.rol,
         activo = excluded.activo;
  return null;
end;
$$ language plpgsql;

-- `update of` acota el disparo a las tres columnas que importan: sin
-- eso, cada cambio de nombre o de teléfono reescribiría la membresía
-- para dejarla igual.
drop trigger if exists trg_profesional_membresia on profesional;
create trigger trg_profesional_membresia
  after insert or update of clinica_id, rol, estado on profesional
  for each row execute function sincronizar_clinica_profesional();

comment on function sincronizar_clinica_profesional() is
  'Deriva la fila de clinica_profesional desde profesional.clinica_id mientras la columna legada siga existiendo (R53).';
