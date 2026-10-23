package com.chesterton.ledger.web;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class StatsControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private long createVerdict(String hunkHash, String verdict) throws Exception {
        MvcResult result = mockMvc.perform(post("/verdicts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "repo": "acme/storefront", "pr": 1, "head_sha": "abc123",
                                  "hunk_hash": "%s", "decision_id": null, "verdict": "%s",
                                  "payload": {"id": 0, "repo": "acme/storefront", "pr": 1, "head_sha": "abc123",
                                    "file": "services/payments/client.py", "line": 12, "kind": "contradiction",
                                    "verdict": "%s", "reason": "r", "citations": [], "hunk_hash": "%s", "status": "open"}
                                }
                                """.formatted(hunkHash, verdict, verdict, hunkHash)))
                .andExpect(status().isOk())
                .andReturn();
        Integer id = JsonPath.read(result.getResponse().getContentAsString(), "$.id");
        return id.longValue();
    }

    @Test
    void computesTotalsAndFalsePositiveRate() throws Exception {
        createVerdict("hash1", "YES");
        long flaggedVerdictId = createVerdict("hash2", "YES");
        createVerdict("hash3", "NO");
        createVerdict("hash4", "NO_EVIDENCE");

        // One of the two YES flags gets overridden -> false_positive_rate = 1/2 = 0.5.
        mockMvc.perform(post("/overrides")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"verdict_id": %d, "reason": "intentional", "author": "alice"}
                                """.formatted(flaggedVerdictId)))
                .andExpect(status().isOk());

        mockMvc.perform(get("/stats").param("repo", "acme/storefront"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verdicts_total").value(4))
                .andExpect(jsonPath("$.flags_total").value(2))
                .andExpect(jsonPath("$.overrides_total").value(1))
                .andExpect(jsonPath("$.false_positive_rate").value(0.5));
    }

    @Test
    void falsePositiveRateIsZeroWhenNoFlags() throws Exception {
        mockMvc.perform(get("/stats").param("repo", "nonexistent/repo"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verdicts_total").value(0))
                .andExpect(jsonPath("$.flags_total").value(0))
                .andExpect(jsonPath("$.overrides_total").value(0))
                .andExpect(jsonPath("$.false_positive_rate").value(0.0));
    }
}
