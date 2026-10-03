-- Script de inicialización ejecutado por PostgreSQL al primer arranque.
-- Crea la base de datos de Keycloak en el mismo servidor de Postgres.
-- La base de NutriSmart la crea el propio contenedor con POSTGRES_DB.

CREATE USER keycloak WITH PASSWORD 'CAMBIAR_POR_KC_DB_PASSWORD';
CREATE DATABASE keycloak OWNER keycloak;
GRANT ALL PRIVILEGES ON DATABASE keycloak TO keycloak;
