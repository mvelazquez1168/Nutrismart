# NutriSmart *(nombre provisional)*

Plataforma **SaaS inteligente de gestión nutricional** — para el profesional y el paciente. Multi-tenant, white-label, en la nube (AWS), con capacidades de IA. Ancla del producto: **seguimiento continuo (RPM) + gamificación**.

Ubicación del proyecto: `c:\nutrismart` · Corre en **local con Docker**.

---

## Enfoque

**Greenfield e independiente de Vetline AI.** Reutilizamos *aprendizajes y patrones* ya probados en producción —no el código—: pasarela **Tilopay**, **medidor de consumo de Claude API**, **multi-tenancy**, **roles**, y el camino de **despliegue en AWS**. El código de Vetline (referencia para adaptar módulos puntuales) está en `c:/ai-vet/vetplatform_1/vetplatform`.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind (+ shadcn/Radix) — dos apps: `web-professional` y `web-patient` (PWA) |
| Backend | Node + TypeScript + Postgres |
| Autenticación | **Keycloak** — reutiliza la instalación existente en Docker con un **realm nuevo `nutrismart`** (aislado del realm de Vetline) |
| Infra | Docker (local) → AWS (staging / prod) |
| Integraciones | Tilopay (pagos), Claude API (IA), Resend (correo) |

## Estructura (monorepo)

```
nutrismart/
├─ apps/
│  ├─ api/                # Backend Node + TS
│  ├─ web-professional/   # App del nutricionista (React + Vite)
│  └─ web-patient/        # App del paciente (PWA)
├─ packages/
│  └─ design-system/      # tokens.css + tailwind.preset.js (fuente de verdad visual)
├─ infra/                 # docker-compose.dev.yml, IaC AWS
├─ docs/                  # decisiones y reutilización
├─ .env.example
└─ README.md
```

## Sistema de diseño

`packages/design-system` es la fuente de verdad visual: **`tokens.css`** (color, tipografía, radios, sombras) y **`tailwind.preset.js`** (mapea los tokens a clases Tailwind). El **white-label** se activa con `<html data-brand="…">` (8 paletas curadas) o inyectando `--primary` desde la config de la clínica. Los **estados clínicos** y los **colores de gráfica** son fijos, no se re-tematizan.

## Multi-tenancy y roles

`tenant_id` en todo el modelo de datos. Cuatro roles: **operador de plataforma → administrador de clínica → nutricionista → paciente**. Cada tenant es una clínica con uno o más nutricionistas.

## Arranque (walking skeleton → rebanadas verticales)

1. **Cimientos**: modelo de datos con `tenant_id`, roles/permisos, auth (realm `nutrismart` en Keycloak), design system en código, runner de migraciones + seed.
2. **Rebanada end-to-end mínima** desplegada: login → dashboard que muestra un paciente.
3. **Rebanadas verticales por prioridad** (Fase 1, ruta crítica): núcleo CLI (pacientes + expediente/timeline) → registro/onboarding (ADM-06) + suscripción básica → expandir.

## Levantar en desarrollo

```bash
cp .env.example .env          # completa las variables
# asegúrate de que el Keycloak existente corre y crea el realm "nutrismart"
docker compose -f infra/docker-compose.dev.yml up
```

- API en `http://localhost:4000` · Web profesional `http://localhost:5173` · Web paciente `http://localhost:5174` · Postgres en `5433` (para no chocar con el de Vetline).

## Documentación

- `docs/DECISIONES.md` — bitácora de decisiones de arranque.
- `docs/REUTILIZACION_VETLINE.md` — qué módulos de Vetline adaptar y de dónde.
- Specs de producto (épicas, historias, diccionarios, sistema de diseño) — en los entregables de diseño del proyecto.
