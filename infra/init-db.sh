#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  Script de inicialización ejecutado por PostgreSQL al PRIMER arranque.
#  Crea la base de datos de Keycloak en el mismo servidor de Postgres.
#  La base de NutriSmart la crea el propio contenedor con POSTGRES_DB.
#
#  Es un .sh y no un .sql a propósito: los scripts .sql de
#  docker-entrypoint-initdb.d NO pueden leer variables de entorno, así
#  que la contraseña de Keycloak había que escribirla a mano en el SQL.
#  Eso dejaba DOS sitios con la misma contraseña —el .sql y el .env.prod
#  que el compose pasa a Keycloak— y al rellenar solo uno, Keycloak se
#  conectaba con una contraseña y el usuario de Postgres tenía otra:
#  Keycloak no arrancaba, y con él tampoco la API ni los frontends.
#
#  OJO: esto corre UNA SOLA VEZ, cuando el volumen de datos está vacío.
#  Si la pila ya arrancó alguna vez, editar este archivo no cambia nada;
#  hay que recrear el volumen nutrismart_db_data o corregir a mano con
#  ALTER USER.
# ─────────────────────────────────────────────────────────────

set -euo pipefail

# Sin estas variables el script crearía un usuario con contraseña vacía
# y Keycloak fallaría al conectar, pero varios minutos más tarde y con
# un mensaje que no apunta aquí. Mejor abortar el arranque de la base.
: "${KC_DB_USERNAME:?falta KC_DB_USERNAME (definelo en .env.prod)}"
: "${KC_DB_PASSWORD:?falta KC_DB_PASSWORD (definelo en .env.prod)}"
: "${KC_DB_DATABASE:?falta KC_DB_DATABASE (definelo en .env.prod)}"

echo "init-db: creando usuario y base de datos de Keycloak (${KC_DB_DATABASE})"

# Los valores se pasan como VARIABLES de psql, no interpolados en el SQL.
#
# `:"nombre"` los cita como identificador y `:'nombre'` como literal de
# cadena, cada uno con sus reglas de escape. Interpolarlos con bash
# rompería con cualquier contraseña que lleve una comilla o un dólar —
# y ese es justo el aspecto de una contraseña buena.
#
# CREATE DATABASE no puede ir dentro de una transacción, así que no se
# usa --single-transaction.
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v kc_user="$KC_DB_USERNAME" \
  -v kc_pass="$KC_DB_PASSWORD" \
  -v kc_db="$KC_DB_DATABASE" <<-'EOSQL'
	CREATE USER :"kc_user" WITH PASSWORD :'kc_pass';

	-- OWNER, y no solo GRANT: desde PostgreSQL 15 el esquema `public`
	-- ya no es escribible por cualquiera. Siendo dueño de la base,
	-- Keycloak también lo es de su `public` y puede crear sus tablas.
	CREATE DATABASE :"kc_db" OWNER :"kc_user";
	GRANT ALL PRIVILEGES ON DATABASE :"kc_db" TO :"kc_user";
EOSQL

echo "init-db: listo"
