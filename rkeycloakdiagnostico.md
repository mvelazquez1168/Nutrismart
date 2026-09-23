# r-keycloak-diagnostico.md
# NutriSmart — Diagnóstico de configuración Keycloak
# Solo lectura — no modifica nada

## Objetivo

Reportar el estado actual de la integración Keycloak en el proyecto para que
podamos crear el cliente `nutrismart-patient` correctamente.

## Paso 1 — Buscar archivos de configuración de Keycloak en el frontend

```bash
# Todos los archivos que mencionan Keycloak en los frontends
grep -rn "keycloak\|Keycloak\|clientId\|realm" \
  apps/web-professional/src apps/web-patient/src \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --include="*.env" --include=".env*" \
  -l

# Mostrar el contenido de cada archivo encontrado
```

Para cada archivo encontrado, muestra su contenido completo.

## Paso 2 — Buscar archivos .env con config de Keycloak

```bash
# Variables de entorno en ambos frontends
find apps/web-professional apps/web-patient \
  -name ".env*" -type f | xargs cat 2>/dev/null || echo "Sin archivos .env"
```

## Paso 3 — Verificar si Keycloak está corriendo y qué clientes tiene

```bash
# ¿Está Keycloak arriba?
curl -s http://localhost:8080/health || \
curl -s http://localhost:8080/auth/health || \
echo "No responde en 8080"

# Obtener token de admin para listar clientes
KC_TOKEN=$(curl -s -X POST \
  "http://localhost:8080/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=admin-cli&username=admin&password=admin" \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

# Si el admin tiene contraseña distinta a "admin", el token será vacío — anótalo.

# Listar todos los clientes del realm master
if [ -n "$KC_TOKEN" ]; then
  curl -s \
    "http://localhost:8080/admin/realms/master/clients?briefRepresentation=true" \
    -H "Authorization: Bearer $KC_TOKEN" \
    | grep -o '"clientId":"[^"]*"'
else
  echo "No se pudo obtener token — verifica usuario/contraseña de admin"
fi
```

## Paso 4 — Verificar tablas relevantes en la base de datos

```bash
# ¿Hay pacientes con keycloak_user_id?
psql $DATABASE_URL -c \
  "SELECT COUNT(*) AS total,
          COUNT(keycloak_user_id) AS con_keycloak_id
   FROM paciente;"

# ¿Hay profesionales con keycloak_user_id?
psql $DATABASE_URL -c \
  "SELECT COUNT(*) AS total,
          COUNT(keycloak_user_id) AS con_keycloak_id
   FROM profesional;"
```

## Reporte esperado

Por favor, muestra toda la salida de los pasos anteriores en un bloque de
texto plano, sin omitir nada. Con esa información sabremos exactamente:
- Qué clientId y realm usan los frontends hoy
- Si Keycloak tiene clientes registrados y cuáles son
- Si hay registros vinculados en la DB

No hagas ningún cambio — solo reporta.
