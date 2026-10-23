package com.chesterton.ledger.web;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.chesterton.ledger.dto.FenceByFileResponse;
import com.chesterton.ledger.service.DecisionService;

@RestController
public class FenceController {

    private final DecisionService decisionService;

    public FenceController(DecisionService decisionService) {
        this.decisionService = decisionService;
    }

    @GetMapping("/fences/by-file")
    public List<FenceByFileResponse> byFile(@RequestParam String repo) {
        return decisionService.fencesByFile(repo);
    }
}
