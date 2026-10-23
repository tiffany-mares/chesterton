package com.chesterton.ledger.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public class OverrideRequest {

    @NotNull
    private Long verdictId;

    @NotBlank
    private String reason;

    @NotBlank
    private String author;

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
}
