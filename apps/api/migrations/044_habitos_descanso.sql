-- ============================================================
-- NutriSmart · Migración 044 — hábitos de descanso (R41, cambio 1)
--
-- El bloque «Hábitos» de Valoración → Clínico deja de preguntar nivel de
-- actividad, tabaco y alcohol: los tres ya se recogen en el mismo Clínico
-- (bloques «Actividad física» y «Sustancias»), y preguntarlos dos veces
-- produce dos respuestas que no concuerdan.
--
-- Las columnas NO se borran. Tienen datos de pacientes ya valorados, el
-- PDF del expediente los imprime, y la regla de trazabilidad clínica del
-- proyecto dice que nada se elimina físicamente. Quedan como registro
-- histórico: se leen, ya no se escriben desde Hábitos.
--
-- Lo que sí se añade es la calidad del descanso, que hasta ahora se
-- resumía en un solo número de horas. Dormir ocho horas despertándose
-- cinco veces no es dormir ocho horas.
-- ============================================================

alter table paciente_sociodemografico
  add column if not exists calificacion_descanso smallint
    check (calificacion_descanso between 1 and 10),
  add column if not exists veces_despierta_noche smallint
    check (veces_despierta_noche >= 0),
  add column if not exists notas_habitos text;

comment on column paciente_sociodemografico.calificacion_descanso is
  'Percepción del descanso, 1 (muy malo) a 10 (excelente). R41.';
comment on column paciente_sociodemografico.veces_despierta_noche is
  'Despertares nocturnos por noche. R41.';
comment on column paciente_sociodemografico.notas_habitos is
  'Texto libre del profesional sobre los hábitos del paciente. R41.';
