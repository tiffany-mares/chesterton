package com.chesterton.ledger.service;

import java.time.Instant;
import java.util.List;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.chesterton.ledger.dto.DecisionRequest;
import com.chesterton.ledger.dto.DecisionResponse;
import com.chesterton.ledger.dto.FenceByFileResponse;
import com.chesterton.ledger.dto.ImportRequest;
import com.chesterton.ledger.dto.ImportResponse;
import com.chesterton.ledger.entity.Decision;
import com.chesterton.ledger.repository.DecisionRepository;
import com.chesterton.ledger.util.JsonUtil;

@Service
public class DecisionService {

    private final DecisionRepository decisionRepository;
    private final JsonUtil jsonUtil;

    public DecisionService(DecisionRepository decisionRepository, JsonUtil jsonUtil) {
        this.decisionRepository = decisionRepository;
        this.jsonUtil = jsonUtil;
    }

    @Transactional
    public DecisionResponse create(DecisionRequest request) {
        Decision decision = new Decision();
        decision.setRepo(request.getRepo());
        decision.setFile(request.getFile());
        decision.setLineStart(request.getLineStart());
        decision.setLineEnd(request.getLineEnd());
        decision.setSummary(request.getSummary());
        decision.setCitationsJson(jsonUtil.writeCitations(request.getCitations()));
        decision.setSource(request.getSource());
        decision.setCreatedAt(Instant.now());
        return toResponse(decisionRepository.save(decision));
    }

    @Transactional(readOnly = true)
    public List<DecisionResponse> list(String repo, String file) {
        List<Decision> decisions;
        if (repo != null && file != null) {
            decisions = decisionRepository.findByRepoAndFile(repo, file);
        } else if (repo != null) {
            decisions = decisionRepository.findByRepo(repo);
        } else {
            decisions = decisionRepository.findAll();
        }
        return decisions.stream().map(this::toResponse).toList();
    }

    @Transactional
    public ImportResponse importFences(ImportRequest request) {
        int count = 0;
        for (ImportRequest.Fence fence : request.getFences()) {
            Decision decision = new Decision();
            decision.setRepo(request.getRepo());
            decision.setFile(fence.getFile());
            decision.setLineStart(fence.getLineStart());
            decision.setLineEnd(fence.getLineEnd());
            decision.setSummary(fence.getSummary());
            decision.setCitationsJson(jsonUtil.writeCitations(fence.getCitations()));
            decision.setSource("seed");
            decision.setCreatedAt(Instant.now());
            decisionRepository.save(decision);
            count++;
        }
        return new ImportResponse(request.getRepo(), count);
    }

    @Transactional(readOnly = true)
    public List<FenceByFileResponse> fencesByFile(String repo) {
        return decisionRepository.countFencesByFile(repo).stream()
                .map(row -> new FenceByFileResponse(row.getFile(), row.getFenceCount(), 0L))
                .toList();
    }

    DecisionResponse toResponse(Decision decision) {
        return new DecisionResponse(
                decision.getId(),
                decision.getRepo(),
                decision.getFile(),
                decision.getLineStart(),
                decision.getLineEnd(),
                decision.getSummary(),
                jsonUtil.readCitations(decision.getCitationsJson()),
                decision.getSource(),
                decision.getCreatedAt());
    }
}
