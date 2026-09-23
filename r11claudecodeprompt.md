Lee docs/REBANADA-09.md para entender el contexto del proyecto. Esta es la
Rebanada 11: mensajería profesional-paciente y motor de notificaciones (COM-01, COM-02, COM-03).

────────────────────────────────────────────────────────────
ANTES DE ESCRIBIR CUALQUIER CÓDIGO — leer estas referencias
────────────────────────────────────────────────────────────

1. Lee apps/api/src/routes/planes.ts — úsalo como plantilla de ruta: patrón
   requireAuth, resolución de profesional_id por keycloak_user_id, clinica_id
   desde request.auth.tenantId, uso de resolverAlcance.
2. Lee apps/api/src/server.ts — confirma cómo se registran rutas y plugins.
3. Lee apps/api/migrations/ — confirma que la última migración es 012.
   Las tuyas serán 013_mensajeria.sql y 014_notificaciones.sql.
4. Lee apps/web-professional/src/App.tsx (o router.tsx) — entiende cómo se
   definen rutas de React Router. Necesitas agregar /mensajeria.
5. Lee apps/web-professional/src/components/ — identifica el componente de
   layout/AppShell/Header principal para insertar la campanita de notificaciones.
6. Revisa disenos/com/ — archivos de diseño de referencia para BandejaMensajes,
   NotificacionesPanel y ListaReglasNotificacion.

────────────────────────────────────────────────────────────
PASO 1 — MIGRACIÓN 013: MENSAJERÍA (COM-01)
────────────────────────────────────────────────────────────

Archivo: apps/api/migrations/013_mensajeria.sql

```sql
-- migration: 013_mensajeria

CREATE TYPE autor_tipo AS ENUM ('profesional', 'paciente');

CREATE TABLE conversacion (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id                UUID        NOT NULL REFERENCES clinica(id),
  paciente_id               UUID        NOT NULL REFERENCES paciente(id),
  profesional_id            UUID        NOT NULL REFERENCES profesional(id),
  ultimo_mensaje_at         TIMESTAMPTZ,
  mensajes_no_leidos_prof   INT         NOT NULL DEFAULT 0,
  mensajes_no_leidos_pac    INT         NOT NULL DEFAULT 0,
  activa                    BOOLEAN     NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un hilo por par paciente-profesional dentro de la clínica
CREATE UNIQUE INDEX uq_conversacion
  ON conversacion (clinica_id, paciente_id, profesional_id);

CREATE INDEX idx_conv_profesional
  ON conversacion (clinica_id, profesional_id, ultimo_mensaje_at DESC NULLS LAST);

CREATE TABLE mensaje (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id UUID        NOT NULL REFERENCES conversacion(id) ON DELETE CASCADE,
  autor_tipo      autor_tipo  NOT NULL,
  autor_id        UUID        NOT NULL,  -- profesional.id o paciente.id
  contenido       TEXT        NOT NULL CHECK (length(contenido) BETWEEN 1 AND 4000),
  leido           BOOLEAN     NOT NULL DEFAULT false,
  leido_en        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mensaje_conv ON mensaje (conversacion_id, created_at ASC);
```

Ejecuta npm run migrate en apps/api y confirma las tablas.

────────────────────────────────────────────────────────────
PASO 2 — MIGRACIÓN 014: NOTIFICACIONES (COM-02 + COM-03)
────────────────────────────────────────────────────────────

Archivo: apps/api/migrations/014_notificaciones.sql

```sql
-- migration: 014_notificaciones

CREATE TYPE tipo_notificacion AS ENUM (
  'mensaje_nuevo',
  'lab_cargado',
  'cita_proxima',
  'cita_hoy',
  'plan_actualizado',
  'paciente_nuevo',
  'cumpleanos',
  'reminder',
  'checkup',
  'fecha_importante'
);

CREATE TABLE notificacion (
  id                UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id        UUID                NOT NULL REFERENCES clinica(id),
  destinatario_id   UUID                NOT NULL,   -- profesional.id o paciente.id
  destinatario_tipo autor_tipo          NOT NULL,
  tipo              tipo_notificacion   NOT NULL,
  titulo            TEXT                NOT NULL,
  contenido         TEXT,
  enlace            TEXT,              -- ruta relativa a navegar, ej: /pacientes/uuid
  leida             BOOLEAN            NOT NULL DEFAULT false,
  leida_en          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ        NOT NULL DEFAULT now()
);

CREATE INDEX idx_notif_dest
  ON notificacion (clinica_id, destinatario_id, leida, created_at DESC);

CREATE TYPE tipo_regla AS ENUM (
  'cumpleanos',
  'reminder',
  'checkup',
  'fecha_importante'
);

CREATE TABLE regla_notificacion (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id  UUID        NOT NULL REFERENCES clinica(id),
  nombre      TEXT        NOT NULL,
  tipo        tipo_regla  NOT NULL,
  activa      BOOLEAN     NOT NULL DEFAULT true,
  parametros  JSONB       NOT NULL DEFAULT '{}',
  -- 'cumpleanos'      → { "hora": "08:00" }
  -- 'reminder'        → { "dias_antes": 1, "hora": "09:00" }
  -- 'checkup'         → { "intervalo_dias": 30 }
  -- 'fecha_importante'→ { "fecha": "2026-12-25", "mensaje": "Navidad" }
  created_by  UUID        NOT NULL REFERENCES profesional(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_regla_clinica ON regla_notificacion (clinica_id, activa);
```

