package com.chesterton.ledger.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

/**
 * Unit tests for the DATABASE_URL -> spring.datasource.* translation (docs/contracts.md
 * DATABASE_URL format), without needing a live Postgres server.
 */
class DatabaseUrlEnvironmentPostProcessorTest {

    private final DatabaseUrlEnvironmentPostProcessor processor = new DatabaseUrlEnvironmentPostProcessor();

    @Test
    void translatesPostgresUrlWhenPostgresProfileActive() {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles("postgres");
        environment.setProperty("DATABASE_URL", "postgres://chesterton:chesterton@localhost:5432/chesterton");

        processor.postProcessEnvironment(environment, null);

        assertThat(environment.getProperty("spring.datasource.url"))
                .isEqualTo("jdbc:postgresql://localhost:5432/chesterton");
        assertThat(environment.getProperty("spring.datasource.username")).isEqualTo("chesterton");
        assertThat(environment.getProperty("spring.datasource.password")).isEqualTo("chesterton");
    }

    @Test
    void leavesDatasourcePropertiesAloneWhenPostgresProfileNotActive() {
        MockEnvironment environment = new MockEnvironment();
        // No active profile -> default H2 profile; DATABASE_URL must NOT be applied even if
        // present in the ambient shell environment (so `./mvnw test` stays DB-agnostic).
        environment.setProperty("DATABASE_URL", "postgres://chesterton:chesterton@localhost:5432/chesterton");

        processor.postProcessEnvironment(environment, null);

        assertThat(environment.getProperty("spring.datasource.url")).isNull();
    }

    @Test
    void leavesDatasourcePropertiesAloneWhenDatabaseUrlMissing() {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles("postgres");

        processor.postProcessEnvironment(environment, null);

        assertThat(environment.getProperty("spring.datasource.url")).isNull();
    }

    @Test
    void leavesDatasourcePropertiesAloneForMalformedDatabaseUrl() {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles("postgres");
        environment.setProperty("DATABASE_URL", "postgres://not a valid url");

        processor.postProcessEnvironment(environment, null);

        assertThat(environment.getProperty("spring.datasource.url")).isNull();
    }
}
