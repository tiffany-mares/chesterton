package com.chesterton.ledger.dto;

import java.time.Instant;

import tools.jackson.databind.JsonNode;

public class VerdictResponse {

    private Long id;
    private String repo;
    private Integer pr;
    private String headSha;
    private String hunkHash;
    private Long decisionId;
    private String verdict;
    private JsonNode payload;
    private Instant createdAt;

    public VerdictResponse() {
    }

    public VerdictResponse(Long id, String repo, Integer pr, String headSha, String hunkHash,
            Long decisionId, String verdict, JsonNode payload, Instant createdAt) {
        this.id = id;
        this.repo = repo;
        this.pr = pr;
        this.headSha = headSha;
        this.hunkHash = hunkHash;
        this.decisionId = decisionId;
        this.verdict = verdict;
        this.payload = payload;
        this.createdAt = createdAt;
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

    public JsonNode getPayload() {
        return payload;
    }

    public void setPayload(JsonNode payload) {
        this.payload = payload;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
