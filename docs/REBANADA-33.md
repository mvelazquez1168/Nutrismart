# Rebanada 33 — Básculas conectadas (RPM-02)

Extiende la Rebanada 32: mismo mecanismo de conexión, un proveedor más
—**Withings**— que aporta lo que ninguna pulsera da: **peso y
composición corporal**.

Una báscula es distinta de un reloj en dos cosas que se notan en el
código. Primero, no se consulta por días sino por rango de fechas: uno
no se pesa a diario y preguntar «¿cuánto pesó el martes?» devuelve vacío
casi siempre. Segundo, avisa: cada vez que alguien se pesa, Withings
llama a un webhook, así que el dato llega solo en lugar de esperar a la
siguiente sincronización.

---

## Lo que se guarda

| Métrica | mtype de Withings | Unidad |
|---|---|---|
| Peso | 1 | kg |
| Grasa corporal | 6 | % |
| Masa grasa | 8 | kg |
| Masa muscular | 76 | kg |
| Masa ósea | 77 | kg |

Se dejó fuera el mtype **88** («masa muscular sin agua»), que la API
también expone. Se confunde con la masa muscular a secas: en la lista
del expediente aparecerían dos filas casi idénticas y ninguna pantalla
podría explicar la diferencia. Una cifra que no se sabe interpretar es
peor que no tenerla. Añadirla después es una línea en el mapa.

Los valores llegan codificados como `value × 10^unit` —Withings evita
los decimales en el transporte— y se decodifican al leerlos.

---

## Decisiones

### El webhook no se cree nada de lo que le llega

El encargo pedía verificar una firma con `WITHINGS_WEBHOOK_SECRET`.
**No se implementó, y no por descuido:** el mecanismo de firma de
Withings sirve para las llamadas que uno le hace a él, no para las
notificaciones que él envía. No hay firma que comprobar. Escribir una
comprobación que no comprueba nada es peor que no tenerla, porque
invita a fiarse del contenido.

El modelo que sí sostiene el peso es otro: **el aviso es solo un
disparador, nunca un dato**. Dice «el usuario X puede tener novedades»;
las medidas las pedimos nosotros a Withings con nuestro token guardado.
Quien falsifique un aviso no puede meter un peso inventado en el
expediente de nadie — lo más que consigue es que preguntemos por un
usuario que ya estaba conectado.

Alrededor de eso:

- **Responde 200 a todo**, incluso a un `userid` desconocido. Un 404 le
  confirmaría a quien sondee qué identificadores existen; y Withings,
  ante un error, reintenta y acaba dando de baja la suscripción.
- **Freno de un minuto.** Una pesada genera cinco o seis avisos, uno por
  medida. Sin freno serían cinco sincronizaciones seguidas, y un aviso
  falsificado en bucle sería una forma barata de hacernos gastar cuota
  contra Withings.
- **Contesta antes de sincronizar.** Withings da por fallido lo que
  tarde en responder.
- **`HEAD` en la misma ruta**, porque Withings comprueba la URL antes de
  aceptar la suscripción y sin eso no llega ningún aviso jamás.

### El identificador de Withings, en la conexión

El aviso viene con el identificador de usuario de Withings, no con el
nuestro. Sin guardarlo llegaría una notificación de que «alguien» se
pesó sin saber de quién. Se guarda en `conexion_wearable.usuario_externo`
—es un dato de la conexión, y desaparece con ella al desconectar— con
índice único por proveedor: dos pacientes no pueden apuntar al mismo
usuario de Withings o el aviso sería ambiguo.

### Sin dependencia nueva para el formulario

El webhook llega como `application/x-www-form-urlencoded`, que Fastify
no sabe leer de fábrica: sin parser devuelve 415 antes de entrar en la
ruta. Se resolvió con seis líneas de `addContentTypeParser` en
`server.ts` en lugar de añadir `@fastify/formbody`. Ninguna otra ruta
del proyecto usa ese tipo de contenido.

### El dialecto de Withings

Withings no habla OAuth estándar donde debería: su endpoint de token
exige `action=requesttoken` y responde `{status, body:{…}}` **con HTTP
200 aunque haya fallado**. Tratarlo como los otros dos daría por buena
una respuesta de error y guardaría un token vacío. `DEFINICION` gana un
campo `dialecto` y `cliente.ts` una rama; las rutas siguen sin saber
qué proveedor tienen delante.

### Etiquetas que faltaban desde la 32

Los mapas de nombres del front no tenían `pasos`, `frecuencia_cardiaca`
ni `sueno_horas`, y el fallback pinta la clave cruda. Con la
composición corporal habría llegado a verse **«masa_osea_kg»** en la
ficha. Se completaron los dos mapas, paciente y profesional.

Y la pantalla de dispositivos ahora dice qué aporta cada uno: con tres
opciones, el nombre no basta para elegir entre una pulsera y una
báscula.

---

## Qué no está probado

Lo mismo que en la Rebanada 32, y conviene no darlo por hecho: **no hay
aplicación registrada en Withings**, así que el intercambio de OAuth
nunca se ha ejecutado contra sus servidores. Lo verificado es la forma
del código, el esquema, y que la sección se comporta bien sin
configurar.

Los webhooks, además, **no pueden funcionar en desarrollo local en
absoluto**: Withings solo llama a direcciones públicas HTTPS. Para
probarlos hace falta un despliegue accesible desde internet o un túnel.

---

## Archivos

| Archivo | Qué cambia |
|---|---|
| `migrations/038_withings.sql` | 4 valores de enum, 3 CHECK ampliados, `usuario_externo` + índice único |
| `wearables/proveedores.ts` | Withings, `QUE_TRAE`, `dialecto`, tipos y rangos nuevos |
| `wearables/cliente.ts` | rama de token de Withings, `medidasWithings()` por rango |
| `routes/wearables.ts` | webhook `POST`/`HEAD`, rama de sincronización, `queTrae` |
| `server.ts` | parser de `x-www-form-urlencoded` |
| `config.ts`, `.env.example` | `WITHINGS_CLIENT_ID` / `_SECRET` |
| `web-patient`, `web-professional` | etiquetas de métricas, qué aporta cada proveedor |
