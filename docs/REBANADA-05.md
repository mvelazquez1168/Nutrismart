# NutriSmart · Rebanada 5 — Laboratorios

**Objetivo:** ingresar resultados de laboratorio y mostrarlos estructurados para su lectura clínica. Materializa **CLI-04**, la última funcionalidad P0 de la épica CLI.

**Depende de:** Rebanada 1 (auth, tenancy), Rebanada 2 (pacientes) y Rebanada 3 (snapshots, a los que el estudio se puede enlazar).

---

## Alcance

**Incluye:**
- Migración `007`: catálogo global de biomarcadores, rangos de referencia **por clínica y sexo**, estudios de laboratorio, resultados y metadatos de archivos.
- Carga de archivos con almacenamiento en volumen, **detrás de una interfaz** que permita cambiar a S3 sin tocar el resto.
- **CSV parseado** con previsualización antes de guardar; **PDF adjuntado** con captura manual de valores.
- Tabla de biomarcadores con valor, rango de referencia, estado por umbral y **tendencia respecto al estudio anterior**.
- Descarga del archivo original.

**NO incluye:** interpretación de hallazgos y patrones (**IA-01**, frontera que marca la propia épica), uso en la valoración (EVAL-02), extracción automática de valores desde PDF, y umbral de valor crítico.

**Principio clave:** el sistema **captura y presenta**; no interpreta. Un valor fuera de rango se marca como *alterado*, que es aritmética contra un rango declarado — no un diagnóstico.

---

## Decisiones tomadas

1. **El CSV se parsea; el PDF solo se adjunta.** Extraer valores de un PDF de laboratorio es un problema en sí mismo —cada laboratorio maqueta distinto y muchos informes son escaneos— y resolverlo bien acaba requiriendo OCR o IA, justo la frontera que la épica sitúa en IA-01.
2. **El archivo original se conserva.** Es un documento clínico; quedarse solo con los valores transcritos y descartar la fuente es indefendible ante una discrepancia.
3. **Archivos en volumen, no en Postgres.** Guardar binarios como `bytea` infla cada copia de seguridad y cada réplica. Van al disco detrás de una interfaz `AlmacenArchivos`, cuya única implementación hoy es local y mañana será S3.
4. **Rangos de referencia segmentados por sexo, sin tramos de edad en v1.** Es donde está la mayor parte de la diferencia clínica con una fracción de la complejidad.
5. **Los rangos son por clínica.** Cada laboratorio reporta los suyos y el nutricionista los conoce; un rango global que no coincida con el informe en pantalla confunde más de lo que ayuda.
6. **Solo `normal` y `alterado` en v1.** El valor de pánico llega con el motor de monitoreo (RPM), que es quien sabe qué hacer con él.
7. **El estudio cuelga del PACIENTE, con `snapshot_id` opcional.** Un paciente trae laboratorios entre consultas: obligar a abrir un punto de control para registrarlos generaría borradores vacíos, que además chocarían con la regla de un solo borrador por paciente.

---

## Un tercer estado que no es una severidad

Un biomarcador sin rango declarado para el sexo del paciente **no puede evaluarse**. Marcarlo como `normal` sería afirmar algo que nadie ha comprobado, y como `alterado` sería una falsa alarma.

Por eso el estado calculado tiene tres valores: **`normal`**, **`alterado`** y **`sin_referencia`**. El tercero no es un nivel de gravedad entre los otros dos: es la ausencia de criterio, y la interfaz lo muestra en gris, nunca en color de estado clínico.

Ocurrirá de verdad: cuando el paciente no tenga sexo biológico registrado, o cuando la clínica aún no haya configurado ese biomarcador.

---

## Modelo de datos

### `biomarcador` (catálogo global)
`codigo` (clave), `nombre`, `unidad`, `decimales`, `grupo` (perfil lipídico, glucémico, hepático…), `orden`, `activo`.

Global como el de métricas: son analitos estándar y un catálogo por clínica haría incomparables las series. Lo que sí es por clínica son los **rangos**.

Semilla inicial: glucosa en ayunas, hemoglobina glicosilada, colesterol total, HDL, LDL, triglicéridos, hemoglobina, hierro sérico, ferritina, TSH, vitamina D, creatinina, ALT, AST.

### `biomarcador_rango`
`clinica_id`, `biomarcador_codigo`, `sexo` (`masculino` | `femenino` | `intersexual` | **null = cualquiera**), `minimo`, `maximo`.

