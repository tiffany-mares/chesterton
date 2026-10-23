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

/** Mirrors the `override` table in docs/build_plan.md Phase 5. */
@Entity
@Table(name = "override_row")
public class Override {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "verdict_id")
    private Long verdictId;

    /**
     * Read-only shadow mapping of the same {@code verdict_id} column, present solely so
     * Hibernate's schema generation emits {@code verdict_id INT REFERENCES verdict} (the plan's
     * SQL, docs/build_plan.md Phase 5) as a real FK constraint. All application code reads/writes
     * the plain {@link #verdictId} field above; this association is never set or navigated, so
     * the wire JSON (a bare {@code verdict_id} number) is unaffected.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "verdict_id", referencedColumnName = "id", insertable = false, updatable = false,
            foreignKey = @ForeignKey(name = "fk_override_verdict_id"))
    private Verdict verdict;

    private String reason;

    private String author;

    @Column(name = "created_at")
    private Instant createdAt;

    public Override() {
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getVerdictId() {
        return verdictId;
    }

    public void setVerdictId(Long verdictId) {
        this.verdictId = verdictId;
    }

    public String getReason() {
        return reason;
    }

    public void setReason(String reason) {
        this.reason = reason;
    }

    public String getAuthor() {
        return author;
    }

    public void setAuthor(String author) {
        this.author = author;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
