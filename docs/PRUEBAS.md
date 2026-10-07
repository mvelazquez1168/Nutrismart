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

# Rebanada 20 · Agenda: lo que faltaba

> **La Rebanada 4 ya había construido la agenda.** Tabla, validación de solapes, siete rutas y cinco componentes. R20 no la rehace: la extiende. Detalle de qué existía en `docs/REBANADA-20.md`.

## Los dos estados nuevos

`no_asistio` no es un matiz de `cancelada`: cancelar es un aviso y el hueco se pudo reasignar; no presentarse es un hueco perdido. Una clínica los cuenta por separado.

### Máquina de estados
| Desde | Hacia | Resultado |
|---|---|---|
| `programada` | `confirmada` | **200** |
| `confirmada` | reprogramar (`PUT`) | **200** — avisó de que viene, no de que la hora sea fija |
| `confirmada` | `completada` | **200** |
| `completada` | `programada` | **409** — no se reabre lo cerrado |
| `programada` | `no_asistio` | **200** |
| `no_asistio` | `cancelada` | **409** — es final |
| cualquiera | `inventado` | **400** |

La validación de solapes de R4 sigue vigente con los estados nuevos: una cita encima de una **confirmada** devuelve **409**.

## Historial por paciente (profesional)

`GET /api/citas/paciente/:pacienteId`

| Prueba | Esperado |
|---|---|
| Paciente visible | **200** con la lista, más reciente primero |
| Paciente inexistente o fuera de alcance | **404** |

Devuelve **todas, canceladas incluidas**: en un historial una cancelación es información —se agendó y no ocurrió— y ocultarla deja huecos inexplicables.

## Agenda del paciente

`GET /api/paciente/citas` → `{ proxima, siguientes, historial }`

| Bloque | Qué incluye |
|---|---|
| `proxima` / `siguientes` | Solo `programada` y `confirmada`, futuras. Una cancelada futura no es una cita, es un hueco |
| `historial` | Todo lo pasado, canceladas y ausencias incluidas |

| Prueba | Esperado |
|---|---|
| Token de profesional | **403** `solo_pacientes` |
| Sin token | **401** |

## Rejilla semanal (profesional)

En Agenda, botones **Lista / Semana**. La lista sigue por defecto.

| Paso | Qué comprobar |
|---|---|
| Pulsar **Semana** | El rango se encuadra al lunes–domingo que contiene el `desde` actual |
| Rejilla | Siete columnas, franja de 07:00 a 21:00, el día de hoy resaltado |
| Bloques | Altura proporcional a la duración; color por estado |
| Cancelada | Gris y tachada |
| No asistió | Color de alerta — se distingue de cancelada de un vistazo |
| Pulsar un bloque | Abre el detalle de esa cita |
| Semana sin citas | «No hay citas esta semana» |

> **No se añadió `?semana=YYYY-WW`.** Sería otra forma de decir `?desde=&hasta=`, que ya existía — y el cálculo de semana ISO del encargo está mal: `new Date(anio, 0, 1 + (ww-1)*7)` no da el lunes de la semana ISO, con desfases de hasta tres días según el año.

> El lunes se calcula en hora **local**, no en UTC: hacerlo en UTC desplaza la rejilla un día cada domingo por la noche.

## App del paciente

Pantalla `/citas`, cuarta pestaña de la barra inferior.

| Paso | Qué comprobar |
|---|---|
| Arriba | Cuenta atrás en la unidad que usaría una persona: «Mañana», «En 3 días», «En 2 semanas» |
| Debajo | Fecha larga, hora, duración y profesional |
| Sin citas | Invita a escribir un mensaje, con botón a `/mensajes` |
| Historial | Estados en lenguaje de paciente: `no_asistio` se lee **«No se realizó»**, sin reproche |
| Desde Inicio | «Ver todas mis citas →» lleva aquí |

Rutas servidas: `/activar`, `/inicio`, `/plan`, `/citas`, `/mensajes` — todas **200**.

---

# Rebanada 21 · Recordatorios, vista mensual y confirmación

## El fallo de fechas que apareció al probar

```js
new Date('2026-08-15T14:22:02+00')    // Invalid Date
new Date('2026-08-15T14:22:02Z')      // ok
```

`to_char(x, '…OF')` produce `+00`, que **no es ISO válido para `Date`**. Estaba en **21 sitios de siete ficheros** — todo lo escrito desde la R12.

| Endpoint | Antes | Ahora |
|---|---|---|
| Invitación (`expiraEn`) | `2026-08-21T03:52:08+00` | `2026-08-21T14:24:30Z` |
| Mensaje (`createdAt`) | `…04:39:50.434264+00` | `…14:26:16.005326Z` |
| Nota SOAP · cita · plan | `+00` | `Z` |

Las pantallas que los pintan llaman a `new Date(...)`: habrían mostrado **«Invalid Date»** en la caducidad de la invitación, la hora de cada mensaje y la fecha de la próxima cita.

> La agenda de la R4 no lo tenía: devuelve el `timestamptz` crudo y el driver lo serializa como `...000Z`. Solo el código posterior introdujo el `to_char`.

> **No se había visto porque ninguna de esas pantallas se ha abierto todavía en un navegador** — siguen esperando el cliente de Keycloak. Es el tipo de fallo que una API que responde 200 no delata.

## AGE-03 · Recordatorios

### Ciclo completo
Con una cita a 24 h y el correo configurado:

| Paso | Resultado |
|---|---|
| Arranque de la API | `recordatorios de cita: cada 15 minutos` |
| `POST /api/agenda/recordatorios/ejecutar` | `{"enviados":{"24h":1,"1h":0}}` |
| Fila en `recordatorio_cita` | `antelacion=24h exito=true destinatario=… error=-` |
| **Segundo ciclo** | `{"enviados":{"24h":0,"1h":0}}` y **una sola fila** |
| Cita a 1 h | `{"enviados":{"24h":0,"1h":1}}` |

Dos correos reales enviados por Resend.

> **Tabla, no banderas.** Una bandera responde «se envió» y nada más; la pregunta real en una clínica es «a este paciente que no vino, ¿se le avisó?». El encargo pedía marcar la bandera aunque el envío fallara, con lo que un aviso que nunca llegó queda como enviado.

> **Se reserva antes de enviar.** El encargo enviaba y marcaba después: con dos instancias de la API, el paciente recibe el aviso por duplicado. Aquí la fila se inserta antes de llamar a Resend con `on conflict do nothing`; quien la inserta es quien envía.

> **Ventanas de 23–25 h y 55–65 min.** El proceso corre cada 15 minutos: una ventana exacta de 24 h se saltaría casi todas las citas.

> El disparador manual **solo se registra en desarrollo**. Una ruta que lanza correos a pacientes no debe existir en un servidor accesible.

## AGE-03 · Confirmación desde la app del paciente

`PATCH /api/paciente/citas/:id/confirmar`

| Prueba | Esperado |
|---|---|
| Cita futura programada | **200** `{"estado":"confirmada"}` |
| Repetir | **200**, mismo estado — pulsar dos veces no es un error |
| Cita de otro paciente o inexistente | **404** |
| Cita cancelada o pasada (propia) | **409** con el motivo |
| El profesional la consulta | `"estado":"confirmada"` |

En la app: botón **«Confirmar que asistiré»**, que al pulsarlo pasa a **«✓ Asistencia confirmada»**. Se pinta antes de la respuesta y se revierte si falla.

## AGE-04 · Vista mensual

En Agenda, tres botones: **Lista / Semana / Mes**.

| Paso | Qué comprobar |
|---|---|
| Pulsar **Mes** | Rejilla del mes que contiene el `desde` actual, con los días de relleno de los meses vecinos |
| Cada día | Hasta **tres** citas y «+N más» |
| Colores | Confirmada llena, completada verde, no asistió ámbar, cancelada gris y tachada |
| Pulsar un día | Salta a la vista semanal de esa semana |
| Pulsar una cita | Abre su detalle |
| Hoy | Resaltado |

> Las citas se agrupan por su día **local**. El encargo usaba `cita.inicio.slice(0, 10)`, que es UTC: en América mete las citas de la tarde en el día siguiente.

## AGE-04 · Iniciar consulta desde la cita

En el detalle de una cita **confirmada, o programada y con la hora encima**, aparece **«Iniciar consulta»**. Crea la valoración, marca la cita como completada y navega a `/pacientes/:id/valoracion/:consultaId`.

> No aparece para una cita de dentro de tres semanas: invitaría a abrir consultas que nadie va a atender.

> No se usa `?cita_id=` en la URL como pedía el encargo — no existe ruta `/consultas/nueva` en este proyecto. Se usa el endpoint de la R13.

---

# Rebanada 22 · Diario de comidas y medidas en casa

## Seguridad (las siete rutas)

| Prueba | Esperado |
|---|---|
| Token de profesional en `/api/paciente/diario` | **403** `solo_pacientes` |
| Sin token | **401** |
| Otro profesional sobre `/api/pacientes/:id/registros` | **404** |

## Diario de comidas

### Guardar y leer
| Prueba | Esperado |
|---|---|
| `POST` almuerzo con kcal | **201** con el registro |
| `POST` desayuno **sin** kcal | **201**, `kcal: null` |
| `GET /api/paciente/diario` | Las dos comidas y los totales |
| Reescribir el almuerzo | **UPSERT** — sigue habiendo **dos filas**, no tres |
| `DELETE` de un registro | **204**; baja lógica, la fila se conserva |

### El orden del día, no el alfabético
| Esperado | Resultado |
|---|---|
| `desayuno` antes que `almuerzo` | ✅ tras el arreglo |

> **Volvió a aparecer el fallo de la R9.** `select tipo_comida::text as tipo_comida … order by tipo_comida` resuelve el `ORDER BY` contra el alias de salida, que es texto: sale «almuerzo, desayuno». Se arregla aliando la tabla y ordenando por `rc.tipo_comida`. El comentario que había escrito en esa misma consulta decía cómo evitarlo — y aun así cayó.

### Totales incompletos
Con una comida sin calorías: `kcal: 620`, **`sinEstimar: 1`**.

La pantalla lo dice: «Una comida sin calorías apuntadas: no cuenta en el total». Sumar solo lo que tiene número y presentarlo sin más parece que el paciente comió de menos.

### Serie semanal
`GET /api/paciente/diario/semana?dias=4`:
```json
[{"fecha":"2026-08-11","kcal":0,"comidas":0},
 {"fecha":"2026-08-12","kcal":0,"comidas":0},
 {"fecha":"2026-08-13","kcal":0,"comidas":0},
 {"fecha":"2026-08-14","kcal":220,"comidas":2}]
```
**Los días vacíos salen a cero**, no faltan: una gráfica sin ellos dibuja una línea continua sobre los huecos.

## Medidas en casa

| Prueba | Esperado |
|---|---|
| `POST` peso 77.4 | **201**, `unidad: "kg"` |
| `POST` presión 128/82 con nota | **201**, `unidad: "mmHg"` |
| Presión **80/120** | **400** «La primera cifra (sistólica) debe ser mayor que la segunda» |
| Presión sin diastólica | **400** |
| Peso sin valor | **400** |
| Fecha en el futuro | **400** «Esa fecha todavía no ha llegado» |
| Peso con `unidad: "lb"` | Se guarda como **`kg`** — manda el servidor |
| `GET …/metricas/resumen` | Última lectura de cada tipo, indexada por tipo |

> **Separadas de `medicion_antropometrica`.** La báscula de la clínica está calibrada y se usa siempre igual; la de casa, no. Mezclarlas convierte la línea de peso en ruido. Las dos pantallas lo dicen para que nadie crea que se contradicen.

## Vista del profesional

Ficha del paciente → pestaña **«Sus registros»**.

| Paso | Qué comprobar |
|---|---|
| Diario agrupado por día | Con la franja y las calorías si las hay |
| Medidas | Con el aviso de que se las tomó el paciente y no sustituyen a las de consulta |
| Selector 7 / 14 / 30 días | Recarga el periodo |

> Sin esta pestaña el diario es un cuaderno que nadie lee: el paciente apunta **para que su nutricionista lo mire**.

## App del paciente

Pantalla `/registros`, tercera pestaña de la barra: **Inicio · Plan · Apuntar · Citas · Mensajes**.

| Paso | Qué comprobar |
|---|---|
| Pestañas internas | «Qué comí» y «Mis medidas» — una pantalla, no dos entradas más en la barra |
| Seis franjas | Se despliegan y guardan; la ya escrita aparece rellena al abrirla |
| Selector de día | No deja elegir un día futuro |
| Barras de 7 días | Los días sin registro se ven como marca gris, no como hueco |
| Presión | Dos campos con la barra `/` entre ellos |

Rutas servidas: `/inicio`, `/plan`, `/registros`, `/citas`, `/mensajes` — todas **200**.

---

# Rebanada 23 · Metas, progreso y tareas

> **La meta de peso no existía en el esquema.** Se añade a `conclusion_valoracion` y la escribe el formulario de conclusión de la R15. Es lo que la R16 dejó pendiente: «el día que se registre una meta ponderal, "acercándose al objetivo" pasará a ser computable».

## La meta, desde la valoración

`PUT /api/pacientes/:id/consultas/:cid/conclusion`

| Prueba | Esperado |
|---|---|
| `{"pesoObjetivo":72,"fechaObjetivoPeso":"2026-12-31"}` | **200**, ambos guardados |
| Fecha **sin** peso | La fecha se descarta (`null`) — sola no dice nada |
| `{"pesoObjetivo":5}` | **400** «La meta de peso debe estar entre 20 y 400 kg» |
| Peso sin fecha | Se admite: hay objetivos sin plazo cerrado |

## PAC-05 · Progreso

`GET /api/paciente/progreso?meses=`

Con 80 kg (hace dos meses) → 77,6 kg (hoy) y meta 72 kg:

```json
"avance": { "pesoInicial": 80, "pesoActual": 77.6, "objetivo": 72,
            "recorrido": -2.4, "restante": -5.6, "pctCompletado": 30 }
```

### El fallo que salió al probar
El primer cálculo dijo que había **ganado** 2,4 kg cuando había perdido esa misma cantidad.

Dos mediciones con la misma fecha empatan en `ORDER BY fecha_medicion`, el orden queda a merced del plan de ejecución y el «peso inicial» acabó siendo el más reciente. Dos mediciones el mismo día son plausibles: una corrección, o dos consultas. Se desempata por `created_at`.

### Las dos series no se mezclan
| Campo | Origen |
|---|---|
| `pesoEnConsulta` | `medicion_antropometrica` — báscula calibrada. **Es la que cuenta contra la meta** |
| `pesoEnCasa` | `registro_metrica`, promediado por semana |

> El encargo calculaba el avance con la de casa. Decir «te faltan 2 kg» a partir de una báscula sin calibrar, a una hora cualquiera y vestido, es dar por exacto lo que no lo es.

### Otros casos
| Prueba | Esperado |
|---|---|
| Sin meta registrada | `avance: null`; la pantalla dice que aún no se ha fijado |
| Con meta pero una sola medición | `avance: null` — sin recorrido, un «0 %» sugiere un estancamiento no observado |
| Calorías | Media por **día apuntado**, no por día natural, con `diasConRegistro` |
| Token de profesional | **403** `solo_pacientes` |

## PAC-06 · Tareas

### El profesional las manda
`POST /api/pacientes/:id/tareas`

| Prueba | Esperado |
|---|---|
| Con título, prioridad y fecha | **201** |
| Título en blanco | **400** |
| Paciente de otra clínica | **404** |

### El paciente las ve y las marca
`GET /api/paciente/tareas` — orden: pendientes primero, y dentro de eso lo que vence antes; las que no tienen fecha, al final.

```
2026-08-20   alta    pendiente   Caminar 30 minutos, 5 dias
sin fecha    baja    pendiente   Beber 2 litros de agua
sin fecha    normal  pendiente   Traer analitica de tiroides
```

| Prueba | Esperado |
|---|---|
| `PATCH …/tareas/:id` con `{"completada":true}` | `estado: "completada"` + `completadaEn` |
| Con `{"completada":false}` | Vuelve a `pendiente` y `completadaEn: null` |

> Un solo endpoint para las dos direcciones. El encargo pedía `/completar` y `/descompletar`: es el mismo interruptor, y separarlo duplica la comprobación de propiedad.

### Archivar: cada uno ve lo suyo
| Prueba | Esperado |
|---|---|
| `DELETE /api/pacientes/:id/tareas/:tareaId` | **204** |
| El paciente vuelve a listar | **Ya no aparece** |
| El profesional vuelve a listar | **Sigue apareciendo**, marcada «Retirada» |
| En base | `archivada=1, pendiente=2` — no se borra nada |

## Pantallas

**Paciente** — `/progreso`, alcanzable desde la tarjeta «Tu progreso» de Inicio (no como sexta pestaña: cinco es el máximo en un móvil).

| Paso | Qué comprobar |
|---|---|
| Tarjeta de meta | Barra de avance, «Llevas 30 % del camino», y de dónde sale el número |
| Gráfica | Dos trazos con **leyenda**: consulta firme, casa fino y discontinuo |
| Línea de meta | Discontinua y rotulada, dentro del dibujo aunque quede lejos |
| Selector 3 / 6 / 12 meses | Recarga el periodo |
| Inicio | Las tareas pendientes se marcan desde ahí, con las de prioridad alta señaladas |

**Profesional** — ficha → pestaña **«Sus registros»**, bloque «Tareas»: crear con título, fecha y prioridad; ver estado; retirar.

Rutas servidas: `/inicio`, `/plan`, `/registros`, `/progreso`, `/citas`, `/mensajes` — todas **200**.

---

# Rebanada 24 — Contador de porciones (PAC-07) y biblioteca (PAC-08)

Migraciones **026** y **027**. El encargo pedía la 025 y la 026, ocupadas por la R23.

## Lo que hay que entender antes de leer las pruebas

En modo detallado, `registro_comida` **no se escribe a mano**: sus totales y su descripción los calcula un trigger a partir de los alimentos. De esa fila leen la ficha del profesional (R22) y la media de calorías del progreso (R23), así que si hubiera dos cuentas ninguna pantalla sabría cuál creer.

## El trigger de totales

Probado en transacción con `rollback`, sobre `registro_comida` real:

| Paso | Esperado | Obtenido |
|---|---|---|
| Comida creada, sin alimentos | La descripción provisional intacta | `provisional`, kcal `null` |
| + Arroz blanco cocido 150 g | `Arroz blanco cocido` · 195,0 kcal | ✔ |
| + Pechuga de pollo 100 g | `Arroz blanco cocido, Pechuga de pollo` · 360,0 kcal · 35,1 g prot. | ✔ |
| Se desactiva el arroz (`activo=false`) | `Pechuga de pollo` · 165,0 kcal | ✔ |
| Se **borra** físicamente el último | La fila no se toca (la ruta la archiva) | ✔ |

> El último caso es el que importa: el trigger estaba escrito con `coalesce(new…, old…)` y en un `DELETE` la variable `NEW` no llega a asignarse — leerla lanza un error. Se distingue por `TG_OP`.

## Cantidades: 1½ porciones de pechuga

| Prueba | Esperado | Obtenido |
|---|---|---|
| 150 g de Pechuga de pollo (165 kcal/100 g) | 247,5 kcal · 46,5 g prot. · 5,4 g grasa | ✔ exacto |
| La comida existía en modo simple («Algo ligero, unas 300 kcal») | Queda sustituida por la derivada | `Pechuga de pollo` · 247,5 |
| Consulta de la ficha del profesional (R22, sin tocar) | Muestra la lista de alimentos y el total real | ✔ |

## Búsqueda de alimentos

| Se teclea | Esperado | Obtenido |
|---|---|---|
| `pech` | Pechuga de pollo | ✔ |
| `palta` | Aguacate (sinónimo) | ✔ |
| `platano` sin tilde | Plátano maduro cocido, Banano | ✔ |
| `jitomate` | Tomate (sinónimo mexicano) | ✔ |
| `CAFE` en mayúsculas | Café negro | ✔ |
| categoría `bebidas` | Agua, Café negro, Fresco natural, Gaseosa | ✔ |

> **Fallo encontrado y corregido.** La primera versión normalizaba el término tecleado con la misma función que indexa la tabla. Esa función concatena nombre y sinónimos, así que aplicada a una palabra suelta deja un espacio final: el patrón era `%pech %` y **no encontraba nada**. Las dos primeras pruebas devolvían cero filas. El término se normaliza aparte.

