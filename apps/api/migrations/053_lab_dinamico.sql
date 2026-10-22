-- 053 · R49: catalogo de analitos ampliable, valores cualitativos y analitos libres
--
-- ## Que resuelve
--
-- El catalogo tenia 14 analitos globales y nada mas. Un laboratorio real
-- trae treinta lineas, varias de ellas cualitativas («No Reactiva») y
-- alguna que no esta en ninguna lista. Hasta hoy, lo que no estaba en los
-- 14 no se podia registrar: el POST rechazaba el codigo y el valor se
-- perdia.
--
-- Tres cambios de modelo:
--
--   1. `biomarcador.clinica_id` — null = global, con valor = propio de esa
--      clinica. Abre la puerta a que una clinica declare sus analitos sin
--      tocar el catalogo de las demas.
--   2. `biomarcador.es_cualitativo` — hay analitos cuyo resultado NO es un
--      numero. Un VIH «No Reactiva» guardado como 0 es una respuesta
--      clinica falsa.
--   3. `lab_resultado.valor_texto` y `nombre_libre` — para el resultado
--      cualitativo y para el analito que no esta en ningun catalogo.
--
-- ## Lo que NO se pudo hacer como pedia el requerimiento
--
-- El encargo listaba `minimo` y `maximo` junto a cada analito nuevo, como
-- si fueran columnas de `biomarcador`. **No lo son**: los rangos viven en
-- `biomarcador_rango`, por CLINICA y por SEXO, desde la migracion 007 y
-- por un motivo que sigue vigente — cada laboratorio reporta los suyos.
-- Asi que los rangos se siembran ahi, como generales (`sexo is null`), que
-- es lo que el propio encargo pedia al decir «donde el rango varia por
-- sexo se usan los valores femeninos como referencia general».
--
-- Son ORIENTATIVOS, igual que los de la 007: cada clinica los ajusta a lo
-- que reporta su laboratorio.
--
-- ## Dos analitos del encargo que NO se insertan
--
-- `FERR` (Ferritina) y `HIERRO` (Hierro serico) ya existen en el catalogo
-- con los codigos `ferritina` y `hierro_serico`. Insertarlos crearia el
-- MISMO analito dos veces con codigos distintos —el `on conflict (codigo)`
-- no los atrapa porque el codigo difiere— y el profesional veria
-- «Ferritina» repetida en el buscador, con dos series historicas que no
-- se suman. Se omiten a proposito.
--
-- ## Los grupos se normalizan a codigo
--
-- Los 14 originales usaban etiquetas legibles con acentos («Perfil
-- glucemico») y el encargo nombra los grupos en codigo («perfil_glucemico»).
-- Conviviendo, la pantalla mostraria los dos como grupos DISTINTOS y el
-- perfil lipidico saldria partido en dos pestañas. Se normalizan los 14 a
-- codigo; lo que ve el profesional lo pone la interfaz (`formatGrupo`).
-- El codigo, el nombre, la unidad y los decimales de los 14 no se tocan.

/* ------------------------------------------------------------------ */
/* 1. Catalogo: por clinica y con analitos cualitativos                */
/* ------------------------------------------------------------------ */

alter table biomarcador
  add column if not exists clinica_id uuid references clinica(id) on delete cascade,
  add column if not exists es_cualitativo boolean not null default false;

create index if not exists biomarcador_clinica_idx
  on biomarcador (clinica_id) where clinica_id is not null;

/*
 * El codigo deja de ser unico GLOBAL y pasa a serlo por clinica.
 *
 * Sigue siendo la clave primaria —no se toca, hay claves ajenas
 * apuntando— asi que en la practica dos clinicas no pueden usar el mismo
 * codigo para analitos propios distintos. Es una limitacion conocida que
 * se resolvera cuando exista la pantalla de mantenimiento del catalogo;
 * mientras tanto, lo propio de una clinica debe nombrarse con prefijo.
 */

/* ------------------------------------------------------------------ */
/* 2. Resultados: numero, texto, o analito sin catalogar               */
/* ------------------------------------------------------------------ */

alter table lab_resultado
  alter column valor drop not null,
  -- `biomarcador_codigo` tambien deja de ser obligatorio: un analito libre
  -- no tiene codigo. Sin esto, el CHECK de abajo nunca llega a evaluarse
  -- porque el insert revienta antes con un not-null de la 007.
  alter column biomarcador_codigo drop not null,
  add column if not exists valor_texto text,
  add column if not exists nombre_libre text;

