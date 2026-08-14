-- ============================================================
-- NutriSmart · Migración 014 — notificaciones y reglas (COM-02, COM-03)
--
-- Dos piezas: el buzón de avisos y las reglas que los generan solas.
--
-- Sin BEGIN/COMMIT: el runner envuelve cada migración en su transacción.
-- ============================================================

create type tipo_notificacion as enum (
  'mensaje_nuevo',
  'lab_cargado',
  'cita_proxima',
  'cita_hoy',
  'plan_actualizado',
  'paciente_nuevo',
  'cumpleanos',
  'reminder',
  'checkup',
  'fecha_importante'
);

create table notificacion (
  id         uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinica(id),

  -- Polimórfico, igual que el autor de un mensaje: profesional.id o
  -- paciente.id según destinatario_tipo.
  destinatario_id   uuid not null,
  destinatario_tipo autor_tipo not null,

  tipo      tipo_notificacion not null,
  titulo    text not null check (char_length(titulo) between 1 and 200),
  contenido text,
  -- Ruta RELATIVA dentro de la aplicación, p. ej. /pacientes/<uuid>.
  -- Nunca una URL absoluta: una notificación no debe poder sacar a
  -- nadie fuera de la plataforma.
  enlace    text check (enlace is null or enlace like '/%'),

  leida    boolean not null default false,
  leida_en timestamptz,

  /*
   * Clave de deduplicación. Es lo que impide que evaluar las reglas dos
   * veces el mismo día llene la campana de avisos repetidos.
   *
   * La compone el evaluador con lo que hace única a esa notificación,
   * p. ej. 'cumpleanos:<paciente>:2026-08-14'. Las notificaciones de
   * suceso —un mensaje nuevo— la dejan nula: cada una es un hecho
   * distinto aunque se parezcan.
   */
  clave_dedup text,

  created_at timestamptz not null default now(),

  constraint notificacion_leida_coherente check (
    (leida = false and leida_en is null) or (leida = true and leida_en is not null)
  )
);

-- El buzón se lee por destinatario y por antigüedad; el índice sigue
-- exactamente esa consulta.
create index idx_notif_dest
  on notificacion (clinica_id, destinatario_id, leida, created_at desc);

-- Parcial: solo las que declaran clave. Las de suceso no compiten.
create unique index uq_notif_dedup
  on notificacion (clinica_id, clave_dedup)
  where clave_dedup is not null;

/* ---------------------------------------------------------------- */
/* Reglas paramétricas (COM-03)                                      */
/* ---------------------------------------------------------------- */

create type tipo_regla as enum ('cumpleanos', 'reminder', 'checkup', 'fecha_importante');

create table regla_notificacion (
  id         uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinica(id),

  nombre text not null check (char_length(nombre) between 1 and 120),
  tipo   tipo_regla not null,
  activa boolean not null default true,

  -- Los parámetros dependen del tipo, así que van en JSONB y los valida
  -- la API. Una columna por parámetro daría una tabla llena de nulos
  -- que habría que migrar con cada regla nueva.
  --   cumpleanos       -> { "hora": "08:00" }
  --   reminder         -> { "diasAntes": 1, "hora": "09:00" }
  --   checkup          -> { "intervaloDias": 30 }
  --   fecha_importante -> { "fecha": "2026-12-25", "mensaje": "…" }
  parametros jsonb not null default '{}',

  created_by uuid not null references profesional(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_regla_clinica on regla_notificacion (clinica_id, activa);

create trigger regla_notificacion_set_updated_at
  before update on regla_notificacion
  for each row execute function set_updated_at();
