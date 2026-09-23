# NutriSmart · Probar en un móvil de la red local

La aplicación del paciente se usa con el pulgar, de pie y con prisa. Probarla en el navegador del ordenador con la ventana estrecha no es lo mismo: no hay teclado que tape media pantalla, ni notch, ni dedo gordo.

Esta guía deja el proyecto accesible desde un teléfono de la misma red WiFi.

---

## HTTPS es obligatorio, y no por la PWA

Lo parecía —los *service workers* solo se registran sobre HTTPS— pero el motivo real aparece antes: **PKCE necesita `crypto.subtle`, y los navegadores solo exponen esa API en contextos seguros**: HTTPS, o `localhost`.

Desde el móvil, sobre HTTP y una dirección IP, `window.crypto.subtle` **no existe**. `keycloak-js` falla al generar el desafío PKCE, la promesa se descarta sin ruido, y el botón de entrar **no hace nada**: ni redirige, ni da error, ni sale a la red. Es un fallo mudo, y cuesta encontrarlo porque no deja rastro en ningún registro.

Por eso el servidor de desarrollo se levanta con `DEV_HTTPS=1` y el teléfono necesita confiar en la CA de mkcert.

---

## Cómo funciona

Todo pasa por **un solo origen**: el servidor de desarrollo de Vite. Él reenvía lo que no es suyo.

```
móvil ──► http://192.168.100.94:5175
             │
             ├─ /            la aplicación
             ├─ /api/*    ──► http://localhost:4001   (la API)
             └─ /realms/* ──► http://localhost:8080   (Keycloak)
```

Esto resuelve cuatro cosas de una vez:

| Problema | Cómo se evita |
|---|---|
| El teléfono no puede resolver `localhost` — esa dirección es él mismo | Solo necesita conocer una dirección y un puerto |
| Abrir 4001 y 8080 en el cortafuegos | No hacen falta: solo 5175 (o 5173) |
| CORS entre la app y la API | Mismo origen, no hay CORS |
| El `iss` del token cambiaría y la API daría 401 | `changeOrigin` hace que Keycloak vea `Host: localhost:8080` y firme como siempre |

En este proyecto hay además un motivo concreto: el puerto **8080 de la máquina lo comparte un Apache**, que es quien responde desde la IP de red — Keycloak solo gana en `localhost`. Yendo por el proxy se llega siempre al correcto.

---

## Puesta en marcha

### 1 · La IP de la máquina

```powershell
ipconfig | findstr /i "IPv4"
```

Actualmente: **192.168.100.94** (adaptador Wi-Fi). Si el router te asigna otra, hay que repetir el paso 3.

### 2 · El archivo `.env.local`

Va en la **raíz del repositorio**, no dentro de cada app: las dos declaran `envDir` apuntando ahí, así que un `.env.local` dentro de `apps/web-patient/` no se leería.

```
VITE_API_URL=
VITE_KEYCLOAK_URL=
```

Las dos vacías a propósito: así la aplicación pide `/api` y `/realms` a quien la sirvió, y el proxy hace el resto. Está en `.gitignore`.

Para volver a trabajar solo en el ordenador, basta con borrarlo.

### 3 · Los redirect URIs de Keycloak

Ya están puestos para la IP actual. Si cambia, hay que rehacerlos:

```bash
KP=$(docker inspect keycloak --format '{{range .Config.Env}}{{println .}}{{end}}' | grep KC_BOOTSTRAP_ADMIN_PASSWORD | cut -d= -f2)
KC=$(curl -s -X POST "http://localhost:8080/realms/master/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=admin-cli -d username=admin -d "password=$KP" \
  | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

U=$(curl -s "http://localhost:8080/admin/realms/nutrismart/clients?clientId=nutrismart-patient" \
  -H "Authorization: Bearer $KC" | python -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")

curl -X PUT "http://localhost:8080/admin/realms/nutrismart/clients/$U" \
  -H "Authorization: Bearer $KC" -H "Content-Type: application/json" \
  -d '{"redirectUris":["http://localhost:5175/*","http://LA_NUEVA_IP:5175/*"],
       "webOrigins":["http://localhost:5175","http://LA_NUEVA_IP:5175"]}'
```

### 4 · El cortafuegos de Windows

**Requiere PowerShell como administrador.** Solo los puertos de Vite:

```powershell
New-NetFirewallRule -DisplayName "NutriSmart dev 5175" -Direction Inbound -Protocol TCP -LocalPort 5175 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "NutriSmart dev 5173" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow -Profile Private
```

`-Profile Private` restringe la regla a redes marcadas como privadas: la de casa o la de la clínica, no la de una cafetería.

### 5 · Levantar

El contenedor y el servidor de desarrollo **no pueden compartir puerto**. Para probar en el móvil hace falta el de desarrollo, que es el que tiene el proxy:

```bash
docker compose -f infra/docker-compose.dev.yml stop web-patient
DEV_HTTPS=1 npm run dev -w @nutrismart/web-patient
```

Vite debe anunciar la IP:

```
➜  Local:   https://localhost:5175/
➜  Network: https://192.168.100.94:5175/
```

Si dice otro puerto, algo lo tiene ocupado: `strictPort` está activado precisamente para que avise en vez de moverse en silencio a un puerto que Keycloak no tiene registrado.

### 6 · Desde el teléfono

