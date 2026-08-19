# --- Build stage ---
FROM node:22-slim AS build
WORKDIR /app

# better-sqlite3 needs build tools if a prebuilt binary isn't available for
# the target platform; python3/make/g++ keep node-gyp's fallback working.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# --- Runtime stage ---
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/db ./db

# Runs as an unprivileged user; the data directory is a mounted volume (see docker-compose.yml).
RUN useradd --create-home --shell /bin/bash botuser \
    && mkdir -p /app/data && chown -R botuser:botuser /app
USER botuser

VOLUME ["/app/data"]
CMD ["node", "dist/index.js"]
