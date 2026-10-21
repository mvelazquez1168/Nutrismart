# R47 — Mejoras app del paciente (7 ítems)

Crea la rama `r47-mejoras-app-paciente` desde `main` y aplica los siguientes cambios.

**Contexto:** Siete mejoras y correcciones en `apps/web-patient`. Leer cada archivo afectado antes de modificarlo. Las rutas exactas pueden variar; usar la ruta real encontrada en el repo.

---

## Paso 0 — Pull de main

```
git checkout main && git pull origin main
git checkout -b r47-mejoras-app-paciente
```

---

## Bloque 1 — Cancelar cita confirmada

### Archivos a leer primero
- El componente que lista citas del paciente (buscar en `apps/web-patient/src` archivos con "cita", "appointment" o "agenda").
- El endpoint de citas en `apps/api/src/routes` (buscar "citas" o "appointments").

### Cambios

**API:** Agregar endpoint `DELETE /api/citas/:id` (o el equivalente REST que use el proyecto, por ejemplo `PATCH /api/citas/:id/cancelar`). Solo el paciente dueño de la cita puede cancelarla. Solo se puede cancelar si el estado es `confirmada`. Actualizar el estado a `cancelada` en la tabla correspondiente.

**Web paciente:** En la pantalla de lista/detalle de citas, mostrar un botón "Cancelar cita" cuando el estado sea `confirmada`. Al hacer clic, mostrar un diálogo de confirmación antes de ejecutar la cancelación. Tras cancelar, actualizar el estado en pantalla sin recargar la página.

---

## Bloque 2 — Meta de peso de prescripción visible en app paciente

### Archivos a leer primero
- El componente de plan/prescripción del paciente en `apps/web-patient/src` (buscar "plan", "prescripcion", "meta").
- El endpoint que devuelve la prescripción o el plan del paciente.
- El componente de prescripción en `apps/web-professional/src` donde el profesional registra la meta de peso (para ver qué campo guarda).

### Cambios

Localizar en qué campo/tabla se guarda la meta de peso registrada por el profesional. Verificar si el endpoint que consume `web-patient` ya devuelve ese campo; si no, agregarlo al response.

En la app del paciente, mostrar la meta de peso en la sección correspondiente del plan o resumen, junto a la etiqueta "Meta de peso" y la unidad (kg).

---

## Bloque 3 — Modelo de preferencias para biblioteca

Este es el cambio más complejo del bloque. Leer con cuidado antes de implementar.

### Archivos a leer primero
- El modelo y tabla de biblioteca (`biblioteca`, `documentos`, o similar) en `apps/api/src`.
- El componente de biblioteca en `apps/web-patient/src`.
- El esquema de base de datos (migrations) para entender la tabla de documentos y si ya existe una tabla de preferencias.

### Cambios

**Migración:** Crear una tabla `paciente_preferencias_biblioteca` (o el nombre que siga la convención del proyecto):
```sql
paciente_id  uuid references pacientes(id)
categoria    text   -- mismo dominio que la columna categoria de documentos
primary key (paciente_id, categoria)
```

**API:**
- `GET /api/pacientes/:id/preferencias-biblioteca` — devuelve las categorías suscritas del paciente.
- `PUT /api/pacientes/:id/preferencias-biblioteca` — reemplaza la lista completa de categorías suscritas.
- Modificar el endpoint que devuelve documentos de biblioteca al paciente para filtrar solo los documentos cuya categoría esté en las preferencias del paciente. Si el paciente no tiene ninguna preferencia guardada, mostrar todos los documentos (comportamiento actual — no romper pacientes existentes).

**Web paciente:** Agregar una pantalla o sección "Mis preferencias" (dentro del perfil o de la sección biblioteca). Mostrar la lista de categorías disponibles (obtenidas del catálogo o de los documentos existentes) con checkboxes. El paciente marca las que le interesan y guarda. En la pantalla de biblioteca, solo se muestran los documentos de las categorías seleccionadas.

