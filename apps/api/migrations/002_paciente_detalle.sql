-- ============================================================
-- NutriSmart · Migración 002 — detalle del paciente (Rebanada 2)
-- Extiende el paciente para el alta/edición: motivo de consulta,
-- diagnósticos activos y alergias. Todo acotado por clinica_id (tenant).
-- ============================================================

alter table paciente add column motivo_consulta text;

-- ---- Diagnósticos activos del paciente (lista) ----
create table paciente_diagnostico (
  id          uuid primary key default gen_random_uuid(),
  clinica_id  uuid not null references clinica(id),
  paciente_id uuid not null references paciente(id),
  descripcion text not null,
  cie10       text,                         -- opcional; codificación a futuro
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index idx_diag_paciente on paciente_diagnostico(paciente_id);
create index idx_diag_clinica  on paciente_diagnostico(clinica_id);

-- ---- Alergias / intolerancias del paciente (lista) ----
create table paciente_alergia (
  id          uuid primary key default gen_random_uuid(),
  clinica_id  uuid not null references clinica(id),
  paciente_id uuid not null references paciente(id),
  descripcion text not null,               -- permitir "Ninguna"
  created_at  timestamptz not null default now()
);
create index idx_alergia_paciente on paciente_alergia(paciente_id);
create index idx_alergia_clinica  on paciente_alergia(clinica_id);
