# NutriSmart · Rebanada 9 — Plan alimentario semanal

**Objetivo:** prescribir la semana del paciente — siete días por seis momentos de comida — con un ciclo de vida explícito y un solo plan vigente a la vez. Materializa **CLI-09**.

**Depende de:** Rebanada 1 (auth, tenancy), 2 (pacientes) y la visibilidad por profesional de la 4.

---

## Alcance

**Incluye:**
- Migración `011`: `plan_alimentario` y `plan_comida` con sus enums.
- Ocho endpoints: listar, crear, leer, editar cabecera, reemplazar comidas, activar, archivar y descartar.
- Rejilla de 7×6 en lectura y en edición, dentro de una pestaña nueva de la ficha.

**NO incluye:** biblioteca de recetas o platos reutilizables, cálculo automático de macros a partir de alimentos, objetivo calórico calculado (eso es la calculadora nutricional de **EVAL**), duplicar un plan como punto de partida, exportación a PDF (**CLI-05**) y visibilidad del plan para el paciente (**PAC**).

---

## Decisiones tomadas

1. **La rejilla es fija: 7 días × 6 momentos.** No se modelan "comidas libres" con nombre arbitrario. El motivo es la comparación: el profesional necesita poner el lunes de un plan junto al lunes de otro, y con momentos libres esa columna deja de significar lo mismo.

2. **Los macros son opcionales, incluidas las calorías.** Obligarlos convertiría cada celda en un ejercicio de cálculo y el resultado predecible es que el profesional invente cifras para poder guardar. Se prescribe "Avena con frutas" aunque nadie sepa cuántas kilocalorías tiene.

3. **Un solo plan activo por paciente, garantizado por un índice parcial.** No por una comprobación previa en la API: dos peticiones concurrentes pasarían las dos por cualquier `select`. La API traduce la violación `23505` a un **409** con instrucciones.

4. **Las comidas se reemplazan enteras, en una transacción.** Es la única semántica honesta cuando el profesional puede vaciar una celda: con un guardado incremental, borrar el almuerzo del martes no tendría forma de expresarse. Fuera de transacción, un fallo a mitad dejaría el plan con media semana.

5. **Un archivado no se edita ni se reactiva.** Es el registro de lo que se prescribió; si volviera a ser editable, el historial dejaría de ser prueba de nada. Para reutilizarlo habrá que duplicarlo, que es trabajo de otra rebanada.

6. **"Descartar" archiva, no borra.** Solo se permite sobre borradores —lo que nunca llegó a prescribirse—, y aun así la fila se conserva: la trazabilidad clínica del proyecto dice que nada desaparece físicamente.

7. **`clinica_id` también en `plan_comida`.** Se puede deducir por el plan, pero la regla del proyecto es tenant en toda tabla, y es lo que ya hacen `lab_resultado` y `snapshot_metrica`. Deducirlo por join significa que el día que alguien escriba una consulta sin ese join, la fuga entre clínicas no dará ningún error.

8. **El día 1 es lunes (ISO-8601).** Se fija en la migración para que la interfaz no tenga que adivinar dónde empieza la semana.

---

## Ajustes contra el código real

La especificación de partida asumía otro proyecto:

| Asumido | Real |
|---|---|
| `resolverAlcance(request, pacienteId)` | `resolverAlcance(tenantId, sub, roles)` → `{ profesionalId, restringirA, esAdmin }` |
| `paciente.activo` | `paciente.estado` |
| `db.query` / `db.connect()` | `pool` de `db.ts`; transacciones con `pool.connect()` y `begin`/`commit` en minúsculas |
| `profesional_id` desde `request.auth.sub` con una consulta propia | `alcance.profesionalId`, que ya lo resuelve |
| Respuestas en `snake_case` | El resto de la API es `camelCase` |
| `COALESCE` en el PUT de cabecera | Impide borrar un campo; se escriben solo las columnas presentes en el cuerpo |
| Sin `clinica_id` en `plan_comida` | La lleva, como las demás tablas hijas |

---

## Modelo de datos

### `plan_alimentario`
`clinica_id`, `paciente_id`, `profesional_id`, `nombre` (1–120), `objetivo` (≤500), `fecha_inicio`, `fecha_fin`, `estado`, `notas`.

`profesional_id` es quien lo prescribió, que no tiene por qué ser el nutricionista asignado al paciente.

Un `CHECK` impide que `fecha_fin` sea anterior a `fecha_inicio`: un plan que termina antes de empezar no es un desliz que convenga tolerar, es un dato que luego nadie sabe interpretar.

### `plan_comida`
`clinica_id`, `plan_id`, `dia_semana` (1–7), `tipo_comida`, `descripcion` (1–1000), `calorias_kcal`, `proteinas_g`, `carbohidratos_g`, `grasas_g`, `notas`.

Único por `(plan_id, dia_semana, tipo_comida)`: dos desayunos del lunes serían dos indicaciones para el mismo momento.

---

## Contrato de API

Todo requiere `Bearer`, se acota por clínica y por alcance, y responde **404** cuando el plan o su paciente no son visibles — nunca 403, que confirmaría la existencia de pacientes ajenos.

| Método | Ruta | Nota |
|---|---|---|
| `GET` | `/api/pacientes/:id/planes` | Solo cabeceras. El activo primero |
| `POST` | `/api/pacientes/:id/planes` | **201**, nace en `borrador` |
| `GET` | `/api/planes/:planId` | Con `dias`, agrupado por día |
| `PUT` | `/api/planes/:planId` | Cabecera. **409** si está archivado |
| `PUT` | `/api/planes/:planId/comidas` | Reemplazo total. **409** si archivado |
| `PUT` | `/api/planes/:planId/activar` | **409** si ya hay otro activo |
| `PUT` | `/api/planes/:planId/archivar` | **409** si ya lo está |
| `DELETE` | `/api/planes/:planId` | **204**; solo borradores, y archiva |

Las comidas se devuelven en orden **cronológico** —desayuno, media mañana, almuerzo…— no alfabético. El `ORDER BY` va contra la columna del enum y no contra el alias `::text`; con el alias, Postgres ordena por texto y el almuerzo sale antes que el desayuno.

Las fechas sin hora viajan con `to_char` como `AAAA-MM-DD`. Dejarlas como `date` haría que `pg` las emitiera como instante de medianoche UTC, y en husos al oeste se mostrarían un día antes.

---

## Frontend

- **Pestaña «Plan alimentario»** en la ficha, entre Laboratorios y Sociodemografía.
- **Lista lateral** con el estado de cada plan; el activo lleva el mismo `--status-normal` que el chip "Completada" de la agenda.
- **Rejilla en lectura**: solo las filas con alguna comida — un plan de desayuno y cena no necesita cuatro filas vacías empujando la tabla. Al pie, la suma de lo declarado.
- **Rejilla en edición**: las 42 celdas, con acciones arriba y abajo porque la tabla es alta. Las celdas sin descripción no viajan: vacío es "no hay comida prescrita", no una comida en blanco.
- **Crear un plan abre el editor directamente**: nace vacío y lo siguiente que toca es cargarlo.

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 9 (CA-09-01 … CA-09-09).
