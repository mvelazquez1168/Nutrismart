# NutriSmart · Rebanada 4 — Agenda y visibilidad por profesional

**Objetivo:** dar al nutricionista su agenda y el ciclo de vida de cada cita (**CLI-03**), y saldar de paso la deuda de **CLI-02**: que cada profesional vea únicamente a sus pacientes. Las dos cosas van juntas porque la agenda es la primera pantalla donde conviven varios profesionales y la ambigüedad se volvería visible.

**Depende de:** Rebanada 1 (auth, tenancy), Rebanada 2 (pacientes) y Rebanada 3 (snapshots).

---

## Alcance

**Incluye:**
- Migración `006`: enums `cita_tipo` y `cita_estado`, tabla `cita` con detección de solapes en la base.
- **Visibilidad por profesional**: el rol `nutricionista` ve solo sus pacientes; `admin_clinica` ve toda la clínica.
- Segundo profesional en el seed y **segundo usuario en el realm de Keycloak**, sin el cual la regla no se puede probar.
- API de agenda: listar con filtros, crear, ver, editar, cambiar estado y generar el control clínico de una cita completada.
- Frontend: sección **Agenda** activada, lista con filtros, modal de nueva cita, detalle con cambio de estado y botón "Registrar control".

**NO incluye:** recordatorios y notificaciones (COM-02 / COM-03; la agenda solo los disparará), laboratorios (CLI-04), vista de calendario mensual —la v1 es lista con filtros, como marca el epic—, y citas recurrentes.

**Principio clave:** el solape lo impide **la base de datos**, no una comprobación previa en la API. Entre el `SELECT` que busca choques y el `INSERT` cabe otra cita.

---

## Decisiones tomadas

1. **`nutricionista` ve solo sus pacientes; `admin_clinica`, toda la clínica.** Es la lectura literal de CLI-02, más restrictiva que la de la Rebanada 1.
2. **El solape bloquea con 409 y se calcula por profesional.** Un nutricionista no puede estar en dos sitios; dos nutricionistas sí atienden a la vez.
3. **La duración es un campo obligatorio por cita.** Sin ella no hay intervalo que comparar. El formulario propone 60 minutos por defecto; el esquema **no** lleva ese valor: un default en la base disimularía el dato faltante en cualquier inserción que lo omita.
4. **Completar una cita no crea el control automáticamente.** Ofrece un botón "Registrar control". Un borrador vacío colgando chocaría con el índice de un solo borrador por paciente y bloquearía el siguiente control real.
5. **`cita_tipo` es un enum fijo** (`primera_vez`, `seguimiento`, `control`). Catálogo cuando haya presión real de negocio, no antes.
6. **Los recordatorios quedan fuera.** Pertenecen a COM.

---

## El cambio de visibilidad afecta a ocho endpoints

No es un filtro suelto en el listado. Todo lo que recibe un paciente por parámetro tiene que comprobar la propiedad:

| Endpoint | Efecto |
|---|---|
| `GET /api/pacientes` | Filtra por `nutricionista_id` |
| `GET /api/pacientes/:id` | 404 si no es suyo |
| `PUT /api/pacientes/:id` | 404 |
| `POST /api/pacientes/:id/baja` | 404 |
| `GET /api/pacientes/:id/expediente` | 404 |
| `GET /api/pacientes/:id/snapshots` | 404 |
| `POST /api/pacientes/:id/snapshots` | 404 |
| `GET·PUT /api/snapshots/:id` y `/cerrar`, `/corregir` | Resuelven su paciente y aplican la misma regla |

Para que la regla no se olvide en el noveno endpoint, se centraliza: el repositorio recibe `restringirA: string | null` —el `profesional.id` del solicitante, o `null` si es administrador— y lo aplica en el `WHERE`. Igual que `tenantId`, es un parámetro obligatorio en la firma, no un filtro opcional.

