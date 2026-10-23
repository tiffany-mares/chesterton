# Chesterton ledger (Spring Boot). Multi-stage: build the fat jar with the
# Maven wrapper (matches `./mvnw test` used everywhere else), run it on a
# small JRE. Defaults to the H2 in-memory profile; set
# SPRING_PROFILES_ACTIVE=postgres + DATABASE_URL to use Postgres (see
# docs/contracts.md and infra/docker-compose.yml).
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY mvnw ./
COPY .mvn ./.mvn
COPY pom.xml ./
RUN chmod +x mvnw && ./mvnw -q -B dependency:go-offline
COPY src ./src
RUN ./mvnw -q -B -DskipTests package

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/*.jar app.jar
EXPOSE 4400
HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=15 \
    CMD curl -f http://localhost:4400/healthz || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
