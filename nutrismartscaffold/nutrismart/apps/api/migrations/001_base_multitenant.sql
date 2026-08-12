-- ============================================================
-- NutriSmart · Migración 001 — modelo base multi-tenant
-- Rebanada 1 (walking skeleton): clínica (tenant) → profesionales → pacientes.
-- Regla: filtra SIEMPRE por clinica_id (tenant) en cada query.
-- Sin borrado físico: las bajas son lógicas (columna 'estado').
-- ============================================================

create extension if not exists pgcrypto;

-- ---- Tipos ----
create type clinica_estado      as enum ('activa','suspendida','inactiva');
create type profesional_rol     as enum ('admin_clinica','nutricionista');
create type profesional_estado  as enum ('activo','invitacion_pendiente','inactivo');
create type paciente_estado     as enum ('activo','inactivo','baja');
create type estado_clinico      as enum ('normal','alerta','critico');
create type sexo_biologico      as enum ('masculino','femenino','intersexual');

-- ---- Tenant: clínica ----
create table clinica (
  id               uuid primary key default gen_random_uuid(),
  nombre_comercial text not null,
  nombre_fiscal    text,
  pais             text not null,
  subdominio       text unique,
  estado           clinica_estado not null default 'activa',
  created_at       timestamptz not null default now()
);

-- ---- Profesional (nutricionista / admin de clínica) ----
create table profesional (
  id               uuid primary key default gen_random_uuid(),
  clinica_id       uuid not null references clinica(id),
  keycloak_user_id text unique,
  nombre           text not null,
  correo           text not null,
  colegiatura      text,
  rol              profesional_rol not null default 'nutricionista',
  estado           profesional_estado not null default 'activo',
  created_at       timestamptz not null default now(),
  unique (clinica_id, correo)
);
create index idx_profesional_clinica on profesional(clinica_id);

-- ---- Paciente ----
create table paciente (
  id                uuid primary key default gen_random_uuid(),
  clinica_id        uuid not null references clinica(id),
  nutricionista_id  uuid references profesional(id),
  numero_expediente bigint,
  nombre            text not null,
  documento_tipo    text,
  documento_numero  text,
  fecha_nacimiento  date,
  sexo_biologico    sexo_biologico,
  telefono          text,
  correo            text,
  estado            paciente_estado not null default 'activo',
  estado_clinico    estado_clinico  not null default 'normal',
  ultima_visita     date,
  created_at        timestamptz not null default now(),
  unique (clinica_id, documento_numero)
);
create index idx_paciente_clinica       on paciente(clinica_id);
create index idx_paciente_nutricionista on paciente(nutricionista_id);

-- Refuerzo opcional a futuro: activar RLS (row-level security) por clinica_id.
-- Por ahora, el aislamiento se garantiza filtrando por clinica_id en la capa de datos.