---

## Bloque 4 — Archivos de biblioteca: solo visualización

### Archivos a leer primero
- El componente que renderiza cada documento de biblioteca en `apps/web-patient/src`.

### Cambios

En cada ítem/tarjeta de documento de biblioteca, eliminar o deshabilitar los controles de descarga y compartir (botones, atributo `download` en tags `<a>`, o el menú contextual del visor de PDF/imagen).

Si los documentos se abren en un `<iframe>` o visor de PDF nativo, agregar `sandbox` sin `allow-downloads` si aplica, o bien abrir en un componente de visualización propio sin opción de descarga.

Si se usa un tag `<a href="...">`, reemplazarlo por un `<button>` que abra el documento en un modal o en una nueva pestaña con el atributo `rel="noopener"` pero sin `download`.

---

## Bloque 5 — Fix ícono de perfil (spinner infinito)

### Archivos a leer primero
- El componente de perfil en `apps/web-patient/src` (buscar "Perfil", "Profile", "AvatarMenu", o el nombre del ícono en la barra de navegación).

### Cambios

Leer el componente completo. El spinner infinito indica que el componente está en estado de carga permanente, probablemente porque:
- El fetch del perfil falla silenciosamente y `cargando` nunca pasa a `false`, o
- No hay manejo del caso `error` o del caso `finally`.

Asegurarse de que el `useEffect` que carga el perfil tenga un bloque `.finally(() => setCargando(false))` (o equivalente). Agregar un estado de error con mensaje visible si el fetch falla.

Una vez corregido el estado de carga, verificar que el ícono de perfil abra un menú con al menos: nombre del paciente, enlace a editar perfil, y opción de cerrar sesión.

---

## Bloque 6 — Quitar Withings de dispositivos

### Archivos a leer primero
- La pantalla de dispositivos o wearables en `apps/web-patient/src` (buscar "Withings", "dispositivos", "wearables", "devices").

### Cambios

Eliminar por completo la sección, tarjeta, botón o integración de Withings de la pantalla de dispositivos del paciente. Si Withings es la única opción, eliminar la pantalla entera o reemplazarla con un mensaje "Próximamente: conexión con dispositivos".

No eliminar código de backend (API) si existe — solo el componente de UI del paciente.

---

## Bloque 7 — Plan prescrito visible en pantalla de plan

### Archivos a leer primero
- La pantalla "Plan" del paciente en `apps/web-patient/src`.
- El endpoint que devuelve el plan o la prescripción al paciente.
- El componente de prescripción del profesional para entender qué campos componen el "plan prescrito".

### Cambios

Actualmente la pantalla muestra solo "Lo que acordaste". El plan prescrito por el profesional (alimentación, actividad física, metas, u otros campos del modelo de prescripción) debe mostrarse en una sección separada y claramente identificada como "Plan prescrito por tu nutricionista" (o la etiqueta que corresponda a la terminología del proyecto).

Si el endpoint ya devuelve los datos del plan prescrito y el componente simplemente no los renderiza, agregar la sección. Si el endpoint no devuelve el plan prescrito, agregarlo al response primero.

---

## Commit

```
git add -A
git commit -m "feat(r47): mejoras app paciente — cancelar cita, meta peso, preferencias biblioteca, solo-vista docs, fix perfil, quitar Withings, plan prescrito

- Cancelar cita confirmada desde app paciente (botón + diálogo + API)
- Meta de peso de prescripción visible en plan del paciente
- Preferencias de biblioteca por categoría (tabla + API + UI)
- Documentos de biblioteca sin descarga ni compartir
- Fix ícono perfil: manejo de carga y error en fetch de datos
- Eliminar Withings de pantalla de dispositivos
- Plan prescrito por profesional visible en pantalla Plan

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ES8ko4NzY3HXWX6HJ2zwy6"

git push origin r47-mejoras-app-paciente
```
