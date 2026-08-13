# NutriSmart · Rebanada 6 — White-label por clínica

**Objetivo:** que cada clínica configure su nombre, su logo y sus colores, y que el cambio se refleje en toda la aplicación sin recargar. Materializa **CLI-06**.

**Depende de:** Rebanada 1 (auth, tenancy, design system) y Rebanada 5, cuyo almacén de archivos se reutiliza para el logo.

---

## Alcance

**Incluye:**
- Migración `008`: `brand_config`, una fila por clínica.
- `GET/PUT /api/brand` y `GET/PUT/DELETE /api/brand/logo`.
- `BrandContext` que escribe los tokens del design system en `:root`.
- Pantalla de ajustes de marca con vista previa, solo para `admin_clinica`.
- Primera puerta por rol en la interfaz: la sección Configuración.

**NO incluye:** imagen del panel de acceso ni banner del dashboard (la épica los menciona, pero no hay pantalla propia de login: Keycloak redirige), branding del PDF (**CLI-05**, que aún no existe), app del paciente, y subdominio por clínica —la columna ya está en `clinica` desde la 001, pero enrutar por él es trabajo de infraestructura, no de esta rebanada.

---

## Decisiones tomadas

1. **Se reescriben los tokens existentes, no se inventan variables nuevas.** `tokens.css` ya declara `--primary`, `--primary-hover`, `--primary-tint` y `--ring` como el punto de re-tematización, y el preset de Tailwind mapea `bg-primary`, `text-primary` y `border-primary` contra ellas. Un juego paralelo de variables habría dado una pantalla de ajustes cuya vista previa cambia mientras el resto de la aplicación se queda igual: la funcionalidad *parecería* terminada y no lo estaría.

2. **Solo se guarda el color primario; el resto se deriva.** `--primary-hover` y `--primary-tint` se calculan moviendo la luminosidad en HSL. Pedirle a un administrador tres colores coordinados es pedirle que haga de diseñador, y el resultado habitual son combinaciones ilegibles.

   Se opera en HSL y no en RGB porque restar a cada canal desatura: un verde intenso con un 12 % menos de cada componente sale gris verdoso, no verde oscuro.

3. **Los estados clínicos y los colores de gráfica NO se re-tematizan.** Se leen como un semáforo. Si "alerta" fuese ámbar en una clínica y morado en otra, la lectura rápida —que es justo para lo que sirve el color en una ficha— dejaría de funcionar. La pantalla de ajustes muestra un badge de alerta fijo junto a la vista previa para que la regla se vea, no solo se documente.

4. **SVG no se admite como logo**, aunque sea el formato natural de un logotipo. Un SVG puede llevar `<script>` dentro, y este endpoint sirve el contenido **inline** desde el origen de la API: aceptarlo sería XSS almacenado ejecutándose con la sesión del profesional ya abierta. Es la misma razón por la que `almacen/deteccion.ts` lo excluye para los archivos clínicos.

5. **El logo se sirve inline; los archivos clínicos, como descarga.** Es la excepción a la regla de la Rebanada 5, y por eso su lista blanca es *más* estrecha (PNG, JPEG, WebP) en vez de más ancha.

6. **La lectura de marca es pública.** Un `<img>` no puede enviar la cabecera `Authorization`, así que un logo que exigiera token no se podría pintar. La clínica viaja como `?clinica=<uuid>`. Lo que queda expuesto es identidad visual —lo mismo que hay impreso en el membrete de la clínica—, nunca dato clínico.

7. **No se siembra una fila por clínica.** Sin fila, la API responde los valores por defecto. Sembrarlas haría indistinguible una clínica que nunca configuró nada de otra que eligió exactamente esos colores, y "restaurar valores por defecto" no tendría nada que borrar.

8. **Los defaults de la API son los de `tokens.css`.** Si difirieran, activar esta rebanada cambiaría el aspecto de todas las clínicas que no han configurado nada — un cambio visual masivo como efecto secundario de desplegar.

9. **El contraste se avisa, no se impide.** Los botones pintan texto blanco sobre el primario; con un primario claro el texto deja de leerse (blanco puro da un contraste de 1.00:1). La pantalla avisa por debajo de 4.5:1 y deja guardar igualmente: bloquear rechazaría colores corporativos legítimos, y la marca es de la clínica. Misma postura que con la IA — se informa, decide la persona.

   La comprobación vive en `lib/color.ts` junto a la derivación, fuera de `BrandContext`, para poder ejercitarse sin un DOM. Ver T6-11.

