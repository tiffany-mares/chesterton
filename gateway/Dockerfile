# Chesterton gateway (Node.js + TypeScript). Multi-stage: compile TS, run the
# compiled JS on a slim runtime. Mirrors e2e/run.mjs (`npx tsx src/index.ts`
# bare-metal; here we build once and run `node dist/index.js`).
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
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 4000
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
    CMD curl -f http://localhost:4000/healthz || exit 1
CMD ["node", "dist/index.js"]
