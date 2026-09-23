-- Datos clinicos de desarrollo para Maria Fernandez.
--
-- Ids fijos y todo con ON CONFLICT: se puede reejecutar sin duplicar.
-- Solo toca la clinica de Maria; los dos cebos "NO DEBE APARECER" de la
-- clinica 9999 se quedan como estan.
--
-- La aritmetica esta elegida para que el progreso de la R23 de 30 %:
--   80,0 kg (mayo) -> 77,6 kg (julio), meta 72,0 kg
--   recorrido -2,4 de -8,0 totales = 30 %

begin;

\set pac  '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set cli  '''11111111-1111-1111-1111-111111111111'''

-- Ana Rodriguez, la nutricionista de Maria.
select id as prof from profesional where clinica_id = :cli and nombre like 'Dra. Ana%' \gset

-- ── Consultas ───────────────────────────────────────────────────────
insert into consulta (id, clinica_id, paciente_id, profesional_id, tipo, estado,
                      numero_consulta, fecha_consulta, secciones_completas)
values
  ('c0000001-0000-4000-8000-000000000001', :cli, :pac, :'prof', 'inicial', 'finalizada',
   1, date '2026-05-13',
   '{"antrop":true,"bioquim":true,"clinico":true,"dietetico":true,"conclusion":true}'),
  ('c0000002-0000-4000-8000-000000000002', :cli, :pac, :'prof', 'seguimiento', 'finalizada',
   2, date '2026-07-14',
   '{"antrop":true,"clinico":true,"dietetico":true,"conclusion":true}')
on conflict (id) do update set estado = excluded.estado;

-- ── Antropometria ───────────────────────────────────────────────────
-- Talla constante, peso y perimetros bajando. El IMC y el ICC los
-- calcula la propia tabla (columnas generadas).
insert into medicion_antropometrica
  (id, clinica_id, paciente_id, consulta_id, profesional_id, fecha_medicion,
   peso_kg, talla_cm, cintura_cm, cadera_cm, brazo_cm, pct_grasa)
values
  ('a0000001-0000-4000-8000-000000000001', :cli, :pac,
   'c0000001-0000-4000-8000-000000000001', :'prof', date '2026-05-13',
   80.00, 162.0, 92.0, 105.0, 30.5, 38.40),
  ('a0000002-0000-4000-8000-000000000002', :cli, :pac,
   'c0000002-0000-4000-8000-000000000002', :'prof', date '2026-07-14',
   77.60, 162.0, 88.5, 103.0, 29.8, 36.10)
on conflict (id) do update set peso_kg = excluded.peso_kg;

-- ── Conclusion de la ultima consulta ────────────────────────────────
-- Es de aqui de donde sale TODO lo que el paciente ve como "mi plan":
-- las calorias, los macros, los acuerdos y la meta de peso.
--
-- Macros a 1750 kcal con 25/45/30:
--   proteina 1750*0,25/4 = 109,4 g
--   cho      1750*0,45/4 = 196,9 g
--   grasa    1750*0,30/9 =  58,3 g
insert into conclusion_valoracion
  (id, clinica_id, paciente_id, consulta_id, profesional_id,
   diagnostico_principal, diagnostico_cie10, observaciones_clinicas,
   kcal_prescritas, pct_proteina, pct_cho, pct_grasa,
   proteina_g, cho_g, grasa_g,
   restricciones, recomendaciones, acuerdos,
   peso_objetivo, fecha_objetivo_peso)
values
  ('cc000002-0000-4000-8000-000000000002', :cli, :pac,
   'c0000002-0000-4000-8000-000000000002', :'prof',
   'Sobrepeso con perímetro de cintura de riesgo', 'E66.3',
   'Buena adherencia entre la primera y la segunda consulta. Baja de 2,4 kg y el IMC pasa de 30,5 a 29,6, saliendo del rango de obesidad. La cintura (88,5 cm) y el ICC (0,859) siguen por encima del umbral de riesgo, así que se mantiene la pauta. Refiere mejor descanso y menos picoteo nocturno.',
   1750, 25, 45, 30,
   109.40, 196.90, 58.30,
   '["Sin azúcar añadido en bebidas"]',
   '["Cinco tiempos de comida, sin saltarse el desayuno","Medio plato de vegetales en almuerzo y cena","Dos litros de agua al día"]',
   '[{"texto":"Caminar 30 minutos, 5 días por semana","cumplido":true},
     {"texto":"Apuntar el desayuno todos los días","cumplido":true},
     {"texto":"Cambiar el fresco de la tarde por agua","cumplido":false}]',
   72.00, date '2026-12-15')
on conflict (id) do update set kcal_prescritas = excluded.kcal_prescritas,
                               peso_objetivo   = excluded.peso_objetivo;

-- ── Plan alimentario (la rejilla de la R9, lado profesional) ─────────
insert into plan_alimentario
  (id, clinica_id, paciente_id, profesional_id, nombre, objetivo,
   fecha_inicio, fecha_fin, estado, notas)
values
  ('b1000001-0000-4000-8000-000000000001', :cli, :pac, :'prof',
   'Plan de 1750 kcal — julio', 'Pérdida de peso sostenida, 0,5 kg por semana',
   date '2026-07-14', date '2026-10-14', 'activo',
   'Ajustado tras la segunda consulta. Merienda repartida en dos tomas.')
on conflict (id) do update set estado = excluded.estado;

-- Un dia completo (lunes) para que la rejilla tenga algo que enseñar y
-- el diario pueda comparar lo planificado con lo comido.
insert into plan_comida
  (id, clinica_id, plan_id, dia_semana, tipo_comida, descripcion,
   calorias_kcal, proteinas_g, carbohidratos_g, grasas_g)
values
  ('b2000001-0000-4000-8000-000000000001', :cli, 'b1000001-0000-4000-8000-000000000001',
   1, 'desayuno',     'Avena cocida con banano y una cucharada de maní',        380, 12.0, 58.0, 11.0),
  ('b2000002-0000-4000-8000-000000000002', :cli, 'b1000001-0000-4000-8000-000000000001',
   1, 'media_manana', 'Yogur natural con papaya',                               150,  9.0, 20.0,  3.5),
  ('b2000003-0000-4000-8000-000000000003', :cli, 'b1000001-0000-4000-8000-000000000001',
   1, 'almuerzo',     'Pechuga de pollo, arroz, frijoles y ensalada',           620, 42.0, 72.0, 15.0),
  ('b2000004-0000-4000-8000-000000000004', :cli, 'b1000001-0000-4000-8000-000000000001',
   1, 'merienda',     'Manzana y un puñado de almendras',                       200,  6.0, 22.0, 11.0),
  ('b2000005-0000-4000-8000-000000000005', :cli, 'b1000001-0000-4000-8000-000000000001',
   1, 'cena',         'Tilapia al horno con chayote y ensalada verde',          400, 40.0, 25.0, 14.0)
on conflict (id) do update set descripcion = excluded.descripcion;

-- ── Citas ───────────────────────────────────────────────────────────
-- Costa Rica es UTC-6 todo el ano (sin horario de verano), asi que las
-- 09:00 locales son las 15:00Z.
insert into cita
  (id, clinica_id, paciente_id, profesional_id, inicio, duracion_minutos, fin,
   tipo, estado, motivo, notas_clinicas, consulta_origen_id)
values
  ('d0000001-0000-4000-8000-000000000001', :cli, :pac, :'prof',
   timestamptz '2026-07-14 15:00:00+00', 45, timestamptz '2026-07-14 15:45:00+00',
   'seguimiento', 'completada', 'Control del primer trimestre',
   'Baja de 2,4 kg. Se ajusta la merienda.',
   'c0000002-0000-4000-8000-000000000002'),
  ('d0000002-0000-4000-8000-000000000002', :cli, :pac, :'prof',
   timestamptz '2026-08-21 16:00:00+00', 30, timestamptz '2026-08-21 16:30:00+00',
   'control', 'programada', 'Control mensual', null, null)
on conflict (id) do update set estado = excluded.estado;

-- ── Peso en casa ────────────────────────────────────────────────────
-- La R23 promedia esto por semana y lo dibuja en trazo fino, aparte del
-- peso de consulta. Los valores oscilan a proposito: una bascula
-- domestica a horas distintas no da una linea recta, y si la diera la
-- grafica estaria mintiendo.
insert into registro_metrica
  (id, clinica_id, paciente_id, tipo, valor, unidad, medido_en, nota)
values
  ('e0000001-0000-4000-8000-000000000001', :cli, :pac, 'peso', 78.10, 'kg', timestamptz '2026-07-16 12:30:00+00', null),
  ('e0000002-0000-4000-8000-000000000002', :cli, :pac, 'peso', 77.80, 'kg', timestamptz '2026-07-20 12:15:00+00', null),
  ('e0000003-0000-4000-8000-000000000003', :cli, :pac, 'peso', 78.00, 'kg', timestamptz '2026-07-27 12:40:00+00', 'Fin de semana fuera'),
  ('e0000004-0000-4000-8000-000000000004', :cli, :pac, 'peso', 77.50, 'kg', timestamptz '2026-08-03 12:20:00+00', null),
  ('e0000005-0000-4000-8000-000000000005', :cli, :pac, 'peso', 77.30, 'kg', timestamptz '2026-08-10 12:25:00+00', null),
  ('e0000006-0000-4000-8000-000000000006', :cli, :pac, 'peso', 77.10, 'kg', timestamptz '2026-08-13 12:10:00+00', null)
on conflict (id) do update set valor = excluded.valor;

-- ── Tarea pendiente ─────────────────────────────────────────────────
insert into tarea_paciente
  (id, clinica_id, paciente_id, profesional_id, consulta_id,
   titulo, descripcion, fecha_limite, prioridad, estado)
values
  ('f0000001-0000-4000-8000-000000000001', :cli, :pac, :'prof',
   'c0000002-0000-4000-8000-000000000002',
   'Apuntar el desayuno toda la semana',
   'Con que anotés qué comiste basta; si sabés las calorías, mejor.',
   date '2026-08-24', 'normal', 'pendiente')
on conflict (id) do update set estado = excluded.estado;

-- ── Un recurso publicado ────────────────────────────────────────────
insert into recurso
  (id, clinica_id, profesional_id, titulo, resumen, contenido, categoria,
   publicado, publicado_en)
values
  ('90000001-0000-4000-8000-000000000001', :cli, :'prof',
   'Cómo leer una etiqueta nutricional',
   'Qué mirar primero y qué puedes ignorar.',
   'Lo primero es el tamaño de la porción.

Muchos productos declaran los valores por una porción pequeña para que las cifras parezcan bajas. Si el paquete trae tres porciones y te lo comés entero, multiplicá por tres. Es el error más común y el que más cuenta.

Después mirá los azúcares añadidos, no los azúcares totales: la fruta entera trae azúcar y no es lo mismo.

Y por último la lista de ingredientes, que va ordenada de mayor a menor cantidad. Si el azúcar aparece entre los tres primeros, ya sabés de qué está hecho.',
   'nutricion', true, timestamptz '2026-08-01 15:00:00+00')
on conflict (id) do update set publicado = excluded.publicado;

commit;
