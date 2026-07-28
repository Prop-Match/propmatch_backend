# ---- PropMatch backend (NestJS 11 + Prisma 7) — production image ----

# 1. Build stage: install deps, generate the Prisma client, compile Nest + the seed.
FROM node:22-bookworm-slim AS builder
ENV NODE_ENV=development
WORKDIR /app

# openssl is needed by the Prisma CLI (schema engine) during generate/db push.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Install deps first for better layer caching. prisma.config.ts + prisma/ are
# copied up-front because a postinstall may invoke `prisma generate`.
# npm install (not `npm ci`): the committed lock file is resolved on Windows and
# can omit Linux-only transitive deps, which makes strict `npm ci` fail here.
COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm install --no-audit --no-fund

# Bring in the rest of the source and produce the runtime artifacts.
COPY . .
RUN npx prisma generate \
    && npm run build \
    && npx tsc -p tsconfig.seed.json

# 2. Runtime stage: only what is needed to run + migrate + seed.
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/.seed-build ./.seed-build
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/tsconfig*.json ./
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
