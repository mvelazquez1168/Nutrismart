-- migration: 038_withings
--
-- RPM-02: basculas conectadas.
--
-- No crea tablas: la Rebanada 32 dejo `conexion_wearable` y
-- `wearable_oauth_estado` preparadas para mas de un proveedor. Esto solo
-- amplia las listas cerradas y anade las metricas que trae una bascula
-- de bioimpedancia.

-- ── Metricas de composicion corporal ────────────────────────────────
--
-- Se anaden cuatro y no las seis que expone la API. Fuera queda mtype 88
-- ("masa muscular sin agua"): se confunde con la masa muscular a secas,
-- ninguna pantalla podria distinguirlas al leerlas, y una cifra que no
-- se sabe interpretar es peor que no tenerla. Anadirla despues es una
-- linea.
--
-- Recordatorio de la 036: Postgres no deja USAR un valor de enum recien
-- creado en la misma transaccion. Aqui solo se declaran.
alter type tipo_metrica add value if not exists 'grasa_pct';
alter type tipo_metrica add value if not exists 'masa_grasa_kg';
alter type tipo_metrica add value if not exists 'masa_muscular_kg';
alter type tipo_metrica add value if not exists 'masa_osea_kg';

-- ── El proveedor nuevo ──────────────────────────────────────────────
alter table registro_metrica drop constraint registro_metrica_fuente_check;
alter table registro_metrica add constraint registro_metrica_fuente_check
  check (fuente in ('manual', 'fitbit', 'google_fit', 'withings'));

alter table conexion_wearable drop constraint conexion_wearable_proveedor_check;
alter table conexion_wearable add constraint conexion_wearable_proveedor_check
  check (proveedor in ('fitbit', 'google_fit', 'withings'));

alter table wearable_oauth_estado drop constraint wearable_oauth_estado_proveedor_check;
alter table wearable_oauth_estado add constraint wearable_oauth_estado_proveedor_check
  check (proveedor in ('fitbit', 'google_fit', 'withings'));

-- ── El identificador del usuario en el proveedor ────────────────────
--
-- Withings avisa por webhook usando SU identificador de usuario, no el
-- nuestro. Sin guardarlo no hay forma de saber a que paciente
-- corresponde un aviso: llegaria una notificacion de que "alguien" se
-- peso y no se sabria de quien.
--
-- Va aqui y no en una tabla aparte porque es un dato de la conexion, y
-- se borra con ella cuando el paciente desconecta.
alter table conexion_wearable
  add column usuario_externo text
    check (usuario_externo is null or char_length(usuario_externo) <= 100);

-- Por aqui entra el webhook: del identificador externo al paciente.
-- Unico por proveedor: dos conexiones no pueden apuntar al mismo usuario
-- del mismo proveedor, o un aviso seria ambiguo.
create unique index uq_conexion_usuario_externo
  on conexion_wearable (proveedor, usuario_externo)
  where usuario_externo is not null;
