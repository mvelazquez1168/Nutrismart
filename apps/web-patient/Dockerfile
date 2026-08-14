# ============================================================
# App del paciente (build estático servido por nginx)
#
# Contexto de build: la RAÍZ del repo. Imprescindible, no conveniente:
# la app importa @nutrismart/design-system, que es un workspace hermano
# y no existiría en un contexto limitado a apps/web-patient.
# ============================================================

# ---------- build ----------
FROM node:24-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web-professional/package.json apps/web-professional/
COPY apps/web-patient/package.json apps/web-patient/
COPY packages/design-system/package.json packages/design-system/

RUN npm ci

COPY tsconfig.base.json ./
COPY packages/design-system ./packages/design-system
COPY apps/web-patient ./apps/web-patient

# Las variables VITE_ se resuelven EN EL BUILD, no en runtime: Vite las
# incrusta en el bundle. Por eso llegan como ARG y no por env_file como
# en la API — pasarlas al contenedor en runtime no tendría ningún efecto.
#
# Todas son URLs que resuelve el NAVEGADOR del paciente, no el
# contenedor: van con localhost. nginx aquí solo sirve archivos
# estáticos; quien llama a la API es el móvil, desde fuera de Docker.
ARG VITE_API_URL
ARG VITE_KEYCLOAK_URL
ARG VITE_KEYCLOAK_REALM
ARG VITE_KEYCLOAK_CLIENT_ID_PACIENTE

ENV VITE_API_URL=$VITE_API_URL \
    VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL \
    VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM \
    VITE_KEYCLOAK_CLIENT_ID_PACIENTE=$VITE_KEYCLOAK_CLIENT_ID_PACIENTE

RUN npm run build -w @nutrismart/web-patient

# ---------- runtime ----------
FROM nginx:alpine AS runtime

COPY apps/web-patient/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web-patient/dist /usr/share/nginx/html

EXPOSE 80
