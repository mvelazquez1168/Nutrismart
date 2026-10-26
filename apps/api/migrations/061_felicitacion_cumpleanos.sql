-- 061_felicitacion_cumpleanos.sql
--
-- R54: registro de las felicitaciones de cumpleaños enviadas.
--
-- ## Por qué hace falta una tabla para mandar un correo
--
-- Porque sin ella se manda más de uno. El encargo proponía un cron
-- diario a una hora fija; eso falla de tres maneras distintas:
--
--   1. Si la API se reinicia después de la hora del disparo —un
--      despliegue, un contenedor que se cae—, el job de ese día no
--      corre y nadie se entera.
--   2. Si corre dos veces —dos instancias de la API, o un reinicio
--      JUSTO a esa hora—, el paciente recibe dos felicitaciones.
--   3. Una hora fija en UTC no son las 8 de la mañana en todas partes,
--      y `clinica.zona_horaria` existe precisamente porque las clínicas
--      no están todas en el mismo sitio.
--
-- Con esta tabla el job puede correr cada hora sin miedo: RESERVA la
-- felicitación y solo entonces la envía. Quien consigue insertar la
-- fila es quien manda el correo —el único lo garantiza— y el resultado
-- real se anota encima.
--
-- Es el mismo patrón que `recordatorio_cita` (migración 022), y por la
-- misma razón que allí: enviar primero y marcar después deja los fallos
-- registrados como éxitos.

create table if not exists felicitacion_cumpleanos (
  id           uuid        primary key default gen_random_uuid(),
  clinica_id   uuid        not null references clinica(id),
  paciente_id  uuid        not null references paciente(id),

  -- El año, no la fecha. Un paciente nacido un 29 de febrero se
  -- felicita una vez al año aunque el día no exista; y guardando el año
  -- el único es exactamente la regla que se quiere: una por persona y
  -- por año.
  anio         integer     not null check (anio between 2020 and 2200),

  intentado_en timestamptz not null default now(),
  exito        boolean     not null default false,
  -- A dónde se mandó. Si mañana el paciente dice que no le llegó, es lo
  -- primero que hay que mirar.
  destinatario text,
  error        text,

  constraint uq_felicitacion unique (paciente_id, anio)
);

create index if not exists idx_felicitacion_clinica
  on felicitacion_cumpleanos (clinica_id, intentado_en desc);

comment on table felicitacion_cumpleanos is
  'Reserva y registro de las felicitaciones de cumpleanos (R54). El unico (paciente_id, anio) es lo que impide mandar dos.';
