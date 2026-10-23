# Chesterton dashboard (React + TypeScript + Vite). Multi-stage: build the
# static bundle, serve it with `vite preview` (no nginx needed for a demo
# stack). GATEWAY_URL is read at build time via VITE_GATEWAY_URL (compiled
# into the client bundle, since it is fetched from the browser, not from
# inside the container) -- default is http://localhost:4000, which matches
# the gateway's published compose port.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_GATEWAY_URL=http://localhost:4000
ENV VITE_GATEWAY_URL=$VITE_GATEWAY_URL
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/vite.config.ts ./vite.config.ts
COPY --from=build /app/dist ./dist
EXPOSE 4600
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
    CMD curl -f http://localhost:4600/ || exit 1
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4600"]
