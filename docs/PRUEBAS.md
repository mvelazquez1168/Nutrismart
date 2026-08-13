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

### Vite y las dependencias nuevas
Añadir un paquete con el servidor levantado exige reiniciarlo: Vite pre-empaqueta dependencias al arrancar. Avisa con *"Re-optimizing dependencies because lockfile has changed"*.
