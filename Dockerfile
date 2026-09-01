FROM node:20-alpine

# OCI image labels
LABEL org.opencontainers.image.title="procure-it" \
      org.opencontainers.image.description="IT procurement request management — local web app with HTTPS, SQLite, Excel/DOCX export" \
      org.opencontainers.image.url="https://github.com/DarkyAndSparky/procure-it" \
      org.opencontainers.image.source="https://github.com/DarkyAndSparky/procure-it" \
      org.opencontainers.image.documentation="https://darkyAndsparky.github.io/procure-it" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="26w35-r01"

# Install openssl (cert generation) + su-exec (privilege drop in entrypoint)
RUN apk add --no-cache openssl su-exec

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json ./
# scripts/ нужен ДО npm ci: "prepare"-хук в package.json запускает
# scripts/install-hooks.js, а npm ci выполняет prepare-скрипты. Без этой
# строки сборка образа падает на первом же RUN npm ci — Cannot find module
# 'scripts/install-hooks.js' (найдено при аудите перед первым релизом;
# сам install-hooks.js уже написан безопасно для этого случая — тихо
# завершается, если нет .git, — но найти отсутствующий ФАЙЛ раньше самого
# require он не может).
COPY scripts/ ./scripts/

# Install production deps only
RUN npm ci --omit=dev

# Copy app source
COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/
COPY .env.example ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Create runtime dirs — owned by root initially, entrypoint fixes ownership at runtime
# This allows volume mounts to work regardless of host UID
RUN mkdir -p data/certs data/backups data/signed_specs logs

# Expose HTTPS + HTTP redirect ports
EXPOSE 9111 9112

# Health check — wget is built into alpine
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- --no-check-certificate https://localhost:9111/health || exit 1

# Entrypoint runs as root, fixes volume ownership, then drops to node (UID 1000)
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
