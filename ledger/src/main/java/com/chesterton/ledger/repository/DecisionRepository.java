package com.chesterton.ledger.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.chesterton.ledger.entity.Decision;

public interface DecisionRepository extends JpaRepository<Decision, Long> {

    List<Decision> findByRepo(String repo);

    List<Decision> findByRepoAndFile(String repo, String file);

    @Query("SELECT d.file AS file, COUNT(d) AS fenceCount FROM Decision d WHERE d.repo = :repo GROUP BY d.file")
    List<FileFenceCount> countFencesByFile(@Param("repo") String repo);

    interface FileFenceCount {
        String getFile();

        long getFenceCount();
    }
}
