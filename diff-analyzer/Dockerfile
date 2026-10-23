# Chesterton diff-analyzer (Rust + axum). Multi-stage: compile a release
# binary, run it on a small debian base (kept non-distroless so the
# healthcheck can shell out to curl).
FROM rust:1-slim-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/release/diff-analyzer ./diff-analyzer
ENV PORT=4200
EXPOSE 4200
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
    CMD curl -f http://localhost:4200/healthz || exit 1
CMD ["./diff-analyzer"]