-- Una fila sin valor y sin texto no dice nada: seria una linea de informe
-- que afirma que se midio algo y no dice cuanto.
alter table lab_resultado drop constraint if exists lab_resultado_valor_check;
alter table lab_resultado
  add constraint lab_resultado_valor_check
  check (valor is not null or valor_texto is not null);

-- Y una sin codigo y sin nombre libre no se puede ni nombrar.
alter table lab_resultado drop constraint if exists lab_resultado_codigo_libre_check;
alter table lab_resultado
  add constraint lab_resultado_codigo_libre_check
  check (biomarcador_codigo is not null or nombre_libre is not null);

/*
 * La clave ajena se rehace DEFERRABLE.
 *
 * `biomarcador_codigo` pasa a ser nullable —un analito libre no tiene
 * codigo— pero cuando SI viene, tiene que existir: un codigo inventado
 * dejaria un resultado que no se puede unir a su catalogo ni a su rango,
 * y saldria en la analitica sin nombre.
 */
alter table lab_resultado drop constraint if exists lab_resultado_biomarcador_codigo_fkey;
alter table lab_resultado drop constraint if exists lab_resultado_biomarcador_fk;
alter table lab_resultado
  add constraint lab_resultado_biomarcador_fk
  foreign key (biomarcador_codigo) references biomarcador(codigo)
  on update cascade deferrable initially deferred;

/*
 * El unico se vuelve PARCIAL.
 *
 * `unique (estudio_id, biomarcador_codigo)` ya no sirve: en Postgres dos
 * NULL no colisionan, asi que con el codigo nullable un estudio podria
 * recibir veinte filas libres sin que nada se queje... y a la vez el
 * indice seguiria sin impedir la misma Hemoglobina dos veces si una de
 * ellas llegara con codigo null.
 *
 * Con `where biomarcador_codigo is not null` queda exactamente lo que se
 * quiere garantizar en la base: un analito CATALOGADO no se repite dentro
 * de un estudio. Lo de los nombres libres lo valida la capa de
 * aplicacion, que es donde se puede comparar ignorando mayusculas y
 * espacios — algo que un indice no hace sin convertirlo en funcional.
 */
alter table lab_resultado
  drop constraint if exists lab_resultado_estudio_id_biomarcador_codigo_key;

create unique index if not exists lab_resultado_codigo_unico
  on lab_resultado (estudio_id, biomarcador_codigo)
  where biomarcador_codigo is not null;

/* ------------------------------------------------------------------ */
/* 3. Grupos a codigo                                                  */
/* ------------------------------------------------------------------ */

update biomarcador set grupo = case grupo
  when 'Perfil glucémico'  then 'perfil_glucemico'
  when 'Perfil lipídico'   then 'perfil_lipidico'
  when 'Hematología'       then 'hematologia'
  when 'Tiroides'          then 'tiroides'
  when 'Vitaminas'         then 'vitaminas'
  when 'Función renal'     then 'funcion_renal'
  when 'Función hepática'  then 'funcion_hepatica'
  else grupo
end
where grupo in ('Perfil glucémico','Perfil lipídico','Hematología','Tiroides',
                'Vitaminas','Función renal','Función hepática');

/* ------------------------------------------------------------------ */
/* 4. El catalogo global nuevo                                         */
/* ------------------------------------------------------------------ */
--
-- `orden` continua desde 140, que es donde lo dejo la 007, en bloques de
-- 10 por grupo para que quepan analitos intermedios sin renumerar.
--
-- Los cualitativos llevan unidad '—', `decimales = 0` y ningun rango: no
-- hay intervalo que comparar contra «No Reactiva».

