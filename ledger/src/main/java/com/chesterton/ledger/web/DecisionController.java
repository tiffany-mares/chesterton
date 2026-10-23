package com.chesterton.ledger.web;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.chesterton.ledger.dto.DecisionRequest;
import com.chesterton.ledger.dto.DecisionResponse;
import com.chesterton.ledger.dto.ImportRequest;
import com.chesterton.ledger.dto.ImportResponse;
import com.chesterton.ledger.service.DecisionService;

import jakarta.validation.Valid;

@RestController
public class DecisionController {

    private final DecisionService decisionService;

    public DecisionController(DecisionService decisionService) {
        this.decisionService = decisionService;
    }

    @PostMapping("/decisions")
    public DecisionResponse create(@Valid @RequestBody DecisionRequest request) {
        return decisionService.create(request);
    }

    @GetMapping("/decisions")
    public List<DecisionResponse> list(
            @RequestParam(required = false) String repo,
            @RequestParam(required = false) String file) {
        return decisionService.list(repo, file);
    }

    @PostMapping("/decisions/import")
    public ImportResponse importFences(@Valid @RequestBody ImportRequest request) {
        return decisionService.importFences(request);
    }
}
