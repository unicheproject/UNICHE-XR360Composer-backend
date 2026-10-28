# Build context is this folder. The composer build is optional: pass it as the
# named context `frontend-dist` (a directory holding the built SPA); without it
# the image is API-only.

# --- Stage 1: composer build placeholder, replaced by --build-context frontend-dist=<dir> ---
FROM scratch AS frontend-dist

# --- Stage 2: backend build ---
FROM node:22-alpine AS backend-build
WORKDIR /backend
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Stage 3: runtime ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=backend-build /backend/dist ./dist
COPY src/db/migrations ./migrations
COPY --from=frontend-dist / ./public

ENV MIGRATIONS_DIR=/app/migrations
ENV COMPOSER_DIST=/app/public
ENV PORT=8080

# Media root for STORAGE_DRIVER=local. Must run before USER node: an empty named
# volume takes the mount point's ownership from the image.
RUN mkdir -p /data/media && chown -R node:node /data

EXPOSE 8080
USER node
CMD ["node", "dist/server.js"]
