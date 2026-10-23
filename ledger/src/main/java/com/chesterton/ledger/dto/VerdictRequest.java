package com.chesterton.ledger.dto;

import tools.jackson.databind.JsonNode;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public class VerdictRequest {

    @NotBlank
    private String repo;

    @NotNull
    private Integer pr;

    @NotBlank
    private String headSha;

    @NotBlank
    private String hunkHash;

    /** Nullable: the decision this verdict is judged against, if any. */
    private Long decisionId;

    @NotBlank
    private String verdict;

    /** The full Flag JSON, stored verbatim; opaque to the ledger. */
    @NotNull
    private JsonNode payload;

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
}
