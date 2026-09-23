# r-validacion-paciente.md
# NutriSmart — Validación del portal del paciente (desbloqueada)
# Requiere: r-keycloak-setup.md ejecutado, API corriendo en 4001

## Contexto

El cliente Keycloak `nutrismart-patient` ya existe. El paciente de prueba
`paciente@test.com / Test1234!` tiene `keycloak_user_id` en la base de datos.

Esta sesión valida todos los endpoints del paciente que no pudieron probarse
en el navegador por el bloqueo de Keycloak. Incluye r12–r24.

**No modifica código fuente.** Sí crea registros de prueba en la base de datos.

---

## Paso 0 — Leer el estado de pruebas pendientes

```bash
cat docs/PRUEBAS.md | grep -A 2 "pendiente\|PENDIENTE\|❌\|⏳" | head -60
```

---

## Paso 1 — Verificar precondiciones

```bash
# ¿Está corriendo la API?
curl -s http://localhost:4001/health || \
curl -s http://localhost:4001/ | head -c 100 || \
echo "API no responde en 4001 — inicia con: cd apps/api && npm run dev"

# ¿Está vinculado el paciente de prueba?
psql "$DATABASE_URL" -c "
  SELECT id, nombre, email, keycloak_user_id IS NOT NULL AS vinculado, clinica_id
  FROM paciente
  WHERE email = 'paciente@test.com'
  LIMIT 1;
"

# Guardar clinica_id y paciente_id para los tests
PACIENTE_ID=$(psql "$DATABASE_URL" -t -c \
  "SELECT id FROM paciente WHERE email = 'paciente@test.com' LIMIT 1;" | tr -d ' \n')
CLINICA_ID=$(psql "$DATABASE_URL" -t -c \
  "SELECT clinica_id FROM paciente WHERE email = 'paciente@test.com' LIMIT 1;" | tr -d ' \n')

echo "paciente_id : $PACIENTE_ID"
echo "clinica_id  : $CLINICA_ID"
```

---

## Paso 2 — Obtener JWT del paciente

Habilitamos `directAccessGrants` temporalmente en el cliente para poder
pedir un token vía curl. Lo desactivamos al finalizar.

```bash
# Token de administración de Keycloak
KC_ADMIN_PASS=$(docker inspect keycloak \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep KC_BOOTSTRAP_ADMIN_PASSWORD | cut -d= -f2)

KC_TOKEN=$(curl -s -X POST \
  "http://localhost:8080/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=admin-cli&username=admin&password=${KC_ADMIN_PASS}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")

[ -z "$KC_TOKEN" ] && echo "ERROR: No se pudo obtener token admin" && exit 1

# UUID interno del cliente nutrismart-patient
CLIENT_UUID=$(curl -s \
  "http://localhost:8080/admin/realms/nutrismart/clients?clientId=nutrismart-patient" \
  -H "Authorization: Bearer ${KC_TOKEN}" \
  | python3 -c "import sys,json; c=json.load(sys.stdin); print(c[0]['id'] if c else '')")

# Habilitar directAccessGrants temporalmente
curl -s -X PUT \
  "http://localhost:8080/admin/realms/nutrismart/clients/${CLIENT_UUID}" \
  -H "Authorization: Bearer ${KC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"directAccessGrantsEnabled": true}' > /dev/null

# Obtener JWT del paciente de prueba
PATIENT_JWT=$(curl -s -X POST \
  "http://localhost:8080/realms/nutrismart/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=nutrismart-patient&username=paciente@test.com&password=Test1234!" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token','ERROR: '+d.get('error_description','')))")

echo "JWT obtenido: ${PATIENT_JWT:0:40}..."

# Deshabilitar directAccessGrants inmediatamente
curl -s -X PUT \
  "http://localhost:8080/admin/realms/nutrismart/clients/${CLIENT_UUID}" \
  -H "Authorization: Bearer ${KC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"directAccessGrantsEnabled": false}' > /dev/null

echo "directAccessGrants deshabilitado"

[ "$PATIENT_JWT" = "" ] && echo "ERROR: JWT vacío — abortando" && exit 1
```

---

## Paso 3 — Helper de test

