-- migration: 029_bienestar
--
-- RPM-01: el parte diario del paciente. Como se encuentra hoy, y que le
-- pasa.
--
-- Es la mitad barata del seguimiento continuo y la que mas dice. El peso
-- se mueve despacio y hace falta una bascula; "hoy me duele la cabeza y
-- dormi mal" se contesta en tres segundos y explica por que la semana
-- que viene el peso no baja.

create table registro_bienestar (
  id          uuid        primary key default gen_random_uuid(),
  clinica_id  uuid        not null references clinica(id),
  paciente_id uuid        not null references paciente(id),

  fecha       date        not null default current_date,

  -- 1 muy mal · 2 mal · 3 regular · 4 bien · 5 excelente
  --
  -- Cinco escalones y no diez: pedirle a alguien que distinga su animo
  -- entre un 6 y un 7 produce un numero inventado. Cinco se contestan
  -- sin pensar, que es la unica forma de que se conteste todos los dias.
  estado      smallint    not null check (estado between 1 and 5),

  -- Lista CERRADA. Si fuese texto libre, cada paciente escribiria
  -- "dolor de cabeza", "jaqueca", "me duele la cabeza" y el profesional
  -- no podria contar nada. El catalogo va aqui y no en el codigo para
  -- que la base rechace lo que no reconoce.
  sintomas    text[]      not null default '{}'
    check (sintomas <@ array[
      'dolor_cabeza','fatiga','insomnio','ansiedad','estres',
      'hinchazon','estrenimiento','diarrea','acidez','nauseas',
      'antojos','mareo','dolor_muscular'
    ]::text[]),

  nota        text        check (nota is null or char_length(nota) <= 500),

  activo      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Un parte por dia. Si el paciente lo rellena por la manana y por la
  -- tarde cambia de idea, se corrige el del dia; no se acumulan dos
  -- versiones de como estuvo el martes.
  constraint uq_bienestar_dia unique (paciente_id, fecha)
);

create index idx_bienestar_paciente
  on registro_bienestar (clinica_id, paciente_id, fecha desc)
  where activo = true;

create trigger trg_bienestar_updated
  before update on registro_bienestar
  for each row execute function set_updated_at();
