-- migration: 036_wearables
--
-- RPM-01: datos que llegan solos desde una pulsera o un reloj.
--
-- Es la otra mitad del seguimiento continuo. Lo que el paciente apunta a
-- mano tiene un techo —hay que acordarse— y lo que mide un dispositivo
-- no lo tiene: pasos, frecuencia cardiaca y sueno llegan todos los dias
-- sin que nadie haga nada.

-- ── Metricas nuevas ─────────────────────────────────────────────────
--
-- 'sueno_horas' sin enye, como el resto de valores del proyecto
-- ('presion_arterial', no 'presión'). Un valor de enum con acentos
-- obliga a comillas en cada consulta y se escribe mal tarde o temprano.
--
-- NOTA para quien anada mas valores aqui: Postgres no deja USAR un valor
-- de enum recien anadido dentro de la misma transaccion que lo crea. Por
-- eso esta migracion solo los declara; cualquier CHECK o insercion que
-- los mencione tiene que ir en un archivo posterior.
alter type tipo_metrica add value if not exists 'pasos';
alter type tipo_metrica add value if not exists 'frecuencia_cardiaca';
alter type tipo_metrica add value if not exists 'sueno_horas';

-- ── De donde viene cada medida ──────────────────────────────────────
--
-- Sin esto, un peso escrito a mano y otro leido de una bascula conectada
-- serian indistinguibles. Importa: la Rebanada 22 ya separo el peso de
-- casa del de consulta justamente porque mezclarlos hace ilegible una
-- grafica, y una pulsera es una tercera procedencia.
alter table registro_metrica
  add column if not exists fuente text not null default 'manual'
    check (fuente in ('manual', 'fitbit', 'google_fit'));

create index if not exists idx_registro_metrica_fuente
  on registro_metrica (paciente_id, fuente, medido_en desc);

-- ── Deduplicacion ───────────────────────────────────────────────────
--
-- Sincronizar dos veces el mismo dia no puede duplicar los pasos del
-- martes. La clave incluye `fuente` a proposito: si el paciente apunta
-- un peso a mano y ademas lo manda su bascula, son dos observaciones
-- distintas y las dos valen.
--
-- Indice unico parcial y no restriccion: las filas archivadas
-- (activo = false) quedan fuera, asi que borrar y volver a sincronizar
-- funciona.
create unique index if not exists uq_metrica_dedup
  on registro_metrica (paciente_id, tipo, medido_en, fuente)
  where activo = true;

-- ── Conexiones a proveedores ────────────────────────────────────────
create table conexion_wearable (
  id              uuid        primary key default gen_random_uuid(),

  -- clinica_id, como en todas las tablas del proyecto. Un paciente
  -- pertenece a una clinica y sus datos no salen de ahi; sin esta
  -- columna, cualquier consulta futura tendria que ir a buscarla a
  -- `paciente` y alguna se olvidaria.
  clinica_id      uuid        not null references clinica(id),
  paciente_id     uuid        not null references paciente(id),

  proveedor       text        not null check (proveedor in ('fitbit', 'google_fit')),

  -- Cifrados con AES-256-GCM en la aplicacion (ver `wearables/cifrado.ts`).
  --
  -- Un access_token de Fitbit da acceso de lectura al historial de salud
  -- completo de una persona. En claro, una copia de la base de datos —o
  -- un volcado para depurar— entrega ese acceso a quien la tenga.
  access_token    text        not null,
  refresh_token   text,
  token_expira_en timestamptz,
  scope           text,

  ultimo_sync     timestamptz,
  -- Para no reintentar en bucle una conexion que el proveedor rechaza.
  ultimo_error    text,

  activo          boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Una cuenta por proveedor y paciente.
  constraint uq_conexion_paciente_proveedor unique (paciente_id, proveedor)
);

create index idx_conexion_wearable_sync
  on conexion_wearable (activo, ultimo_sync nulls first)
  where activo = true;

-- Se reutiliza el trigger que ya existe. El encargo creaba
-- `set_actualizado_en()` con columnas `creado_en`/`actualizado_en`: dos
-- funciones que hacen lo mismo y dos convenciones de nombres en la misma
-- base de datos.
create trigger trg_conexion_wearable_updated
  before update on conexion_wearable
  for each row execute function set_updated_at();
