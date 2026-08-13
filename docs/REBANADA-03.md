# NutriSmart · Rebanada 3 — Expediente y timeline clínico

**Objetivo:** dar al nutricionista el estado clínico actual del paciente y su evolución en el tiempo. Materializa **CLI-01**, la funcionalidad P0 que la propia épica coloca primera en su secuencia porque define el modelo de datos clínico central del que dependen EVAL, RPM, la IA y las gráficas.

**Depende de:** Rebanada 1 (auth, tenancy) y Rebanada 2 (paciente, diagnósticos, alergias).

---

## Alcance

**Incluye:**
- Migración `004`: catálogo de métricas, `clinical_snapshot`, `snapshot_metrica`, `clinical_note` y `paciente_antecedente`.
- **Snapshot clínico**: punto de control con fecha, en estado borrador o cerrado.
- **Métricas longitudinales**: peso, talla, cintura, presión, glucosa y grasa corporal, con IMC calculado.
- **Nota narrativa** por snapshot.
- **Timeline vertical** cronológico con indicadores de tendencia entre snapshots consecutivos.
- **Expediente**: estado actual, derivado del dato vivo.
- **Antecedentes** personales, familiares y quirúrgicos.
- API y pantallas para crear, editar, cerrar y corregir snapshots.

**NO incluye (otras funcionalidades de la épica CLI):** laboratorios (CLI-04), estrategia y PDF (CLI-05), agenda (CLI-03), sociodemografía (CLI-07). El snapshot deja los enganches preparados y esas secciones se muestran como pendientes, igual que las pestañas de la Rebanada 2.

**Principio clave:** *un snapshot cerrado es inmutable*. Corregir no es editar: es crear una versión nueva que apunta a la anterior. Ningún registro clínico se elimina ni se reescribe.

---

## Decisiones tomadas

1. **Visibilidad por clínica**, no por profesional. CLI-02 pide que cada profesional vea solo a sus pacientes; se revisa en la Rebanada 4, cuando el seed tenga más de un nutricionista.
2. **El expediente es una vista derivada, no una tabla.** Siempre refleja el dato vivo; nunca hay una copia que pueda divergir.
3. **El IMC se calcula en SQL**, nunca se almacena. Un IMC guardado puede acabar contradiciendo al peso que lo originó.
4. **Cada snapshot captura peso Y talla.** No se arrastra la talla del snapshot anterior: si ese día no se midió, el campo queda vacío y **el IMC de ese snapshot es `null`**. La serie de IMC tendrá huecos, y es correcto que los tenga — inventar una talla es inventar un IMC.
5. **El catálogo de métricas es una tabla**, no un enum: añadir "circunferencia de cadera" o "porcentaje de músculo" no debe requerir una migración.
6. **Cerrar un snapshot actualiza `paciente.ultima_visita`** automáticamente. Hoy esa columna la pone el seed y nadie la mantiene.
7. **`estado_clinico` sigue siendo de solo lectura.** Lo fijará el motor de monitoreo (RPM), no el profesional a mano.

---

## Modelo de datos

### `metrica_catalogo`
Catálogo global (no por tenant): `codigo` (clave), `nombre`, `unidad`, `decimales`, `min_plausible`, `max_plausible`, `orden`, `activo`.

Semilla inicial: `peso` (kg), `talla` (cm), `cintura` (cm), `presion_sistolica` y `presion_diastolica` (mmHg), `glucosa_ayunas` (mg/dL), `grasa_corporal` (%).

`min_plausible` y `max_plausible` no son rangos clínicos de normalidad: son cotas de sensatez para atajar erratas de tecleo (un peso de 700 kg), no para juzgar al paciente.

### `clinical_snapshot`
`clinica_id`, `paciente_id`, `profesional_id` (autor), `fecha` (fecha clínica del control), `estado` (`borrador` | `cerrado` | `corregido`), `cerrado_at`, `corrige_a_id` (auto-referencia), `created_at`, `updated_at`.

