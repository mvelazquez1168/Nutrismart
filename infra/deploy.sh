#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  NutriSmart — Deploy de producción
#  Uso: ./infra/deploy.sh   (desde la raíz del repo en EC2)
# ─────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INFRA_DIR="/opt/nutrismart"
ENV_FILE="$INFRA_DIR/.env.prod"
COMPOSE_FILE="$INFRA_DIR/docker-compose.prod.yml"

export $(grep -E "^(ECR_REGISTRY|IMAGE_TAG|VITE_)" "$ENV_FILE" | xargs)

AWS_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

echo "╔══════════════════════════════════════╗"
echo "║  NutriSmart · Deploy $(date '+%Y-%m-%d %H:%M')  ║"
echo "╚══════════════════════════════════════╝"

echo -e "\n▶ git pull..."
cd "$REPO_DIR" && git pull

echo -e "\n▶ Login ECR..."
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

echo -e "\n▶ Build API..."
docker build -f "$REPO_DIR/apps/api/Dockerfile.prod" \
  -t "$ECR_REGISTRY/nutrismart-api:$IMAGE_TAG" "$REPO_DIR"

echo -e "\n▶ Build web-professional..."
docker build \
  --build-arg VITE_API_URL="$VITE_API_URL" \
  --build-arg VITE_KEYCLOAK_URL="$VITE_KEYCLOAK_URL" \
  --build-arg VITE_KEYCLOAK_REALM="$VITE_KEYCLOAK_REALM" \
  --build-arg VITE_KEYCLOAK_CLIENT_ID="$VITE_KEYCLOAK_CLIENT_ID" \
  -f "$REPO_DIR/apps/web-professional/Dockerfile.prod" \
  -t "$ECR_REGISTRY/nutrismart-web-professional:$IMAGE_TAG" "$REPO_DIR"

echo -e "\n▶ Push API..."
docker push "$ECR_REGISTRY/nutrismart-api:$IMAGE_TAG"

echo -e "\n▶ Push web-professional..."
docker push "$ECR_REGISTRY/nutrismart-web-professional:$IMAGE_TAG"

echo -e "\n▶ Recreando contenedores..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" \
  up -d --no-deps --force-recreate api web-professional

echo -e "\n▶ Verificando API (espera 8s)..."
sleep 8
docker exec nutrismart-api-prod curl -sf http://localhost:4000/health \
  && echo "✓ API OK" \
  || echo "⚠ API aún iniciando — docker logs nutrismart-api-prod"

echo -e "\n✓ Deploy completo."
