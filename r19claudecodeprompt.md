# R19 — Infraestructura web-patient: Dockerfile + Docker Compose + Keycloak client

> **Contexto de sesión**
> Framework API: **Fastify** (no Express).
> Auth paciente: clínica resuelta desde DB via `keycloak_user_id = request.user.sub`, sin `tenant_id` en token.
> Columnas reales: `paciente.correo` · `paciente.estado` · `paciente.sexo_biologico` · `clinica.nombre_comercial` · `cita.inicio` (timestamptz).
> Design tokens vía CSS vars — nunca hexadecimales hardcodeados.
> Puerto 5174 del host está ocupado por `vetplatform-frontend-1` → usar **5175** para web-patient.

---

## Objetivo de esta rebanada

Hacer que `apps/web-patient` sea un ciudadano de primera clase del stack Docker: construible, levantable con `docker compose up`, accesible en el navegador y correctamente autenticado contra Keycloak.

Al terminar:
- `docker compose -f infra/docker-compose.dev.yml up --build web-patient` levanta la app sin errores
- `http://localhost:5175` sirve la app del paciente
- El cliente `nutrismart-patient` existe en el realm y permite el flujo de login con PKCE
- El recorrido completo invitación → activación → dashboard → mensajes → plan funciona de punta a punta

---

## Paso 1 — Aplicar el patch de Resend (si no se hizo aún)

Antes de cualquier otra cosa, verifica si nodemailer sigue instalado:

```bash
cd apps/api && npm list nodemailer 2>/dev/null | grep nodemailer
```

Si aparece, el patch de Resend no se aplicó. Aplícalo ahora:

```bash
npm uninstall nodemailer @types/nodemailer
npm install resend
```

Y reemplaza `apps/api/src/pac/email.ts` con la versión de Resend (ver `r17-patch-resend.md`). Verifica que `RESEND_API_KEY` está en `.env` de la raíz del repo.

Si nodemailer ya no aparece, el patch está aplicado — continúa.

---

## Paso 2 — Revisar el Dockerfile de `apps/web-professional`

Antes de escribir el Dockerfile del paciente, lee el Dockerfile existente de la app profesional:

```bash
cat apps/web-professional/Dockerfile
```

El Dockerfile de `web-patient` debe seguir **exactamente el mismo patrón** — misma base de build, mismo servidor nginx, mismas optimizaciones. Solo cambian los `ARG` de Vite. No inventes un patrón nuevo.

---

## Paso 3 — Crear `apps/web-patient/Dockerfile`

Basándote en lo que encontraste en el paso anterior, crea `apps/web-patient/Dockerfile`. El patrón estándar para Vite + nginx es multi-stage:

```dockerfile
# ── Etapa 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar manifiestos del workspace completo (npm workspaces necesita todos)
COPY package.json package-lock.json ./
COPY apps/web-patient/package.json ./apps/web-patient/

# Instalar solo las dependencias de web-patient (sin devDeps de otros paquetes)
RUN npm ci --workspace=apps/web-patient

# Variables de build — el navegador las resuelve como localhost porque las
# carga el celular/navegador, no el contenedor. Nunca usar hostnames internos.
ARG VITE_API_URL=http://localhost:4001
ARG VITE_KEYCLOAK_URL=http://localhost:8080
ARG VITE_KEYCLOAK_REALM=nutrismart
ARG VITE_KEYCLOAK_CLIENT_ID=nutrismart-patient

COPY apps/web-patient/ ./apps/web-patient/

RUN npm run build --workspace=apps/web-patient

# ── Etapa 2: serve ──────────────────────────────────────────────────────────
FROM nginx:alpine AS runner

# Configuración nginx para SPA (todas las rutas → index.html)
COPY --from=builder /app/apps/web-patient/dist /usr/share/nginx/html

RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
  # Cache agresivo para assets con hash; sin cache para index.html\n\
  location ~* \\.(js|css|png|jpg|svg|ico|woff2)$ {\n\
    expires 1y;\n\
    add_header Cache-Control "public, immutable";\n\
  }\n\
  location = /index.html {\n\
    add_header Cache-Control "no-store";\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

> **Si el Dockerfile de web-professional tiene una estructura diferente** (por ejemplo copia el `package-lock.json` de otra forma, o usa `pnpm`, o tiene pasos adicionales), replica esa estructura exacta y adapta solo los paths de `web-patient`. El objetivo es que ambas apps sean consistentes.

Verifica que el Dockerfile construye correctamente:

```bash
# Desde la raíz del repo
docker build -f apps/web-patient/Dockerfile \
  --build-arg VITE_API_URL=http://localhost:4001 \
  --build-arg VITE_KEYCLOAK_URL=http://localhost:8080 \
  --build-arg VITE_KEYCLOAK_REALM=nutrismart \
  --build-arg VITE_KEYCLOAK_CLIENT_ID=nutrismart-patient \
  -t nutrismart-web-patient-test .

