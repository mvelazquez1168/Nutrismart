-- migration: 039_socio_identidad
--
-- Tres datos mas en la ficha sociodemografica: religion, nacionalidad y
-- lugar de trabajo.
--
-- ── Por que texto libre y no listas cerradas ────────────────────────
--
-- La ocupacion, que ya estaba, tambien es texto libre, y por el mismo
-- motivo. Una lista cerrada de religiones o de nacionalidades obliga a
-- elegir por el paciente: toda lista deja fuera a alguien, y lo que
-- queda fuera acaba en "Otro", que no informa de nada. Para la lectura
-- clinica -restricciones alimentarias por creencia, habitos de la
-- cultura de origen, comidas del trabajo- el texto del paciente vale
-- mas que una categoria nuestra.
--
-- ── Por que son sensibles ───────────────────────────────────────────
--
-- La religion y la nacionalidad son categorias especialmente protegidas
-- en cualquier regimen de proteccion de datos. Viven en esta tabla y no
-- en `paciente` a proposito: `paciente_sociodemografico` ya esta detras
-- del consentimiento explicito (`consentimiento_otorgado`), que es
-- justo donde tienen que estar. Ningun endpoint las devuelve sin pasar
-- por ahi.

alter table paciente_sociodemografico
  -- 60 caracteres: caben "Testigo de Jehova" y "cristiana evangelica"
  -- de sobra, y corta el texto libre que en realidad seria una nota.
  add column religion text check (char_length(religion) <= 60),
  -- Mismo limite que ocupacion. Admite gentilicios compuestos
  -- ("costarricense-nicaraguense") sin invitar a escribir un parrafo.
  add column nacionalidad text check (char_length(nacionalidad) <= 60),
  -- Mas largo: aqui va el nombre de una empresa o institucion, que
  -- suele ser mas extenso que un oficio.
  add column lugar_trabajo text check (char_length(lugar_trabajo) <= 120);
