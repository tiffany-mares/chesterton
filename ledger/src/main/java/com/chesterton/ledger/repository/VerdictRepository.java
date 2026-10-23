package com.chesterton.ledger.repository;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

import com.chesterton.ledger.entity.Verdict;

public interface VerdictRepository extends JpaRepository<Verdict, Long> {

    Optional<Verdict> findByRepoAndHeadShaAndHunkHash(String repo, String headSha, String hunkHash);

    List<Verdict> findByRepo(String repo);

    List<Verdict> findByRepoAndPr(String repo, Integer pr);

    long countByRepo(String repo);

    long countByRepoAndVerdict(String repo, String verdict);
}
