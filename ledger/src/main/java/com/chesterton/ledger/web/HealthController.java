package com.chesterton.ledger.web;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Blanket requirement in docs/contracts.md: "Every HTTP service exposes GET /healthz". */
@RestController
public class HealthController {

    @GetMapping("/healthz")
    public Map<String, Object> healthz() {
        return Map.of("ok", true, "service", "ledger");
    }
}
