# NutriSmart · Rebanada 11 — Mensajería y notificaciones

**Objetivo:** que el profesional converse con sus pacientes y reciba avisos, propios y generados por reglas de la clínica. Materializa **COM-01**, **COM-02** y **COM-03**.

**Depende de:** Rebanada 1 (auth, tenancy), 2 (pacientes) y la visibilidad por profesional de la 4.

---

## Alcance

**Incluye:**
- Migración `013`: `conversacion` y `mensaje`.
- Migración `014`: `notificacion` y `regla_notificacion`.
- Bandeja de dos paneles con sondeo del hilo abierto.
- Campana con contador y panel deslizante.
- Reglas paramétricas de cuatro tipos, con evaluador manual idempotente.

**NO incluye:** el lado del paciente (épica **PAC**; las notificaciones dirigidas a él ya se registran), envío por correo o push (integración con Resend), adjuntos en los mensajes, y ejecución programada de las reglas — hoy se disparan con un botón. Ponerlas en un `cron` es infraestructura, no producto, y conviene hacerlo cuando el evaluador ya haya demostrado que acierta.

---

## Decisiones tomadas

1. **El hilo es privado entre el paciente y su profesional.** Un `admin_clinica` ve todos los pacientes, pero **no** las conversaciones de sus compañeros: leer el hilo de otro profesional con su paciente no es supervisión, es abrir el correo ajeno. Por eso la mensajería filtra por `profesional_id` y no por el alcance de lectura de pacientes.

   El alcance sí manda al **abrir** un hilo: un nutricionista solo empieza conversación con un paciente suyo.

2. **Un hilo por par paciente–profesional**, garantizado por índice único. Sin él, dos peticiones simultáneas de «abrir conversación» crearían dos y los mensajes se repartirían entre ambas.

3. **Sondeo, no WebSockets.** Cinco segundos en el hilo abierto y treinta en la campana. Es suficientemente vivo para una conversación clínica —que no es un chat en tiempo real— y evita montar una infraestructura de conexiones persistentes con su propio despliegue y sus propias caídas. El sondeo pide solo lo posterior al último mensaje conocido, no el hilo entero.

4. **Frecuencias distintas a propósito.** Una notificación no es una conversación en curso: enterarse medio minuto después no cambia nada, y multiplicar por seis las peticiones para eso es carga sin beneficio. Ninguno de los dos sondea con la pestaña oculta.

5. **Contadores desnormalizados.** `mensajes_no_leidos_prof` y `_pac` se actualizan en la **misma transacción** que el mensaje. Recalcularlos con un `count()` por hilo en cada carga de la bandeja escala mal justo cuando la clínica crece; hacerlo fuera de la transacción produciría una bandeja que dice «0 sin leer» con un mensaje sin leer.

6. **El evaluador es idempotente.** Cada notificación de regla lleva `clave_dedup` y un índice único parcial la respalda: evaluar dos veces el mismo día no duplica nada. Sin eso, «Evaluar ahora» sería un botón para llenarse la campana de basura. La garantía es del índice, no de un `select` previo: dos evaluaciones simultáneas se colarían entre la comprobación y la inserción.

7. **El día se calcula en el huso de la clínica.** En UTC, «hoy» empieza a las 18:00 de ayer en Costa Rica y los cumpleaños se avisarían con un día de desfase. Mismo criterio que el dashboard de la Rebanada 8.

8. **Las reglas son de la clínica, no de quien las creó.** Describen cómo trabaja el centro, así que cualquier profesional las ve y las edita, y aparecen en el menú de todos. Lo personal es el buzón.

9. **El tipo de una regla no se edita.** Cambiarlo la convertiría en otra regla arrastrando el historial de la anterior, y las notificaciones ya emitidas quedarían sin explicación.

10. **Desactivar, no borrar.** Una regla inactiva sigue explicando por qué existen los avisos que generó.

