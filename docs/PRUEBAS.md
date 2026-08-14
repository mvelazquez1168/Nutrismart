# NutriSmart · Catálogo de pruebas

Registro de **toda verificación ejecutada** contra el sistema real, rebanada por rebanada. Los documentos `REBANADA-0X.md` dicen *qué* debe cumplirse; este dice **cómo se comprobó y qué se obtuvo**.

Base del futuro manual de capacitación y funcionamiento. Cada entrada es reproducible: si algo deja de dar el resultado esperado, hay una regresión.

> **Regla:** toda prueba nueva se añade aquí en el mismo commit que el código que valida.

---

## Cómo levantar el entorno

```bash
docker compose -f infra/docker-compose.dev.yml up -d db   # Postgres en el 5434
npm install                                                # raíz, workspaces
npm run migrate                                            # aplica lo pendiente
npm run seed                                               # datos de desarrollo
npm run dev:api                                            # API en el 4001
npm run dev:web                                            # Vite en el 5173
```

**Credenciales de desarrollo:** `ana@vida.cr` / `nutrismart-dev` (realm `nutrismart`).

Obtener un token para probar la API a mano:

```
POST http://localhost:8080/realms/nutrismart/protocol/openid-connect/token
  client_id=nutrismart-web  grant_type=password
  username=ana@vida.cr      password=nutrismart-dev
```

---

## Recrear usuarios de desarrollo

**`infra/keycloak/realm-nutrismart.json` NO contiene los usuarios.** El endpoint `partial-export` de Keycloak exporta realm, clientes, roles y mappers, pero **nunca usuarios ni credenciales**. Importar ese JSON deja el realm funcional y sin nadie con quien iniciar sesión.

Por eso los comandos de abajo son la única fuente para recrearlos. Si se pierden, hay que deducir la configuración del realm a mano.

### 1 · Autenticar el CLI de administración

La sesión dura pocos minutos: conviene ejecutar el resto seguido.

```
docker exec -it keycloak /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 --realm master --user admin
```

### 2 · Usuario administrador de clínica

Crear `/tmp/user-ana.json` dentro del contenedor con:

```json
{ "username": "ana@vida.cr", "enabled": true, "emailVerified": true,
  "email": "ana@vida.cr", "firstName": "Ana", "lastName": "Rodriguez",
  "attributes": { "tenant_id": ["11111111-1111-1111-1111-111111111111"] } }
```

```
kcadm.sh create users -r nutrismart -f /tmp/user-ana.json
kcadm.sh set-password -r nutrismart --username ana@vida.cr --new-password nutrismart-dev
kcadm.sh add-roles   -r nutrismart --uusername ana@vida.cr --rolename admin_clinica
```

### 3 · Usuario nutricionista

Igual, con `luis@vida.cr` / Luis Peralta, **el mismo `tenant_id`** y:

```
kcadm.sh add-roles -r nutrismart --uusername luis@vida.cr --rolename nutricionista
```

Sin este segundo usuario **la visibilidad por profesional no se puede probar**: Ana es administradora y ve toda la clínica igualmente, así que la regla resultaría indistinguible de no tener regla.

### 4 · Capturar los `sub` y llevarlos al `.env`

Keycloak 26 **genera el id del usuario e ignora uno fijado**, así que el `sub` cambia en cada recreación. Pedir un token y decodificar el payload:

```
POST http://localhost:8080/realms/nutrismart/protocol/openid-connect/token
  client_id=nutrismart-web  grant_type=password
  username=<usuario>        password=nutrismart-dev
```

Copiar cada `sub` al `.env` de la raíz:

```
DEV_KEYCLOAK_SUB=<sub de ana>          # admin_clinica
DEV_KEYCLOAK_SUB_NUTRI=<sub de luis>   # nutricionista
```

El seed los sustituye en `${DEV_KEYCLOAK_SUB}` y `${DEV_KEYCLOAK_SUB_NUTRI}`, así que **basta con volver a correr `npm run seed`**: el SQL no se toca.

### 5 · Comprobación

Token de `luis@vida.cr` → el payload debe traer `tenant_id`, el rol `nutricionista` y **no** `admin_clinica`.

### Si añades más configuración al realm

Reexportar y versionar:

```
kcadm.sh create realms/nutrismart/partial-export \
  -q exportClients=true -q exportGroupsAndRoles=true -o
```

Los flags van con **`-q`** (parámetros de query), no con `-s`: con `-s` viajan en el cuerpo, Keycloak los ignora y el export sale **sin clientes ni roles** sin dar ningún error.

---

## Datos de referencia del seed

| Clínica | Paciente | Exp. | Estado clínico | Sirve para probar |
|---|---|---|---|---|
| Nutrición Vida | María Fernández | 1 | normal | Badge verde |
| Nutrición Vida | Juan Ramírez | 2 | alerta | Badge ámbar · **2 controles con tendencias** |
| Nutrición Vida | Ana Castro | 3 | critico | Badge rojo |
| Control Nutricional | *NO DEBE APARECER* — Pedro Solano | 1 | critico | **Control negativo de aislamiento** |
| Control Nutricional | *NO DEBE APARECER* — Lucía Vargas | 2 | alerta | **Control negativo de aislamiento** |

Los dos últimos existen **solo** para detectar fugas entre clínicas: si aparecen en cualquier pantalla usando el token de la Clínica Nutrición Vida, hay un fallo de aislamiento. Su profesional no tiene `keycloak_user_id`, así que nadie puede iniciar sesión como ellos.

---

# Rebanada 1 · Walking skeleton

### 1.1 · Migraciones idempotentes
Correr `npm run migrate` dos veces seguidas.
**Esperado:** la primera aplica; la segunda imprime `= ...(ya aplicada, se omite)` para cada una y *"Nada que aplicar"*. La tabla `schema_migrations` conserva las marcas de tiempo originales.

### 1.2 · Seed idempotente
Correr `npm run seed` dos veces.
**Esperado:** mismos recuentos. Diagnósticos y alergias **no se duplican** (4 y 3).

### 1.3 · Salud real de la API
`GET /health` sin token.
**Esperado:** `{"status":"ok","db":{"status":"up","latencyMs":N}}`. Con la base caída, **503** y `db.status = down` con el motivo. Un `/health` que responde `ok` sin consultar Postgres miente justo cuando más importa.

### 1.4 · Token con los tres claims críticos
Pedir token y decodificar el payload.
**Esperado:**
- `iss` = `http://localhost:8080/realms/nutrismart` — **literal**, coincidiendo con `KEYCLOAK_ISSUER`
- `aud` contiene `nutrismart-api`
- `tenant_id` = `11111111-1111-1111-1111-111111111111`

### 1.5 · Identidad del profesional
`GET /api/me` con token.
**Esperado:** Dra. Ana Rodríguez, rol `admin_clinica`, Clínica Nutrición Vida.

### 1.6 · Listado acotado al tenant
`GET /api/pacientes`.
**Esperado:** exactamente **3** pacientes, pese a haber 5 en la base.

### 1.7 · Sin token
`GET /api/pacientes` sin cabecera.
**Esperado:** **401** `{"error":"unauthorized"}`.

### 1.8 · Filtro por estado clínico
`?estadoClinico=alerta` → solo Juan.
`?estadoClinico=xxx` → **400** con la lista de valores válidos, no un 500.

### 1.9 · Aislamiento multi-tenant
Buscar por nombre a los pacientes de la clínica B: `?search=Pedro`, `Lucía`, `Vargas`, `Solano`.
**Esperado:** **0 resultados** en los cuatro. El filtro aguanta aunque se conozca el nombre exacto.

### 1.10 · Stack contenerizado completo
`docker compose -f infra/docker-compose.dev.yml up -d`
**Esperado:**
- API alcanza Postgres por el hostname `db`
- nginx sirve la SPA y **devuelve `index.html` en rutas profundas** (`/pacientes/<uuid>` recargado con F5)
- La API valida tokens descargando el JWKS por `keycloak:8080` **mientras compara el issuer contra `localhost:8080`**
- CORS concede permiso a `http://localhost:5173` y **no** a un origen ajeno

---

# Rebanada 2 · Alta, edición y baja

### 2.1 · Restricciones de la migración 003
Ejecutar en una transacción revertida:

| Prueba | Esperado |
|---|---|
| Expediente duplicado en la misma clínica | bloqueado |
| Mismo número en clínica distinta | permitido |
| `estado='baja'` sin `baja_fecha` | bloqueado |
| Baja con fecha y motivo | aceptada |
| `updated_at` avanza al editar | sí (**medir en transacciones separadas**: dentro de una, `now()` es constante) |
| Alergia duplicada | bloqueada |
| `documento_tipo` fuera del enum | rechazado |

### 2.2 · Alta válida
`POST /api/pacientes` con datos completos.
**Esperado:** **201** con `id`, `numeroExpediente` y `estado: activo`.

### 2.3 · Documento duplicado
Repetir el mismo `documentoNumero`.
**Esperado:** **409** `documento_duplicado`. No 400: la petición está bien formada; lo que choca es el estado del servidor.

### 2.4 · Alergias obligatorias
`POST` con `alergias: []`.
**Esperado:** **400** con `campo: "alergias"` y el mensaje *"Indica las alergias del paciente o marca Ninguna"*. Un campo vacío es una respuesta que nadie dio; "Ninguna" es una respuesta explícita, y en seguridad clínica la diferencia importa.

### 2.5 · Forma de las listas vacías
`GET /api/pacientes/:id` de un paciente sin diagnósticos.
**Esperado:** `"diagnosticos": []`, **nunca `null`**.

### 2.6 · Edición que persiste y reconcilia
`PUT` cambiando teléfono y sustituyendo la alergia "Ninguna" por "Lactosa"; luego `GET`.
**Esperado:** cambios reflejados **y en base**:
```
descripcion | activo
Lactosa     | t
Ninguna     | f      <- archivada, NO borrada
```

### 2.7 · Baja idempotente
`POST /api/pacientes/:id/baja` dos veces, con motivos distintos.
**Esperado:** la segunda **no pisa** `bajaFecha` ni `bajaMotivo`. El paciente desaparece de la lista pero sigue en la base con `estado=baja`.

### 2.8 · Aislamiento en los tres verbos
Con token de la clínica A contra un paciente de la B: `GET`, `PUT` y `POST /baja`.
**Esperado:** **404** en los tres, y el paciente de B intacto. Un 404 solo en lectura dejaría abierta la puerta a modificar datos ajenos. Se responde 404 y no 403 porque un 403 confirmaría que ese paciente existe en otra clínica.

---

# Rebanada 3 · Expediente y timeline

### 3.1 · Restricciones de la migración 004
En transacción revertida:

| Prueba | Esperado |
|---|---|
| Crear borrador | OK |
| **Segundo borrador del mismo paciente** | bloqueado (índice único parcial) |
| Cerrar sin `cerrado_at` | bloqueado |
| Cerrar con fecha | OK |
| **Snapshot que se corrige a sí mismo** | bloqueado (crearía un ciclo) |
| Métrica del catálogo | OK |
| Métrica repetida en el mismo snapshot | bloqueada |
| Métrica inexistente en el catálogo | bloqueada |
| Segunda nota en un snapshot | bloqueada |
| Antecedente duplicado | bloqueado |

### 3.2 · Catálogo de métricas
`GET /api/metricas`.
**Esperado:** 7 métricas ordenadas. **`imc` NO aparece**: se calcula, no se captura.

### 3.3 · Tendencias
`GET /api/pacientes/<juan>/expediente`.
**Esperado:** peso 91 (−4), cintura 104 (−4), glucosa 132 (−13), **IMC 29.7 (−1.3, derivado)**.

### 3.4 · Ausencia de tendencia
Expediente de un paciente con un solo control (Ana Castro).
**Esperado:** `delta: null` y `tendencia: null` — **distinto de 0**, que significaría "no cambió".

### 3.5 · IMC sin talla
Crear un control con peso pero **sin talla**.
**Esperado:** la métrica `imc` **no existe** para ese control. No se arrastra la talla de un control anterior: inventar una talla es inventar un IMC.

### 3.6 · Un solo borrador por paciente
`POST` de un segundo control estando otro en borrador.
**Esperado:** **409** `borrador_abierto`.

### 3.7 · Cotas de sensatez
`PUT` con `peso: 700`.
**Esperado:** **400** — *"Peso fuera de rango razonable (2–400 kg)"*. Son cotas contra erratas de tecleo, **no rangos clínicos de normalidad**.

### 3.8 · Inmutabilidad
Cerrar un control y luego intentar `PUT`.
**Esperado:** **409** `snapshot_inmutable`. La regla se aplica en el servidor, no escondiendo un botón.

### 3.9 · Cierre idempotente y `ultima_visita`
Cerrar dos veces; comprobar la lista de pacientes.
**Esperado:** `cerrado_at` no cambia en la segunda. `ultima_visita` toma la fecha del control **solo si es posterior** — `greatest()` evita retroceder al cerrar un control antiguo.
**Ojo al verificar:** si la fecha registrada ya era posterior, el valor no cambia y la prueba no demuestra nada. Usar un control con fecha posterior.

### 3.10 · Corrección versionada
`POST /api/snapshots/:id/corregir` sobre un cerrado.
**Esperado:** **201** con versión nueva en borrador y valores copiados. El original pasa a `corregido` y **sigue consultable**, plegado bajo su reemplazo en el timeline.

### 3.11 · Corregir un borrador
Mismo endpoint sobre un control en borrador.
**Esperado:** **409** `snapshot_no_cerrado` — *"edítalo directamente, no hace falta corregirlo"*. Aquí sí se detalla el motivo: el cliente ya está autorizado sobre el recurso, así que no revela nada, y es lo que el frontend necesita para explicarse.

### 3.12 · Aislamiento del expediente
Con token de la clínica A: expediente, timeline y creación de control sobre un paciente de la B.
**Esperado:** **404** en los tres.

---

# Rebanada 4 · Agenda y visibilidad por profesional

**Requiere los dos usuarios**: `ana@vida.cr` (`admin_clinica`) y `luis@vida.cr` (`nutricionista`). Reparto del seed: María es de Ana; Juan y Ana Castro, de Luis.

### 4.1 · Restricciones de la migración 006
En transacción revertida:

| Prueba | Esperado |
|---|---|
| Crear cita, `fin` derivado del inicio y la duración | OK |
| **Solape del mismo profesional** | bloqueado |
| **Misma franja, otro profesional** | permitido |
| Cita que empieza justo al terminar la anterior | permitida (rango semiabierto) |
| **Solapar con una cancelada** | permitido |
| Duración de 600 minutos | rechazada |
| `fin` se recalcula al cambiar la duración | OK |

### 4.2 · Visibilidad en el listado
`GET /api/pacientes` con cada usuario.
**Esperado:** Ana ve **3**; Luis ve **2**. Si ambos vieran lo mismo, la regla no estaría aplicándose.

### 4.3 · Visibilidad en los endpoints con `:id` de paciente
Luis pidiendo a María (paciente de Ana): detalle, expediente y timeline.
**Esperado:** **404** en los tres. Con sus propios pacientes, **200**. Ana, por ser administradora, **200** en los de Luis.

### 4.4 · Visibilidad en las rutas de snapshot
Luis contra un snapshot de María: `GET`, `PUT`, `/cerrar`, `/corregir`.
**Esperado:** **404** en los cuatro.

Es la prueba clave del retrofit: esas rutas **no reciben el paciente en la URL**, así que la regla se resuelve atando el snapshot al nutricionista de su paciente. Sin eso quedaría un agujero por el que pasa todo el historial clínico.

