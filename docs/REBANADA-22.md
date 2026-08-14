# NutriSmart · Rebanada 22 — Diario de comidas y medidas en casa

**Objetivo:** que el paciente pueda apuntar qué come y qué se mide, y que su nutricionista lo vea.

**Migraciones 023 y 024.** El encargo pedía 022 y 023, pero la 022 la ocupó la tabla de recordatorios en la Rebanada 21.

---

## Decisiones tomadas

### 1. El diario usa las franjas del plan, no unas nuevas

El encargo creaba un enum `tipo_comida` con `desayuno, colacion_matutina, almuerzo, colacion_vespertina, cena, otro`.

**Ese enum ya existe desde la Rebanada 9**, con las franjas del plan alimentario: `desayuno, media_manana, almuerzo, merienda, cena, extra`. `CREATE TYPE` sobre un tipo existente falla, así que la migración no habría llegado a aplicarse.

Pero el problema de fondo no es ese. Con dos vocabularios distintos se pierde **lo único que hace útil este diario**: poder poner al lado lo que el profesional planificó para el almuerzo y lo que el paciente comió en el almuerzo. Si el plan habla de «media mañana» y el diario de «colación matutina», esa comparación no se puede hacer ni a mano.

### 2. El peso de casa no se mezcla con el de la consulta

`registro_metrica` es una tabla aparte de `medicion_antropometrica`. No son el mismo dato: la báscula de la clínica está calibrada y se usa siempre a la misma hora y en las mismas condiciones; la de casa, no.

Mezclarlos en una sola serie convierte la línea de peso en ruido, y nadie podría decir si una bajada es progreso o es que ese día se pesó vestido. Se guardan juntos, se muestran juntos y **se cuentan aparte** — y las dos pantallas lo dicen, para que ni el paciente ni el profesional crean que se contradicen.

### 3. Un total al que le faltan comidas se declara incompleto

El paciente escribe «arroz con pollo y ensalada», no calcula macros. Las calorías son opcionales, así que el total del día casi siempre estará incompleto.

Sumar solo lo que tiene número y presentarlo como «has comido 620 kcal» es engañoso: parece que ha comido de menos. La respuesta incluye `sinEstimar` y la pantalla lo dice — «3 comidas sin calorías apuntadas: no cuentan en el total».

### 4. La serie semanal incluye los días vacíos

Con `generate_series`, los días sin registros salen a cero en vez de faltar. Una gráfica a la que le faltan los días vacíos dibuja una línea continua sobre los huecos y da a entender que el paciente registró todos los días.

### 5. La unidad la pone el servidor

Para peso, presión y glucosa la unidad no se acepta del cliente. Un peso en libras guardado como «kg» no se detecta después, y la serie queda contaminada sin que nadie pueda saber qué fila está mal.

### 6. Una presión invertida se rechaza

`80/120` casi siempre significa que se escribieron al revés. Guardarlo estropea la serie, así que se rechaza con un mensaje que dice exactamente eso. También hay un `CHECK` en la base.

### 7. Una medida del futuro no es una medida

`chk_no_futuro` impide guardar una lectura con fecha posterior a ahora (con una hora de margen por husos). Sin eso, un dedo torpe en el selector de fecha deja un punto que domina toda la gráfica. El error de Postgres se traduce a un mensaje legible.

### 8. El profesional puede verlo

El encargo lo pedía y conviene subrayar por qué: sin la pestaña **«Sus registros»** en la ficha, el diario es un cuaderno que nadie lee. El paciente apunta lo que come **para que su nutricionista lo mire**; si no hay forma de mirarlo, no hay motivo para apuntarlo.

### 9. Cinco pestañas, no seis

El diario y las medidas van en **una sola pantalla con dos pestañas internas**, no en dos entradas de la barra inferior. Son la misma acción —«apuntar lo mío»— y separarlas habría dejado seis pestañas en un móvil. Cinco es el máximo razonable; con etiquetas cortas (Inicio · Plan · Apuntar · Citas · Mensajes) caben en 390 px.

---

## El fallo que volvió a aparecer

La primera prueba del diario devolvió **almuerzo antes que desayuno**.

Es exactamente el fallo de la Rebanada 9: `select tipo_comida::text as tipo_comida … order by tipo_comida` resuelve el `ORDER BY` contra el **alias de salida**, que es texto, y ordena alfabéticamente. El enum está declarado en el orden del día, pero el cast lo tapa.

Se arregla aliando la tabla y ordenando por `rc.tipo_comida`. Lo llamativo es que el comentario que escribí en esa misma consulta decía cómo evitarlo, y aun así cayó: no basta con saberlo, hay que mirar la salida.

---

## Otros ajustes contra el código real

| Asumido | Real |
|---|---|
| Migraciones 022 y 023 | **023 y 024** — la 022 la ocupó la R21 |
| `apps/api/src/db/migrations/` | `apps/api/migrations/`, con runner |
| `conclusion_valoracion.plan_nutricional` | No existe; el objetivo sale de `kcal_prescritas` y los gramos por macro |
| `paciente.nombre_completo` | `nombre` |
| `fastify.authenticate` · `request.user.sub` | `requireAuthPaciente` · `request.authPac.sub` |
| Esquemas JSON de Fastify | Validación en el handler, como el resto del proyecto |
| La barra tiene 3 pestañas | Tenía 4 desde la R20; ahora 5 |
| `carbohidratos_g` / `grasas_g` | `cho_g` / `grasa_g`, como en el resto del esquema |

---

## Contrato de API

| Método | Ruta |
|---|---|
| `GET` | `/api/paciente/diario?fecha=` — registros del día, totales y objetivo |
| `POST` | `/api/paciente/diario` — UPSERT de una franja |
| `DELETE` | `/api/paciente/diario/:id` — baja lógica |
| `GET` | `/api/paciente/diario/semana?dias=` — serie con los días vacíos |
| `GET` `POST` | `/api/paciente/metricas` |
| `GET` | `/api/paciente/metricas/resumen` — última lectura de cada tipo |
| `GET` | `/api/pacientes/:id/registros?dias=` — **vista del profesional** |

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 22.
