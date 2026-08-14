-- migration: 020_pac_cumplimiento
--
-- PAC-04: lo que el PACIENTE reporta sobre los acuerdos de su consulta.
--
-- No se toca conclusion_valoracion.acuerdos. Ese campo es lo que se
-- PACTO en consulta y lo firma el profesional; lo que el paciente
-- cuenta desde casa es otra cosa y merece su propia fila con su fecha.
-- Mezclarlos borraria la distincion entre "acordamos esto" y "dice que
-- lo esta haciendo".

create table cumplimiento_acuerdo (
  id             uuid        primary key default gen_random_uuid(),
  clinica_id     uuid        not null references clinica(id),
  paciente_id    uuid        not null references paciente(id),
  consulta_id    uuid        not null references consulta(id),

  -- Posicion (base 0) dentro del array de acuerdos.
  acuerdo_index  int         not null check (acuerdo_index >= 0),

  -- El texto tal como estaba cuando el paciente lo marco.
  --
  -- La posicion sola no basta. Si el profesional edita la lista —borra
  -- un acuerdo, los reordena— el indice pasa a señalar OTRO acuerdo, y
  -- el "cumplido" que el paciente puso sobre "caminar 30 minutos"
  -- aparecería sobre "tomar el suplemento". Nadie se enteraria: no hay
  -- error, solo un dato clinico mal atribuido.
  --
  -- Guardando el texto se puede comprobar al leer que el acuerdo sigue
  -- siendo el mismo. Si cambio, el registro no se aplica y el acuerdo
  -- vuelve a aparecer sin marcar, que es la lectura honesta: sobre el
  -- acuerdo nuevo el paciente todavia no ha dicho nada.
  acuerdo_texto  text        not null,

  cumplido       boolean     not null default true,
  nota_paciente  text,
  registrado_en  timestamptz not null default now(),

  constraint uq_cumplimiento unique (paciente_id, consulta_id, acuerdo_index)
);

create index idx_cumplimiento_pac
  on cumplimiento_acuerdo (clinica_id, paciente_id, consulta_id);
