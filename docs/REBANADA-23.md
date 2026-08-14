# NutriSmart · Rebanada 23 — Metas, progreso y tareas

**Objetivo:** que el paciente vea cuánto lleva avanzado hacia su meta, y que el profesional pueda mandarle tareas entre consultas. Materializa **PAC-05** y **PAC-06**.

**Migración 025.** El encargo pedía la 024, ya ocupada por `registro_metrica` en la Rebanada 22.

---

## La meta de peso no existía en ninguna parte

Es lo primero que hubo que resolver. `conclusion_valoracion.plan_nutricional` —de donde el encargo sacaba `peso_objetivo` y `fecha_objetivo_peso`— **no existe**; ni esa columna ni ninguna otra que guardase una meta ponderal. Sin ella, una pantalla llamada «Mi progreso» no puede decir progreso hacia qué.

En la Rebanada 16 quedó anotado exactamente esto, al explicar por qué los deltas no podían decir si un cambio era bueno o malo:

> «Sin un objetivo de peso registrado, el servidor no tiene con qué distinguirlos. […] El día que se registre una meta ponderal, "acercándose al objetivo" pasará a ser computable y honesto.»

Se añaden `peso_objetivo` y `fecha_objetivo_peso` a `conclusion_valoracion`, y el formulario de conclusión de la Rebanada 15 los escribe. Van ahí porque son parte de lo que el profesional **prescribe** en consulta, junto a las calorías y los macros — no un deseo que el paciente se pone por su cuenta.

Con fecha, además: «llegar a 72 kg» sin plazo no es una meta, es una aspiración. Se admite el peso sin fecha —hay objetivos sin plazo cerrado— pero una fecha sin peso se descarta porque no dice nada.

---

## Decisiones tomadas

### 1. El avance se mide con el peso de CONSULTA, no con el de casa

El encargo calculaba el progreso a partir de `registro_metrica`, que es lo que el paciente se pesa en casa. Pero la Rebanada 22 separó las dos series justamente porque no son lo mismo: la báscula de la clínica está calibrada y se usa siempre igual.

Decirle a alguien «te faltan 2 kg» a partir de una báscula sin calibrar, a una hora cualquiera y vestido, es dar por exacto lo que no lo es.

La pantalla dibuja **las dos series sobre los mismos ejes**, distinguidas —consulta en trazo firme, casa en trazo fino y discontinuo— con leyenda, y dice explícitamente que el porcentaje sale de las mediciones de consulta.

### 2. El peso de casa se promedia por semana

Un valor suelto de báscula doméstica oscila con la hora, la ropa y la comida del día anterior. La media semanal es como se lee de verdad ese dato.

### 3. Sin dos mediciones no hay avance que calcular

Con una sola medición no hay recorrido que medir, y un «0 % completado» sugiere un estancamiento que nadie ha observado. En ese caso se devuelve `avance: null` y la pantalla explica qué falta.

### 4. Las calorías se promedian por día apuntado, no por día natural

`sum(kcal) / count(distinct fecha)`. Dividir entre siete cuando el paciente solo apuntó dos días diría que come 300 kcal diarias, que es falso y además desalienta. La pantalla lo dice: «Es la media de los días que apuntaste, no de toda la semana».

### 5. Las tareas no son los acuerdos

Un **acuerdo** se pacta en consulta, va dentro de `conclusion_valoracion` y lo firma el profesional. Una **tarea** se manda entre consultas, tiene fecha límite y prioridad. Meterlas en el mismo sitio obligaría a versionar la conclusión cada vez que se envía una tarea.

### 6. Un solo endpoint para marcar y desmarcar

El encargo pedía `/completar` y `/descompletar`. Es el mismo interruptor, y separarlo duplica la comprobación de propiedad en dos sitios que pueden divergir. `PATCH …/tareas/:id` con `{ completada: true | false }`.

### 7. Archivar no es borrar, y cada uno ve lo suyo

Retirar una tarea la marca `archivada`. **El paciente deja de verla** —el profesional la retiró, y volver a mostrarla confunde— pero **el profesional sigue viéndola**: necesita saber qué mandó y qué retiró.

### 8. Estado y fecha de completado no pueden discrepar

Un `CHECK` obliga a que `completada_en` exista si y solo si el estado es `completada`. Una tarea «pendiente» con fecha de completado es una contradicción que alguien acabaría leyendo como buena.

### 9. Progreso no es una sexta pestaña

La barra inferior ya tiene cinco, que es el máximo razonable en un móvil. `/progreso` se alcanza desde una tarjeta de Inicio.

---

## El fallo que salió al probar

El primer cálculo de avance dijo que la paciente había **ganado** 2,4 kg cuando había perdido esa misma cantidad.

Causa: dos mediciones con la misma fecha empatan en el `ORDER BY fecha_medicion`, el orden queda a merced del plan de ejecución, y el «peso inicial» acabó siendo el más reciente. Dos mediciones el mismo día son perfectamente plausibles —una corrección, o dos consultas—.

Se desempata por `created_at`. Tras el arreglo: 80 → 77,6 kg, **30 % del camino** hacia 72 kg.

---

## Otros ajustes contra el código real

| Asumido | Real |
|---|---|
| Migración 024 | **025** — la 024 la ocupó la R22 |
| `apps/api/src/db/migrations/` | `apps/api/migrations/` |
| `conclusion_valoracion.plan_nutricional` (JSONB) | No existe; la meta se añade en columnas propias |
| `registro_metrica.fecha` | `medido_en` |
| `paciente.nombre_completo` | `nombre` |
| `fastify.authenticate` · `request.user.sub` | `requireAuthPaciente` · `request.authPac.sub` |
| Rutas `/api/profesional/pacientes/:id/tareas` | `/api/pacientes/:id/tareas`, como el resto del proyecto |

---

## Contrato de API

| Método | Ruta |
|---|---|
| `GET` | `/api/paciente/progreso?meses=` |
| `GET` | `/api/paciente/tareas?estado=pendiente` |
| `PATCH` | `/api/paciente/tareas/:id` — marcar y desmarcar |
| `GET` `POST` | `/api/pacientes/:id/tareas` — lado del profesional |
| `DELETE` | `/api/pacientes/:id/tareas/:tareaId` — archivar |

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 23.
