# Chesterton mocks (Node.js + TypeScript): Estelle / GitHub / Slack / Linear
# emulation. Reads seed fixtures from SEED_OUT_DIR (default ../seed/out on
# bare metal; in compose this is mounted at /seed/out, written by the
# one-shot `seed` service into a shared volume -- see infra/docker-compose.yml).
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV SEED_OUT_DIR=/seed/out
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 4100
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
    CMD curl -f http://localhost:4100/healthz || exit 1
CMD ["node", "dist/index.js"]
