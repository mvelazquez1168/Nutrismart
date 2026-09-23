-- migration: 037_wearable_oauth_estado
--
-- El parametro `state` del intercambio OAuth.
--
-- ── Por que hace falta una tabla ────────────────────────────────────
--
-- El encargo lo resolvia asi:
--
--     const state = Buffer.from(pacienteId).toString('base64url')
--
-- Base64 no es cifrado: es una forma de escribir lo mismo. Cualquiera
-- puede leer ese valor, y —lo que importa— cualquiera puede FABRICARLO.
--
-- El `state` existe para impedir exactamente eso. La vuelta de OAuth
-- llega como una navegacion del navegador, sin cabecera Authorization:
-- lo unico que dice de quien es esa vuelta es el `state`. Si se puede
-- adivinar, alguien construye la URL de callback con el identificador de
-- otro paciente y su propio codigo de Fitbit, y deja SU cuenta de salud
-- enganchada al expediente de esa persona. El nutricionista pasaria a
-- ver los pasos y el pulso de un desconocido creyendo que son de su
-- paciente.
--
-- Aqui el `state` es aleatorio, de un solo uso y con caducidad corta. No
-- se puede adivinar y no se puede reutilizar.

create table wearable_oauth_estado (
  -- 32 bytes aleatorios en hexadecimal. Es la clave primaria: el valor
  -- ES el secreto.
  estado      text        primary key check (estado ~ '^[0-9a-f]{64}$'),

  clinica_id  uuid        not null references clinica(id),
  paciente_id uuid        not null references paciente(id),
  proveedor   text        not null check (proveedor in ('fitbit', 'google_fit')),

  -- A donde volver en la aplicacion despues de conectar.
  volver_a    text        check (volver_a is null or char_length(volver_a) <= 300),

  -- Diez minutos: lo que tarda una persona en autorizar en la web del
  -- proveedor, con margen. Mas alla, una URL de callback abandonada en
  -- el historial deja de valer.
  expira_en   timestamptz not null default now() + interval '10 minutes',
  created_at  timestamptz not null default now()
);

-- Un paciente no puede tener dos intentos vivos con el mismo proveedor:
-- si vuelve a pulsar el boton, el anterior se reemplaza.
create index idx_wearable_estado_paciente
  on wearable_oauth_estado (paciente_id, proveedor);

create index idx_wearable_estado_expira on wearable_oauth_estado (expira_en);
