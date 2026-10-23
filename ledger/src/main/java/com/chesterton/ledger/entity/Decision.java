package com.chesterton.ledger.entity;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * Mirrors the `decision` table in docs/build_plan.md Phase 5. `citationsJson` holds the
 * Citation array as serialized JSON text (TEXT works identically on H2 and Postgres; the
 * postgres profile is free to promote the column to JSONB later without changing this class).
 * Mapped as a plain {@code text} column (not {@code @Lob}) so Hibernate never routes it through
 * PostgreSQL large-object ({@code oid}) storage, which has autocommit/streaming pitfalls.
 */
@Entity
@Table(name = "decision")
public class Decision {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String repo;

    private String file;

    @Column(name = "line_start")
    private Integer lineStart;

    @Column(name = "line_end")
    private Integer lineEnd;

    @Column(columnDefinition = "text")
    private String summary;

    @Column(name = "citations", columnDefinition = "text")
    private String citationsJson;

    private String source;

    @Column(name = "created_at")
    private Instant createdAt;

    public Decision() {
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

    public String getCitationsJson() {
        return citationsJson;
    }

    public void setCitationsJson(String citationsJson) {
        this.citationsJson = citationsJson;
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
