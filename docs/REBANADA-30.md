# NutriSmart · Rebanada 30 — Biblioteca con portadas y archivos

**Objetivo:** que un recurso pueda ser un enlace o un archivo de verdad, y que todos puedan llevar imagen de portada. Materializa **BIB-01**.

**Migración 035.**

---

## No se montó MinIO, y esa es la decisión de la rebanada

El encargo añadía dos contenedores (MinIO y su inicializador), la dependencia `@aws-sdk/client-s3`, cinco variables de entorno, y hablaba con S3 directamente desde las rutas de la biblioteca.

El proyecto **ya guarda archivos** desde la Rebanada 5: los informes de laboratorio. Tiene tabla `archivo` con nombre original, mime, tamaño, sha256 y clínica; endpoints de subida y descarga; `@fastify/multipart` registrado; y un volumen Docker.

Montar S3 solo para la biblioteca habría dejado **dos sistemas de archivos** en la misma aplicación: los informes clínicos en disco y el material educativo en S3. Dos copias de seguridad, dos formas de borrar, dos sitios donde mirar cuando algo no aparece.

Y no hacía falta, porque ese módulo ya se escribió pensando en esto. Su propia nota lo dice:

> «El código de negocio importa `almacen` y nunca una implementación concreta. **Cambiar a S3 es añadir una clase que cumpla la interfaz** y elegirla aquí; ni las rutas ni los repositorios se enteran.»

Migrar a S3 sigue siendo legítimo —`CLAUDE.md` apunta a AWS— pero es **una rebanada propia que mueve todos los archivos a la vez**, implementando `AlmacenS3` detrás de la interfaz que ya existe. No media función de biblioteca abriendo un camino paralelo.

Lo que se hereda al reutilizarlo, y habría que rehacer con S3:

| | |
|---|---|
| Tipo detectado por **firma de bytes** | Renombrar un `.exe` a `.pdf` no cuela |
| SVG rechazado a propósito | Admite `<script>`: es HTML disfrazado |
| El nombre original **nunca toca el disco** | La ruta la genera el almacén |
| Descarga forzada, `nosniff`, `no-store` | Un HTML servido desde nuestro origen sería XSS |
| sha256 y tamaño registrados | Deduplicación y auditoría |

---

## La descarga del paciente no usa URL prefirmada

El encargo servía el archivo con una URL de S3 firmada, válida cinco minutos. Aquí pasa por la API, y no solo por evitar el segundo almacén: **cada descarga vuelve a comprobar el permiso**.

Una URL prefirmada, una vez emitida, la abre cualquiera que la reciba durante su ventana. Estos son documentos de salud de una clínica concreta.

La ruta es propia del paciente y no reutiliza `/api/archivos/:id`, que resuelve el alcance por profesional. Aquí la pregunta es otra —¿este archivo cuelga de un recurso **publicado** de **su** clínica?— y se responde en la propia consulta, uniendo por `recurso`. Un id de archivo suelto no abre nada.

---

## Otras decisiones

### El tipo manda, y la base lo sostiene

`texto`, `enlace` o `archivo`. Un `CHECK` obliga a que cada uno traiga lo suyo y **nada de lo demás**: sin eso cabría un recurso de tipo archivo sin archivo, que en la pantalla del paciente es un botón de descarga que no descarga.

`contenido` deja de ser obligatorio —un PDF se explica con el título— pero sigue siéndolo para los de tipo texto.

### Solo `https://`, en portada y en enlace

Los dos valores acaban en la aplicación del paciente: uno en el `src` de un `<img>`, el otro en un `href`. Se rechazan `http://`, `data:` y `javascript:`. Mismo criterio que la foto de perfil de la R25.

Los enlaces externos llevan `rel="noopener noreferrer"`: sin eso la página de destino puede manipular la pestaña de origen y ve de dónde viene el paciente.

### La portada se esconde entera si falla

Media tarjeta rota llama más la atención que una tarjeta sin foto.

### Se dice qué va a pasar antes de tocar

En la lista, un recurso avisa si es «enlace externo» o «archivo para descargar». Abrir otra web y bajar un archivo son cosas distintas, y en un móvil con datos contados importa saberlo antes.

### El archivo se sube antes de guardar el recurso

Por separado, para que el servidor pueda rechazarlo por tipo o tamaño sin que se pierda lo ya escrito en el formulario.

---

## El fallo que apareció al probar

La primera subida devolvió **500 `EACCES`**: el contenedor no podía crear la carpeta en `/datos/archivos`.

Docker crea el punto de montaje del volumen como `root` si no existe, y la API corre como `node` (uid 1000). **Estaba roto también para los informes de laboratorio** — nadie había subido un archivo desde que se recreó el volumen.

Arreglado en el Dockerfile (`mkdir` y `chown` antes de bajar de privilegios) y corregido el volumen existente una vez, que conservaba el dueño antiguo.

---

## Otros ajustes contra el código real

| Asumido | Real |
|---|---|
| Tabla `recurso_educativo` | `recurso` (R24) |
| MinIO + `@aws-sdk/client-s3` | El módulo `almacen` de la R5 |
| URL prefirmada con TTL | Descarga por la API, con permiso comprobado |
| Enum `recurso_tipo` ya existente | No existía; se crea |
| `apps/api/.env` | El `.env` vive en la raíz del repo |

---

## Contrato de API

| Método | Ruta | Nota |
|---|---|---|
| `POST` | `/api/archivos` | Ya existía (R5). Se reutiliza para subir |
| `POST` `PATCH` | `/api/recursos` | Ahora con `tipo`, `imagenPortadaUrl`, `urlExterna`, `archivoId` |
| `GET` | `/api/paciente/recursos/:id/archivo` | **Nueva.** Descarga con permiso comprobado |

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 30.