## Catálogo

| Prueba | Esperado |
|---|---|
| Total sembrado | **46** alimentos globales (`clinica_id` nulo) |
| Reejecutar la migración | No duplica (índice único sobre `lower(nombre)`) |
| Alimento de otra clínica | Invisible: solo se ven los globales y los propios |

## Biblioteca — permisos (con `ana@vida.cr` y `luis@vida.cr`)

| Prueba | Esperado | Obtenido |
|---|---|---|
| Ana crea material | **201**, `publicado: false` (nace borrador) | ✔ |
| Luis lo lista | Lo **ve**, con `mio=false`, `puedeEditar=false` | ✔ |
| Luis `PATCH` el recurso | **403 `no_es_tuyo`**, con explicación | ✔ |
| Luis intenta retirarlo | **403 `no_es_tuyo`** | ✔ |
| Ana lo edita | **200** | ✔ |
| Id inventado | **404 `no_encontrado`** | ✔ |

> 403 y no 404 cuando es de un compañero: dentro de la misma clínica el recurso sí existe. El 404 se reserva para lo de otra clínica.

## Biblioteca — ciclo de publicación

| Prueba | Esperado | Obtenido |
|---|---|---|
| `PATCH …/publicacion {publicado:true}` | Se fija `publicadoEn` | `18:12:39Z` |
| Retirar y volver a publicar | **La misma fecha original** | `18:12:39Z` en las tres |
| Filtro `?publicado=false` | 0 borradores | ✔ |
| Filtro `?publicado=true` | 1 publicado | ✔ |
| `DELETE` (archivar) | En base: `activo=false`, `publicado=false`, `publicado_en` intacto | ✔ |
| Listar tras archivar | 0 visibles | ✔ |

> Republicar no convierte material de enero en novedad de agosto.

## Aislamiento entre clínicas

| Prueba | Esperado | Obtenido |
|---|---|---|
| Recursos publicados de otra clínica visibles para María | **0** | ✔ |
| Lista del paciente | Solo lo publicado y activo de su clínica | ✔ |

## Pantallas

**Paciente** — `/biblioteca` y `/biblioteca/:id`, alcanzables desde la tarjeta «Biblioteca» de Inicio. **No** es una sexta pestaña: la barra sigue con cinco.

| Paso | Qué comprobar |
|---|---|
| Diario → conmutador **Rápido / Detallado** | Cambia el cuerpo de cada franja y se recuerda |
| Franja en detallado → «+ Añadir alimento» | Busca, se elige, aparecen ½ · 1 · 1½ · 2 · 3 |
| «Lo pesé» | Cambia a gramos exactos y vuelve |
| Alimento que no está en la lista | Se puede apuntar igual, avisando de que va sin calorías |
| Quitar el último alimento | La comida desaparece del día |
| Biblioteca | Filtros por categoría, punto en lo no leído, «Ver más» |
| Abrir un artículo | Al volver, deja de tener el punto |

**Profesional** — menú lateral → **Biblioteca**: nuevo material, filtros por categoría y estado, publicar/retirar, archivar, contador de lecturas.

### Pendiente de verificar en navegador

El cliente `nutrismart-patient` de Keycloak **sigue sin existir** (ver `docs/REBANADA-19.md § El paso que falta`) y ningún paciente tiene `keycloak_user_id`. Las pruebas de esta rebanada del lado del paciente se hicieron ejecutando las consultas de cada endpoint contra la base con datos reales, no a través de HTTP. El lado profesional sí se probó con tokens.

---

# Keycloak · el cliente del paciente (desbloqueo de R17–R24)

Hasta aquí **ninguna pantalla del paciente se había probado por HTTP**: faltaba el cliente `nutrismart-patient` en el realm. Esta sección deja constancia de cómo se creó y de la primera verificación real.

## Lo que faltaba

| Hallazgo | Estado |
|---|---|
| Cliente `nutrismart-patient` | No existía |
| `registrationAllowed` del realm | `false` — el `action: 'register'` de la activación fallaba |
| Pacientes con `keycloak_user_id` | 0 de 6 |
| Contraseña de admin de Keycloak | **No es `admin/admin`**: está en `KC_BOOTSTRAP_ADMIN_PASSWORD` del contenedor |

## Cliente creado

```
clientId      nutrismart-patient
publicClient  true          PKCE  S256
redirectUris  http://localhost:5175/*
webOrigins    http://localhost:5175
mappers       aud-nutrismart-api          <-- SOLO este
```

> **El mapper `tenant_id` no se copia de `nutrismart-web`.** `requireAuthPaciente` distingue paciente de profesional por la **ausencia** de ese claim. Copiarlo haría que todo paciente se presentase como profesional de una clínica.
>
> **`aud-nutrismart-api` sí es imprescindible**: sin él la API rechaza el token por audiencia.

Token del usuario de prueba, comprobado: `aud=[nutrismart-api, account]`, `tenant_id` **ausente**.

## Vinculación por el flujo real de la R17

En vez de un `UPDATE` a mano sobre `keycloak_user_id`, se usó el flujo que existe. Es la primera vez que se ejercita completo:

| Paso | Resultado |
|---|---|
| `POST /api/pacientes/:id/invitar` (token de Ana) | 200 · enlace + caducidad a 7 días |
| El correo no sale (Resend en sandbox) | La API **degrada bien**: `emailEnviado:false` y devuelve el enlace |
| `GET /api/invitacion/:token` (pública) | «María Fernández» · «Clínica Nutrición Vida» |
| `POST /api/invitacion/:token/vincular` (token del paciente) | 200 · invitación pasa a `aceptada` |

## Primera prueba por HTTP de todas las pantallas del paciente

| Endpoint | Rebanada | HTTP |
|---|---|---|
| `/api/paciente/yo` · `/dashboard` | R17 | 200 |
| `/api/paciente/plan` | R20 | 200 |
| `/api/paciente/citas` | R21 | 200 |
| `/api/paciente/diario` | R22 | 200 |
| `/api/paciente/progreso` · `/tareas` | R23 | 200 |
| `/api/paciente/configuracion` · `/alimentos` · `/recursos` | R24 | 200 |

## Modo detallado (R24), ya por HTTP

| Prueba | Esperado | Obtenido |
|---|---|---|
| `PATCH /configuracion {"modoDiario":"detallado"}` | Se guarda | ✔ |
| `POST /diario/items` — pechuga 150 g, sin comida previa | Crea la comida y el ítem | `registroId` + 247,5 kcal |
| Segundo ítem — arroz 150 g | Mismo `registroId`, totales sumados | `Pechuga de pollo, Arroz blanco cocido` · 442,5 kcal |
| Ficha del profesional (R22, sin tocar) | Muestra la lista y el total | ✔ idéntico |
| `DELETE` de un ítem | `comidaVacia:false`, total baja a 247,5 | ✔ |
| `DELETE` del último | `comidaVacia:true`, la comida desaparece del día | ✔ |

## Aislamiento entre roles

| Prueba | Esperado | Obtenido |
|---|---|---|
| Token de **paciente** en `/api/pacientes` | Rechazo | **401** `unauthorized` |
| Token de **profesional** en `/api/paciente/yo` | Rechazo explicativo | **403** `solo_pacientes` |

## Credenciales de prueba

```
usuario   paciente-prueba   (o maria.fernandez@ejemplo.cr)
clave     Test1234!
app       http://localhost:5175
vinculado a  María Fernández · Clínica Nutrición Vida
```

## Dos avisos

**`directAccessGrants` está activado** en `nutrismart-patient`. El encargo lo ponía en `false`; se activó porque sin él no hay forma de obtener un token del paciente desde la línea de comandos y nada de lo de arriba se podría haber verificado. Es lo mismo que tiene `nutrismart-web` en este realm de desarrollo. **En producción debe ir a `false`**: el navegador solo necesita el flujo de código de autorización.

**La paciente vinculada no tiene datos clínicos.** La base se reinició en algún momento: 0 consultas, 0 mediciones, 0 citas para María. Los endpoints responden 200 con el estado vacío correcto, pero las pantallas del paciente saldrán en blanco hasta que se cargue una consulta con conclusión.

---

# Validación del portal del paciente (con `nutrismart-patient` ya creado)

Primera pasada completa por HTTP sobre las rutas del paciente. Token obtenido habilitando `directAccessGrants` en el cliente, y **deshabilitado otra vez al terminar**.

Paciente de prueba: **María Fernández** (`paciente-prueba` / `Test1234!`).

## Resultados

| Sección | Endpoint real | Resultado |
|---|---|---|
| Perfil | `GET /api/paciente/yo` | ✓ 200 |
| Perfil | `GET /api/paciente/configuracion` | ✓ 200 |
| Perfil | `PATCH /api/paciente/configuracion` (ida y vuelta simple↔detallado) | ✓ 200 |
| Agenda | `GET /api/paciente/citas` | ✓ 200 · sin citas |
| Diario | `GET /api/paciente/diario` · `/diario/semana` | ✓ 200 |
| Diario | `POST /api/paciente/diario` | ✓ 201 |
| PAC-07 | `GET /api/paciente/alimentos?q=` — pollo · arroz · palta · jitomate | ✓ 200 los cuatro |
| PAC-07 | `POST /api/paciente/diario/items` — 1 porción · ½ porción · alimento libre | ✓ 201 los tres |
| PAC-08 | `GET /api/paciente/recursos` | ✓ 200 |
| Métricas | `GET /api/paciente/metricas` · `/metricas/resumen` | ✓ 200 |
| Métricas | `POST` peso 72,5 kg · glucosa 95 · presión 120/80 | ✓ 201 los tres |
| Progreso | `GET /api/paciente/progreso` · `/tareas` | ✓ 200 |
| Plan | `GET /api/paciente/plan` | ✓ 200 · sin plan aún |
| Mensajería | `GET /api/paciente/dashboard` · `/conversacion` | ✓ 200 |

## Validaciones que deben fallar, y fallan

| Prueba | Esperado | Obtenido |
|---|---|---|
| Sin token | 401 | ✓ 401 |
| Token inventado | 401 | ✓ 401 |
| Token de **profesional** en zona de paciente | 403 explicativo | ✓ 403 `solo_pacientes` |
| Token de **paciente** en `/api/pacientes` y `/api/recursos` | Rechazo | ✓ 401 |
| Ítems de una comida ajena | 404, sin distinguir de inexistente | ✓ 404 |
| Presión invertida (80/120) | Rechazo | ✓ 400 «la primera cifra debe ser mayor» |
| `tipo_comida` en snake_case | Rechazo | ✓ 400 |

## Los totales derivados, comprobados sobre datos reales

La comida se creó primero **en modo simple** («Avena con fruta», 350 kcal a ojo) y después se le añadieron alimentos. El trigger sustituyó lo tecleado por la suma real:

```
descripcion : Avena cocida, Avena cocida, Pan casero de la abuela
kcal        : 266.3     (250 g + 125 g de avena a 71 kcal/100 g; el pan sin estimar)
```

Es exactamente lo que la R24 buscaba: no quedan dos cuentas para la misma comida.

## Rutas que el guion de validación esperaba y no existen

Ninguna es un fallo del sistema; son nombres o conceptos que el guion daba por hechos.

| Esperada | Realidad |
|---|---|
| `GET /api/alimentos/buscar` | `GET /api/paciente/alimentos` |
| `GET /api/paciente/biblioteca` | `GET /api/paciente/recursos` — y no es una lista de alimentos favoritos, es material educativo |
| `GET /api/paciente/diario/hoy` | `/api/paciente/diario` ya devuelve hoy por defecto |
| `GET /api/paciente/plan/activo` | `/api/paciente/plan` ya devuelve el vigente |
| `GET /api/paciente/metricas/ultimas` | `/api/paciente/metricas/resumen` |
| `GET /api/paciente/recordatorios` | No existe: los recordatorios de la R21 son correos que envía el servidor, el paciente no los consulta |
| `PATCH /configuracion {"fondo":…}` | El selector de fondo es de la R25; hoy solo hay `modoDiario` |
| `tipo: "presion_sistolica"` | `presion_arterial` con `sistolica` y `diastolica` — media presión no es un dato clínico |
| Tabla `paciente_biblioteca` | No existe |
| `psql $DATABASE_URL` | La base solo escucha dentro de Docker: `docker exec nutrismart-db psql` |

## Estado del paciente de prueba tras la sesión

```
registros_diario 1     items_diario 3     metricas 3     configuracion 1
```

Sigue **sin datos clínicos** (0 consultas, 0 mediciones de consulta, 0 citas, sin plan): las pantallas de Plan, Citas y Progreso saldrán vacías con su mensaje correspondiente. Diario, Registros y Biblioteca sí tienen con qué pintarse.

---

# Rebanada 25 — Perfil y fondo del paciente (PAC-09)

Migración **028**. Los siete temas viven en `packages/design-system/tokens.css` como bloques `[data-fondo="…"]`, el mismo mecanismo que las paletas de marca. En el código de la app no hay ni un color.

## Lo que el fondo NO puede hacer

| Prueba | Esperado |
|---|---|
| Elegir cualquiera de los 7 fondos | `--primary`, `--primary-hover` y `--primary-tint` **no cambian** |
| Clínica con `data-brand="esmeralda"` + paciente con fondo «Calma» | Botones esmeralda sobre fondo azul |

> Los acentos que proponía el encargo eran los mismos valores que las paletas de marca ya curadas. Aplicarlos habría hecho que elegir un fondo cambiase la marca de la clínica.

## Configuración

| Prueba | Esperado | Obtenido |
|---|---|---|
| `GET /api/paciente/configuracion` | modo, fondo, foto, nombre visible y nombre de expediente | ✓ 200 |
| `PATCH {"fondo":"verde"}` | Se guarda | ✓ `{"modoDiario":"simple","fondo":"verde"}` |
| `PATCH {"fondo":"arcoiris"}` | Rechazo | ✓ 400 «Ese fondo no existe» |
| `PATCH {"modoDiario":"detallado"}` — solo el modo | **El fondo sobrevive** | ✓ `fondo` sigue `verde` |

> La última es la que importa: si el `PATCH` no fuera parcial, el selector de fondo tendría que reenviar el modo del diario y a la larga uno pisaría al otro.

## Perfil

| Prueba | Esperado | Obtenido |
|---|---|---|
| `PATCH {"nombrePreferido":"Mari"}` | `nombre` pasa a Mari | ✓ y `nombreExpediente` sigue «María Fernández» |
| `PATCH {"nombrePreferido":null}` | Vuelve al del expediente | ✓ |
| `PATCH` nombre de 60 caracteres | Rechazo | ✓ 400 «entre 1 y 50» |
| `PATCH {}` | Rechazo | ✓ 400 «No hay nada que cambiar» |

## La foto: solo `https://`

El valor acaba en el atributo `src` de un `<img>` de la aplicación. `new URL()` a secas —lo que pedía el encargo— acepta las tres primeras:

| Se manda | Esperado | Obtenido |
|---|---|---|
| `http://ejemplo.cr/f.jpg` | Rechazo | ✓ 400 «debe empezar por https://» |
| `javascript:alert(1)` | Rechazo | ✓ 400 |
| `data:image/svg+xml;base64,…` | Rechazo | ✓ 400 |
| `no es una url` | Rechazo | ✓ 400 «Escribe una dirección web completa» |
| `https://i.pravatar.cc/200` | Se guarda | ✓ 200 |

## `null` borra, ausente no toca

| Prueba | Esperado | Obtenido |
|---|---|---|
| Con foto guardada, `PATCH {"nombrePreferido":"Mari F."}` | La foto **sigue ahí** | ✓ |
| `PATCH {"fotoUrl":null}` | Se borra | ✓ `fotoUrl: null` |

> Sin distinguir «ausente» de «null» no habría forma de quitar una foto.

## Compilación

| Prueba | Obtenido |
|---|---|
| `tsc` en las tres apps | Sin errores |
| `vite build` de la app del paciente | ✓ en 8,4 s |
| Los 7 bloques `[data-fondo]` en el CSS compilado | ✓ los siete |

## Pantallas

**Paciente** — `/perfil`, alcanzable desde el **avatar de la cabecera de Inicio**. No es una sexta pestaña.

| Paso | Qué comprobar |
|---|---|
| Cabecera de Inicio | Degradado del tema, saludo según la hora, avatar pulsable |
| Perfil → nombre | Al escribir «Mari», la cabecera saluda «Mari» y debajo dice «En tu expediente: María Fernández» |
| Perfil → foto | La vista previa cambia al escribir; una URL rota cae a las iniciales, no al icono roto |
| Perfil → 7 fondos | El cambio se ve **al instante**, y en las otras siete pantallas al navegar |
| Fondo «Oscuro» | Invierte también tarjetas, bordes y tinta — no es un degradado oscuro con tarjetas blancas |
| Perfil → expediente | El nombre clínico se ve pero **no se edita** |

## Estado del paciente de prueba

```
modo_diario  simple      fondo  verde      foto_url  (vacío)      nombre_preferido  (vacío)
```

---

# Datos de desarrollo — María Fernández

`apps/api/seeds/dev-maria.sql`. Ids fijos y todo con `ON CONFLICT`: **reejecutable sin duplicar** (comprobado). Solo toca la clínica de María; los dos cebos «NO DEBE APARECER» de la clínica 9999 se quedan a cero.

```
docker exec -i nutrismart-db psql -U nutrismart -d nutrismart < apps/api/seeds/dev-maria.sql
```

## Qué crea

| Tabla | Contenido |
|---|---|
| `consulta` | 2 finalizadas: inicial 13-05-2026, seguimiento 14-07-2026 |
| `medicion_antropometrica` | 80,0 → 77,6 kg · talla 162 · cintura 92 → 88,5 |
| `conclusion_valoracion` | 1750 kcal · 25/45/30 · 3 acuerdos · **meta 72 kg para el 15-12-2026** |
| `plan_alimentario` + `plan_comida` | Plan activo con el lunes completo (5 tiempos) |
| `cita` | 1 completada (14-07) + 1 programada (21-08) |
| `registro_metrica` | 6 pesos de casa entre el 16-07 y el 13-08 |
| `tarea_paciente` | 1 pendiente, vence el 24-08 |
| `recurso` | 1 publicado, categoría nutrición |

## La aritmética está elegida, no es al azar

| Dato | Valor | Por qué |
|---|---|---|
| Avance | **30 %** | 80 → 77,6 de 80 → 72. Es el mismo caso que validó la R23 |
| IMC | 30,48 → **29,57** | Cruza de obesidad grado I a sobrepeso |
| Macros | 109,4 / 196,9 / 58,3 g | 1750 kcal al 25/45/30, cuadrado |
| Peso en casa | 78,1 · 77,8 · 78,0 · 77,5 · 77,3 · 77,1 | Oscila a propósito: una báscula doméstica a horas distintas no da una línea recta, y si la diera la gráfica estaría mintiendo |

## Dos cosas que salieron al comprobarlo

**La media de la última semana daba 75,6 kg.** Arrastraba el peso de 72,5 kg insertado como prueba en la sesión de validación. Se **archivó** (`activo = false`), no se borró: es la regla del proyecto. La media quedó en 77,2.

**El diagnóstico no cuadraba con el IMC.** Decía «Obesidad grado I» cuando el IMC de la segunda consulta es 29,57, que es sobrepeso. Corregido a «Sobrepeso con perímetro de cintura de riesgo» (E66.3), y las observaciones explican el matiz que el dato enseña: el IMC bajó de categoría pero la cintura (88,5 cm) y el ICC (0,859) siguen sobre el umbral de riesgo en mujeres, así que la pauta se mantiene.

## Verificado tras el seed

| Endpoint | Antes | Ahora |
|---|---|---|
| `/api/paciente/progreso` | `avance: null` | 30 %, dos series de peso |
| `/api/paciente/plan` | «todavía no ha cerrado una consulta» | 1750 kcal, macros y 3 acuerdos |
| `/api/paciente/citas` | Vacío | Próxima 21-08 + historial |
| `/api/paciente/dashboard` | Todo `null` | Peso, próxima cita y plan |
| `/api/paciente/diario` → `objetivo` | `null` | 1750 kcal con sus macros |
| `/api/paciente/tareas` · `/recursos` | Vacíos | 1 y 1 |
| Lado profesional | — | Expediente, consultas, antropometría, planes, registros, tareas y comparativa: todo 200 |

---