Único por `(clinica_id, biomarcador_codigo, sexo)`. La resolución busca primero el rango del sexo del paciente y, si no existe, el de `sexo is null`. Sin ninguno de los dos, el resultado es `sin_referencia`.

La migración siembra un juego por defecto para las clínicas existentes. Las nuevas lo recibirán al registrarse (ADM-06).

### `lab_estudio`
`clinica_id`, `paciente_id`, `profesional_id`, `snapshot_id` (**nullable**), `fecha` (fecha de toma de muestra), `laboratorio` (texto libre), `archivo_id` (nullable), `notas`, `created_at`.

`fecha` es la de la muestra, no la de captura: ordena el histórico y calcula tendencias.

### `lab_resultado`
`clinica_id`, `estudio_id`, `biomarcador_codigo`, `valor`. Único por `(estudio_id, biomarcador_codigo)`.

**El estado no se almacena**, se calcula al leer contra el rango vigente. Un estado guardado quedaría obsoleto en cuanto la clínica corrija un rango, y nadie recordaría recalcular el histórico.

### `archivo`
`clinica_id`, `nombre_original`, `mime`, `tamano_bytes`, `sha256`, `ruta_relativa`, `subido_por`, `created_at`.

`sha256` permite detectar que el mismo informe se subió dos veces. `ruta_relativa` es interna al almacén: cambiar de disco a S3 no debe tocar filas.

---

## Almacenamiento y seguridad de archivos

Un endpoint de subida es la superficie de ataque más grande que ha tenido este proyecto. Las reglas:

- **Solo `application/pdf`, `text/csv` y `image/*`**, validando el contenido, no solo la extensión ni la cabecera que envía el cliente.
- **Límite de tamaño** por archivo (10 MB) y rechazo explícito al superarlo.
- **El nombre original no se usa como ruta.** Se guarda como metadato y el archivo vive bajo un nombre generado; así `../../etc/passwd` o un nombre con caracteres de control no llegan al sistema de ficheros.
- **La descarga va con `Content-Disposition: attachment`** y el `Content-Type` almacenado. Servir un HTML subido por un usuario desde el mismo origen sería XSS con sesión válida.
- **La descarga se acota por clínica y por alcance**, igual que todo lo demás: `GET /api/archivos/:id` de otra clínica responde 404.
- El volumen se declara en el compose para que los archivos **sobrevivan a recrear el contenedor**.

---

## Contrato de API

Todas requieren `Bearer` y se acotan por clínica y alcance del solicitante.

### `GET /api/biomarcadores`
Catálogo con los rangos **de esta clínica**, agrupados por perfil.

### `POST /api/archivos` → 201
`multipart/form-data`. Devuelve `{ id, nombreOriginal, mime, tamanoBytes }`. **413** si excede el límite, **415** si el tipo no está permitido.

### `POST /api/archivos/:id/previsualizar-csv`
Parsea un CSV ya subido y devuelve lo que entendió **sin guardar nada**:
```json
{
  "reconocidos": [{ "codigo": "glucosa_ayunas", "nombre": "Glucosa en ayunas", "valor": 132 }],
  "noReconocidos": [{ "etiqueta": "Hemograma completo", "valor": "ver adjunto" }],
  "avisos": ["La fila 7 no tiene valor numérico"]
}
```
Nunca se persiste lo que un parser dedujo sin que un humano lo confirme: un decimal mal leído en un laboratorio no es un error cosmético.

**Formato esperado:** cabecera `biomarcador,valor` y una fila por analito. Los códigos desconocidos no rompen la importación: viajan en `noReconocidos` para captura manual.

### `GET /api/pacientes/:id/laboratorios`
Estudios en orden cronológico descendente, con estado y tendencia por resultado:
```json
[
  { "id": "…", "fecha": "2026-08-10", "laboratorio": "Lab Clínico Vida",
    "snapshotId": null,
    "archivo": { "id": "…", "nombreOriginal": "informe.pdf", "mime": "application/pdf" },
    "resultados": [
      { "codigo": "glucosa_ayunas", "nombre": "Glucosa en ayunas", "unidad": "mg/dL",
        "valor": 132, "rango": { "minimo": 70, "maximo": 100 },
        "estado": "alterado", "anterior": 145, "delta": -13, "tendencia": "baja" }
    ] }
]
```

