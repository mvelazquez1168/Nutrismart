-- migration: 021_agenda_ampliacion
--
-- AGE-01/02. La tabla `cita` ya existe desde la Rebanada 4, con su
-- validacion de solapes y su maquina de estados. Aqui NO se recrea: se
-- amplia con lo que la epica de agenda pide y no estaba.

-- ── Estados nuevos ──────────────────────────────────────────────────
--
-- `no_asistio` no es un matiz de `cancelada`. Cancelar es un aviso: el
-- hueco se pudo reasignar. No presentarse es un hueco perdido, y una
-- clinica necesita poder contarlos por separado para decidir si
-- confirma por adelantado o cobra la reserva. Meterlos en el mismo
-- estado borra justo la diferencia que se quiere medir.
--
-- `confirmada` es el paso intermedio: el paciente dijo que viene.
alter type cita_estado add value if not exists 'confirmada' after 'programada';
alter type cita_estado add value if not exists 'no_asistio';

-- `urgencia` completa los tipos. `primera_vez` ya cubre lo que la
-- especificacion llamaba `inicial`: renombrarlo obligaria a reescribir
-- las filas existentes y el codigo de cuatro rebanadas para no ganar
-- nada.
alter type cita_tipo add value if not exists 'urgencia';

-- ── Campos nuevos ───────────────────────────────────────────────────

-- `notas` ya existe y es la nota operativa de la agenda ("viene con su
-- madre", "traer analitica"). El motivo y las notas clinicas son otra
-- cosa: el primero se escribe ANTES de la cita y el paciente puede
-- verlo; las segundas se escriben DESPUES y son del expediente.
alter table cita add column motivo text;
alter table cita add column notas_clinicas text;

-- De que consulta salio esta cita, cuando se agenda un seguimiento
-- desde la valoracion anterior.
alter table cita add column consulta_origen_id uuid references consulta(id);

-- No se añaden banderas de recordatorio enviado. Nada en esta rebanada
-- las escribiria, y una columna que nadie actualiza se convierte en un
-- dato en el que alguien acabara confiando. Cuando exista el proceso
-- que envia los recordatorios, tendra su tabla con fecha de envio.

create index idx_cita_paciente_historial
  on cita (clinica_id, paciente_id, inicio desc);