echo "Exit code: $?"
```

Si da error, diagnostica y corrige antes de continuar.

---

## Paso 4 — Actualizar `infra/docker-compose.dev.yml`

Lee el archivo actual:

```bash
cat infra/docker-compose.dev.yml
```

Localiza el bloque comentado de `web-patient` y reemplázalo con la versión activa. El cambio principal: **puerto 5175** en el host (5174 está ocupado por vetplatform-frontend-1).

```yaml
  web-patient:
    build:
      context: ..
      dockerfile: apps/web-patient/Dockerfile
      args:
        # URLs que resuelve el NAVEGADOR → siempre localhost, nunca hostnames Docker
        VITE_API_URL: http://localhost:4001
        VITE_KEYCLOAK_URL: http://localhost:8080
        VITE_KEYCLOAK_REALM: nutrismart
        VITE_KEYCLOAK_CLIENT_ID: nutrismart-patient
    container_name: nutrismart-web-pat
    depends_on: [api]
    ports:
      # 5174 lo ocupa vetplatform-frontend-1; usamos 5175
      - "5175:80"
    networks: [nutrismart]
```

Coloca este bloque en el lugar correcto del YAML (al mismo nivel de indentación que `web-professional`). Asegúrate de eliminar el bloque comentado completo para evitar confusión.

---

## Paso 5 — Actualizar variables de entorno de `apps/web-patient`

El archivo `apps/web-patient/.env` tiene `VITE_KEYCLOAK_CLIENT_ID=nutrismart-patient`. Verifica que existe y está completo:

```bash
cat apps/web-patient/.env
```

Debe contener:

```env
VITE_API_URL=http://localhost:4001
VITE_KEYCLOAK_URL=http://localhost:8080
VITE_KEYCLOAK_REALM=nutrismart
VITE_KEYCLOAK_CLIENT_ID=nutrismart-patient
```

El puerto de la app (`5175`) no es una variable de entorno — es configuración de Vite y Docker, no de la app en sí.

---

## Paso 6 — Crear el cliente `nutrismart-patient` en Keycloak

Este es el paso que bloqueó r17. El cliente es necesario para que el flujo PKCE funcione.

### Opción A — Consola de administración de Keycloak (recomendado si tienes acceso)

1. Abre `http://localhost:8080/admin` → inicia sesión como administrador
2. Selecciona el realm `nutrismart` en el menú superior izquierdo
3. Clients → Create client
4. Rellena:
   - **Client type**: OpenID Connect
   - **Client ID**: `nutrismart-patient`
   - **Name**: NutriSmart Paciente
5. Next → habilita **Standard flow** (Authorization Code), deshabilita Direct access grants
6. Next → en Redirect URIs agrega:
   - `http://localhost:5175/*`
   - `http://localhost:5174/*` (por compatibilidad con dev sin Docker)
7. Web origins: `http://localhost:5175`, `http://localhost:5174`
8. Save

Después crea el scope de roles:
- Client scopes → Roles → Mapper → agregar mapper de tipo "User Realm Role" con token claim name `roles`

### Opción B — curl desde PowerShell (si tienes la contraseña del admin)

