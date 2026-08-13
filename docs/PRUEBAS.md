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
