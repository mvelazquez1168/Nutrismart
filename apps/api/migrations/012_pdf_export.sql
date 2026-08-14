-- ============================================================
-- NutriSmart · Migración 012 — historial de exportaciones (CLI-05)
--
-- Registra QUÉ se exportó, CUÁNDO y QUIÉN lo hizo. No guarda el
-- documento: el PDF se regenera a partir del expediente, y conservar
-- cada copia multiplicaría el almacén sin añadir nada que no esté ya
-- en la base.
--
-- Lo que sí queda es la traza. Un expediente que salió de la clínica
-- —camino de un paciente, de otro profesional o de una aseguradora—
-- tiene que poder reconstruirse: qué secciones llevaba, con qué
-- recomendaciones y bajo la firma de quién.
--
-- Sin BEGIN/COMMIT: el runner envuelve cada migración en su propia
-- transacción.
-- ============================================================

create table pdf_export (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references clinica(id),
  paciente_id    uuid not null references paciente(id),
  -- Quién firma el documento. No se borra con el profesional: es la
  -- autoría de algo que ya salió.
  profesional_id uuid not null references profesional(id),

  -- Secciones incluidas, p. ej. ["perfil","plan"]. JSONB y no un array
  -- de texto porque el juego de secciones va a crecer y una lista
  -- ordenada es lo que hay que reproducir tal cual.
  secciones      jsonb not null default '[]',

  archivo_nombre text,
  archivo_tamano integer check (archivo_tamano >= 0),
  -- Ruta en el almacén SI algún día se decide conservar el binario.
  -- Hoy va nula: el documento se regenera.
  archivo_ruta   text,

  -- El envío al paciente llega con la épica COM. Las columnas existen
  -- para que ese día no haya que migrar la tabla del historial.
  enviado_paciente  boolean not null default false,
  enviado_en        timestamptz,

  -- El texto libre que el profesional incluyó en ESE documento. Se
  -- guarda con la exportación, no en el expediente: es lo que se dijo
  -- en ese momento, y editarlo después falsearía lo que se entregó.
  notas_profesional text,

  created_at timestamptz not null default now(),

  constraint pdf_export_envio_coherente check (
    (enviado_paciente = false and enviado_en is null) or
    (enviado_paciente = true  and enviado_en is not null)
  )
);

-- El historial se lee siempre por paciente y de lo más reciente hacia
-- atrás; el índice sigue exactamente esa consulta.
create index idx_pdf_export_paciente
  on pdf_export (clinica_id, paciente_id, created_at desc);