- **Un solo borrador por paciente** a la vez, con índice único parcial. Dos borradores abiertos serían dos versiones de la verdad.
- `corrige_a_id` apunta al snapshot corregido; ese pasa a `corregido` y **permanece consultable**.

### `snapshot_metrica`
`clinica_id`, `snapshot_id`, `metrica_codigo`, `valor`. Único por `(snapshot_id, metrica_codigo)`. Esta tabla **es** la serie longitudinal: no hace falta otra.

### `clinical_note`
`clinica_id`, `snapshot_id` (único), `profesional_id`, `texto`, `created_at`.

Una nota por snapshot. El versionado lo aporta el propio snapshot; dos mecanismos de versionado conviviendo acabarían contradiciéndose.

### `paciente_antecedente`
`clinica_id`, `paciente_id`, `tipo` (`personal` | `familiar` | `quirurgico`), `descripcion`, `activo`, `created_at`. Baja lógica por `activo`, igual que diagnósticos y alergias.

---

## Contrato de API

Todas requieren `Authorization: Bearer <token>` y se acotan por `clinica_id` del token. Cualquier `:id` de otra clínica → **404**.

### `GET /api/metricas`
Catálogo activo, ordenado. Lo consume el formulario para no llevar la lista incrustada.

### `GET /api/pacientes/:id/expediente`
Estado actual derivado. Cada métrica trae su último valor cerrado y la variación respecto al anterior.
```json
{
  "paciente": { "id": "…", "nombre": "Juan Ramírez", "edad": 58 },
  "metricas": [
    { "codigo": "peso", "nombre": "Peso", "unidad": "kg",
      "valor": 88.4, "fecha": "2026-08-10",
      "anterior": 90.1, "delta": -1.7, "tendencia": "baja" },
    { "codigo": "imc", "nombre": "IMC", "unidad": "kg/m²",
      "valor": 28.9, "fecha": "2026-08-10",
      "anterior": 29.4, "delta": -0.5, "tendencia": "baja" }
  ],
  "diagnosticos": [{ "descripcion": "Diabetes tipo 2" }],
  "alergias": [{ "descripcion": "Penicilina" }],
  "antecedentes": [{ "tipo": "familiar", "descripcion": "Padre diabético" }],
  "ultimoSnapshot": { "id": "…", "fecha": "2026-08-10" }
}
```
`tendencia` es `sube` | `baja` | `igual` | `null` (sin punto previo). **El significado clínico de la dirección no lo decide la API**: bajar de peso puede ser bueno o alarmante según el caso. La UI muestra la dirección, no un juicio.

### `GET /api/pacientes/:id/snapshots`
Timeline cronológico descendente. Incluye borrador y cerrados; los `corregido` solo se devuelven anidados bajo la versión que los reemplaza.
```json
[
  { "id": "…", "fecha": "2026-08-10", "estado": "cerrado",
    "profesional": "Dra. Ana Rodríguez",
    "metricas": [{ "codigo": "peso", "valor": 88.4, "delta": -1.7 }],
    "nota": "Buena adherencia…",
    "corrigeA": null, "corregidoPor": null,
    "labs": null, "estrategia": null }
]
```
`labs` y `estrategia` viajan siempre en `null`: son los enganches de CLI-04 y CLI-05.

### `POST /api/pacientes/:id/snapshots` → 201
```json
{ "fecha": "2026-08-12",
  "metricas": { "peso": 88.4, "talla": 175 },
  "nota": "Refiere mejor descanso." }
```
Nace en `borrador`. **409** si el paciente ya tiene uno abierto.

Validaciones: `fecha` no futura; cada métrica debe existir en el catálogo y caer dentro de sus cotas plausibles; `metricas` puede venir vacío (una consulta sin mediciones es válida).

### `GET /api/snapshots/:id` · `PUT /api/snapshots/:id`
`PUT` reemplaza fecha, métricas y nota. **409 si el snapshot no está en `borrador`** — es la regla de inmutabilidad, aplicada en el servidor y no solo escondiendo un botón.