```bash
# Función para ejecutar cada test y mostrar resultado claro
test_endpoint() {
  local LABEL="$1"
  local METHOD="$2"
  local URL="$3"
  local BODY="$4"

  if [ -n "$BODY" ]; then
    RESP=$(curl -s -w "\n__STATUS__%{http_code}" -X "$METHOD" \
      "http://localhost:4001${URL}" \
      -H "Authorization: Bearer ${PATIENT_JWT}" \
      -H "Content-Type: application/json" \
      -d "$BODY")
  else
    RESP=$(curl -s -w "\n__STATUS__%{http_code}" -X "$METHOD" \
      "http://localhost:4001${URL}" \
      -H "Authorization: Bearer ${PATIENT_JWT}")
  fi

  STATUS=$(echo "$RESP" | grep "__STATUS__" | cut -d_ -f3)
  BODY_OUT=$(echo "$RESP" | grep -v "__STATUS__")

  if echo "$STATUS" | grep -qE "^2"; then
    echo "  ✓  $LABEL → $STATUS"
  else
    echo "  ✗  $LABEL → $STATUS"
    echo "     $BODY_OUT" | head -c 200
    echo ""
  fi
}
```

---

## Paso 4 — Validar endpoints del paciente

```bash
echo ""
echo "════════════════════════════════════════════════════════"
echo "SECCIÓN 1: Perfil y configuración"
echo "════════════════════════════════════════════════════════"

test_endpoint "GET  /api/paciente/configuracion" GET "/api/paciente/configuracion"
test_endpoint "PATCH /api/paciente/configuracion (fondo)" PATCH "/api/paciente/configuracion" \
  '{"fondo":"verde"}'
# Restaurar fondo neutro
test_endpoint "PATCH /api/paciente/configuracion (restore)" PATCH "/api/paciente/configuracion" \
  '{"fondo":"neutro"}'

echo ""
echo "════════════════════════════════════════════════════════"
echo "SECCIÓN 2: Agenda del paciente"
echo "════════════════════════════════════════════════════════"

test_endpoint "GET  /api/paciente/citas" GET "/api/paciente/citas"

echo ""
echo "════════════════════════════════════════════════════════"
echo "SECCIÓN 3: Diario de alimentación (r22)"
echo "════════════════════════════════════════════════════════"

test_endpoint "GET  /api/paciente/diario" GET "/api/paciente/diario"
test_endpoint "GET  /api/paciente/diario/hoy" GET "/api/paciente/diario/hoy"

# Crear entrada de diario
HOY=$(date +%Y-%m-%d)
test_endpoint "POST /api/paciente/diario (desayuno)" POST "/api/paciente/diario" \
  "{\"fecha\":\"${HOY}\",\"tipo_comida\":\"desayuno\",\"descripcion\":\"Avena con fruta\",\"kcal\":350}"

echo ""
echo "════════════════════════════════════════════════════════"
echo "SECCIÓN 4: Contador de porciones y biblioteca (r24)"
echo "════════════════════════════════════════════════════════"

# Búsqueda de alimentos
test_endpoint "GET  /api/alimentos/buscar?q=pollo" GET "/api/alimentos/buscar?q=pollo"
test_endpoint "GET  /api/alimentos/buscar?q=arroz" GET "/api/alimentos/buscar?q=arroz"
test_endpoint "GET  /api/alimentos/buscar?q=palta" GET "/api/alimentos/buscar?q=palta"
test_endpoint "GET  /api/alimentos/buscar?q=jitomate" GET "/api/alimentos/buscar?q=jitomate"

# Biblioteca personal del paciente
test_endpoint "GET  /api/paciente/biblioteca" GET "/api/paciente/biblioteca"

# Agregar ítem a diario con porciones (flujo PAC-07)
REGISTRO_HOY_ID=$(psql "$DATABASE_URL" -t -c "
  SELECT id FROM registro_comida
  WHERE paciente_id = '${PACIENTE_ID}'
    AND fecha = CURRENT_DATE
    AND tipo_comida = 'desayuno'
  LIMIT 1;" | tr -d ' \n')

if [ -n "$REGISTRO_HOY_ID" ]; then
  # Obtener un alimento de la biblioteca global para el test
  ALIMENTO_ID=$(psql "$DATABASE_URL" -t -c \
    "SELECT id FROM alimento WHERE activo = true LIMIT 1;" | tr -d ' \n')

  if [ -n "$ALIMENTO_ID" ]; then
    test_endpoint "POST /api/paciente/diario/items (1 porción)" POST "/api/paciente/diario/items" \
      "{\"registro_comida_id\":\"${REGISTRO_HOY_ID}\",\"alimento_id\":\"${ALIMENTO_ID}\",\"porciones\":1.0}"
    test_endpoint "POST /api/paciente/diario/items (½ porción)" POST "/api/paciente/diario/items" \
      "{\"registro_comida_id\":\"${REGISTRO_HOY_ID}\",\"alimento_id\":\"${ALIMENTO_ID}\",\"porciones\":0.5}"
  else
    echo "  ⚠  Sin alimentos en la BD — saltando tests de ítems"
  fi
else
  echo "  ⚠  No se encontró registro de diario de hoy — saltando tests de ítems"
fi

# Agregar a biblioteca personal
if [ -n "$ALIMENTO_ID" ]; then
  test_endpoint "POST /api/paciente/biblioteca (agregar frecuente)" POST "/api/paciente/biblioteca" \
    "{\"alimento_id\":\"${ALIMENTO_ID}\"}"
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo "SECCIÓN 5: Registro de métricas (r23)"
echo "════════════════════════════════════════════════════════"

test_endpoint "GET  /api/paciente/metricas" GET "/api/paciente/metricas"
test_endpoint "GET  /api/paciente/metricas/ultimas" GET "/api/paciente/metricas/ultimas"

# Registrar peso en casa (fuente: paciente)
test_endpoint "POST /api/paciente/metricas (peso en casa)" POST "/api/paciente/metricas" \
  "{\"tipo\":\"peso\",\"valor\":72.5,\"unidad\":\"kg\",\"fecha\":\"${HOY}\",\"fuente\":\"paciente\"}"

# Registrar glucosa
test_endpoint "POST /api/paciente/metricas (glucosa)" POST "/api/paciente/metricas" \
  "{\"tipo\":\"glucosa\",\"valor\":95,\"unidad\":\"mg/dL\",\"fecha\":\"${HOY}\",\"fuente\":\"paciente\"}"

# Presión - orden correcto (sistólica mayor)
test_endpoint "POST /api/paciente/metricas (presión)" POST "/api/paciente/metricas" \
  "{\"tipo\":\"presion_sistolica\",\"valor\":120,\"unidad\":\"mmHg\",\"fecha\":\"${HOY}\",\"fuente\":\"paciente\"}"

echo ""
echo "════════════════════════════════════════════════════════"
echo "SECCIÓN 6: Progreso (r23)"
echo "════════════════════════════════════════════════════════"

test_endpoint "GET  /api/paciente/progreso" GET "/api/paciente/progreso"

echo ""
echo "════════════════════════════════════════════════════════"
echo "SECCIÓN 7: Plan nutricional (lectura)"
echo "════════════════════════════════════════════════════════"

test_endpoint "GET  /api/paciente/plan" GET "/api/paciente/plan"
test_endpoint "GET  /api/paciente/plan/activo" GET "/api/paciente/plan/activo"

echo ""
echo "════════════════════════════════════════════════════════"
echo "SECCIÓN 8: Recordatorios del paciente"
echo "════════════════════════════════════════════════════════"

test_endpoint "GET  /api/paciente/recordatorios" GET "/api/paciente/recordatorios"

echo ""
echo "════════════════════════════════════════════════════════"
echo "SECCIÓN 9: Validaciones de seguridad"
echo "════════════════════════════════════════════════════════"

# Sin token → 401
STATUS_SIN_TOKEN=$(curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:4001/api/paciente/configuracion)
[ "$STATUS_SIN_TOKEN" = "401" ] && \
  echo "  ✓  Sin token → 401 correcto" || \
  echo "  ✗  Sin token → $STATUS_SIN_TOKEN (esperado 401)"

# Token de PROFESIONAL no debe acceder a rutas de paciente
# (si hay un token de profesional disponible en el entorno)
if [ -n "$PROFESSIONAL_JWT" ]; then
  STATUS_PROF=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $PROFESSIONAL_JWT" \
    http://localhost:4001/api/paciente/configuracion)
  [ "$STATUS_PROF" = "403" ] || [ "$STATUS_PROF" = "404" ] && \
    echo "  ✓  Token profesional en ruta paciente → $STATUS_PROF" || \
    echo "  ✗  Token profesional en ruta paciente → $STATUS_PROF (esperado 403/404)"
else
  echo "  ⚠  PROFESSIONAL_JWT no disponible — test de aislamiento saltado"
fi
```