insert into biomarcador (codigo, nombre, unidad, decimales, grupo, orden, es_cualitativo) values
  -- Hematologia (200+). HTO no estaba en la tabla del encargo y se añade:
  -- un hemograma sin hematocrito esta incompleto, y la comprobacion del
  -- propio encargo lo nombra al buscar «hem».
  ('HTO',       'Hematocrito',                            '%',        1, 'hematologia', 200, false),
  ('WBC',       'Leucocitos',                             'x10³/µL',  1, 'hematologia', 210, false),
  ('NEUT_PCT',  'Neutrófilos',                            '%',        1, 'hematologia', 220, false),
  ('LINF_PCT',  'Linfocitos',                             '%',        1, 'hematologia', 230, false),
  ('MONO_PCT',  'Monocitos',                              '%',        1, 'hematologia', 240, false),
  ('EOSI_PCT',  'Eosinófilos',                            '%',        1, 'hematologia', 250, false),
  ('BASO_PCT',  'Basófilos',                              '%',        1, 'hematologia', 260, false),
  ('PLT',       'Plaquetas',                              'x10³/µL',  0, 'hematologia', 270, false),
  ('VCM',       'Volumen Corpuscular Medio',              'fL',       1, 'hematologia', 280, false),
  ('HCM',       'Hemoglobina Corpuscular Media',          'pg',       1, 'hematologia', 290, false),
  ('CHCM',      'Conc. Hb Corpuscular Media',             'g/dL',     1, 'hematologia', 300, false),
  ('ADE',       'Amplitud de Distribución Eritrocitaria', '%',        1, 'hematologia', 310, false),
  ('VSG',       'Velocidad de Sedimentación',             'mm/h',     0, 'hematologia', 320, false),
  ('TIBC',      'Capacidad total de fijación de hierro',  'µg/dL',    0, 'hematologia', 330, false),
  ('SATFE',     'Saturación de transferrina',             '%',        1, 'hematologia', 340, false),
  ('B12',       'Vitamina B12',                           'pg/mL',    0, 'hematologia', 350, false),
  ('FOLATO',    'Ácido Fólico',                           'ng/mL',    1, 'hematologia', 360, false),
  ('RETIC',     'Reticulocitos',                          '%',        2, 'hematologia', 370, false),

  -- Perfil lipidico (400+)
  ('VLDL',      'VLDL',                                   'mg/dL',    0, 'perfil_lipidico', 400, false),
  ('APOA1',     'Apolipoproteína A1',                     'mg/dL',    0, 'perfil_lipidico', 410, false),
  ('APOB',      'Apolipoproteína B',                      'mg/dL',    0, 'perfil_lipidico', 420, false),
  ('LPA',       'Lipoproteína (a)',                       'mg/dL',    0, 'perfil_lipidico', 430, false),

  -- Perfil glucemico (500+)
  ('PEPTC',     'Péptido C',                              'ng/mL',    1, 'perfil_glucemico', 500, false),
  ('GLU2H',     'Glucosa 2h postprandial',                'mg/dL',    0, 'perfil_glucemico', 510, false),
  ('FRUCT',     'Fructosamina',                           'µmol/L',   0, 'perfil_glucemico', 520, false),
  ('HOMA',      'Índice HOMA-IR',                         '—',        2, 'perfil_glucemico', 530, false),

  -- Tiroides (600+)
  ('T3L',       'T3 libre',                               'pg/mL',    2, 'tiroides', 600, false),
  ('T4L',       'T4 libre',                               'ng/dL',    2, 'tiroides', 610, false),
  ('T3T',       'T3 total',                               'ng/dL',    1, 'tiroides', 620, false),
  ('T4T',       'T4 total',                               'µg/dL',    1, 'tiroides', 630, false),
  ('ANTITPO',   'Anti-TPO',                               'UI/mL',    0, 'tiroides', 640, false),
  ('ANTITIROG', 'Anti-Tiroglobulina',                     'UI/mL',    0, 'tiroides', 650, false),

  -- Funcion hepatica (700+)
  ('GGT',       'GGT (Gamma-glutamil transferasa)',       'U/L',      0, 'funcion_hepatica', 700, false),
  ('FA',        'Fosfatasa Alcalina',                     'U/L',      0, 'funcion_hepatica', 710, false),
  ('BILI_T',    'Bilirrubina Total',                      'mg/dL',    2, 'funcion_hepatica', 720, false),
  ('BILI_D',    'Bilirrubina Directa',                    'mg/dL',    2, 'funcion_hepatica', 730, false),
  ('BILI_I',    'Bilirrubina Indirecta',                  'mg/dL',    2, 'funcion_hepatica', 740, false),
  ('ALB',       'Albúmina',                               'g/dL',     1, 'funcion_hepatica', 750, false),
  ('PT',        'Proteínas Totales',                      'g/dL',     1, 'funcion_hepatica', 760, false),
  ('LDH',       'Lactato Deshidrogenasa',                 'U/L',      0, 'funcion_hepatica', 770, false),

  -- Funcion renal (800+)
  ('BUN',       'BUN / Urea',                             'mg/dL',    0, 'funcion_renal', 800, false),
  ('AURICO',    'Ácido Úrico',                            'mg/dL',    1, 'funcion_renal', 810, false),
  ('TFG',       'TFG estimada (CKD-EPI)',                 'mL/min/1.73m²', 0, 'funcion_renal', 820, false),
  ('MICROALB',  'Microalbuminuria',                       'mg/L',     1, 'funcion_renal', 830, false),
  ('CISTC',     'Cistatina C',                            'mg/L',     2, 'funcion_renal', 840, false),

  -- Electrolitos (900+)
  ('NA',        'Sodio',                                  'mEq/L',    0, 'electrolitos', 900, false),
  ('K',         'Potasio',                                'mEq/L',    1, 'electrolitos', 910, false),
  ('CL',        'Cloro',                                  'mEq/L',    0, 'electrolitos', 920, false),
  ('CA',        'Calcio Total',                           'mg/dL',    1, 'electrolitos', 930, false),
  ('CA_ION',    'Calcio Iónico',                          'mmol/L',   2, 'electrolitos', 940, false),
  ('P',         'Fósforo',                                'mg/dL',    1, 'electrolitos', 950, false),
  ('MG',        'Magnesio',                               'mg/dL',    1, 'electrolitos', 960, false),
  ('CO3',       'Bicarbonato',                            'mEq/L',    0, 'electrolitos', 970, false),

  -- Vitaminas (1000+)
  ('VITA',      'Vitamina A (Retinol)',                   'µg/dL',    0, 'vitaminas', 1000, false),
  ('VITE',      'Vitamina E (Alfa-tocoferol)',            'mg/L',     1, 'vitaminas', 1010, false),
  ('ZINC',      'Zinc',                                   'µg/dL',    0, 'vitaminas', 1020, false),
  ('SEL',       'Selenio',                                'µg/L',     0, 'vitaminas', 1030, false),
  ('CU',        'Cobre',                                  'µg/dL',    0, 'vitaminas', 1040, false),

  -- Inflamacion (1100+)
  ('PCR',       'Proteína C Reactiva',                    'mg/L',     1, 'inflamacion', 1100, false),
  ('PCRHS',     'PCR Ultrasensible',                      'mg/L',     2, 'inflamacion', 1110, false),
  ('FIBRIN',    'Fibrinógeno',                            'mg/dL',    0, 'inflamacion', 1120, false),
  ('HOMOC',     'Homocisteína',                           'µmol/L',   1, 'inflamacion', 1130, false),
  ('IL6',       'Interleucina-6',                         'pg/mL',    1, 'inflamacion', 1140, false),

  -- Hormonas (1200+)
  ('CORT',      'Cortisol',                               'µg/dL',    1, 'hormonas', 1200, false),
  ('DHEAS',     'DHEA-S',                                 'µg/dL',    0, 'hormonas', 1210, false),
  ('TEST',      'Testosterona Total',                     'ng/dL',    0, 'hormonas', 1220, false),
  ('E2',        'Estradiol',                              'pg/mL',    0, 'hormonas', 1230, false),
  ('PROG',      'Progesterona',                           'ng/mL',    2, 'hormonas', 1240, false),
  ('FSH',       'FSH',                                    'mUI/mL',   1, 'hormonas', 1250, false),
  ('LH',        'LH',                                     'mUI/mL',   1, 'hormonas', 1260, false),
  ('PRL',       'Prolactina',                             'ng/mL',    1, 'hormonas', 1270, false),
  ('IGF1',      'IGF-1 (Somatomedina C)',                 'ng/mL',    0, 'hormonas', 1280, false),

  -- Inmunologia (1300+) — todos CUALITATIVOS
  ('VIH',       'VIH 1/2',                                '—',        0, 'inmunologia', 1300, true),
  ('HBSAG',     'Hepatitis B (HBsAg)',                    '—',        0, 'inmunologia', 1310, true),
  ('ANTIHCV',   'Hepatitis C (Anti-HCV)',                 '—',        0, 'inmunologia', 1320, true),
  ('VDRL',      'VDRL / RPR (Sífilis)',                   '—',        0, 'inmunologia', 1330, true),
  ('HPYLORI',   'H. pylori IgG',                          '—',        0, 'inmunologia', 1340, true),
  ('TOXO_IGG',  'Toxoplasma IgG',                         '—',        0, 'inmunologia', 1350, true),
  ('CMV_IGG',   'CMV IgG',                                '—',        0, 'inmunologia', 1360, true)
