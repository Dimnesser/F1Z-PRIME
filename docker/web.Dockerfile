# Builds the Mini App and the admin panel and serves them with Caddy (build context: repository root)
FROM node:22-alpine AS miniapp
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine AS admin
WORKDIR /build
COPY admin/package.json admin/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY admin/ ./
RUN npm run build

FROM caddy:2.8-alpine
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=miniapp /build/dist /srv/miniapp
COPY --from=admin /build/dist /srv/admin