# Rebanada 26 — Bienestar, medidas corporales y monitoreo (RPM-01 / RPM-02)

Migraciones **029** y **030**. Primera rebanada del diferenciador ancla: el seguimiento continuo.

## Lo que habría roto el panel entero

Las cinco consultas del panel leen `registro_metrica.fecha`. **Esa columna no existe**: la tabla tiene `medido_en` (`timestamptz`). Copiado tal cual, el panel habría respondido 500 en su primera petición.

## La fuga entre profesionales

| Prueba | Esperado | Obtenido |
|---|---|---|
| Ana (`admin_clinica`) lista el panel | Toda la clínica | ✓ **3 pacientes** |
| Luis (`nutricionista`) lista el panel | Solo los suyos | ✓ **2 pacientes**, María no aparece |
| Luis pide el detalle de María | Rechazo indistinguible de «no existe» | ✓ **404** |
| Ana pide el detalle de María | Adelante | ✓ 200 |

> El encargo consultaba `WHERE p.clinica_id = $1` a secas, lo que habría enseñado a cada nutricionista el peso, los síntomas y las notas de los pacientes de sus compañeros.

## Bienestar

| Prueba | Esperado | Obtenido |
|---|---|---|
| `GET` sin partes | Lista vacía, racha 0, catálogo de síntomas | ✓ 200 |
| `PUT estado 4` + fatiga + insomnio + nota con tildes | Se guarda | ✓ 200 |
| `PUT` el mismo día con estado 5 | **Corrige**, no duplica | ✓ un solo parte |
| `PUT estado 9` | Rechazo | ✓ 400 «del 1 al 5» |
| `PUT sintomas:["jaqueca"]` | Rechazo | ✓ 400 «no reconocemos» |
| `GET` tras contestar | `racha: 1` | ✓ |

> El catálogo de 13 síntomas lo cierra un `CHECK` en la base, no solo el código. Si fuera texto libre, «jaqueca», «dolor de cabeza» y «me duele la cabeza» serían tres cosas y no se podría contar ninguna.

## Medidas corporales

| Prueba | Esperado | Obtenido |
|---|---|---|
| `PUT` cintura 88,5 + cadera 103 + brazo 29,8 | Se guarda | ✓ 201 |
| `PUT` solo cintura 87 el mismo día | **La cadera sobrevive** | ✓ cadera sigue 103 |
| `PUT` sin ninguna medida | Rechazo | ✓ 400 «apunta al menos una» |
| `PUT` cintura 4 cm | Rechazo | ✓ 400 «entre 20 y 300 cm» |
| `PUT` con fecha anterior (15-07) | Se guarda como otro día | ✓ 201 |
| `GET` con dos tomas | Cambio calculado | ✓ cintura **−4 cm**, cadera **−2 cm** |
| Medidas con una sola toma | `null`, no cero | ✓ pecho, muslo y cuello en `null` |

> Un cambio de cero parecería estancamiento; `null` dice la verdad, que es que falta otra toma.

## El detalle del profesional

| Prueba | Obtenido |
|---|---|
| `GET /api/rpm/pacientes/:id?meses=3` | 8 métricas, 1 parte, 2 medidas, 1 día de diario |
| Síntomas agregados | `fatiga ×1`, `insomnio ×1` |
| Días con comidas sin estimar | Se señalan aparte del total |

### `meses` fuera de rango no rompe la consulta

El encargo interpolaba `INTERVAL '${meses} months'` como texto. Ahora es `make_interval(months => $3)`:

| Se pide | Se aplica |
|---|---|
| `meses=99` | 12 (tope) |
| `meses=abc` | 3 (por defecto) |
| `meses=-5` | 3 |

## Compilación y despliegue

| Prueba | Obtenido |
|---|---|
| `tsc` en las tres apps | Sin errores |
| App del paciente: pestañas «Cómo estoy» y «Cuerpo» en el bundle | ✓ |
| App profesional en 5173 | La sirve un **dev server de Vite**, no el contenedor; recoge los cambios por HMR |
| CORS para 5175 y 5173 | ✓ los dos |

## Pantallas

**Paciente** — Mis registros, ahora con **cuatro** pestañas: `Cómo estoy · Qué comí · Peso y más · Cuerpo`. La barra inferior sigue con cinco.

| Paso | Qué comprobar |
|---|---|
| «Cómo estoy» | Cinco caras **con etiqueta** (una fila de caras sin texto se interpreta distinto según quién mire) |
| Síntomas | Se tocan y se quitan; la nota va plegada |
| Volver a entrar el mismo día | Aparece lo que ya puso, para corregir en vez de empezar de cero |
| Tira de 14 días | Los días sin parte son **huecos**, no se rellenan con el valor anterior |
| «Cuerpo» | Se pueden dejar medidas en blanco; con dos tomas aparece la línea y el cambio |

**Profesional** — menú lateral → **Monitoreo**.

| Paso | Qué comprobar |
|---|---|
| Orden por defecto | Los que llevan más sin reportar, y **«Nunca» va primero** |
| Columna «Sin reportar» | Distingue «Nunca» de «Hace N días»; a partir de 7 días cambia de color |
| Clic en una fila | Detalle con 1/3/6/12 meses |
| Detalle | Dice explícitamente que el bienestar **es lo que reporta el paciente**, no una exploración |

---

# Rebanada 27 — Alertas de seguimiento (RPM-03)

Migraciones **031** y **032**.

## Las tres trampas del ruido

Un sistema de alertas mal hecho hace que se dejen de mirar las alertas. Las tres estaban en el encargo.

### La alerta que no se cierra nunca

| Prueba | Esperado | Obtenido |
|---|---|---|
| Regla `peso > 75` (María pesa 77,1) | Se abre 1 alerta | ✓ `abiertas: 1` |
| Se sube el umbral a 90 | La alerta **se cierra sola** | ✓ `resueltas: 1`, `resueltaAuto: true` |
| Listado de abiertas | Vacío | ✓ 0 |

### El dato viejo que alerta cada día

Juan con **95 kg medidos hace 60 días** y nada más desde entonces:

| Regla | Esperado | Obtenido |
|---|---|---|
| `peso > 90`, ventana **14** días | No dispara: el dato es viejo | ✓ `omitidasPorAntiguedad: 1` |
| `peso > 90`, ventana **90** días | Dispara | ✓ `abiertas: 1` |

> Sin la ventana, ese paciente generaría una alerta nueva **todos los días para siempre** sobre una medición de hace dos meses.

### Dos reglas sobre la misma métrica

| Prueba | Esperado | Obtenido |
|---|---|---|
| `peso > 75` y `peso < 60` a la vez | Ambas existen, cada una con su cuenta | ✓ `abiertas: 1` y `abiertas: 0` |

> El encargo ponía la clave única en `(paciente, métrica, día)`: la segunda regla nunca habría alertado, y el `ON CONFLICT DO NOTHING` lo habría hecho en silencio.

## Idempotencia

| Prueba | Esperado | Obtenido |
|---|---|---|
| Reevaluar con la misma regla | No duplica | ✓ `abiertas: 0`, sigue habiendo 1 alerta |

## «Vista» y «atendida»

| Prueba | Esperado | Obtenido |
|---|---|---|
| `PATCH estado=reconocida` | Sigue abierta | ✓ |
| Reevaluar tras «vista» | **No** crea otra | ✓ `abiertas: 0`, total sigue 1 |
| `PATCH estado=resuelta` | Se cierra | ✓ |
| Reevaluar con el problema aún presente | **Vuelve a abrirse** | ✓ `abiertas: 1` |
| Cerrar una ya cerrada | Rechazo | ✓ 404 |
| `estado: "ignorada"` | Rechazo | ✓ 400 |

> «Atendida» que se reabre es correcto: el profesional dijo que estaba resuelta y no lo estaba. Para «la he visto, no me la repitas» está «vista».

## Aislamiento entre profesionales

| Prueba | Esperado | Obtenido |
|---|---|---|
| Luis pone una regla a María (paciente de Ana) | Rechazo indistinguible de «no existe» | ✓ **404** |
| Luis lee las reglas de María | Rechazo | ✓ **404** |
| Luis lista alertas | Solo las de sus pacientes | ✓ 1 (Juan) |
| Ana (`admin_clinica`) lista alertas | Toda la clínica | ✓ |

## Validación

| Prueba | Obtenido |
|---|---|
| `umbral: 0` en `dias_sin_diario` | 400 «entre 1 y 365» |
| Umbral de bienestar fuera de 1–5 | Rechazado por `CHECK` y por la API |

## Métricas de silencio

| Caso | Comportamiento |
|---|---|
| Apuntó comida hoy | `dias_sin_diario = 0` |
| Activó cuenta y nunca apuntó nada | Se cuenta **desde la activación** (`invitacion_paciente.usado_en`) |
| Nunca activó cuenta | No se evalúa: no puede apuntar, y avisar de eso a diario es ruido |

## El panel RPM ya trae el conteo

`GET /api/rpm/pacientes` devuelve `alertasAbiertas`, que la R26 dejó deliberadamente fuera para no enseñar un `0` que hiciera creer que se había comprobado.

## Pantallas

**Profesional** — Monitoreo → clic en un paciente → bloque **«Alertas abiertas» / «Qué vigilar»**.

| Paso | Qué comprobar |
|---|---|
| Lista de monitoreo | Ordena por defecto por **alertas abiertas**; sin alertas se pinta «—», no un 0 |
| Cabecera | «N alertas abiertas» en color de aviso cuando las hay |
| Poner una regla | Se evalúa **al guardar**, no hay que esperar al día siguiente |
| Métricas de silencio | No preguntan ventana de frescura: ahí la falta de datos ES la medida |
| Retirar una regla | Cierra también sus alertas abiertas |

## Dato de prueba que queda en la base

Juan Ramírez tiene un peso de 95 kg fechado 60 días atrás, con la nota `DATO DE PRUEBA (R27)`. Se insertó para verificar la ventana de frescura. Para quitarlo:

```sql
update registro_metrica set activo = false
 where id = 'e9000001-0000-4000-8000-000000000001';
```

---

# Rebanada 28 — Clínica y equipo (GAM-01 / GAM-02)

Migraciones **033** y **034**.

## Lo que ya existía y no se duplicó

| El encargo añadía | Ya existe desde |
|---|---|
| `clinica.logo_url`, `color_primario`, `color_secundario` | **R6**, en `brand_config`, con pantalla propia y contraste WCAG |
| Enum `profesional_rol ('admin','nutricionista')` | Ya existe con **`admin_clinica`**, `nutricionista` |
| `profesional.email` | `correo` |
| `profesional.activo` | `estado` (`activo`, `invitacion_pendiente`, `inactivo`) |

> El `DO … EXCEPTION WHEN duplicate_object THEN NULL` del encargo habría pasado de largo en silencio dejando el enum con sus valores reales, y después todo el código que compara `rol = 'admin'` no habría coincidido nunca. Ningún error y ningún administrador.

## Quién es administrador: token Y base

| Prueba | Esperado | Obtenido |
|---|---|---|
| Ana (rol en token y en base) | Entra | ✓ 200 |
| Luis (nutricionista) | Rechazo explicativo | ✓ **403 `solo_administradores`** |
| Ana degradada **solo en la base**, con el token intacto | Rechazo | ✓ **403** |
| `GET /api/profesional/yo` en ese estado | Dice cuál falta | ✓ `esAdmin:false, adminEnToken:true, adminEnBase:false` |
| Se restaura el rol en la base | Vuelve a entrar | ✓ 200 |

> La columna **puede quitar pero nunca dar**. Si bastara ella, cambiar un rol desde esta misma pantalla otorgaría permisos que Keycloak no ha dado.

## Datos de la clínica

| Prueba | Esperado | Obtenido |
|---|---|---|
| `PATCH` teléfono y dirección | Se guardan | ✓ 200 |
| `sitioWeb: "http://…"` | Rechazo | ✓ 400 «debe empezar por https://» |
| `sitioWeb: "https://…"` | Se guarda | ✓ 200 |
| `zonaHoraria: "Marte/Olympus"` | Rechazo | ✓ 400 «esa zona horaria no existe» |
| `zonaHoraria: "America/Panama"` | Se guarda | ✓ 200 |
| `nombreComercial: ""` | Rechazo | ✓ 400 «la clínica necesita un nombre» |
| Cuerpo vacío | Rechazo | ✓ 400 |

> La zona horaria se valida contra `pg_timezone_names`, la lista real del servidor. No cabe en un `CHECK` —Postgres no admite subconsultas ahí— así que la comprueba la API.

## Alta de profesionales

| Prueba | Esperado | Obtenido |
|---|---|---|
| Correo inválido | Rechazo | ✓ 400 |
| Alta correcta | **`invitacion_pendiente`**, no activo | ✓ 201 |
| Mismo correo otra vez | Rechazo | ✓ 409 `correo_repetido` |
| Rol inventado | Rechazo | ✓ 400 |
| Correo de bienvenida | Sale por Resend (sandbox lo rechaza) y **no tumba el alta** | ✓ la ficha queda creada |

> Nace en `invitacion_pendiente` porque esta fila **no crea la cuenta**: eso lo hace el administrador de Keycloak. Decir «activo» sería afirmar que ya puede entrar.

## El último administrador

| Prueba | Esperado | Obtenido |
|---|---|---|
| Ana se degrada siendo la única admin | Rechazo | ✓ 409 `ultimo_administrador` |
| Ana se da de baja a sí misma | Rechazo | ✓ 409 |

> Una clínica sin administrador activo no puede recuperarlo desde la aplicación: nadie podría entrar a esta pantalla a arreglarlo.

## Dar de baja a quien tiene pacientes

Esto no estaba en el encargo y es lo que más se nota en una clínica real.

| Prueba | Esperado | Obtenido |
|---|---|---|
| Baja de Luis (2 pacientes) sin decir a quién pasan | Se pregunta | ✓ 409 `tiene_pacientes`, `pacientes: 2` |
| Reasignando a alguien sin cuenta activa | Rechazo | ✓ 400 |
| Reasignando a Ana | Baja + traspaso en el mismo paso | ✓ 200, Ana pasa de 1 a 3 pacientes |

> Sin esto, `paciente.nutricionista_id` apuntaría a un inactivo y esos pacientes dejarían de verse en la agenda y en el monitoreo de todos menos del administrador, sin que nadie se entere.

## Pantallas

Menú lateral, tres entradas nuevas para administradores: **Clínica · Equipo · Marca** (la última se llamaba «Configuración»).

| Paso | Qué comprobar |
|---|---|
| Clínica | Nombre fiscal, país y subdominio se **ven pero no se editan** (los fija el operador) |
| Clínica → zona horaria | Dice que hoy las agendas siguen usando la hora de Costa Rica, en vez de prometer lo que no hace |
| Clínica → identidad visual | **Enlaza** a `/ajustes/marca`, no duplica colores ni logo |
| Equipo | Estado «Sin cuenta todavía» para quien está de alta sin Keycloak |
| Equipo → dar de baja con pacientes | Aparece la pregunta de a quién pasan, no un error rojo |
| Equipo → pie | Avisa de que conceder admin necesita además el rol en Keycloak |
| Entrar como Luis | Las tres entradas no aparecen; tecleando la URL vuelve a Pacientes |

---

# Rebanada 29 — Tendencia y exportación (GAM-03)

Sin migraciones. Va **dentro** del dashboard de la R8, no en una segunda entrada de menú: aquel responde «qué pasa hoy» y esto «cómo va la clínica».

## Estadísticas

| Prueba | Obtenido |
|---|---|
| `GET /api/admin/estadisticas` (Ana) | 200 · 3 activos, 1 dado de baja, 3 altas este mes |
| Serie mensual | **12 meses**, los vacíos con `0` (solo 07 y 08 traen datos) |
| Por profesional (90 días) | Ana 1 paciente / 2 citas / 1 completada · Luis 2 / 0 / 0 |
| Luis (nutricionista) | **403 `solo_administradores`** |

## La adherencia, bien medida

| | |
|---|---|
| Obtenido | `pct: 14.3, conApp: 1, activos: 3, diasConRegistro: 1` |

> El encargo dividía entre **todos** los pacientes activos. Un paciente sin cuenta activada no puede apuntar nada: contarlo como incumplidor hunde el número por un motivo que no es la adherencia. Se calcula sobre quien tiene la aplicación, y la pantalla dice el denominador. Con nadie activado devuelve `null`, no `0`: un 0 % diría que nadie apunta, y lo que pasa es que nadie puede.

## Exportación

| Prueba | Obtenido |
|---|---|
| `GET /exportar/pacientes` | 200 · `text/csv; charset=utf-8` · 4 filas |
| BOM al principio | ✓ `efbbbf` — sin él Excel abre «Fernández» como «FernÃ¡ndez» |
| `GET /exportar/citas?desde=&hasta=` | 200 · horas en hora local (09:00 y 10:00, no 15:00Z) |
| `?desde=ayer` | 400 «las fechas deben ir como AAAA-MM-DD» |
| `desde` posterior a `hasta` | 400 «la fecha de inicio va antes que la de fin» |
| Luis en cualquiera de las dos | 403 |
| Sin token | 401 |

## Fórmulas en el CSV

El `toCSV` del encargo escapaba comillas y saltos de línea, pero no las fórmulas. Excel y LibreOffice **ejecutan** lo que empieza por `=`, `+`, `-` o `@`, y aquí se exportan nombres y motivos que escribe una persona.

| Se guarda como motivo de cita | Sale en el CSV |
|---|---|
| `=HYPERLINK("http://malo.example","Ver informe")` | `"'=HYPERLINK(""http://malo.example"",""Ver informe"")"` |

> El apóstrofo es lo que las hojas de cálculo entienden como «esto es texto». No se ve al abrirlo.

## El rastro de la exportación

| Prueba | Obtenido |
|---|---|
| Tras exportar, en el log del contenedor | `exportacion de pacientes \| admin: Dra. Ana Rodríguez \| filas: 4` |

> Escrito como `info` no habría servido: en producción el logger está en `warn`, así que el rastro solo existiría en desarrollo — justo donde no hace falta. Va como `warn`. Una tabla de auditoría en condiciones merece su propia rebanada.

## Pantallas

**Profesional (solo administrador)** — menú lateral → **Dashboard**, sección inferior «Cómo va la clínica».

| Paso | Qué comprobar |
|---|---|
| Barras de 12 meses | Los meses sin citas aparecen; las completadas van **dentro** de la barra, no al lado |
| Uso de la aplicación | Dice el denominador, no solo el porcentaje |
| Por profesional | Sin citas en 90 días **no** se pinta «0 %» |
| Exportar pacientes | Descarga `pacientes.csv`, se abre con acentos correctos |
| Exportar citas | Sin fechas sale el último mes; con rango, el rango |

---

# Un bucle de login que costó cinco diagnósticos

Vale la pena dejarlo escrito: el síntoma apuntaba a un sitio y la causa estaba en otro.

## El síntoma

La aplicación profesional parpadeaba y acababa mostrando **«Invalid parameter: redirect_uri»**. El log de Keycloak decía:

```
The size of OIDC parameter 'redirect_uri' size is longer (4012) than allowed (4000).
Ignoring the parameter.
```

## La causa

En `App.tsx`, `useYo()` se llamaba **antes** de comprobar que Keycloak hubiera terminado de inicializar. Su efecto lanza `apiGet('/api/profesional/yo')` nada más montar; esa petición pasa por `tokenVigente()`, que llamaba a `updateToken()` sobre un Keycloak sin inicializar, fallaba, y el `catch` hacía **`keycloak.login()`** — una redirección completa.

Pedir el perfil → redirigir al login → volver → montar → pedir el perfil. **Cuatro o cinco vueltas por segundo.**

El `redirect_uri` de 4012 caracteres era la **consecuencia**, no la causa: `keycloak-js` usa `window.location.href` como destino por defecto, y cada vuelta le pegaba su fragmento. Al pasar de 4000 caracteres Keycloak lo descartaba, y ahí terminaba el bucle con el error.

## Por qué costó encontrarlo

`eventsEnabled` estaba en `false` en el realm. Keycloak solo escribe los **errores** en el log del servidor: como **cada login del bucle era correcto**, no dejaba ni una línea. Se veía un bucle sin ningún error registrado, lo que llevó a tres diagnósticos equivocados (el host de la URL, la caché del navegador, y una «limpieza» de `sessionStorage` que además rompía la vuelta legítima del login).

