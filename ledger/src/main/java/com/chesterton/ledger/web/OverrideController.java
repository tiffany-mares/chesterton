package com.chesterton.ledger.web;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.chesterton.ledger.dto.OverrideRequest;
import com.chesterton.ledger.dto.OverrideResponse;
import com.chesterton.ledger.service.OverrideService;

import jakarta.validation.Valid;

@RestController
public class OverrideController {

    private final OverrideService overrideService;

    public OverrideController(OverrideService overrideService) {
        this.overrideService = overrideService;
    }

    @PostMapping("/overrides")
    public OverrideResponse create(@Valid @RequestBody OverrideRequest request) {
        return overrideService.create(request);
    }

    @GetMapping("/overrides")
    public List<OverrideResponse> list(@RequestParam(required = false) String repo) {
        return overrideService.list(repo);
    }
}
