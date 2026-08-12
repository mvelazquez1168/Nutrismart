# NutriSmart · Bitácora de decisiones de arranque

Decisiones tomadas al iniciar el desarrollo (agosto 2026).

1. **Greenfield, independiente de Vetline AI.** No se depende del código de Vetline; se reutilizan *patrones y aprendizajes* probados.
2. **Nombre provisional:** NutriSmart. Reside en `c:\nutrismart`.
3. **Corre en local con Docker** (como Vetline).
4. **Autenticación:** se reutiliza la instalación de **Keycloak** existente en Docker mediante un **realm nuevo `nutrismart`**, aislado del realm de Vetline. Postgres es una base propia.
5. **Multi-tenant** (`tenant_id`), **SaaS**, desplegable en **AWS**.
6. **Stack:** React 18 + TS + Vite + Tailwind (front, dos apps) · Node + TS + Postgres (back).
7. **Sistema de diseño en código** desde el inicio (`packages/design-system`), white-label por tokens + paletas curadas.
8. **Método:** cimientos → walking skeleton → rebanadas verticales por prioridad (Fase 1 primero: núcleo CLI, luego registro + suscripción).
9. **Los diseños de Figma ya están generados** y guían la implementación del front.

## Decisiones abiertas (por cerrar)

- **Tasación / modelo de ingresos:** por nº de nutricionistas + consumo de IA, y si entra "pago por paciente activo". Afecta el diseño de SUB.
- **Condición clínica inicial** a priorizar (diabetes / obesidad sugeridas).
- **Mercados/países** de la Fase 1 (marco regulatorio y de privacidad de datos de salud).
- **Realm de Keycloak:** exportar/versionar su configuración desde el inicio (lección de Vetline: no quedó versionada).