**Pacientes sin nutricionista asignado:** quedan visibles solo para el administrador. Hoy no existe ninguno —el alta asigna siempre a quien crea— pero conviene saberlo antes de que una importación masiva los produzca.

---

## Prerrequisito: segundo usuario en Keycloak

La regla no se puede verificar con el usuario actual: **Ana Rodríguez es `admin_clinica`**, así que con el cambio vería todo igualmente. Hace falta un usuario con rol `nutricionista`.

- Usuario nuevo en el realm `nutrismart`, con el atributo `tenant_id` de la Clínica Nutrición Vida y el rol de realm `nutricionista`.
- Su `sub` va al seed como `keycloak_user_id` de un segundo `profesional` (Dr. Luis Peralta, el que aparece en los mockups).
- Reexportar `infra/keycloak/realm-nutrismart.json`. Recordar que `partial-export` **no incluye usuarios**: hay que dejar documentado cómo recrearlo.
- El seed reparte los pacientes entre ambos profesionales, para que haya algo que la regla pueda ocultar.

---

## Modelo de datos

### `cita`
`clinica_id`, `paciente_id`, `profesional_id`, `inicio` (timestamptz), `duracion_minutos` (int), `fin` (columna generada), `tipo`, `estado`, `notas`, `snapshot_id` (nullable), `created_at`, `updated_at`.

- **`fin` es una columna generada** a partir de `inicio` y la duración. Almacenar un fin editable permitiría que contradijera a sus dos orígenes.
- **Sin solapes, por restricción de exclusión** sobre `(profesional_id, tstzrange(inicio, fin))`, excluyendo las canceladas. Es el equivalente al índice único parcial de los borradores: la regla vive donde nadie puede saltársela.
- **`snapshot_id`** enlaza la cita con el control clínico que generó. Nullable: no toda cita produce uno.
- `estado`: `programada` | `completada` | `cancelada`. Cancelar es un cambio de estado, nunca un borrado.
- **Una sola nota editable**, no dos campos. El epic habla de "notas previas" al crear y de editarlas en el detalle; son el mismo texto en dos momentos.

---

## Contrato de API

Todas requieren `Bearer` y se acotan por `clinica_id` **y** por la visibilidad del solicitante.

### `GET /api/citas?desde=&hasta=&estado=&pacienteId=`
Rango de fechas y estado opcionales; por defecto, los próximos 7 días. Un `nutricionista` recibe solo sus citas.
```json
[
  { "id": "…", "inicio": "2026-08-20T15:00:00-06:00", "duracionMinutos": 60,
    "fin": "2026-08-20T16:00:00-06:00",
    "tipo": "seguimiento", "estado": "programada",
    "paciente": { "id": "…", "nombre": "Juan Ramírez" },
    "profesional": "Dra. Ana Rodríguez",
    "notas": "Traer laboratorios",
    "snapshotId": null }
]
```

### `POST /api/citas` → 201
```json
{ "pacienteId": "…", "inicio": "2026-08-20T15:00:00-06:00",
  "duracionMinutos": 60, "tipo": "seguimiento", "notas": "Traer laboratorios" }
```
Validaciones: el paciente debe existir, ser visible para quien crea y no estar en `baja`; `duracionMinutos` entre 5 y 480; `tipo` dentro del enum.

**409 `cita_solapada`** si el profesional ya tiene otra cita en ese intervalo, indicando con cuál choca. El profesional es quien crea; reasignar citas es de una rebanada posterior.

### `GET /api/citas/:id` · `PUT /api/citas/:id`
`PUT` cambia inicio, duración, tipo y notas. **409** ante solape.

**Solo se edita una cita `programada`**: **409 `cita_no_editable`** para completadas y canceladas, con `estadoActual` para distinguirlas. Una completada registra lo que ocurrió y una cancelada, lo que no ocurrió; moverles la hora después reescribiría los hechos. Es la misma regla que hace inmutable un snapshot cerrado.

