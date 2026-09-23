# r-mobile-setup.md
# NutriSmart — Configuración para pruebas en dispositivo móvil
# Red local + mkcert | Sin servicios externos | Solo lectura de archivos + bash + Keycloak API

## Por qué se necesita HTTPS

Los service workers (núcleo de la PWA) solo se registran sobre HTTPS.
`localhost` es la única excepción que los navegadores móviles aceptan en HTTP,
y `localhost` desde el teléfono apunta al propio teléfono, no a tu PC.
Solución: mkcert crea una CA local de confianza; el teléfono la instala una vez
y a partir de ahí todos los certificados emitidos por ella son válidos.

---

## Paso 1 — Instalar mkcert en Windows

```powershell
# Opción A — winget (recomendado)
winget install FiloSottile.mkcert

# Opción B — Chocolatey
choco install mkcert

# Opción C — descarga manual
# https://github.com/FiloSottile/mkcert/releases → mkcert-vX.X.X-windows-amd64.exe
# Renombrar a mkcert.exe y agregar la carpeta a PATH
```

Verificar:
```powershell
mkcert --version
```

---

## Paso 2 — Obtener la IP local de la máquina de desarrollo

```powershell
# Busca la línea "IPv4 Address" bajo el adaptador WiFi
ipconfig | findstr /i "IPv4"
```

Toma nota de la IP (ejemplo: `192.168.1.100`). Úsala en todos los pasos siguientes.
Guárdala en una variable para los comandos de este script:

```powershell
$LOCAL_IP = "192.168.1.100"   # <-- REEMPLAZA con tu IP real
```

---

## Paso 3 — Instalar la CA raíz de mkcert en el sistema

```powershell
mkcert -install
```

Esto instala la CA en Windows y en Chrome/Edge automáticamente.
En Firefox puede requerirse importación manual (ver Paso 6).

Anota la ruta de la CA raíz — la necesitarás para el teléfono:

```powershell
mkcert -CAROOT
# Ejemplo de salida: C:\Users\TuUsuario\AppData\Local\mkcert
```

---

## Paso 4 — Generar certificado para la IP local

Desde la raíz del proyecto (`C:\nutrismart`):

```powershell
# Crear carpeta para los certificados (ya está en .gitignore si no, agrégala)
New-Item -ItemType Directory -Force -Path certs

# Generar el cert (reemplaza la IP)
mkcert -key-file certs\local-key.pem -cert-file certs\local-cert.pem $LOCAL_IP localhost 127.0.0.1
```

Verificar que existen los dos archivos:
```powershell
dir certs\
# debe mostrar: local-cert.pem  local-key.pem
```

Agregar `certs/` al `.gitignore` si no está ya:
```
certs/
```

---

## Paso 5 — Configurar Vite con HTTPS y proxy de API

### apps/web-patient/vite.config.ts

Busca el archivo y modifícalo. Estructura típica de Vite; adapta sin romper lo que ya existe:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// Lee los certs solo si existen (evita error en CI o cuando no hay certs)
const certsDir   = path.resolve(__dirname, '../../certs')
const certExists = fs.existsSync(path.join(certsDir, 'local-cert.pem'))

export default defineConfig({
  plugins: [react()],
  server: {
    host:  '0.0.0.0',          // escucha en todas las interfaces, no solo localhost
    port:  5175,
    https: certExists ? {
      key:  fs.readFileSync(path.join(certsDir, 'local-key.pem')),
      cert: fs.readFileSync(path.join(certsDir, 'local-cert.pem')),
    } : undefined,
    proxy: {
      // Todo /api/* va al servidor Fastify — así el teléfono no necesita
      // acceder directamente al puerto 4001
      '/api': {
        target:      'http://localhost:4001',
        changeOrigin: true,
      },
    },
  },
})
```

### apps/web-professional/vite.config.ts

Aplica el mismo cambio (puerto 5173 en vez de 5175):

```typescript
// Igual que arriba pero:
port: 5173,
// El proxy /api apunta al mismo target
```

---

## Paso 6 — Variables de entorno: Keycloak URL desde el teléfono

El teléfono no puede resolver `localhost:8080` — necesita la IP de la máquina.

Busca en el proyecto dónde se configura la URL de Keycloak:

```powershell
# Buscar referencias a localhost:8080 en los frontends
grep -rn "localhost:8080" apps\web-patient\src apps\web-professional\src apps\web-patient\.env* apps\web-professional\.env* 2>$null
```

**Caso A — está en un archivo .env:**

Crea `.env.local` en `apps/web-patient/` (Vite lo prioriza sobre `.env`):

```
VITE_KEYCLOAK_URL=http://192.168.1.100:8080
```

Y en `apps/web-professional/`:
```
VITE_KEYCLOAK_URL=http://192.168.1.100:8080
```

**Caso B — está hardcodeada en el código:**

Reemplaza `http://localhost:8080` por la variable de entorno `import.meta.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8080'` en el archivo donde se inicializa Keycloak.

---

## Paso 7 — Agregar la IP a los redirect URIs de Keycloak

El cliente `nutrismart-patient` en Keycloak solo tiene registrado `http://localhost:5175/*`.
Si el teléfono hace la redirección de vuelta a `https://192.168.1.100:5175/*`,
Keycloak la rechazará con "Invalid redirect URI".

```powershell
# Obtener token de admin
$KC_ADMIN_PASS = docker inspect keycloak --format '{{range .Config.Env}}{{println .}}{{end}}' | Select-String "KC_BOOTSTRAP_ADMIN_PASSWORD" | ForEach-Object { $_ -replace ".*=", "" }

$KC_TOKEN_JSON = curl -s -X POST `
  "http://localhost:8080/realms/master/protocol/openid-connect/token" `
  -H "Content-Type: application/x-www-form-urlencoded" `
  -d "grant_type=password&client_id=admin-cli&username=admin&password=$KC_ADMIN_PASS"

