package com.chesterton.ledger.web;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.chesterton.ledger.dto.VerdictRequest;
import com.chesterton.ledger.dto.VerdictResponse;
import com.chesterton.ledger.service.VerdictService;

import jakarta.validation.Valid;

@RestController
public class VerdictController {

    private final VerdictService verdictService;

    public VerdictController(VerdictService verdictService) {
        this.verdictService = verdictService;
    }

    @PostMapping("/verdicts")
    public VerdictResponse upsert(@Valid @RequestBody VerdictRequest request) {
        return verdictService.upsert(request);
    }

    @GetMapping("/verdicts")
    public List<VerdictResponse> list(
            @RequestParam(required = false) String repo,
            @RequestParam(required = false) Integer pr) {
        return verdictService.list(repo, pr);
    }
}
