-- migration: 028_perfil_paciente
--
-- PAC-09: el paciente pone su foto, decide como quiere que le llamen y
-- elige el fondo de su aplicacion.
--
-- Va sobre `configuracion_paciente` (Rebanada 24) y no sobre `paciente`
-- a proposito. `paciente` es el expediente: lo escribe la clinica y es
-- documentacion clinica. Esto son preferencias que escribe el paciente
-- sobre su propia aplicacion. Mezclarlas dejaria al paciente escribiendo
-- en su expediente.

alter table configuracion_paciente
  -- Solo la clave del tema. Los colores viven en el design system, con
  -- el mismo mecanismo que las paletas de marca: aqui no entra ni un
  -- valor hexadecimal.
  add column fondo text not null default 'neutro'
    check (fondo in ('neutro','verde','azul','morado','salmon','cafe','noche')),

  -- URL externa. NULL = se usan las iniciales.
  add column foto_url text
    check (foto_url is null or (foto_url like 'https://%' and char_length(foto_url) <= 500)),

  -- Como quiere que le llamen. NULL = se usa `paciente.nombre`.
  --
  -- No sustituye al nombre del expediente: si alguien se llama Maria
  -- Fernandez pero todo el mundo le dice Mari, la app puede decirle Mari
  -- y el informe clinico sigue diciendo Maria Fernandez.
  add column nombre_preferido text
    check (nombre_preferido is null
           or char_length(trim(nombre_preferido)) between 1 and 50);

comment on column configuracion_paciente.fondo is
  'Clave del tema visual; los colores estan en el design system';
comment on column configuracion_paciente.foto_url is
  'URL https de la foto; NULL = usar iniciales';
comment on column configuracion_paciente.nombre_preferido is
  'Nombre para la app; NULL = usar paciente.nombre. NO sustituye al del expediente';
