-- migration: 019_pac_invitacion
--
-- PAC-01: invitacion del paciente y vinculo con su cuenta de Keycloak.

-- La tabla paciente no tenia keycloak_user_id: hasta ahora el paciente
-- era un registro que otros consultaban, no alguien que entra.
--
-- Unico a nivel GLOBAL, no por clinica. Una cuenta de Keycloak es una
-- persona que inicia sesion, y al entrar tiene que haber un unico
-- expediente que abrir. Si la misma persona es paciente de dos clinicas,
-- son dos cuentas: la alternativa obliga a un selector de clinica al
-- entrar que esta version no tiene.
alter table paciente add column keycloak_user_id text;

create unique index uq_paciente_keycloak
  on paciente (keycloak_user_id)
  where keycloak_user_id is not null;

create type estado_invitacion as enum ('pendiente', 'aceptada', 'expirada');

create table invitacion_paciente (
  id             uuid              primary key default gen_random_uuid(),
  clinica_id     uuid              not null references clinica(id),
  paciente_id    uuid              not null references paciente(id),
  profesional_id uuid              not null references profesional(id),
  -- El token se guarda en claro. Es de un solo uso, caduca en 7 dias y
  -- se invalida al usarse; ademas viaja por correo, asi que hashearlo en
  -- la base protegeria de una fuga de base pero no de una de buzon.
  token          text              not null,
  estado         estado_invitacion not null default 'pendiente',
  email_enviado  boolean           not null default false,
  expira_en      timestamptz       not null default (now() + interval '7 days'),
  usado_en       timestamptz,
  created_at     timestamptz       not null default now(),

  constraint uq_invitacion_token unique (token),
  constraint invitacion_uso_coherente check (
    (estado = 'aceptada' and usado_en is not null)
    or (estado <> 'aceptada' and usado_en is null)
  )
);

create index idx_invitacion_paciente
  on invitacion_paciente (clinica_id, paciente_id, estado);

-- Una sola invitacion pendiente por paciente. Sin esto, dos pulsaciones
-- seguidas del boton dejan dos enlaces vivos y el paciente recibe dos
-- correos que se contradicen.
create unique index uq_invitacion_pendiente
  on invitacion_paciente (paciente_id)
  where estado = 'pendiente';
