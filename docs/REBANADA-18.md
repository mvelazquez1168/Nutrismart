# NutriSmart · Rebanada 18 — Mensajería y seguimiento desde la app del paciente

**Objetivo:** que el paciente pueda escribir a su nutricionista y llevar el registro de sus acuerdos. Materializa **PAC-03** y **PAC-04**, que se difirieron en la Rebanada 17.

**Migración 020.** Reutiliza `conversacion` y `mensaje` de la Rebanada 13 sin tocarlas.

---

## Estado de la verificación

**La API está verificada de punta a punta**: conversación, envío, lectura, sondeo incremental, notificación al profesional, plan, marcar y desmarcar acuerdos, y los cuatro caminos de error.

**El flujo en el navegador sigue sin ejecutarse**, por el mismo motivo que en la Rebanada 17: falta el cliente `nutrismart-patient` en el Keycloak compartido. Las cuatro rutas de la app responden 200 y compilan; nadie ha podido autenticarse todavía.

---

## Decisiones tomadas

### 1. El acuerdo se identifica por posición **y por texto**

Es la decisión de fondo. El encargo guardaba solo `acuerdo_index`, argumentando que la posición es «más estable que el texto, que puede editarse». Es al revés en el caso que importa: si el profesional **borra un acuerdo o reordena la lista**, el índice pasa a señalar otro acuerdo distinto, y el «cumplido» que el paciente puso sobre *«caminar 30 minutos»* aparece sobre *«tomar el suplemento»*.

Nadie se entera. No hay error, no hay aviso: solo un dato clínico mal atribuido en la pantalla del paciente y en la del profesional que lo revise.

Se guarda también `acuerdo_texto`, el texto tal como estaba cuando el paciente lo marcó. Al leer se comprueba que sigue diciendo lo mismo; si cambió, el registro no se aplica y el acuerdo vuelve a aparecer sin marcar — que es la lectura honesta: sobre un acuerdo nuevo el paciente todavía no ha dicho nada.

Comprobado: se marca el acuerdo 0, el profesional lo sustituye por otro texto, y el «cumplido» **no se arrastra**.

### 2. Lo que dice el paciente no toca lo que pactó el profesional

`conclusion_valoracion.acuerdos` es lo que se acordó en consulta y lo firma el profesional. Lo que el paciente cuenta desde casa va en `cumplimiento_acuerdo`, con su fecha. La API devuelve los dos por separado —`cumplidoProfesional` y `cumplidoPaciente`— y la pantalla los distingue: cuando el profesional ya dio algo por hecho, se dice explícitamente debajo del acuerdo.

Mezclarlos borraría la diferencia entre «acordamos esto» y «dice que lo está haciendo», que es justo lo que el profesional necesita leer.

### 3. Los últimos 50 mensajes, no los primeros

El encargo pedía `ORDER BY created_at ASC LIMIT 50`. En un hilo de doscientos mensajes eso devuelve los **cincuenta más antiguos**: el paciente abre la conversación y no ve nada de lo que acaban de escribirle. Se toman los últimos 50 en una subconsulta y se ordenan ascendente para pintarlos.

### 4. `created_at` viaja con microsegundos

El cliente reenvía ese valor como `?desde` en cada sondeo. Truncado al segundo, el último mensaje vuelve a salir cada cinco segundos: la pantalla no lo duplica porque se deduplica por identificador, pero el tráfico y el trabajo son reales y el fallo es del tipo que aparece solo bajo carga.

### 5. `mensaje.clinica_id` es NOT NULL

El `INSERT` del encargo lo omitía. Habría fallado en la primera prueba, no en producción — pero conviene decir por qué está ahí: es la columna que acota el mensaje a su clínica sin depender del `join`.

### 6. La conversación se abre con UPSERT sobre el índice real

El encargo hacía `on conflict do nothing` sin objetivo y después releía. Con dos pestañas abiertas, la relectura puede caer entre el insert de una y el commit de la otra y devolver vacío. Existe `uq_conversacion (clinica_id, paciente_id, profesional_id)`: se usa como objetivo del conflicto y el problema desaparece.

### 7. La notificación al profesional se queda como está en la Rebanada 13

Una notificación por mensaje, sin `clave_dedup`. En un intercambio rápido eso llena la bandeja del profesional, y la tabla tiene un índice de deduplicación pensado justo para esto — pero la Rebanada 13 notifica igual en el sentido contrario. Cambiar solo este lado dejaría las dos direcciones comportándose distinto sin que nadie lo hubiera decidido. Queda anotado como arista para una rebanada de mensajería, no de PAC.

### 8. Marcar un acuerdo se pinta antes de que responda el servidor

En un móvil con mala cobertura, esperar la respuesta para mover la casilla hace que parezca que la pulsación no funcionó y el paciente vuelve a tocar. Se pinta al pulsar y se revierte con un mensaje si el servidor rechaza.

### 9. Los colores salen del design system

El encargo usaba `bg-white`, `border-line`, `bg-blue-400`, `bg-amber-400`, `bg-orange-400`, `bg-red-50`. Se usan `bg-surface`, `border-border` y `--chart-1..3` para los macros: los colores de gráfica son fijos a propósito, para que una barra de macros signifique lo mismo en todas las clínicas aunque cambie la marca.

---

## Otros ajustes contra el código real

| Asumido | Real |
|---|---|
| `apps/api/src/migrations/` | `apps/api/migrations/`, con runner y `schema_migrations` |
| `db` de `../db` | `pool` de `../db.js` |
| `fastify.authenticate` · `request.user.sub` | `requireAuthPaciente` · `request.authPac.sub` |
| Registro con `prefix: '/api'` | `registerXRoutes(app)` con la ruta completa |
| Página `Dashboard.tsx` en `/dashboard` | `Inicio.tsx` en `/inicio` |
| Hook `useAuth` con el token por parámetro | `lib/keycloak.ts`; el cliente resuelve el token solo |
| Puerto 5174 | **5175** — el 5174 lo ocupa `vetplatform-frontend` |
| Solo `acuerdo_index` | `acuerdo_index` **+** `acuerdo_texto` |

---

## Contrato de API

| Método | Ruta |
|---|---|
| `GET` | `/api/paciente/conversacion` — la abre si no existe; **404** si no hay invitación aceptada |
| `GET` | `/api/paciente/conversacion/mensajes?desde=` — marca leído lo del profesional |
| `POST` | `/api/paciente/conversacion/mensajes` |
| `GET` | `/api/paciente/plan` — `{ plan: null, mensaje }` si aún no hay |
| `POST` | `/api/paciente/acuerdos/:consultaId/:index/cumplir` |

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 18 (PAC-03-01 … PAC-04-06).
