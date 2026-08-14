# NutriSmart · Rebanada 20 — Agenda: lo que faltaba

**Objetivo declarado del encargo:** construir el módulo de agenda completo (AGE-01, AGE-02).

**Objetivo real de esta rebanada:** completar el módulo que la **Rebanada 4 ya construyó**. Lo primero que hay que decir de R20 es que buena parte de lo que pedía ya existía.

---

## Lo que ya estaba, y por qué no se ha rehecho

La Rebanada 4 (CLI-03) entregó la tabla `cita`, cinco componentes de interfaz y estas rutas:

| Ruta | Estado |
|---|---|
| `GET /api/citas?desde=&hasta=&estado=&profesionalId=&pacienteId=` | Ya existía |
| `POST /api/citas` — **con validación de solapamiento** | Ya existía |
| `GET /api/citas/:id` | Ya existía |
| `PUT /api/citas/:id` — reprogramar | Ya existía |
| `POST /api/citas/:id/estado` | Ya existía |
| `POST /api/citas/:id/control` | Ya existía |
| `GET /api/profesionales` | Ya existía |

El encargo pedía escribir de cero un `citas.routes.ts` con `POST /api/citas`, validación de solapes incluida. Rehacerlo habría dado dos implementaciones del mismo endpoint, o una que pisa a la otra y se lleva por delante el registro de controles clínicos que cuelga de `/:id/control`.

**Se ha extendido lo que había.** Los ajustes concretos:

| El encargo pedía | Qué se hizo |
|---|---|
| `CREATE TABLE cita` | `ALTER TABLE` — la tabla existe desde la migración 006 |
| `CREATE TYPE estado_cita` | El tipo real se llama `cita_estado`; se le añaden valores |
| `CREATE TYPE tipo_cita` | Ídem `cita_tipo` |
| Estado `realizada` | El real es `completada`; renombrarlo obligaba a reescribir filas y código de cuatro rebanadas |
| Tipo `inicial` | El real es `primera_vez` |
| `GET /api/citas?semana=YYYY-WW` | Se reutiliza `?desde=&hasta=`, que ya existía |
| `PATCH /api/citas/:id` | `PUT` ya hace eso |
| `DELETE /api/citas/:id` | `POST /:id/estado` con `cancelada` ya lo hace |
| Nuevo `apps/api/src/agenda/citas.routes.ts` | Se amplía `routes/agenda.ts` |

---

## Lo que sí faltaba, y es lo que trae esta rebanada

### 1. La rejilla semanal

R4 la dejó fuera **a propósito** y lo dejó escrito: la lista agrupada por día resuelve «qué tengo hoy». La rejilla responde otra pregunta —«dónde me cabe una cita de 45 minutos esta semana»— y para eso hay que ver los huecos, no las citas.

Se añade como cambio de vista dentro de la misma pantalla. La lista sigue siendo la vista por defecto porque es la del día a día.

Se apoya en el `?desde=&hasta=` que ya existía. **No se añade `?semana=YYYY-WW`:** sería una segunda forma de decir lo mismo, y el cálculo de semana ISO del encargo está mal —`new Date(anio, 0, 1 + (ww-1)*7)` no da el lunes de la semana ISO— con un desfase de hasta tres días según el año.

El lunes se calcula en hora **local**, no en UTC: el profesional piensa en «esta semana» en su huso, y hacerlo en UTC desplaza la rejilla un día cada domingo por la noche.

### 2. Dos estados que faltaban

`no_asistio` **no es un matiz de `cancelada`**. Cancelar es un aviso: el hueco se pudo reasignar. No presentarse es un hueco perdido. Una clínica necesita contarlos por separado para decidir si confirma por adelantado o cobra la reserva; meterlos en el mismo estado borra justo la diferencia que se quiere medir.

`confirmada` es el paso intermedio: el paciente dijo que viene.

La máquina de estados de R4 se amplía respetando su criterio —no se reabre lo cerrado—:

```
programada → confirmada | completada | cancelada | no_asistio
confirmada → completada | cancelada | no_asistio
completada, cancelada, no_asistio → (final)
```

Una cita **confirmada también se puede reprogramar**: el paciente avisó de que viene, no de que la hora sea inamovible.

### 3. Historial de citas por paciente

`GET /api/citas/paciente/:pacienteId`, con el mismo criterio de visibilidad que el resto del expediente.

Devuelve **todas**, canceladas incluidas: en el historial de un paciente una cancelación es información —dice que se agendó y no ocurrió— y ocultarla deja huecos inexplicables en la secuencia.

### 4. La agenda del paciente

`GET /api/paciente/citas` y la pantalla `/citas` en la app del paciente: cuenta atrás hasta la próxima, las siguientes, y el historial.

Las **próximas** solo incluyen `programada` y `confirmada`: una cancelada futura no es una cita, es un hueco. Las **pasadas** sí incluyen canceladas y ausencias, porque al paciente le sirve ver que aquel día no fue.

Al paciente no se le dice «no asistió» con reproche: se le dice «no se realizó», que es lo mismo sin el juicio.

### 5. Campos nuevos

`motivo` (se escribe antes de la cita y el paciente puede verlo) y `notas_clinicas` (se escriben después y son del expediente). El campo `notas` que ya existía es la nota operativa de la agenda —«viene con su madre», «traer analítica»— y se queda como está.

`consulta_origen_id`, para cuando un seguimiento se agenda desde la valoración anterior.

**No se añaden banderas de recordatorio enviado**, que el encargo pedía. Nada en esta rebanada las escribiría, y una columna que nadie actualiza se convierte en un dato en el que alguien acabará confiando. Cuando exista el proceso que envía recordatorios, tendrá su tabla con fecha de envío.

---

## Otros ajustes contra el código real

| Asumido | Real |
|---|---|
| `apps/api/src/migrations/` | `apps/api/migrations/`, con runner |
| `db` de `../db` · `fastify.authenticate` | `pool` de `../db.js` · `requireAuth` / `requireAuthPaciente` |
| `paciente.estado != 'archivado'` | El enum es `activo` / `inactivo` / `baja` |
| Notificación con huso `America/Mexico_City` | La clínica piloto es de Costa Rica; la agenda entrega instantes UTC y el huso lo pone el navegador |
| Colores `bg-blue-400` y similares | Tokens del design system |

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 20.
