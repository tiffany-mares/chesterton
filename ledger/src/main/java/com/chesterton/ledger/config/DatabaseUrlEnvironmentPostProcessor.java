package com.chesterton.ledger.config;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.HashMap;
import java.util.Map;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/**
 * Translates the shared {@code DATABASE_URL=postgres://user:pass@host:port/db} env var
 * (see docs/contracts.md) into the {@code spring.datasource.*} properties Spring expects,
 * but only when the {@code postgres} profile is active. This keeps the default H2 profile
 * (used by {@code ./mvnw test} and bare-metal dev) immune to an ambient DATABASE_URL env var.
 *
 * If DATABASE_URL is absent or not a postgres:// URL, nothing happens and
 * application-postgres.properties' own spring.datasource.* defaults (overridable via
 * SPRING_DATASOURCE_URL/USERNAME/PASSWORD) apply instead.
 */
public class DatabaseUrlEnvironmentPostProcessor implements EnvironmentPostProcessor {

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        if (!isPostgresProfileActive(environment)) {
            return;
        }
        String databaseUrl = environment.getProperty("DATABASE_URL");
        if (databaseUrl == null || databaseUrl.isBlank()) {
            return;
        }
        if (!databaseUrl.startsWith("postgres://") && !databaseUrl.startsWith("postgresql://")) {
            return;
        }

        try {
            // java.net.URI chokes on the "postgres" scheme for host/userInfo parsing in some JDKs;
            // normalize to a scheme it fully understands before parsing.
            URI uri = new URI("postgresql://" + databaseUrl.substring(databaseUrl.indexOf("://") + 3));

            Map<String, Object> props = new HashMap<>();
            String userInfo = uri.getUserInfo();
            if (userInfo != null) {
                String[] parts = userInfo.split(":", 2);
                props.put("spring.datasource.username", parts[0]);
                props.put("spring.datasource.password", parts.length > 1 ? parts[1] : "");
            }

            String host = uri.getHost();
            int port = uri.getPort() == -1 ? 5432 : uri.getPort();
            String path = uri.getPath() == null ? "" : uri.getPath();
            props.put("spring.datasource.url", "jdbc:postgresql://" + host + ":" + port + path);

            environment.getPropertySources().addFirst(new MapPropertySource("databaseUrl", props));
        } catch (URISyntaxException e) {
            // Malformed DATABASE_URL: leave spring.datasource.* alone so the JDBC env
            // alternative (SPRING_DATASOURCE_URL/USERNAME/PASSWORD) can still work.
        }
    }

    private boolean isPostgresProfileActive(ConfigurableEnvironment environment) {
        for (String profile : environment.getActiveProfiles()) {
            if ("postgres".equals(profile)) {
                return true;
            }
        }
        return false;
    }
}
