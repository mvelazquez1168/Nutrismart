-- migration: 033_clinica_config
--
-- GAM-01: los datos de la clinica que hoy no estan en ningun sitio —
-- direccion, telefono, sitio web y zona horaria.
--
-- ── Lo que este archivo NO hace, y por que ──────────────────────────
--
-- El encargo anadia tambien `logo_url`, `color_primario` y
-- `color_secundario` a esta tabla. Eso ya existe desde la Rebanada 6, en
-- `brand_config`: nombre de la aplicacion, logo (subido como archivo, no
-- como URL), color primario y color de acento, con su pantalla en
-- /ajustes/marca y su comprobacion de contraste WCAG.
--
-- Anadirlo aqui dejaria DOS sitios donde vive el color de una clinica,
-- con nombres distintos para lo mismo (`color_secundario` vs
-- `color_acento`) y dos mecanismos de logo incompatibles. Ninguna
-- pantalla sabria cual creer — el mismo error que la Rebanada 24 evito
-- con los totales del diario y la 26 con las medidas corporales.
--
-- La pantalla de configuracion de la clinica enlaza a la de marca en vez
-- de duplicarla.

alter table clinica
  add column if not exists direccion    text
    check (direccion is null or char_length(direccion) <= 300),
  add column if not exists telefono     text
    check (telefono is null or char_length(telefono) <= 40),
  add column if not exists sitio_web    text
    check (sitio_web is null or (sitio_web like 'https://%' and char_length(sitio_web) <= 200)),

  -- Zona horaria IANA. Por defecto Costa Rica, que es donde esta la
  -- clinica piloto y lo que ya asumen las consultas del proyecto —no
  -- America/Mexico_City, como decia el encargo—.
  --
  -- La columna existe para el dia en que haya clinicas en otro huso: hoy
  -- las consultas escriben 'America/Costa_Rica' a mano, y cambiarlas
  -- todas es una rebanada en si misma. Se guarda ya para no tener que
  -- pedirsela a nadie despues.
  add column if not exists zona_horaria text not null default 'America/Costa_Rica',

  add column if not exists updated_at   timestamptz not null default now();

-- La zona horaria tiene que ser una de verdad: un valor inventado haria
-- reventar cualquier `at time zone` que la use.
--
-- La comprobacion NO puede ir en un CHECK —Postgres no admite
-- subconsultas ahi— asi que la hace la API contra `pg_timezone_names`,
-- que es la lista real del servidor y no una copia que se quede vieja.

create trigger trg_clinica_updated
  before update on clinica
  for each row execute function set_updated_at();
