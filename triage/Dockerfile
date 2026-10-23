# Chesterton triage (Python + FastAPI). Rules-based scoring only -- do NOT
# install requirements-ml.txt (torch) here; see docs/contracts.md and
# task-5-brief.md. Mirrors e2e/run.mjs (`python app.py`), which reads PORT
# and calls uvicorn.run() internally.
FROM python:3.13-slim AS build
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.13-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /install /usr/local
COPY app.py rules.py ./
ENV PORT=4500
EXPOSE 4500
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
    CMD curl -f http://localhost:4500/healthz || exit 1
CMD ["python", "app.py"]
