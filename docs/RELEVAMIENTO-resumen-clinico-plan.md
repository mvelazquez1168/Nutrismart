# Resumen clínico del plan alimentario — relevamiento y construcción (R49)

Fecha: 2026-10-12 · Rama `resumen-clinico-del-plan`, apilada sobre `intercambios-ada-valance`.

---

## Parte 1 — Relevamiento: cómo estaba el flujo

### El guardado de la prescripción pasa por una sola ruta

Hay dos pantallas que guardan el plan y las dos terminan en el mismo
endpoint:

| Pantalla | Componente | Llama a |
|---|---|---|
| Valoración → bloque «Plan alimentario» | `eval/PlanAlimentarioResumen.tsx` | `PUT /api/planes/:planId/comidas` |
| Ficha → pestaña «Plan alimentario» (editor) | `PlanEditor.tsx` | `PUT /api/planes/:planId/comidas` |

`PlanAlimentarioResumen` crea y activa el plan si el paciente no tiene
uno activo, y después carga las comidas. Así que **el punto donde «el
profesional guarda la prescripción» es exactamente uno**: el `PUT
.../comidas` de `routes/planes.ts`. Es donde se enganchó la generación.

### Las tablas

| Tabla | Qué guarda | Relevancia |
|---|---|---|
| `plan_alimentario` | cabecera del plan: nombre, objetivo, fechas, estado (`borrador`/`activo`/`archivado`), notas | **no tiene `consulta_id`** |
| `plan_comida` | patrón diario: seis tiempos fijos, cada uno con `patron` y `ejemplo_menu` | bloque 4 del resumen |
| `conclusion_valoracion` | el juicio de la consulta | **aquí está casi todo el resumen** |
| `medicion_antropometrica` | peso, talla, IMC, % grasa, masa libre de grasa | bloque 2 |
| `lab_resultado` + `lab_estudio` + `biomarcador` | laboratorios vigentes | bloque 2 |
| `historial_clinico` | actividad, hábitos, antecedentes | bloque 2 |
| `tarea_paciente` | compromisos con fecha límite | bloque 7 |
| `uso_ia` | medidor de consumo; `funcion` es texto libre | sin cambios de esquema |

### El hallazgo que cambió el diseño

**Seis de los siete bloques ya existen como datos estructurados**, en
`conclusion_valoracion`:

| Bloque del requerimiento | Columna que ya lo tiene |
|---|---|
| Objetivos | `objetivos` |
| Observaciones clínicas | `observaciones_clinicas` (+ antropometría y labs) |
| Justificación | `justificacion` (la agregó la R44) |
| Plan alimentario | `plan_comida` |
| **Distribución de macros** | `kcal_prescritas`, `cho_g`, `proteina_g`, `grasa_g`, `pct_*` |
| Recomendaciones | `recomendaciones` (jsonb) + `suplementos` |
| Tareas | `acuerdos` (jsonb) + `tarea_paciente` |

Eso significa que **la IA no tiene que inventar el contenido clínico: lo
redacta**. Y en particular, el bloque 5 no se le pide al modelo en
absoluto — es la misma línea que trazó la migración 048 con las listas de
intercambio: *la IA lee y redacta, la aritmética la hace el código*.

### El histórico de planes

`PlanAlimentarioTab.tsx` (R41) es el histórico: lista lateral del más
reciente al más antiguo con `PlanCard.tsx` por entrada, detalle a la
derecha. `PlanCard` era **un `<button>` que envolvía toda la tarjeta**,
así que el botón del resumen no podía ir dentro: un botón anidado en otro
botón es HTML inválido y el navegador lo desarma por su cuenta.

---

## Parte 2 — Lo que se construyó

### Migración `049_resumen_clinico_plan.sql`

Tabla `resumen_clinico_plan`: los siete bloques como **siete columnas de
texto** (no un jsonb — un bloque ausente tiene que verse en el esquema),
más `macros_json` con las cifras del bloque 5, `consulta_id`,
`profesional_id`, `origen` (`ia` | `datos`), `modelo`, `tokens_salida` y
`generado_en`.

Dos decisiones escritas en el encabezado de la migración:

- **Tabla aparte, no columnas en `plan_alimentario`.** Un plan se edita;
  un resumen es lo que se dijo en un momento. En la misma fila, editar el
  plan mañana dejaría el resumen de ayer pegado a un plan que ya cambió.
- **Se inserta, no se actualiza.** Cada guardado genera su resumen y lo
  inserta; se lee el último por `generado_en`. El de hoy no borra el de
  la semana pasada.

### `apps/api/src/plan/resumenClinico.ts`

- `calcularMacros(conclusion, datosCalculadora)` — los gramos y el
  **porcentaje del VCT recalculado desde los gramos** (4/4/9 kcal/g),
  incluso cuando la fila ya trae un `pct_*`: así el porcentaje y los
  gramos que muestra el resumen no pueden contradecirse. Respaldo en
  `datos_calculadora` (R39) solo si la conclusión no trajo **nada** —
  mezclar gramos de una fuente con kcal de otra daría una distribución
  que no suma.
- `textoDistribucion(macros)` — el bloque 5 en texto. Sin cifras devuelve
  la leyenda de qué falta registrar y dónde. **Cero no es un valor
  válido**: un plan de 0 kcal se leería como una prescripción de ayuno.
- `reunirContexto(planId, clinicaId)` — las siete consultas en paralelo.
- `generarResumen(...)` — **no lanza nunca**. Devuelve un estado.
- `leerUltimoResumen(...)`, `planesConResumen(...)`.