Ejecuta npm run migrate y confirma las tablas.

────────────────────────────────────────────────────────────
PASO 3 — API ROUTES: MENSAJERÍA (COM-01)
────────────────────────────────────────────────────────────

Crea apps/api/src/routes/mensajeria.ts

Registra en server.ts: `fastify.register(import('./routes/mensajeria'), { prefix: '/api' })`

Endpoints a implementar:

```
GET  /api/mensajeria/conversaciones
     — lista conversaciones del profesional autenticado (clinica_id del JWT)
     — ORDER BY ultimo_mensaje_at DESC NULLS LAST
     — JOIN paciente para devolver nombre_completo, avatar
     — devuelve: id, paciente{id,nombre_completo}, ultimo_mensaje_at,
                 mensajes_no_leidos_prof, ultimo_contenido (subconsulta del último mensaje)

POST /api/mensajeria/conversaciones
     body: { paciente_id: UUID }
     — valida que el paciente pertenece a la clínica (resolverAlcance o SELECT clinica_id)
     — INSERT ... ON CONFLICT (clinica_id, paciente_id, profesional_id) DO NOTHING
     — devuelve la conversacion (existente o nueva)

GET  /api/mensajeria/conversaciones/:convId/mensajes
     query: desde? (ISO timestamp — devuelve solo mensajes más recientes para polling)
     — verifica que conversacion.clinica_id = request.auth.tenantId
     — verifica que conversacion.profesional_id = profesional resuelto
     — ORDER BY created_at ASC, LIMIT 100 (o filtrado por desde si viene)
     — devuelve array de mensaje

POST /api/mensajeria/conversaciones/:convId/mensajes
     body: { contenido: string (1-4000 chars) }
     — inserta mensaje con autor_tipo='profesional', autor_id=profesional.id
     — UPDATE conversacion SET ultimo_mensaje_at=now(), mensajes_no_leidos_pac += 1
     — crear notificacion tipo='mensaje_nuevo' para el paciente (destinatario_tipo='paciente')
     — devuelve el mensaje creado

PUT  /api/mensajeria/conversaciones/:convId/leer
     — UPDATE mensaje SET leido=true, leido_en=now()
       WHERE conversacion_id=$1 AND autor_tipo='paciente' AND leido=false
     — UPDATE conversacion SET mensajes_no_leidos_prof=0
     — devuelve { ok: true }

GET  /api/mensajeria/no-leidos
     — devuelve { total: N } — suma de mensajes_no_leidos_prof de todas
       las conversaciones activas del profesional en la clínica
```

Reglas de seguridad:
- clinica_id SIEMPRE de request.auth.tenantId, NUNCA de query/body
- profesional_id resuelto via: SELECT id FROM profesional WHERE keycloak_user_id = request.auth.sub
- Si esa consulta no devuelve nada → 403 Forbidden
- Todas las consultas filtran por clinica_id

────────────────────────────────────────────────────────────
PASO 4 — API ROUTES: NOTIFICACIONES Y REGLAS (COM-02 + COM-03)
────────────────────────────────────────────────────────────

Crea apps/api/src/routes/notificaciones.ts

Registra en server.ts con prefix '/api'.

Endpoints:

