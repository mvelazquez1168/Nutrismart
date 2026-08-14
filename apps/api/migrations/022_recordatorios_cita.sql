-- migration: 022_recordatorios_cita
--
-- AGE-03: recordatorios automaticos de cita.
--
-- La Rebanada 20 no añadio `recordatorio_24h` / `recordatorio_1h` a la
-- tabla `cita` porque nadie los escribia todavia, y dejo dicho que
-- cuando existiera el proceso de envio tendria su tabla con fecha. Es
-- lo que se hace aqui.
--
-- Una bandera booleana responde "se envio" y nada mas. La pregunta que
-- se hace de verdad en una clinica es otra: "a este paciente que no
-- vino, ¿se le aviso?" — y para contestarla hace falta saber CUANDO se
-- intento y si salio bien. Con una bandera, un envio fallido queda
-- marcado como enviado (el propio encargo lo pedia asi, para no
-- reintentar en cada ciclo) y esa pregunta ya no tiene respuesta.

create table recordatorio_cita (
  id           uuid        primary key default gen_random_uuid(),
  clinica_id   uuid        not null references clinica(id),
  cita_id      uuid        not null references cita(id) on delete cascade,

  -- Cual de los dos avisos. Texto y no enum: si mañana se añade uno de
  -- 72 horas, un enum obliga a migrar el tipo para nada.
  antelacion   text        not null check (antelacion in ('24h', '1h')),

  -- Se escribe ANTES de llamar a Resend. La fila es la reserva del
  -- envio: quien consigue insertarla es quien manda el correo, y dos
  -- procesos que se solapen no pueden mandar el mismo aviso dos veces.
  intentado_en timestamptz not null default now(),

  -- Se rellenan DESPUES, con lo que haya pasado.
  exito        boolean     not null default false,
  destinatario text,
  error        text,

  constraint uq_recordatorio unique (cita_id, antelacion)
);

create index idx_recordatorio_clinica
  on recordatorio_cita (clinica_id, intentado_en desc);