Misma red WiFi, y abrir `https://192.168.100.94:5175` — con **https**.

Escribirlo a mano rara vez funciona: los navegadores móviles mandan al buscador lo que «parece» una consulta, aunque lleve el esquema delante. Lo fiable es **escanear un QR** o **mandarse el enlace** por WhatsApp y tocarlo.

Para volver a dejarlo como estaba:

```bash
docker compose -f infra/docker-compose.dev.yml start web-patient
```

---

## Comprobado

| Prueba desde la IP de red | Resultado |
|---|---|
| `GET /` | 200, la aplicación |
| `GET /realms/nutrismart` | 200 y devuelve el realm — llega a Keycloak, no al Apache |
| `GET /api/paciente/yo` sin token | 401 `unauthorized` — llega a la API |
| Login completo por el proxy | Token con `iss: http://localhost:8080/realms/nutrismart` |
| `GET /api/me` con ese token | 200 |

---

## El día que haya PWA: HTTPS

Los *service workers* solo se registran sobre HTTPS. `localhost` es la única excepción, y desde el teléfono `localhost` es el teléfono.

Ya está preparado:

- **mkcert instalado** y su CA raíz en el almacén del sistema.
- **Certificado generado** en `certs/` para `192.168.100.94`, `localhost`, `127.0.0.1` y `::1`. Caduca el **14 de noviembre de 2028**. La carpeta está en `.gitignore`.
- **Los dos `vite.config.ts`** lo usan si existe **y** si `DEV_HTTPS=1`.

```bash
DEV_HTTPS=1 npm run dev -w @nutrismart/web-patient
```

### HTTPS no es solo para la PWA

Hace falta ya, y por otro motivo: la **Web Crypto API** que Keycloak usa para PKCE solo existe en contextos seguros. Por HTTP y con una IP de red local, `crypto.subtle` no está definido, y el sintoma es de los peores — el boton de entrar no hace nada, sin error en pantalla ni en consola.

Probado: con `DEV_HTTPS=1` y la CA de mkcert instalada en el iPhone, el login completo funciona.

### Por qué va detrás de una variable y no se activa solo

Ya no por el contenido mixto: al ir Keycloak por el proxy, el navegador solo habla con Vite, y si la app va por HTTPS su `/realms` también. Eso quedó comprobado.

Las razones que quedan son otras dos:

1. Las direcciones de vuelta del cliente `nutrismart-patient` están registradas en Keycloak. Servir por https sin quererlo cambia el origen y el login acaba en «Invalid redirect_uri», un error que no menciona el esquema por ningún sitio.
2. Trabajar en el ordenador no necesita HTTPS y no tiene por qué obligar a instalar mkcert.

### Si no hay mkcert: el respaldo autofirmado

Con `DEV_HTTPS=1` y **sin** certificados en `certs/`, entra `@vitejs/plugin-basic-ssl`, que genera uno al vuelo. Basta para que el navegador considere la página un contexto seguro y exponga `crypto.subtle`.

Se acepta el aviso de seguridad y a funcionar — **en el ordenador y en Android**. En **iOS no sirve**: da «esta conexión no es privada» y no hay manera de darlo por bueno, porque se regenera dentro de `node_modules/.vite` y no es una CA instalable. Para el iPhone, mkcert.

El plugin va condicionado a que NO haya mkcert, y no suelto en `plugins`, porque **pisa** en vez de añadir:

```js
if (config.server.https === undefined || !!config.server.https)
  config.server.https = Object.assign({}, config.server.https, suyo)
```

Puesto sin condición sobrescribiría el certificado de mkcert con el suyo —deshaciendo justo lo que hace que el iPhone acepte la conexión— y, por la rama `=== undefined`, forzaría HTTPS **siempre**, también al trabajar en el ordenador.

Las tres rutas, comprobadas:

| | `Local:` |
|---|---|
| sin `DEV_HTTPS` | `http://localhost:5175/` |
| `DEV_HTTPS=1` con mkcert | `https://localhost:5175/` — sirve el certificado de mkcert |
| `DEV_HTTPS=1` sin mkcert | `https://localhost:5175/` — autofirmado |

Que en el segundo caso mande mkcert y no el respaldo se comprueba mirando quién firma:

```bash
echo | openssl s_client -connect localhost:5175 -servername localhost 2>/dev/null   | openssl x509 -noout -issuer
# issuer=O=mkcert development CA, ...
```

### Instalar la CA en el teléfono

Solo hace falta con `DEV_HTTPS=1`. El archivo es `rootCA.pem`, en:

```
C:\Users\Miguel\AppData\Local\mkcert
```

**Android** — abrir el archivo → elegir «Certificado CA» → aceptar el aviso. Comprobar en Ajustes → Seguridad → Certificados de confianza → pestaña «Usuario».

**iOS** — enviarlo por AirDrop o correo → Ajustes → General → VPN y gestión de dispositivos → instalar. **Y además**, paso que se olvida siempre: Ajustes → General → Información → Configuración de confianza de certificados → activar el interruptor de `mkcert`.

---

## Si la IP cambia

El router puede asignar otra. Hay que rehacer el paso 3, y el certificado si se usa HTTPS:

```bash
mkcert -key-file certs/local-key.pem -cert-file certs/local-cert.pem LA_NUEVA_IP localhost 127.0.0.1 ::1
```

Para que no vuelva a pasar: reserva DHCP por MAC en el router.