$KC_TOKEN = ($KC_TOKEN_JSON | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")

# UUID del cliente nutrismart-patient
$CLIENT_UUID = (curl -s `
  "http://localhost:8080/admin/realms/nutrismart/clients?clientId=nutrismart-patient" `
  -H "Authorization: Bearer $KC_TOKEN" `
  | python3 -c "import sys,json; c=json.load(sys.stdin); print(c[0]['id'] if c else '')")

echo "CLIENT_UUID: $CLIENT_UUID"
```

```powershell
# Obtener la config actual del cliente para no pisar los redirectUris existentes
$CLIENT_JSON = curl -s `
  "http://localhost:8080/admin/realms/nutrismart/clients/$CLIENT_UUID" `
  -H "Authorization: Bearer $KC_TOKEN"

echo $CLIENT_JSON
```

Verifica los `redirectUris` actuales en la salida. Luego actualiza añadiendo la IP:

```powershell
# Reemplaza 192.168.1.100 con tu IP real
curl -s -X PUT `
  "http://localhost:8080/admin/realms/nutrismart/clients/$CLIENT_UUID" `
  -H "Authorization: Bearer $KC_TOKEN" `
  -H "Content-Type: application/json" `
  -d '{
    "redirectUris": [
      "http://localhost:5175/*",
      "https://localhost:5175/*",
      "https://192.168.1.100:5175/*"
    ],
    "webOrigins": [
      "http://localhost:5175",
      "https://localhost:5175",
      "https://192.168.1.100:5175"
    ]
  }'
```

Haz lo mismo para `nutrismart-web` (web-professional) si también quieres probar desde el teléfono:
- Añade `https://192.168.1.100:5173/*` a sus redirectUris.

---

## Paso 8 — Permitir los puertos en el Firewall de Windows

```powershell
# Puerto Vite paciente
netsh advfirewall firewall add rule name="NutriSmart patient dev" dir=in action=allow protocol=TCP localport=5175

# Puerto Vite profesional
netsh advfirewall firewall add rule name="NutriSmart professional dev" dir=in action=allow protocol=TCP localport=5173

# Puerto Keycloak (necesario para el flujo PKCE desde el teléfono)
netsh advfirewall firewall add rule name="NutriSmart Keycloak dev" dir=in action=allow protocol=TCP localport=8080
```

> Ejecutar PowerShell como Administrador para estos comandos.

---

## Paso 9 — Instalar el certificado raíz en el teléfono

Necesitas transferir el archivo `rootCA.pem` de la carpeta que devolvió `mkcert -CAROOT` al teléfono.

**Transferir:** usa AirDrop, cable USB, correo o copia a una carpeta compartida.
El archivo se llama `rootCA.pem`.

### Android

1. Abre el archivo `rootCA.pem` desde el teléfono (Archivos o gestor de descargas).
2. Android preguntará para qué usarlo → selecciona **"CA certificate"** o **"Certificado CA"**.
3. Acepta la advertencia de seguridad.
4. Verifica: Ajustes → Seguridad → Certificados de confianza → pestaña "Usuario" → debe aparecer `mkcert ...`.

### iOS / iPadOS

1. Envía `rootCA.pem` al teléfono (AirDrop o Mail).
2. Tócalo → aparece "Perfil descargado" → ve a Ajustes → General → VPN y gestión de dispositivos → instala el perfil.
3. **Paso adicional obligatorio**: Ajustes → General → Información → Configuración de confianza de certificados → activa el interruptor de `mkcert ...`.

---

## Paso 10 — Reiniciar y verificar

```powershell
# En la terminal del proyecto, reiniciar Vite del paciente
cd apps\web-patient
npm run dev
```

La consola de Vite debe mostrar:
```
  VITE v5.x.x  ready in Xms

  ➜  Local:   https://localhost:5175/
  ➜  Network: https://192.168.1.100:5175/
```

Desde el teléfono (en la misma red WiFi), abre:
```
https://192.168.1.100:5175
```

Debe cargar la app sin advertencias de certificado y el flujo de login
debe completarse (Keycloak en `http://192.168.1.100:8080` → callback a `https://192.168.1.100:5175`).

---

## Verificación final

```
[ ] mkcert instalado y versión visible
[ ] IP local identificada
[ ] Archivos certs/local-cert.pem y certs/local-key.pem generados
[ ] vite.config.ts de web-patient actualizado (host, https, proxy /api)
[ ] vite.config.ts de web-professional actualizado
[ ] VITE_KEYCLOAK_URL apunta a la IP en .env.local de ambos frontends
[ ] redirectUris de nutrismart-patient incluyen https://192.168.1.100:5175/*
[ ] Puertos 5175, 5173 y 8080 permitidos en el Firewall de Windows
[ ] rootCA.pem instalado y confiado en el teléfono
[ ] Vite muestra la URL de red con https://
[ ] Desde el teléfono: la app carga, el login funciona, no hay advertencias de cert
```

---

## Notas para sesiones futuras

- Los certificados y las reglas de Keycloak son permanentes — no hay que repetir estos pasos.
- Si tu IP cambia (router asigna una nueva), repite los pasos 2, 4 y 7 con la nueva IP.
- Para fijar la IP: asigna una IP estática a tu PC en el router (reserva DHCP por MAC).
- `.env.local` no se commitea a Git (está en `.gitignore` por defecto en Vite).