Al activar el registro de eventos aparecieron **20 `LOGIN` + 20 `CODE_TO_TOKEN` seguidos, sin un solo fallo**. Eso apuntó directo al sitio correcto.

## Lo corregido

| Cambio | Por qué |
|---|---|
| `useYo(estado === 'autenticado')` | No pedir datos antes de que haya sesión |
| `tokenVigente()` comprueba `keycloak.authenticated` primero | El mismo descuido da ahora un **error visible**, no un bucle |
| `redirectUri` fijado a `origen + ruta` en `init()` y en el relogin | La URL no puede crecer |

## La regla que queda

**Ninguna llamada a la API antes de que `estado === 'autenticado'`.** Toda petición pasa por `tokenVigente()`, y esa función redirige. Un hook que se salte la guarda no da un error: da una aplicación que parpadea y unos registros perfectamente limpios.

## Cómo diagnosticar algo parecido

1. Activar los eventos del realm: `PUT /admin/realms/nutrismart/events/config` con `{"eventsEnabled":true,"enabledEventTypes":[]}`. Sin esto solo se ven los errores.
2. Leerlos en `GET /admin/realms/nutrismart/events?max=40`.
3. Contar las cargas en el servidor web: `docker logs nutrismart-web-pro | grep "GET / HTTP"`. Un bucle se ve como decenas por segundo.

---

# Rebanada 30 — Biblioteca con portadas y archivos (BIB-01)

Migración **035**. **No se montó MinIO**: se reutiliza el módulo `almacen` de la R5, que ya existía y ya estaba pensado para esto.

## El fallo que apareció al probar

| | |
|---|---|
| Primera subida | **500 `EACCES: permission denied, mkdir '/datos/archivos/...'`** |
| Causa | Docker crea el punto de montaje como `root`; la API corre como `node` (uid 1000) |
| Alcance | **También estaba roto para los informes de laboratorio** (R5) |
| Arreglo | `mkdir` + `chown` en el Dockerfile antes de `USER node`, y corrección del volumen existente |

## Ciclo completo con un PDF real

| Paso | Resultado |
|---|---|
| `POST /api/archivos` con un PDF | **201** · mime `application/pdf` detectado, sha256 y tamaño registrados |
| `POST /api/recursos` tipo `archivo` | 201 · nace borrador |
| `PATCH .../publicacion` | 200 |
| Lista del paciente | Sale con `tipo: archivo`, `tieneArchivo: true`, portada |
| `GET /api/paciente/recursos/:id/archivo` | **200 · 69 bytes**, empieza por `%PDF-1.4` |
| Cabeceras de la descarga | `content-disposition: attachment`, `x-content-type-options: nosniff`, `cache-control: private, no-store` |
| En disco | `/datos/archivos/<clinica>/2026/08/<uuid>.pdf` — nombre generado, extensión del tipo **detectado** |

## Coherencia entre tipo y contenido

| Prueba | Obtenido |
|---|---|
| `tipo: archivo` sin `archivoId` | 400 «Sube un archivo antes de guardar» |
| `tipo: enlace` sin URL | 400 |
| `tipo: enlace` con `http://` | 400 «tiene que empezar por https://» |
| `tipo: enlace` con `javascript:` | 400 |
| `tipo: texto` sin contenido | 400 |
| Portada con `http://` | 400 «debe ser una dirección https://» |
| `tipo: video` | 400 «Elige un tipo válido» |

> Un `CHECK` en la base sostiene lo mismo: cada tipo trae lo suyo y nada de lo demás. Sin él cabría un recurso de tipo archivo sin archivo — un botón de descarga que no descarga.

## Aislamiento de la descarga

| Prueba | Esperado | Obtenido |
|---|---|---|
| Paciente pide el archivo de un recurso **no publicado** | Rechazo | ✓ **404** |
| Paciente usa la ruta profesional `/api/archivos/:id` | Rechazo | ✓ **401** |

> El encargo servía el archivo con una URL prefirmada de S3 válida cinco minutos. Aquí pasa por la API: **cada descarga vuelve a comprobar el permiso**. Una URL prefirmada, una vez emitida, la abre cualquiera que la reciba — y son documentos de salud.

## Los tres tipos conviven

```
enlace   Guía alimentaria de la OMS    https://www.who.int/es
archivo  Guía de porciones en PDF      + portada
texto    Cómo leer una etiqueta        (el de la R24, intacto)
```

## Pantallas

**Profesional** — Biblioteca → Nuevo material: selector **Escrito aquí / Enlace / Archivo** que cambia lo que se pregunta debajo, más el campo de portada con vista previa.

| Paso | Qué comprobar |
|---|---|
| Cambiar de tipo | El formulario cambia; no se piden campos que no aplican |
| Subir un archivo | Se sube **antes** de guardar, para no perder lo escrito si el servidor lo rechaza |
| Portada | La vista previa aparece al escribir; si la URL falla, se oculta |
| Botón Guardar | Deshabilitado con el motivo en el `title` («Falta el archivo») |

**Paciente** — Biblioteca.

| Paso | Qué comprobar |
|---|---|
| Lista | Las portadas se ven; si la imagen falla se oculta entera |
| Etiqueta del tipo | «enlace externo» o «archivo para descargar» antes de tocar |
| Enlace | Abre en otra pestaña con `noopener noreferrer` |
| Archivo | Botón de descarga con el nombre y el tamaño |

---

# Rebanada 31 — Pantalla de acceso propia y paletas curadas (LOGIN-01)

Sin migraciones.

## Comprobado

| Prueba | Resultado |
|---|---|
| `GET /silent-check-sso.html` en :5173 y :5175 | 200 en las dos |
| Bundle del profesional | Contiene la pantalla de acceso y `check-sso` |
| Selector de paletas | Lee `data-brand` en runtime; **cero hexadecimales** de los que proponía el encargo |
| `tsc` en las tres apps | Sin errores |

## Lo que la pantalla de acceso no hace

| | Por qué |
|---|---|
| No pide usuario ni contraseña | Las verifica Keycloak. Un formulario propio vería las contraseñas de todos — justo lo que el flujo de código de autorización evita |
| No lleva el logo de la clínica | Sin sesión no hay `tenant_id`: no se sabe de qué clínica es quien mira |

## El caso de Safari

La comprobación silenciosa usa **cookies de terceros**, que Safari bloquea por defecto. Ahí el iframe acaba sin sesión aunque exista, y se ve la pantalla de acceso otra vez.

**No es un fallo**: pulsar el botón lo resuelve y Keycloak no vuelve a pedir la contraseña. Anotado en el código junto al `init`.

## Paletas: una sola fuente de verdad

El encargo definía 10 paletas nuevas con hexadecimales en un `.ts`. El design system **ya trae** las curadas del proyecto como bloques `[data-brand]`.

| Prueba | Esperado |
|---|---|
| Retocar un color en `tokens.css` | El selector lo refleja sin tocar código |
| Elegir una paleta | `brand_config.color_primario` recibe ese valor |
| Color exacto de marca | Sigue disponible, plegado tras «Usar los colores exactos de mi marca» |
| Color con contraste bajo | El aviso WCAG de la R6 sigue apareciendo |

> Quitar el color libre habría dejado fuera a las clínicas con manual de marca. La regla del proyecto admite las dos vías; lo que protege de verdad es el aviso de contraste, no prohibir.

## Pantallas

**Profesional** — cerrar sesión y volver a `localhost:5173`.

| Paso | Qué comprobar |
|---|---|
| Sin sesión | Sale la pantalla propia, no la de Keycloak |
| Panel izquierdo | Color primario, o la imagen de `VITE_LOGIN_IMAGE_URL` si se define |
| En móvil | El panel se oculta; queda el botón, que es lo único que importa |
| Botón | Lleva a Keycloak y vuelve a la ruta desde la que se salió |
| Con sesión activa | No se ve: el iframe la detecta y entra directo |
| Ajustes → Marca | 8 paletas; el color libre plegado debajo |

---

# Rebanada 32 — Pulseras y relojes (RPM-01)

Migraciones **036** y **037**.

> **El intercambio OAuth no se ha probado contra los servidores reales.** Hace falta una aplicación registrada en Fitbit y otra en Google Cloud, y el proyecto todavía no las tiene. Todo lo demás sí está probado.

## Las dos correcciones de seguridad

### El `state` era falsificable

El encargo usaba `base64(pacienteId)`. Base64 no es cifrado: cualquiera puede leerlo **y fabricarlo**. Con eso, alguien construye la URL de callback con el id de otro paciente y su propio código de Fitbit, y deja su cuenta de salud enganchada al expediente ajeno.

| Prueba | Esperado | Obtenido |
|---|---|---|
| Dos peticiones de conexión | States distintos | ✓ aleatorios, 64 hex |
| Callback con `state` inventado (64 × `a`) | Rechazo | ✓ `resultado=enlace_caducado` |
| Mismo `state` válido usado dos veces | Solo la primera | ✓ 2ª → `enlace_caducado` |
| Pulsar Conectar dos veces | Un solo intento vivo | ✓ 1 fila en `wearable_oauth_estado` |

### Faltar la clave tumbaba la API

El módulo de cifrado del encargo lanzaba **al cargarse**. Importarlo desde cualquier ruta habría impedido arrancar la API sin la integración configurada — y con ella el acceso a expedientes y agenda.

| Prueba | Obtenido |
|---|---|
| API sin ninguna variable de wearables | `/health` **200** — arranca igual |
| `GET /api/paciente/wearables` | 200 · `disponible: false` y el motivo exacto |
| `POST …/fitbit/conectar` sin configurar | **503** «Falta WEARABLE_ENCRYPTION_KEY…» |
| Con clave pero sin proveedor | 503 «Fitbit no está configurado en este servidor» |
| Proveedor inventado (`garmin`) | 404 |

## Cifrado

| Prueba | Obtenido |
|---|---|
| Cifrar y descifrar un token con acentos y símbolos | Idéntico ✓ |
| Alterar un byte del texto cifrado | **Rechazado** ✓ — GCM autentica, no devuelve basura |
| Clave con formato inválido | La API no arranca y dice cómo generarla |

## Deduplicación

| Prueba | Esperado | Obtenido |
|---|---|---|
| Insertar la misma lectura dos veces | 1 fila | ✓ el 2º INSERT no hace nada |
| El mismo día, misma métrica, fuente `manual` | Convive | ✓ `fitbit: 8432` y `manual: 9000` |

> `medido_en` se ancla al **mediodía del día medido**, no al instante de sincronizar. Si cambiara en cada pasada, el índice único no serviría de nada y cada sincronización crearía filas nuevas. Mediodía y no medianoche: a las 00:00 los valores se irían al día anterior en cualquier gráfica que agrupe por fecha local.

## Un fallo propio, encontrado al probar

La dirección de vuelta construida (`/wearable/callback/fitbit`, la del encargo) no coincidía con la ruta registrada (`/wearables/:proveedor/callback`). Habría fallado **al final del flujo**, con el usuario ya autorizado. Corregido y verificado.

## Pantallas

**Paciente** — Inicio → tarjeta «Mis dispositivos» → `/dispositivos`. No es una sexta pestaña, como progreso y biblioteca.

| Paso | Qué comprobar |
|---|---|
| Sin configurar | Dice **por qué** no está disponible, no solo que no lo está |
| Conectar | Navegación completa al proveedor, nunca un iframe: tiene que verse su dirección |
| Nota de Apple Watch | Explica que la vía es Fitbit, que sincroniza con Salud solo |
| Qué se comparte | Dice también lo que **no** se pide: ni ubicación ni entrenamientos |
| Tras conectar | El resultado llega por la URL, se muestra una vez y se limpia |
| Fallo del proveedor | Se enseña en la tarjeta; no se queda «conectado» y mudo |
| Desconectar | Avisa de que las lecturas ya registradas se conservan |

---

## Rebanada 33 — Básculas conectadas (RPM-02)

### Las métricas nuevas se pueden guardar de verdad

Añadir un valor a un enum y ampliar un CHECK son dos cosas distintas;
faltar cualquiera de las dos rompe la inserción. Se comprueba junta,
dentro de una transacción que se deshace:

```sql
begin;
insert into registro_metrica (clinica_id, paciente_id, tipo, valor, unidad, medido_en, fuente)
select p.clinica_id, p.id, t.tipo::tipo_metrica, t.v, t.u, now(), 'withings'
  from paciente p,
       (values ('grasa_pct',22.4,'%'),('masa_grasa_kg',17.9,'kg'),
               ('masa_muscular_kg',54.1,'kg'),('masa_osea_kg',3.1,'kg')) as t(tipo,v,u)
 where p.correo is not null limit 4;
select tipo, valor, unidad, fuente from registro_metrica where fuente='withings';
rollback;
```

Resultado: las cuatro filas entran con `fuente = withings`.

### El webhook no confirma quién existe

Es una ruta pública, sin token: cualquiera puede llamarla. Lo que se
comprueba es que **responde igual pase lo que pase**, porque un 404 le
diría a quien sondee qué identificadores de Withings están dados de alta
en la plataforma.

```bash
curl -i -X POST http://localhost:4001/api/wearables/webhook/withings   -H "Content-Type: application/x-www-form-urlencoded"   -d "userid=999999&startdate=1&enddate=2&appli=1"

curl -i -X POST http://localhost:4001/api/wearables/webhook/withings   -H "Content-Type: application/x-www-form-urlencoded" -d "appli=1"

curl -i -X POST http://localhost:4001/api/wearables/webhook/withings   -H "Content-Type: application/x-www-form-urlencoded" -d "userid=1'+OR+1=1--"

curl -I http://localhost:4001/api/wearables/webhook/withings
```

Los cuatro: **200**, los tres primeros con `{"ok":true}`. El `HEAD` es el
que Withings usa para dar por buena la URL antes de aceptar la
suscripción; sin él no llegaría ningún aviso.

Que el tercero no dé error también dice algo: el `userid` se valida
contra `^\d{1,20}$` antes de tocar la base.

### El aviso no puede ser ambiguo

```sql
select indexdef from pg_indexes where indexname='uq_conexion_usuario_externo';
```

Debe salir un índice único sobre `(proveedor, usuario_externo)`. Dos
pacientes apuntando al mismo usuario de Withings harían imposible saber
de quién es una pesada.

### Tres proveedores, y se sabe cuál elegir

Con un paciente autenticado:

```bash
curl -s http://localhost:4001/api/paciente/wearables -H "Authorization: Bearer $TOKEN"
```

Salen los tres, cada uno diciendo qué aporta y por qué no está
disponible:

```
Fitbit      | Pasos, pulso en reposo y horas de sueño
            | disponible=False · Fitbit no está configurado en este servidor
Google Fit  | Pasos y pulso
            | disponible=False · Google Fit no está configurado en este servidor
Withings    | Peso y composición corporal cada vez que te peses
            | disponible=False · Withings no está configurado en este servidor
```

Lo importante es lo que **no** pasa: sin credenciales la API arranca
igual y el resto de la plataforma funciona. La integración es
accesoria; el acceso clínico no depende de ella.

### Los nombres de las métricas nuevas

En la app del paciente, **Progreso**; en la ficha del profesional,
**Registros**. Si aparece `masa_osea_kg` en vez de «Masa ósea», falta la
etiqueta en el mapa `METRICA` de esa pantalla — el fallback pinta la
clave cruda.

### Lo que no se puede probar aquí

No hay aplicación registrada en Withings: el intercambio de OAuth nunca
se ha ejecutado contra sus servidores.

Y los webhooks **no pueden funcionar en local**. Withings solo llama a
direcciones públicas HTTPS; `localhost` no le llega. Probarlos de
verdad exige un despliegue accesible desde internet o un túnel.

## Rebanadas 34 y 35b — Navegación con el color de la clínica (APP-BRAND-01)

### El recorrido

1. Entrar como administrador de clínica → **Ajustes → Marca**.
2. Elegir una paleta y guardar. La barra lateral, la superior y todo el
   menú cambian de color **al momento, sin recargar**: los tokens se
   reescriben en `:root`.
3. En la app del paciente, entrar y recorrer **Inicio → Plan → Apuntar →
   Citas → Mensajes**. La barra inferior mantiene el color de la clínica
   en las cinco. Antes solo se aplicaba en Inicio.

**Lo que hay que ver en las dos apps:** todo el texto de las barras en
blanco —nombre de la clínica, items del menú, correo del pie, iconos— y
el item activo con un fondo blanco translúcido.

### El fondo no siempre es exactamente el color elegido

Es lo que más se presta a reportarse como fallo, así que conviene saberlo.
Las barras no usan `--primary` sino `--nav`: el mismo color **oscurecido
lo justo** para que el blanco de encima llegue a 4.5:1 (WCAG AA). Con
cinco de las ocho paletas sale idéntico; con teal, esmeralda y ámbar baja
un punto:

| Paleta | Marca | Barra |
|---|---|---|
| teal-fresco | `#0891B2` | `#07809D` |
| esmeralda | `#059669` | `#05875E` |
| ámbar | `#D97706` | `#B26205` |

Con blanco fijo sobre el color sin tocar, esas tres se quedaban en 3.68,
3.77 y 3.19:1.

### Un color inventado también tiene que leerse

La comprobación de verdad no son las ocho paletas —esas están medidas—
sino un color cualquiera. En **Ajustes → Marca**, escribir un hex a mano:

- `#FFE066` (amarillo claro) → la barra sale oliva. El texto sigue blanco
  y legible.
- `#1A1A2E` (casi negro) → sin cambio, ya contrastaba de sobra.
- `#FFFFFF` (blanco) → la barra sale gris medio. Es el caso extremo: no
  hay barra blanca con letra blanca.

### Comprobarlo sin abrir el navegador

La regla se puede ejecutar contra el código real:

```bash
cat > apps/web-professional/src/lib/__probar.ts <<'EOF'
import { fondoNav, contraste } from './color'
for (const p of ['#0E7C66','#0891B2','#059669','#D97706','#FFE066','#FFFFFF']) {
  const f = fondoNav(p)
  console.log(p, '->', f, contraste('#FFFFFF', f).toFixed(2) + ':1')
}
EOF
npx esbuild apps/web-professional/src/lib/__probar.ts --bundle --platform=node   --format=esm --outfile=/tmp/probar.mjs && node /tmp/probar.mjs
rm apps/web-professional/src/lib/__probar.ts
```

Ningún resultado debe bajar de 4.50:1.

### Los rincones que se olvidan

- **Campana de notificaciones** (barra superior): el icono se ve blanco,
  no un gris apagado sobre el color.
- **Panel de notificaciones**: al abrirlo, su texto sigue en negro sobre
  blanco. Cuelga del DOM de la barra, así que hereda el blanco si no lo
  fija.
- **Contador de mensajes sin leer** (barra del paciente): va invertido —
  círculo blanco, número en el color de la barra. En el color de marca se
  habría fundido con el fondo.
- **Sin logo**: el cuadrito con la inicial de la clínica sigue visible.
- **Sección activa**: además del fondo más claro, conserva la barra
  vertical blanca a la izquierda. Es la pista que no depende del color.

## Rebanada 35c — Dispositivos en la barra del paciente

La sección existía y funcionaba desde la Rebanada 32, pero solo se llegaba
a ella desde un botón de Inicio. Ahora es la sexta pestaña de la barra.

### El recorrido

Entrar en la app del paciente y tocar **Dispositivos** en la barra
inferior desde cualquier pantalla. Debe abrir la misma página que el botón
de Inicio, con los tres proveedores.

### Lo que hay que mirar, y en un móvil de verdad

Seis columnas dejan unos 57 px útiles por sección a 390 px, y
«Dispositivos» es la etiqueta más larga de las seis con diferencia — 12
letras frente a las 8 de «Mensajes». A 11 px se pasaba de ancho y se
partía en dos líneas, dejando esa pestaña más alta que las otras cinco y
descuadrando la barra.

Por eso la etiqueta bajó a 10 px y lleva `truncate`. Qué comprobar:

- «Dispositivos» cabe **en una línea**.
- No aparecen puntos suspensivos («Dispositi…»). Si salen, la fuente del
  sistema es más ancha de lo previsto y la salida es acortar la etiqueta,
  no volver a permitir el salto de línea.
- Las seis pestañas tienen **la misma altura**.

Esto no se puede dar por bueno desde el ordenador: el ancho real de la
letra depende de la fuente del sistema, que en un iPhone no es la del
escritorio. Comprobarlo con el navegador estrechado no vale.

### Por qué `truncate` y no solo una fuente más pequeña

