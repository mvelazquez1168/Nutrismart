#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  setup-server.sh — Configuración inicial del servidor
#  Ejecutar UNA SOLA VEZ en la instancia EC2 recién creada.
#  Ubuntu 24.04 LTS (x86_64)
#
#  Uso:
#    chmod +x setup-server.sh
#    sudo ./setup-server.sh
# ─────────────────────────────────────────────────────────────

set -euo pipefail

echo "=== [1/5] Actualizando sistema ==="
apt-get update && apt-get upgrade -y

echo "=== [2/5] Instalando Docker ==="
apt-get install -y ca-certificates curl gnupg lsb-release

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable docker
systemctl start docker

# Añadir usuario ubuntu al grupo docker
usermod -aG docker ubuntu

# Caddy ya NO se instala aqui: corre como contenedor (servicio `caddy`
# del docker-compose.prod.yml), dentro de la red nutrismart_net, que es
# la unica forma de que resuelva web-professional:80, api:4000 y
# keycloak:8080. Instalarlo tambien por apt dejaria un segundo Caddy
# ocupando los puertos 80 y 443, y el del contenedor no podria arrancar.

echo "=== [3/4] Instalando AWS CLI ==="
apt-get install -y unzip
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip -q awscliv2.zip
./aws/install
rm -rf awscliv2.zip aws/

echo "=== [4/4] Creando estructura de directorios ==="
mkdir -p /opt/nutrismart

# /var/log/caddy ya no se crea aqui: los logs van al volumen
# nutrismart_caddy_logs, dentro del contenedor. El `chown caddy:caddy`
# que habia antes ahora FALLARIA —ese usuario lo creaba el paquete apt
# que acabamos de quitar— y con `set -e` abortaria todo el script.

echo ""
echo "✅ Servidor configurado. Próximos pasos:"
echo "   1. Sube docker-compose.prod.yml, .env.prod, Caddyfile e init-db.sql a /opt/nutrismart/"
echo "      El Caddyfile se queda AHI: el compose lo monta en el contenedor."
echo "   2. Configura las credenciales AWS: aws configure"
echo "   3. Abre los puertos 80 y 443 en el security group de la instancia"
echo "      (sin el 80 no se puede emitir el certificado TLS)"
echo "   4. Ejecuta deploy.sh para el primer despliegue"