```
GET  /api/notificaciones
     query: limite? (default 20, max 50)
     — destinatario_id = profesional resuelto, destinatario_tipo = 'profesional'
     — ORDER BY created_at DESC
     — devuelve array: id, tipo, titulo, contenido, enlace, leida, created_at

GET  /api/notificaciones/contador
     — devuelve { no_leidas: N }

PUT  /api/notificaciones/:id/leer
     — UPDATE leida=true, leida_en=now()
     — verifica destinatario_id = profesional resuelto
     — devuelve { ok: true }

PUT  /api/notificaciones/leer-todas
     — UPDATE todas las no leídas del profesional en la clínica
     — devuelve { actualizadas: N }

--- Reglas paramétricas (COM-03) ---

GET  /api/notificaciones/reglas
     — filtra clinica_id del JWT, activa IN (true, false), ORDER BY created_at DESC
     — devuelve array de regla_notificacion

POST /api/notificaciones/reglas
     body: { nombre, tipo, parametros }
     — valida tipo en enum ['cumpleanos','reminder','checkup','fecha_importante']
     — valida parametros según tipo:
         cumpleanos:       { hora: HH:MM string }
         reminder:         { dias_antes: 1-30, hora: HH:MM }
         checkup:          { intervalo_dias: 7-365 }
         fecha_importante: { fecha: YYYY-MM-DD, mensaje: string }
     — created_by = profesional resuelto
     — devuelve la regla creada

PUT  /api/notificaciones/reglas/:id
     body: { nombre?, parametros? }
     — verifica clinica_id de la regla = JWT tenantId
     — actualiza campos provistos

PUT  /api/notificaciones/reglas/:id/activar
     body: { activa: boolean }
     — toggle activa/inactiva
     — devuelve { activa: boolean }

DELETE /api/notificaciones/reglas/:id
     — soft delete: UPDATE activa=false (nunca DELETE físico)
     — devuelve { ok: true }

POST /api/notificaciones/reglas/evaluar
     — endpoint manual para disparar evaluación de reglas de la clínica
     — evalúa cada regla activa:
         cumpleanos: SELECT pacientes con birthday = TODAY; crea notificación por cada uno
         reminder:   SELECT citas próximas dentro de regla.parametros.dias_antes días
         checkup:    SELECT pacientes cuya última consulta fue hace más de intervalo_dias
         fecha_importante: si TODAY == regla.parametros.fecha → crea notificación
     — crea filas en notificacion con tipo correspondiente
     — devuelve { generadas: N }
```

────────────────────────────────────────────────────────────
PASO 5 — FRONTEND: MENSAJERÍA (COM-01)
────────────────────────────────────────────────────────────

Revisa el diseño en disenos/com/ antes de implementar.

Crea apps/web-professional/src/pages/BandejaMensajes.tsx
Crea apps/web-professional/src/components/mensajeria/ConversacionItem.tsx
Crea apps/web-professional/src/components/mensajeria/HiloConversacion.tsx
Crea apps/web-professional/src/components/mensajeria/MensajeBurbuja.tsx

**BandejaMensajes.tsx** — layout de dos paneles:

```tsx
// Layout:
// ┌──────────────────────────────────────────────────────────┐
// │ Header: "Messages" + botón "Nuevo mensaje"               │
// ├─────────────────────────┬────────────────────────────────┤
// │ Panel izquierdo (320px) │ Panel derecho (flex)           │
// │ ─────────────────────── │ ──────────────────────────     │
// │ Input búsqueda          │ HiloConversacion activo        │
// │ Lista de ConversacionItem│  o                            │
// │   cada item: avatar,    │  <EmptyState>                  │
// │   nombre, preview msg,  │  "Selecciona una conversación" │
// │   timestamp, badge      │                                │
// └─────────────────────────┴────────────────────────────────┘

// Comportamiento:
// - Al montar: GET /api/mensajeria/conversaciones
// - Al seleccionar conversacion: GET /mensajeria/conversaciones/:id/mensajes
//   + PUT /mensajeria/conversaciones/:id/leer
// - Polling: cada 5 segundos GET mensajes?desde=lastTimestamp para mensajes nuevos
//   (usa useEffect + setInterval, clearInterval al desmontar o cambiar conversación)
// - Badge de no leídos: actualizar en respuesta al polling
// - Botón "Nuevo mensaje": abre un modal con SearchPaciente (reutilizar existente)
//   → llama POST /api/mensajeria/conversaciones, navega al hilo
```

**HiloConversacion.tsx**:

```tsx
// Props: conversacionId, pacienteNombre, onClose?
// - Lista de MensajeBurbuja (scroll al fondo al cargar y en mensajes nuevos)
// - Input de texto (max 4000 chars) + botón Enviar
// - Al enviar: POST /api/mensajeria/conversaciones/:id/mensajes
//   → agrega el mensaje al estado local optimistamente
//   → si falla, muestra error inline y permite reintentar
// - useRef para el contenedor de scroll (scrollTo bottom)
```