Achicar la letra hasta que quepa es una medida que caduca: basta un
idioma nuevo, una fuente distinta o el tamaño de texto grande de
accesibilidad para volver al mismo sitio. Con `truncate`, el peor caso es
una etiqueta recortada en una línea — feo pero contenido— en vez de una
barra rota.

## Rebanada 36 — Reorganización del expediente

### El recorrido

1. **Pacientes → un paciente.** Las pestañas deben ser: Resumen ·
   Historial · **Sociodemografía** · Plan alimentario · Sus registros ·
   Notas SOAP. **No** debe haber pestaña «Laboratorios».
2. **Sociodemografía.** Con consentimiento otorgado, editar. Deben estar
   **Religión**, **Nacionalidad** y **Lugar de trabajo**; y **no** deben
   estar actividad física, horas de sueño, fuma ni alcohol.
3. **Resumen → una consulta → Laboratorios.** La sección se llama así,
   no «Bioquímica». Arriba, la lectura por grupos de marcadores; abajo,
   «Estudios cargados» con la lista y el botón de registrar.
4. **La misma consulta → Clínico.** Al final, bloque **«Hábitos»** con
   los cuatro campos y su propio botón «Guardar hábitos».

### La prueba que de verdad importa: que no se borre nada

El endpoint de sociodemografía **reemplaza el bloque entero** —lo que no
se envía queda nulo—. Al repartir sus campos entre dos pantallas, cada
una tiene que devolver los de la otra intactos. Si eso falla, el síntoma
es un borrado silencioso que nadie relaciona con haber tocado otro campo.

Hay que probarlo en los dos sentidos:

1. En **Sociodemografía**, rellenar Ocupación, Escolaridad, Religión,
   Nacionalidad y Lugar de trabajo. Guardar.
2. En **Valoración → Clínico → Hábitos**, poner actividad «Intensa»,
   5 horas, fuma «No», alcohol «Nunca». Guardar.
3. Volver a **Sociodemografía**: ocupación, escolaridad, religión,
   nacionalidad y lugar de trabajo **siguen ahí**.
4. Cambiar **solo la Ocupación** y guardar.
5. Volver a **Clínico → Hábitos**: los cuatro valores del paso 2
   **siguen ahí**.

Si en el paso 3 o el 5 aparece algo vacío, uno de los dos formularios
está enviando el bloque incompleto.

### Comprobarlo contra la base, sin navegador

La consulta real se puede ejercitar directamente. Se extrae del código
—no se transcribe, que es como se prueba otra cosa— y se deshace al
final:

```bash
python - <<'PY'
import io
s = io.open('apps/api/src/routes/sociodemografico.ts', encoding='utf-8').read()
q = s.split('const SQL_GUARDAR = `', 1)[1].split('`', 1)[0]
out = io.open('g.sql', 'w', encoding='utf-8', newline='
')
out.write("begin;
prepare guardar (uuid,uuid,text,smallint,boolean,text,text,"
          "text,smallint,text,boolean,uuid,boolean,text,text,text) as
")
out.write(q.replace('$12::uuid', '$12') + ";
")
PY
```

Después, con `psql`: ejecutar `guardar(...)` con el bloque completo,
volver a ejecutarlo cambiando **solo** los cuatro hábitos, y comprobar
que ocupación, escolaridad, religión, nacionalidad y lugar de trabajo
siguen intactos. Cerrar con `rollback`.

Resultado esperado del último `select`:

```
   act   | sue | tab |  alc  | ocupacion | religion | nacionalidad  |       lugar_trabajo
---------+-----+-----+-------+-----------+----------+---------------+----------------------------
 intensa |   5 | f   | nunca | Docente   | Catolica | Costarricense | Escuela Republica de Chile
```

### Lo que hay que mirar aunque no lo parezca

- **Registrar un laboratorio sin abrir consulta.** En **Resumen**, bajo
  «Laboratorios», sigue el botón «+ Registrar laboratorio». Sin él,
  subir un PDF exigiría abrir una valoración.
- **Sin consentimiento**, el bloque «Hábitos» del Clínico no enseña
  formulario: explica que falta y enlaza a Sociodemografía. Es el mismo
  criterio de la pestaña, y no puede relajarse por estar dentro de una
  consulta.
- **Consulta finalizada**: los Hábitos se leen pero no se editan, y no
  aparece el botón de guardar.
- **Dos «¿Fuma?» en la misma pantalla.** No es un fallo de esta
  rebanada: Clínico ya tenía los suyos en `historial_clinico`, y la
  mudanza los pone al lado de los de `paciente_sociodemografico`. Pueden
  contradecirse. Consolidarlos es otra rebanada — ver `REBANADA-36.md`.
- **El PDF del informe** sigue imprimiendo actividad y sueño: los lee de
  la misma tabla de siempre, que no cambió.

## Rebanada 37 — Conclusiones: objetivos, restricciones y plan

### El recorrido

Ficha del paciente → **Resumen** → una consulta → pestaña
**Conclusiones**. De arriba abajo debe verse:

1. Diagnóstico nutricional, con **Objetivos del tratamiento** (nuevo) y
   debajo Observaciones clínicas.
2. Recomendaciones.
3. Prescripción dietética, con **Restricciones** dentro.
4. **Plan alimentario** (nuevo).
5. Acuerdos con el paciente.

### Restricciones: las quince y las dos que faltan

En Prescripción → Restricciones deben estar, por este orden:
Hipocalórica · Normocalórica · Hipercalórica · Hiperproteica ·
Normoproteica · Hipoproteica · Alta en fibra · Fibra soluble · Fibra
insoluble · Sin gluten · Sin lactosa · Bajo en sodio · Bajo en grasas ·
Vegetariana · Vegana.

**No** deben ofrecerse «Diabética» ni «Renal».

### La prueba que de verdad importa: que «Renal» no se borre sola

`restricciones` es un `jsonb` sin restricción en la base; valida la API,
y lo hace **descartando en silencio** lo que no reconoce. Si se hubieran
quitado del servidor, reguardar una conclusión antigua las habría
borrado sin avisar.

Para probarlo hace falta una conclusión que ya las tenga. Se fabrica:

```bash
docker exec -i nutrismart-db psql -U nutrismart -d nutrismart <<'SQL'
update conclusion_valoracion
   set restricciones = '["renal","sin_gluten"]'::jsonb
 where consulta_id = 'PON_AQUI_LA_CONSULTA';
SQL
```

Después, en la pantalla:

1. Abrir esa conclusión. «Renal» aparece como ficha **con borde
   discontinuo**; al pasar el ratón dice que ya no se ofrece y se
   conserva porque estaba registrada.
2. Cambiar cualquier otra cosa —por ejemplo las kilocalorías— y
   **Guardar conclusión**.
3. Recargar. «Renal» **sigue ahí**.

Si desaparece en el paso 3, la lista del servidor
(`routes/conclusion.ts`) perdió la clave y está borrando datos clínicos
al reguardar.

Las dos listas deben cuadrar, y eso se comprueba sin navegador:

```bash
# ninguna opción del menú puede ser rechazada por el servidor,
# y ninguna clave aceptada puede quedarse sin etiqueta
grep -c "clave:" apps/web-professional/src/api/valoracion.ts
```

Resultado esperado del cruce: **servidor acepta 17, la pantalla ofrece
15**, y las 2 de diferencia son exactamente `diabetica` y `renal`.

### El encabezado del plan sale de la prescripción, no de la calculadora

Es la parte que más se malinterpreta al probar. El encargo decía «desde
la calculadora», pero se lee del campo de meta calórica — que es donde la
calculadora deja su resultado. Así funciona también sin abrirla, que es
lo normal en una consulta de control.

1. Con la meta calórica **vacía**, el bloque Plan alimentario muestra el
   aviso y un botón **Abrir calculadora**.
2. Escribir `2000` a mano en Meta calórica, **sin tocar la calculadora**.
   El encabezado debe mostrar «2000 kcal/día» y las seis listas de
   intercambio. Si sigue vacío, está atado a la calculadora y es un
   fallo.
3. Abrir la calculadora, pulsar «Usar estos valores». La meta cambia y el
   encabezado la sigue.
4. La suma de los intercambios que declara el pie no tiene por qué dar
   exactamente la meta: el reparto es orientativo y así lo dice.

### Objetivos

Escribir un objetivo largo, guardar, recargar la consulta: debe seguir
ahí. Se guarda en `conclusion_valoracion.objetivos`, sin límite de
longitud.

```sql
select left(objetivos, 60) from conclusion_valoracion;
```

### Lo que NO se hizo, y es intencionado

- **Restricciones no se movió** fuera de Prescripción, aunque el orden
  dibujado en el encargo la ponía antes. «Hipocalórica» o «Hiperproteica»
  describen la prescripción: su sitio es junto a las kilocalorías.
- **No hay un segundo botón de calculadora** bajo Prescripción: ya había
  uno en la cabecera de ese bloque, y el que pedía el encargo se puso en
  el estado vacío del plan, que es donde hace falta.
- **El plan es un resumen con enlace**, no el gestor completo. Meter la
  lista de planes, el editor y el archivado dentro de un formulario que se
  guarda de una vez daría dos botones de guardar compitiendo.

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

# Rebanada 41 — Ajustes del expediente clínico

Siete retoques sobre pantallas que ya existían. Ninguno añade una función nueva de golpe: casi todos corrigen algo que se preguntaba dos veces, se llamaba de un modo confuso o no llevaba a donde decía.

## Antes de empezar

```
npm run migrate -w @nutrismart/api        # aplica la 044 y la 045
docker compose -f infra/docker-compose.dev.yml up -d --build api
```

Comprobar que las columnas están:

```
docker exec nutrismart-db psql -U nutrismart -d nutrismart -c "\d paciente_sociodemografico" | grep descanso
docker exec nutrismart-db psql -U nutrismart -d nutrismart -c "\d paciente" | grep nota_profesional
```

## 1 · Hábitos: qué desapareció y qué entró

**Dónde:** un paciente → **Nueva consulta** → pestaña **Clínico**, bloque **Hábitos** (al final, debajo de Farmacología).

| Paso | Qué comprobar |
|---|---|
| Mirar el bloque Hábitos | **No** están «Nivel de actividad física», «Fuma actualmente» ni «Consumo de alcohol» |
| Subir a los bloques de arriba | Esos tres siguen ahí: «Actividad física» (con su FAF) y «Sustancias» |
| Horas de sueño | Sigue donde estaba |
| **Calificación de descanso** | Deslizante de 1 a 10; al lado se lee el número; debajo «1 = descanso muy malo · 10 = descanso excelente» |
| Sin haberlo tocado | Dice **«Sin registrar»**, no «5» |
| Moverlo y pulsar **Quitar** | Vuelve a «Sin registrar» — es la única forma de decir «no lo sé» |
| **Veces que despierta durante la noche** | Acepta 0; no acepta negativos |
| **Notas de hábitos** | Textarea, se redimensiona |
| Guardar hábitos → F5 | Los tres valores vuelven |

**Lo que hay que mirar con atención:** después de guardar aquí, ir a la ficha → pestaña **Sociodemografía** y comprobar que **ocupación, escolaridad y hogar siguen ahí**. Ese endpoint reemplaza el bloque entero; si algo se hubiera quedado sin reenviar, guardar los hábitos lo habría borrado.

**Y al revés:** editar la ocupación en Sociodemografía y volver a Hábitos. La calificación de descanso debe seguir puesta.

**Por qué no se borraron las columnas.** Nivel de actividad, tabaco y alcohol se quedan en la base y **se siguen imprimiendo en el PDF**: hay pacientes con el dato recogido y la trazabilidad clínica del proyecto dice que nada se elimina físicamente. Se leen, ya no se escriben. Salían duplicados dentro de la misma pantalla, y de dos respuestas que no concuerdan no sirve ninguna.

## 2 · Notas del profesional

**Dónde:** ficha del paciente, **al final de la página**, debajo de las pestañas.

| Paso | Qué comprobar |
|---|---|
| Valoración → Clínico | El bloque **«Notas»** que había al final **ya no está** |
| Ficha del paciente, bajar del todo | Sección **«Notas del profesional»**, visible desde cualquier pestaña |
| Escribir y esperar un segundo | El indicador pasa de «Sin guardar» a «Guardando…» y a «Guardado» |
| Escribir y salir del campo (tab) | Guarda sin esperar |
| F5 | El texto vuelve |
| Vaciarla del todo y guardar | Queda vacía, no con una cadena en blanco |
| Contador de caracteres | Sube; el tope son 10 000 |
| Cambiar de paciente | Trae **su** nota, no la del anterior |

**Lo que hay que mirar con atención:** entrar con el paciente a su app (`localhost:5174`) y recorrer su perfil y su progreso. **La nota no puede aparecer por ningún lado.** Ninguna ruta del paciente la lee.

**Efecto colateral que conviene conocer:** el panel de interacciones farmacológicas tenía un botón «añadir a notas» que copiaba el aviso al bloque que se ha eliminado. Ese botón ya no aparece. Lo que se quiera conservar de una interacción se escribe en «Notas del profesional».

## 3 · El botón del plan en Conclusiones

**Dónde:** Nueva consulta → pestaña **Conclusiones**, bloque del plan (debajo del formulario).

Era el fallo más desconcertante de los siete: el botón enlazaba a `/pacientes/:id` a secas, y el expediente **abre siempre en Resumen**. Pulsarlo llevaba a una pantalla que no era la pedida, sin plan creado y sin explicación. Parecía que no hacía nada.

| Situación | Paso | Qué comprobar |
|---|---|---|
| Paciente **sin** plan activo | **Crear plan alimentario** | El botón dice «Creando…», y **acaba en la pestaña de planes con el plan nuevo abierto** |
| | Mirar la URL | `…/pacientes/<id>?tab=plan&plan=<id>` |
| | La lista de la izquierda | El plan recién creado, en **Borrador** |
| Paciente **con** plan activo | **Abrir el plan completo →** | Misma pestaña, con **ese** plan abierto |
| Con la API caída | Pulsar crear | Mensaje de error **en el mismo bloque**; no navega a ninguna parte |

**Lo que hay que mirar con atención:** que al llegar, el plan esté abierto **en consulta, no en edición**. Y que pulsar el botón estando ya en el expediente cambie de pestaña igualmente.

## 4 · Histórico de Planes Alimentarios

**Dónde:** ficha del paciente, pestaña renombrada.

| Paso | Qué comprobar |
|---|---|
| La pestaña | Dice **«Histórico de Planes Alimentarios»**, no «Plan alimentario» |
| La lista | Del **más reciente al más antiguo**, sin agrupar por estado |
| Cada ítem | Nombre + fecha: «Desde dd/mm/aaaa», o «Creado el …» si el plan aún no rige |
| Pulsar cualquiera | Se abre **en solo lectura** (la grilla, no el editor) |
| Un plan activo | Botones «Editar comidas» y «Archivar» disponibles |
| Un plan archivado | Sin botones, con el aviso de que no se edita ni se reactiva |
| El chip | «Activo» sigue marcando cuál rige hoy |

**Lo que hay que mirar con atención:** el orden. Antes el activo salía primero aunque fuera el más viejo. Una pestaña que se llama «histórico» tiene que leerse como una línea de tiempo; cuál rige lo dice el chip.

## 5 · kcal editable en el recordatorio

**Dónde:** Nueva consulta → **Dietético** → **Recordatorio 24h** (y también **Consumo Usual**).

| Paso | Qué comprobar |
|---|---|
| Escribir alimentos en un tiempo de comida y **Analizar IA** | Aparecen CHO / Prot / Grasas como etiquetas y **kcal como casilla** |
| Escribir otro número en la casilla de kcal | El borde se resalta y al lado sale **«(IA: 420)»** con lo que estimó el modelo |
| El pie de la tabla | El total **cambia al teclear**, sin esperar a guardar |
| Guardar y F5 | La corrección vuelve; la estimación de la IA **sigue guardada debajo** |
| **Vaciar** la casilla y guardar | Vuelve el número de la IA — la corrección se deshace |
| Cambiar el texto de los alimentos | La corrección **se descarta**: era sobre otro texto |
| Una fila sin analizar | La casilla de kcal se puede escribir igual y suma en el total |
| Consulta finalizada | La casilla está deshabilitada |

**Lo que hay que mirar con atención:** que corregir kcal **no borre los gramos** de CHO, proteína y grasas. Siguen siendo los de la IA: corregirlos uno a uno sin recalcular el conjunto daría un reparto que no cuadra.

**Por qué no hay tabla de alimento/cantidad/unidad.** El encargo la pedía, pero la R40 ya había sustituido esa forma por texto libre analizado por Claude con el método ADA, con caché por tiempo de comida. Rehacerla habría tirado esa rebanada y obligado a migrar lo capturado. Se conservó el análisis y se añadió lo que faltaba: la corrección manual.

### Totales en «Resumen y macros»

**Dónde:** Dietético → **Resumen y macros**, debajo del reparto energético.

| Paso | Qué comprobar |
|---|---|
| Entrar con el recordatorio analizado | Fila **«Total CHO · Total Proteína · Total Grasas · Total kcal»** |
| Las dos fuentes | Recordatorio de 24 horas y Consumo Usual, **por separado** |
| Sin analizar nada | Dice que no hay análisis, no «0» |
| **Copiar a los macros declarados** | Rellena las casillas de arriba, **sin guardar** |
| Pulsar «Guardar evaluación dietética» | Ahora sí persiste |

**Lo que hay que mirar con atención:** que copiar no guarde solo. Lo declarado es lo que firma el profesional; esto es una estimación de un modelo, y la regla del proyecto es que la IA sugiere y el profesional decide.

## 6 · Recordatorio 24h / Consumo Usual

El encargo pedía renombrar una pestaña a «Recordatorio 24h / Consumo Usual». **Ya son dos pestañas**, que es esa misma pareja con cada mitad accesible por su nombre — las separó la R40. Aplicar el cambio al pie de la letra habría dejado una pestaña «Recordatorio 24h / Consumo Usual» **junto a** otra llamada «Consumo usual».

Lo que sí se unificó es cómo se escriben: **«Recordatorio 24h»** y **«Consumo Usual»**, igual que en el resto de la aplicación y en el PDF.

| Paso | Qué comprobar |
|---|---|
| Sub-pestañas de Dietético | Frecuencia de consumo · **Recordatorio 24h** · **Consumo Usual** · Resumen y macros |

## 7 · Circunferencia de pantorrilla

**Dónde:** Nueva consulta → **Antropometría** → Medidas básicas.

| Paso | Qué comprobar |
|---|---|
| El sexto campo | Dice **«Circunferencia de pantorrilla (cm)»**, no «Pierna» |
| Guardar y F5 | El valor vuelve: la columna sigue siendo `pierna_cm` |
| Antropometría → Pliegues | El pliegue **«Pierna»** sigue llamándose así |

**Lo que hay que mirar con atención:** el pliegue no se tocó a propósito. Es otra medición —un pliegue cutáneo, no un perímetro— y renombrar los dos igual los volvería indistinguibles en la gráfica de composición.

---

# Rebanada 42 — Cunningham, gasto por ejercicio y disponibilidad energética

Un quinto método de GEB que no se parece a los otros cuatro: en vez de multiplicar el basal por un factor de actividad, suma el gasto del ejercicio actividad por actividad. De ahí salen la tabla GEE y la lectura de disponibilidad energética.

**Dónde:** Nueva consulta → **Conclusiones** → botón de la calculadora → panel lateral, **Sección A**.

## Antes de empezar

No hay migración: todo vive en el JSONB `datos_calculadora` de la conclusión. Basta con reconstruir la API para que acepte los campos nuevos.

```
docker compose -f infra/docker-compose.dev.yml up -d --build api
```

## 1 · El selector de GEB

| Paso | Qué comprobar |
|---|---|
| Abrir el selector con un paciente adulto | Schofield · Mifflin St. Jeor · **Harris-Benedict** · **Cunningham** |
| Con un paciente de 18 años o menos | Aparece además **FAO/OMS**, como antes |
| Elegir Harris-Benedict | Se calcula con peso, talla, edad y género; FA/FT/FE siguen visibles |
| Elegir Cunningham | **FA, FT y FE desaparecen**; aparece la sección GEE |
| Volver a Mifflin | FA/FT/FE reaparecen y la sección GEE se va |

**Comprobación aritmética** (60 kg de MLG): GER debe decir **1820 kcal** — es `500 + 22 × 60`.

