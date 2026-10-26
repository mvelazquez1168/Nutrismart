# ─────────────────────────────────────────────────────────────
#  Keycloak con el tema de NutriSmart horneado dentro.
#
#  Construir SIEMPRE con el contexto en la RAÍZ del repo:
#
#      docker build -f infra/keycloak/Dockerfile -t nutrismart-keycloak .
#
#  El tema vive en `apps/api/keycloak-theme/`, fuera de esta carpeta, y
#  un contexto en `infra/keycloak/` no lo alcanzaría: Docker no deja
#  copiar nada que esté por encima del contexto. Es el mismo criterio
#  que ya usan los tres Dockerfile.prod del repo, que necesitan la raíz
#  por los workspaces de npm.
#
#  ── Por qué una imagen y no un volumen ──────────────────────────────
#
#  Montar la carpeta del host funcionaba en desarrollo, pero deja el
#  tema fuera del artefacto que se despliega: el servidor tendría que
#  tener una copia del repo en el sitio exacto, y un `docker compose up`
#  en una máquina limpia arrancaría un Keycloak sin tema y con el login
#  genérico. Dentro de la imagen, lo que se despliega ya lo lleva.
# ─────────────────────────────────────────────────────────────
FROM quay.io/keycloak/keycloak:26.3

# El tema completo: login.ftl, su CSS, y los textos en español.
#
# Sin `kc.sh build` a propósito. Esa augmentación hace falta para
# proveedores y features, no para temas; y correrla aquí congelaría el
# vendor de base de datos en la imagen, cuando `KC_DB` llega por entorno
# en tiempo de ejecución (ver docker-compose.prod.yml). El arranque la
# resuelve solo.
COPY apps/api/keycloak-theme/nutrismart /opt/keycloak/themes/nutrismart

# Recordatorio para quien venga detrás: copiar el tema NO lo activa. Hay
# que seleccionarlo en el realm —Realm Settings → Themes → Login Theme →
# `nutrismart`, o por la API de administración—. Es una sola vez por
# realm y sobrevive a los despliegues, porque vive en la base de datos.
#
# Y en modo `start` (producción) Keycloak CACHEA los temas: cambiar el
# login.ftl o el CSS exige reconstruir la imagen y recrear el
# contenedor. Un `restart` del contenedor viejo no trae nada nuevo.
