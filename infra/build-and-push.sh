#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  build-and-push.sh — Construye las imágenes propias y las publica en ECR
#
#  Ejecutar desde la RAÍZ del repo (el contexto de build es la raíz:
#  los tres Dockerfile.prod necesitan el package-lock.json y los
#  workspaces hermanos, y el de Keycloak necesita apps/api/keycloak-theme).
#
#  Uso:
#    ./infra/build-and-push.sh <tag> <ecr-registry>
#
#  Ejemplo:
#    ./infra/build-and-push.sh v1.0.0 123456789012.dkr.ecr.us-east-1.amazonaws.com
# ─────────────────────────────────────────────────────────────

set -euo pipefail

TAG="${1:-latest}"
ECR_REGISTRY="${2:?Debes pasar el ECR registry como segundo argumento}"
AWS_REGION="${AWS_REGION:-us-east-1}"

# ── Dominios de producción ────────────────────────────────────
PRO_ORIGIN="https://nutrismart.solutechit.com"
PAC_ORIGIN="https://pacientes-nutrismart.solutechit.com"
KEYCLOAK_URL="https://auth-nutrismart.solutechit.com"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-nutrismart}"

# Los dos clientes del realm son DISTINTOS, y las apps los leen con
# nombres de variable distintos:
#   web-professional → VITE_KEYCLOAK_CLIENT_ID
#   web-patient      → VITE_KEYCLOAK_CLIENT_ID_PACIENTE
KEYCLOAK_CLIENT_ID_PRO="${KEYCLOAK_CLIENT_ID:-nutrismart-web}"
KEYCLOAK_CLIENT_ID_PAC="${KEYCLOAK_CLIENT_ID_PACIENTE:-nutrismart-patient}"

# ── IMPORTANTE: VITE_API_URL va SIN /api ──────────────────────
#
# El cliente de cada app hace fetch(`${VITE_API_URL}${ruta}`) y todas las
# rutas ya empiezan por /api/ (apps/web-professional/src/api/client.ts,
# apps/web-patient/src/lib/api.ts). Con ".../api" aquí, cada petición
# saldría a /api/api/… y respondería 404 — la app compilaría y
# desplegaría igual, y fallaría entera en producción.
#
# Cada app apunta a su PROPIO dominio porque Caddy enruta /api/* al
# contenedor de la API en los dos (ver infra/Caddyfile). Mismo origen:
# sin CORS de por medio.
VITE_API_URL_PRO="$PRO_ORIGIN"
VITE_API_URL_PAC="$PAC_ORIGIN"

echo "=================================================="
echo "  NutriSmart — build & push"
echo "  Registro ECR : $ECR_REGISTRY"
echo "  Imagen tag   : $TAG"
echo "  Región       : $AWS_REGION"
echo "=================================================="

# ── Login en ECR ──────────────────────────────────────────────
echo ""
echo "=== [1/5] Autenticando en Amazon ECR ==="
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

# ── API ───────────────────────────────────────────────────────
echo ""
echo "=== [2/5] API ==="
# INCLUDE_CHROMIUM=false deja la imagen en ~270 MB en lugar de ~1 GB, a
# cambio de que el export del expediente devuelva HTML imprimible en vez
# de PDF. Ver apps/api/Dockerfile.prod.
docker build \
  -f apps/api/Dockerfile.prod \
  --build-arg INCLUDE_CHROMIUM="${INCLUDE_CHROMIUM:-true}" \
  -t "${ECR_REGISTRY}/nutrismart-api:${TAG}" \
  .
docker push "${ECR_REGISTRY}/nutrismart-api:${TAG}"

# ── Web profesional ───────────────────────────────────────────
echo ""
echo "=== [3/5] Web profesional ==="
docker build \
  -f apps/web-professional/Dockerfile.prod \
  --build-arg VITE_API_URL="$VITE_API_URL_PRO" \
  --build-arg VITE_KEYCLOAK_URL="$KEYCLOAK_URL" \
  --build-arg VITE_KEYCLOAK_REALM="$KEYCLOAK_REALM" \
  --build-arg VITE_KEYCLOAK_CLIENT_ID="$KEYCLOAK_CLIENT_ID_PRO" \
  --build-arg VITE_LOGIN_IMAGE_URL="${VITE_LOGIN_IMAGE_URL:-}" \
  -t "${ECR_REGISTRY}/nutrismart-web-professional:${TAG}" \
  .
docker push "${ECR_REGISTRY}/nutrismart-web-professional:${TAG}"

# ── Web paciente ──────────────────────────────────────────────
echo ""
echo "=== [4/5] Web paciente ==="
docker build \
  -f apps/web-patient/Dockerfile.prod \
  --build-arg VITE_API_URL="$VITE_API_URL_PAC" \
  --build-arg VITE_KEYCLOAK_URL="$KEYCLOAK_URL" \
  --build-arg VITE_KEYCLOAK_REALM="$KEYCLOAK_REALM" \
  --build-arg VITE_KEYCLOAK_CLIENT_ID_PACIENTE="$KEYCLOAK_CLIENT_ID_PAC" \
  -t "${ECR_REGISTRY}/nutrismart-web-patient:${TAG}" \
  .
docker push "${ECR_REGISTRY}/nutrismart-web-patient:${TAG}"

# ── Keycloak con el tema ──────────────────────────────────────
echo ""
echo "=== [5/5] Keycloak (tema de NutriSmart) ==="
# Sin --build-arg: el tema son ficheros estáticos y no hay nada que
# parametrizar en tiempo de build.
#
# La imagen pesa lo que la base de Keycloak (~450 MB) porque el tema son
# unos pocos KB encima. Solo cambia cuando cambia el tema, así que la
# capa se reutiliza y el push suele ser casi instantáneo.
docker build \
  -f infra/keycloak/Dockerfile \
  -t "${ECR_REGISTRY}/nutrismart-keycloak:${TAG}" \
  .
docker push "${ECR_REGISTRY}/nutrismart-keycloak:${TAG}"

echo ""
echo "✅ Imágenes publicadas con tag: ${TAG}"
echo ""
echo "   Recuerda que las VITE_* quedan INCRUSTADAS en el bundle:"
echo "   cambiar de dominio o de realm exige reconstruir, no reiniciar."
echo ""
echo "   El tema de Keycloak va DENTRO de su imagen. Para que un cambio"
echo "   del tema se vea hay que recrear el contenedor, no reiniciarlo:"
echo "     docker compose -f <compose> up -d --force-recreate keycloak"
echo "   Y el tema debe estar seleccionado en el realm (Login Theme)."
