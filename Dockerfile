FROM node:20-alpine

# OCI image labels — shown in GitHub Packages and Docker Hub
LABEL org.opencontainers.image.title="procure-it" \
      org.opencontainers.image.description="IT procurement request management — local web app with HTTPS, SQLite, Excel/DOCX export" \
      org.opencontainers.image.url="https://github.com/DarkyAndSparky/procure-it" \
      org.opencontainers.image.source="https://github.com/DarkyAndSparky/procure-it" \
      org.opencontainers.image.documentation="https://darkyAndsparky.github.io/procure-it" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="26w31-b01"

# Install openssl for cert generation
RUN apk add --no-cache openssl

WORKDIR /app

# Copy package files first (layer caching)
COPY package.json package-lock.json ./

# Install production deps only
RUN npm ci --omit=dev

# Copy app source (docs/ excluded via .dockerignore — it's for GitHub Pages only)
COPY server.js ./
COPY public/ ./public/
COPY .env.example ./

# Create required runtime dirs with correct ownership
RUN mkdir -p data/certs data/backups logs && \
    addgroup -S procure && adduser -S procure -G procure && \
    chown -R procure:procure /app

USER procure

# Expose HTTPS port + HTTP redirect port
EXPOSE 9111 9112

# Health check — start_period matches docker-compose.yml
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- --no-check-certificate https://localhost:9111/health || exit 1

CMD ["node", "server.js"]
