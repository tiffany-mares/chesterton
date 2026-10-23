# Chesterton seed (Python). One-shot job: builds seed/out (demo git repo +
# knowledge/slack/linear/prs fixtures) into a shared volume that the mocks
# service reads. Not a long-running service -- no healthcheck, no EXPOSE.
# Run with `docker compose --profile init run --rm seed` or let the `seed`
# service's `depends_on: condition: service_completed_successfully` wiring
# in infra/docker-compose.yml trigger it automatically.
FROM python:3.13-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENTRYPOINT ["python", "seed.py", "--reset", "--out", "/out"]
