# Rebanada 37 — Conclusiones: objetivos, restricciones y plan

Cinco cambios en el formulario de conclusiones de la valoración. Una
migración (040) para el campo nuevo; el resto es qué se ofrece y qué se
ve.

---

## 1 · Objetivos del tratamiento

Campo de texto libre, arriba del todo del bloque de diagnóstico, justo
**antes** de las observaciones clínicas: primero a dónde se va, después
qué se vio.

Ya existían las recomendaciones (qué hacer) y los acuerdos (a qué se
compromete el paciente), pero no el **para qué**. Sin eso, la consulta de
seguimiento no tiene contra qué comparar más allá del peso, y la nota
SOAP se redacta cada vez desde cero.

Texto libre y sin límite de longitud, como `observaciones_clinicas` y
`suplementos`, que son los otros textos largos de la misma tabla. Un
objetivo se escribe en los términos del paciente —«llegar a la boda de mi
hija sin dolor de rodillas»— y eso es justo lo que lo hace útil en la
visita siguiente.

## 2 · Restricciones

Salen «Diabética» y «Renal». Entran nueve, agrupadas por lo que
describen, porque quince fichas seguidas sin orden se leen peor que
cuatro:

| Grupo | Opciones |
|---|---|
| Densidad calórica | Hipocalórica · Normocalórica · Hipercalórica |
| Proteína | Hiperproteica · Normoproteica · Hipoproteica |
| Fibra | Alta en fibra · Fibra soluble · Fibra insoluble |
| Exclusiones (ya estaban) | Sin gluten · Sin lactosa · Bajo en sodio · Bajo en grasas · Vegetariana · Vegana |

### Lo que había que evitar: el borrado silencioso

`restricciones` es un `jsonb` sin restricción en la base; quien valida es
la API, y lo hace **descartando en silencio** lo que no reconoce.

Quitar `'renal'` de esa lista habría tenido un efecto que nadie pidió:
abrir una conclusión antigua marcada como renal, cambiar cualquier otra
cosa y guardar **borraría esa restricción sin decirlo**. Perder
información clínica por un cambio de menú va contra la trazabilidad del
proyecto.

Así que las dos siguen aceptadas por el servidor y solo desaparecen del
menú. Y como una clave sin etiqueta se pintaría cruda —«renal»—, la
pantalla las muestra con su nombre, en trazo discontinuo y con un
`title` que explica por qué siguen ahí. Se pueden quitar a mano; lo que
no pasa es que se vayan solas.

En este entorno no había ninguna fila afectada. En uno con historial, sí
las habría.

## 3 · Botón de la calculadora

Ya existía uno en la cabecera del bloque de Prescripción, que es donde
está el campo que rellena. **No se duplicó.** El botón que pedía el
encargo se puso donde de verdad hace falta: en el estado vacío del plan,
cuando todavía no hay meta calórica y la calculadora es justamente la
forma de conseguirla.

## 4 · El encabezado del plan

Meta calórica y listas de intercambio, en un bloque nuevo entre
Prescripción y Acuerdos.

El encargo decía «desde la calculadora». Se leen de la **prescripción**
—el campo de meta calórica que hay unos centímetros más arriba—, que es
donde la calculadora deja su resultado al pulsar «Usar estos valores».

La diferencia importa: así el encabezado también es correcto cuando el
profesional escribe las kilocalorías a mano sin abrir la calculadora, que
es lo que pasa en una consulta de control. Atarlo a la calculadora habría
dejado el encabezado en blanco justo en el caso más frecuente.

Los intercambios los calcula `calcularIntercambios()`, la misma función
que usa la calculadora. No se recalcula nada distinto: se mira el mismo
número desde otro sitio. Y se repite su advertencia —«reparto
orientativo»— porque sigue siendo verdad aquí.

## 5 · El plan, no el gestor de planes

El encargo pedía insertar «el componente de plan alimentario». Se
insertó un **resumen con enlace**, no el gestor completo.

`PlanAlimentarioTab` es una aplicación pequeña: lista de planes,
selección, editor por comidas, archivar, activar, versionar. Meterla
dentro de un formulario que se guarda de una vez daría dos botones de
guardar compitiendo y dos ideas distintas de «lo que hay sin guardar».

Lo que hacía falta en consulta era ver con cuántas kilocalorías se está
prescribiendo, en qué se traduce eso, y poder saltar al plan cuando toca
escribirlo. Eso es lo que hay.

---

## Sobre el orden pedido

El encargo dibujaba: Objetivos · Restricciones · Prescripción · botón ·
Plan · Acuerdos. Restricciones **no se movió**: sigue dentro del bloque
de Prescripción, donde ya estaba.

El motivo es que las opciones nuevas lo confirman. «Hipocalórica»,
«Hiperproteica» o «Alta en fibra» no son alergias ni exclusiones: son
descriptores de la prescripción, y su sitio es junto a las kilocalorías y
los macronutrientes. Sacarlas a un bloque propio las alejaría de los
números que describen, y ninguno de los cambios numerados pedía moverlas
—el 2 habla solo de las opciones—.

---

## Archivos

| Archivo | Cambio |
|---|---|
| `migrations/040_conclusion_objetivos.sql` | **nuevo** — columna `objetivos` |
| `routes/conclusion.ts` | `objetivos` en CAMPOS, upsert y respuesta; lista de restricciones ampliada conservando las retiradas |
| `api/valoracion.ts` | `RESTRICCIONES` reordenadas, `RESTRICCIONES_RETIRADAS`, `objetivos` en el tipo |
| `components/eval/FormConclusion.tsx` | campo Objetivos, fichas retiradas, plan entre Prescripción y Acuerdos |
| `components/eval/PlanAlimentarioResumen.tsx` | **nuevo** — meta, intercambios y acceso al plan |
