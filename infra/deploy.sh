#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  deploy.sh — Despliegue de NutriSmart en producción
#  Ejecutar desde /opt/nutrismart/ en la instancia EC2.
#
#  Uso:
#    chmod +x deploy.sh
#    ./deploy.sh                  # despliega con IMAGE_TAG=latest
#    ./deploy.sh v1.2.3           # despliega una versión específica
# ─────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuración ─────────────────────────────────────────────
ENV_FILE="/opt/nutrismart/.env.prod"
COMPOSE_FILE="/opt/nutrismart/docker-compose.prod.yml"
WORKDIR="/opt/nutrismart"

IMAGE_TAG="${1:-latest}"

# ── Validaciones ──────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ No se encontró $ENV_FILE"
  echo "   Copia .env.prod.example como .env.prod y rellena los valores."
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "❌ No se encontró $COMPOSE_FILE"
  exit 1
fi

# Cargar variables de entorno
set -a
source "$ENV_FILE"
set +a

# Sobreescribir IMAGE_TAG si se pasó como argumento
export IMAGE_TAG

if [[ -z "${ECR_REGISTRY:-}" ]]; then
  echo "❌ ECR_REGISTRY no está definido en $ENV_FILE"
  exit 1
fi

echo "=================================================="
echo "  NutriSmart Deploy"
echo "  Registro ECR : $ECR_REGISTRY"
echo "  Imagen tag   : $IMAGE_TAG"
echo "  Fecha        : $(date '+%Y-%m-%d %H:%M:%S')"
echo "=================================================="

cd "$WORKDIR"

# ── 1. Login en ECR ───────────────────────────────────────────
echo ""
echo "=== [1/6] Autenticando en Amazon ECR ==="
aws ecr get-login-password --region "${AWS_REGION:-us-east-1}" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

# ── 2. Pull de imágenes ───────────────────────────────────────
echo ""
echo "=== [2/6] Descargando imágenes ==="
docker pull "${ECR_REGISTRY}/nutrismart-api:${IMAGE_TAG}"
docker pull "${ECR_REGISTRY}/nutrismart-web-professional:${IMAGE_TAG}"
docker pull "${ECR_REGISTRY}/nutrismart-web-patient:${IMAGE_TAG}"

# ── 3. Detener servicios de aplicación (no la base de datos) ──
echo ""
echo "=== [3/6] Deteniendo contenedores de aplicación ==="
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" \
  stop api web-professional web-patient keycloak || true

# ── 4. Migraciones de base de datos ───────────────────────────
#
# Sin este paso, un servidor nuevo se queda con la base VACIA: la API
# arranca y /health responde 200 (solo hace un 'select 1'), pero todos
# los endpoints devuelven 500 porque no existe ni una tabla. El fallo
# aparenta ser de la aplicacion y en realidad es del despliegue.
#
# Se ejecuta `node dist/migrate.js` y NO `npm run migrate`: ese script
# usa tsx, que es devDependency y no viaja en la imagen de produccion.
#
# El runner es incremental y lleva su tabla de control schema_migrations,
# asi que repetirlo en cada despliegue es inocuo: aplica solo lo nuevo.
echo ""
echo "=== [4/6] Aplicando migraciones ==="

# La base primero y sola: las migraciones tienen que correr ANTES de que
# la API empiece a atender peticiones.
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d db

echo "  Esperando a que Postgres acepte conexiones..."
until [[ "$(docker inspect -f '{{.State.Health.Status}}' nutrismart-db-prod 2>/dev/null)" == "healthy" ]]; do
  sleep 2
done

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" \
  run --rm --no-deps api node dist/migrate.js

# ── 5. Levantar toda la pila ──────────────────────────────────
echo ""
echo "=== [5/6] Levantando servicios ==="
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

# ── 6. Verificar salud de los contenedores ────────────────────
echo ""
echo "=== [6/6] Verificando estado ==="
sleep 10

# Caddy incluido a proposito: es quien publica los puertos 80/443. Si se
# cae, los tres dominios responden 502 y sin comprobarlo el script diria
# "despliegue completado con exito" con el sitio inaccesible.
SERVICES=("nutrismart-db-prod" "nutrismart-keycloak-prod" "nutrismart-api-prod" "nutrismart-web-pro-prod" "nutrismart-web-pat-prod" "nutrismart-caddy-prod")
ALL_OK=true

for CONTAINER in "${SERVICES[@]}"; do
  STATUS=$(docker inspect --format='{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "not_found")
  HEALTH=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$CONTAINER" 2>/dev/null || echo "unknown")

  if [[ "$STATUS" == "running" ]]; then
    echo "  ✅ $CONTAINER → $STATUS ($HEALTH)"
  else
    echo "  ❌ $CONTAINER → $STATUS ($HEALTH)"
    ALL_OK=false
  fi
done

echo ""
if $ALL_OK; then
  echo "✅ Despliegue completado con éxito (tag: ${IMAGE_TAG})"
  echo ""
  echo "   🌐 https://nutrismart.solutechit.com"
  echo "   🌐 https://pacientes-nutrismart.solutechit.com"
  echo "   🔑 https://auth-nutrismart.solutechit.com"
else
  echo "⚠️  Algunos contenedores no están saludables."
  echo "   Revisa los logs con:"
  echo "     docker compose -f $COMPOSE_FILE logs --tail=50 <servicio>"
  exit 1
fi