**Lo que hay que mirar con atención:** que con Cunningham no queden factores de actividad a la vista. El ejercicio ya se cuenta entero en la tabla GEE; dejar el FA visible invita a sumarlo dos veces.

## 2 · Masa libre de grasa

Campo nuevo en la rejilla de antropometría, al lado de «% de grasa».

| Paso | Qué comprobar |
|---|---|
| Paciente con bioimpedancia en el expediente | La MLG se precarga de la medición |
| Paciente con peso y % de grasa, sin MLG medida | La etiqueta del campo dice «kg · **XX.X estimada**» y ese valor es el que se usa |
| Escribir una MLG a mano | Manda sobre la estimada |
| Cunningham sin peso ni % de grasa | Mensaje: _«Se requiere la masa libre de grasa (MLG). Ingresa el peso y % de grasa corporal.»_ |

**Por qué la estimada no rellena la casilla:** un número que aparece solo en un campo editable no se distingue de uno medido. Se muestra como estimación en la etiqueta y solo se usa si nadie escribió nada.

## 3 · Tabla de Gasto Energético por Ejercicio

| Paso | Qué comprobar |
|---|---|
| **+ Agregar actividad** | Fila nueva; el peso se precarga con el peso actual del paciente |
| Desplegar el selector | 18 actividades del catálogo, cada una con sus METS, más «Actividad libre» |
| Elegir «Trotar / jogging» | METS se pone en **7** |
| Editar los METS a mano | Se acepta: el catálogo precarga, no impone |
| Elegir «Actividad libre (ingresar METS)» | METS queda **en blanco** para escribirlo |
| Escribir 70 kg · 45 min · 7 METS | GEE de la fila = **385.9** (`0.0175 × 70 × 45 × 7`) |
| Agregar una segunda actividad | **GEE Total** suma las dos |
| Pulsar la ✕ de una fila | Desaparece y el total baja |

**Lo que hay que mirar con atención:** el peso es **por fila** y editable. Una sesión de pesas con chaleco lastrado no se calcula con el peso del paciente, y una tabla guardada hace tres meses tiene que seguir sumando lo que sumaba aunque el paciente pese otra cosa hoy.

## 4 · GET y disponibilidad energética

Con MLG 60 kg y una sola actividad de 70 kg · 45 min · 7 METS:

| Lectura | Valor esperado |
|---|---|
| GER | 1820 kcal |
| Efecto térmico de los alimentos (×1.1) | 182 kcal |
| GEE total | 385.9 kcal |
| **GET (GER × 1.1 + GEE)** | **2388 kcal** |
| Disponibilidad energética | **33.4 kcal/kg MLG/día** |
| Nivel | **Deficiencia energética leve / moderada** (ámbar) |

> La DE ya **no** se calcula contra el GET sino contra la meta calórica («REQ a utilizar»): ver la R46 §1. El valor esperado de esta tabla no cambia porque el REQ se autorrellena con el GET; en cuanto se escriba otro REQ, sí cambia.

Los cortes, para probarlos moviendo los minutos:

| DE | Nivel | Color |
|---|---|---|
| < 30 | Deficiencia energética severa | rojo (`--status-critical`) |
| 30 – 44.9 | Deficiencia leve / moderada | ámbar (`--status-alert`) |
| 45 – 60 | Disponibilidad óptima | verde (`--status-normal`) |
| > 60 | Excedente energético | neutro |

| Paso | Qué comprobar |
|---|---|
| Sin actividades | El GET se calcula igual, y aparece la nota «GEE = 0. Agrega actividades para un cálculo más preciso.» |
| Quitar la MLG | El bloque dice que se requiere la MLG, sin número inventado |
| El nivel | Va **escrito**, no solo en color: quien no distingue tonos lo lee igual |

## 5 · El REQ sigue al método

| Paso | Qué comprobar |
|---|---|
| Con Mifflin, mirar «REQ a utilizar» en la Sección B | Trae el VET, con la ayuda «kcal · VET de la Sección A» |
| Cambiar a Cunningham | El REQ **pasa al GET**, y la ayuda dice «kcal · GET de la Sección A» |
| Escribir un REQ a mano y cambiar de método | Lo escrito **no se pisa** |

**Por qué se tocó esto.** Antes el REQ solo se rellenaba estando vacío: al cambiar de método, la Sección A enseñaba un GET de Cunningham mientras la B repartía el VET de Mifflin, sin que nada lo señalara. Ahora el autorrelleno se compara con lo último que puso él mismo, así que sigue al método pero respeta cualquier cifra escrita a mano.

## 6 · Persistencia

| Paso | Qué comprobar |
|---|---|
| Aplicar con Cunningham y actividades cargadas | Vuelve al formulario de conclusiones con la meta calórica |
| Guardar la conclusión y recargar (F5) | Al reabrir la calculadora: método Cunningham, MLG y **todas las actividades** |
| Abrir una conclusión **anterior a la R42** | Se abre sin errores; método por defecto y sin actividades |

**Lo que hay que mirar con atención:** el servidor **recalcula** el GEE de cada fila con la misma fórmula en vez de creerse el número que manda el navegador. Para verlo, guardar y comprobar en base que el `gee` guardado cuadra con sus propios kg/minutos/METS:

```
docker exec nutrismart-db psql -U nutrismart -d nutrismart -c \
  "select jsonb_pretty(datos_calculadora->'geeEntradas') from conclusion_valoracion order by updated_at desc limit 1;"
```

`sanearDatosCalculadora` es una **lista blanca**: lo que no se nombra ahí no se guarda. Al añadir un campo a `DatosCalculadora` hay que añadirlo también en `apps/api/src/routes/conclusion.ts`, o se pierde en silencio al guardar.

## Comprobación de las fórmulas

Ejecutables contra el módulo real (`apps/web-professional/src/lib/calculadoraNutricion.ts`):

| Entrada | Salida |
|---|---|
| `gerCunningham(60)` | 1820 |
| `gebHarrisBenedict(70, 175, 30, 'masculino')` | 1696 |
| `gebHarrisBenedict(60, 165, 30, 'femenino')` | 1384 |
| `calcularGEE(70, 45, 7)` | 385.9 |
| `getCunningham(1820, 385.9)` | 2388 |
| `disponibilidadEnergetica(2388, 385.9, 60)` | 33.4 |
| `disponibilidadEnergetica(…, 0)` | `null` |
| `calcularGeb({metodo:'cunningham', mlg:60, resto null})` | 1820 |
| `calcularGeb({metodo:'cunningham', mlg:null, …})` | `null` |

Cunningham no exige peso, talla, edad ni género: la composición corporal ya los recoge, y pedírselos la dejaría en `null` con todos sus datos puestos.

## 7 · Corrección de Schofield en mujer adulta

Apareció al comprobar la aritmética de la R42, pero el fallo venía de la **R39**: la ecuación de Schofield para mujer de 18 años o más llevaba `23.8 × talla` en vez de `2.83 × talla`. La ecuación publicada usa la talla en **metros** con coeficiente 283; pasarla a centímetros lo divide entre 100, y alguien transcribió 23.8.

Schofield es la primera opción del selector, así que el error salía por defecto.

| Caso | Antes | Ahora |
|---|---|---|
| Mujer 60 kg · 165 cm · 30 a | **4843 kcal** | **1383 kcal** |
| Contraste Harris-Benedict, mismo caso | — | 1384 kcal |

Comprobación de no regresión (las bandas infantiles y las de hombre no se tocaron):

| Caso | GEB |
|---|---|
| Mujer 70 kg · 160 cm · 45 a | 1505 |
| Hombre 70 kg · 175 cm · 30 a | 1935 |
| Niña 12 kg · 85 cm · 2 a | 651 |
| Niña 25 kg · 125 cm · 6 a | 998 |
| Niña 50 kg · 160 cm · 14 a | 1362 |

**Lo que hay que mirar con atención:** las conclusiones ya guardadas con Schofield en pacientes mujeres adultas tienen una meta calórica calculada sobre el valor viejo. No se recalculan solas —son registro de lo que se prescribió— así que conviene revisarlas a mano.

**La lección para el siguiente coeficiente que se copie:** contrastar el resultado con otra ecuación del mismo panel. Un GEB de 4843 kcal para una mujer de 60 kg se ve a simple vista; el problema es que nadie lo miró.

## Decisión de nomenclatura

El encargo definía el bloque persistido en `snake_case` (`metodo_ger`, `gee_entradas`, `get_cunningham`). Se guardó en **camelCase** (`metodoGer`, `geeEntradas`, `getCunningham`) para no tener dos convenciones dentro del mismo JSONB: los campos que ya había —`metaCalorica`, `metodoDieta`, `listasIntercambio`— son camelCase.

# Rebanada 43 — Panel de detalle de una consulta

Pulsar una consulta en el expediente abre un panel lateral, de **solo lectura**, con todo lo que se registró ese día: antropometría, diagnósticos, objetivos, observaciones, prescripción, plan alimentario vigente, recomendaciones, acuerdos y la calculadora.

**Dónde:** Ficha del paciente → pestaña **Resumen** → tarjeta **Valoraciones** → clic en cualquier fila de la lista.

## Nota sobre dónde está la lista

El encargo decía «pestaña Historial». La pestaña **Historial** del expediente no enseña consultas: enseña **puntos de control** (`clinical_snapshot`), que son la foto de las métricas de un día y no tienen diagnóstico, prescripción ni plan. La lista de consultas es la tarjeta **Valoraciones**, en Resumen, y es la que abre el panel.

## Antes de empezar

No hay migración: el endpoint solo lee tablas que ya existían.

```
docker compose -f infra/docker-compose.dev.yml up -d --build api web-pro
```

## 1 · La fila se abre

| Paso | Qué comprobar |
|---|---|
| Pasar el ratón por una fila de Valoraciones | Cursor de mano y fondo `surface-2` |
| Clic en la fila | El panel entra **por la derecha** |
| Clic en el botón **Ver** / **Continuar** | Navega a la valoración; **no** abre el panel |
| Tabulador hasta la fila y Enter | Abre el panel igual que el ratón |
| Escape, o clic en el fondo oscuro, o la ✕ | Cierra; el foco vuelve a la fila |

**Lo que hay que mirar con atención:** que **Ver** siga llevando a la valoración. Son dos destinos en la misma fila y es a propósito — mirar es lo habitual, editar es la excepción — pero si el `stopPropagation` del botón se pierde, al pulsar **Ver** se abren las dos cosas a la vez.

## 2 · Cada sección con sus datos

