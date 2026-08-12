# CLAUDE.md — Instrucciones del proyecto NutriSmart

> Este archivo lo lee Claude Code en cada sesión. Mantenlo actualizado.

## Qué es

**NutriSmart** (nombre provisional): plataforma **SaaS inteligente de gestión nutricional** para el profesional (nutricionista) y el paciente. Multi-tenant, white-label, desplegable en AWS, con capacidades de IA. Diferenciadores ancla: **seguimiento continuo (RPM) + gamificación**.

## Reglas de oro (no negociables)

- **Greenfield, independiente de Vetline AI.** NO copies código de Vetline. Puedes LEER `c:/ai-vet/vetplatform_1/vetplatform` para *adaptar* patrones/módulos puntuales (ver `docs/REUTILIZACION_VETLINE.md`), reescribiéndolos limpios para NutriSmart.
- **Multi-tenant:** `tenant_id` en todo el modelo de datos y en cada query. Aislamiento por fila. Un tenant = una clínica.
- **Roles (4):** operador de plataforma → administrador de clínica → nutricionista → paciente.
- **Trazabilidad clínica:** nada se borra físicamente; "eliminar" = archivar/inactivar; los snapshots/estrategias se versionan.
- **La IA asiste, el profesional decide:** toda salida de IA va marcada como sugerencia, con disclaimer y editable. Registra cada llamada de IA (modelo, tokens, costo) para el medidor de consumo.
- **Nunca bloquear el acceso clínico por saldo:** si se agota el crédito de IA, solo se detiene el consumo de IA, no el acceso a expedientes/agenda/informes.
- **White-label por tokens:** usa el design system; nunca hardcodees colores de marca.

## Stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind (+ shadcn/Radix). Dos apps: `apps/web-professional` (denso/clínico) y `apps/web-patient` (PWA, cálido/motivacional).
- **Backend:** Node + TypeScript + Postgres (`apps/api`).
- **Auth:** Keycloak — reutiliza la instalación existente en Docker con el **realm `nutrismart`** (aislado del de Vetline). Resuelve `tenant_id` desde el token.
- **Infra:** Docker local (`infra/docker-compose.dev.yml`) → AWS.
- **Integraciones:** Tilopay (pagos), Claude API (IA), Resend (correo).

## Estructura

```
apps/{api,web-professional,web-patient}   packages/design-system   infra/   docs/
```

## Sistema de diseño

`packages/design-system`: `tokens.css` (fuente de verdad de color/forma) + `tailwind.preset.js`. En cada app: importa `tokens.css` en el CSS global y usa el preset en `tailwind.config.js`. White-label con `<html data-brand="…">` (8 paletas curadas) o inyectando `--primary`. Estados clínicos y colores de gráfica: FIJOS.

## Método de trabajo

- **Rebanadas verticales** (DB → API → UI), no capas horizontales. Siempre deja algo funcionando.
- **Prioridad Fase 1:** cimientos (modelo de datos + roles + auth + design system + migraciones/seed) → walking skeleton (login → dashboard con un paciente) → núcleo CLI (pacientes + expediente/timeline) → registro/onboarding (ADM-06) + suscripción básica → expandir.
- Las **historias de usuario con criterios de aceptación** (en los docs de diseño) son los tickets. Los **diccionarios de datos** definen los campos.
- **Migraciones:** runner incremental con tabla de control `schema_migrations` (no reintentar desde la 001). Seed idempotente.

## Convenciones

- TypeScript estricto. Nombres en inglés en el código; UI en español.
- Commits pequeños y por rebanada. No introduzcas dependencias pesadas sin justificar.
- No expongas datos entre tenants. Verifica `tenant_id` en cada endpoint.

## Cómo levantar (dev)

```
cp .env.example .env      # completar
docker compose -f infra/docker-compose.dev.yml up
```
