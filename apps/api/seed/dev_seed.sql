-- ============================================================
-- NutriSmart · Seed de DESARROLLO (no producción)
-- Asume base fresca + migraciones 001 y 002 aplicadas.
-- Una clínica, un profesional y tres pacientes (con motivo, diagnósticos
-- y alergias) que coinciden con los mockups de diseño.
-- ============================================================

insert into clinica (id, nombre_comercial, nombre_fiscal, pais, subdominio)
values ('11111111-1111-1111-1111-111111111111','Clínica Nutrición Vida','Nutrición Vida S.A.','CR','vida')
on conflict do nothing;

-- keycloak_user_id debe coincidir con el 'sub' del usuario del realm "nutrismart".
insert into profesional (id, clinica_id, keycloak_user_id, nombre, correo, colegiatura, rol)
values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','KC_DEV_USER','Dra. Ana Rodríguez','ana@vida.cr','CR-12345','admin_clinica')
on conflict do nothing;

-- Pacientes (ids fijos para poder enlazar diagnósticos y alergias)
insert into paciente (id, clinica_id, nutricionista_id, numero_expediente, nombre, documento_numero, fecha_nacimiento, sexo_biologico, estado_clinico, ultima_visita, motivo_consulta)
values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',1,'María Fernández','1-1111-1111','1984-03-10','femenino','normal',  now() - interval '3 days','Bajar de peso'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',2,'Juan Ramírez',  '2-2222-2222','1968-06-02','masculino','alerta',  now() - interval '20 days','Control de diabetes'),
 ('cccccccc-cccc-cccc-cccc-cccccccccccc','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',3,'Ana Castro',    '3-3333-3333','1991-11-20','femenino','critico', now() - interval '1 day','Control glucémico')
on conflict do nothing;

-- Diagnósticos activos
insert into paciente_diagnostico (clinica_id, paciente_id, descripcion) values
 ('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Sobrepeso'),
 ('11111111-1111-1111-1111-111111111111','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Diabetes tipo 2'),
 ('11111111-1111-1111-1111-111111111111','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Hipertensión'),
 ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','Diabetes tipo 2')
on conflict do nothing;

-- Alergias / intolerancias (permitir "Ninguna")
insert into paciente_alergia (clinica_id, paciente_id, descripcion) values
 ('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Ninguna'),
 ('11111111-1111-1111-1111-111111111111','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Penicilina'),
 ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','Lactosa')
on conflict do nothing;