```powershell
# 1. Obtener token de admin
$adminPass = "la-password-del-admin-keycloak"

$tokenResp = Invoke-RestMethod `
  -Method POST `
  -Uri "http://localhost:8080/realms/master/protocol/openid-connect/token" `
  -ContentType "application/x-www-form-urlencoded" `
  -Body "client_id=admin-cli&username=admin&password=$adminPass&grant_type=password"

$token = $tokenResp.access_token

# 2. Crear el cliente
$clientBody = @{
  clientId = "nutrismart-patient"
  name = "NutriSmart Paciente"
  enabled = $true
  publicClient = $true
  standardFlowEnabled = $true
  directAccessGrantsEnabled = $false
  redirectUris = @("http://localhost:5175/*", "http://localhost:5174/*")
  webOrigins = @("http://localhost:5175", "http://localhost:5174")
  attributes = @{ "pkce.code.challenge.method" = "S256" }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Method POST `
  -Uri "http://localhost:8080/admin/realms/nutrismart/clients" `
  -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } `
  -Body $clientBody

Write-Host "Cliente creado."
```

### Opción C — Importar solo el cliente desde el JSON de r17

Si r17 generó `infra/keycloak/realm-nutrismart.json` con el cliente declarado:

```powershell
# Extraer solo la sección del cliente y hacer partial import
# (Keycloak admin → Import → "Skip" para entidades existentes)
# Seleccionar el archivo realm-nutrismart.json
# En "If resource exists" elegir "Skip"
# Marcar solo "Clients" en los recursos a importar
```

### Verificación de Keycloak

Una vez creado el cliente, verifica desde el navegador:

```
http://localhost:8080/realms/nutrismart/.well-known/openid-configuration
```

Debe devolver JSON. Luego verifica que el cliente existe:

```
http://localhost:8080/admin/realms/nutrismart/clients
```

(Busca `nutrismart-patient` en la lista.)

---

## Paso 7 — Actualizar redirect URIs en Keycloak para incluir el puerto 5175

Si el cliente ya existía desde r17 con `5174`, actualiza las URIs para incluir también `5175`:

En la consola de Keycloak → Clients → nutrismart-patient → Settings:
- Valid redirect URIs: añade `http://localhost:5175/*`
- Web origins: añade `http://localhost:5175`
- Save

---

## Paso 8 — Levantar el stack completo y verificar

```bash
# Desde la raíz del repo — build completo con web-patient
docker compose -f infra/docker-compose.dev.yml up --build web-patient -d
```

Espera a que el build termine (~2-3 minutos la primera vez). Verifica:

```bash
docker compose -f infra/docker-compose.dev.yml ps
# web-patient debe aparecer como "running"

docker logs nutrismart-web-pat --tail 20
# Debe mostrar nginx arrancando, sin errores
```

Abre en el navegador:

```
http://localhost:5175
```

Debe cargar la pantalla de `/activar` (redirige ahí por defecto).

---

## Paso 9 — Recorrido completo del flujo del paciente

Este es el primer recorrido de punta a punta con Docker activo. Documenta los resultados en `docs/REBANADA-19.md`.

### 9.1 Invitación desde web-professional

1. Abre `http://localhost:5173` (web-professional)
2. Busca un paciente que tenga `correo` registrado pero `keycloak_user_id` sea NULL
3. Haz clic en "Invitar a NutriSmart"
4. Verifica que el `token` aparece en la respuesta del botón (y en consola de la API si no hay SMTP)

```sql
-- Confirmar en DB:
SELECT id, token, estado, expires_at
  FROM invitacion_paciente
 ORDER BY created_at DESC LIMIT 1;
```

### 9.2 Activación del paciente

5. Construye la URL: `http://localhost:5175/activar?token=<TOKEN>`
6. Abre en el navegador → debe mostrar la pantalla de bienvenida con nombre del paciente y clínica
7. Haz clic en "Crear mi cuenta" → redirige al registro de Keycloak
8. Crea una cuenta nueva (email + contraseña)
9. Keycloak redirige de vuelta a la app
10. La app muestra "¡Cuenta activada!"

```sql
-- Confirmar vinculación:
SELECT id, correo, keycloak_user_id, estado
  FROM paciente
 WHERE keycloak_user_id IS NOT NULL
 ORDER BY updated_at DESC LIMIT 3;

-- Confirmar invitación usada:
SELECT estado, usado_en FROM invitacion_paciente ORDER BY created_at DESC LIMIT 1;
```