---

## Paso 5 — Resumen en base de datos

```bash
echo ""
echo "════════════════════════════════════════════════════════"
echo "ESTADO DE LA BD TRAS LAS PRUEBAS"
echo "════════════════════════════════════════════════════════"

psql "$DATABASE_URL" -c "
  SELECT
    (SELECT COUNT(*) FROM registro_comida
     WHERE paciente_id = '${PACIENTE_ID}')      AS registros_diario,
    (SELECT COUNT(*) FROM registro_comida_item rc
      JOIN registro_comida r ON r.id = rc.registro_comida_id
     WHERE r.paciente_id = '${PACIENTE_ID}')    AS items_diario,
    (SELECT COUNT(*) FROM registro_metrica
     WHERE paciente_id = '${PACIENTE_ID}')      AS metricas,
    (SELECT COUNT(*) FROM paciente_biblioteca
     WHERE paciente_id = '${PACIENTE_ID}')      AS alimentos_biblioteca;
" 2>/dev/null || \
psql "$DATABASE_URL" -c "
  SELECT
    (SELECT COUNT(*) FROM registro_comida
     WHERE paciente_id = '${PACIENTE_ID}') AS registros_diario,
    (SELECT COUNT(*) FROM registro_metrica
     WHERE paciente_id = '${PACIENTE_ID}') AS metricas;
"
```

