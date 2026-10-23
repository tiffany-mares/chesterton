package com.chesterton.ledger.dto;

import java.time.Instant;
import java.util.List;

public class DecisionResponse {

    private Long id;
    private String repo;
    private String file;
    private Integer lineStart;
    private Integer lineEnd;
    private String summary;
    private List<Citation> citations;
    private String source;
    private Instant createdAt;

    public DecisionResponse() {
    }

    public DecisionResponse(Long id, String repo, String file, Integer lineStart, Integer lineEnd,
            String summary, List<Citation> citations, String source, Instant createdAt) {
        this.id = id;
        this.repo = repo;
        this.file = file;
        this.lineStart = lineStart;
        this.lineEnd = lineEnd;
        this.summary = summary;
        this.citations = citations;
        this.source = source;
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

    public String getFile() {
        return file;
    }

    public void setFile(String file) {
        this.file = file;
    }

    public Integer getLineStart() {
        return lineStart;
    }

    public void setLineStart(Integer lineStart) {
        this.lineStart = lineStart;
    }

    public Integer getLineEnd() {
        return lineEnd;
    }

    public void setLineEnd(Integer lineEnd) {
        this.lineEnd = lineEnd;
    }

    public String getSummary() {
        return summary;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }

    public List<Citation> getCitations() {
        return citations;
    }

    public void setCitations(List<Citation> citations) {
        this.citations = citations;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
