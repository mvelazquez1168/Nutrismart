# ============================================================
# API de NutriSmart
#
# OJO: el contexto de build es la RAÍZ del repo, no apps/api. Hace falta
# el package-lock.json de la raíz para que npm ci reproduzca las mismas
# versiones que en desarrollo. Ver infra/docker-compose.dev.yml.
# ============================================================

# ---------- build ----------
FROM node:24-alpine AS build
WORKDIR /repo

# Los package.json de TODOS los workspaces van antes que el código: npm ci
# valida el lockfile contra ellos y falla si falta alguno. Copiarlos
# aparte también aprovecha la caché de capas: cambiar código fuente no
# vuelve a disparar la instalación.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web-professional/package.json apps/web-professional/
COPY packages/design-system/package.json packages/design-system/

RUN npm ci

COPY tsconfig.base.json ./
COPY apps/api ./apps/api

RUN npm run build -w @nutrismart/api

# ---------- runtime ----------
FROM node:24-alpine AS runtime
WORKDIR /repo

# Deja fuera pino-pretty y las herramientas de compilación.
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web-professional/package.json apps/web-professional/
COPY packages/design-system/package.json packages/design-system/

RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /repo/apps/api/dist ./apps/api/dist

# Los .sql NO se compilan: el runner los lee del disco en tiempo de
# ejecución, así que tienen que viajar en la imagen.
COPY apps/api/migrations ./apps/api/migrations
COPY apps/api/seed ./apps/api/seed

# Sin privilegios de root: la imagen de node ya trae el usuario 'node'.
USER node

WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["node", "dist/server.js"]
