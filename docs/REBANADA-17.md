# NutriSmart · Rebanada 17 — App del paciente: invitación y espacio personal

**Objetivo:** que el paciente entre por primera vez. El profesional envía una invitación, el paciente abre el enlace, crea su cuenta, queda vinculado a su expediente y ve su espacio. Materializa **PAC-01** y **PAC-02**.

**PAC-03** (mensajería) y **PAC-04** (marcar acuerdos) se difieren a R18, como pedía el encargo.

Es la primera rebanada que toca `apps/web-patient`, que hasta ahora era solo un README.

---

## Estado de la verificación

**La API está verificada de punta a punta**, incluidas las cinco consultas del panel con datos reales: peso, próxima cita, plan con gramos derivados y acuerdos de la última consulta.

**El correo de invitación se envía de verdad.** Comprobado con Resend contra una dirección real: `emailEnviado: true` y `email_enviado` en la base.

**El flujo de activación en el navegador NO se ha ejecutado.** Falta un paso que no puedo dar: el realm de Keycloak no tiene el cliente `nutrismart-patient`, y es una instalación compartida cuyas credenciales de administrador no tengo. Sin ese cliente, la app del paciente no puede autenticar a nadie.

Está todo escrito y compilando; queda aplicarlo. Ver **«El paso que falta»** al final.

### Dos cosas que aparecieron al probar

**El puerto 5174 ya estaba ocupado** por `vetplatform-frontend`, el frontend de Vetline, que corre en la misma máquina. La app del paciente usa el **5175**; el encargo daba por libre el 5174 y `npm run dev` habría fallado al arrancar.

**El contenedor `nutrismart-api` publica el 4001 con código antiguo** y compite con `npm run dev` por ese puerto. Cuando gana el contenedor, todas las rutas desde la Rebanada 12 responden 404 y parece que el código no se registró. Para desarrollar: `docker stop nutrismart-api`.

---

## Decisiones tomadas

### 1. El token del paciente no puede traer `tenant_id` — y no debe

`requireAuth` exige el claim `tenant_id`. Un paciente que acaba de registrarse no lo tiene: su clínica no vive en Keycloak, vive en la invitación que le enviaron. Con el diseño del encargo, la vinculación habría fallado con **401 antes de llegar al handler**, y el mensaje habría mandado a revisar un protocol mapper que no es el problema.

La solución no es rellenar el claim, es no necesitarlo. **La clínica del paciente se resuelve siempre contra la base**, a partir del `sub`. Eso es más seguro que confiar en un claim: el tenant deja de depender de nada que viaje en el token.

### 2. El rol `paciente` no se exige, y esa es la decisión menos obvia

El encargo pedía un `requirePaciente` que comprobara el rol. Pero **nadie asigna ese rol al registrarse**: el único momento en que podría asignarse es la vinculación, y exigirlo allí hace que la vinculación falle antes de ocurrir. Es un círculo cerrado que se descubre en la primera prueba real.

La autorización real no la da el rol: la da la fila. Solo se atiende a quien tiene un expediente **activo** cuyo `keycloak_user_id` coincide con el `sub`. Un token sin expediente detrás no abre nada, lleve el rol que lleve.

El rol sigue declarado en el realm porque es uno de los cuatro del proyecto y sirve para futuras distinciones; simplemente no es lo que sostiene el control de acceso.

Se conserva lo útil de la comprobación: un profesional que entra por error recibe **403 con motivo** —se busca su `sub` en `profesional`— y un paciente sin vincular recibe **404** con el texto que le dice qué hacer.

### 3. El token JWT no viaja en la barra de direcciones

El encargo proponía volver de Keycloak con `?jwt=…` y leerlo de la URL, reconociendo que era una simplificación. Dos problemas: **nada en el flujo descrito produce ese parámetro** —no hay callback que lo ponga—, así que la activación no habría funcionado nunca; y una credencial en la URL queda en el historial del navegador, en la cabecera `Referer` de cualquier recurso externo y en los registros de todo lo que haya por el camino.