### 4.5 · Alta de cita y solapes
| Prueba | Esperado |
|---|---|
| Crear cita para paciente propio | **201** |
| Solaparse consigo mismo | **409 `cita_solapada`** con el `choque` |
| Misma franja, otro profesional | **201** |
| Agendar a un paciente ajeno | **404** |
| Duración de 600 minutos | **400** |

### 4.6 · Estados
`programada → completada` y `programada → cancelada` → **200**.
`completada → programada` → **409 `transicion_invalida`**. Reabrir una cita cerrada falsearía el registro.

### 4.7 · Edición solo de citas programadas
Editar una `completada` o una `cancelada` → **409 `cita_no_editable`**, con `estadoActual` para distinguirlas. Una `programada` sigue editándose con **200**.

### 4.8 · Ida y vuelta de fechas
Leer una cita y **reenviar su propio `inicio` sin tocarlo** en un `PUT`.
**Esperado:** **200**, no un 400 de validación.

Parece trivial y no lo es: es exactamente lo que hace el formulario de edición al cargar y guardar. Ver el tropiezo del formato `OF` más abajo.

### 4.9 · Control clínico desde la cita
| Prueba | Esperado |
|---|---|
| `POST /api/citas/:id/control` sobre una completada | **201**, snapshot en borrador con la **fecha de la cita** y enlazado en `snapshot_id` |
| Repetir | **409 `control_ya_registrado`** |
| Sobre una no completada | **409 `cita_no_completada`** |
| Con el paciente ya con un borrador abierto | **409 `borrador_abierto`** |

El último caso es el más interesante: es la restricción de la Rebanada 3 aplicándose **a través** de la agenda. Que una regla escrita para otra funcionalidad frene esta es lo que debe pasar.

---

# Rebanada 6 · White-label por clínica

**Requiere los dos usuarios**: `ana@vida.cr` (`admin_clinica`) y `luis@vida.cr` (`nutricionista`).

La clínica de referencia es `11111111-1111-1111-1111-111111111111` (Nutrición Vida); la de control, `99999999-9999-9999-9999-999999999999` (Control Nutricional).

### T6-01 · Clínica sin configurar → valores por defecto
`GET /api/brand?clinica=<vida>` **sin cabecera `Authorization`**, con `brand_config` vacía.

**Esperado:** **200** con `#0E7C66` / `#0EA5E9`, `nombreApp: "NutriSmart"`, `tieneLogo: false`, `version: "defaults"`. Sin fila creada en la base.

Sin `?clinica`, la misma respuesta. Es deliberado: quien pinta la pantalla todavía puede no saber a qué clínica pertenece el visitante, y un 400 la dejaría sin tema en vez de con el genérico.

### T6-02 · Guardar como administradora
`PUT /api/brand` con token de Ana y `{"nombreApp":"Clinica Vida","colorPrimario":"#7c3aed","colorAcento":"#f59e0b"}`.

**Esperado:** **200** con los valores guardados y una `version` con marca de tiempo real.

### T6-03 · La lectura refleja lo guardado
`GET /api/brand?clinica=<vida>` sin token.

**Esperado:** los valores de T6-02. Una sola fila en `brand_config` por muchos `PUT` que se hagan — lo garantiza `UNIQUE (clinica_id)`.

**Actualización parcial:** `PUT` con solo `{"colorPrimario":"#123456"}` **no borra** `nombreApp` ni `colorAcento`.

### T6-04 · Un nutricionista no configura la clínica
`PUT /api/brand` con token de Luis.

**Esperado:** **403 `solo_admin_clinica`**. Sin token: **401**.

Es la primera puerta por rol del proyecto. El rol se comprueba contra el profesional activo de la clínica, no solo contra el claim del token.

### T6-05 · Validación
| Prueba | Esperado |
|---|---|
| `colorPrimario: "rojo"` | **400** |
| `nombreApp: "   "` | **400** |
| Color con 3 dígitos (`#abc`) | **400** |

La base repite la comprobación con un `CHECK`: un hexadecimal mal formado no rompe un campo, rompe el tema entero.

### T6-06 · Subir el logo
`PUT /api/brand/logo` con token de Ana, `multipart/form-data`, campo `logo`, un PNG.

**Esperado:** **200** con `tieneLogo: true` y `logoUrl` apuntando a `/api/brand/logo?clinica=…`.

### T6-07 · El logo se sirve inline y sin alterar
`GET /api/brand/logo?clinica=<vida>` **sin token**.

