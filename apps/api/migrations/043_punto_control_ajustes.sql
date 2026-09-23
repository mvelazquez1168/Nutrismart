-- ============================================================
-- NutriSmart · Migración 043 — ajustes del Punto de Control (R40)
--
-- Tres cambios de esquema. La masa libre de grasa NO se toca: ya existe
-- en medicion_antropometrica (migr. 016) y la API ya la deriva del % de
-- grasa. Este archivo cubre:
--   A. Notas por tipo (Clínica / Consulta) sobre el snapshot.
--   B. Tabla dietética unificada (recordatorio 24h + consumo usual),
--      ligada a la CONSULTA (no a un «punto_control» que no existe).
-- ============================================================

-- ------------------------------------------------------------
-- A. Notas: de una nota por snapshot a DOS tipos distintos.
--
-- La nota que había es la «Nota de Consulta»; se conserva con ese tipo.
-- La «Nota Clínica» es nueva y va primero en la interfaz. El unique de
-- una nota por snapshot se sustituye por uno de (snapshot, tipo).
-- ------------------------------------------------------------
create type tipo_nota as enum ('clinica', 'consulta');

alter table clinical_note
  add column if not exists tipo tipo_nota not null default 'consulta';

-- Quitar el unique de una sola columna (snapshot_id) sea cual sea su
-- nombre autogenerado, y poner el unique compuesto.
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'clinical_note'::regclass
     and contype = 'u'
     and pg_get_constraintdef(oid) = 'UNIQUE (snapshot_id)';
  if c is not null then
    execute format('alter table clinical_note drop constraint %I', c);
  end if;
end $$;

alter table clinical_note
  add constraint clinical_note_snapshot_tipo_key unique (snapshot_id, tipo);

-- ------------------------------------------------------------
-- B. registro_dietetico: recordatorio 24h + consumo usual unificados.
--
-- Ligado a la CONSULTA: es donde vive el resto de la valoración
-- dietética. Una fila por (consulta, tipo). Los seis tiempos de comida y
-- sus totales del día viven en `filas` (jsonb) + columnas de total.
--
-- La estructura vieja de evaluacion_dietetica.recordatorio_24h no se
-- migra: su forma (alimentos con cantidad/unidad/kcal) no corresponde a
-- la nueva (texto libre + IA), y son datos de demostración. La columna
-- vieja se conserva intacta para frecuencia/macros; solo el recordatorio
-- pasa a usar esta tabla.
-- ------------------------------------------------------------
create type tipo_registro_dietetico as enum ('recordatorio_24h', 'consumo_usual');

create table registro_dietetico (
  id             uuid primary key default gen_random_uuid(),
  clinica_id     uuid not null references clinica(id),
  consulta_id    uuid not null references consulta(id) on delete cascade,
  tipo           tipo_registro_dietetico not null,

  observaciones  text,

  -- Totales del día (los suma la API a partir de los ai_* de las filas).
  total_kcal     numeric(8,2),
  total_cho_g    numeric(8,2),
  total_prot_g   numeric(8,2),
  total_grasas_g numeric(8,2),

  -- Filas de tiempos de comida. Cada elemento:
  --   { tiempo_comida, hora, alimentos_consumidos,
  --     ai_kcal, ai_cho_g, ai_prot_g, ai_grasas_g, ai_calculado_en }
  -- Los ai_* solo los escribe el endpoint de análisis IA.
  filas          jsonb not null default '[]',

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (consulta_id, tipo)
);

create index idx_registro_dietetico_consulta on registro_dietetico (consulta_id);
create index idx_registro_dietetico_clinica  on registro_dietetico (clinica_id);

create trigger registro_dietetico_set_updated_at
  before update on registro_dietetico
  for each row execute function set_updated_at();