11. **`autor_id` y `destinatario_id` son polimórficos** —apuntan a `profesional.id` o a `paciente.id` según el tipo— así que no llevan clave foránea. La alternativa, dos columnas anulables con un `check`, hace más ruido del que evita.

12. **`clinica_id` también en `mensaje`.** Se deduce de la conversación, pero es la regla del proyecto y lo que ya hacen `lab_resultado`, `snapshot_metrica` y `plan_comida`.

---

## Ajustes contra el código real

| Asumido por la especificación | Real |
|---|---|
| `resolverAlcance(request, pacienteId)` | `resolverAlcance(tenantId, sub, roles)` |
| `profesional_id` con consulta propia por `keycloak_user_id` | `alcance.profesionalId`, que ya lo resuelve |
| `fastify.register(import('./routes/…'), { prefix: '/api' })` | `registerXRoutes(app)` con rutas completas |
| `paciente.nombre_completo` y `avatar` | `paciente.nombre`; el avatar son iniciales |
| **403** para una conversación de otra clínica | **404**, como el resto del proyecto |
| `parametros` en `snake_case` (`dias_antes`) | `camelCase` (`diasAntes`), como toda la API |
| `npm run lint` en el paso de verificación | No existe script `lint`; se usan `tsc --noEmit` y el build |

El 404 no es un capricho de consistencia: un 403 sobre un identificador ajeno confirma que ese hilo existe, y con hilos de por medio eso equivale a confirmar que cierto paciente habla con cierto profesional.

Además, el prompt no contemplaba deduplicación en el evaluador ni `clinica_id` en `mensaje`.

---

## Contrato de API

### Mensajería (COM-01)
| Método | Ruta |
|---|---|
| `GET` | `/api/mensajeria/conversaciones` |
| `POST` | `/api/mensajeria/conversaciones` — `{ pacienteId }`, idempotente |
| `GET` | `/api/mensajeria/conversaciones/:id/mensajes?desde=<ISO>` |
| `POST` | `/api/mensajeria/conversaciones/:id/mensajes` — `{ contenido }` (1–4000) |
| `PUT` | `/api/mensajeria/conversaciones/:id/leer` |
| `GET` | `/api/mensajeria/no-leidos` |

Enviar un mensaje crea, en la misma transacción, la notificación `mensaje_nuevo` para el paciente.

### Notificaciones y reglas (COM-02, COM-03)
| Método | Ruta |
|---|---|
| `GET` | `/api/notificaciones?limite=` (máx. 50) |
| `GET` | `/api/notificaciones/contador` |
| `PUT` | `/api/notificaciones/:id/leer` · `/api/notificaciones/leer-todas` |
| `GET` `POST` | `/api/notificaciones/reglas` |
| `PUT` | `/api/notificaciones/reglas/:id` · `/:id/activar` |
| `DELETE` | `/api/notificaciones/reglas/:id` — baja lógica |
| `POST` | `/api/notificaciones/reglas/evaluar` |

Parámetros por tipo: `cumpleanos` → `{hora}`; `reminder` → `{diasAntes 1-30, hora}`; `checkup` → `{intervaloDias 7-365}`; `fecha_importante` → `{fecha, mensaje}`.

---

## Frontend

- **`/mensajeria`**: dos paneles. La lista se refresca cuando el hilo avisa de un cambio, no con su propio temporizador — dos sondeos sobre lo mismo se pisan y muestran contadores que no cuadran.
- **Abrir un hilo ES leerlo**: se marca al abrir, sin botón.
- **El texto no se borra si falla el envío**: reescribirlo sería el castigo por un fallo de red ajeno.
- **Campana en la cabecera**, con panel deslizante desde la derecha, como el diseño.
- **`/notificaciones/reglas`**: tarjetas con una frase en lenguaje llano de lo que hace cada regla, interruptor real (checkbox con teclado y lector de pantalla) y botón de evaluar.

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 11 (CA-11-01 … CA-11-17).
