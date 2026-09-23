# Rebanada 36 — Reorganización del expediente

Cuatro cambios de estructura en la app profesional y tres campos nuevos.
Una migración (039) para lo que hay que guardar; el resto es dónde vive
cada cosa.

---

## Lo que cambia, de un vistazo

**Pestañas de la ficha del paciente**

```
antes:  Resumen · Historial · Laboratorios · Plan · Sociodemografía · Registros · SOAP
ahora:  Resumen · Historial · Sociodemografía · Plan · Registros · SOAP
```

**Secciones de la valoración**

```
antes:  Antropometría · Bioquímica · Clínico · Dietético · Conclusiones
ahora:  Antropometría · Laboratorios · Clínico · Dietético · Conclusiones
```

**Campos**

- Sociodemografía gana **Religión**, **Nacionalidad** y **Lugar de trabajo**.
- Sociodemografía pierde **Nivel de actividad física**, **Horas de sueño**,
  **Fuma actualmente** y **Consumo de alcohol**, que pasan a Clínico.

---

## Bioquímica y Laboratorios nunca fueron dos cosas

Este es el hallazgo que hace sensato el cambio 3. La sección
«Bioquímica» **ya leía los mismos estudios**: llamaba a
`/api/pacientes/:id/labs/nutricional`, es decir, los laboratorios del
expediente filtrados a los marcadores de interés nutricional de los
últimos 90 días. Dos nombres para un dato solo consiguen que se busque
en el sitio equivocado.

Ahora la sección tiene las dos mitades juntas: arriba la lectura por
grupos de biomarcadores, abajo los estudios cargados con su descarga y
el botón para registrar uno nuevo. Antes, recibir un PDF de laboratorio
en mitad de una consulta obligaba a salir de ella para subirlo.

**La clave sigue siendo `bioquim`.** Solo cambia la etiqueta. La valida
el servidor en `routes/consultas.ts` y está escrita en las filas de
`consulta_seccion` ya guardadas: renombrarla obligaría a migrar datos
para cambiar un texto de pantalla.

### Lo que se perdió y cómo se compensa

Al quitar la pestaña de nivel superior, los laboratorios solo se
alcanzarían abriendo una consulta. Pero un laboratorio llega cuando
llega, y no siempre hay consulta abierta. Por eso el **Resumen conserva
el botón «+ Registrar laboratorio»**, junto al bloque de últimos
estudios que ya estaba ahí.

Conviene saberlo: la **lista completa** de estudios ya no se ve desde la
ficha, solo desde una valoración. Si eso estorba en el uso diario, la
vuelta atrás es una línea.

---

## Los cuatro campos que se mudan

Actividad física, sueño, tabaco y alcohol se leen en consulta, no al
rellenar la ficha social. Se mueven a Valoración → Clínico.

**Pero siguen guardándose donde siempre**, en
`paciente_sociodemografico`, por el mismo endpoint. Cambió dónde se
escriben, no dónde se almacenan: la base de datos no se tocó y el PDF,
que ya los imprimía desde ahí (`pdf/plantilla.ts`), sigue funcionando
sin cambios.

De ahí que el bloque «Hábitos» tenga **su propio botón de guardar** y no
comparta el del historial clínico: son dos destinos distintos, y un solo
botón que escribe en dos sitios falla a medias.

### La trampa que había que esquivar

El endpoint de sociodemografía **reemplaza el bloque entero**: lo que no
se envía queda nulo — es así a propósito, es como el formulario vacía
una casilla. Eso convierte una mudanza aparentemente inocente en un
borrado silencioso, por partida doble:

- Si Sociodemografía dejaba de enviar los cuatro campos, tocar
  «Ocupación» **borraría las horas de sueño del paciente**.
- Si el bloque nuevo del Clínico enviaba solo los cuatro, guardar los
  hábitos **borraría la ocupación, la escolaridad y el resto**.

Los dos formularios cargan el bloque completo y lo devuelven entero,
cambiando solo lo suyo. En `SociodemografiaBloque` los cuatro campos
siguen en el estado aunque ya no se pinten; no es código muerto.

### Duplicación que este cambio deja a la vista

Clínico **ya tenía** bloques de «Actividad física» (tipo, sesiones,
duración, FAF) y «Sustancias» (¿Fuma?, ¿Consume alcohol?), guardados en
`historial_clinico`. Con la mudanza quedan en la misma pantalla que los
que llegan de `paciente_sociodemografico`:

| Dato | En `historial_clinico` | En `paciente_sociodemografico` |
|---|---|---|
| Fuma | booleano | booleano |
| Alcohol | booleano | nunca / ocasional / frecuente |
| Actividad | tipo + sesiones + duración + FAF | sedentario / leve / moderada / intensa |

La duplicación **es anterior a esta rebanada** —está en el esquema desde
la 017— y hasta ahora quedaba disimulada porque cada mitad vivía en una
pantalla distinta. Ponerlas juntas la hace visible, que es mejor que
tenerla escondida, pero no la resuelve: dos campos «¿Fuma?» pueden
contradecirse.

Consolidarlas exige decidir cuál manda, migrar los datos y cambiar lo
que lee el PDF. Es una rebanada propia, no un efecto colateral de esta.

---

## Los tres campos nuevos

Texto libre, como la ocupación que ya estaba. Una lista cerrada de
religiones o nacionalidades obliga a elegir por el paciente: toda lista
deja fuera a alguien, y lo que queda fuera acaba en «Otro», que no
informa de nada. Para la lectura clínica —restricciones por creencia,
hábitos de la cultura de origen, comidas del trabajo— el texto del
paciente vale más que una categoría nuestra.

Van en `paciente_sociodemografico` y no en `paciente` **a propósito**:
religión y nacionalidad son categorías especialmente protegidas, y esa
tabla ya está detrás del consentimiento explícito. Ningún endpoint las
devuelve sin pasar por ahí.

Límites: 60 caracteres religión y nacionalidad, 120 lugar de trabajo
—el nombre de una empresa es más largo que un oficio—.

---

## Una contradicción del encargo

El Cambio 3 dice que Laboratorios pasa a ser subcarpeta de Valoraciones,
y la Verificación 1 lo sigue listando entre las pestañas superiores. No
pueden ser las dos.

Se resolvió a favor del Cambio 3, que es el explícito y detallado —habla
de «la pestaña de Laboratorios (nivel superior anterior)», o sea que
deja de estarlo—. La Verificación 1 parece copiada del orden que ilustra
el Cambio 2.

---

## Archivos

| Archivo | Cambio |
|---|---|
| `migrations/039_socio_identidad.sql` | **nuevo** — religion, nacionalidad, lugar_trabajo |
| `routes/sociodemografico.ts` | los tres campos en tipos, validación, SELECT e INSERT/UPDATE |
| `api/tipos.ts` | `DatosSocio` con los tres campos |
| `components/SociodemografiaBloque.tsx` | +3 campos, −4 campos (que siguen en el estado) |
| `components/eval/HabitosClinicos.tsx` | **nuevo** — los cuatro, en Clínico |
| `pages/ValoracionPaciente.tsx` | monta `HabitosClinicos`; pasa `sexoPaciente` |
| `components/eval/PanelBioquimica.tsx` | lista de estudios + alta, dentro de la sección |
| `api/valoracion.ts` | etiqueta «Bioquímica» → «Laboratorios» |
| `pages/PacienteFicha.tsx` | fuera la pestaña Laboratorios; Sociodemografía sube; alta desde Resumen |
