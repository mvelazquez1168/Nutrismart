# NutriSmart · Rebanada 21 — Recordatorios, vista mensual y confirmación

**Objetivo:** que las citas se recuerden solas, que el mes se vea de un vistazo, que el paciente pueda confirmar y que la consulta se abra desde la cita. Materializa **AGE-03** y **AGE-04**.

**Migración 022.**

---

## Lo que apareció por el camino: un fallo de fechas en toda la API

Al probar el primer recordatorio, una fecha construida con `to_char(... 'OF')` fue rechazada como inválida. Al mirarlo de cerca:

```js
new Date('2026-08-15T14:22:02+00')      // Invalid Date
new Date('2026-08-15T14:22:02+00:00')   // ok
new Date('2026-08-15T14:22:02Z')        // ok
```

**El sufijo `+00` no es ISO 8601 válido para `Date`.** Y `to_char(x, 'YYYY-MM-DD"T"HH24:MI:SSOF')` produce exactamente eso cuando el instante cae en UTC — que es siempre, porque la base corre en UTC.

Ese formato estaba en **21 sitios de siete ficheros**, en todo lo escrito desde la Rebanada 12: interpretaciones de IA, notas SOAP, invitaciones, mensajes, plan del paciente, citas. Las pantallas que los pintan llaman a `new Date(...)`, así que habrían mostrado **«Invalid Date»**: la caducidad de la invitación, la hora de cada mensaje, la fecha de la próxima cita.

La agenda de la Rebanada 4 no lo tenía porque devuelve el `timestamptz` crudo y el driver lo serializa como `...000Z`, que sí es válido. Solo el código posterior introdujo el `to_char`.

Corregido en los 21 sitios a `to_char(x at time zone 'UTC', '…"Z"')`. Comprobado que ahora parsean invitación, mensaje, nota SOAP y cita.

**No se había detectado antes porque ninguna de esas pantallas se ha podido abrir en un navegador**: siguen esperando el cliente de Keycloak. Es justo el tipo de fallo que una API que responde 200 no delata.

---

## Decisiones tomadas

### 1. Los recordatorios tienen tabla, no banderas

En la Rebanada 20 no añadí `recordatorio_24h` / `recordatorio_1h` porque nadie los escribía, y dejé anotado que cuando existiera el proceso «tendrá su tabla con fecha de envío». Es lo que se hace.

Una bandera responde «se envió» y nada más. La pregunta que se hace de verdad en una clínica es otra: **«a este paciente que no vino, ¿se le avisó?»** — y para contestarla hace falta saber cuándo se intentó y si salió bien. El propio encargo pedía marcar la bandera aunque Resend fallara, «para no acumular reintentos»; con eso, un aviso que nunca llegó queda registrado como enviado y esa pregunta se queda sin respuesta.

`recordatorio_cita` guarda antelación, instante del intento, destinatario, éxito y error.

### 2. Se reserva antes de enviar, no se marca después

El encargo enviaba y marcaba a continuación. Con dos instancias de la API, las dos leen la misma cita pendiente y el paciente recibe el aviso por duplicado.

Aquí la fila se inserta **antes** de llamar a Resend, con `on conflict do nothing`: quien consigue insertarla es quien envía, y el índice único `(cita_id, antelacion)` deja fuera a cualquier otro. El resultado real se anota encima.

Verificado: el segundo ciclo sobre la misma cita devuelve `0` y la tabla sigue con una sola fila.

### 3. Ventanas holgadas a propósito

El proceso corre cada 15 minutos. Una ventana de exactamente 24 h se saltaría casi todas las citas: solo entrarían las que caen justo en el instante del ciclo. Con 23–25 h y 55–65 min cada cita pasa por varios ciclos, y la reserva impide el duplicado.

### 4. La hora del correo se fija al huso de la clínica

El encargo formateaba con `es-MX` y sin huso, lo que da la hora del **servidor**: distinta según dónde corra el contenedor. Una hora equivocada en un recordatorio es peor que no mandarlo. Se fija `America/Costa_Rica`, que es donde está la clínica piloto.

### 5. El disparador manual solo existe en desarrollo

Para probar sin esperar 15 minutos hay `POST /api/agenda/recordatorios/ejecutar`, registrado **solo si `config.isDev`**. Una ruta que lanza correos a pacientes no debe existir en un servidor accesible, por muy autenticada que esté.

### 6. La vista mensual muestra densidad, no horas

Tres citas por día y un contador. Meter ocho en una celda de 90 px no se lee; quien necesita el detalle pulsa el día y salta a esa semana.

Las citas se agrupan por su día **local**, no por los diez primeros caracteres del ISO: ese texto está en UTC y en América mete las citas de la tarde en el día siguiente. El encargo hacía `cita.inicio.slice(0, 10)`.

### 7. Iniciar consulta cierra la cita en el mismo gesto

El botón aparece cuando ya toca —cita confirmada, o programada y con la hora encima— no para una cita de dentro de tres semanas, que invita a abrir consultas que nadie va a atender.

Crea la valoración y marca la cita completada a la vez: el profesional está delante del paciente, y obligarle a volver a la agenda a marcarla después es el paso que nadie da. Si el cambio de estado falla, la consulta ya existe y se avisa: no atender por eso sería absurdo.

**No se usa `?cita_id=` en la URL** como proponía el encargo: no hay ruta `/consultas/nueva` en este proyecto. La consulta se crea con el endpoint que ya existe desde la Rebanada 13 y se navega a `/pacientes/:id/valoracion/:consultaId`.

### 8. Confirmar es idempotente y explica cuando no se puede

Volver a confirmar una cita ya confirmada devuelve **200** con el mismo estado, no un error: el paciente que pulsa dos veces no ha hecho nada malo. Una cita cancelada o pasada devuelve **409 con el motivo** — el paciente la está viendo en pantalla y merece saber por qué el botón no hizo nada.

Las cuatro condiciones van en el `WHERE` del `UPDATE`, no en comprobaciones previas: entre el `SELECT` y el `UPDATE` la cita puede cancelarse.

---

## Otros ajustes contra el código real

| Asumido | Real |
|---|---|
| `paciente.nombre_completo` | **`nombre`** — la columna no existe |
| Estado `realizada` | `completada`; comparar con una etiqueta inexistente hace **fallar la consulta entera** |
| `cita.recordatorio_24h` / `_1h` ya existen | No existían; se sustituyen por `recordatorio_cita` |
| `GET /api/citas` acepta `?semana=` y hay que añadir `?desde=&hasta=` | Al revés: acepta `desde`/`hasta` desde la R4 y nunca aceptó `semana` |
| `src/features/agenda/`, `AgendaPage.tsx`, `ModalCita.tsx` | `src/components/`, `pages/Agenda.tsx`, `CitaDetalle.tsx` |
| `AgendaSemanal` con `semanaActual` como `YYYY-WNN` | `VistaSemana` con rango de fechas; el ayudante `toISOWeek` no hace falta |
| `bg-blue-500`, `bg-gray-400`, `bg-red-300` | Tokens del design system |

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 21.