### `POST /api/citas/:id/estado`
```json
{ "estado": "completada" }
```
Transiciones permitidas: `programada → completada`, `programada → cancelada`. **409** para cualquier otra: reabrir una cita cerrada falsearía el registro. Idempotente si el estado ya es el pedido.

### `POST /api/citas/:id/control` → 201
Crea un snapshot en borrador para el paciente de la cita, con la fecha de la cita, y lo enlaza en `snapshot_id`.

- **409 `cita_no_completada`** si la cita no está completada.
- **409 `borrador_abierto`** si el paciente ya tiene uno; el mensaje señala cuál.
- **409 `control_ya_registrado`** si la cita ya tiene `snapshot_id`.

---

## Frontend (app profesional)

- **Sección Agenda activada** en la barra lateral, la segunda del menú que deja de estar apagada.
- **Lista de citas** en tarjetas compactas, agrupadas por día, con filtros de rango de fechas y estado. Estados de carga, vacío y error.
- **Modal "Nueva cita"**: paciente (buscador entre los visibles), fecha y hora, duración con 60 minutos propuestos, tipo y notas. El 409 de solape se muestra junto al campo de hora, indicando con qué cita choca.
- **Detalle de cita**: cambio de estado con confirmación al cancelar, edición de notas y, si está completada, botón **"Registrar control"** que abre el modal de punto de control ya conocido.
- En la **ficha del paciente**, las citas siguen siendo una pestaña apagada: mostrarlas ahí es trabajo de otra rebanada.

---

## Criterios de aceptación

**Visibilidad**
- Un `nutricionista` ve en la lista **solo sus pacientes**; el `admin_clinica`, todos los de la clínica.
- Un `nutricionista` que pide por id un paciente de otro colega recibe **404** en los ocho endpoints, no un 403.
- Un paciente sin nutricionista asignado solo aparece para el administrador.

**Agenda**
- Crear una cita válida → **201** y aparece en la lista del día.
- Crear otra que se solape con la misma → **409 `cita_solapada`** indicando el choque.
- Misma franja para **otro profesional** → permitido.
- Solaparse con una cita **cancelada** → permitido.
- `programada → completada` y `programada → cancelada` funcionan; `completada → programada` da **409**.
- Editar una **completada** o una **cancelada** → **409 `cita_no_editable`**; editar una programada funciona.
- "Registrar control" sobre una completada → **201**, snapshot en borrador enlazado y visible en el timeline.
- Repetir "Registrar control" → **409 `control_ya_registrado`**.
- Cita de otra clínica en cualquier verbo → **404**.

**Regresión**
- Las 30 pruebas de `docs/PRUEBAS.md` siguen pasando, con la salvedad de que las de listado deben reinterpretarse: Ana es administradora y sigue viendo los tres pacientes.

---

## Prompt para Claude Code (pégalo en `c:\nutrismart`)

```
Lee CLAUDE.md, docs/REBANADA-04.md, docs/PRUEBAS.md, la épica
docs/epicas/Epica_CLI_Gestion_Clinica.html (CLI-03 y CLI-02) y el código de
las rebanadas 1 a 3. Implementa la Rebanada 4 en pasos verificables:

1) Segundo usuario en el realm de Keycloak con rol nutricionista y su
   tenant_id; segundo profesional en el seed con ese sub; reparto de
   pacientes entre ambos. Reexporta el realm y documenta que partial-export
   no incluye usuarios.
2) Visibilidad por profesional en los OCHO endpoints afectados, con el
   alcance centralizado en el repositorio como parámetro obligatorio.
3) Migración 006: enums de cita, tabla cita con 'fin' generado y restricción
   de exclusión que impide solapes por profesional, salvo canceladas.
4) API de agenda según el contrato, incluido POST /api/citas/:id/control.
5) Frontend: sección Agenda, lista con filtros, modal de nueva cita y
   detalle con cambio de estado y "Registrar control".
6) Verifica los criterios de aceptación contra la API real y añade cada
   prueba a docs/PRUEBAS.md en el mismo commit.
```
