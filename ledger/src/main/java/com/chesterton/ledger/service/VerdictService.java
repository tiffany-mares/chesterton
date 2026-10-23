package com.chesterton.ledger.service;

import java.time.Instant;
import java.util.List;
import java.util.NoSuchElementException;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.chesterton.ledger.dto.VerdictRequest;
import com.chesterton.ledger.dto.VerdictResponse;
import com.chesterton.ledger.entity.Verdict;
import com.chesterton.ledger.repository.VerdictRepository;
import com.chesterton.ledger.util.JsonUtil;

@Service
public class VerdictService {

    private final VerdictRepository verdictRepository;
    private final JsonUtil jsonUtil;

    public VerdictService(VerdictRepository verdictRepository, JsonUtil jsonUtil) {
        this.verdictRepository = verdictRepository;
        this.jsonUtil = jsonUtil;
    }

    /** Upsert on (repo, head_sha, hunk_hash) per docs/contracts.md "POST /verdicts". */
    @Transactional
    public VerdictResponse upsert(VerdictRequest request) {
        Verdict verdict = verdictRepository
                .findByRepoAndHeadShaAndHunkHash(request.getRepo(), request.getHeadSha(), request.getHunkHash())
                .orElseGet(Verdict::new);

        verdict.setRepo(request.getRepo());
        verdict.setPr(request.getPr());
        verdict.setHeadSha(request.getHeadSha());
        verdict.setHunkHash(request.getHunkHash());
        verdict.setDecisionId(request.getDecisionId());
        verdict.setVerdict(request.getVerdict());
        verdict.setPayloadJson(jsonUtil.writeNode(request.getPayload()));
        if (verdict.getId() == null) {
            verdict.setCreatedAt(Instant.now());
        }

        return toResponse(verdictRepository.save(verdict));
    }

    @Transactional(readOnly = true)
    public List<VerdictResponse> list(String repo, Integer pr) {
        List<Verdict> verdicts;
        if (repo != null && pr != null) {
            verdicts = verdictRepository.findByRepoAndPr(repo, pr);
        } else if (repo != null) {
            verdicts = verdictRepository.findByRepo(repo);
        } else {
            verdicts = verdictRepository.findAll();
        }
        return verdicts.stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public Verdict getEntityOrThrow(Long id) {
        return verdictRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("No verdict with id " + id));
    }

    VerdictResponse toResponse(Verdict verdict) {
        return new VerdictResponse(
                verdict.getId(),
                verdict.getRepo(),
                verdict.getPr(),
                verdict.getHeadSha(),
                verdict.getHunkHash(),
                verdict.getDecisionId(),
                verdict.getVerdict(),
                jsonUtil.readNode(verdict.getPayloadJson()),
                verdict.getCreatedAt());
    }
}
