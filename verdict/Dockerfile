# Chesterton verdict (Go). Multi-stage: compile a static-ish binary, run it
# on a small debian base (kept non-distroless so the healthcheck can shell
# out to curl). Env vars (ESTELLE_URL, GITHUB_API_URL, LEDGER_URL, REDIS_URL)
# are all optional per docs/contracts.md and are set by infra/docker-compose.yml.
FROM golang:1.26-bookworm AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /verdict .

FROM debian:bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /verdict ./verdict
ENV PORT=4300
EXPOSE 4300
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
    CMD curl -f http://localhost:4300/healthz || exit 1
CMD ["./verdict"]
