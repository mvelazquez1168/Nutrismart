# NutriSmart · Reutilización desde Vetline AI

**Criterio:** NutriSmart es greenfield. No se copia el código de Vetline (arrastraría dominio veterinario y deuda técnica). Se **adaptan patrones y módulos autocontenidos** como referencia, reescribiéndolos limpios para NutriSmart.

Código de referencia de Vetline: `c:/ai-vet/vetplatform_1/vetplatform`

## Módulos/patrones a adaptar (alto valor)

| Área | Qué reutilizar (adaptado) | Referencia en Vetline |
|---|---|---|
| **Pagos (Tilopay)** | Interfaz única de proveedor de pagos, callback idempotente, credenciales por país, ciclo de cobro con reintentos | `backend/src/proveedorPagos.ts`, `callbackCobros.ts`, `credencialesPasarela.ts`, `cicloCobro.ts`, `tilopay.ts` |
| **Medidor de consumo de IA** | Cálculo de costo desde tarifas, descuento de saldo, verificación con colchón de gracia, registro único de consumo | `backend/src/tarifas.ts`, `jobs/ciclo.job.ts`, tabla `uso_api` |
| **Migraciones** | Runner con tabla de control `schema_migrations`, rechazo de meta-comandos psql, backfill | ejecutor de migraciones + seed idempotente |
| **Auth / Keycloak** | Integración con Keycloak, resolución de `tenant_id` desde el token, concesión directa de credenciales | middleware de auth, config de realm |
| **Multi-tenancy** | Aislamiento por `tenant_id`, seguridad de fila, auditoría de tablas nuevas sin RLS | modelo de datos y middleware |
| **Registro autoservicio** | Alta de clínica con reversión de cuenta si falla (evitar huérfanos), persona física/jurídica, países permitidos | flujo de registro + Platform Admin |
| **Correo (Resend)** | Envío unificado, plantillas en un solo archivo, enlaces desde `FRONTEND_URL` | módulo de notificaciones/correos |
| **Despliegue AWS** | Dockerfiles de producción, ejecutor de migraciones robusto, certificados AWS para `verify-full`, primer admin de plataforma | infra de producción |

## Lecciones de Vetline a aplicar desde el día uno

- **Versionar la configuración del realm de Keycloak** (en Vetline no se versionó y se rehacía a mano).
- **Ejecutor de migraciones incremental** con tabla de control (no reintentar desde la 001).
- **Nunca almacenar CVV**; tokenización para cobros recurrentes (modelo facilitador de Tilopay).
- **Crear las filas de permisos del profesional al registrar** (en Vetline faltaba y el usuario entraba a una pantalla vacía).
- **Reversión de cuenta en registro** si falla la escritura (evita correos huérfanos bloqueados).
- **Nunca bloquear el acceso clínico por saldo**; solo detener el consumo de IA.
- **No exponer tablas de administración solo por SQL**: darles endpoints desde el inicio.