Con el paciente de semilla (**María**, consulta **#2** del 14/07/2026):

| Sección | Qué debe decir |
|---|---|
| Cabecera | `Consulta #2 · Seguimiento · 14/07/2026` y «Atendió Dra. Ana Rodríguez» |
| Datos antropométricos | peso 77.6 kg, talla 162 cm, IMC 29.57, cintura 88.5 cm, ICC 0.859 |
| Diagnósticos | «Sobrepeso con perímetro de cintura de riesgo» + ficha `E66.3` |
| Observaciones clínicas | El párrafo entero, con sus saltos de línea |
| Prescripción dietética | 1750 kcal/día · Proteína 25% (109.4 g) · CHO 45% (196.9 g) · Grasas 30% (58.3 g) · meta de peso 72 kg al 15/12/2026 |
| Recomendaciones | Tres viñetas |
| Acuerdos | Tres, los dos primeros **Cumplido** (verde) y el tercero **No cumplido** (ámbar) |

## 3 · Las secciones vacías no se dibujan

| Caso | Qué comprobar |
|---|---|
| Consulta **#1** de María (sin conclusión) | Solo aparece Antropometría |
| Consulta sin medición ni conclusión | El cuerpo queda casi vacío |
| Al pie, en cualquiera de los dos | Línea discreta: «Sin registrar en esta consulta: Diagnósticos · Objetivos…» |

**Por qué el pie:** un bloque «Diagnósticos» con un guion ocupa lo mismo que uno con contenido y hay que leerlo para descubrir que no dice nada. Que el hueco no exista se recorre más rápido; la línea del pie evita que «no se registró» se confunda con «el sistema no lo tiene».

## 4 · El plan alimentario es deducido, no vinculado

`plan_alimentario` **no tiene `consulta_id`**: no hay forma de saber con certeza qué plan se entregó en una consulta concreta. El servidor lo deduce por fechas y por eso la sección se titula «Plan alimentario **vigente**».

Las reglas, en `apps/api/src/routes/consulta-detalle.ts`:

- Los **borradores** quedan fuera — nunca se entregaron al paciente.
- Un plan sin fecha de inicio (o sin fin) se considera vigente por ese extremo: el campo es opcional en la base.
- Si encajan varios: gana el de inicio más reciente; a igualdad, el que está **activo**; luego el más nuevo.

| Paso | Qué comprobar |
|---|---|
| Consulta de un paciente con plan activo | Tabla con **Tiempo de comida / Patrón / Ejemplo de menú** |
| El orden de las filas | Desayuno → Merienda AM → Almuerzo → Merienda PM → Cena → Colación nocturna, **no** alfabético |
| Franjas sin patrón ni menú | No salen en la tabla |
| Paciente sin plan | La sección no aparece |

**Lo que hay que mirar con atención:** el orden. El `ORDER BY` va contra la columna `enum`, no contra el alias `::text`; si alguien le quita el prefijo `pc.`, Postgres ordena por el alias y las comidas salen alfabéticas (almuerzo primero).

## 5 · Nada es editable

| Paso | Qué comprobar |
|---|---|
| Recorrer el panel entero con el tabulador | El único control es la ✕ de cerrar |
| Buscar inputs, selects o textareas | No hay ninguno; tampoco botón de guardar |

El endpoint no tiene PUT hermano: lo que se escribe sigue escribiéndose por su sección, que es donde vive la validación de cada una.

## 6 · Cambiar de consulta

| Paso | Qué comprobar |
|---|---|
| Abrir la #2, cerrar, abrir la #1 | Los datos son los de la **#1**, no restos de la #2 |
| Abrir una consulta y cerrar antes de que cargue | Sin error en consola: la petición se aborta |
| Mientras carga | Esqueleto gris y «Cargando el detalle…» |

**Por qué importa:** la petición sale al **abrir**, no al montar la lista. Una ficha con quince consultas no se trae quince detalles para que se abra uno.

## 7 · Aislamiento entre pacientes

El id de la consulta viaja en la URL junto al del paciente, y el servidor exige que **cuadren**.

| Paso | Qué comprobar |
|---|---|
| `GET …/pacientes/<paciente B>/consultas/<consulta de A>/detalle` | **404** `consulta_no_encontrada` |
| Como nutricionista, consulta de un paciente ajeno | **404**, nunca 403 |

Distinguir «no existe» de «existe pero no es tuyo» confirmaría la existencia de pacientes de otro nutricionista.

## Lo que quedó sin comprobar con datos reales

La sección **Calculadora** solo se dibuja cuando `datos_calculadora` trae `metodoGer` (es decir, bloques guardados a partir de la R42). **Ninguna conclusión de la semilla tiene ese campo**, así que la sección no se pudo ver con datos de verdad.

Para probarla: abrir una consulta en borrador → Conclusiones → calculadora → elegir **Cunningham**, rellenar MLG y al menos una actividad del GEE, aplicar y guardar. Después, abrir esa consulta desde Valoraciones: el panel debe enseñar método, MLG, GEE, GET y la ficha de disponibilidad energética **con el mismo color** que el panel de la calculadora (crítico <30, ámbar 30–45, verde 45–60, gris >60).

---

# Rebanada 44 — Ajustes clínicos, calculadora y UI

Doce ajustes repartidos por la valoración. Uno de ellos —el cálculo de sal— llegó con la fórmula incompleta; ver «La fórmula de la sal» al final de esta sección.

## Antes de empezar

Hay **migración** (046): cinco columnas del tamizaje, las observaciones del historial y la justificación de la prescripción.

```
docker compose -f infra/docker-compose.dev.yml up -d --build api web-pro
docker compose -f infra/docker-compose.dev.yml exec api node dist/migrate.js
```

## 1 · Clínico — sin botones de FAF

| Paso | Qué comprobar |
|---|---|
| Consulta → **Clínico** → Actividad física | **No** hay tarjetas «Sedentario / Leve / … FAF 1.2» |
| En el mismo bloque | **No** hay recuadro «Factor de actividad» |
| Lo que sí queda | Sesiones por semana, Duración media y Detalles |
| Guardar el historial y volver a abrirlo | Sesiones y duración se conservan |

**Lo que hay que mirar con atención:** que el FAF del paciente **no se borre**. La columna `tipo_actividad` sigue en la base con lo que se eligió antes, y de ella deriva el servidor el `faf` que alimenta la calculadora. El formulario la devuelve tal cual aunque no la pinte; si ese viaje de ida y vuelta se rompe, el primer guardado del historial deja el FAF en nulo —este PUT reemplaza la fila entera—. Comprobación: con un paciente que tenga actividad registrada, guardar el Clínico y mirar que `tipo_actividad` y `faf` de `historial_clinico` siguen igual.

## 2 · Clínico — las siete preguntas nuevas

El bloque pasa a llamarse **«Relación con los alimentos»** y pregunta exactamente:

1. ¿Hay alimentos que generen culpa o vergüenza?
2. ¿Sientes que mereces comer solo después de hacer ejercicio?
3. ¿Las emociones influyen en cómo y qué comes?
4. ¿Te resulta fácil identificar cuándo tienes hambre o estás satisfecho/a?
5. ¿Sientes que tu valor personal depende de cómo luces?
6. ¿La comida ocupa gran parte de tus pensamientos durante el día?
7. ¿Clasificas ciertos alimentos o grupos de alimentos como «buenos» o «malos»?

| Paso | Qué comprobar |
|---|---|
| El control de cada fila | La misma escala Likert de antes: Nunca · Casi nunca · A veces · A menudo · Siempre |
| Preguntas que ya **no** aparecen | «Se salta comidas», «Episodios de atracón», «Dietas frecuentes» |
| Paciente con el tamizaje viejo respondido | Las preguntas 1 y 3 llegan **marcadas**: conservan su columna (`culpa_al_comer`, `alimentacion_emocional`) |
| Responder las siete y guardar | Al reabrir salen las siete marcadas |

**Lo que hay que mirar con atención:** las tres preguntas retiradas tampoco se borran. Son `salteo_comidas`, `atracones` y `dietas_frecuentes`, y el formulario las devuelve sin enseñarlas, igual que el FAF. Guardar el Clínico varias veces no debe cambiar esos tres valores:

```sql
select salteo_comidas, atracones, dietas_frecuentes
  from historial_clinico where paciente_id = '…';
```

**Por qué columnas nuevas y no un JSONB:** las cinco preguntas que entran son cinco columnas `smallint` con el mismo `CHECK (between 1 and 5)` que las cinco que ya había. Mover el tamizaje a un documento JSON habría dejado huérfano lo ya respondido.

## 3 · Clínico — CUCI y Crohn

| Paso | Qué comprobar |
|---|---|
| Clínico → **Salud digestiva** | Aparecen **CUCI (Colitis Ulcerosa Crónica Idiopática)** y **Enfermedad de Crohn** |
| Las siete de antes | Siguen todas, incluida «Enfermedad inflamatoria intestinal» |
| Marcar una de las nuevas y guardar | Se conserva al reabrir |

La lista vive en un `jsonb`, así que añadir opciones no necesitó migración. «Enfermedad inflamatoria intestinal» se queda a propósito: no todo caso tiene el subtipo precisado.

## 4 · Clínico — Observaciones clínicas

| Paso | Qué comprobar |
|---|---|
| Bajar al final de Clínico | Tras **Hábitos** hay una tarjeta **«Observaciones clínicas»** con textarea y su propio botón |
| Escribir, guardar y recargar | El texto vuelve |
| Después de guardar observaciones | Antecedentes, síntomas y tamizaje **intactos** |

**Lo que hay que mirar con atención:** esa última fila. Las observaciones tienen **endpoint propio** (`PUT …/historial/observaciones`) justo por eso: el PUT del historial completo reemplaza la fila entera, y mandarlo desde una tarjeta que no tiene el resto del formulario a mano borraría antecedentes, síntomas y tamizaje de un golpe.

**No confundir con la otra caja del mismo nombre.** Hay dos «Observaciones clínicas» en la valoración y son campos distintos:

| Dónde | Tabla · columna | A qué pertenece |
|---|---|---|
| Clínico (esta) | `historial_clinico.observaciones_clinicas` | Al **paciente**; se actualiza visita a visita |
| Prescripción | `conclusion_valoracion.observaciones_clinicas` | A **una consulta**; es el juicio de ese día |

Escribir en una no debe cambiar la otra. Vale la pena comprobarlo.

## 5 · Dietético — consumo usual con listas ADA

**Ya funcionaba; esto es una verificación, no un cambio.** Recordatorio 24h y Consumo Usual son el **mismo componente** (`TablaDietetica`) contra el **mismo endpoint**, y solo se distinguen por el `tipo` de la URL. El prompt del análisis (`SISTEMA_ADA`, en `routes/registroDietetico.ts`) es idéntico para los dos.

| Paso | Qué comprobar |
|---|---|
| Dietético → **Consumo Usual** → escribir alimentos en Desayuno | Aparece el botón **Analizar IA** |
| Pulsarlo | Vuelve con kcal · CHO · Prot · Grasas, igual que en Recordatorio 24h |
| El pie de la tabla | Suma el día |
| Corregir el kcal a mano | Queda el valor propio y al lado «(IA: …)» |
| Volver a Recordatorio 24h | Su contenido no cambió: son dos registros distintos, `unique (consulta_id, tipo)` |

**Por qué parecía no funcionar:** la semilla solo trae filas de `recordatorio_24h`. Un Consumo Usual en blanco no enseña macros porque no hay nada analizado, no porque el cálculo falte.

> **Esta explicación era incompleta, y la tabla de arriba se dio por buena sin ejercitarla.** El botón se volvió a reportar como roto. La cadena hasta la IA está entera —se comprobó con una llamada real—, pero **cuando falla no se veía**: el aviso se pintaba al pie de una tabla de seis filas y el resumen de macros convertía cualquier error de red en «Sin analizar». Ver la **R46 §4**, que lo corrige.

## 6 · Calculadora — solo ADA en el selector

| Paso | Qué comprobar |
|---|---|
| Prescripción → calculadora → **Sección B** | El selector de método enseña **solo ADA** |
| INCIENSA y Colombianas | No aparecen |
| Abrir una conclusión guardada **con** INCIENSA | Su pestaña **sí** aparece, con un aviso en ámbar: «ya no se ofrece para prescripciones nuevas» |

**Por qué esa excepción:** quitarlas del selector no puede hacer ilegible una prescripción que ya se firmó. Sin su pestaña, la tabla de intercambios de esa conclusión se vería sin que nada en pantalla dijera de dónde sale. Nada se borró del código: `METODOS_DIETA` y `ORDEN_METODOS` siguen enteros, y la lista de lo que se ofrece es `METODOS_DIETA_OFRECIDOS`.

## 7 · Calculadora — azúcar y sal recomendadas

Bloque nuevo entre la distribución de macronutrientes y la tabla de intercambios.

**Azúcar libre** — `(REQ × 0.10) / 4 / 15`, en cucharadas de 15 g:

| REQ | Debe decir |
|---|---|
| 1200 | **2.0** cdas/día |
| 1750 | **2.9** cdas/día |
| 2400 | **4.0** cdas/día |

Sin REQ, el bloque dice «Indica el REQ a utilizar para calcularla».

**Sal** — cuatro botones de meta de sodio:

| Botón | Debe decir |
|---|---|
| 2500 mg | **1.2** cdtas/día |
| 2000 mg | **1.0** cdtas/día |
| 1600 mg | **0.8** cdtas/día |
| 800 mg | **0.4** cdtas/día |

| Paso | Qué comprobar |
|---|---|
| Sin elegir sodio | «Elige una meta de sodio para calcular las cucharaditas» |
| Pulsar el botón ya elegido | Se deselecciona y vuelve el aviso |
| Aplicar, guardar la conclusión y reabrir la calculadora | El sodio elegido sigue marcado |
| Abrir el panel de detalle de la consulta (R43) | Enseña «Meta de sodio» y «Sal» en el bloque de la calculadora |

El mg se guarda en `datos_calculadora.sodioMg`; las cucharaditas se derivan al pintar, así que un cambio en el factor no deja números viejos que ya no cuadran con su propia fórmula. El servidor solo acepta los cuatro valores de la lista.

## 8 · Prescripción — alergias del paciente

| Paso | Qué comprobar |
|---|---|
| Paciente **con** alergias → Prescripción dietética | Primer bloque de la sección, en ámbar, con las alergias como badges |
| Compararlo con el card del Resumen del expediente | Las mismas, con el mismo color |
| Paciente **sin** alergias registradas | El bloque **no aparece** |
| Intentar editarlas desde ahí | No se puede: es solo lectura |

**Por qué no aparece vacío:** un «Sin registrar» en el sitio donde se decide la prescripción se lee como «no tiene», y eso es peor que no decir nada.

## 9 · Prescripción — Justificación

| Paso | Qué comprobar |
|---|---|
| Prescripción | Entre **Prescripción dietética** y el plan alimentario hay una tarjeta **Justificación** |
| Escribir y guardar | Vuelve al recargar |
| Panel de detalle de la consulta (R43) | Enseña la justificación como sección propia |
| Si queda vacía | El panel la nombra en «Sin registrar en esta consulta» |

## 10 · El botón «+ Punto de control» no está

| Paso | Qué comprobar |
|---|---|
| Ficha del paciente → cabecera | **No** hay «+ Punto de control»; el de exportar a PDF sigue |
| Pestaña **Historial** | Los controles que ya existen siguen pudiéndose editar, cerrar y corregir |
| Un snapshot en borrador | Su botón «Editar» abre el modal de siempre |

Solo se ocultó el atajo de creación. `SnapshotModal`, el endpoint y el timeline siguen enteros; en `PacienteFicha.tsx` queda el comentario con lo que hay que devolver si el botón vuelve.

## 11 · Tipo de consulta al abrir una nueva

| Paso | Qué comprobar |
|---|---|
| Resumen → **Valoraciones** → «+ Nueva consulta» | Se abre un formulario **antes** de crear nada |
| Lo primero del formulario | Dos opciones: **Consulta normal** · **Seguimiento rutinario**, con su descripción |
| Propuesta por omisión | «Consulta normal» si el paciente no tiene ninguna; «Seguimiento rutinario» si ya tiene |
| **Cancelar** | No se crea nada |
| **Abrir consulta** | Se crea con el tipo elegido y navega a la valoración |
| La lista de Valoraciones | Cada fila lleva una etiqueta con su tipo |
| Cabecera de la valoración y panel de detalle | Usan el mismo vocabulario |

**Lo que hay que mirar con atención:** que elegir «Consulta normal» en la quinta visita **se respete**. Antes el tipo se derivaba del ordinal —la primera inicial, el resto seguimiento— y esa sigue siendo la regla si el cuerpo no trae `tipo`. Comprobación directa:

```sql
select numero_consulta, tipo from consulta
 where paciente_id = '…' order by numero_consulta desc limit 3;
```

Las claves del enum **no cambiaron**: siguen siendo `inicial` y `seguimiento`. Lo que cambió es el rótulo.

## 12 · La carpeta se llama «Prescripción»

| Paso | Qué comprobar |
|---|---|
| Pestañas de la valoración | La quinta dice **Prescripción**, no «Conclusiones» |
| Con secciones sin completar, pasar el ratón por «Finalizar valoración» | El aviso dice «Faltan por completar: … Prescripción» |

Solo el rótulo. La clave de la sección sigue siendo `conclusion` —la valida el servidor y está escrita en los `secciones_completas` ya guardados—, igual que `bioquim` sigue llamándose así detrás de «Laboratorios».

## La fórmula de la sal

El encargo pedía `(mg_seleccionados × 2.4) / 5`. Con el sodio en **miligramos**, esa cuenta da **960 cucharaditas de sal al día** para los 2000 mg de la OMS.

El 5 son **gramos**: la fórmula solo cierra si el sodio entra en gramos. Implementada como `(mg × 2.4) / 5000` da **0.96 ≈ 1 cucharadita**, que es la equivalencia conocida de 2000 mg de sodio. Se contrastó además con `calcularSal` —el cálculo de INCIENSA que ya estaba en `calculadoraNutricion.ts`—, que divide por 5000 por el mismo motivo.

Es el mismo tropiezo que el coeficiente de Schofield en la R42, y se encontró igual: **contrastando el resultado con otra ecuación del mismo panel**. Un número absurdo en pantalla se ve; el problema es que nadie lo mire.

## Verificado contra la base

Lo que se comprobó ejecutando el SQL real, no leyéndolo:

- **El upsert del historial coloca cada valor en su columna.** La numeración de los diez parámetros Likert se **deriva** de la lista en vez de escribirse a mano (`PARAMS_FIJOS`, `PH_LIKERT`), porque un desajuste de uno no da error de sintaxis: guarda el valor en la columna de al lado. Se verificó en dos pasadas —las cinco primeras con 1..5 y las otras nulas, y al revés— porque el `CHECK` limita la escala a 1..5 y con diez columnas no hay forma de distinguirlas en una sola.
- **El upsert parcial de observaciones no toca nada más**: `notas_adicionales`, el tamizaje y los síntomas quedaron intactos.
- **`faf` sigue derivándose** del `tipo_actividad` conservado.
- **La justificación** aterriza en su columna sin mover diagnóstico ni kcal.
- **El tipo pedido manda**: `inicial` → inicial, `seguimiento` → seguimiento, ausente → la regla del ordinal.
- **Los dos registros dietéticos conviven** en la misma consulta.

**Lo que no se pudo probar con un token real:** las credenciales de desarrollo de este documento (`ana@vida.cr` / `nutrismart-dev`) devuelven `invalid_grant` en el Keycloak actual, así que los endpoints se ejercitaron por su SQL y sus mappers, no por HTTP. El **análisis IA del Consumo Usual** tampoco se llamó de verdad: gasta crédito de Claude. Queda para el recorrido manual.

---

---

# Rebanada 45 — Altas de verdad: panel de plataforma y cuentas automáticas

Hasta aquí, dar de alta a un profesional creaba una **ficha**, no una cuenta: alguien tenía que entrar a Keycloak a mano. Esta rebanada cierra ese hueco por los dos extremos.

- **Panel de plataforma** (`/superadmin`): crear clínicas y su primer administrador.
- **Alta de equipo** (`/ajustes/equipo`): la pantalla ya existía; ahora crea la cuenta de verdad y dice qué pasó.
- **El rol en Keycloak** se asigna desde la API al dar de alta a un administrador.

## Antes de empezar

No hay migración. Sí hay **configuración de Keycloak**, y sin ella nada de esto funciona. Lo que toca hacer depende de si el realm se importa de cero o ya existe.

### 1 · El service account de la API

El cliente que la API usa para hablar con el Admin API. Si falta, la plataforma sigue funcionando: las altas vuelven al flujo manual (ficha en «invitación pendiente») y el panel de plataforma responde **503** explicando qué falta. Es la regla de oro de no bloquear el acceso clínico, aplicada a esto.

**Realm importado de cero: no hay que tocar nada.** El export (`infra/keycloak/realm-nutrismart.json`) ya trae el cliente `nutrismart-backend`, su service account y el rol `manage-users`, y `.env.example` trae las tres variables con el mismo secret de desarrollo.

**Realm que ya existe** (el caso normal aquí, Keycloak se comparte con Vetline): hay que crearlo a mano.

| Dónde | Qué |
|---|---|
| Clients → Create client | Client ID `nutrismart-backend`, **Client authentication: On**, **Service accounts roles: On** |
| | **Standard flow: Off**, **Direct access grants: Off** — este cliente no es para personas |
| Credentials | Copiar el secret a `KEYCLOAK_SVC_SECRET` |
| Service accounts roles → Assign role → **Filter by clients** | `realm-management` → **`manage-users`**, nada más |

> **`manage-users` basta, y no es casualidad.** Asignar un rol necesita su `{id, name}`, y lo evidente —`GET /roles/{nombre}`— exigiría además **`view-realm`**, que abre la lectura de toda la configuración del realm. La API lo busca en los endpoints de role-mappings *del usuario*, que `manage-users` ya cubre. Si alguien amplía esto, que no amplíe los permisos del service account sin motivo.

```
KEYCLOAK_ADMIN_URL=http://localhost:8080   # dev en el host; el compose lo pisa con keycloak:8080
KEYCLOAK_REALM=nutrismart
KEYCLOAK_SVC_CLIENT=nutrismart-backend
KEYCLOAK_SVC_SECRET=<el secret de Credentials>
```

> **`KEYCLOAK_ADMIN_URL` tiene la misma trampa que `KEYCLOAK_JWKS_URL`.** Es una ruta de red server-to-server, así que vale `localhost:8080` ejecutando la API en el host y `keycloak:8080` dentro de Docker. El valor por defecto del código es el **interno**, de modo que arrancar en el host sin esta línea falla al crear el primer usuario. (El `KEYCLOAK_ISSUER` no cambia nunca: lo emite el navegador.)

### 2 · El rol `super_admin` y su usuario

El rol ya está en el export; en un realm ya importado hay que crearlo a mano (Realm roles → Create role → `super_admin`).

El usuario operador se crea siempre a mano —no hay nadie por encima que lo cree— y hay **una cosa que NO se le pone**:

| Dónde | Qué |
|---|---|
| Users → Add user | Username y email del operador |
| Credentials | Contraseña (o Required action `Update Password`) |
| Role mapping | **`super_admin`** |
| Attributes | **ningún `tenant_id`** |

> **El operador de plataforma no lleva `tenant_id`, y es deliberado.** No pertenece a ninguna clínica. Ponerle el UUID de una clínica cualquiera para «que el token pase» haría que ese UUID acabara usándose como filtro en alguna query, apuntando a una clínica que no es la suya. Las rutas de plataforma usan `requireSuperAdmin`, que no pide el claim.


## 1 · El panel solo se abre con el rol

| Paso | Qué comprobar |
|---|---|
| Entrar como `luis@vida.cr` (nutricionista) → teclear `/superadmin/clinicas` | Redirige a **Pacientes**. En la barra lateral **no** hay «Plataforma» |
| Entrar como admin de clínica → `/superadmin/clinicas` | Redirige a **Pacientes** |
| `curl` a `/api/superadmin/clinicas` con el token de cualquiera de los dos | **403** `solo_super_admin` |

> El redirect del navegador **no es la defensa**: es para no ofrecer un enlace que la API va a rechazar. Quien manda es el 403.

## 2 · El operador entra sin clínica

| Paso | Qué comprobar |
|---|---|
| Entrar con el usuario `super_admin` | Se pinta el panel **sin barra lateral de clínica**, bajo una cabecera «NutriSmart · Plataforma» |
| Cabecera | El correo del operador y «Cerrar sesión» |
| Consola del navegador | **Ningún 404** de `/api/profesional/yo` ni de `/api/me` |
| Cualquier otra URL (`/pacientes`, `/agenda`) | Redirige a `/superadmin/clinicas` |

> Los 404 son la comprobación interesante: un operador no tiene ficha en ninguna clínica, así que esas dos peticiones **no deben salir**. Si aparecen, es que la condición de la app mira solo la sesión y no el tenant.

Quien es operador **y además** trabaja en una clínica sí ve el Shell normal, con «Plataforma» como una sección más de la barra lateral.

## 3 · Crear una clínica

| Paso | Qué comprobar |
|---|---|
| Nombre comercial + país → **Crear clínica** | Aparece en la tabla, con su fecha de alta |
| Nombre o país vacíos | El botón está deshabilitado |
| Nombre de más de 200 caracteres (por `curl`) | **400** `validacion` |

## 4 · El primer administrador

| Paso | Qué comprobar |
|---|---|
| En su fila → **Crear admin** → nombre + correo → **Crear administrador** | Mensaje en verde: «Usuario administrador creado. Se envió un correo a …» |
| Keycloak → Users → el correo → **Attributes** | `tenant_id` = el UUID de la clínica recién creada |
| Keycloak → Users → el correo → **Role mapping** | **`admin_clinica`** |
| Keycloak → Users → el correo → **Details** | Required action **Update Password** |
| El mismo correo otra vez en la misma clínica | **409** `correo_repetido` |

> **`tenant_id` en Attributes es la comprobación que más duele si falla.** El claim del token sale de ese atributo vía protocol mapper. Sin él, la persona establece su contraseña, Keycloak la autentica **sin un solo error**, y la aplicación le dice «tu sesión no es válida». Nada en el log de Keycloak apunta al problema, porque desde su punto de vista no hay ninguno.

### Que el administrador nuevo pueda entrar de verdad

| Paso | Qué comprobar |
|---|---|
| Abrir el enlace de activación (o fijar la contraseña desde Keycloak) | Entra a la app profesional |
| Barra lateral | Dashboard, Clínica, Equipo y Marca **llevan a algún sitio** (es administrador) |
| Pacientes | Vacío, sin error |
| Ajustes → Clínica | Sale el nombre y el país que puso el operador |

> Si entra pero Equipo y Clínica aparecen apagadas, lo que falta es el **rol en Keycloak**, no un permiso de la base.

## 5 · Cuando el rol no se puede asignar

Se provoca borrando el rol `admin_clinica` del realm, o quitándole `manage-users` al service account.

| Paso | Qué comprobar |
|---|---|
| Crear un administrador desde el panel | **503** `rol_no_asignado`, con el motivo real en el mensaje |
| Keycloak → Users | El usuario **no existe**: se borró |
| Base de datos → `profesional` | **Ninguna** fila nueva |
| Reintentar con el mismo correo después de arreglar el realm | Funciona, sin «ya existe un usuario con ese correo» |

> **Aquí sí se deshace todo, y en el alta de equipo no.** La diferencia es el orden: el panel asigna el rol **antes** del insert, así que un fallo se puede revertir por completo. Un admin sin su rol entra y no puede administrar nada, de modo que dejarlo a medias no sirve de nada. En el alta de equipo (sección 6) el profesional ya está en la base cuando se asigna el rol, y ahí fallar sería peor: diría «no se pudo» sobre alguien que sí quedó creado.
>
> El borrado se **espera** antes de responder. Lanzado sin `await`, el reintento inmediato del operador chocaría con «ya existe un usuario con ese correo».

## 6 · Alta de equipo con cuentas automáticas

Como administrador de clínica, en **Ajustes → Equipo**.

| Paso | Qué comprobar |
|---|---|
| Texto bajo «Invitar a alguien al equipo» | «Se crea la cuenta en el sistema y se envía un correo…» |
| Invitar a un **nutricionista** | Estado **Activo** (no «Sin cuenta todavía»). Recibo con borde verde: «… ya tiene cuenta» |
| Keycloak → ese usuario → Attributes | `tenant_id` = la clínica del administrador que invitó |
| Keycloak → ese usuario → Role mapping | **Sin roles de realm** — un nutricionista no necesita ninguno |
| Invitar a un **administrador** | Recibo verde, y en Keycloak **sí** aparece `admin_clinica` |
| Mismo correo otra vez | **409** «Ya hay alguien con ese correo en la clínica» |

### Si el rol falla en el alta de equipo

Mismo truco que en la sección 5, pero invitando desde Equipo.

| Paso | Qué comprobar |
|---|---|
| Invitar a alguien como **administrador** | El alta **no falla**: recibo con borde **ámbar** |
| Texto del recibo | «No se le pudo dar el rol de administrador en Keycloak: entrará como nutricionista. Asígnaselo a mano en Keycloak → Users → … → Role mapping», con el motivo debajo |
| La tabla | La persona figura como Administrador y Activo |

### Sin el service account configurado

Quitar `KEYCLOAK_SVC_SECRET` del entorno y reiniciar la API.

| Paso | Qué comprobar |
|---|---|
| Texto bajo «Invitar a alguien al equipo» | Cambia a «Esto crea su ficha en la clínica, **no** su cuenta de acceso…» |
| Invitar | Estado **«Sin cuenta todavía»**. Recibo: «… está en la clínica, sin cuenta todavía» |
| Panel de plataforma → crear administrador | **503** `keycloak_admin_no_configurado` |

> Las dos frases son opuestas y el administrador no puede adivinar cuál aplica. El texto lo decide `cuentasAutomaticas`, que viene de `/api/profesional/yo`, no una frase fija. Prometer una cuenta que no se crea deja al administrador convencido de que su compañero ya puede entrar.

## 7 · Lo que el cambio de rol sigue sin hacer

| Paso | Qué comprobar |
|---|---|
| En la tabla de Equipo, cambiar un nutricionista a **Administrador** | La columna cambia; en Keycloak **no** aparece `admin_clinica` |
| Que esa persona vuelva a entrar | Sigue entrando **como nutricionista** |
| Pie de la pantalla | Lo dice: «Concederlos ahí necesita además el rol en Keycloak» |

> **Es a propósito, y es la asimetría que sostiene el modelo.** El *alta* sí concede el rol: la hace un administrador que ya lo es, sobre una persona que no tenía nada que escalar. El *cambio de rol* no: si lo hiciera, cualquiera con la columna en la base podría ascenderse desde ese mismo formulario. Degradar surte efecto de inmediato; ascender no.

## 8 · Aislamiento entre clínicas

| Paso | Qué comprobar |
|---|---|
| Crear dos clínicas con un administrador cada una | — |
| Entrar como el admin de la clínica A → Equipo | Solo su equipo. El admin de B **no aparece** |
| `GET /api/admin/profesionales` con el token de A | Ninguna fila de B |
| Entrar como el admin de A → `/superadmin/clinicas` | Redirige a Pacientes (no es operador de plataforma) |

---

---


# Rebanada 46 — Cinco defectos de uso

Cinco fallos reportados probando la aplicación con datos reales. No comparten código, pero sí el mismo origen: cosas que solo se ven usando la pantalla, no leyéndola.

## 1 · La Disponibilidad Energética se medía contra el GET

**Dónde:** Nueva consulta → **Conclusiones** → **Abrir calculadora** → Sección A, bloque «Disponibilidad Energética» (solo con método **Cunningham**).

La DE salía de `(GET − GEE) ÷ MLG`. Debe salir de `(meta calórica − GEE) ÷ MLG`, donde la meta calórica es el **«REQ a utilizar»** de la Sección B — el mismo número que viaja a «Meta calórica (kcal/día)» en la Prescripción dietética.

**Por qué importaba.** El GET de Cunningham es `GER × 1.1 + GEE`, así que restarle el GEE lo deja en `GER × 1.1`: la cuenta se mordía la cola. La DE valía siempre `GER × 1.1 ÷ MLG` y **no se movía al prescribir** un superávit o un déficit, que es justo lo que el indicador de RED-S tiene que detectar. El GET se autorrellena como REQ, de modo que mientras nadie tocaba el campo los dos valores coincidían y el fallo pasaba desapercibido.

**Caso de prueba** — MLG **75.09 kg**, GEE total **820.2 kcal**, meta calórica **3300 kcal**:

| Lectura | Antes | Ahora |
|---|---|---|
| GER (`500 + 22 × 75.09`) | 2152 kcal | 2152 kcal |
| GET (`GER × 1.1 + GEE`) | 3187 kcal | 3187 kcal |
| **Disponibilidad energética** | **31.5** ❌ | **33.0** ✅ |
| Nivel | Deficiencia leve / moderada | Deficiencia leve / moderada |

`(3300 − 820.2) ÷ 75.09 = 33.02`. Para reproducir el GEE: una actividad de **75.09 kg · 60 min · 10.4 METS** da 820.2 kcal.

| Paso | Qué comprobar |
|---|---|
| Cargar los datos del caso y mirar la DE | **33.0**, no 31.5 |
| Debajo del número | La cuenta a la vista: `(3300 − 820.2) ÷ 75.09 kg` |
| Subir el REQ a utilizar a 4000 | La DE sube a **42.3** en el momento |
| Bajarlo a 2500 | La DE baja a **22.4** y el nivel pasa a **severa** (rojo) |
| Borrar el REQ a utilizar | El bloque pide la meta calórica, sin número inventado |
| Borrar la MLG | El bloque pide la MLG (mensaje distinto del anterior) |

**Lo que hay que mirar con atención:** que la DE **reaccione** al cambiar el REQ. Un número que no se mueve al prescribir es el síntoma exacto del fallo que se corrigió.

**Comprobación de la fórmula** (sustituye la fila de la R42, que probaba el comportamiento viejo):

| Entrada | Salida |
|---|---|
| `disponibilidadEnergetica(3300, 820.2, 75.09)` | 33.0 |
| `disponibilidadEnergetica(2388, 385.9, 60)` | 33.4 |
| `disponibilidadEnergetica(…, 0)` | `null` |

## 2 · El foco se perdía al escribir en antecedentes familiares

**Dónde:** Nueva consulta → **Clínico** → bloque **Antecedentes familiares** → marcar una condición → campo **«¿Quién?»**.

Cada carácter escrito sacaba el foco del campo. Había que volver a hacer clic para escribir el siguiente, así que «Madre» se teclaba en cinco clics.

| Paso | Qué comprobar |
|---|---|
| Marcar «Diabetes mellitus tipo 2» | Aparece el campo «¿Quién?» a la derecha |
| Hacer clic en él y escribir **Madre y abuela** de corrido | Se escribe **entero, sin soltar el foco** |
| Mirar el cursor a mitad de palabra | Sigue donde estaba; no salta al final ni al `<body>` |
| Marcar tres condiciones y escribir en las tres | Cada campo conserva su texto y su foco |
| Guardar historial y recargar (F5) | Los parentescos siguen ahí |

**La causa.** El componente `Bloque` —la caja con título que envuelve cada sección— estaba declarado **dentro** del cuerpo de `FormHistorialClinico`. Eso le daba una identidad de función nueva en cada render, y para React un tipo de componente distinto no es «el mismo componente con otras props»: es otro componente. Desmontaba el subárbol completo y montaba uno nuevo. Con el `<input>` del DOM recreado, el foco se iba al `<body>`.

Escribir una letra llamaba a `setApf` → render → `Bloque` nuevo → remonte → foco perdido. El fallo solo se notaba en ese campo porque es el único de texto libre dentro de un bloque; las casillas y los botones de las demás secciones también se remontaban, sin síntoma visible.

**Arreglo:** `Bloque` sube a ámbito de módulo. El mismo patrón estaba en `PlanEditor` (`const Acciones = () => …`, dos botones remontados en cada tecla de la tabla), y pasa a ser un elemento JSX en vez de un componente.

**La invariante, comprobable sin navegador** — ningún componente declarado dentro de un render:

```
cd apps/web-professional && grep -rnE "^  const [A-Z][A-Za-z0-9]* = \(" src/
```

Sin coincidencias. Si alguna aparece, el candidato está remontando su subárbol en cada render: o sube a ámbito de módulo (si lleva props) o se convierte en elemento (si no).

## 3 · Los campos numéricos cerraban el teclado y no tenían flechas en tablet

**Dónde:** Nueva consulta → **Clínico** → **Actividad física** (sesiones por semana, duración media) y el bloque de **Hábitos**, debajo de Sustancias (horas de sueño, veces que despierta).

Dos síntomas, dos causas, y ninguna es un descuido del CSS:

**1. No había flechas.** Los navegadores táctiles **no dibujan el spinner** de un `<input type="number">`. Safari de iOS y Chrome de Android simplemente no lo pintan; no hay regla que quitar, porque no había ninguna puesta. La única forma de tener incremento y decremento a la vista en una tablet es dibujarlos.

**2. El teclado se cerraba.** `type="number"` **se sanea solo**: mientras se escribe un valor a medias —«5.», «1e», «-»— la propiedad `value` del nodo vale **cadena vacía**, no lo escrito. Un campo controlado recibe `''`, lo guarda en el estado y React lo reescribe en el nodo: el valor desaparece, el caret salta y el teclado táctil lo cuenta como cambio de contexto y se recoge. En la pantalla Clínico esto se sumaba al remonte del §2, que lo hacía con cualquier campo.

**Arreglo:** `InputNumero` (`components/InputNumero.tsx`) — `type="text"` con `inputMode="numeric"`/`"decimal"`, que saca el mismo teclado sin sanear nada, más dos flechas apiladas de **36 × 24 px** (el mínimo táctil de la WCAG 2.5.8, que el spinner nativo de escritorio ni siquiera alcanza). La lógica pura vive en `lib/numero.ts`.

| Paso | Qué comprobar |
|---|---|
| Mirar cualquiera de los cuatro campos | Las dos flechas **▲▼** a la derecha, siempre visibles, también en tablet |
| Tocar el campo en una tablet y escribir **120** en duración | El teclado numérico sale y **no se cierra** entre dígitos |
| Escribir **7,5** en horas de sueño | La coma del teclado español se convierte en punto: `7.5` |
| Escribir **7.** y quedarse ahí | Se queda «7.»; no se vacía a mitad de escritura |
| Salir del campo con «7.» | Queda **7** |
| Tocar **▲** con el teclado abierto | Sube el valor y **el teclado sigue abierto** (`preventDefault` en `pointerdown`) |
| Flechas ↑ / ↓ del teclado físico | Hacen lo mismo que las del control |
| Duración: **▲** desde vacío | **5** (su paso es de 5 min, no de 1) |
| Horas de sueño: **▲** desde vacío | **1**, el mínimo; no un 0 que el campo no admite |
| Escribir **500** en sesiones por semana y salir | Baja a **21**, el máximo |
| Escribir **2.6** en «veces que despierta» y salir | **3**: es un campo entero |
| Dejar un campo vacío y salir | Sigue **vacío** — no se rellena con el mínimo; vacío es «sin dato», no cero |
| Letras o texto pegado | No entran |
| Consulta finalizada | Las flechas salen deshabilitadas con el campo |

**Lo que hay que mirar con atención:** que acotar y redondear ocurran **al salir del campo**, no en cada tecla. En un campo de 0 a 21, acotar mientras se escribe convertiría el «1» de quien va a escribir «10» en otra cosa.

**Comprobación de la lógica, sin navegador:**

```
node --input-type=module -e "
const m = await import('file:///C:/Nutrismart/apps/web-professional/src/lib/numero.ts');
const SES = {min:0, max:21, decimales:false};
console.log(m.limpiar('3 veces', {decimales:false, negativos:false}));  // 3
console.log(m.limpiar('7.', {decimales:true, negativos:false}));        // 7.
console.log(m.mover('', 1, 1, SES));                                     // 1
console.log(m.normalizar('500', SES));                                   // 21
console.log(m.normalizar('', SES));                                      // (vacio)
"
```

**Pendiente a propósito:** el resto de la aplicación sigue con `type="number"`. `InputNumero` está listo para adoptarse campo a campo (antropometría, laboratorios, calculadora, app del paciente), pero cambiarlos todos en la misma rebanada que corrige cinco defectos mezclaría el arreglo con una migración.

## 4 · «Analizar IA» parecía no llamar a la IA

**Dónde:** Nueva consulta → **Dietético** → **Consumo Usual** (y **Recordatorio 24h**) → escribir alimentos → botón **Analizar IA**. El resumen, en **Resumen y macros**.

### Lo que se encontró al trazarlo

La R44 §5 dio esto por bueno sin ejercitarlo («ya funcionaba; esto es una verificación, no un cambio») y lo explicó como falta de datos de semilla. Trazado de verdad, la cadena **sí está entera** —y lo está hoy—:

| Eslabón | Comprobado | Resultado |
|---|---|---|
| Handler del botón | `TablaDietetica.analizar()` | Guarda y después analiza; no es un handler vacío |
| Endpoint | `POST …/registro-dietetico/:tipo/analizar-ia` | Registrado en `server.ts` |
| Clave | `docker exec nutrismart-api env` | `ANTHROPIC_API_KEY` presente |
| Modelo | `ANTHROPIC_MODELO` vacío → `claude-haiku-4-5` | Alias vigente; sirve `claude-haiku-4-5-20251001` |
| Llamada real | SDK + `construirPrompt` + `parsearJson` dentro del contenedor | **370 kcal · 30 CHO · 16 prot · 16 grasas**, JSON extraído de su cerca markdown |
| Histórico | `select * from uso_ia` | 4 `analisis_dietetico` con `exito = true` |
| Base de datos | upsert de `consumo_usual` en una transacción | Acepta; el enum trae los dos tipos y el `unique (consulta_id, tipo)` está |

**Entonces el fallo no era que no llamara: era que cuando falla no se ve.** Tres sitios lo tapaban, y los tres producen exactamente los dos síntomas reportados:

| Dónde | Qué hacía | Síntoma que producía |
|---|---|---|
| `TablaDietetica`, pie del componente | El aviso de error se pinta **debajo de las observaciones**, al final de una tabla de seis filas | Pulsar «Analizar IA» en el Desayuno: el botón deja de girar, no aparece ningún macro y el motivo cae fuera de la pantalla → **«no dispara ninguna llamada»** |
| `TotalesRecordatorio`, `.catch(() => null)` | Un 403, un 500 o un corte de red se convertían en `null`, igual que «no hay nada analizado» | **«el resumen de macros queda vacío»** — no estaba vacío, estaba roto, y lo decía como si estuviera vacío |
| `TablaDietetica`, `.catch(() => {})` de la carga | Comentado como «sin registro aún», pero sin registro el servidor responde **200 con las seis filas vacías**: por ahí solo pasan fallos de verdad | Tabla en blanco indistinguible de una consulta nueva; sobre ella, analizar solo podía fallar |

Y un cuarto, en la API: los seis fallos distintos de IA colapsaban en un único *«no está disponible ahora mismo»*, que manda a esperar a quien nunca va a ver el botón funcionar porque falta la clave. `config.iaHabilitada` se calculaba y **no se usaba en ningún sitio**, así que tampoco había dónde verlo al arrancar.

### Qué comprobar

| Paso | Qué comprobar |
|---|---|
| Consumo Usual → Desayuno → «2 tazas de café con leche, 2 tostadas con mantequilla» → **Analizar IA** | Vuelve con **kcal · CHO · Prot · Grasas** (≈370 / 30 / 16 / 16 con Haiku) |
| El pie de la tabla | Suma el día |
| **Resumen y macros** | La fila «Consumo Usual» trae los totales, y **Copiar a los macros declarados** los vuelca |
| Volver a Recordatorio 24h | Su contenido no cambió: son dos registros, `unique (consulta_id, tipo)` |
| Arrancar la API **sin** `ANTHROPIC_API_KEY` | En el log: `IA: SIN CONFIGURAR (falta ANTHROPIC_API_KEY)` y que el acceso clínico no se ve afectado |
| Con ella puesta | `IA: configurada` con el modelo |
| Pulsar «Analizar IA» sin clave | El aviso sale **en la propia fila**, en ámbar, y dice que falta `ANTHROPIC_API_KEY`, que **no es pasajero** y que se puede escribir el kcal a mano |
| Cortar la red de la API y recargar Resumen y macros | «No se pudo leer esta fuente: …» en rojo, **no** «Sin analizar» |

**Comprobar la cadena sin navegador** (gasta unos cientos de tokens de Haiku):

```
docker exec nutrismart-api sh -c 'echo ${ANTHROPIC_API_KEY:+clave presente}'
docker exec nutrismart-db psql -U nutrismart -d nutrismart -c \
  "select funcion, modelo, exito, error_tipo, created_at from uso_ia order by created_at desc limit 5;"
```

Si `uso_ia` no crece al pulsar el botón, la petición no llegó al servidor (mira la consola del navegador). Si crece con `exito = false`, el `error_tipo` nombra la causa y es el mismo que ahora viaja al frontend.

**Lo que hay que mirar con atención:** que el mensaje distinga **«esto se arregla esperando»** de **«esto lo arregla quien administra el servidor»**. `sin_configurar` y `credencial_invalida` son del segundo tipo, y decirles «inténtalo más tarde» es mandar a esperar algo que no va a pasar.

## 5 · Modal al salir de un formulario con cambios sin guardar

**Dónde:** en cualquier formulario. El caso que lo motivó: Nueva consulta → **Clínico** → escribir → cambiar de pestaña, y lo escrito se iba sin un solo aviso.

### El mecanismo

Centralizado en `contexts/CambiosSinGuardar.tsx`. Cada formulario se registra con **dos líneas** y no lleva ninguna lógica de «sucio» propia:

```tsx
const { marcarGuardado } = useCambiosSinGuardar({
  nombre: 'Clínico',
  activo: !cargando && !bloqueada,
  valores: { apf, app, sesiones, duracion, fuma },   // lo que hay en pantalla
  guardar,                                          // su propio guardado
})
```

y un `marcarGuardado()` en el camino de éxito de su `guardar`. El hook serializa `valores`, se queda con la primera serialización como referencia y marca cambios cuando la de ahora difiere.

**Dos detalles que no son obvios:**

1. **`marcarGuardado()` no toma la referencia en el momento de la llamada**, sino en un efecto posterior. Los formularios que al guardar recargan del servidor (`setForm(aFormulario(b))`) harían la toma con los valores de *antes* de guardar y quedarían marcados como sucios con lo que acaban de guardar. React agrupa el `setForm` con el del hook en un solo re-render y el efecto corre después, ya con los valores recargados.
2. **El sesgo es hacia «sucio»**: un modal de más es una molestia, un modal de menos es una consulta perdida.

**El bloqueo usa `useBlocker` de react-router**, que atrapa los `<Link>` y el botón Atrás **dejando el formulario montado** —si se desmontara, «Guardar» no tendría nada que guardar—. `useBlocker` exige un data router, así que `App.tsx` pasó de `<BrowserRouter>` a `createBrowserRouter([{ path: '*', element: <Raiz /> }])` + `RouterProvider`. **Ninguna ruta cambió:** las `<Routes>` de dentro siguen tal cual, como rutas descendientes bajo el splat.

Lo que no es una ruta —cambiar de pestaña— pasa por `useSalidaSegura()`, en `TabsValoracion` y `TabsDietetico`.

### Qué comprobar

| Paso | Qué comprobar |
|---|---|
| Clínico → escribir en «Otras sustancias» → pestaña **Dietético** | Sale el modal: «Hay cambios sin guardar · El formulario «Clínico» tiene cambios…» |
| **Guardar** | Guarda y **después** cambia de pestaña |
| **Abandonar** | Cambia de pestaña y descarta |
| **Seguir aquí**, o la tecla **Escape** | Se queda, sin guardar ni descartar |
| Clic fuera del modal | **No** cierra: un clic al aire no decide si lo escrito se guarda o se tira |
| Escribir y pulsar el **menú lateral** (Pacientes, Agenda…) | Mismo modal; el formulario sigue montado detrás |
| Escribir y pulsar **Atrás** del navegador | Mismo modal, y «Guardar» funciona |
| Escribir y **cerrar la pestaña** o recargar (F5) | Diálogo del navegador. Ahí no se puede ofrecer «Guardar»: es el único camino que no pasa por el modal |
| Guardar con el botón del formulario y luego cambiar de pestaña | **No** sale el modal |
| Escribir, deshacer a mano hasta dejarlo como estaba, cambiar de pestaña | **No** sale el modal: la comparación es por valor, no por «se tocó» |
| Consulta finalizada (bloqueada) | No sale nunca: `activo` es false |
| Dos formularios sucios a la vez (Clínico + Dietético) | El modal los nombra los dos y «Guardar» los guarda **en serie** |
| Si uno falla al guardar | El modal se queda abierto con el error y **no** navega |
| Escribir en una cita y pulsar Atrás | También avisa: los modales están registrados |

**Los 22 formularios registrados** (la comprobación es un grep, no hay que abrirlos uno a uno):

```
cd apps/web-professional && grep -rl "useCambiosSinGuardar" src | sort
```

Valoración: Antropometría · Clínico · Hábitos · Observaciones clínicas · Dietético · Recordatorio 24h · Consumo Usual · Conclusiones · Plan alimentario. Ficha: Sociodemografía · Notas del profesional · Plan alimentario (editor) · Nota SOAP (×2) · Umbral de alerta. Modales: Cita · Paciente · Laboratorio · Control de seguimiento · Regla de notificación. Ajustes: Datos de la clínica · Identidad visual · Recurso.

**`PanelBioquimica` queda fuera a propósito:** no tiene campos editables propios; lo que se escribe allí se escribe en el modal de laboratorio, que sí está registrado.

**Dos decisiones que conviene conocer:**

- **«Seguir aquí» no estaba en el encargo**, que pedía dos opciones. Se deja igualmente, en tercer lugar y sin relieve: sin ella, un clic por error en el menú obliga a guardar o a descartar, y descartar no tiene vuelta atrás. Quitarla es borrar un botón.
- **`NotaProfesional` no serializa valores**: se autoguarda al segundo y ya sabía decir si le quedaba algo pendiente, así que se registra ese booleano. El modal solo sale dentro de la ventana del autoguardado o si el autoguardado falló.

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
