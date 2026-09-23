-- migration: 034_profesional_equipo
--
-- GAM-02: lo que le faltaba a `profesional` para poder gestionar el
-- equipo desde la aplicacion.
--
-- ── Lo que este archivo NO hace, y por que ──────────────────────────
--
-- El encargo creaba el enum `profesional_rol` con valores ('admin',
-- 'nutricionista') y anadia las columnas `rol`, `email` y `activo`.
--
-- Las tres ya existen, con otros nombres y otros valores:
--
--   profesional_rol    = admin_clinica, nutricionista   (no 'admin')
--   profesional.correo                                  (no 'email')
--   profesional.estado = activo, invitacion_pendiente, inactivo
--
-- El `DO … EXCEPTION WHEN duplicate_object THEN NULL` del encargo habria
-- pasado de largo en silencio, dejando el enum con sus valores reales, y
-- despues todo el codigo que compara `rol = 'admin'` no habria coincidido
-- NUNCA. Un fallo silencioso: ningun error, ningun administrador.
--
-- Y `estado` no es un booleano por una razon: 'invitacion_pendiente' es
-- un tercer estado real —dado de alta en la clinica, sin cuenta todavia—
-- que un `activo boolean` no puede representar.

alter table profesional
  add column if not exists foto_url   text
    check (foto_url is null or (foto_url like 'https://%' and char_length(foto_url) <= 500)),
  add column if not exists updated_at timestamptz not null default now();

create trigger trg_profesional_updated
  before update on profesional
  for each row execute function set_updated_at();

-- Un correo por clinica: dos profesionales con el mismo correo en la
-- misma clinica hacen imposible saber a quien se invito.
create unique index if not exists uq_profesional_correo
  on profesional (clinica_id, lower(correo))
  where correo is not null and estado <> 'inactivo';

-- Bootstrap del administrador.
--
-- El encargo lo hacia con `where activo = true`, columna que no existe.
-- Aqui se usa `estado`, y solo actua si la clinica no tiene ya ningun
-- admin_clinica — en este proyecto ya lo tienen, asi que no toca nada.
update profesional p
   set rol = 'admin_clinica'
 where p.id in (
         select distinct on (clinica_id) id
           from profesional
          where estado = 'activo'
          order by clinica_id, created_at asc, id asc
       )
   and not exists (
         select 1 from profesional p2
          where p2.clinica_id = p.clinica_id
            and p2.rol = 'admin_clinica'
            and p2.estado <> 'inactivo'
       );