---

## Paso 6 — Instrucciones para verificación visual en el navegador

```bash
echo ""
echo "════════════════════════════════════════════════════════"
echo "VERIFICACIÓN VISUAL — abre esto en el navegador:"
echo "════════════════════════════════════════════════════════"
echo ""
echo "  URL:         http://localhost:5175"
echo "  Usuario:     paciente@test.com"
echo "  Contraseña:  Test1234!"
echo ""
echo "Pantallas a verificar manualmente:"
echo "  □ Inicio     — se carga el hero y el resumen del día"
echo "  □ Mis Citas  — muestra el listado de citas agendadas"
echo "  □ Mi Diario  — muestra las franjas y permite agregar comida"
echo "              — buscador de alimentos devuelve resultados"
echo "              — selector de porciones (½ · 1 · 1½ · 2 · 3)"
echo "  □ Mis Registros → Métricas — puede registrar peso, glucosa"
echo "  □ Mis Registros → Progreso — muestra la gráfica SVG de peso"
echo "  □ Mi Plan    — muestra el plan nutricional activo"
echo "  □ Perfil     — (disponible tras ejecutar r25)"
echo ""
echo "Si alguna pantalla lanza error de red, revisar la consola"
echo "del navegador (F12 → Console / Network)."
echo "════════════════════════════════════════════════════════"
```

---

## Paso 7 — Actualizar docs/PRUEBAS.md

Al final del archivo, añade una sección con los resultados de esta sesión:

```bash
cat >> docs/PRUEBAS.md << 'SECTION'

---

## Validación paciente — desbloqueada con nutrismart-patient (r-validacion-paciente)

| Sección | Endpoint | Resultado |
|---------|----------|-----------|
| Perfil | GET /api/paciente/configuracion | — |
| Perfil | PATCH /api/paciente/configuracion | — |
| Agenda | GET /api/paciente/citas | — |
| Diario | GET /api/paciente/diario | — |
| Diario | POST /api/paciente/diario | — |
| PAC-08 | GET /api/alimentos/buscar | — |
| PAC-08 | GET /api/paciente/biblioteca | — |
| PAC-07 | POST /api/paciente/diario/items | — |
| Métricas | GET /api/paciente/metricas | — |
| Métricas | POST /api/paciente/metricas | — |
| Progreso | GET /api/paciente/progreso | — |
| Plan | GET /api/paciente/plan | — |
| Recordatorios | GET /api/paciente/recordatorios | — |
| Seguridad | Sin token → 401 | — |

> Completar la columna Resultado con ✓ / ✗ / N/A según salida del script.
> Pendiente de r25: pantalla de perfil y selector de fondos.
SECTION

echo "docs/PRUEBAS.md actualizado"
```

---

## Notas para interpretar resultados

- **404 en una ruta**: el endpoint existe pero no encontró datos para este
  paciente (normal si no hay citas, plan activo, etc.). No es un error.
- **404 en todas las rutas del paciente**: el middleware no está encontrando
  al paciente por `keycloak_user_id` — verificar que el UUID en Keycloak
  coincide con el de la BD.
- **401 en todas las rutas**: el JWT expiró (válido ~5 min). Repetir el Paso 2.
- **500**: error interno — leer el log de la API para el stack trace.
- Si una ruta devuelve resultados vacíos `[]` o `null` en vez de error,
  es correcto — el paciente de prueba es nuevo y no tiene historial.
