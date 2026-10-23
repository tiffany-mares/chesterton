package com.chesterton.ledger.dto;

import java.time.Instant;

public class OverrideResponse {

    private Long id;
    private Long verdictId;
    private String reason;
    private String author;
    private Instant createdAt;
    /** Joined verdict info, per contracts.md "GET /overrides?repo= -> list joined with verdict info". */
    private VerdictResponse verdict;

    public OverrideResponse() {
    }

    public OverrideResponse(Long id, Long verdictId, String reason, String author, Instant createdAt,
            VerdictResponse verdict) {
        this.id = id;
        this.verdictId = verdictId;
        this.reason = reason;
        this.author = author;
        this.createdAt = createdAt;
        this.verdict = verdict;
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

    public VerdictResponse getVerdict() {
        return verdict;
    }

    public void setVerdict(VerdictResponse verdict) {
        this.verdict = verdict;
    }
}
