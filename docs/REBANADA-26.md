# NutriSmart · Rebanada 26 — Bienestar, medidas corporales y panel de monitoreo

**Objetivo:** que el paciente reporte cómo se encuentra y cómo cambia su cuerpo, y que el profesional lo vea todo junto sin abrir doce expedientes. Materializa **RPM-01** y **RPM-02**.

Es la primera rebanada del diferenciador ancla del producto: el **seguimiento continuo**.

**Migraciones 029 y 030.** El encargo dejaba los números abiertos (`0NN`, `0NN1`); la última aplicada era la 028.

---

## El fallo que habría roto el panel entero

Las cinco consultas del panel del profesional leen `registro_metrica.fecha`. **Esa columna no existe.** La tabla, creada en la Rebanada 22, tiene `medido_en` (`timestamptz`), no `fecha` (`date`).

No es un detalle de nombres: son tipos distintos. Las últimas lecturas por tipo, la minigráfica de peso y el cálculo de «días sin reportar» dependen todas de ella. Copiado tal cual, el panel habría respondido 500 en su primera petición.

---

## La fuga entre profesionales

El encargo listaba los pacientes con `WHERE p.clinica_id = $1` a secas. Eso enseña a **cada nutricionista el seguimiento de los pacientes de sus compañeros**: peso, síntomas, notas y días sin reportar.

`resolverAlcance` existe desde la Rebanada 4 exactamente para esto (CLI-02). El panel lo usa: un nutricionista ve solo los suyos, un administrador de clínica ve los de toda la clínica. Y pedir el detalle de un paciente ajeno devuelve **404**, no 403 — desde fuera no se puede distinguir un id inventado de uno que existe pero no te toca.

Comprobado: Ana (administradora) ve 3 pacientes; Luis (nutricionista) ve 2, y el detalle de María le responde 404.

---

## Decisiones tomadas

### 1. Las medidas de casa no conviven con las de consulta en la misma tabla

El encargo añadía una columna `fuente` (`'paciente' | 'consulta'`) a `registro_medida_corporal`, con la clave de unicidad puesta ahí para que ambas convivieran.

Pero las de consulta ya viven en `medicion_antropometrica` desde la Rebanada 3, y es de donde lee la ficha del profesional. Tener la cintura en dos tablas dejaría dos cifras para lo mismo sin que ninguna pantalla supiera cuál creer — el error que la Rebanada 24 evitó con los totales del diario.

Y es la línea que la Rebanada 22 ya trazó con el peso: lo que mide una cinta métrica en casa, delante del espejo, no es lo que mide el profesional con puntos anatómicos. Se cuentan aparte y se dibujan aparte. La tabla es **solo del paciente**; la columna `fuente` se retiró.

### 2. Los síntomas son una lista cerrada, y la cierra la base

Si fuese texto libre, cada paciente escribiría «jaqueca», «dolor de cabeza» y «me duele la cabeza», y el profesional no podría contar nada. El catálogo de 13 síntomas va en un `CHECK` con `sintomas <@ array[…]`, no solo en el código: así la base rechaza lo que no reconoce.

Es lo que hace posible «cinco días con insomnio este mes», que es un dato de consulta.

### 3. Cinco escalones de ánimo, no diez

Pedirle a alguien que distinga su ánimo entre un 6 y un 7 produce un número inventado. Cinco se contestan sin pensar, que es la única forma de que se conteste **todos los días** — y esto solo vale si se contesta todos los días.

### 4. Un parte por día, corregible

`PUT`, no `POST`, con `UNIQUE (paciente_id, fecha)`. Si el paciente lo rellena por la mañana y por la tarde cambia de idea, se corrige el del día. No se acumulan dos versiones de cómo estuvo el martes.

### 5. La racha se corta en el primer día sin parte

Contar «días con parte en el último mes» daría un número más bonito y no sería una racha. El día de hoy sin rellenar no la rompe —aún puede rellenarlo—; los anteriores sí.

### 6. Un hueco se dibuja como hueco

En la tira de 14 días, un día sin parte es un hueco. Rellenarlo con el valor del día anterior inventaría un dato que nadie dio.