on conflict (codigo) do nothing;

/* ------------------------------------------------------------------ */
/* 5. Rangos generales orientativos, para las clinicas existentes      */
/* ------------------------------------------------------------------ */
--
-- Mismo patron que la 007: `cross join clinica`, rango general
-- (`sexo is null`). Donde el intervalo varia por sexo se usa el
-- FEMENINO como general, tal y como pedia el encargo.
--
-- `on conflict do nothing` sobre el indice unico parcial de rangos
-- generales: correr esto dos veces no duplica nada, y una clinica que ya
-- hubiera ajustado un rango a mano conserva el suyo.
--
-- Los cualitativos no aparecen aqui: no tienen intervalo.

insert into biomarcador_rango (clinica_id, biomarcador_codigo, sexo, minimo, maximo)
select c.id, v.codigo, null::sexo_biologico, v.minimo, v.maximo
from clinica c
cross join (values
  -- Hematologia
  ('HTO',       36.0,   46.0),
  ('WBC',        4.5,   11.0),
  ('NEUT_PCT',  40.0,   75.0),
  ('LINF_PCT',  20.0,   45.0),
  ('MONO_PCT',   2.0,   10.0),
  ('EOSI_PCT',   1.0,    6.0),
  ('BASO_PCT',   0.0,    2.0),
  ('PLT',      150.0,  450.0),
  ('VCM',       80.0,  100.0),
  ('HCM',       27.0,   33.0),
  ('CHCM',      32.0,   36.0),
  ('ADE',       11.5,   14.5),
  ('VSG',        null,  20.0),
  ('TIBC',     250.0,  450.0),
  ('SATFE',     20.0,   50.0),
  ('B12',      200.0,  900.0),
  ('FOLATO',     3.0,   17.0),
  ('RETIC',      0.5,    2.5),
  -- Perfil lipidico
  ('VLDL',       null,  30.0),
  ('APOA1',    115.0,  220.0),
  ('APOB',       null, 100.0),
  ('LPA',        null,  30.0),
  -- Perfil glucemico
  ('PEPTC',      0.8,    3.9),
  ('GLU2H',      null, 140.0),
  ('FRUCT',    205.0,  285.0),
  ('HOMA',       null,   2.5),
  -- Tiroides
  ('T3L',        2.3,    4.2),
  ('T4L',        0.8,    1.8),
  ('T3T',       80.0,  200.0),
  ('T4T',        4.5,   12.0),
  ('ANTITPO',    null,  34.0),
  ('ANTITIROG',  null, 115.0),
  -- Funcion hepatica
  ('GGT',        null,  38.0),
  ('FA',        35.0,  104.0),
  ('BILI_T',     0.2,    1.2),
  ('BILI_D',     null,   0.3),
  ('BILI_I',     0.1,    0.9),
  ('ALB',        3.5,    5.2),
  ('PT',         6.4,    8.3),
  ('LDH',      135.0,  225.0),
  -- Funcion renal
  ('BUN',        7.0,   20.0),
  ('AURICO',     2.5,    6.0),
  ('TFG',       90.0,   null),
  ('MICROALB',   null,  30.0),
  ('CISTC',      0.5,    1.0),
  -- Electrolitos
  ('NA',       135.0,  145.0),
  ('K',          3.5,    5.1),
  ('CL',        98.0,  107.0),
  ('CA',         8.6,   10.2),
  ('CA_ION',     1.15,   1.35),
  ('P',          2.5,    4.5),
  ('MG',         1.7,    2.4),
  ('CO3',       22.0,   29.0),
  -- Vitaminas
  ('VITA',      30.0,   80.0),
  ('VITE',       5.5,   17.0),
  ('ZINC',      70.0,  120.0),
  ('SEL',       70.0,  150.0),
  ('CU',        70.0,  140.0),
  -- Inflamacion
  ('PCR',        null,   5.0),
  ('PCRHS',      null,   3.0),
  ('FIBRIN',   200.0,  400.0),
  ('HOMOC',      5.0,   15.0),
  ('IL6',        null,   7.0),
  -- Hormonas (valores femeninos donde difiere, como pedia el encargo)
  ('CORT',       6.0,   18.0),
  ('DHEAS',     35.0,  430.0),
  ('TEST',      15.0,   70.0),
  ('E2',        30.0,  400.0),
  ('PROG',       0.2,   25.0),
  ('FSH',        3.5,   12.5),
  ('LH',         2.4,   12.6),
  ('PRL',        4.8,   23.3),
  ('IGF1',      80.0,  280.0)
) as v(codigo, minimo, maximo)
where exists (select 1 from biomarcador b where b.codigo = v.codigo)
on conflict do nothing;

comment on column biomarcador.clinica_id is
  'null = catalogo global; con valor = analito propio de esa clinica.';
comment on column biomarcador.es_cualitativo is
  'true = el resultado es texto (No Reactiva, Positivo...), no un numero.';
comment on column lab_resultado.valor_texto is
  'Resultado cualitativo. Excluyente con valor para los analitos del catalogo.';
comment on column lab_resultado.nombre_libre is
  'Analito que no esta en ningun catalogo, escrito por el profesional.';
