package com.chesterton.ledger.dto;

import java.util.List;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.Valid;

/** The whole seed/out/knowledge.json payload: {repo, fences: [...]} per docs/contracts.md. */
public class ImportRequest {

    @NotBlank
    private String repo;

    @NotEmpty
    @Valid
    private List<Fence> fences;

    public String getRepo() {
        return repo;
    }

    public void setRepo(String repo) {
        this.repo = repo;
    }

    public List<Fence> getFences() {
        return fences;
    }

    public void setFences(List<Fence> fences) {
        this.fences = fences;
    }

    public static class Fence {
        private String id;
        private String file;
        private Integer lineStart;
        private Integer lineEnd;
        private String code;
        private String summary;
        private List<Citation> citations;

        public String getId() {
            return id;
        }

        public void setId(String id) {
            this.id = id;
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

        public String getCode() {
            return code;
        }

        public void setCode(String code) {
            this.code = code;
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
    }
}
