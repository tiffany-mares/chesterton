package com.chesterton.ledger.service;

import java.time.Instant;
import java.util.List;
import java.util.NoSuchElementException;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.chesterton.ledger.dto.Citation;
import com.chesterton.ledger.dto.OverrideRequest;
import com.chesterton.ledger.dto.OverrideResponse;
import com.chesterton.ledger.entity.Decision;
import com.chesterton.ledger.entity.Verdict;
import com.chesterton.ledger.repository.DecisionRepository;
import com.chesterton.ledger.repository.OverrideRepository;
import tools.jackson.databind.JsonNode;
import com.chesterton.ledger.entity.Override;
import com.chesterton.ledger.util.JsonUtil;

@Service
public class OverrideService {

    private final OverrideRepository overrideRepository;
    private final VerdictService verdictService;
    private final DecisionRepository decisionRepository;
    private final JsonUtil jsonUtil;

    public OverrideService(OverrideRepository overrideRepository, VerdictService verdictService,
            DecisionRepository decisionRepository, JsonUtil jsonUtil) {
        this.overrideRepository = overrideRepository;
        this.verdictService = verdictService;
        this.decisionRepository = decisionRepository;
        this.jsonUtil = jsonUtil;
    }

    /**
     * Creates the override row and, as a side effect, inserts a new `decision` (source
     * `override`) anchored to the overridden verdict's repo/file/line range so future PRs cite
     * it. File/line come from the verdict's stored Flag JSON payload.
     */
    @Transactional
    public OverrideResponse create(OverrideRequest request) {
        Verdict verdict = verdictService.getEntityOrThrow(request.getVerdictId());

        Override override = new Override();
        override.setVerdictId(verdict.getId());
        override.setReason(request.getReason());
        override.setAuthor(request.getAuthor());
        override.setCreatedAt(Instant.now());
        override = overrideRepository.save(override);

        createOverrideDecision(verdict, request);

        return toResponse(override, verdict);
    }

    private void createOverrideDecision(Verdict verdict, OverrideRequest request) {
        JsonNode flag = jsonUtil.readNode(verdict.getPayloadJson());
        String file = flag != null && flag.hasNonNull("file") ? flag.get("file").asText() : null;
        Integer line = flag != null && flag.hasNonNull("line") ? flag.get("line").asInt() : null;

        Decision decision = new Decision();
        decision.setRepo(verdict.getRepo());
        decision.setFile(file);
        decision.setLineStart(line);
        decision.setLineEnd(line);
        decision.setSummary(request.getReason());
        decision.setCitationsJson(jsonUtil.writeCitations(List.of(
                new Citation("override", "", "Reviewer override by " + request.getAuthor()))));
        decision.setSource("override");
        decision.setCreatedAt(Instant.now());
        decisionRepository.save(decision);
    }

    @Transactional(readOnly = true)
    public List<OverrideResponse> list(String repo) {
        List<Override> overrides = repo == null
                ? overrideRepository.findAll()
                : overrideRepository.findByVerdictRepo(repo);
        return overrides.stream()
                .map(o -> toResponse(o, verdictService.getEntityOrThrow(o.getVerdictId())))
                .toList();
    }

    private OverrideResponse toResponse(Override override, Verdict verdict) {
        return new OverrideResponse(
                override.getId(),
                override.getVerdictId(),
                override.getReason(),
                override.getAuthor(),
                override.getCreatedAt(),
                verdictService.toResponse(verdict));
    }
}
