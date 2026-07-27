FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci


FROM dependencies AS build

WORKDIR /app

COPY tsconfig.json tsconfig.build.json tsconfig.seed.json ./
COPY nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

RUN npx prisma generate
RUN npm run build


FROM node:22-bookworm-slim AS production

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

RUN mkdir -p \
      /app/public/properties \
      /app/public/flags \
      /app/storage/private \
    && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "dist/src/main.js"]