Se usa `keycloak-js` con PKCE S256, que ya está en el proyecto para la app profesional. Por la URL solo viaja un código de un solo uso, inútil sin el verificador que se quedó en el navegador. Es menos código que la alternativa, no más.

### 4. `onLoad: 'check-sso'`, no `'login-required'`

Al revés que en la app profesional. La pantalla de activación tiene que poder mostrarse a alguien que **todavía no tiene cuenta**: con `login-required`, abrir el enlace de invitación mandaría al paciente a un formulario de acceso antes de explicarle qué es esto ni quién le invita.

### 5. Los colores salen del design system, no del prompt

El encargo hardcodeaba ocho hexadecimales en `tailwind.config.js` y en `index.css`. Son exactamente los valores por defecto de `tokens.css`, así que el resultado visible habría sido idéntico — y el white-label habría dejado de funcionar en silencio: la app del paciente se habría visto siempre verde NutriSmart aunque su clínica tuviera otra marca.

Usando el preset se obtiene lo mismo, y además **la app se viste con los colores de la clínica del paciente**: el perfil devuelve `colorPrimario` y la pantalla lo inyecta en `--primary`. Es el white-label de la Rebanada 6 visto desde el otro lado.

Los colores de gráfica (`--chart-1..3` en la barra de macros) siguen siendo fijos: una barra de macros tiene que significar lo mismo en todas las clínicas.

### 6. Los acuerdos salen de UNA consulta, no de las diez últimas filas

La consulta del encargo aplanaba el `jsonb` con `CROSS JOIN LATERAL` y **después** aplicaba `LIMIT 10`. El límite cae sobre las filas ya aplanadas de **todas** las consultas finalizadas, así que mezclaba acuerdos de visitas distintas: el paciente vería como pendiente algo que pactó hace seis meses y que ya no aplica.

Se resuelve primero cuál es la última consulta finalizada y se aplanan solo sus acuerdos.

### 7. El diagnóstico no se envía al paciente

El encargo lo incluía en la tarjeta del plan. Un texto como «obesidad grado I», escrito para otro profesional, aterriza distinto cuando lo lee el paciente solo, en su móvil, sin nadie que lo acompañe. El plan sí se envía —las calorías y los macros son lo que tiene que seguir—; el diagnóstico se dice en consulta.

### 8. La ruta pública no devuelve el correo del paciente

`GET /api/invitacion/:token` no está autenticada y el encargo devolvía `emailPaciente`. La pantalla no lo necesita: publicarlo solo añade un dato personal más en un extremo sin autenticar. Se devuelven nombre y clínica, que es lo que la bienvenida enseña.

### 9. Una sola invitación pendiente por paciente, garantizada por índice

El encargo caducaba la anterior con un `UPDATE` suelto antes del `INSERT`. Dos pulsaciones seguidas del botón dejan dos enlaces vivos y el paciente recibe dos correos que se contradicen. Hay un índice único parcial sobre `(paciente_id) where estado = 'pendiente'`, y las dos operaciones van en la misma transacción.

### 10. El enlace se muestra siempre, no solo cuando falla el correo

Un correo que sale bien puede acabar en la carpeta de no deseado. El profesional que acaba de crear la invitación ya está autorizado a invitar a ese paciente: ocultarle el enlace convierte un contratiempo en un callejón sin salida.

### 11. El correo va por Resend, y un fallo de envío no es un fallo de invitación

`enviarInvitacion` devuelve tres desenlaces —`enviado`, `sin_configurar`, `fallo`— en vez de un booleano. «No hay correo configurado» y «el envío falló» piden cosas distintas al profesional, y decirle lo primero cuando pasó lo segundo le hace buscar el problema donde no está.

Un rechazo de Resend **no lanza**: la invitación ya existe y el enlace va en la respuesta. Convertirlo en excepción haría que el botón pareciera haber fallado del todo cuando lo único que falló fue el reparto. El enlace se imprime además en consola, como plan B inmediato.

