package com.chesterton.ledger.entity;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.ForeignKey;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

/**
 * Mirrors the `verdict` table in docs/build_plan.md Phase 5. Unique on (repo, head_sha,
 * hunk_hash) so POST /verdicts upserts rather than duplicating rows. `payloadJson` holds the
 * full Flag JSON verbatim (opaque to the ledger) as serialized JSON text.
 */
@Entity
@Table(name = "verdict", uniqueConstraints = {
        @UniqueConstraint(name = "uk_verdict_repo_head_sha_hunk_hash", columnNames = {"repo", "head_sha", "hunk_hash"})
})
public class Verdict {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String repo;

    private Integer pr;

    @Column(name = "head_sha")
    private String headSha;

    @Column(name = "hunk_hash")
    private String hunkHash;

    @Column(name = "decision_id")
    private Long decisionId;

    /**
     * Read-only shadow mapping of the same {@code decision_id} column, present solely so
     * Hibernate's schema generation emits {@code decision_id INT REFERENCES decision} (the plan's
     * SQL, docs/build_plan.md Phase 5) as a real FK constraint. All application code reads/writes
     * the plain {@link #decisionId} field above; this association is never set or navigated, so
     * the wire JSON (a bare {@code decision_id} number) is unaffected.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "decision_id", referencedColumnName = "id", insertable = false, updatable = false,
            foreignKey = @ForeignKey(name = "fk_verdict_decision_id"))
    private Decision decision;

    private String verdict;

    @Column(name = "payload", columnDefinition = "text")
    private String payloadJson;

    @Column(name = "created_at")
    private Instant createdAt;

    public Verdict() {
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getRepo() {
        return repo;
    }

    public void setRepo(String repo) {
        this.repo = repo;
    }

    public Integer getPr() {
        return pr;
    }

    public void setPr(Integer pr) {
        this.pr = pr;
    }

    public String getHeadSha() {
        return headSha;
    }

    public void setHeadSha(String headSha) {
        this.headSha = headSha;
    }

    public String getHunkHash() {
        return hunkHash;
    }

    public void setHunkHash(String hunkHash) {
        this.hunkHash = hunkHash;
    }

    public Long getDecisionId() {
        return decisionId;
    }

    public void setDecisionId(Long decisionId) {
        this.decisionId = decisionId;
    }

    public String getVerdict() {
        return verdict;
    }

    public void setVerdict(String verdict) {
        this.verdict = verdict;
    }

    public String getPayloadJson() {
        return payloadJson;
    }

    public void setPayloadJson(String payloadJson) {
        this.payloadJson = payloadJson;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
