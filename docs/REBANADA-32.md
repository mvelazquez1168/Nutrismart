# NutriSmart · Rebanada 32 — Pulseras y relojes

**Objetivo:** que los datos lleguen solos. Materializa la parte de dispositivos de **RPM-01**.

**Migraciones 036 y 037.**

---

## Lo que hay que saber antes de leer nada más

**El intercambio OAuth no está probado contra los servidores reales.** Hace falta una aplicación registrada en el portal de Fitbit y otra en Google Cloud, y este proyecto todavía no las tiene.

Lo que **sí** está probado, y es la mayor parte: que sin credenciales la API arranca igual y cada ruta responde 503 diciendo exactamente qué falta; que el `state` no se puede falsificar ni reutilizar; que el cifrado va y viene y detecta una alteración; que sincronizar dos veces el mismo día no duplica nada; y que una lectura de dispositivo y una escrita a mano conviven sin pisarse.

---

## Dos correcciones de seguridad

### El `state` de OAuth era falsificable

El encargo lo resolvía así:

```js
const state = Buffer.from(pacienteId).toString('base64url')
```

Base64 no es cifrado: es otra forma de escribir lo mismo. Cualquiera puede leerlo y —lo que importa— **fabricarlo**.

El `state` existe justo para impedir eso. La vuelta del proveedor llega como una navegación del navegador, sin cabecera `Authorization`: lo único que dice de quién es esa vuelta es el `state`. Si se puede adivinar, alguien construye la URL de callback con el identificador de otro paciente y su propio código de Fitbit, y deja **su** cuenta de salud enganchada al expediente de esa persona. El nutricionista pasaría a ver los pasos y el pulso de un desconocido creyendo que son de su paciente.

Ahora son 32 bytes aleatorios en `wearable_oauth_estado`, de un solo uso y con diez minutos de vida. Comprobado: uno inventado se rechaza, y uno válido usado dos veces solo funciona la primera.

### Faltar una clave tumbaba la API entera

El módulo de cifrado del encargo comprobaba la clave **al cargarse**:

```js
if (KEY.length !== 32) throw new Error(...)
```

Importarlo desde cualquier ruta habría impedido arrancar la API cuando la integración no está configurada — y con ella el acceso a expedientes, agenda e informes. La regla de oro del proyecto dice lo contrario: lo accesorio nunca bloquea lo clínico.

Ahora falla **al usarse**, como la IA y el correo. El *formato* de la clave sí se valida al arrancar: una clave mal copiada es peor que ninguna, porque cifraría y descifraría mal solo a veces.

---

## Otras decisiones

### La deduplicación depende de dónde se ancle la hora

`medido_en` se fija al **mediodía del día medido**, no al instante de la sincronización. Es lo que hace que repetir el proceso no duplique: el índice único incluye `medido_en`, y si cambiara en cada pasada, cada sincronización crearía filas nuevas.

Mediodía y no medianoche porque son valores de un día entero: a las 00:00 se irían al día anterior en cualquier gráfica que agrupe por fecha local.

Y la clave incluye `fuente`: si el paciente apunta un dato a mano y además lo manda su pulsera, son dos observaciones distintas y las dos valen. Es la misma línea que la R22 trazó entre el peso de casa y el de consulta.

### Se piden siete días, no solo hoy

Los dispositivos sincronizan cuando pueden. Un día que llegó tarde al servidor del proveedor se habría perdido para siempre. Al ser idempotente, repetirlos no cuesta nada.

### Se guarda el pulso en REPOSO, no la media del día

La media sube al subir una escalera y no dice nada. La de reposo sí es una señal clínica.

### Lo que llega fuera de rango se descarta

Un dispositivo devuelve ceros por un día que no se llevó puesto, o cifras absurdas por un fallo de sincronización. Guardarlas hundiría cualquier media y le diría al profesional que su paciente durmió 47 horas.

### Se pide el permiso mínimo

`activity heartrate sleep` en Fitbit; actividad y pulso en Google. Pedir «perfil» o «peso» por si algún día hace falta es pedir acceso a datos que no se van a usar.

### Desconectar borra la conexión, pero no los datos

La fila contiene un token que da acceso al historial de salud del paciente: si dice que desconecta, lo que espera es que deje de existir. Las lecturas ya sincronizadas se conservan — son suyas, y su nutricionista puede haberlas comentado en consulta.

### Un fallo del proveedor se cuenta

Se guarda en `ultimo_error` y la pantalla lo enseña. Si no, el paciente ve «conectado» y ningún dato, y no sabe si el problema es suyo.

### La autorización va en navegación completa, nunca en un iframe

Tiene que verse la dirección del proveedor en la barra. Un formulario de contraseña dentro de nuestra página tiene exactamente la forma de un engaño.

---

## Un fallo mío que salió al probar

La dirección de vuelta que se construía (`/api/paciente/wearable/callback/fitbit`, del encargo) no coincidía con la ruta registrada (`/api/paciente/wearables/:proveedor/callback`). Habría fallado **al final del flujo**, cuando el usuario ya autorizó. Corregido, y anotado en el código que ese valor tiene que coincidir en tres sitios: la ruta, esta función y el portal del proveedor.

---

## Otros ajustes contra el código real

| Asumido | Real |
|---|---|
| `tipo_metrica` admite las métricas nuevas | Es un enum de cuatro valores; hay que ampliarlo |
| `sueño_horas` con eñe | `sueno_horas`, como el resto de valores del proyecto |
| `creado_en` / `actualizado_en` + `set_actualizado_en()` | `created_at` / `updated_at` y `set_updated_at()`, que ya existe |
| `conexion_wearable` sin `clinica_id` | Todas las tablas lo llevan; es la regla de aislamiento |
| `process.env` leído en cada módulo | Todo pasa por `config.ts`, que valida al arrancar |
| Restricción única sin filtro | Índice único **parcial** (`where activo`): archivar y resincronizar funciona |

---

## Contrato de API

| Método | Ruta |
|---|---|
| `GET` | `/api/paciente/wearables` |
| `POST` | `/api/paciente/wearables/:proveedor/conectar` |
| `GET` | `/api/paciente/wearables/:proveedor/callback` — **sin auth**, se identifica por `state` |
| `POST` | `/api/paciente/wearables/:proveedor/sincronizar` |
| `DELETE` | `/api/paciente/wearables/:proveedor` |

---

## Para ponerlo en marcha de verdad

1. Registrar una aplicación en <https://dev.fitbit.com/apps> y otra en Google Cloud con la Fitness API habilitada.
2. En ambas, dar de alta la dirección de vuelta **exacta** que devuelve `urlCallback()`.
3. Rellenar en el `.env` de la raíz: `FITBIT_CLIENT_ID`, `FITBIT_CLIENT_SECRET`, `GOOGLE_FIT_CLIENT_ID`, `GOOGLE_FIT_CLIENT_SECRET`, `APP_PUBLIC_URL` y `WEARABLE_ENCRYPTION_KEY`.

La clave se genera con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 32.