**Esperado:** **200**, `Content-Type: image/png`, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=300` y `ETag`. El `sha256` del cuerpo coincide con el del archivo original.

Va público a propósito: un `<img>` no puede enviar `Authorization`, así que un logo con token no se podría pintar. Y va **inline**, al revés que los archivos clínicos de la Rebanada 5, que salen siempre como descarga.

### T6-08 · Lo que no se acepta como logo
| Archivo | Esperado |
|---|---|
| SVG con `<script>` dentro | **415 `tipo_no_permitido`** |
| Texto plano renombrado a `.png` | **415** |
| PNG válido de 600 KB | **413 `logo_demasiado_grande`** |

**SVG se rechaza aunque sea una imagen**, y aunque sea el formato natural de un logotipo. El logo se sirve inline desde el origen de la API: un SVG con `<script>` sería XSS almacenado ejecutándose con la sesión del profesional ya abierta.

El tipo se decide por el **contenido**, no por la extensión ni por el `Content-Type` que declara el cliente: los dos los controla quien sube el archivo.

### T6-09 · Reemplazo, borrado y aislamiento
| Prueba | Esperado |
|---|---|
| Subir un segundo logo | **200**; queda **un solo archivo** en el almacén — el anterior se borra |
| `DELETE /api/brand/logo` como Luis | **403** |
| `DELETE` como Ana | **204**; el archivo desaparece del disco |
| `GET /api/brand/logo` después de borrar | **404** |
| `DELETE` otra vez, sin logo | **204** (borrar lo que ya no está no es un error) |
| Colores y nombre tras borrar el logo | **intactos** |
| `GET /api/brand?clinica=<control>` | valores por defecto, no los de Vida |
| `GET /api/brand/logo?clinica=<control>` | **404** |

### T6-10 · El color tiñe la aplicación sin recargar
En `/ajustes/marca` con Ana: cambiar el color primario y guardar.

**Esperado:** la barra lateral, los botones, el elemento activo del menú y los badges tintados cambian **sin recargar la página**.

Es la prueba que distingue esta funcionalidad de una que solo lo aparenta: `BrandContext` escribe `--primary` y derivados en `:root`, que es lo que el preset de Tailwind ya mapea a `bg-primary`, `text-primary` y `border-primary` en toda la aplicación. Si en su lugar se hubieran inventado variables nuevas, la vista previa de la pantalla de ajustes cambiaría y el resto de la aplicación se quedaría igual.

**Control negativo:** el badge de estado clínico "alerta" **no cambia**. Los estados clínicos y los colores de gráfica se leen como un semáforo y no se re-tematizan.

**Comprobación estática que acompaña a esta prueba.** El modo de fallo real aquí no es que el navegador no repinte —una variable CSS reasignada repinta siempre—, sino que se escriba un token que nadie lee. Se cruzan las dos listas:

```bash
# Tokens que el CSS compilado consume
grep -o "var(--[a-z0-9-]*)" dist/assets/*.css | sed 's/.*var(//;s/)//' | sort -u
# Tokens que BrandContext escribe
grep -o "fijar(root, '--[a-z-]*'" src/contexts/BrandContext.tsx
```

`--primary`, `--primary-hover`, `--primary-tint` y `--ring` deben aparecer en **ambas**. Si una desaparece de la primera lista, alguien dejó de usar la clase de Tailwind correspondiente y ese trozo de interfaz ya no sigue la marca.

`--accent` **no** aparece en la lista del CSS compilado, y es correcto: hoy solo lo consume la vista previa de la propia pantalla, con estilo en línea, porque tiene que mostrar el color *sin guardar*. Queda declarado y disponible como `bg-accent` para el PDF (CLI-05) y la app del paciente.

Complemento útil: `grep -rE "#[0-9a-fA-F]{6}" src/components src/pages` debe salir **vacío**. Un hex suelto en un componente es una zona que el white-label no alcanza.

### T6-11 · Derivación de la paleta y contraste

De un solo color se derivan el hover, el tinte y el halo de foco (`src/lib/color.ts`). Ejercitado contra las 8 paletas curadas de `tokens.css` y cinco casos extremos:

| Color de partida | Primario | Hover | Tinte | Contraste tinte/primario | Contraste primario/blanco |
|---|---|---|---|---|---|
| Verde nutrición (defecto) | `#0E7C66` | `#084539` | `#e5f5f2` | 4.56 | **5.13** |
| Azul clínico | `#2563EB` | `#1249c1` | `#e5eaf5` | 4.29 | **5.17** |
| Teal fresco | `#0891B2` | `#056177` | `#e5f2f5` | 3.22 | 3.68 |
| Esmeralda | `#059669` | `#035b40` | `#e5f5f0` | 3.35 | 3.77 |
| Índigo | `#4F46E5` | `#271dd0` | `#e6e5f5` | 5.06 | **6.29** |
| Coral cálido | `#E11D48` | `#ab1637` | `#f5e5e9` | 3.86 | 4.70 |
| Ámbar | `#D97706` | `#9d5604` | `#f5eee5` | 2.77 | 3.19 |
| Grafito | `#334155` | `#1c242f` | `#e9ecf2` | 8.75 | **10.35** |
| Negro puro | `#000000` | `#000000` | `#ededed` | 17.94 | **21.00** |
| **Blanco puro** | `#FFFFFF` | `#e0e0e0` | `#ededed` | 1.17 | **1.00** |
| **Amarillo** | `#FFFF00` | `#c2c200` | `#f5f5e5` | 1.03 | **1.07** |
| Gris sin saturación | `#808080` | `#616161` | `#ededed` | 3.37 | 3.95 |
| Rojo puro | `#FF0000` | `#c20000` | `#f5e5e5` | 3.28 | 4.00 |

**Esperado en formato:** el hover siempre más oscuro que el primario (salvo negro, que ya no puede bajar), el tinte siempre casi blanco, y el halo un `rgba(...,0.35)` bien formado. Correcto en los 13 casos.

**Lo que esta prueba destapó.** Los botones pintan texto blanco sobre el primario. Con un primario claro el contraste se hunde: **blanco puro da 1.00 y amarillo 1.07** — texto literalmente invisible. Como CLI-06 deja elegir *cualquier* color, nada lo impedía.

La respuesta es un **aviso, no una validación**: la pantalla avisa cuando el contraste baja de 4.5:1 y deja guardar igualmente. Bloquear rechazaría colores corporativos legítimos, y la marca es de la clínica. Es la misma postura que con la IA: se informa, decide la persona.

Conviene saber que **cuatro de las ocho paletas curadas** ya estaban por debajo de 4.5:1 (teal, esmeralda, ámbar y, por poco, coral). No es una regresión de esta rebanada —vienen así de `tokens.css`— pero ahora el aviso las señala. Revisarlas es trabajo del design system, no de CLI-06.

---

# Rebanada 7 · Sociodemografía y consentimiento

**Requiere los dos usuarios**: `ana@vida.cr` (`admin_clinica`) y `luis@vida.cr` (`nutricionista`). El seed **no** trae sociodemografía, a propósito: así se prueba el ciclo entero desde cero.

La regla que gobierna todo el bloque: **sin consentimiento vigente la API no devuelve los datos**, aunque estén en la base. Ocultarlos en el navegador no valdría — cualquiera que mire la respuesta los vería.

### T7-01 · Invariantes del consentimiento en la base
En transacción revertida, sobre `paciente_sociodemografico`:

| Prueba | Esperado |
|---|---|
| `INSERT` con `consentimiento_otorgado = true` | `consentimiento_fecha` **se sella sola** |
| `UPDATE` de un campo cualquiera | la fecha del consentimiento **no se refresca** |
| `UPDATE` a `otorgado = false` | `fecha` y `profesional_id` quedan **NULL** |
| Tras revocar, los campos de contenido | **siguen ahí** |

El primer caso es el que importa. El disparador tiene que cubrir `INSERT` **y** `UPDATE`: solo con `UPDATE`, la primera vez que un profesional marca el consentimiento y guarda, la fila nace con `otorgado = true`, no hay `UPDATE`, y la fecha se queda nula — se estaría afirmando que hay consentimiento sin poder decir de cuándo.

La fecha la pone la base, no la API: es un dato con valor probatorio y no debe depender del reloj de quien llama.

### T7-02 · Sin fila: nada recolectado
`GET /api/pacientes/:id/sociodemografico` sobre un paciente recién sembrado.

**Esperado:** **200** con `consentimientoOtorgado: false`, `recolectado: false`, `datos: null`. Ninguna fila creada.

`recolectado` distingue "nunca se preguntó" de "se recogió y luego se revocó". Sin ese matiz, la interfaz no sabría si ofrecer *registrar* o explicar que hay datos ocultos.

### T7-03 · Guardar con consentimiento
`PUT` con `consentimientoOtorgado: true` y los ocho campos.

**Esperado:** **200**, `consentimientoFecha` con marca real y `datos` completos.

### T7-04 · Sin consentimiento no se ven datos
Revocar y volver a leer.

**Esperado:** `datos: null` y `recolectado: true`. En la base, `select ocupacion, horas_sueno` **sigue devolviendo los valores**.

### T7-05 · Revocar no borra, y volver a otorgar no resucita vacío
Este es el caso que la primera implementación tenía mal en las dos direcciones.

| Prueba | Esperado |
|---|---|
| `PUT {"consentimientoOtorgado": false}` — cuerpo mínimo, lo natural para revocar | los datos **siguen en la base** |
| `PUT {"consentimientoOtorgado": true}` — cuerpo mínimo, para volver a otorgar | los datos **reaparecen íntegros** |
| `PUT` con consentimiento **y** campos | reemplaza el bloque; los campos omitidos quedan nulos |

La regla que lo resuelve: **un PUT sin ningún campo de contenido es una operación de consentimiento y no toca los datos.** Con al menos un campo, reemplaza el bloque completo — que es como el formulario vacía una casilla.

Sin esa distinción, revocar con el cuerpo obvio borraba el expediente social entero, y volver a otorgarlo con un cuerpo igual de escueto lo borraba también. Borrar físicamente va contra la trazabilidad clínica del proyecto.

### T7-06 · Validación
| Prueba | Esperado |
|---|---|
| `horasSueno: 0` / `25` | **400** |
| `horasSueno: 7.5` | **400** — un decimal no se redondea en silencio |
| `personasEnHogar: 0` | **400** |
| `ocupacion` de 81 caracteres | **400** |
| `nivelActividad: "muy_intensa"` | **400** |
| Cuerpo **sin** `consentimientoOtorgado` | **400** — omitirlo no puede leerse como un "sí" |

El rango se repite en la base con un `CHECK`. La API valida para dar un mensaje por campo; la base valida para que nada entre por otra vía.

### T7-07 · Campos opcionales
`PUT` con consentimiento y un solo campo, el resto en blanco.

**Esperado:** **200** sin error. Todo el contenido es opcional a propósito: la épica pide minimización, y un campo obligatorio empuja a inventar un valor cuando el paciente no lo ha dicho. En la interfaz, "— Sin registrar" es una respuesta válida, no un marcador de posición.

### T7-08 · Aislamiento y alcance
| Prueba | Esperado |
|---|---|
| Ana sobre un paciente de la otra clínica | **404** |
| Luis (`GET`) sobre un paciente de Ana | **404** |
| Luis (`PUT`) sobre un paciente de Ana | **404** |
| Luis sobre un paciente **suyo** | **200** |
| Sin token | **401** |

**404, no 403.** La especificación pedía 403, pero el resto del proyecto responde 404 en este caso y está razonado en `pacientes/repositorio.ts`: distinguir "no existe" de "existe pero no es tuyo" le confirma a un profesional que cierto paciente está en la clínica. Un 403 aquí sería un oráculo de existencia sobre datos de pacientes ajenos.

El 403 sí se usa, pero para otra cosa: token válido cuyo usuario no tiene profesional en esa clínica.

### T7-09 · Toda fila lleva su clínica
`select clinica_id from paciente_sociodemografico` — ninguna nula.

La tabla la lleva aunque se pueda deducir por el paciente. Es la regla del proyecto: tenant en toda tabla y en toda consulta. Deducirlo por join significa que el día que alguien escriba una consulta sin ese join, la fuga entre clínicas no dará ningún error.

---

# Rebanada 8 · Dashboard administrativo

**Requiere los dos usuarios**: `ana@vida.cr` (`admin_clinica`) y `luis@vida.cr` (`nutricionista`).

Token y llamada base en PowerShell:

```powershell
$b = @{client_id='nutrismart-web'; grant_type='password'; username='ana@vida.cr'; password='nutrismart-dev'}
$TOKEN = (Invoke-RestMethod -Method Post -Body $b `
  -Uri "http://localhost:8080/realms/nutrismart/protocol/openid-connect/token").access_token

Invoke-RestMethod "http://localhost:4001/api/admin/dashboard?periodo=mes" `
  -Headers @{ Authorization = "Bearer $TOKEN" } | ConvertTo-Json -Depth 5
```

> Cuidado con el nombre de la variable: PowerShell **no distingue mayúsculas**, así que guardar un resultado en `$token` teniendo el JWT en `$TOKEN` lo sobrescribe y todo pasa a responder 401. Está documentado en Tropiezos de entorno.

### CA-08-01 · Estructura completa para la administradora
`GET /api/admin/dashboard?periodo=mes` con el token de Ana.

**Esperado:** **200** con `periodo`, `desde`, `hasta`, `generadoEn`, los ocho `kpis`, `agendaHoy` y `porProfesional`.

Contra el seed: **5 citas — 2 completadas, 1 cancelada, 2 pendientes**, 3 pacientes activos, 10 controles y 3 laboratorios.

### CA-08-02 · Solo el administrador
| Prueba | Esperado |
|---|---|
| Token de `luis@vida.cr` (nutricionista) | **403 `solo_admin_clinica`** |
| Sin cabecera `Authorization` | **401** |
| Token válido sin profesional en la clínica | **403 `profesional_no_encontrado`** |

Aquí el 403 **sí** es correcto, al revés que en las rutas con `:pacienteId`. Allí distinguir "no existe" de "no es tuyo" revela la existencia de pacientes ajenos; aquí el recurso es la clínica del propio solicitante, que ya conoce por su token.

### CA-08-03 · Las tres ventanas, en huso de Costa Rica
```powershell
foreach ($p in 'hoy','semana','mes') {
  $d = Invoke-RestMethod "http://localhost:4001/api/admin/dashboard?periodo=$p" -Headers @{Authorization="Bearer $TOKEN"}
  "{0,-7} {1}  ->  {2}" -f $p, $d.desde, $d.hasta
}
```

**Esperado**, un 13 de agosto:

| Período | Desde | Hasta |
|---|---|---|
| `hoy` | `2026-08-13T06:00:00Z` | `2026-08-14T06:00:00Z` |
| `semana` | `now() - 7 días` | `2026-08-14T06:00:00Z` |
| `mes` | `2026-08-01T06:00:00Z` | `2026-09-01T06:00:00Z` |

Las `06:00Z` son la clave: son las **00:00 en Costa Rica**. Si aparecieran a las `00:00Z`, la ventana se estaría calculando en UTC y el día empezaría a las 18:00 del día anterior en hora local.

Un `?periodo=xyz` cae en `mes`, no da 400.

### CA-08-04 · El período llega hasta su final
Las citas del seed están el **15 y el 21 de agosto**, es decir, en el futuro respecto al día 13.

**Esperado:** `periodo=mes` las cuenta — `citasTotal = 5`, `citasPendientes = 2`.

Esta es la prueba que motivó apartarse de la especificación de partida. Con la ventana cortada en `now()`, el resultado era `citasTotal = 0` teniendo cinco citas agendadas, y el KPI **Pendientes** no podía contar nada: una cita pendiente está, por definición, en el futuro.

### CA-08-05 · La agenda del día usa el huso de la clínica
En transacción revertida, mover una cita a las **23:30 hora de Costa Rica** (que en UTC es 05:30 del día siguiente) y contar de las dos formas:

```sql
begin;
update cita
   set inicio = (date_trunc('day', now() at time zone 'America/Costa_Rica') + interval '23 hours 30 minutes')
                at time zone 'America/Costa_Rica'
 where id = (select id from cita order by inicio limit 1);

select count(*) from cita   -- comparando en huso CR
 where (inicio at time zone 'America/Costa_Rica')::date = (now() at time zone 'America/Costa_Rica')::date;

select count(*) from cita   -- comparando en UTC
 where inicio::date = now()::date;
rollback;
```

**Esperado:** **1** con el huso de la clínica y **0** en UTC. La cita "de hoy" desaparecería con la comparación ingenua.

### CA-08-06 · Profesional sin citas
**Esperado:** los dos profesionales de la clínica aparecen en `porProfesional` aunque no tengan citas en el período, con `citasTotal: 0` y su recuento real de pacientes activos (Ana 1, Luis 2).

Su ausencia de actividad es justamente el dato que el administrador busca. Depende de que las condiciones de período vayan **dentro del `ON`** del `LEFT JOIN`: en el `WHERE` lo convertirían en un `INNER JOIN` silencioso y esas filas se perderían.

### CA-08-07 · Índices de la migración 010
```sql
select indexname from pg_indexes
 where indexname in ('idx_cita_clinica_inicio',
                     'idx_snapshot_clinica_created',
                     'idx_lab_estudio_clinica_created');
```

**Esperado:** las tres filas. La migración va **sin `CONCURRENTLY`**: el runner envuelve cada archivo en su propia transacción y `CREATE INDEX CONCURRENTLY` no puede ejecutarse dentro de una. Y **sin** el predicado `where activo = true`, porque esa columna no existe en ninguna de las tres tablas.

---

# Rebanada 9 · Plan alimentario

**Requiere los dos usuarios**: `ana@vida.cr` (`admin_clinica`) y `luis@vida.cr` (`nutricionista`). El seed **no** trae planes, a propósito: el ciclo se prueba entero desde cero.

Preparación en PowerShell:

```powershell
$b = @{client_id='nutrismart-web'; grant_type='password'; username='ana@vida.cr'; password='nutrismart-dev'}
$TOKEN = (Invoke-RestMethod -Method Post -Body $b `
  -Uri "http://localhost:8080/realms/nutrismart/protocol/openid-connect/token").access_token
$H = @{ Authorization = "Bearer $TOKEN" }
$API = "http://localhost:4001"
$MARIA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
```

> El token caduca en pocos minutos. Si empiezan a salir **401**, vuelve a pedirlo — y cuidado con reutilizar el nombre `$token`: PowerShell no distingue mayúsculas y lo sobrescribiría.

### CA-09-01 · Crear plan en borrador
```powershell
$plan = Invoke-RestMethod "$API/api/pacientes/$MARIA/planes" -Method Post -Headers $H `
  -ContentType "application/json" `
  -Body '{"nombre":"Plan de agosto","objetivo":"Bajar 0.5 kg por semana","fechaInicio":"2026-08-17","fechaFin":"2026-09-14"}'
$plan.estado   # borrador
```

**Esperado:** **201**, `estado: "borrador"`, y las fechas de vuelta como `AAAA-MM-DD` —no como instante—. Un plan nace siempre en borrador: activarlo es una decisión aparte y todavía no tiene ni una comida.

### CA-09-02 · Validación
| Prueba | Esperado |
|---|---|
| `nombre` vacío o de más de 120 caracteres | **400** |
| `fechaFin` anterior a `fechaInicio` | **400** |
| `diaSemana: 8` | **400** |
| `tipoComida: "brunch"` | **400** |
| `descripcion` vacía o solo espacios | **400** |
| `caloriasKcal: 0` | **400** (el `CHECK` exige > 0) |
| Dos comidas para el mismo día y momento | **400**, indicando qué celda |

El duplicado lo impediría igual el `UNIQUE` de la base, pero llegar hasta ahí devolvería un choque de índice en vez de un mensaje que diga qué celda repite.

### CA-09-03 · Cargar comidas y activar
```powershell
Invoke-RestMethod "$API/api/planes/$($plan.id)/comidas" -Method Put -Headers $H `
  -ContentType "application/json" `
  -Body '[{"diaSemana":1,"tipoComida":"desayuno","descripcion":"Avena con frutas","caloriasKcal":320},
          {"diaSemana":1,"tipoComida":"almuerzo","descripcion":"Arroz con pollo","caloriasKcal":580}]'
# planId + comidas: 2

Invoke-RestMethod "$API/api/planes/$($plan.id)/activar" -Method Put -Headers $H
# estado: activo
```

Activar dos veces devuelve **200** con el plan tal cual: reactivar lo que ya está activo no es un error, es que no hay nada que hacer.

**Orden de las comidas:** el `GET` las devuelve **desayuno antes que almuerzo**. Si salen alfabéticamente (almuerzo, cena, desayuno…) hay regresión: el `ORDER BY` estará resolviendo contra el alias `::text` en vez de contra la columna del enum.

### CA-09-04 · Un solo plan activo por paciente
Crear un segundo plan para el mismo paciente e intentar activarlo.

**Esperado:** **409 `plan_activo_existente`** — *"El paciente ya tiene un plan activo. Archívalo antes de activar este."*

Lo garantiza el índice parcial `idx_plan_activo_por_paciente`, no una comprobación previa en la API: dos peticiones a la vez pasarían las dos por cualquier `select`.

### CA-09-05 · Un plan archivado es inmutable
Archivar el plan activo y luego intentar editarlo:

| Prueba | Esperado |
|---|---|
| `PUT /comidas` | **409 `plan_archivado`** |
| `PUT` de cabecera | **409 `plan_archivado`** |
| `PUT /activar` | **409** — no se reactiva |
| `PUT /archivar` otra vez | **409** — ya lo está |

Es el registro de lo que se prescribió. Si volviera a ser editable, el historial dejaría de probar nada.

### CA-09-06 · Aislamiento y alcance
| Prueba | Esperado |
|---|---|
| Luis (`nutricionista`) sobre un plan de un paciente de Ana | **404** |
| Sin token | **401** |
| Plan inexistente | **404** |
| Luis sobre un plan de un paciente **suyo** | **200** |

**404, no 403.** El plan se ata al paciente y el paciente al nutricionista dentro de la misma consulta; sin ese join bastaría conocer el id del plan.

### CA-09-07 · Descartar solo borradores
| Prueba | Esperado |
|---|---|
| `DELETE` sobre un plan **activo** | **409 `plan_no_eliminable`** |
| `DELETE` sobre un **borrador** | **204** |
| El borrador tras el DELETE | Sigue en la base, con `estado = 'archivado'` |

Un plan que llegó a estar activo es historia clínica. Y ni siquiera el borrador se borra: se archiva.

### CA-09-08 · Guardar un plan vacío
```powershell
Invoke-RestMethod "$API/api/planes/$($plan.id)/comidas" -Method Put -Headers $H `
  -ContentType "application/json" -Body '[]'
# comidas: 0
```

**Esperado:** **200**. Vaciar la semana entera es una edición legítima, y el reemplazo total es lo que la hace expresable: con un guardado incremental no habría forma de decir "quita el almuerzo del martes".

### CA-09-09 · Macros opcionales
Crear una comida solo con `descripcion`, sin `caloriasKcal` ni gramos.

**Esperado:** **200**, con los macros a `null`. Obligarlos convertiría cada celda en un ejercicio de cálculo y el profesional acabaría inventando cifras para poder guardar.

---

# Rebanada 10 · Exportación del expediente a PDF

**Requiere los dos usuarios**: `ana@vida.cr` (`admin_clinica`) y `luis@vida.cr` (`nutricionista`).

Preparación en PowerShell:

```powershell
$b = @{client_id='nutrismart-web'; grant_type='password'; username='ana@vida.cr'; password='nutrismart-dev'}
$TOKEN = (Invoke-RestMethod -Method Post -Body $b `
  -Uri "http://localhost:8080/realms/nutrismart/protocol/openid-connect/token").access_token
$H = @{ Authorization = "Bearer $TOKEN" }
$API = "http://localhost:4001"
$MARIA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
```

> **Manda el cuerpo desde archivo si lleva acentos.** Pasar JSON con tildes en línea de comandos descuadra el `Content-Length` y la API responde **400 `FST_ERR_CTP_INVALID_CONTENT_LENGTH`** — un error que parece de la API y es del shell. En PowerShell, `-Body ([Text.Encoding]::UTF8.GetBytes($json))`; con curl, `--data-binary "@cuerpo.json"`.

### CA-10-01 · Generar el documento completo
```powershell
$json = '{"secciones":["perfil","plan","laboratorios","sociodemografico"],"notasProfesional":"Reducir sodio."}'
Invoke-WebRequest "$API/api/pacientes/$MARIA/pdf" -Method Post -Headers $H `
  -ContentType "application/json" -Body ([Text.Encoding]::UTF8.GetBytes($json)) `
  -OutFile "expediente.pdf"
Get-Item expediente.pdf | Select-Object Length
```

**Esperado:** **200**, archivo de decenas de KB que empieza por `%PDF-`. Cabeceras: `Content-Type: application/pdf`, `Content-Disposition` con `Expediente_<Paciente>_<AAAA-MM-DD>.pdf`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` y `X-Formato-Exportacion: pdf`.

Medido con el seed más un plan activo, un estudio de laboratorio y sociodemografía: **80 KB**.

### CA-10-02 · Contenido del documento
Volcando el HTML que alimenta al PDF, debe contener:

| Comprobación | Esperado |
|---|---|
| Banda de cabecera | `background: <color_primario de brand_config>` |
| Secciones | Información del paciente · Plan de alimentación · Resultados de laboratorio · Contexto social · Estrategia y recomendaciones |
| Filas del plan | **Solo los momentos con comida** — un plan de desayuno, almuerzo y cena no pinta seis filas |
| Estados de laboratorio | `estado normal` / `estado alterado`, con colores **fijos** |
| Diagnósticos y alergias | Como etiquetas, las alergias en ámbar |

Los estados clínicos **no** siguen la marca: un valor alterado se ve igual en pantalla, en papel y en cualquier clínica.

### CA-10-03 · Aislamiento y alcance
| Prueba | Esperado |
|---|---|
| Luis (`nutricionista`) exportando un paciente de Ana | **404** |
| Ana exportando un paciente de otra clínica | **404** |
| Sin token | **401** |
| Luis pidiendo el historial de un paciente ajeno | **404** |

El historial se acota sobre el **paciente**: quien no puede verlo tampoco puede saber cuántas veces se exportó su expediente.

### CA-10-04 · Historial de exportaciones
```powershell
Invoke-RestMethod "$API/api/pacientes/$MARIA/pdf/historial" -Headers $H | Format-Table
```

**Esperado:** las exportaciones de la más reciente hacia atrás, con `secciones`, `archivoNombre`, `archivoTamano`, `notasProfesional` y el profesional que firmó.

La traza se escribe **antes** de responder: si el registro falla, es preferible no entregar el documento a entregarlo sin constancia de que salió.

### CA-10-05 · Validación de secciones
| Prueba | Esperado |
|---|---|
| `{"secciones":[]}` | **400 `sin_secciones`** |
| `{"secciones":["perfil","inventada"]}` | **200** — la desconocida se descarta |
| `notasProfesional` de más de 3000 caracteres | **400** |

Descartar en vez de rechazar es deliberado: el juego de secciones va a crecer y un cliente algo desactualizado debe seguir exportando lo que sí entiende.

### CA-10-06 · El consentimiento manda también en el PDF
Con un paciente **sin** consentimiento sociodemográfico, pedir `["perfil","sociodemografico"]`.

**Esperado:** el documento sale sin esa sección. La comprobación está en la consulta (`consentimiento_otorgado = true`), no en la plantilla: si dependiera de la capa de presentación, bastaría un descuido para publicar datos que el paciente no autorizó.

### CA-10-07 · Reserva a HTML si Chromium no está
Forzando un Chromium inexistente:

```bash
PUPPETEER_EXECUTABLE_PATH=/ruta/que/no/existe npx tsx <script que llama a generar()>
```

| Entorno | Esperado |
|---|---|
| Chromium roto | `tipo: html`, empieza por `<!DOCTYPE html>` |
| Chromium disponible | `tipo: pdf`, empieza por `%PDF-1.4` |

Un documento clínico no debe quedar retenido por un problema de infraestructura. La respuesta lo declara en `X-Formato-Exportacion` y el modal lo dice en pantalla, en vez de entregar un archivo que el visor no abre.

### CA-10-08 · Solo el plan activo
Con un paciente que tenga un borrador y un plan activo, exportar con `["plan"]`.

**Esperado:** aparece el **activo**. Un borrador no se ha prescrito y un archivado ya no rige; exportar cualquiera de los dos como «el plan» mentiría.

---

# Rebanada 11 · Mensajería y notificaciones

**Requiere los dos usuarios**: `ana@vida.cr` (`admin_clinica`) y `luis@vida.cr` (`nutricionista`). El seed no trae conversaciones ni reglas: el ciclo se prueba desde cero.

```powershell
$b = @{client_id='nutrismart-web'; grant_type='password'; username='ana@vida.cr'; password='nutrismart-dev'}
$TOKEN = (Invoke-RestMethod -Method Post -Body $b `
  -Uri "http://localhost:8080/realms/nutrismart/protocol/openid-connect/token").access_token
$H = @{ Authorization = "Bearer $TOKEN" }
$API = "http://localhost:4001"
$MARIA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
```

## COM-01 · Mensajería

### CA-11-01 · Bandeja vacía
`GET /api/mensajeria/conversaciones` sin hilos → **`[]`**. La interfaz muestra «Aún no tienes conversaciones», no una tabla vacía.

### CA-11-02 · Abrir hilo, y una sola vez
```powershell
$conv = Invoke-RestMethod "$API/api/mensajeria/conversaciones" -Method Post -Headers $H `
  -ContentType "application/json" -Body "{`"pacienteId`":`"$MARIA`"}"
```
**Esperado:** **201** con la conversación. Repetir la llamada devuelve **el mismo `id`**: lo garantiza el índice único `(clinica_id, paciente_id, profesional_id)`, no una comprobación previa.

### CA-11-03 · Enviar mensaje
`POST …/mensajes` con `{"contenido":"…"}` → **201**, `autorTipo: "profesional"`. En pantalla, burbuja a la derecha sobre el color de marca.

### CA-11-04 · Abrir el hilo lo marca leído
Simular la respuesta del paciente —la app PAC aún no existe— insertando en la base:

```sql
insert into mensaje (clinica_id, conversacion_id, autor_tipo, autor_id, contenido)
values ('<clinica>','<conv>','paciente','<paciente>','Gracias doctora.');
update conversacion set ultimo_mensaje_at = now(),
       mensajes_no_leidos_prof = mensajes_no_leidos_prof + 1 where id = '<conv>';
```

| Paso | Esperado |
|---|---|
| `GET /api/mensajeria/no-leidos` | `{ total: 1 }` |
| `PUT …/leer` | `{ marcados: 1 }` |
| `GET /api/mensajeria/no-leidos` | `{ total: 0 }` |

Solo se marcan los mensajes **del paciente**: marcar los propios no significa nada.

### CA-11-05 · Sondeo
Con el hilo abierto en pantalla, insertar un mensaje del paciente como arriba.

**Esperado:** aparece en **≤ 5 segundos** sin recargar, el hilo baja al final y el contador se limpia solo. El sondeo pide `?desde=<último>`, no el hilo entero.

### CA-11-06 · Aislamiento
| Prueba | Esperado |
|---|---|
| Luis abre el hilo de Ana | **404** |
| Luis escribe en el hilo de Ana | **404** |
| Luis marca leído el hilo de Ana | **404** |
| Luis lista sus conversaciones | `[]` |
| Sin token | **401** |

**404, no el 403 de la especificación.** Un 403 sobre un identificador ajeno confirma que ese hilo existe, y con hilos de por medio eso equivale a confirmar que cierto paciente habla con cierto profesional. Un `admin_clinica` ve todos los pacientes pero **no** los hilos de sus compañeros.

### CA-11-07 · Validación del mensaje
| Contenido | Esperado |
|---|---|
| Vacío o solo espacios | **400** |
| 4001 caracteres | **400** |

El `CHECK` de la base repite el límite: la API valida para dar un mensaje claro; la base, para que nada entre por otra vía.

## COM-02 · Notificaciones

### CA-11-08 · Enviar un mensaje genera aviso
Tras `POST …/mensajes`, hay una fila en `notificacion` con `tipo='mensaje_nuevo'` y `destinatario_tipo='paciente'`.

**El contador del profesional sigue en 0**: el aviso es para el paciente. Se registra desde ya aunque la app PAC no exista, para no tener que reprocesar el histórico el día que exista.

### CA-11-09 · Contador de la campana
`GET /api/notificaciones/contador` → `{ noLeidas: N }`, coincidiendo con el badge.

### CA-11-10 · Marcar una como leída
`PUT /api/notificaciones/:id/leer` → **200**. Con `enlace`, la interfaz navega después de marcar.

Repetir la llamada devuelve **200** con `marcada: false`: marcar lo que ya estaba leído no es un error, el estado final es el pedido. Un id de otro destinatario **no** la marca — el destinatario va en el `WHERE`.

### CA-11-11 · Marcar todas
`PUT /api/notificaciones/leer-todas` → `{ actualizadas: N }`; el contador queda en **0**.

### CA-11-12 · Refresco sin recargar
La campana sondea cada **30 s**, no cada 5 como el hilo: una notificación no es una conversación en curso. Con la pestaña oculta no sondea.

## COM-03 · Reglas paramétricas

### CA-11-13 y CA-11-14 · Crear reglas
```powershell
Invoke-RestMethod "$API/api/notificaciones/reglas" -Method Post -Headers $H `
  -ContentType "application/json" `
  -Body '{"nombre":"Felicitacion de cumpleanos","tipo":"cumpleanos","parametros":{"hora":"09:00"}}'
```
**Esperado:** **201**, `activa: true`. Igual con `checkup` e `intervaloDias: 30`.

### CA-11-15 · Activar y desactivar
`PUT /reglas/:id/activar` con `{"activa":false}` → `{ activa: false }`. La regla **sigue en la lista**, atenuada: desactivar no es borrar, y una regla inactiva explica los avisos que ya generó.

`DELETE /reglas/:id` hace lo mismo — baja lógica, nunca borrado físico.

### CA-11-16 · Evaluación, y que no duplique
Poniendo el cumpleaños de un paciente en el día de hoy:

| Llamada | Esperado |
|---|---|
| 1.ª `POST /reglas/evaluar` | `{ generadas: 1 }` |
| 2.ª | `{ generadas: 0 }` |
| 3.ª | `{ generadas: 0 }` |

Esta es la prueba que más importa de COM-03. Sin `clave_dedup` y su índice único parcial, «Evaluar ahora» sería un botón para llenarse la campana de avisos repetidos. La garantía está en el índice, no en un `select` previo: dos evaluaciones simultáneas se colarían entre la comprobación y la inserción.

El día se compara en huso de Costa Rica: en UTC empieza a las 18:00 del día anterior y los cumpleaños se avisarían con un día de desfase.

### CA-11-17 · Parámetros inválidos
| Prueba | Esperado |
|---|---|
| `hora: "25:99"` | **400** |
| `tipo: "lunar"` | **400** |
| `checkup` con `intervaloDias: 3` | **400** (mínimo 7) |
| `reminder` con `diasAntes: 99` | **400** (máximo 30) |

Cada tipo tiene sus parámetros y no se aceptan otros. Guardar lo que venga en el JSONB parece flexible y es lo que hace que meses después el evaluador se encuentre una regla que no sabe ejecutar.

---

# Rebanada 13 · Valoración ABCD (contenedor, antropometría, bioquímica)

```powershell
$b = @{client_id='nutrismart-web'; grant_type='password'; username='ana@vida.cr'; password='nutrismart-dev'}
$TOKEN = (Invoke-RestMethod -Method Post -Body $b `
  -Uri "http://localhost:8080/realms/nutrismart/protocol/openid-connect/token").access_token
$H = @{ Authorization = "Bearer $TOKEN" }
$API = "http://localhost:4001"
$MARIA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
```

## EVAL-00 · Contenedor

### CA-13-01 a CA-13-03 · Crear consultas
```powershell
$c1 = Invoke-RestMethod "$API/api/pacientes/$MARIA/consultas" -Method Post -Headers $H
$c2 = Invoke-RestMethod "$API/api/pacientes/$MARIA/consultas" -Method Post -Headers $H
"$($c1.numeroConsulta) $($c1.tipo) / $($c2.numeroConsulta) $($c2.tipo)"
```

**Esperado:** `1 inicial / 2 seguimiento`. El ordinal se calcula **dentro del `INSERT`**: con un `count(*)` previo, dos consultas creadas a la vez tomarían el mismo número y la restricción única lo rechazaría con un error incomprensible.

### CA-13-04 · Progreso por sección
`PUT …/consultas/:id/seccion` con `{"seccion":"conclusion","completa":true}` → la consulta vuelve con `seccionesCompletas: {"antrop":true,"conclusion":true}`. En pantalla, la pestaña muestra el círculo relleno.

Una sección inventada devuelve **400** con la lista de válidas.

### CA-13-05 y CA-13-06 · Finalizar
| Prueba | Esperado |
|---|---|
| Finalizar sin conclusión | **409 `secciones_incompletas`** con `faltan: ["conclusion"]` |
| Finalizar con antropometría y conclusión | **200**, `estado: "finalizada"` |
| Finalizar dos veces | **409 `consulta_finalizada`** |
| Editar una sección de una finalizada | **409** |
| Registrar medidas en una finalizada | **409** |

La comprobación está en el servidor **además** del botón deshabilitado: el botón decide qué se ve, no qué se puede.

### CA-13-07 · Aislamiento
Luis (`nutricionista`) sobre una consulta de un paciente de Ana → **404**, no 403: un 403 sobre un identificador ajeno confirma que esa consulta existe.

## EVAL-01 · Antropometría

### CA-13-08 y CA-13-09 · Índices derivados
```powershell
Invoke-RestMethod "$API/api/pacientes/$MARIA/antropometria" -Method Post -Headers $H `
  -ContentType "application/json" `
  -Body "{`"consultaId`":`"$($c1.id)`",`"pesoKg`":78,`"tallaCm`":165,`"cinturaCm`":92,`"caderaCm`":104}"
```

**Esperado:** `imc: 28.65`, `icc: 0.885`.

78 / 1,65² = 28,65 — el criterio original decía 28,7, que es el mismo número redondeado a un decimal.

**Son columnas generadas en la base**, no valores que envíe el cliente: un índice que llegara desde fuera podría no corresponder con el peso y la talla de su propia fila.

### CA-13-10 · Grasa derivada en BIA
Enviando `pesoKg: 78` y `masaLibreGrasaKg: 52` sin porcentaje → `pctGrasa: 33.33`, `masaGrasaKg: 26`.

Solo se deriva lo que **no** viene: si el aparato dio un porcentaje, ese manda.

### CA-13-11 · Pliegues cutáneos
Con `lib/composicion.ts`, mujer de 42 años y pliegues 8/18/16/14 mm:

| Fórmula | Resultado |
|---|---|
| Durnin-Womersley, mujer 42 | 32,31 % |
| Durnin-Womersley, hombre 42 | 26,13 % |
| Jackson-Pollock, mujer 42 | 22,90 % |
| Jackson-Pollock, hombre 42 | 14,06 % |
| **Sin edad, sin sexo o con un pliegue ausente** | **`null`** |

El `null` es la parte importante: los coeficientes dependen del sexo y del tramo de edad, así que completarlos con valores por defecto daría un porcentaje con apariencia de dato. Mismo criterio que el `sin_referencia` de los laboratorios.

### CA-13-12 a CA-13-14 · Histórico y sección
- `GET /antropometria` devuelve de la más reciente hacia atrás, `limite` máximo 50.
- La gráfica aparece con **2 o más** mediciones que tengan masa magra y grasa; con una, dice que es la primera.
- Guardar la medición marca `antrop` como completa **sin pedirlo aparte**.
- Repetir el guardado en la misma consulta **reemplaza**: no crea una segunda medición del mismo día.

### CA-13-15 · Lectura de los índices
| Valor | Etiqueta |
|---|---|
| IMC 17 | Bajo peso |
| IMC 22 | Normal |
| IMC 28,65 | Sobrepeso |
| IMC 41 | Obesidad III |
| ICC 0,885 en **mujer** | Riesgo elevado |
| ICC 0,885 en **hombre** | Dentro de rango |
| ICC sin sexo registrado | Sin referencia para este paciente |

El umbral difiere por sexo (OMS: 0,90 y 0,85). Sin sexo no se emite juicio, y la etiqueta va siempre en texto además del color.

## EVAL-02 · Bioquímica

### CA-13-16 y CA-13-17 · Agrupación y estado
`GET /api/pacientes/:id/labs/nutricional?dias=90`

**Esperado** con el seed: grupos **del catálogo** (`Perfil lipídico`, `Hematología`…), y para un HDL de 45 con mínimo 50 → `estado: "bajo"`.

Los grupos salen de `biomarcador.grupo`, no de listas de nombres en el código: un biomarcador nuevo queda clasificado sin tocar nada, mientras que con listas a mano caería en un limbo silencioso.

`bajo`/`alto` afinan el `alterado` de la Rebanada 5: para valorar hace falta saber hacia dónde se sale del rango. **No hay `critico`**: el valor de pánico depende de umbrales que el proyecto sitúa en RPM.

### CA-13-18 y CA-13-19 · Panel
- Los grupos con algo fuera de rango se despliegan **solos** al cargar; el resto queda plegado.
- Sin estudios en la ventana: aviso ámbar explicando que la bioquímica se construye con lo ya cargado, y enlace a Laboratorios. Aquí **no** se capturan valores.

### CA-13-20 · Marcar revisada
«Marcar bioquímica revisada» → `seccionesCompletas.bioquim = true`.

Se marca a mano, al revés que la antropometría: revisar es un acto del profesional, no una consecuencia de que existan laboratorios.

---

# Rebanada 14 · Historial clínico y evaluación dietética

> **Manda los cuerpos con acentos desde archivo.** `curl -d '…día…'` descuadra el `Content-Length` y la API responde 400. Es del shell, no de la API: usa `--data-binary "@cuerpo.json"`. Costó descubrirlo dos veces (R10 y aquí).

## EVAL-03 · Historial clínico

### CA-14-01 y CA-14-02 · UPSERT, no duplicado
```powershell
$body = '{"apf":[{"condicion":"Diabetes tipo 2","parientes":"madre"}],"tipoActividad":"moderado","sesionesSemana":3}'
Invoke-RestMethod "$API/api/pacientes/$MARIA/historial" -Method Put -Headers $H `
  -ContentType "application/json" -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

**Esperado:** el APF vuelve como JSONB. Guardar otra vez con `tipoActividad: "intenso"` deja **una sola fila**, con el nuevo valor.

Lo respalda la restricción `historial_por_paciente`. La especificación pedía el `ON CONFLICT` **sin crear el índice único que necesita**: Postgres lo habría rechazado y cada guardado habría fallado.

### CA-14-03 · FAF calculado en el servidor
| Tipo | FAF |
|---|---|
| sedentario | 1.200 |
| leve | 1.375 |
| moderado | 1.550 |
| intenso | 1.725 |
| muy_intenso | 1.900 |

Lo calcula la API a partir del tipo, no el cliente: enviado desde fuera podría no corresponder con la etiqueta que el profesional ve.

Un `tipoActividad` inventado → **400**.

### CA-14-04 y CA-14-05 · Medicación
| Prueba | Esperado |
|---|---|
| `POST /farmacologia` con nombre | **201** |
| Sin nombre o vacío | **400** |
| `DELETE /farmacologia/:id` | **204** |
| La lista tras el DELETE | El medicamento **no aparece** |
| `select count(*) from farmacologia` | La fila **sigue ahí**, con `activo = false` |

Un fármaco suspendido explica hallazgos de laboratorio pasados; borrarlo dejaría el expediente sin la causa.

### CA-14-06 y CA-14-07 · Interacciones
Con Metformina 850mg, Levotiroxina, Warfarina, Omeprazol 20mg e **Ibuprofeno**:

```powershell
Invoke-RestMethod "$API/api/pacientes/$MARIA/farmacologia/interacciones" -Headers $H
```

**Esperado:**

| Campo | Valor |
|---|---|
| Coincidencias | Warfarina, Levotiroxina, Metformina, Omeprazol |
| Orden | `importante` primero (Warfarina), luego `advertencia` |
| `noReconocidos` | `["Ibuprofeno"]` |
| `cobertura` | 8 |

El emparejamiento es por subcadena y sin distinguir mayúsculas ni tildes: «Metformina 850mg» coincide con `metformina`.

**Lo que esta prueba verifica de verdad es `noReconocidos`.** La especificación pedía un panel que dijera «no se detectaron interacciones» cuando no encontrara ninguna. Con ocho principios activos cubiertos, esa frase convierte la ignorancia de la lista en una afirmación tranquilizadora. El panel dice, en su lugar, que ninguno de los medicamentos figura entre los que la revisión cubre, y enumera los que quedaron fuera.

### CA-14-08 · Marca la sección
Guardar el historial con `consultaId` → `seccionesCompletas.clinico = true`.

### CA-14-09 · Escala 1-5
`atracones: 9` → **400**. El `CHECK` de la base lo repite.

## EVAL-04 · Evaluación dietética

### CA-14-10 a CA-14-12 · Recordatorio de 24 horas
`PUT /dietetico` con `recordatorio24h` como lista de comidas, cada una con sus alimentos.

**Esperado:** **200**; el JSONB vuelve con la estructura intacta. Un `recordatorio24h` que no sea lista → **400**: lo que llegue rompería la pantalla que lo dibuja.

En la interfaz, el total de kilocalorías se recalcula al teclear. **Son las que escribe el profesional**: no hay tabla de composición de alimentos detrás, y fingir un cálculo daría una cifra con apariencia de dato.

### CA-14-13 · Frecuencia de consumo
Un radio por grupo; el objeto guarda `grupo → frecuencia`. Debe volver tal cual.

Los grupos se pintan con la paleta de **datos**, no con los tokens de estado clínico: «carnes procesadas» no es una alerta médica del paciente, y usar el rojo de un valor fuera de rango mezclaría dos lenguajes.

### CA-14-14 · Reparto de macros
Con proteína, carbohidratos y grasa, el donut muestra el porcentaje de cada uno **escrito además de en color**, y las kcal que aportan (4/4/9 por gramo).

**Comprobación añadida:** si las kcal declaradas se apartan más de un 10 % de las que suman los macros, avisa. Suele ser un valor mal tecleado.

### CA-14-15 y CA-14-16 · UPSERT y sección
Guardar dos veces deja **una fila**. Con `consultaId`, `seccionesCompletas.dietetico = true`.

### CA-14-17 · Aislamiento
| Prueba | Esperado |
|---|---|
| Luis: `GET /historial` de paciente de Ana | **404** |
| Luis: `PUT /dietetico` | **404** |
| Luis: `GET /farmacologia/interacciones` | **404** |

---

# Rebanada 15 · Conclusiones, calculadora y plan prescrito

## EVAL-05 · Conclusiones

### CA-15-01 a CA-15-03 · Guardar y derivar
`PUT …/consultas/:cid/conclusion` con diagnóstico, CIE-10, 2100 kcal y reparto 20/50/30.

**Esperado:** **200** con `proteinaG: 105`, `choG: 262.5`, `grasaG: 70`.

Los gramos **los deriva el servidor**: aceptarlos del cliente permitiría guardar unos gramos que no corresponden con el reparto de su propia fila.

Guardar otra vez con 1800 kcal y 25/45/30 deja **una sola fila**, con `proteinaG: 112.5`.

### CA-15-04 y CA-15-05 · Sección y cierre
| Prueba | Esperado |
|---|---|
| Guardar conclusión | `seccionesCompletas.conclusion = true` |
| Finalizar con conclusión pero **sin** antropometría | **409** con `faltan: ["antrop"]` |
| Tras registrar la antropometría | **200**, `estado: "finalizada"` |
| Editar la conclusión de una finalizada | **409** |

### CA-15-06 y CA-15-07 · JSONB
Acuerdos como `[{ texto, cumplido }]` y restricciones como array. Vuelven tal cual.

Una restricción desconocida se **descarta en silencio** y las válidas se conservan: `["paleo","renal"]` → `["renal"]`.

### Validación de los porcentajes
| Prueba | Esperado |
|---|---|
| 20 / 50 / 40 (suman 110) | **400**, indicando la suma real |
| Solo dos de los tres | **400** — los tres o ninguno |
| Ninguno (prescripción a medias) | **200** |

Lo repite un `CHECK` en la base: un reparto que suma 110 daría unos gramos coherentes entre sí que describen una dieta que no existe.

### Aislamiento
Luis (`nutricionista`) sobre la conclusión de un paciente de Ana → **404**.

## EVAL-06 · Calculadora

Todo se resuelve en el cliente (`lib/calculadora.ts`). Verificado con `tsx`:

| Cálculo | Resultado |
|---|---|
| **CA-15-08** Mifflin, mujer 38 a / 78 kg / 165 cm | **1460 kcal** |
| **CA-15-09** Harris-Benedict, mismos datos | **1516 kcal** (distinto, como pide el criterio) |
| **CA-15-10** Katch-McArdle con MLG 52 kg | 1493 kcal |
| Katch **sin** masa libre de grasa | **`null`** — la opción sale deshabilitada |
| Mifflin **sin sexo registrado** | **`null`** |
| Gasto total (1460 × 1,55) | 2263 kcal |
| Peso ideal Hamwi, mujer 165 cm | 57,1 kg |
| **CA-15-16** Peso ajustado con 78 kg reales | 62,3 kg |
| Peso ajustado con 60 kg reales | **`null`** — no supera el ideal en un 20 % |
| **CA-15-11** Subir proteína a 30 en 20/50/30 | 30 / 44 / 26 — **suma 100** |
| Macros de 2100 kcal al 20/50/30 | 105 g / 262,5 g / 70 g |
| **CA-15-13** Déficit de 500 kcal/día | 15,4 días por kilo · −0,45 kg/semana |
| **CA-15-14** 45 g de azúcar | 9 cucharaditas · 180 kcal · **excede** |
| **CA-15-15** 2800 mg de sodio | 7 g de sal · **excede** |
| Intercambios para 2100 kcal | Suman **2105 kcal** |

> **El valor esperado de CA-15-08 estaba mal.** El criterio decía «≈1548». Aplicando la fórmula que el propio encargo transcribe: 780 + 1031,25 − 190 − 161 = **1460,25**. La implementación sigue la fórmula publicada.

> **Los intercambios cubrían solo el 80 %.** Las proporciones dadas sumaban 0,80, así que el profesional habría prescrito una quinta parte menos de lo que acababa de calcular. Se normalizan conservando su peso relativo.

**El `null` sin sexo es la comprobación que importa.** La diferencia entre las constantes de hombre y mujer en Mifflin es de 166 kcal; elegir una por defecto no es un matiz, es inventar el resultado.

### CA-15-12 · Llevar a la prescripción
«Llevar a la prescripción» rellena la meta calórica y los tres porcentajes en el formulario, y cierra el panel.

## EVAL-07 · Plan prescrito

| Prueba | Esperado |
|---|---|
| **CA-15-17** Sin plan activo | Estado vacío con botón «Crear plan alimentario» |
| **CA-15-18** Con plan activo | Nombre, chip «Activo», rejilla semanal y total declarado |
| Plan activo sin comidas | Aviso de que está activo pero vacío |
| **CA-15-19** «Editar el plan completo →» | Lleva al expediente |

Es **solo lectura**: el plan se edita en su pestaña. Dos sitios donde tocar lo mismo acaban discrepando.

---

# Rebanada 16 · Consulta de seguimiento

**Escenario:** un paciente con una consulta **finalizada** y datos en todas las secciones. Después, una consulta nueva.

### CA-16-01 · La segunda consulta es de seguimiento
`POST /api/pacientes/:id/consultas` con una consulta finalizada previa → `tipo: "seguimiento"`, `numeroConsulta` incrementado.

### CA-16-02 y CA-16-03 · Foto de la valoración anterior
`GET /api/pacientes/:id/consultas/ultima-finalizada`

| Prueba | Esperado |
|---|---|
| Sin consultas finalizadas | **404 `sin_consulta_previa`** |
| Con una finalizada | Antropometría, historial, dietético y conclusión de esa consulta |

El 404 **no es un fallo**: significa «es la primera valoración», y la pantalla se comporta como consulta inicial sin decir nada.

La ruta estática **no choca** con `/consultas/:consultaId`: Fastify resuelve los segmentos literales antes que los paramétricos.

> `historial` y `dietetico` se buscan **por paciente**, no por consulta. Ambos son únicos por paciente y su `consulta_id` apunta a la última que los tocó; buscarlos por consulta —como decía la especificación— devolvería vacío en cuanto una consulta posterior los editara.

### CA-16-04 y CA-16-05 · Modo seguimiento en pantalla
Al abrir una valoración con consulta previa finalizada:
- Banner con la **fecha y el número** de la consulta anterior.
- Cabecera: `Consulta #N · Seguimiento`.
- Antes de las pestañas, el resumen de evolución.

### CA-16-06 y CA-16-07 · Antropometría comparada
Con la anterior en 80,3 kg y hoy 78,2:

| Prueba | Esperado |
|---|---|
| Campo de peso al abrir | **Vacío** |
| Texto bajo el campo | `Anterior: 80.3 kg` |
| Tras escribir 78.2 | `Anterior: 80.3 kg · -2.1 kg` |
| Valor igual al anterior | `· sin cambio` |

**Los campos empiezan vacíos a propósito.** La especificación pedía prerellenarlos; eso convierte un descuido en un dato falso, porque un peso precargado que se guarda sin tocar queda registrado como medición de hoy.

### CA-16-08 · «Sin cambios: copiar las anteriores»
Pide confirmación y rellena los campos con los valores previos. Copiar es una decisión explícita, no un descuido.

### CA-16-09 y CA-16-10 · Precarga de lo que se arrastra
Historial, dietético y conclusión **sí** se precargan —son narrativa, no medición— y llevan un aviso de la fecha de la que vienen.

### CA-16-11 y CA-16-12 · Comparativa
`GET /api/pacientes/:id/consultas/comparativa?consultaActualId=…`

Medido con 80,3 → 78,2 kg:

| Indicador | Anterior | Actual | Delta | % |
|---|---|---|---|---|
| Peso | 80,3 | 78,2 | **−2,1 kg** | −2,6 |
| IMC | — | — | −0,77 | −2,6 |
| Grasa corporal | — | — | −3,11 | −9,8 |
| Masa libre de grasa | 54,9 | 55,9 | +1 kg | +1,8 |
| Ángulo de fase | 5,8 | 6,2 | +0,4° | +6,9 |
| Cintura | 95 | 91 | −4 cm | −4,2 |

Y los acuerdos de la consulta anterior: **2 de 3 cumplidos**.

> **No hay `mejora` ni `empeora`.** La especificación los pedía; bajar dos kilos es un logro en un paciente con obesidad y una señal de alarma en uno desnutrido. Sin objetivo de peso registrado no hay con qué distinguirlos, así que se devuelve la **dirección** (`sube` / `baja` / `igual`) y la pantalla lo dice al pie.

### CA-16-13 · Aislamiento
| Prueba | Esperado |
|---|---|
| Luis sobre la comparativa de un paciente de Ana | **404** |
| Sin `consultaActualId` | **400** |
| `consultaActualId` de otra clínica | **404** |

### CA-16-14 y CA-16-15 · Ciclo completo
Un seguimiento se finaliza igual que una inicial (**200**), y la consulta siguiente vuelve a nacer como `seguimiento` con el ordinal incrementado. `ultima-finalizada` pasa a apuntar a la recién cerrada.

---

# Rebanada 12 · IA clínica

> **Estado.** Todo lo que NO llama al modelo está verificado contra el servidor. Lo que sí llama **no se ha ejecutado nunca**: hace falta `ANTHROPIC_API_KEY` en el `.env` de la raíz. Los criterios marcados **⏳** quedan pendientes de esa primera ejecución.

## Requisito previo
`ANTHROPIC_API_KEY` en el `.env` de la raíz (opcional: `ANTHROPIC_MODELO`, por defecto `claude-haiku-4-5`). `@anthropic-ai/sdk` ya está en `apps/api`.

> El modelo que pedía el encargo, `claude-3-5-haiku-20241022`, **está retirado desde el 19 de febrero de 2026** y devuelve 404 — la función habría fallado siempre. Se usa su reemplazo directo, `claude-haiku-4-5`.

## La regla de oro, comprobada

Con la IA caída (sin clave):

| Prueba | Esperado |
|---|---|
| `GET /api/pacientes/:id` | **200** |
| `GET /api/citas` | **200** |
| `GET /api/pacientes/:id/laboratorios` | **200** |
| `POST /api/labs/:id/interpretar` | **503** `tipo: "sin_configurar"` |
| `POST /api/pacientes/:id/soap/generar` | **503** |

**Nunca se bloquea el acceso clínico por el estado de la IA.** La API arranca sin clave a propósito.

El `tipo` del 503 (`sin_configurar`, `limite_de_uso`, `credencial_invalida`, `tiempo_agotado`, `sin_conexion`) permite a la pantalla decir qué pasa y qué hacer.

## IA-01 · Interpretación de laboratorios

### CA-12-01 a CA-12-03 ⏳ · Generar
`POST /api/labs/:estudioId/interpretar` → **201** con las cuatro secciones (RESUMEN CLÍNICO, IMPLICACIONES NUTRICIONALES, RECOMENDACIONES DIETÉTICAS, SEGUIMIENTO PRIORITARIO), el modelo y los contadores de tokens. Se persiste y `GET …/interpretacion` la devuelve.

**Lo que hay que mirar en la primera ejecución real:** que un biomarcador **sin rango declarado** no aparezca descrito como normal. Al modelo se le entrega como «sin rango de referencia declarado» con instrucción explícita; es la misma decisión de la Rebanada 5 y la que más importa comprobar.

### CA-12-04 · Aislamiento
| Prueba | Esperado |
|---|---|
| Estudio inexistente | **404** |
| Luis sobre un estudio de un paciente de Ana | **404** (no 403) |
| Estudio sin resultados | **400** |
| Sin interpretación previa | **404** `sin_interpretacion` |

### CA-12-05 · Degradación
Sin clave configurada → **503** `{"error":"ia_no_disponible","tipo":"sin_configurar"}`. El error nunca sube sin manejar.

### CA-12-06 · Revisar
`PUT …/interpretacion/:id/revisar` → `revisada: true` con fecha y **profesional que la avaló**. Es idempotente pero **no vuelve a firmar**: se conserva quien la revisó primero.

### CA-12-07 y CA-12-08 ⏳ · Panel
Al pie de cada estudio, **después** de la tabla de valores: botón «Interpretar con IA», chip ámbar **«Sugerencia de IA»**, chip verde «Revisada», el modelo y los tokens al pie, y el descargo de que no sustituye el criterio profesional.

## IA-02 · Notas SOAP

### CA-12-09 y CA-12-10 ⏳ · Borrador
`POST /api/pacientes/:id/soap/generar` devuelve `{ borrador: {subjetivo, objetivo, analisis, planSoap}, textoCompleto }` y **no escribe en la base**. Comprobable con `select count(*) from nota_soap` antes y después.

El reparto en secciones sí está probado en aislamiento, con tres formas de encabezado:

| Entrada | Resultado |
|---|---|
| `S (SUBJETIVO): texto` en la misma línea | Se reparte correctamente |
| `**S (SUBJETIVO):**` con negritas | El marcado no se cuela en el cuerpo |
| Falta la sección A | `analisis: null` — **no se reparte a ojo** |

Una sección ausente vuelve `null`: es preferible un campo vacío que el profesional rellena a uno con contenido que pertenece a otro apartado.

### CA-12-11 a CA-12-14 · Ciclo completo
| Prueba | Esperado |
|---|---|
| `POST …/soap` con `generadaIa: true` | **201**, la nota queda marcada |
| `GET …/soap` | Extracto, autor, chips de IA y revisión |
| `PUT …/soap/:id` con solo `analisis` | Cambia el análisis; **el subjetivo queda intacto** |
| `PUT …/soap/:id/revisar` | `revisada: true` con fecha |
| Nota sin ninguna de las cuatro secciones | **400** |

### CA-12-15 y CA-12-16 ⏳ · Generador y tarjeta
Banner ámbar antes de guardar: «Revísalo y corrígelo antes de guardar: al guardarlo, la nota pasa a ser tuya». Chips **[IA]** y **[Revisada]** en la tarjeta, cuatro secciones al desplegar.

«Escribirla a mano» es un camino de primera clase, no un plan B.

### CA-12-17 y la regla de autoría
| Prueba | Esperado |
|---|---|
| Luis genera SOAP para un paciente de Ana | **404** |
| Ana (admin) **lee** una nota de Luis | **200**, con `esAutor: false` |
| Ana **marca revisada** una nota de Luis | **200** |
| Ana **edita** una nota de Luis | **403** `nota_ajena` |

**Al revés que la conclusión de la R15**, aquí sí se exige autoría. Una nota SOAP lleva la firma de quien la escribió; que otro la reescriba dejaría la firma de uno sobre las palabras de otro. Es un **403 con motivo**, no un 404: el profesional ya está viendo la nota.

### CA-12-18 ⏳ · Medidor de consumo
Cada llamada queda en `uso_ia` con clínica, profesional, función, modelo y tokens — **incluidas las fallidas**, porque una que agotó el tiempo de espera pudo consumir cuota igual.

```sql
select funcion, modelo, sum(tokens_entrada), sum(tokens_salida),
       count(*) filter (where not exito) as fallidas
  from uso_ia group by 1,2;
```

> La especificación se conformaba con un `console.log` para el SOAP, pero el borrador **no se persiste**: su gasto habría sido invisible. Un `console.log` no es un registro.

Registrar el consumo nunca tumba la petición: si la tabla falla, el profesional sigue viendo su interpretación.

---

# Rebanada 17 · App del paciente

> **Estado.** La API está verificada de punta a punta. **El flujo en el navegador no se ha ejecutado**: falta crear el cliente `nutrismart-patient` en el Keycloak compartido, y no tengo sus credenciales de administrador. Los criterios marcados **⏳** dependen de ese paso — está en `docs/REBANADA-17.md § El paso que falta`.

## PAC-01 · Invitación

### PAC-01-01 · El profesional invita
`POST /api/pacientes/:id/invitar`

| Prueba | Esperado |
|---|---|
| Paciente sin correo registrado | **422** `sin_correo`, con qué hacer |
| Paciente con correo | **201** con mensaje, `enlace` y `expiraEn` |
| Sin `RESEND_API_KEY` | El enlace se imprime en la consola y `emailEnviado: false` |
| Con clave, destinatario permitido | **`emailEnviado: true`** y `email_enviado` en la base — comprobado con un envío real |
| Con clave, destinatario rechazado | **201 igual**, `emailEnviado: false`, mensaje «el correo no salió», enlace en la respuesta y en consola |
| Paciente que ya activó su cuenta | **409** `ya_vinculado` |
| Paciente de otra clínica | **404** |

El enlace se devuelve **siempre**, no solo cuando falla el correo: un envío correcto puede acabar en la carpeta de no deseado, y quien acaba de crear la invitación ya está autorizado a invitar a ese paciente.

> **El remitente por defecto es el sandbox de Resend** y solo entrega a la dirección del titular de la cuenta. Un destinatario cualquiera devuelve 403 `validation_error` del proveedor: la invitación se crea igual y el profesional recibe el enlace. Para invitar a pacientes reales hace falta un dominio verificado en `resend.com/domains` — NutriSmart no puede usar el de Vetline.

> **Antes de probar en local:** `docker stop nutrismart-api`. Ese contenedor publica el 4001 con código antiguo y compite con `npm run dev`; cuando gana, todo lo posterior a la R12 responde 404 y parece que las rutas no se registraron.

### PAC-01-02 · El paciente abre el enlace
`GET /api/invitacion/:token` — **sin cabecera de autenticación**.

Devuelve nombre del paciente, clínica y caducidad. **No devuelve el correo**: la ruta es pública y la pantalla no lo necesita.

| Prueba | Esperado |
|---|---|
| Token válido | **200** |
| Token inexistente | **404** |

### PAC-01-05 · Caducidad
Con `expira_en` en el pasado, la consulta devuelve **410** `caducado` y **deja el estado guardado en `expirada`**: manda la fecha, no la columna.

### PAC-01-06 · Reenviar invalida la anterior
Tras un segundo `POST …/invitar`:

| Enlace | Esperado |
|---|---|
| El viejo | **410** |
| El nuevo | **200** |

En la base queda `expirada x1, pendiente x1`. Un índice único parcial sobre `(paciente_id) where estado='pendiente'` impide que dos pulsaciones seguidas dejen dos enlaces vivos; el caducado y el alta van en la misma transacción.

### PAC-01-03 y PAC-01-04 ⏳ · Crear cuenta y vincular
Requieren el cliente de Keycloak. Lo verificable hoy:

| Prueba | Esperado |
|---|---|
| Vincular con token de profesional | **403** |
| Vincular con token inexistente | **404** |
| Vincular un enlace ya usado | **410** |
| Sin cabecera de autenticación | **401** |

Simulando la vinculación en la base, la ficha del profesional pasa a `tieneCuenta: true` y reinvitar da **409**.

> **El token nunca viaja en la URL.** El encargo proponía volver de Keycloak con `?jwt=…`; además de que nada en ese flujo produce el parámetro —no habría funcionado nunca—, una credencial en la barra de direcciones queda en el historial y en la cabecera `Referer`. Se usa `keycloak-js` con PKCE S256, que ya estaba en el proyecto.

## PAC-02 · Espacio del paciente

### Seguridad
| Prueba | Esperado |
|---|---|
| Profesional en `/api/paciente/dashboard` | **403** `solo_pacientes`, con a dónde ir |
| Sin token | **401** |
| Cuenta sin expediente vinculado | **404** `sin_vincular` |
| `GET` en `/api/pacientes/:id/invitar` (es POST) | **404** |

> **El acceso no lo da el rol, lo da la fila.** Exigir el rol `paciente` haría que la vinculación —el único momento en que ese rol podría asignarse— fallara antes de ocurrir. Solo se atiende a quien tiene un expediente **activo** cuyo `keycloak_user_id` coincide con el `sub`.

### PAC-02-01 a PAC-02-05 · El panel
`GET /api/paciente/dashboard`, verificado con datos reales:

| Bloque | Resultado |
|---|---|
| **Peso** | 80,3 kg con su fecha; el historial sale en **orden cronológico** |
| **Próxima cita** | Fecha, duración, tipo y profesional. Usa `inicio` (timestamptz), no fecha + hora |
| **Plan** | 2100 kcal · 20/50/30 · **105 g / 262,5 g / 70 g** derivados por el servidor |
| **Acuerdos** | Los dos de la última consulta, con su estado de cumplimiento |
| **Mensajes** | Contador de `mensajes_no_leidos_pac` |

`GET /api/paciente/yo` devuelve además la marca de la clínica (`colorPrimario`, `nombre_app`), y la app inyecta ese color en `--primary`: es el white-label de la R6 visto desde el otro lado.

> **Los acuerdos salen de UNA consulta.** La consulta del encargo aplanaba el `jsonb` y **después** limitaba a 10 filas, así que mezclaba acuerdos de visitas distintas: el paciente vería como pendiente algo que pactó hace seis meses.

> **El diagnóstico NO se envía.** «Obesidad grado I», escrito para otro profesional, aterriza distinto cuando lo lee el paciente solo en su móvil. El plan sí; el diagnóstico se dice en consulta.

### Sin probar
La **línea de peso** solo se dibuja con dos o más mediciones. No pude registrar una segunda: hay una medición por consulta (restricción de la R13, funcionando como debe), y montar dos consultas finalizadas para una gráfica no lo justificaba. La forma del componente sí está: con un solo punto no dibuja línea, que es lo correcto.

---

# Rebanada 18 · Mensajería y acuerdos del paciente

> **Estado.** API verificada de punta a punta. El flujo en navegador sigue pendiente del cliente `nutrismart-patient` en Keycloak (mismo bloqueo que la R17). Las cuatro rutas de la app responden 200 y compilan.

## Seguridad (aplica a las cinco rutas)

| Prueba | Esperado |
|---|---|
| Token de profesional | **403** `solo_pacientes` |
| Sin token | **401** |
| Cuenta sin expediente vinculado | **404** `sin_vincular` |

## PAC-03 · Mensajería

### PAC-03-01 · Abrir la conversación
`GET /api/paciente/conversacion`

| Prueba | Esperado |
|---|---|
| Sin invitación aceptada | **404** `sin_conversacion` con qué esperar |
| Con invitación aceptada | **200**; se abre con el profesional que invitó |
| Llamarla otra vez | **El mismo identificador** — no duplica |

Se usa UPSERT contra `uq_conversacion (clinica_id, paciente_id, profesional_id)`. El encargo hacía `on conflict do nothing` sin objetivo y releía después: con dos pestañas, la relectura puede caer entre el insert de una y el commit de la otra.

### PAC-03-02 y PAC-03-05 · Enviar
`POST …/mensajes` → **201** con el mensaje, y en `notificacion` aparece `mensaje_nuevo → profesional`.

| Prueba | Esperado |
|---|---|
| Mensaje en blanco | **400** |
| 4001 caracteres | **400** |

> `mensaje.clinica_id` es NOT NULL y el `INSERT` del encargo lo omitía: habría fallado en la primera prueba.

### PAC-03-04 · Abrir el hilo marca lo leído
Con un mensaje del profesional sin leer:

| Momento | `mensajes_no_leidos_pac` |
|---|---|
| Antes de abrir | **1** |
| Después de `GET …/mensajes` | **0** |

El mensaje del profesional vuelve con `leido: true`. Es un efecto sobre un GET y aquí es lo correcto: leer es exactamente lo que el paciente está haciendo.

### PAC-03-03 · Sondeo incremental
`GET …/mensajes?desde=<createdAt del último>` devuelve **`[]`** cuando no hay nada nuevo.

> `created_at` se devuelve **con microsegundos** porque el cliente lo reenvía como `desde`. Truncado al segundo, el último mensaje volvía a salir en cada sondeo — comprobado antes y después del arreglo.

> **Los últimos 50, no los primeros.** El encargo ordenaba ascendente con `LIMIT 50`: en un hilo de doscientos mensajes eso devuelve los cincuenta **más antiguos** y el paciente no ve lo que acaban de escribirle.

## PAC-04 · Plan y acuerdos

### PAC-04-01 y PAC-04-02 · Ver el plan
`GET /api/paciente/plan` con una consulta finalizada:

| Campo | Valor |
|---|---|
| kcal · reparto | 2100 · 20/50/30 |
| Gramos | **105 g · 262,5 g · 70 g** (derivados por el servidor en la R15) |
| Restricciones | `["bajo_sodio"]` |
| Suplementos | «Vitamina D 1000 UI» |
| Acuerdos | Los dos, con `cumplidoProfesional` y `cumplidoPaciente` **por separado** |

Sin consulta finalizada devuelve `{ plan: null, mensaje }` — no un 404: no tener plan todavía no es un error.

### PAC-04-03 a PAC-04-05 · Marcar, persistir, desmarcar
| Prueba | Esperado |
|---|---|
| `POST …/acuerdos/:consultaId/0/cumplir` con `{"cumplido":true}` | **200**; al releer el plan, `cumplidoPaciente: true` |
| Repetir con `{"cumplido":false}` | **200**; en la base sigue habiendo **una sola fila** (UPSERT) |
| Índice fuera de rango | **404** |
| `consultaId` de otro paciente | **404** |

### La prueba que el encargo no contemplaba

El paciente marca el acuerdo 0 («Caminar 30 minutos al día»). El profesional lo **sustituye** por «Tomar el suplemento a diario».

| Esperado | Resultado |
|---|---|
| El «cumplido» **no** se arrastra al acuerdo nuevo | ✅ `cumplidoPaciente: false` |

Con el diseño del encargo —solo `acuerdo_index`— sí se habría arrastrado, sin error ni aviso: un dato clínico mal atribuido. Se guarda también `acuerdo_texto` y al leer se comprueba que el acuerdo sigue diciendo lo mismo.

### PAC-04-06 · Navegación
Barra inferior fija con Inicio · Mi plan · Mensajes, contador de no leídos, y respeto del área segura del móvil (`env(safe-area-inset-bottom)`). La pestaña activa se distingue por color **y** subrayado, no solo por el tono.

---

# Rebanada 19 · La app del paciente en Docker

> **Estado.** El contenedor construye, levanta y sirve. El **cliente `nutrismart-patient` de Keycloak sigue pendiente** (lo crea el equipo por la consola), y con él el recorrido de punta a punta.

## Construcción

```bash
docker build -f apps/web-patient/Dockerfile \
  --build-arg VITE_API_URL=http://localhost:4001 \
  --build-arg VITE_KEYCLOAK_URL=http://localhost:8080 \
  --build-arg VITE_KEYCLOAK_REALM=nutrismart \
  --build-arg VITE_KEYCLOAK_CLIENT_ID_PACIENTE=nutrismart-patient \
  -t nutrismart-web-patient-test .
```

Imagen resultante: **93 MB**.

> **El primer intento falló.** `apps/web-patient` no estaba en la lista de `workspaces` del `package.json` de la raíz —la Rebanada 17 creó la app sin registrarla— y `npm run build -w @nutrismart/web-patient` no encontraba el paquete. En local no se notaba porque se lanzaba `npx vite` desde dentro de la carpeta.

> **La plantilla del encargo tampoco habría construido:** usaba `npm ci --workspace=…` y nunca copiaba `packages/design-system`, que la app importa para los tokens y el preset de Tailwind.

## Servicio

```bash
docker compose -f infra/docker-compose.dev.yml up -d web-patient
```

| Prueba | Esperado |
|---|---|
| `GET /` | **200** |
| `GET /activar` · `/inicio` · `/plan` · `/mensajes` | **200** |
| `GET /activar?token=abc` | Sirve `index.html` (fallback de SPA) |

**El fallback importa más aquí que en la app profesional**: el enlace de invitación llega por correo a `/activar?token=…`. Sin él, el enlace del correo daría 404 y la invitación sería inservible.

### Variables incrustadas en el bundle
```
localhost:4001 · localhost:8080 · nutrismart-patient
```

Se resuelven **en el build**, no en runtime: cambiar de entorno exige reconstruir la imagen, no reiniciarla.

> **`localhost` es correcto también dentro de Docker.** El encargo sugería `host.docker.internal` ante un error de CORS, razonando que el contenedor llama a la API. No la llama: nginx solo sirve archivos estáticos, y quien hace `fetch` es el navegador del paciente, fuera de Docker.

### Cabeceras de caché
| Recurso | `Cache-Control` |
|---|---|
| `/assets/index-*.js` | `max-age=31536000, public, immutable` |
| `/index.html` | `no-cache` |

## Dos trampas de puerto

| Síntoma | Causa |
|---|---|
| `ports are not available: 0.0.0.0:5175` | Un `npx vite --port 5175` de una prueba anterior sin cerrar. Docker no dice quién ocupa el puerto |
| Rutas posteriores a la R12 devuelven 404 | El contenedor `nutrismart-api` servía una imagen anterior a la rebanada de IA y competía por el 4001 con `npm run dev`. Se reconstruye la imagen |

Tras reconstruirla, el stack en Docker responde con el código actual:

| Ruta | Esperado |
|---|---|
| `GET …/soap` (R12) | **200** |
| `GET …/consultas/ultima-finalizada` (R16) | **404** `sin_consulta_previa` — no hay consultas cerradas |
| `POST …/invitar` (R17) | **201** |
| `GET /api/paciente/plan` (R18) con token de profesional | **403** `solo_pacientes` |

Los tres contenedores —`nutrismart-db`, `nutrismart-api`, `nutrismart-web-pat`— quedan levantados a la vez.

## Pendiente: el cliente de Keycloak

Sin `nutrismart-patient` en el realm nadie puede autenticarse. Pasos y —sobre todo— el **mapper de audiencia** que suele olvidarse, en `docs/REBANADA-19.md`.

Sin ese mapper el token no lleva `aud: nutrismart-api` y **la API responde 401 sin decir por qué**.

---

# Recorrido manual del frontend

Con `npm run dev:web`, en **http://localhost:5173**:

| Paso | Qué comprobar |
|---|---|
| Login | Vuelve a la lista con los 3 pacientes |
| Alta sin alergias | Marca **ese campo**, no un error general |
| Alergia escrita sin confirmar el chip | **Entra igual** (se confirma al perder el foco) |
| Documento `1-1111-1111` | Señala el campo del documento |
| Ficha de Juan | Dos diagnósticos y "Penicilina" en tarjeta con borde ámbar |
| **F5 en la ficha** | Sigue funcionando (fallback de SPA) |
| Editar → quitar alergia | Desaparece de la vista, queda archivada en base |
| Dar de baja | Diálogo dice que **archiva**; vuelve a la lista sin el paciente |
| Pestaña Historial | Timeline descendente, punto ámbar en borrador |
| Flechas de tendencia | **Neutras, no verdes**: la interfaz muestra dirección, no juzga |
| Ana Castro | Métricas con "—" en vez de flecha |
| María Fernández | Versión corregida plegada bajo la vigente |
| Cerrar control | **Pide confirmación**: la acción es irreversible |

### Agenda (Rebanada 4)

Con **`ana@vida.cr`** (administradora):

| Paso | Qué comprobar |
|---|---|
| Barra lateral | **Agenda** ya navega; sigue apagado lo no construido |
| Agrupación | Por día, con "Hoy" y "Mañana" en vez de la fecha |
| **Horas** | Una cita guardada a las `21:00Z` debe verse a las **15:00** en Costa Rica |
| Filtro Profesional | Visible solo para el administrador; al filtrar por Luis quedan solo sus citas |
| Nueva cita | El desplegable ofrece **solo pacientes visibles** |
| Solape | El error sale **bajo el campo de fecha y hora**, no como mensaje general |
| Cita programada | Detalle con Editar, Marcar completada y Cancelar; **cancelar pide confirmación** |
| Tras completar | Aparece "Registrar control" → crea el snapshot y abre su modal con la fecha de la cita |
| Cita completada o cancelada | **No ofrece Editar** y explica por qué |
| Con control ya registrado | El botón pasa a "Ver control clínico" y la tarjeta muestra "Control registrado" |

Con **`luis@vida.cr`** (nutricionista): **no aparece el filtro Profesional** —solo se vería a sí mismo— y no ve ninguna cita de María.

**El huso horario es lo más frágil de esta pantalla**: un desfase de seis horas se ve plausible y pasa desapercibido. Es la única vista que muestra instantes con hora; el resto de la app usa fechas sin hora.

### Identidad visual (Rebanada 6)

Con **`ana@vida.cr`** (administradora):

| Paso | Qué comprobar |
|---|---|
| Barra lateral | **Configuración** ya navega (antes estaba apagada) |
| `/ajustes/marca` | Nombre, dos colores y carga de logo; la vista previa refleja lo tecleado **antes** de guardar |
| Cambiar el primario y **Guardar** | La barra lateral, el botón Guardar y el elemento activo del menú cambian **sin recargar** |
| Badge "Alerta (fijo)" de la vista previa | **No cambia** de color: el semáforo clínico no se re-tematiza |
| Escribir `rojo` en el campo hexadecimal | Marca **ese campo**; el botón Guardar queda deshabilitado |
| Subir un SVG | Rechazado ya en el navegador, antes de salir la petición |
| Subir un PNG y guardar | Sustituye la inicial por el logo en la barra lateral |
| Volver a subir otro logo | El anterior **desaparece del almacén** (queda un solo archivo en `datos/archivos/<clinica>/`) |
| Eliminar logo | Vuelve la inicial sobre el color primario; **los colores no se pierden** |
| Restaurar valores por defecto | **Pide confirmación**; vuelve el verde `#0E7C66` y "NutriSmart" |
| **F5** | La marca se mantiene: sale de la base, no del navegador |

Con **`luis@vida.cr`** (nutricionista): **Configuración sigue apagada** y teclear `/ajustes/marca` a mano redirige a Pacientes. La API responde **403** igualmente — la comprobación del navegador solo decide qué se pinta.

### Contexto social (Rebanada 7)

En la ficha de un paciente, pestaña **Sociodemografía** (deja de estar apagada):

| Paso | Qué comprobar |
|---|---|
| Paciente recién sembrado | Aviso ámbar de consentimiento pendiente, **no** un formulario vacío |
| "Registrar consentimiento y completar datos" | Abre el formulario **in situ**, sin modal ni página nueva |
| Guardar sin marcar la casilla | El botón está **deshabilitado** y explica por qué al pasar el cursor |
| Marcar consentimiento y guardar con campos en blanco | **Guarda**: todo el contenido es opcional |
| Vista de lectura | Los ocho campos con "—" donde no hay dato, y la fecha del consentimiento al pie |
| Editar → vaciar un campo → Guardar | El campo queda vacío (el formulario reemplaza el bloque) |
| Horas de sueño = 25 | Marca **ese campo**, no un error general |
| **Revocar consentimiento** | Pide confirmación explicando que los datos se conservan pero dejan de verse |
| Tras revocar | Vuelve el aviso, y añade que hubo datos recogidos anteriormente |
| Volver a registrar el consentimiento | Los datos anteriores **reaparecen** en el formulario |

El aviso tras revocar es distinto del aviso inicial a propósito: `recolectado` separa "nunca se preguntó" de "se recogió y luego se ocultó". Sin ese matiz, el profesional creería que los datos se perdieron.

### Dashboard (Rebanada 8)

Con **`ana@vida.cr`** (administradora):

| Paso | Qué comprobar |
|---|---|
| Barra lateral | **Dashboard** ya navega (era el último item apagado desde la Rebanada 1) |
| Al entrar | Esqueletos grises mientras carga, no un salto de cero a la cifra |
| Encabezado | Muestra el rango real: "Del 1 de agosto al 1 de septiembre" |
| **Este mes** | 5 citas · 2 completadas · 1 cancelada · 2 pendientes |
| Cambiar a **Hoy** / **Semana** | Los números cambian **sin recargar la página** |
| Tile Canceladas con 1 | En rojo. Con 0, en color normal — un cero en rojo alarma sobre la ausencia del problema |
| Tile Completadas | Lleva el porcentaje debajo |
| Agenda de hoy vacía | "No hay citas programadas para hoy.", no una tabla vacía |
| Tabla por profesional | Los dos profesionales aparecen aunque no tengan citas |
| Columna % Completadas sin citas | **"—"**, no "0.0 %" |
| Teclear `/admin/dashboard` con Luis | Redirige a Pacientes; la API responde 403 igual |

Con **`luis@vida.cr`**: **Dashboard sigue apagado** en el menú.

### Plan alimentario (Rebanada 9)

En la ficha de un paciente, pestaña **Plan alimentario**:

| Paso | Qué comprobar |
|---|---|
| Sin planes | «Aún sin planes registrados.» en la lista lateral |
| **+ Nuevo plan** | Pide nombre y objetivo; **Crear** deshabilitado sin nombre |
| Tras crear | Abre el **editor directamente**: el plan nace vacío y lo siguiente es cargarlo |
| Editor | 7 columnas × 6 filas; el contador dice cuántas comidas llevas |
| Rellenar desayuno y almuerzo del lunes → **Guardar** | La rejilla de lectura muestra **solo esas dos filas**, no las seis |
| Orden de las filas | **Desayuno antes que Almuerzo** — si sale alfabético, hay regresión |
| Al pie de la rejilla | Suma de kilocalorías declaradas |
| Guardar una comida **sin kcal** | Se guarda; la celda no muestra línea de calorías |
| **Activar plan** | El chip pasa a verde «Activo» — el mismo verde que «Completada» en la agenda |
| Crear un 2.º plan y activarlo | Aviso: *«El paciente ya tiene un plan activo. Archívalo antes de activar este.»* |
| **Descartar** un borrador | Pide confirmación; desaparece de la selección pero sigue en la lista como Archivado |
| **Archivar** el activo | Pide confirmación explicando que dejará de regir |
| Plan archivado | Chip **tachado**, aviso de solo lectura y **sin botones de acción** |
| Vaciar todas las celdas y Guardar | Vuelve el mensaje de «aún no tiene comidas» |

El editor manda la rejilla **entera** y el servidor reemplaza lo que había. Es lo que hace expresable vaciar una celda: con un guardado incremental, quitar el almuerzo del martes no tendría forma de decirse.

### Exportar PDF (Rebanada 10)

En la cabecera de la ficha, botón **Exportar PDF**:

| Paso | Qué comprobar |
|---|---|
| Abrir el modal | Esqueletos mientras consulta qué hay disponible |
| Paciente **sin** plan activo | «Plan de alimentación» **deshabilitado**, con el motivo debajo |
| Paciente **sin** consentimiento social | «Contexto social» deshabilitado: *«Requiere el consentimiento del paciente»* |
| Paciente **con** plan activo | La sección entra **marcada** por defecto |
| Desmarcar todo | El botón **Descargar** se deshabilita |
| Escribir recomendaciones | El contador llega a 3000 y ahí se detiene |
| **Descargar** | El navegador guarda `Expediente_<Paciente>_<fecha>.pdf` |
| Abrir el PDF | Cabecera con el **color de la clínica**, logo si está configurado, y firma con la colegiatura al pie |
| Con marca cambiada en Configuración | El PDF sale con el color nuevo — es la misma `brand_config` |
| **Escape** con el modal abierto | Cierra; mientras genera, **no** cierra |

Si el servidor no tiene Chromium, la descarga es un `.html` y el modal lo explica en vez de cerrarse. Es deliberado: un expediente no debe quedar retenido por un problema de infraestructura.

### Mensajería y notificaciones (Rebanada 11)

Con **`ana@vida.cr`**, en **Mensajería** (nueva entrada del menú):

| Paso | Qué comprobar |
|---|---|
| Bandeja vacía | «Aún no tienes conversaciones» |
| **+ Nueva conversación** | Lista los pacientes **sin hilo**; los que ya tienen no reaparecen |
| Abrir un hilo | Cabecera con el paciente y enlace **Ver expediente** |
| Escribir y **Enter** | Envía. **Mayús+Enter** hace párrafo |
| Mensaje enviado | Burbuja derecha con el color de marca y un tilde ✓ |
| Insertar en la base un mensaje del paciente | Aparece **en ≤ 5 s** sin recargar, a la izquierda |
| Tras aparecer | El contador de ese hilo se limpia solo (abrirlo es leerlo) |
| Desconectar la red y enviar | Sale el error y **el texto no se pierde** |
| Buscar en el panel izquierdo | Filtra por nombre de paciente |

Con **`luis@vida.cr`**: su bandeja está **vacía** aunque Ana tenga hilos. Los hilos son privados: un administrador ve todos los pacientes, no las conversaciones de sus compañeros.

En **Reglas automáticas**:

| Paso | Qué comprobar |
|---|---|
| **+ Nueva regla** | Cuatro tipos en tarjetas, cada una con su explicación |
| Elegir «Recordatorio de cita» | Aparecen **días de antelación** y **hora** |
| Elegir «Control de seguimiento» | Aparece **días sin consulta**; el resto desaparece |
| Guardar | La tarjeta muestra una frase en lenguaje llano de lo que hará |
| **Editar** una regla | El tipo sale **bloqueado**: cambiarlo sería otra regla |
| Interruptor | Alterna sin recargar; la inactiva queda atenuada, **no desaparece** |
| **Desactivar** | Pide confirmación explicando que se conserva |
| **Evaluar ahora** | Dice cuántas notificaciones generó |
| **Evaluar ahora** otra vez | «no había nada nuevo que avisar» — **0 generadas** |

La campana está en la cabecera, a la izquierda del nombre. Al pulsarla se abre un panel desde la derecha; **Escape** y el clic fuera lo cierran.

### Valoración ABCD (Rebanada 13)

En la ficha del paciente, tarjeta **Valoraciones** (columna derecha del Resumen):

| Paso | Qué comprobar |
|---|---|
| Sin valoraciones | «Sin valoraciones registradas» |
| **+ Nueva consulta** | Crea y **navega directamente** a la valoración |
| Cabecera | «Consulta #1 · Inicial» y chip ámbar **En curso** |
| Pestañas | Cinco: Antropometría, Bioquímica, Clínico, Dietético, Conclusiones |
| Clínico / Dietético / Conclusiones | Declaradas y vacías, explicando que llegan más adelante |
| **Finalizar valoración** | **Deshabilitado**; al pasar el cursor dice qué falta |
| Peso 78 y talla 165 | El chip de IMC muestra **28.65 · Sobrepeso** mientras tecleas |
| Cintura 92 y cadera 104 | ICC **0.885**; en mujer «Riesgo elevado», en hombre «Dentro de rango» |
| Paciente sin sexo registrado | El ICC dice «Sin referencia para este paciente» |
| Método **Bioimpedancia** | Seis campos; con masa libre de grasa y peso, la grasa se deriva al guardar |
| Método **Pliegues** | Los campos cambian según la fórmula y el sexo |
| Pliegues sin edad o sexo | Aviso: no se estima el porcentaje, se registran los pliegues tal cual |
| **Guardar antropometría** | La pestaña se marca completa **sola** |
| Volver a guardar | **Reemplaza**; no aparece una segunda medición del mismo día |
| Con 2 o más mediciones | Aparece la gráfica de área apilada, con leyenda |
| Pestaña **Bioquímica** | Grupos del catálogo; los que tienen algo fuera de rango se abren solos |
| Paciente sin laboratorios | Aviso ámbar con enlace a Laboratorios |
| **Marcar bioquímica revisada** | La pestaña se marca completa |
| Completar antropometría y conclusión | **Finalizar** se habilita |
| Tras finalizar | Chip verde **Finalizada**, aviso de solo lectura y **sin botones de guardar** |
| Volver a la ficha | La valoración aparece como Finalizada, con botón **Ver** |

La antropometría se marca sola al guardar; la bioquímica se marca a mano. Es deliberado: revisar los laboratorios es un acto del profesional, no una consecuencia de que existan.

### Historial clínico y dietético (Rebanada 14)

En la valoración, pestaña **Clínico**:

| Paso | Qué comprobar |
|---|---|
| Marcar «Diabetes tipo 2» en familiares | Aparece **al lado** el campo «¿Quién?» |
| Desmarcarla | El campo desaparece con su contenido |
| Elegir «Moderado» | El recuadro de factor de actividad muestra **1.55** |
| Cambiar a «Intenso» | Pasa a **1.725** sin recargar |
| «¿Fuma?» pulsar Sí y volver a pulsarlo | Vuelve a **sin responder** (no queda atrapado en Sí/No) |
| Marcar un síntoma digestivo | Aparece el campo de detalles |
| Escala de relación con la comida | Nota al pie de que es tamizaje, no instrumento validado |
| **Guardar historial** | La pestaña Clínico se marca completa |
| Recargar la página | Todo vuelve precargado: el historial es del paciente, no de la consulta |
| Añadir «Warfarina» | Aparece tarjeta **⛔ Importante** arriba del todo |
| Añadir «Ibuprofeno» | Sale en **«Fuera de la revisión»**, no como «sin interacciones» |
| Con la lista vacía de coincidencias | Dice que ninguno figura entre los N principios que cubre, **no** «sin interacciones» |
| «Añadir a las notas» | Vuelca las recomendaciones en el cuadro de notas |
| **Suspender** un medicamento | Pide confirmación; desaparece de la tabla pero sigue en la base |

Pestaña **Dietético**, tres sub-pestañas:

| Paso | Qué comprobar |
|---|---|
| **+ Añadir comida** | Card con hora, tipo y una fila de alimento |
| Escribir kcal en los alimentos | El total de arriba se actualiza al teclear |
| Cambiar de sub-pestaña y volver | **No se pierde nada**: el estado vive en el contenedor |
| Frecuencia de consumo | Contador «X de 14 respondidos» |
| Resumen: proteína 95, CHO 210, grasa 63 | Donut con los tres porcentajes **escritos** |
| Kcal declaradas 1200 con esos macros | Avisa del descuadre (los macros suman ~1787) |
| **Guardar evaluación dietética** | Un solo botón guarda las tres sub-pestañas |
| Tras guardar | La pestaña Dietético se marca completa |

Con la valoración **finalizada**, ambas pestañas quedan en solo lectura y sin botones de guardar.

### Conclusiones y calculadora (Rebanada 15)

Pestaña **Conclusiones**, la última del ABCD:

| Paso | Qué comprobar |
|---|---|
| Escribir en «Diagnóstico principal» | Sugiere los frecuentes; al elegir uno, **el CIE-10 se rellena solo** |
| El código sigue editable | Para diagnósticos que no están en la lista |
| Chips de recomendaciones | Se añaden y quitan al pulsar; las propias se escriben abajo |
| Poner 20 / 50 / 40 | Avisa de que suman 110 y **deshabilita Guardar** |
| Poner 20 / 50 / 30 con 2100 kcal | Muestra 105 g · 262,5 g · 70 g |
| **Abrir calculadora →** | Panel desde la derecha con los datos del paciente precargados |
| Paciente sin sexo registrado | La TMB no se calcula y **explica por qué** (166 kcal de diferencia) |
| Paciente sin masa libre de grasa | **Katch-McArdle sale deshabilitada**, con el motivo al pasar el cursor |
| Mover el deslizador de proteína | Los otros dos se reajustan y **siempre suman 100** |
| Presets (Equilibrada, Alta en proteína…) | Fijan el reparto de golpe |
| Acordeón de intercambios | Dice cuántas kcal suman, para contrastar con la meta |
| Proyección con −500 kcal | 15,4 días por kilo, con la nota de que es una escala, no una fecha |
| **Llevar a la prescripción** | Cierra el panel y rellena meta y porcentajes |
| Acuerdos | Tres de arranque, editables, con «+ Añadir acuerdo» |
| **Guardar conclusión** | La pestaña se marca completa |
| Con antropometría y conclusión hechas | **Finalizar valoración** se habilita |
| Al pie | Plan alimentario activo en **solo lectura**, o invitación a crearlo |

Las cinco pestañas del ABCD quedan construidas: ya no hay ninguna «en desarrollo».

### Consulta de seguimiento (Rebanada 16)

Requiere una valoración anterior **finalizada** con datos. Después, **+ Nueva consulta** en la ficha:

| Paso | Qué comprobar |
|---|---|
| Al abrir la valoración | Banner con la fecha y el número de la consulta anterior |
| Cabecera | «Consulta #2 · Seguimiento» |
| Antes de las pestañas | Tarjetas de evolución: peso, grasa, masa magra, ángulo de fase |
| Tarjeta de acuerdos | «2 de 3», con ● y ○ por cada acuerdo anterior |
| Pestaña Antropometría | El campo de peso está **vacío**, con «Anterior: 80.3 kg» debajo |
| Escribir 78.2 | El texto pasa a «Anterior: 80.3 kg · −2.1 kg» |
| Escribir 80.3 | «· sin cambio» |
| **Sin cambios: copiar las anteriores** | Pide confirmación y rellena todo |
| Pestañas Clínico y Dietético | Precargadas, con aviso de la fecha de origen |
| Al pie de la evolución | Nota de que las flechas no dicen si el cambio es bueno o malo |
| Finalizar el seguimiento | Funciona igual que una inicial |
| Crear otra consulta | Vuelve a ser seguimiento, con el número siguiente |

**Lo que hay que mirar con atención**: que el peso NO venga precargado. Si apareciera relleno, un guardado distraído registraría la medición del mes pasado como la de hoy.

### IA clínica (Rebanada 12)

Requiere `ANTHROPIC_API_KEY` en el `.env` de la raíz. **Sin ella todo lo demás funciona igual** y solo estos dos puntos avisan de que la IA no está.

**Interpretación de laboratorios** — ficha → pestaña **Laboratorios**:

| Paso | Qué comprobar |
|---|---|
| Al pie de cada estudio | Bloque «Interpretación asistida», **debajo** de la tabla de valores |
| **Interpretar con IA** | Pasa a «Analizando…» y devuelve cuatro secciones con encabezados |
| Junto al título | Chip ámbar **«Sugerencia de IA»** |
| Al pie del texto | Modelo, tokens y quién la solicitó |
| **Marcar como revisada** | Aparece chip verde «Revisada» y el nombre de quien la avaló |
| Último párrafo | Descargo de que no sustituye el criterio profesional |
| Sin clave configurada | Mensaje explicando que hay que hablar con quien administra la plataforma |

**Notas SOAP** — ficha → pestaña **Notas SOAP**:

| Paso | Qué comprobar |
|---|---|
| **+ Nueva nota SOAP** | Motivo y observaciones, ambos opcionales |
| **Generar borrador con IA** | Las cuatro secciones llegan rellenas y **editables** |
| Banner ámbar | «al guardarlo, la nota pasa a ser tuya y respondes de lo que dice» |
| **Escribirla a mano** | Las cuatro cajas vacías, sin llamar a la IA |
| **Descartar** | Vuelve al inicio y **no queda nada guardado** |
| **Guardar nota** | Aparece en la lista con chip **[IA]** |
| Desplegar la tarjeta | Las cuatro secciones completas |
| **Editar** en una nota propia | Cajas de texto; al guardar solo cambia lo tocado |
| Una nota de otro profesional | Sin botón de editar, con el motivo escrito |
| **Marcar como revisada** | Chip verde, disponible para todo el equipo |

**Lo que hay que mirar con atención**: que el borrador **no aparezca en la lista hasta pulsar Guardar**. Si apareciera antes, el expediente tendría una nota que nadie ha leído.

---

# Tropiezos de entorno

Fallos reales encontrados durante el desarrollo. Casi todos tardaron más en diagnosticarse que en corregirse.

### Puertos ocupados por procesos invisibles a `docker ps`
El 5432 y el 5433 los tenían **servicios PostgreSQL nativos de Windows** (`postgresql-x64-13`, `postgresql-x64-18`). Docker publica el puerto igualmente **sin dar error**, pero las conexiones las gana el servicio nativo → *"password authentication failed"* con credenciales correctas.
**Diagnóstico:** `netstat -ano | findstr :PUERTO` — si aparecen **dos** PID escuchando, ese es el problema.
**Solución:** NutriSmart usa el **5434**.

El 4000 lo ocupa `vetplatform-backend-1`; la API usa el **4001** en el host y el 4000 dentro del contenedor.

### Precedencia de variables en Docker
`environment` **gana sobre** `env_file`, y ambos sobre el `ENV` de la imagen. El `.env` de la raíz es de desarrollo e inyectaba `NODE_ENV=development` en el contenedor de producción: Fastify pedía `pino-pretty` (devDependency ausente) y el proceso moría con un mensaje que no apuntaba a la causa.

### Issuer y JWKS son cosas distintas
El token lo emite el navegador contra `localhost:8080`, así que `iss` **siempre** es localhost. La API, dentro de Docker, descarga las llaves por `keycloak:8080`. Igualarlos hace que **todos** los tokens válidos den 401.

### `localhost` resuelve a IPv6 en Windows
Fastify con `host: '0.0.0.0'` enlaza solo IPv4. Las peticiones a `http://localhost:PUERTO` fallan mientras `http://127.0.0.1:PUERTO` funciona.

### Codificación del cuerpo en PowerShell
PowerShell 5.1 envía el cuerpo en ISO-8859-1: con un acento, el `Content-Length` deja de cuadrar y Fastify responde *"Request body size did not match Content-Length"*.
**Solución:** `[System.Text.Encoding]::UTF8.GetBytes($json)` y `ContentType = 'application/json; charset=utf-8'`.

### 415 en POST sin cuerpo
PowerShell manda `Content-Type: application/x-www-form-urlencoded` por defecto y Fastify no tiene parser. Un `fetch` del navegador no envía cabecera y funciona.
**Solución en pruebas:** enviar `{}` con `Content-Type: application/json`.

### `now()` es constante dentro de una transacción
Verificar un disparador de `updated_at` dentro de una sola transacción **siempre falla**: ambas lecturas devuelven la hora de inicio. Hay que medir en transacciones separadas.

### `to_char(..., 'OF')` produce fechas que la propia API no sabe leer

El patrón `OF` de Postgres emite el offset en **dos dígitos** cuando son horas enteras: `2026-08-15T21:00:00+00`. Eso **no es ISO 8601 válido** —el offset debe ser `+00:00`, `+0000` o `Z`— y `new Date()` lo rechaza.

El síntoma es desconcertante: cargar un registro y reenviarlo **sin tocar nada** falla con "fecha inválida". Es justo lo que hace un formulario de edición.

**Solución:** no formatear los `timestamptz` con `to_char`. Dejarlos pasar: `pg` devuelve un `Date` y el serializador emite ISO completo (`2026-08-15T21:00:00.000Z`).

Para fechas **sin hora** (`date`) sí conviene `to_char(..., 'YYYY-MM-DD')`: evita que un `Date` a medianoche UTC se muestre como el día anterior en husos al oeste.

### Formatear horas en el servidor miente sobre el huso

Un mensaje de error construido en la API con la hora del choque decía *"Ya tienes una cita de 21:00 a 22:00"* para una cita que en la agenda del profesional son **las 15:00**: la base trabaja en UTC. El servidor no conoce el huso del usuario. La API devuelve los timestamps en crudo y el navegador los formatea.

### `$tl` y `$TL` son la MISMA variable en PowerShell

Los nombres de variable no distinguen mayúsculas. Guardar un resultado en `$tl` teniendo un token en `$TL` lo sobrescribe, y todas las peticiones siguientes fallan con **401** y el mensaje *"La cabecera Authorization debe ser Bearer"* — que apunta a un problema de autenticación inexistente.

### Diagnosticar una migración fallida con `psql -f` deja restos

El runner envuelve cada migración en una transacción; `psql -f` **no**. Ejecutar el `.sql` a mano para ver el error real aplica todo lo que va antes del fallo —extensiones, tipos, tablas— y el siguiente intento choca con "ya existe". Envolver a mano en `begin; ... rollback;` o limpiar antes de reintentar.

### Columnas generadas y expresiones STABLE

`timestamptz + interval` está marcado **STABLE**, no inmutable, porque el resultado depende del huso cuando el intervalo lleva días o meses. Postgres rechaza usarlo en una columna generada con *"generation expression is not immutable"*. La alternativa es un disparador `BEFORE`, que además permite recalcular al editar.

### Vite y las dependencias nuevas
Añadir un paquete con el servidor levantado exige reiniciarlo: Vite pre-empaqueta dependencias al arrancar. Avisa con *"Re-optimizing dependencies because lockfile has changed"*.
