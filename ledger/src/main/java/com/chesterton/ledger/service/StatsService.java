package com.chesterton.ledger.service;

import java.util.List;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.chesterton.ledger.dto.StatsResponse;
import com.chesterton.ledger.entity.Verdict;
import com.chesterton.ledger.repository.OverrideRepository;
import com.chesterton.ledger.repository.VerdictRepository;

@Service
public class StatsService {

    private final VerdictRepository verdictRepository;
    private final OverrideRepository overrideRepository;

    public StatsService(VerdictRepository verdictRepository, OverrideRepository overrideRepository) {
        this.verdictRepository = verdictRepository;
        this.overrideRepository = overrideRepository;
    }

    @Transactional(readOnly = true)
    public StatsResponse stats(String repo) {
        long verdictsTotal = verdictRepository.countByRepo(repo);
        long flagsTotal = verdictRepository.countByRepoAndVerdict(repo, "YES");

        List<Long> verdictIds = verdictRepository.findByRepo(repo).stream().map(Verdict::getId).toList();
        long overridesTotal = verdictIds.isEmpty() ? 0L : overrideRepository.countByVerdictIdIn(verdictIds);

        double falsePositiveRate = flagsTotal == 0 ? 0.0 : (double) overridesTotal / (double) flagsTotal;

        return new StatsResponse(verdictsTotal, flagsTotal, overridesTotal, falsePositiveRate);
    }
}