### `POST /api/pacientes/:id/laboratorios` → 201
```json
{ "fecha": "2026-08-10", "laboratorio": "Lab Clínico Vida",
  "archivoId": "…", "snapshotId": null, "notas": null,
  "resultados": [{ "codigo": "glucosa_ayunas", "valor": 132 }] }
```
Validaciones: fecha no futura; cada código debe existir en el catálogo; al menos un resultado **o** un archivo adjunto —un estudio vacío no aporta nada—; `snapshotId`, si viene, debe ser un snapshot de ese mismo paciente.

### `GET /api/archivos/:id`
Descarga el original con `Content-Disposition: attachment`.

### `DELETE` — no existe
Un estudio no se borra. Si se cargó por error, se marca `anulado` con motivo, igual que la baja de un paciente.

---

## Frontend (app profesional)

- **Pestaña "Laboratorios" activada** en la ficha del paciente, junto a Resumen e Historial.
- **Lista de estudios** en tarjetas colapsables por fecha, con el nombre del laboratorio y el adjunto descargable.
- **Tabla de biomarcadores** por estudio: valor con unidad, rango de referencia aplicado, badge de estado y flecha de tendencia. `sin_referencia` en gris, con la razón al pasar el cursor.
- **Carga en dos pasos:** zona *drag-and-drop* → si es CSV, pantalla de revisión con lo reconocido y lo no reconocido, editable antes de guardar; si es PDF, formulario de captura manual con el informe abierto al lado.
- **Tarjeta de últimos laboratorios en el Resumen**, con los alterados primero.
- Estados de carga, vacío ("Aún sin laboratorios registrados") y error con reintentar.

---

## Criterios de aceptación

- Subir un PDF → se guarda, aparece en el estudio y **se descarga con el mismo contenido** (comprobable por `sha256`).
- Subir un CSV → la previsualización muestra reconocidos y no reconocidos **sin crear nada**; confirmar crea el estudio.
- Un valor fuera del rango de la clínica → **`alterado`**; dentro → **`normal`**.
- El mismo valor con **rangos de clínicas distintas** puede dar estados distintos.
- Biomarcador **sin rango** para el sexo del paciente, o paciente **sin sexo registrado** → **`sin_referencia`**, nunca `normal`.
- Rango definido para `sexo is null` → se aplica cuando no hay uno específico.
- Con dos estudios, el segundo muestra **tendencia** correcta respecto al primero; el primero, `null`.
- Archivo de más de 10 MB → **413**. Tipo no permitido → **415**.
- Un nombre de archivo con `../` **no escapa** del directorio del almacén.
- `GET /api/archivos/:id` de otra clínica → **404**.
- Estudio de un paciente ajeno para un `nutricionista` → **404** en todos los verbos.
- Cargar laboratorios **sin snapshot** funciona; enlazarlos a uno del mismo paciente también; a uno de otro paciente → **400**.
- Los archivos **sobreviven a `docker compose down && up`**.

---

## Prompt para Claude Code (pégalo en `c:\nutrismart`)

```
Lee CLAUDE.md, docs/REBANADA-05.md, docs/PRUEBAS.md, la épica
docs/epicas/Epica_CLI_Gestion_Clinica.html (CLI-04) y el código de las
rebanadas 1 a 4. Implementa la Rebanada 5 en pasos verificables:

1) Migración 007: catálogo de biomarcadores con semilla, rangos por clínica
   y sexo, lab_estudio, lab_resultado y archivo. Rango único por
   (clinica, biomarcador, sexo).
2) Almacén de archivos detrás de una interfaz AlmacenArchivos, con
   implementación local sobre un volumen declarado en el compose. Validar
   tipo por contenido, limitar tamaño y NUNCA usar el nombre original como
   ruta. Descarga con Content-Disposition: attachment.
3) API acotando por clínica y por alcance: catálogo con rangos, subida,
   previsualización de CSV que no persiste, alta de estudio, listado con
   estado y tendencia, y descarga.
   El estado se CALCULA al leer, nunca se almacena.
4) Frontend: pestaña Laboratorios, carga en dos pasos con revisión del CSV,
   tabla con estado y tendencia, y tarjeta de últimos laboratorios en el
   Resumen.
5) Verifica los criterios de aceptación contra la API real y añade cada
   prueba a docs/PRUEBAS.md en el mismo commit.
```