### 9.3 Dashboard

11. Haz clic en "Ir a mi dashboard" → debe mostrar las tarjetas de inicio
12. Si hay datos clínicos (peso, plan, acuerdos), deben aparecer
13. La NavBar inferior muestra Inicio, Mi plan, Mensajes

### 9.4 Mensajería

14. Navega a `/mensajes` desde la NavBar
15. Envía un mensaje → aparece como burbuja verde
16. Desde web-professional, verifica que el mensaje llegó en la bandeja del profesional
17. El profesional responde → en la app del paciente aparece en ≤ 5s

### 9.5 Plan y acuerdos

18. Navega a `/plan` → muestra kcal, macros y acuerdos (si la consulta está finalizada)
19. Toca un acuerdo → se marca con ✓ verde
20. Recarga la página → el estado persiste

### 9.6 Prueba en móvil (opcional pero recomendado)

21. Conecta el teléfono a la misma red WiFi
22. Encuentra la IP local del laptop: en PowerShell `ipconfig | Select-String "IPv4"`
23. Abre `http://<IP>:5175` en el navegador del celular
24. Verifica que la UI se ve correctamente en pantalla pequeña
25. En Android Chrome: verifica que aparece el banner "Agregar a pantalla de inicio"

---

## Paso 10 — Ajustes post-verificación

Si durante el recorrido aparecen errores, los más comunes y sus fixes:

**`CORS error` al llamar a la API desde el contenedor de web-patient**
El API corre en el host en 4001; el contenedor del paciente hace fetch a `http://localhost:4001` que dentro del contenedor Docker apunta a sí mismo, no al host. Solución: en `docker-compose.dev.yml`, agrega al servicio `web-patient` una variable de entorno o usa `host.docker.internal`:

```yaml
# En el bloque web-patient, sección args del build:
args:
  VITE_API_URL: http://host.docker.internal:4001
```

Y actualiza `apps/web-patient/.env` para dev local:
```env
VITE_API_URL=http://localhost:4001
```

Los dos valores son correctos en sus contextos (localhost para `npm run dev`, `host.docker.internal` para el build Docker).

**`invalid_redirect_uri` en Keycloak**
El redirect URI que manda la app no coincide con los configurados en el cliente. Verifica la URL exacta que Keycloak rechaza en el error y agrégala en la consola de admin.

**El service worker sirve HTML cacheado tras rebuild**
En el navegador de prueba: DevTools → Application → Service Workers → Unregister. Recarga.

**`Cannot find module 'resend'`**
El patch de Resend no se aplicó. Vuelve al Paso 1.

---

## Paso 11 — Actualizar `infra/keycloak/realm-nutrismart.json`

Si el cliente `nutrismart-patient` se creó manualmente en la consola de Keycloak, expórtalo para que el archivo de realm refleje el estado real de la instancia:

En Keycloak admin → realm nutrismart → Realm settings → Action → Partial export → marcar "Clients" → Export.

Reemplaza el bloque del cliente `nutrismart-patient` en `infra/keycloak/realm-nutrismart.json` con lo que exporta Keycloak. Esto garantiza que una instalación nueva del realm ya tenga el cliente listo.

---

## Notas para r20

Con r19 el stack del paciente está completo. Los siguientes bloques candidatos para r20:

- **Ejecución de r15 + r16** (EVAL-05 conclusiones + calculadora + r16 seguimiento inteligente): llevan semanas en la cola — son las rebanadas más ricas del bloque EVAL y desbloquean el módulo completo de valoración.
- **RPM (Remote Patient Monitoring)**: umbrales de alerta clínica, panel de monitoreo del profesional. Requiere análisis de qué métricas ya están almacenadas vs. cuáles necesitan nueva captura.
- **Agenda/Citas**: gestión de citas desde el lado del profesional. La tabla `cita` ya existe (`cita.inicio` timestamptz), falta el frontend.
- **Dockerfile consolidado**: si el equipo va a hacer deploy, conviene revisar variables de producción, SSL/TLS y los secretos en docker-compose.

Prioridad recomendada: ejecutar r15 y r16 primero (son código ya escrito), luego decidir entre RPM y Agenda según las necesidades inmediatas de la clínica piloto.
