# NutriSmart · Rebanada 1 — Walking skeleton

**Objetivo:** el flujo end-to-end más delgado que prueba TODO el pipeline —autenticación, multi-tenancy, base de datos, API y UI— antes de apilar funcionalidades. Cuando esta rebanada funcione desplegada en local, la fundación está validada.

**El flujo:** el nutricionista inicia sesión (Keycloak) → la app profesional muestra la **lista de pacientes de su clínica** (y solo de su clínica).

---

## Alcance

**Incluye:**
- Modelo de datos base multi-tenant (migración `001`): `clinica` (tenant) → `profesional` → `paciente`.
- Runner de migraciones incremental con tabla de control `schema_migrations`.
- Autenticación contra el realm **`nutrismart`** de Keycloak; resolución de `tenant_id` (clínica) desde el token.
- API: `GET /api/me` y `GET /api/pacientes` (siempre acotado al tenant).
- Frontend profesional: login + pantalla "Pacientes" (tabla con el sistema de diseño), con estados de carga/vacío/error.
- Seed de desarrollo (1 clínica, 1 profesional, 3 pacientes).

**NO incluye (siguientes rebanadas):** crear/editar paciente, expediente/timeline, agenda, registro, IA, facturación. Solo *listar* para probar el circuito.

---

## Modelo de datos

Ver `apps/api/migrations/001_base_multitenant.sql`. Puntos clave:
- **`clinica`** es el tenant. Todo cuelga de `clinica_id`.
- **`profesional`** tiene `keycloak_user_id` (enlaza con el usuario del realm) y `rol` (`admin_clinica` | `nutricionista`).
- **`paciente`** tiene `clinica_id`, `nutricionista_id`, `estado` (baja lógica) y `estado_clinico` (normal/alerta/crítico).
- Sin borrado físico; las bajas son por `estado`.

## Autenticación y tenant

- Realm **`nutrismart`** en el Keycloak existente (aislado del de Vetline).
- Cada usuario (profesional) lleva un **atributo `tenant_id`** = `clinica_id`, mapeado al **access token como claim** (attribute mapper). El middleware de la API lee ese claim y lo usa para acotar TODAS las queries.
- Roles vía **realm roles** (`admin_clinica`, `nutricionista`).
- Lección de Vetline aplicada: **versionar la config del realm** (export) desde el inicio; comparar el issuer literalmente.

## Contrato de API

Todas requieren `Authorization: Bearer <token>`. El middleware valida el token y extrae `tenant_id` (clinica) y `sub` (keycloak_user_id).

### `GET /api/me`
```json
{
  "profesional": { "id": "…", "nombre": "Dra. Ana Rodríguez", "rol": "admin_clinica" },
  "clinica": { "id": "…", "nombre": "Clínica Nutrición Vida" }
}
```

### `GET /api/pacientes?search=&estadoClinico=`
Devuelve solo pacientes de la clínica del token (`where clinica_id = :tenant and estado <> 'baja'`).
```json
[
  {
    "id": "…",
    "nombre": "María Fernández",
    "edad": 41,
    "estadoClinico": "normal",
    "ultimaVisita": "2026-08-08",
    "nutricionista": "Dra. Ana Rodríguez"
  }
]
```
- `edad` se calcula desde `fecha_nacimiento`. Filtros opcionales `search` (nombre o documento) y `estadoClinico`.

## Frontend (app profesional)

- **Login:** redirección a Keycloak (realm `nutrismart`); al volver, guarda el token y llama a `GET /api/me`.
- **Pantalla "Pacientes":** usa el sistema de diseño (`@nutrismart/design-system`). Tabla en card con columnas: Nombre (avatar de iniciales), Edad, Última visita, Estado clínico (badge de color de estado), Nutricionista. Buscador arriba.
- **Estados:** carga (skeleton), vacío ("Aún no tienes pacientes"), error (con reintentar).
- Los 3 pacientes del seed deben verse con sus badges: María (normal), Juan (alerta), Ana (crítico).

## Criterios de aceptación

- Dado un profesional autenticado en el realm `nutrismart`, cuando abre "Pacientes", entonces ve los pacientes de SU clínica (los 3 del seed), no de otras.
- Dado un token sin/ inválido, cuando llama a la API, entonces recibe 401.
- Dado que un paciente está en `estado = 'baja'`, cuando se lista, entonces no aparece.
- Dado que se corren las migraciones dos veces, entonces la segunda no reintenta la 001 (tabla de control).
- Dado `docker compose -f infra/docker-compose.dev.yml up`, entonces API, web profesional y Postgres levantan, y la web muestra la lista.

---

## Prompt para Claude Code (pégalo en `c:\nutrismart`)

```
Lee CLAUDE.md, docs/REBANADA-01.md y apps/api/migrations/001_base_multitenant.sql.
Implementa la Rebanada 1 (walking skeleton) en rebanadas pequeñas y verificables:

1) apps/api: proyecto Node + TypeScript (Express o Fastify) con conexión a Postgres
   (DATABASE_URL). Runner de migraciones incremental con tabla de control
   schema_migrations que aplique 001 y NO reintente lo ya aplicado. Comando de seed
   que corra apps/api/seed/dev_seed.sql en desarrollo.
2) Middleware de auth: valida el JWT del realm "nutrismart" de Keycloak (usa
   KEYCLOAK_URL/REALM del .env), extrae tenant_id (clinica) y sub. Para adaptar el
   patrón de auth, puedes LEER el middleware de Keycloak de Vetline en
   c:/ai-vet/vetplatform_1/vetplatform y reescribirlo limpio (no lo copies tal cual).
3) Endpoints GET /api/me y GET /api/pacientes según el contrato de docs/REBANADA-01.md,
   acotando SIEMPRE por clinica_id del token.
4) apps/web-professional: React + TS + Vite + Tailwind usando el preset e importando
   tokens.css del design-system. Login con Keycloak (realm nuestro), y la pantalla
   "Pacientes" (tabla con badges de estado) que consume la API. Estados carga/vacío/error.
5) Deja todo levantando con docker compose -f infra/docker-compose.dev.yml up.

Verifica los criterios de aceptación de docs/REBANADA-01.md. No dependas del código de
Vetline; adáptalo solo como referencia. Trabaja en pasos pequeños y explica cada uno.
```

> Nota: necesitas crear en Keycloak el realm `nutrismart`, un cliente para la API/SPA, el rol y un usuario de prueba con el atributo `tenant_id` = `11111111-1111-1111-1111-111111111111`, y poner su `sub` como `keycloak_user_id` del profesional (ajusta el seed). Puedes pedirle a Claude Code que te guíe en esa configuración del realm.