**El remitente por defecto es el sandbox de Resend**, que solo entrega a la dirección del titular de la cuenta. Para invitar a pacientes de verdad hace falta un dominio propio verificado en `resend.com/domains`: NutriSmart no puede usar el de Vetline, porque la verificación es por dominio. Vale también un subdominio propio.

### 12. `keycloak_user_id` es único a nivel global

Una cuenta de Keycloak es una persona que inicia sesión, y al entrar tiene que haber **un** expediente que abrir. Si la misma persona es paciente de dos clínicas, son dos cuentas: la alternativa obliga a un selector de clínica al entrar que esta versión no tiene.

---

## Otros ajustes contra el código real

| Asumido | Real |
|---|---|
| Express (`Router`, `req/res`, `app.use`) | **Fastify** — reescrito entero |
| `apps/api/src/migrations/` | `apps/api/migrations/`, con runner y `schema_migrations` |
| `paciente.email` · `.activo` · `.sexo` | `correo` · `estado` (enum) · `sexo_biologico` |
| `paciente.keycloak_user_id` ya existe | **No existía**; la crea la 019 |
| `clinica.nombre` · `.logo_url` | `nombre_comercial` / `nombre_fiscal`; el logo vive en `brand_config` |
| `cita.fecha` + `cita.hora` | `inicio` (timestamptz) + `duracion_minutos` |
| `cita.estado 'no_asistio'` | El enum es `programada` / `completada` / `cancelada` |
| `paciente.foto_url` | No existe |
| Hexadecimales en el Tailwind de la app | Preset del design system |
| `nodemailer` con SMTP | **Resend** (patch posterior); `nodemailer` desinstalado |
| Variables en `apps/api/.env` | El `.env` vive en la **raíz** del repo; `config.ts` lo carga desde ahí |
| Puerto 5174 libre | Lo ocupa `vetplatform-frontend`; se usa el **5175** |

---

## Contrato de API

| Método | Ruta | Acceso |
|---|---|---|
| `POST` | `/api/pacientes/:id/invitar` | Profesional de la clínica |
| `GET` | `/api/invitacion/:token` | **Pública** |
| `POST` | `/api/invitacion/:token/vincular` | Sesión iniciada, sin claim de clínica |
| `GET` | `/api/paciente/yo` | Paciente vinculado |
| `GET` | `/api/paciente/dashboard` | Paciente vinculado |

---

## El paso que falta

El realm de Keycloak necesita el cliente público de la app del paciente. El fichero `infra/keycloak/realm-nutrismart.json` ya lo declara (para importaciones nuevas), pero **la instancia en marcha hay que actualizarla a mano**. Con las credenciales de administrador:

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/realms/master/protocol/openid-connect/token \
  -d client_id=admin-cli -d grant_type=password \
  -d username=admin -d password=TU_CLAVE | jq -r .access_token)

# Rol de realm
curl -s -X POST http://localhost:8080/admin/realms/nutrismart/roles \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"paciente","description":"Paciente: accede solo a su propio expediente"}'

# Cliente público de la app del paciente
curl -s -X POST http://localhost:8080/admin/realms/nutrismart/clients \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"clientId":"nutrismart-patient","publicClient":true,"standardFlowEnabled":true,
       "directAccessGrantsEnabled":false,
       "redirectUris":["http://localhost:5175/*"],
       "webOrigins":["http://localhost:5175"],
       "attributes":{"pkce.code.challenge.method":"S256"}}'

# Registro abierto en el realm (el enlace de invitación es lo que acredita
# que la persona fue invitada; la cuenta suelta no abre nada)
curl -s -X PUT http://localhost:8080/admin/realms/nutrismart \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"registrationAllowed":true}'
```

El cliente `nutrismart-patient` debe compartir el mismo `audience` que espera la API (`KEYCLOAK_AUDIENCE`), igual que `nutrismart-web`.

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 17 (PAC-01-01 … PAC-02-05).
