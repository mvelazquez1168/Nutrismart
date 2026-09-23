# r-keycloak-setup.md
# NutriSmart — Configuración del cliente Keycloak para pacientes
# Modifica Keycloak y la base de datos. No toca código fuente.

## Contexto

El diagnóstico anterior reveló exactamente lo que falta:
1. El cliente `nutrismart-patient` no existe en el realm `nutrismart`.
2. `registrationAllowed = false` en el realm → la pantalla de registro falla.

El cliente de referencia es `nutrismart-web` (profesional):
- publicClient=true, PKCE S256, redirectUris a 5173
- Dos mappers: `tenant_id` (atributo de usuario) y `aud-nutrismart-api` (audiencia)

Para el cliente de paciente:
- Mismo patrón, redirectUris a **5175**
- **NO** copiar el mapper `tenant_id` — la API distingue paciente/profesional
  por la AUSENCIA de ese claim en el token.
- **SÍ** copiar `aud-nutrismart-api` — sin él la API rechaza el token.

---

## Paso 1 — Obtener token de administrador

```bash
# Obtener la contraseña del admin de Keycloak desde el contenedor
KC_ADMIN_PASS=$(docker inspect keycloak \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep KC_BOOTSTRAP_ADMIN_PASSWORD | cut -d= -f2)

echo "Admin password obtenida: ${KC_ADMIN_PASS:0:4}***"

# Obtener token de administración
KC_TOKEN=$(curl -s -X POST \
  "http://localhost:8080/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=admin-cli&username=admin&password=${KC_ADMIN_PASS}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token','ERROR'))")

if [ "${KC_TOKEN}" = "ERROR" ] || [ -z "${KC_TOKEN}" ]; then
  echo "ERROR: No se pudo obtener el token de admin. Verificar contraseña."
  exit 1
fi
echo "Token obtenido correctamente (${#KC_TOKEN} chars)"
```

---

## Paso 2 — Crear el cliente nutrismart-patient

```bash
HTTP_STATUS=$(curl -s -o /tmp/kc_create_response.json -w "%{http_code}" \
  -X POST \
  "http://localhost:8080/admin/realms/nutrismart/clients" \
  -H "Authorization: Bearer ${KC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId":                  "nutrismart-patient",
    "name":                      "NutriSmart Paciente",
    "publicClient":              true,
    "standardFlowEnabled":       true,
    "directAccessGrantsEnabled": false,
    "redirectUris":              ["http://localhost:5175/*"],
    "webOrigins":                ["http://localhost:5175"],
    "attributes": {
      "pkce.code.challenge.method": "S256"
    }
  }')

echo "Crear cliente → HTTP $HTTP_STATUS"
cat /tmp/kc_create_response.json

if [ "$HTTP_STATUS" != "201" ]; then
  echo "ERROR al crear el cliente. Abortando."
  exit 1
fi
```

---

## Paso 3 — Agregar el mapper de audiencia (aud-nutrismart-api)

```bash
# Obtener el UUID interno del cliente recién creado
CLIENT_UUID=$(curl -s \
  "http://localhost:8080/admin/realms/nutrismart/clients?clientId=nutrismart-patient" \
  -H "Authorization: Bearer ${KC_TOKEN}" \
  | python3 -c "import sys,json; clients=json.load(sys.stdin); print(clients[0]['id'] if clients else 'NOT_FOUND')")

echo "UUID interno del cliente: $CLIENT_UUID"

if [ "$CLIENT_UUID" = "NOT_FOUND" ]; then
  echo "ERROR: No se encontró el cliente recién creado."
  exit 1
fi

# Agregar mapper de audiencia (igual que en nutrismart-web)
HTTP_MAPPER=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  "http://localhost:8080/admin/realms/nutrismart/clients/${CLIENT_UUID}/protocol-mappers/models" \
  -H "Authorization: Bearer ${KC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name":           "aud-nutrismart-api",
    "protocol":       "openid-connect",
    "protocolMapper": "oidc-audience-mapper",
    "config": {
      "included.client.audience": "nutrismart-api",
      "id.token.claim":           "false",
      "access.token.claim":       "true"
    }
  }')

echo "Agregar mapper → HTTP $HTTP_MAPPER"
[ "$HTTP_MAPPER" = "201" ] && echo "Mapper agregado correctamente" || echo "ERROR al agregar mapper"
```

---

## Paso 4 — Habilitar registro de usuarios en el realm

```bash
HTTP_REALM=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PUT \
  "http://localhost:8080/admin/realms/nutrismart" \
  -H "Authorization: Bearer ${KC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"registrationAllowed": true}')

echo "Habilitar registro → HTTP $HTTP_REALM"
[ "$HTTP_REALM" = "204" ] && echo "Registro habilitado correctamente" || echo "ERROR al habilitar registro"
```

---

## Paso 5 — Crear usuario de prueba paciente en Keycloak