### 7. «Nunca» no es lo mismo que «hace muchos días»

`diasSinBienestar: null` significa que no ha reportado jamás; un número significa que reportaba y dejó de hacerlo. Son dos situaciones distintas: la primera necesita que le enseñen la aplicación, la segunda una llamada. La pantalla las distingue y **«nunca» ordena por delante** de cualquier número de días.

### 8. No se devuelve `alertasActivas: 0`

El encargo lo incluía con el comentario «será alimentado desde r27». Un `0` en pantalla hace creer que el sistema comprobó y no encontró nada, cuando lo que pasa es que no comprobó. El campo aparecerá cuando existan las alertas.

### 9. El cambio de una medida solo se calcula si hay dos tomas de ESA medida

Si el paciente se midió la cintura en marzo y la cadera en julio, no hay ningún cambio que contar en ninguna de las dos. Se devuelve `null` y la pantalla dice «hace falta otra toma para poder comparar», en vez de un cambio de cero que parecería estancamiento.

### 10. Al corregir un día no se borra lo que no se mandó

Quien vuelve a medirse solo la cintura no pierde la cadera de esa misma fecha. `coalesce(excluded.x, tabla.x)` en el UPSERT.

### 11. Los días de silencio se cuentan en SQL, no en JavaScript

El encargo restaba un `Date` de JavaScript contra una columna `date`. Eso mezcla dos husos horarios y devuelve un día de más o de menos según la hora a la que se mire la pantalla. Se calcula contra la fecha de Costa Rica, en la consulta.

### 12. Cuatro pestañas, no cuatro entradas en la barra

«Cómo estoy», «Qué comí», «Peso y más» y «Cuerpo» son la misma acción —apuntar lo mío— y comparten pantalla. La barra inferior sigue con cinco. El bienestar va primero porque es lo que se contesta a diario.

### 13. El panel ordena por silencio, no por nombre

El valor de esa pantalla no está en quien va bien. Ordena por defecto por quién lleva más sin reportar, y ofrece «los que peor se encuentran» como segunda vista.

---

## Otros ajustes contra el código real

| Asumido | Real |
|---|---|
| `registro_metrica.fecha` | **`medido_en`** (timestamptz) — ver arriba |
| `apps/api/src/db/migrations/` | `apps/api/migrations/` |
| `schema_migrations.migration_name` | `version` |
| Tabla `recurso_pac` (prerequisitos) | `recurso` — la R24 sí está |
| `app.authenticate` · `req.auth.tenantId` vía `as any` | `requireAuth` / `requireAuthPaciente`, con tipos |
| `app.register(rpmRoutes, { pool })` | `registerRpmRoutes(app)`, con el `pool` importado |
| `/api/profesional/rpm/…` | `/api/rpm/…`, como el resto del proyecto |
| `INTERVAL '${meses} months'` interpolado | `make_interval(months => $3)`, parametrizado |
| 5 consultas + ensamblado en JavaScript | Una con `LATERAL`: lo que llega ya viene emparejado |

**Una regla del encargo que no se siguió:** «nunca `to_char()` en TIMESTAMPTZ». Aquí hay una razón concreta: `pg` convierte una columna `date` a un `Date` de JavaScript a medianoche **local**, y al serializarlo a JSON en UTC el día puede retroceder uno. Un parte del martes que aparece como lunes es un fallo que nadie ve hasta que alguien lo cuenta. Las fechas salen con `to_char(…,'YYYY-MM-DD')` y los instantes con el formato `…"Z"` fijado en la R21.

---

## Contrato de API

| Método | Ruta | Quién |
|---|---|---|
| `GET` `PUT` | `/api/paciente/bienestar` | Paciente |
| `GET` `PUT` | `/api/paciente/medidas-corporales` | Paciente |
| `DELETE` | `/api/paciente/medidas-corporales/:fecha` | Paciente (archiva) |
| `GET` | `/api/rpm/pacientes` | Profesional, con alcance |
| `GET` | `/api/rpm/pacientes/:id?meses=` | Profesional, con alcance |

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 26.
