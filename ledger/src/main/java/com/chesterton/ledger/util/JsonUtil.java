package com.chesterton.ledger.util;

import java.util.Collections;
import java.util.List;

import org.springframework.stereotype.Component;

import com.chesterton.ledger.dto.Citation;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
public class JsonUtil {

    private final ObjectMapper objectMapper;

    public JsonUtil(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public String writeCitations(List<Citation> citations) {
        return objectMapper.writeValueAsString(citations == null ? List.of() : citations);
    }

    public List<Citation> readCitations(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyList();
        }
        return objectMapper.readValue(json, new TypeReference<List<Citation>>() {
        });
    }

    public String writeNode(JsonNode node) {
        return objectMapper.writeValueAsString(node);
    }

    public JsonNode readNode(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        return objectMapper.readTree(json);
    }
}
