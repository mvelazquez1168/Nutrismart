ALTER TABLE interpretacion_ia
  DROP CONSTRAINT interpretacion_ia_estudio_id_fkey,
  ADD CONSTRAINT interpretacion_ia_estudio_id_fkey
    FOREIGN KEY (estudio_id) REFERENCES lab_estudio(id) ON DELETE CASCADE;
