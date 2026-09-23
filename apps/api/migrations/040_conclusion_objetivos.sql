-- migration: 040_conclusion_objetivos
--
-- Objetivos del tratamiento en la conclusion de la valoracion.
--
-- Existian ya las recomendaciones (que hacer) y los acuerdos (a que se
-- compromete el paciente), pero no el para que: la meta que persigue el
-- tratamiento. Sin eso, la consulta de seguimiento no tiene contra que
-- comparar mas alla del peso, y la nota SOAP lo redacta cada vez desde
-- cero.
--
-- Texto libre y no lista cerrada: un objetivo nutricional se escribe en
-- los terminos del paciente ("llegar a la boda de mi hija sin dolor de
-- rodillas"), y eso es justo lo que lo hace util en la siguiente visita.
--
-- Sin limite de longitud, como observaciones_clinicas y suplementos, que
-- son los otros textos largos de esta misma tabla.

alter table conclusion_valoracion add column objetivos text;