---

## Modelo de datos

### `brand_config`
`clinica_id` (único), `nombre_app`, `logo_ruta`, `logo_mime`, `color_primario`, `color_acento`, `created_at`, `updated_at`.

`logo_ruta` es la ruta **opaca** del almacén, no una URL: el navegador nunca la ve, porque el logo se sirve por `/api/brand/logo`. Mismo criterio que `archivo.ruta_relativa` — pasar de disco a S3 no debe tocar filas.

`logo_mime` se guarda para no volver a olfatear el contenido en cada descarga.

Restricciones en la base, no solo en la API: los colores contra `^#[0-9a-fA-F]{6}$`, el nombre entre 1 y 80 caracteres, y `logo_ruta`/`logo_mime` o ambos nulos o ambos presentes. Un color mal formado que llegue al CSS no rompe un campo: rompe el tema entero.

`updated_at` lo mantiene el disparador `set_updated_at()` que ya existe desde la 003 — de ahí que la columna se llame así y no `actualizado_en`: la función escribe en `new.updated_at`.

---

## Contrato de API

### `GET /api/brand?clinica=<uuid>` — público
```json
{ "nombreApp": "Clínica Vida", "logoUrl": "/api/brand/logo?clinica=…",
  "colorPrimario": "#7c3aed", "colorAcento": "#f59e0b",
  "tieneLogo": true, "version": "2026-08-13T17:14:25.361Z" }
```
Sin fila, o sin `?clinica` válido, responde los valores por defecto en vez de un error: quien pinta la pantalla todavía no sabe a qué clínica pertenece el visitante, y un 400 ahí dejaría la aplicación sin tema en lugar de con el genérico.

`version` es la marca del último cambio. El frontend la cuelga del `<img>` como `?v=` para que un logo nuevo se vea al instante; sin eso, el administrador guardaría, no vería nada distinto y volvería a guardar.

### `GET /api/brand/logo?clinica=<uuid>` — público, inline
`Content-Type` del tipo detectado al subir, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=300` y `ETag`.

### `PUT /api/brand` — solo `admin_clinica`
Acepta `nombreApp`, `colorPrimario` y `colorAcento`, todos opcionales: un `PUT` que solo trae el color no borra el nombre.

### `PUT /api/brand/logo` — solo `admin_clinica`
`multipart/form-data`, campo `logo`. **413** por encima de 512 KB, **415** si el contenido no es PNG, JPEG o WebP. Reemplazar el logo borra el anterior del almacén.

### `DELETE /api/brand/logo` — solo `admin_clinica`
**204**, también si no había logo: el estado final es el que pidió el cliente. Los colores y el nombre no se tocan.

---

## Frontend (app profesional)

- **`BrandProvider`** dentro del árbol autenticado, alimentado por el `tenant_id` del token. Escribe los tokens en `:root` al cargar y en cada `refrescar()`.
- **Shell**: logo de la clínica o, si no hay, la inicial del nombre sobre el color primario. El nombre estático "NutriSmart" pasa a ser `brand.nombreApp`.
- **Configuración** deja de estar apagada en el menú lateral, pero **solo para `admin_clinica`**. Para un nutricionista sigue como las secciones que no existen: enseñarle un enlace que la API va a rechazar con 403 es prometer algo que no puede hacer.
- **`/ajustes/marca`**: nombre, dos selectores de color con campo hexadecimal, carga de logo con vista previa y borrado, vista previa de la barra y los botones, guardar y restaurar valores por defecto.
- El guardado son **dos peticiones** —campos por JSON y logo por multipart—: cambiar un color no debe obligar a resubir la imagen.

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 6 (T6-01 … T6-09).

- Clínica sin configurar → defaults, sin fila en la base.
- `PUT` como `admin_clinica` → 200; el `GET` posterior lo refleja.
- `PUT` como `nutricionista` → **403**. Sin token → **401**.
- Color que no es `#rrggbb`, o nombre vacío → **400**.
- Logo PNG → se sirve **byte a byte idéntico**, con `Content-Type: image/png`.
- SVG → **415**. Texto disfrazado de `.png` → **415**. 600 KB → **413**.
- Reemplazar el logo **borra el anterior del disco**.
- `DELETE` → 204, el logo devuelve 404 y **los colores se conservan**.
- Marca de otra clínica → defaults; su logo → **404**.
- Cambiar el color primario tiñe la aplicación entera **sin recargar**.