### Prompt y partido de bloques (`ia/prompts.ts`)

`promptResumenClinico` pide **seis** bloques con encabezados literales, y
le prohíbe escribir el de macros o repetir sus cifras como propias. Lleva
la misma guarda contra inyección que el prompt SOAP (`<datos_plan>` con
el aviso de que es dato, no instrucción) y la misma regla contra el
relleno verosímil.

`partirResumen` reparte el texto en los seis bloques. Exige los dos
puntos en el encabezado: sin eso, una línea del cuerpo que empiece por
«Objetivos a corto plazo…» abriría el bloque y partiría el resumen por la
mitad. Tolera acentos, markdown y numeración. Lo que no aparece queda en
`null`, sin repartir a ojo.

### Rutas (`routes/planes.ts`)

| Ruta | Qué hace |
|---|---|
| `PUT /api/planes/:planId/comidas` | guarda (igual que antes) y **después genera el resumen**; devuelve `resumen: 'generado' \| 'sin_ia' \| 'fallo'` |
| `GET /api/planes/:planId/resumen` | el resumen guardado; **200 con `existe: false`** si no tiene |
| `POST /api/planes/:planId/resumen` | genera a pedido (planes viejos, o reintento tras fallo) |
| `GET /api/pacientes/:id/planes` | cada entrada trae `tieneResumen` |

El `GET` no devuelve 404 cuando falta el resumen: un 404 ahí significaría
«este plan no existe», y la pantalla diría «no se encontró el plan» sobre
un plan abierto delante del profesional.

### UI

- `ResumenClinicoModal.tsx` — los **siete encabezados siempre**, uno con
  la leyenda «Sin contenido para este bloque» cuando falta. Scroll propio
  (`max-h-[60vh] overflow-y-auto`), no el de la página: el encabezado y
  el botón «Cerrar» quedan a la vista. El bloque de macros se presenta en
  tabla (gramos y % del VCT) con la nota de que esas cifras salen de la
  prescripción, no del modelo. Encabezado con la marca de IA: quién lo
  redactó, cuándo y con qué modelo.
- `PlanCard.tsx` — reestructurado a `<div>` con dos botones. El del
  resumen dice **«Ver resumen clínico»** o **«Generar resumen clínico»**
  según `tieneResumen`: los planes anteriores a esta funcionalidad no
  tienen uno, y ofrecer «Ver» para abrir un modal vacío sería prometer
  algo que no hay.
- `eval/PlanAlimentarioResumen.tsx` — tras guardar avisa si el resumen
  quedó sin redacción o no se pudo generar, aclarando que **el plan sí se
  guardó**.

### Comprobación

`npm run verificar:resumen` — 29 comprobaciones de la aritmética y del
partido de bloques, con los porcentajes calculados a mano en los
comentarios. Pasan todas.

Falsificadas en rojo antes de darlas por buenas:

| Qué se rompió a propósito | Qué se puso rojo |
|---|---|
| `grasa: 9` → `grasa: 4` en `KCAL_POR_GRAMO` | 4 comprobaciones (casos 1, 2 y 4) |
| el encabezado deja de exigir los dos puntos | el caso 10: la línea del cuerpo abría un bloque |

Punta a punta contra la base de desarrollo
(`tsx src/plan/probar-resumen.ts`): plan real, contexto reunido, llamada
registrada en `uso_ia` con `funcion=resumen_clinico_plan`, los siete
bloques persistidos y leídos de vuelta. Se probó además con un plan
**sin** conclusión ni comidas: el modelo no inventó macros y cerró la
justificación pidiendo definir la meta calórica, que es lo que la regla
del prompt buscaba.

`tsc --noEmit` limpio en `apps/api` y `apps/web-professional`.
`vite build` de la web profesional, limpio.

---

## Parte 3 — Decisiones tomadas y lo que queda abierto

### Decidido, anotado para que se pueda revisar

1. **La consulta se resuelve, no se recibe.** `plan_alimentario` no tiene
   `consulta_id`, y un plan puede crearse desde la ficha sin consulta. El
   resumen usa **la conclusión de valoración más reciente del paciente** y
   deja escrito su `consulta_id`. Es lo correcto en el caso que importa
   —guardar el plan de la consulta en curso, que es cuando esto se
   dispara—; si se guarda hoy un plan viejo, el resumen se redacta con la
   consulta más reciente. Atar el plan a una consulta es un cambio de
   modelo mayor que lo que este trabajo supone.
2. **El guardado espera al modelo.** La respuesta del `PUT .../comidas`
   tarda lo que tarde la IA (unos segundos). Es el patrón que ya usan el
   SOAP y el análisis dietético. Si molesta, el arreglo es generar en
   segundo plano con un estado «en proceso», no quitar la generación.
3. **El resumen no es editable.** El requerimiento no lo pide. Queda
   señalado porque la regla de oro del proyecto dice que la salida de IA
   sea editable: hoy está *marcada* y *registrada en `uso_ia`*, pero no se
   puede corregir. Si se quiere, son un `PUT` y siete `textarea`.

### Pendiente del pedido anterior (Dietético / Consumo Usual)

Sigue sin hacer, por decisión de alcance de esa tanda: la captura por
alimento + cantidad en el módulo del profesional, los cuatro valores
editables (hoy solo existe `kcal_manual`), y la notificación del front
que consume `no_encontrado`.