```bash
HTTP_USER=$(curl -s -o /tmp/kc_user_response.json -w "%{http_code}" \
  -X POST \
  "http://localhost:8080/admin/realms/nutrismart/users" \
  -H "Authorization: Bearer ${KC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "username":      "paciente-prueba",
    "email":         "paciente@test.com",
    "firstName":     "Ana",
    "lastName":      "Prueba",
    "enabled":       true,
    "emailVerified": true,
    "credentials": [{
      "type":      "password",
      "value":     "Test1234!",
      "temporary": false
    }]
  }')

echo "Crear usuario paciente → HTTP $HTTP_USER"
cat /tmp/kc_user_response.json

# Obtener el UUID del nuevo usuario
KC_USER_UUID=$(curl -s \
  "http://localhost:8080/admin/realms/nutrismart/users?username=paciente-prueba" \
  -H "Authorization: Bearer ${KC_TOKEN}" \
  | python3 -c "import sys,json; users=json.load(sys.stdin); print(users[0]['id'] if users else 'NOT_FOUND')")

echo "UUID del usuario paciente: $KC_USER_UUID"
```

---

## Paso 6 — Vincular el usuario de Keycloak a un paciente en la BD

```bash
# Seleccionamos el primer paciente sin keycloak_user_id y lo vinculamos
LINKED=$(psql "$DATABASE_URL" -t -c "
  UPDATE paciente
  SET keycloak_user_id = '${KC_USER_UUID}',
      updated_at       = now()
  WHERE id = (
    SELECT id FROM paciente
    WHERE keycloak_user_id IS NULL
      AND activo = true
    ORDER BY created_at ASC
    LIMIT 1
  )
  RETURNING id, nombre, keycloak_user_id;
")

echo "Paciente vinculado:"
echo "$LINKED"

if [ -z "$(echo $LINKED | tr -d ' ')" ]; then
  echo "ADVERTENCIA: No había pacientes sin keycloak_user_id para vincular."
  echo "Creando un paciente de prueba nuevo..."

  # Obtener la primera clínica y primer profesional disponibles
  CLINICA_ID=$(psql "$DATABASE_URL" -t -c "SELECT id FROM clinica LIMIT 1;" | tr -d ' ')
  PROFESIONAL_ID=$(psql "$DATABASE_URL" -t -c "SELECT id FROM profesional WHERE activo = true LIMIT 1;" | tr -d ' ')

  psql "$DATABASE_URL" -c "
    INSERT INTO paciente
      (clinica_id, profesional_id, keycloak_user_id, nombre, email,
       fecha_nacimiento, sexo)
    VALUES
      ('${CLINICA_ID}', '${PROFESIONAL_ID}', '${KC_USER_UUID}',
       'Ana Prueba', 'paciente@test.com', '1990-06-15', 'F')
    RETURNING id, nombre, keycloak_user_id;
  "
fi

# Crear configuracion_paciente si no existe (ON CONFLICT es no-op)
psql "$DATABASE_URL" -c "
  INSERT INTO configuracion_paciente (paciente_id, clinica_id)
  SELECT p.id, p.clinica_id
  FROM paciente p
  WHERE p.keycloak_user_id = '${KC_USER_UUID}'
  ON CONFLICT DO NOTHING;
"
```

---

## Paso 7 — Verificación final

```bash
echo ""
echo "════════════════════════════════════════════════"
echo "VERIFICACIÓN FINAL"
echo "════════════════════════════════════════════════"

# 1. Cliente existe en Keycloak
CLIENT_CHECK=$(curl -s \
  "http://localhost:8080/admin/realms/nutrismart/clients?clientId=nutrismart-patient" \
  -H "Authorization: Bearer ${KC_TOKEN}" \
  | python3 -c "
import sys, json
clients = json.load(sys.stdin)
if clients:
    c = clients[0]
    print(f'  clientId      : {c[\"clientId\"]}')
    print(f'  publicClient  : {c[\"publicClient\"]}')
    print(f'  redirectUris  : {c.get(\"redirectUris\", [])}')
    print(f'  PKCE S256     : {c.get(\"attributes\",{}).get(\"pkce.code.challenge.method\",\"NO\")}')
else:
    print('  ERROR: cliente no encontrado')
")
echo "Cliente nutrismart-patient:"
echo "$CLIENT_CHECK"

# 2. Registro habilitado
REG_ENABLED=$(curl -s \
  "http://localhost:8080/admin/realms/nutrismart" \
  -H "Authorization: Bearer ${KC_TOKEN}" \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print('  registrationAllowed:', r.get('registrationAllowed'))")
echo ""
echo "Realm:"
echo "$REG_ENABLED"

# 3. Paciente vinculado en DB
echo ""
echo "Pacientes vinculados en BD:"
psql "$DATABASE_URL" -c "
  SELECT nombre, email, keycloak_user_id IS NOT NULL AS vinculado
  FROM paciente
  WHERE activo = true
  ORDER BY nombre;
"

echo ""
echo "════════════════════════════════════════════════"
echo "LISTO. Para probar el login del paciente:"
echo "  1. Arranca la app: cd apps/web-patient && npm run dev"
echo "  2. Abre http://localhost:5175"
echo "  3. Usuario: paciente@test.com  |  Contraseña: Test1234!"
echo "════════════════════════════════════════════════"
```
