# NutriSmart · Rebanada 28 — Configuración de la clínica y gestión del equipo

**Objetivo:** que el administrador de una clínica pueda mantener sus datos y su equipo sin tocar la base. Materializa **GAM-01** y **GAM-02**.

**Migraciones 033 y 034.**

---

## Casi la mitad del encargo ya existía

El Paso 0 pedía comprobar el esquema antes de tocar nada. Lo que salió cambia bastante lo que había que construir.

### El white-label ya está hecho, desde la Rebanada 6

El encargo añadía a `clinica` las columnas `logo_url`, `color_primario` y `color_secundario`. Eso existe desde la R6 en `brand_config`, con **pantalla propia** en `/ajustes/marca`, subida de logo como archivo y comprobación de contraste WCAG antes de aceptar un color.

Añadirlo aquí habría dejado **dos sitios donde vive el color de una clínica**, con nombres distintos para lo mismo (`color_secundario` frente a `color_acento`) y dos mecanismos de logo incompatibles: uno por URL y otro por archivo subido. Ninguna pantalla sabría cuál gana.

Es el mismo error que la R24 evitó con los totales del diario y la R26 con las medidas corporales. La pantalla nueva **enlaza** a la de marca en vez de duplicarla.

### El rol de profesional ya existía, con otros valores

El encargo creaba el enum `profesional_rol` con `('admin', 'nutricionista')`, envuelto en un `DO … EXCEPTION WHEN duplicate_object THEN NULL`.

El enum ya existe, con valores **`admin_clinica`** y `nutricionista`. Ese `EXCEPTION` habría pasado de largo **en silencio**, dejando el enum como estaba, y después todo el código que compara `rol = 'admin'` no habría coincidido nunca. Ningún error, ningún administrador, y nada que buscar en un log.

Lo mismo con `email` (existe como `correo`) y con `activo` (existe como `estado`). Y `estado` no es un booleano por una razón: `invitacion_pendiente` es un tercer estado real —dado de alta en la clínica, sin cuenta todavía— que un booleano no puede representar. El bootstrap del encargo consultaba `WHERE activo = true` y habría fallado.

---

## La decisión de fondo: de dónde sale la autoridad para ser administrador

De **las dos partes a la vez**: el rol `admin_clinica` en el token de Keycloak **y** `profesional.rol = 'admin_clinica'` en la base.

No es redundancia. En este proyecto quien concede el acceso es Keycloak: el token es lo que la API verifica y lo único que el navegador no puede falsear. Si bastara la columna, cambiar un `rol` **desde esta misma pantalla** otorgaría permisos que Keycloak no ha dado — una escalada de privilegios con formulario propio.

Exigiendo las dos, la columna **puede quitar pero nunca dar**:

| Acción | Efecto |
|---|---|
| Degradar a alguien aquí | Inmediato |
| Ascender a alguien aquí | Necesita además el rol en Keycloak |

Comprobado: degradando a Ana solo en la base, su token sigue trayendo el rol y aun así recibe **403**.

La pantalla lo dice, para que nadie ascienda a un compañero y se pregunte por qué no entra.

---

## Otras decisiones

### Dar de alta no crea la cuenta, y la ficha lo refleja

El alta nace en `invitacion_pendiente`, no en `activo`. La cuenta la crea el administrador de Keycloak; el profesional queda vinculado en su primer acceso, cuando se escribe su `keycloak_user_id`. Decir «activo» antes de eso sería afirmar que puede entrar, y no puede. El correo de bienvenida tampoco promete una contraseña que no existe.

### Dar de baja a quien tiene pacientes exige decir a quién pasan

Esto no estaba en el encargo y es lo que más se nota en una clínica real. `paciente.nutricionista_id` apuntaría a un profesional inactivo: esos pacientes **dejan de aparecer** en la agenda y en el monitoreo de todo el mundo menos del administrador, sin que nadie se entere.

La API responde **409 `tiene_pacientes`** con la cuenta, y la pantalla convierte ese error en una pregunta —«tiene 2 pacientes a su cargo, ¿a quién pasan?»— en vez de en un mensaje rojo. La reasignación y la baja van juntas.

### El último administrador no se puede quitar

Una clínica sin administrador activo no puede volver a tenerlo desde la aplicación: nadie podría entrar a esta pantalla a arreglarlo. Se bloquea tanto degradarlo como darlo de baja, incluso a uno mismo.

### La zona horaria se guarda, y la pantalla dice hasta dónde llega

Se valida contra `pg_timezone_names` —la lista real del servidor, no una copia que se quede vieja— porque un valor inventado haría reventar cualquier `at time zone` que lo use.

Pero las consultas del proyecto todavía escriben `'America/Costa_Rica'` a mano: cambiarlas todas es una rebanada en sí misma. La pantalla lo dice en vez de prometer que cambiarla mueve las agendas. Y el valor por defecto es Costa Rica, no `America/Mexico_City` como decía el encargo.

### Tres entradas de menú, no una

Los datos de la clínica, el equipo y la identidad visual son cosas distintas y se buscan por separado. La entrada «Configuración» pasa a llamarse «Marca», que es lo que hace.

### Nombre fiscal, país y subdominio se ven pero no se editan

Los fija el operador de la plataforma al dar de alta la clínica; cambiarlos afecta a facturación y a la URL. Se muestran para que el administrador sepa qué consta, con quién hablar si está mal.

---

## Otros ajustes contra el código real

| Asumido | Real |
|---|---|
| `schema_migrations.migration_name` | `version` |
| `profesional.especialidad` | No existe; se usa `colegiatura` |
| `profesional.updated_at` | No existía; se añade |
| `cita.fecha` | `inicio` (timestamptz) |
| `requireAdmin` como middleware suelto | `comoAdmin(request, reply)`, que además distingue los dos motivos de rechazo |
| `fetch` directo a la API de Resend con remitente fijo | El cliente `Resend` del proyecto y `config.resend.from` |
| `CHECK (zona_horaria IN (SELECT …))` | Postgres no admite subconsultas en un CHECK; se valida en la API |

---

## Contrato de API

| Método | Ruta |
|---|---|
| `GET` | `/api/profesional/yo` — cualquier profesional |
| `GET` `PATCH` | `/api/admin/clinica` |
| `GET` | `/api/admin/zonas-horarias` |
| `GET` `POST` | `/api/admin/profesionales` |
| `PATCH` | `/api/admin/profesionales/:id` — rol, estado, nombre, `reasignarA` |

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 28.
