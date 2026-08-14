-- ============================================================
-- NutriSmart · Migración 013 — mensajería (COM-01)
--
-- Un hilo por par paciente–profesional dentro de la clínica. No hay
-- grupos ni mensajes sueltos: la conversación clínica es siempre entre
-- quien consulta y quien responde, y poder atribuir cada frase a una de
-- las dos partes es lo que la hace utilizable como registro.
--
-- Sin BEGIN/COMMIT: el runner envuelve cada migración en su transacción.
-- ============================================================

-- Sirve para el autor de un mensaje y para el destinatario de una
-- notificación: en ambos casos la pregunta es la misma, de qué lado
-- está la persona.
create type autor_tipo as enum ('profesional', 'paciente');

create table conversacion (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references clinica(id),
  paciente_id    uuid not null references paciente(id),
  profesional_id uuid not null references profesional(id),

  -- Se mantiene al insertar cada mensaje. Es duplicación deliberada: la
  -- bandeja ordena por esto y calcularlo con un max() por hilo en cada
  -- carga escala mal justo cuando la clínica crece.
  ultimo_mensaje_at timestamptz,

  -- Contadores desnormalizados por el mismo motivo. Se actualizan en la
  -- misma transacción que el mensaje, nunca por separado.
  mensajes_no_leidos_prof int not null default 0 check (mensajes_no_leidos_prof >= 0),
  mensajes_no_leidos_pac  int not null default 0 check (mensajes_no_leidos_pac  >= 0),

  activa     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Un solo hilo por par. Sin esto, dos peticiones simultáneas de "abrir
-- conversación" crearían dos, y los mensajes se repartirían entre ambas.
create unique index uq_conversacion
  on conversacion (clinica_id, paciente_id, profesional_id);

create index idx_conv_profesional
  on conversacion (clinica_id, profesional_id, ultimo_mensaje_at desc nulls last);

create table mensaje (
  id uuid primary key default gen_random_uuid(),

  -- clinica_id aunque se deduzca de la conversación: es la regla del
  -- proyecto —tenant en toda tabla— y lo que ya hacen lab_resultado,
  -- snapshot_metrica y plan_comida.
  clinica_id      uuid not null references clinica(id),
  conversacion_id uuid not null references conversacion(id) on delete cascade,

  -- Polimórfico a propósito: apunta a profesional.id o a paciente.id
  -- según autor_tipo, así que no puede llevar clave foránea. La
  -- alternativa —dos columnas anulables con un check— hace más ruido
  -- del que evita.
  autor_tipo autor_tipo not null,
  autor_id   uuid not null,

  contenido text not null check (char_length(contenido) between 1 and 4000),

  leido    boolean not null default false,
  leido_en timestamptz,

  created_at timestamptz not null default now(),

  -- Marcar leído sin sello de tiempo deja el dato a medias.
  constraint mensaje_leido_coherente check (
    (leido = false and leido_en is null) or (leido = true and leido_en is not null)
  )
);

create index idx_mensaje_conv on mensaje (conversacion_id, created_at asc);

-- El sondeo del hilo pregunta "mensajes de esta conversación posteriores
-- a X"; sin este índice, cada sondeo recorre el hilo entero.
create index idx_mensaje_conv_reciente on mensaje (conversacion_id, created_at desc);