### `POST /api/snapshots/:id/cerrar`
`estado = 'cerrado'`, fija `cerrado_at` y **actualiza `paciente.ultima_visita`** con la fecha del snapshot si es más reciente. Idempotente: cerrar dos veces no cambia `cerrado_at`.

### `POST /api/snapshots/:id/corregir` → 201
Crea un snapshot nuevo en `borrador` con `corrige_a_id` apuntando al original, precargado con sus valores. El original pasa a `corregido`.

**409 si el original no está `cerrado`** — un borrador se edita, no se corrige. Aquí sí se detalla el motivo, a diferencia del 404 genérico de otras rutas: el cliente ya está autorizado sobre ese snapshot, así que "existe pero no está cerrado" no revela nada que no deba saber, y es justo lo que el frontend necesita para dar el mensaje correcto al nutricionista.

---

## Frontend (app profesional)

- **Pestaña "Historial" activada** en `/pacientes/:id`: timeline vertical cronológico. Cada snapshot es una tarjeta con fecha, autor, métricas con su flecha de tendencia y la nota. Secciones colapsables; las de labs y estrategia aparecen como pendientes.
- **Resumen enriquecido**: tarjeta de métricas vitales con valor actual, unidad y variación; tarjeta de antecedentes junto a las de diagnósticos y alergias.
- **Modal "Nuevo punto de control"**: fecha (por defecto hoy), campos del catálogo con su unidad, y nota. Botones "Guardar borrador" y "Guardar y cerrar".
- **Snapshot cerrado en solo lectura**, con un botón "Corregir" que explica que se creará una versión nueva y la original quedará archivada.
- **Un snapshot corregido** se muestra plegado bajo el vigente, con la etiqueta "Versión corregida".
- Estados de carga, vacío ("Aún sin puntos de control — el primero se registra en la próxima consulta") y error con reintentar.

---

## Criterios de aceptación

- Crear un snapshot con fecha y métricas → aparece en el timeline en estado borrador.
- Cerrarlo → queda inmutable: `PUT` responde **409**.
- Con dos snapshots cerrados, el timeline muestra la **variación correcta** de cada métrica respecto al anterior.
- Un snapshot con peso pero **sin talla** → su IMC es `null`, y la serie muestra el hueco en vez de un valor inventado.
- Corregir un cerrado → nace una versión nueva enlazada; la original queda en `corregido` y **sigue consultable**.
- Intentar abrir un segundo borrador para el mismo paciente → **409**.
- Cerrar un snapshot → `paciente.ultima_visita` refleja su fecha en la lista de pacientes.
- Un valor fuera de las cotas plausibles (peso 700) → **400** indicando el campo.
- Snapshot de OTRA clínica en cualquier verbo → **404**.
- Ningún registro clínico se elimina físicamente: comprobable en base tras corregir y tras editar antecedentes.

---

## Prompt para Claude Code (pégalo en `c:\nutrismart`)

```
Lee CLAUDE.md, docs/REBANADA-03.md, docs/epicas/Epica_CLI_Gestion_Clinica.html
(funcionalidad CLI-01) y el código de las rebanadas 1 y 2.
Implementa la Rebanada 3 en pasos pequeños y verificables:

1) Migración 004 con el catálogo de métricas (y su semilla), clinical_snapshot,
   snapshot_metrica, clinical_note y paciente_antecedente. Índice único parcial
   para un solo borrador por paciente. Aplícala con el runner incremental.
2) API acotando SIEMPRE por clinica_id del token: catálogo, expediente derivado,
   timeline con tendencias calculadas en SQL con lag(), y el ciclo del snapshot
   (crear, editar solo en borrador, cerrar, corregir).
   El IMC se calcula, nunca se almacena, y es null si falta la talla.
3) Frontend con el design system: pestaña Historial con el timeline, Resumen
   enriquecido, modal de nuevo punto de control y flujo de corrección.
4) Verifica los criterios de aceptación de docs/REBANADA-03.md contra la API real,
   no solo compilando.

Trabaja en pasos pequeños y explica cada uno. No dependas del código de Vetline.
```
