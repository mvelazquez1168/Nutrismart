# R48 — Fixes app del profesional (4 ítems)

Crea la rama `r48-fixes-app-profesional` desde `main` y aplica los siguientes cambios.

**Contexto:** Cuatro bugs en `apps/web-professional` y `apps/api`. Leer cada archivo afectado completo antes de modificarlo.

---

## Paso 0 — Pull de main

```
git checkout main && git pull origin main
git checkout -b r48-fixes-app-profesional
```

---

## Bloque 1 — Loop de mensajes en chat de mensajería

**Síntoma:** El profesional envía un mensaje una vez y el mismo texto aparece repetido múltiples veces en su vista del chat. El paciente lo recibe correctamente una sola vez.

### Archivos a leer primero
- El componente de chat/mensajería en `apps/web-professional/src` (buscar "chat", "mensajes", "mensajeria", "Message").
- El hook o función que envía mensajes y actualiza el estado local.
- El mecanismo de tiempo real (WebSocket, polling, SSE) que trae mensajes nuevos.

### Diagnóstico probable

El loop ocurre porque el mensaje se agrega al estado local optimistamente al enviarse Y también llega por el canal de tiempo real, duplicándolo. O bien el `useEffect` de suscripción se monta más de una vez (dependencias incorrectas o falta de cleanup).

### Cambios

**Opción A — Deduplicar por ID:** Al recibir mensajes por el canal de tiempo real, verificar que el `id` del mensaje no exista ya en el array de estado antes de agregarlo.

```typescript
setMensajes(prev =>
  prev.some(m => m.id === nuevoMensaje.id) ? prev : [...prev, nuevoMensaje]
)
```

**Opción B — No agregar optimistamente:** Eliminar la actualización optimista del estado al enviar; confiar en que el canal de tiempo real entregará el mensaje de vuelta al emisor.

Elegir la opción que mejor encaje con la arquitectura actual. Si el canal de tiempo real no refleja los propios mensajes del emisor, aplicar la opción A y no la B.

Verificar también que el `useEffect` de suscripción tenga un cleanup correcto (`return () => unsubscribe()` o equivalente) para no acumular listeners en cada render.

---

## Bloque 2 — Monitoreo no muestra presión arterial ni glucosa

**Síntoma:** Cuando el paciente registra su presión arterial o glucosa en la app del paciente, esos valores no aparecen en la pantalla de Monitoreo del profesional.

### Archivos a leer primero
- La pantalla de Monitoreo en `apps/web-professional/src` (buscar "monitoreo", "monitor", "seguimiento").
- El componente o tabla donde se esperaría ver presión y glucosa.
- El endpoint que alimenta esa pantalla (buscar en `apps/api/src/routes`).
- La tabla o modelo donde el paciente guarda presión/glucosa (buscar "presion", "glucosa", "signosVitales", "registros").

### Cambios

1. Verificar que el endpoint de monitoreo consulta las tablas de presión arterial y glucosa del paciente. Si no lo hace, agregar los JOINs o subconsultas necesarios.
2. Verificar que el response incluye esos campos en el objeto devuelto.
3. En el componente de Monitoreo, verificar que esos campos están siendo renderizados. Si el componente los espera pero el endpoint no los devuelve (o viceversa), alinear ambos lados.
4. Si los registros de presión y glucosa viven en tablas separadas del resto de las métricas, incluir ambas en el response del endpoint bajo claves consistentes (por ejemplo `presionArterial` y `glucosa`).

---

## Bloque 3 — Monitoreo no muestra detalle de comidas

**Síntoma:** En la pantalla de Monitoreo del profesional no es posible ver el detalle de las comidas que el paciente registró en su app.

### Archivos a leer primero
- La pantalla de Monitoreo en `apps/web-professional/src`.
- El componente de registro de comidas en `apps/web-patient/src` (para entender qué campos guarda).
- El endpoint de monitoreo o de registros dietéticos del paciente en `apps/api/src/routes`.

### Cambios

1. Si el endpoint de monitoreo ya devuelve los registros de comidas pero el componente no los muestra, agregar la sección de detalle de comidas en el JSX de Monitoreo.
2. Si el endpoint no devuelve los registros de comidas, agregar la consulta a la tabla correspondiente (buscar "registro_comida", "comidas", "food_log" o el nombre real) e incluirlos en el response.
3. El detalle de comidas debe mostrar al menos: fecha/hora, tiempo de comida (desayuno, almuerzo, etc.) y descripción o lista de alimentos. Si hay macros calculados, mostrarlos también.
4. Si la pantalla de Monitoreo tiene pestañas o secciones, agregar "Comidas" como una sección adicional si no existe. Si ya existe pero está vacía, es un problema de datos (punto 2).

---

## Bloque 4 — "Que comí" del paciente no aparece en app del profesional

**Síntoma:** Lo que el paciente registra en la sección "Que comí" de su app no se refleja en ninguna parte de la app del profesional.

**Nota:** Este bloque está relacionado con el Bloque 3 pero puede ser un flujo distinto. Leer primero para entender si son el mismo dato o dos flujos separados.

### Archivos a leer primero
- El componente "Que comí" en `apps/web-patient/src` (buscar "comi", "comí", "queComí", "food", "registro").
- El endpoint que ese componente llama para guardar el registro.
- Cualquier pantalla en `apps/web-professional/src` relacionada con alimentación del paciente fuera de Monitoreo.

### Cambios

1. Identificar la tabla donde se guarda el registro de "Que comí".
2. Si existe un endpoint `GET` para que el profesional lea esos registros de un paciente, verificar que el componente del profesional lo llama correctamente.
3. Si no existe el endpoint `GET` para el profesional, crearlo: `GET /api/pacientes/:id/registros-comida` (o el nombre que siga la convención). Devolver los registros ordenados por fecha DESC, con paginación básica si hay muchos.
4. En la app del profesional, mostrar los registros de "Que comí" del paciente en la pantalla más apropiada (Monitoreo, Expediente, o una sección dedicada). Si ya existe un lugar destinado a esto pero no carga datos, conectarlo al endpoint correcto.

Si los Bloques 3 y 4 resultan ser el mismo flujo de datos, implementar una sola solución y documentarlo en el commit.

---

## Commit

```
git add -A
git commit -m "fix(r48): loop mensajería, presión/glucosa en monitoreo, detalle comidas visible para profesional

- Chat: deduplicar mensajes por ID para evitar loop al recibir eco por tiempo real
- Monitoreo: endpoint y UI incluyen presión arterial y glucosa del paciente
- Monitoreo: detalle de comidas del paciente visible para el profesional
- 'Que comí': endpoint GET y UI en app profesional para ver registros del paciente

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ES8ko4NzY3HXWX6HJ2zwy6"

git push origin r48-fixes-app-profesional
```
