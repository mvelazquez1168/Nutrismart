# NutriSmart · Rebanada 19 — La app del paciente entra en el stack

**Objetivo:** que `apps/web-patient` se construya, se levante con `docker compose` y se sirva en el navegador como la app profesional. Y crear el cliente de Keycloak que bloqueaba el recorrido desde la Rebanada 17.

---

## Estado

| Pieza | Estado |
|---|---|
| Patch de Resend (paso 1) | Ya aplicado en su propia rebanada |
| `apps/web-patient/Dockerfile` | **Construye** — imagen de 93 MB |
| `apps/web-patient/nginx.conf` | Escrito, con fallback de SPA |
| Servicio en `docker-compose.dev.yml` | **Levanta** en el 5175 |
| Cliente `nutrismart-patient` en Keycloak | **Pendiente** — lo crea el equipo por la consola |
| Recorrido de punta a punta | **Pendiente** del cliente anterior |

---

## Lo que apareció al construir

### `apps/web-patient` no era un workspace de npm

El primer build de Docker falló con `npm error No workspaces found: --workspace=@nutrismart/web-patient`. El `package.json` de la raíz lista los workspaces **uno a uno** —no con un glob— y la Rebanada 17 creó la app sin añadirla:

```json
"workspaces": ["apps/api", "apps/web-professional", "packages/design-system"]
```

En local no se notaba porque yo lanzaba `npx vite` desde dentro de la carpeta, que no necesita el registro. Cualquier comando con `-w @nutrismart/web-patient` —el que usa el Dockerfile— fallaba. Corregido.

Es un fallo de la Rebanada 17 que solo podía salir aquí: el desarrollo local lo tapaba.

### El Dockerfile del encargo no habría construido

La plantilla del encargo usaba `npm ci --workspace=apps/web-patient` y **nunca copiaba `packages/design-system`**. La app importa `@nutrismart/design-system` para los tokens y el preset de Tailwind: sin ese paquete en el contexto, el build muere.

Se replica el patrón real de `apps/web-professional/Dockerfile`: node 24, `npm ci` del workspace completo, copia de `tsconfig.base.json` y del design system, `nginx.conf` como fichero aparte en vez de un `printf` de treinta líneas dentro del `RUN`.

### El consejo de `host.docker.internal` habría roto la app

El paso 10 del encargo dice que si hay error de CORS hay que poner `VITE_API_URL: http://host.docker.internal:4001`, razonando que «el contenedor hace fetch a localhost:4001, que dentro del contenedor apunta a sí mismo».

**El contenedor no hace ningún fetch.** nginx sirve archivos estáticos; quien llama a la API es el navegador del paciente, que corre en su móvil o en el escritorio, fuera de Docker. Para ese navegador `localhost:4001` es correcto y `host.docker.internal` no resuelve.

Se queda `localhost` en los dos sitios, igual que en la app profesional, y el comentario del compose lo explica para que nadie lo «arregle».

### El contenedor `nutrismart-api` servía código anterior a la Rebanada 12

`depends_on: [api]` lo arranca, y su imagen era de antes de la rebanada de IA: todas las rutas desde la R12 respondían 404 mientras competía por el 4001 con `npm run dev`. Se reconstruye la imagen para que el stack sea coherente.

Ya estaba anotado en `docs/PRUEBAS.md` tras el patch de Resend; aquí se corrige de raíz.

### El 5175 lo tenía ocupado un Vite anterior

`docker compose up` falló con `ports are not available`. No es del stack: era un `npx vite --port 5175` de una prueba previa que no se había cerrado. Merece la pena saberlo porque el mensaje de Docker no dice quién ocupa el puerto.

---

## Lo verificado

```
GET /            → 200
GET /activar     → 200
GET /plan        → 200
GET /mensajes    → 200
GET /activar?token=abc → sirve index.html (fallback de SPA)
```

El fallback importa más aquí que en la app profesional: **el enlace de invitación llega por correo a `/activar?token=…`**. Sin él, el enlace daría 404 y la invitación sería inservible.

Las variables quedaron incrustadas en el bundle: `localhost:4001`, `localhost:8080`, `nutrismart-patient`.

Cabeceras de caché: `immutable` a un año para `/assets/`, `no-cache` para `index.html`.

---

## Configuración

**No hay `.env` por aplicación.** El encargo pedía `apps/web-patient/.env`; el proyecto tiene un único `.env` en la raíz y las dos apps lo leen mediante `envDir` en su `vite.config.ts`. Un segundo fichero sería una segunda fuente de verdad que se desincroniza a la primera de cambio.

El identificador del cliente se llama `VITE_KEYCLOAK_CLIENT_ID_PACIENTE`, no `VITE_KEYCLOAK_CLIENT_ID`: comparten `.env` y el nombre corto ya es el de la app profesional.

---

## El cliente de Keycloak

En `http://localhost:8080/admin`, realm **`nutrismart`**:

**Clients → Create client**

| Campo | Valor |
|---|---|
| Client type | OpenID Connect |
| Client ID | `nutrismart-patient` |
| Client authentication | OFF (cliente público) |
| Standard flow | ON |
| Direct access grants | OFF |
| Valid redirect URIs | `http://localhost:5175/*` |
| Web origins | `http://localhost:5175` |

**El mapper de audiencia, que es lo que se olvida.** Sin él todos los tokens se rechazan con 401 y el mensaje no dice por qué: la API exige `aud: nutrismart-api` y ese claim lo pone un mapper por cliente, no un scope del realm.

> Clients → `nutrismart-patient` → Client scopes → `nutrismart-patient-dedicated` → Add mapper → By configuration → **Audience**
>
> | Campo | Valor |
> |---|---|
> | Name | `aud-nutrismart-api` |
> | Included Client Audience | `nutrismart-api` |
> | Add to access token | ON |

**Registro abierto:** Realm settings → Login → **User registration: ON**. Sin esto, «Crear mi cuenta» lleva a un formulario de acceso sin opción de registrarse.

**No hace falta el rol `paciente`.** Desde la Rebanada 18 la autorización la da la fila del expediente, no el rol. Crearlo no estorba; no cambia nada.

`infra/keycloak/realm-nutrismart.json` ya declara el cliente con su mapper para instalaciones nuevas.

---

## Notas del encargo que ya no aplican

El encargo proponía para la R20 «ejecutar r15 y r16, que llevan semanas en la cola». Ambas están hechas, igual que la R12, la R17 y la R18. Lo que queda abierto es RPM y la agenda desde el lado del profesional.
