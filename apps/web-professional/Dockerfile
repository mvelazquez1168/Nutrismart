# ============================================================
# App del nutricionista (build estático servido por nginx)
#
# Contexto de build: la RAÍZ del repo. Aquí es imprescindible, no solo
# conveniente: la app importa @nutrismart/design-system, que es un
# workspace hermano y no existiría en un contexto limitado a
# apps/web-professional.
# ============================================================

# ---------- build ----------
FROM node:24-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web-professional/package.json apps/web-professional/
COPY packages/design-system/package.json packages/design-system/

RUN npm ci

COPY tsconfig.base.json ./
COPY packages/design-system ./packages/design-system
COPY apps/web-professional ./apps/web-professional

# Las variables VITE_ se resuelven EN EL BUILD, no en runtime: Vite las
# incrusta en el bundle. Por eso llegan como ARG y no por env_file como
# en la API — pasarlas al contenedor en runtime no tendría ningún efecto.
#
# Consecuencia: cambiar de entorno (dev, staging, producción) exige
# reconstruir la imagen, no basta con reiniciarla.
ARG VITE_API_URL
ARG VITE_KEYCLOAK_URL
ARG VITE_KEYCLOAK_REALM
ARG VITE_KEYCLOAK_CLIENT_ID

ENV VITE_API_URL=$VITE_API_URL \
    VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL \
    VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM \
    VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID

RUN npm run build -w @nutrismart/web-professional

# ---------- runtime ----------
FROM nginx:alpine AS runtime

COPY apps/web-professional/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web-professional/dist /usr/share/nginx/html

EXPOSE 80