**MensajeBurbuja.tsx**:

```tsx
// Props: mensaje: { autor_tipo, contenido, created_at, leido }
// - autor_tipo === 'profesional' → burbuja derecha (bg #0E7C66, texto blanco)
// - autor_tipo === 'paciente'    → burbuja izquierda (bg white, borde #E3EAE8)
// - Timestamp formateado: "HH:mm" si hoy, "dd MMM" si otro día
// - Tilde de leído (✓✓ teal) para mensajes del profesional cuando leido=true
```

**ConversacionItem.tsx**:

```tsx
// Props: conversacion, activa, onClick
// - Avatar con iniciales del paciente (bg teal-100, texto teal-800)
// - Nombre del paciente (bold si hay no-leídos)
// - Preview del último mensaje (1 línea truncada, muted)
// - Timestamp relativo (hace 5m / ayer / dd MMM)
// - Badge rojo con count cuando mensajes_no_leidos_prof > 0
// - Fondo teal-50 + borde izquierdo teal cuando activa=true
```

Agrega la ruta en el router:
```tsx
<Route path="/mensajeria" element={<BandejaMensajes />} />
```

Agrega enlace en el menú de navegación lateral (icono de chat/bubble).

────────────────────────────────────────────────────────────
PASO 6 — FRONTEND: NOTIFICACIONES Y REGLAS (COM-02 + COM-03)
────────────────────────────────────────────────────────────

Revisa el diseño en disenos/com/ para el overlay de notificaciones y la lista de reglas.

Crea apps/web-professional/src/components/notificaciones/NotificacionesCampana.tsx
Crea apps/web-professional/src/components/notificaciones/NotificacionesPanel.tsx
Crea apps/web-professional/src/components/notificaciones/NotificacionItem.tsx
Crea apps/web-professional/src/pages/ReglasNotificacion.tsx
Crea apps/web-professional/src/components/notificaciones/ModalRegla.tsx

**NotificacionesCampana.tsx**:

```tsx
// Icono de campana (BellIcon de Heroicons o similar)
// - Badge rojo con el número de no leídas (GET /api/notificaciones/contador)
//   Polling cada 30 segundos (NO cada 5s — las notificaciones no son urgentes)
// - Al hacer click: toggle del NotificacionesPanel (estado local isOpen)
// - Al abrir el panel: GET /api/notificaciones y marcar "panel visto"
// - Se coloca en el header/nav principal del AppShell
```

**NotificacionesPanel.tsx**:

```tsx
// Overlay/dropdown (posición absoluta bajo la campana, z-50, sombra elevada)
// - Cabecera: "Notifications" + botón "Mark all as read"
// - Lista de NotificacionItem (scroll si más de 5)
// - Empty state: icono de campana vacía, "You're all caught up"
// - Footer: link "See all" → /notificaciones (opcional)
// - Click fuera del panel → cerrar (useEffect con listener)
```

**NotificacionItem.tsx**:

```tsx
// Props: notificacion: { id, tipo, titulo, contenido, enlace, leida, created_at }
// - Icono por tipo:
//     mensaje_nuevo  → ChatBubbleIcon (teal)
//     lab_cargado    → BeakerIcon (blue)
//     cita_proxima   → CalendarIcon (amber)
//     cumpleanos     → CakeIcon (pink)
//     checkup        → HeartIcon (green)
// - Fondo blanco si leída, teal-50 si no leída
// - Al click: PUT /api/notificaciones/:id/leer → si tiene enlace, navega
// - Timestamp relativo
```

**ReglasNotificacion.tsx** (página en /configuracion/notificaciones o similar):

```tsx
// Lista de reglas de la clínica con columnas: Nombre | Tipo | Activa | Acciones
// - Toggle activo/inactivo con switch (PUT /reglas/:id/activar)
// - Botón "Edit" → abre ModalRegla con datos pre-rellenados
// - Botón "Delete" → confirm → PUT /reglas/:id/activar { activa: false }
//   (soft delete, desaparece de la lista si activa=false y hay filtro activas)
// - Botón "Nueva regla" → abre ModalRegla vacío
// - Botón "Evaluar reglas ahora" → POST /api/notificaciones/reglas/evaluar
//   muestra toast con resultado "X notifications generated"
```

**ModalRegla.tsx**:

