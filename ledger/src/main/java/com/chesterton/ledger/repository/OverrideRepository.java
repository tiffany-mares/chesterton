package com.chesterton.ledger.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.chesterton.ledger.entity.Override;

public interface OverrideRepository extends JpaRepository<Override, Long> {

    long countByVerdictIdIn(List<Long> verdictIds);

    @Query("SELECT o FROM Override o WHERE o.verdictId IN (SELECT v.id FROM Verdict v WHERE v.repo = :repo)")
    List<Override> findByVerdictRepo(@Param("repo") String repo);
}