```tsx
// Props: regla? (si viene → edición, si no → creación), onGuardar, onCerrar
// - Campo nombre (text)
// - Selector de tipo (radio cards): Cumpleaños | Reminder | Check-up | Fecha importante
// - Sub-formulario dinámico según tipo:
//     cumpleanos:       hora (time input)
//     reminder:         dias_antes (1-30) + hora (time input)
//     checkup:          intervalo_dias (7-365 días)
//     fecha_importante: fecha (date input) + mensaje (text)
// - Botón Guardar → POST o PUT según si hay regla.id
// - Validación inline antes de enviar
```

Agrega enlace a ReglasNotificacion desde el menú de configuración.

────────────────────────────────────────────────────────────
PASO 7 — INTEGRACIÓN EN APPSHELL Y LAYOUT
────────────────────────────────────────────────────────────

1. Abre el componente de layout principal (AppShell / Header / Navbar).
2. Agrega <NotificacionesCampana /> junto a los otros iconos de la barra de navegación
   (ej. junto al avatar del usuario, en el header derecho).
3. Confirma que /mensajeria aparece en el menú de navegación lateral con icono de chat.
4. Confirma que /configuracion/notificaciones (o la ruta equivalente) enlaza a ReglasNotificacion.

────────────────────────────────────────────────────────────
PASO 8 — PRUEBAS.md — SECCIÓN R11
────────────────────────────────────────────────────────────

Agrega al final de docs/PRUEBAS.md:

```markdown
## R11 — Mensajería y notificaciones (COM-01, COM-02, COM-03)

### COM-01 · Mensajería

- [ ] CA-11-01 El profesional ve la bandeja de mensajes vacía si no hay conversaciones.
- [ ] CA-11-02 Al hacer click en "Nuevo mensaje" + seleccionar un paciente, se crea la conversación
               y aparece en la bandeja.
- [ ] CA-11-03 El profesional puede enviar un mensaje (≤ 4000 chars). Aparece como burbuja derecha teal.
- [ ] CA-11-04 Abrir la conversación marca los mensajes del paciente como leídos
               (contador mensajes_no_leidos_prof se resetea a 0).
- [ ] CA-11-05 El polling detecta un nuevo mensaje del paciente en ≤ 10 segundos
               (simular insertando directamente en DB).
- [ ] CA-11-06 Intentar acceder a una conversación de otra clínica devuelve 403.
- [ ] CA-11-07 Un mensaje con contenido vacío o > 4000 chars devuelve 400.

### COM-02 · Notificaciones

- [ ] CA-11-08 Enviar un mensaje genera automáticamente una notificación 'mensaje_nuevo'
               para el paciente destinatario.
- [ ] CA-11-09 La campana muestra el badge con el número correcto de no leídas.
- [ ] CA-11-10 Al hacer click en una notificación leída → navega a enlace, queda marcada.
- [ ] CA-11-11 "Mark all as read" resetea el contador de campana a 0.
- [ ] CA-11-12 El contador de campana se actualiza sin recargar (polling 30s).

### COM-03 · Reglas paramétricas

- [ ] CA-11-13 El admin puede crear una regla de tipo 'cumpleanos' con hora.
- [ ] CA-11-14 El admin puede crear una regla de tipo 'checkup' con intervalo de 30 días.
- [ ] CA-11-15 Toggle activa/inactiva funciona sin recargar la página.
- [ ] CA-11-16 POST /api/notificaciones/reglas/evaluar genera notificaciones para los
               pacientes que cumplen la condición (insertar paciente con cumpleaños hoy en DB).
- [ ] CA-11-17 Parámetros inválidos en POST /reglas devuelven 400 con mensaje descriptivo.
```

────────────────────────────────────────────────────────────
PASO 9 — COMMIT
────────────────────────────────────────────────────────────

Ejecuta los linters y el build antes de commitear:
  npm run lint --prefix apps/api
  npm run lint --prefix apps/web-professional
  npm run build --prefix apps/api

Si el build pasa:

  git add apps/api/migrations/013_mensajeria.sql
  git add apps/api/migrations/014_notificaciones.sql
  git add apps/api/src/routes/mensajeria.ts
  git add apps/api/src/routes/notificaciones.ts
  git add apps/web-professional/src/pages/BandejaMensajes.tsx
  git add apps/web-professional/src/pages/ReglasNotificacion.tsx
  git add apps/web-professional/src/components/mensajeria/
  git add apps/web-professional/src/components/notificaciones/
  git add docs/PRUEBAS.md

  git commit -m "R11: mensajería profesional-paciente y motor de notificaciones (COM-01, COM-02, COM-03)"

Reporta el hash del commit al finalizar.
