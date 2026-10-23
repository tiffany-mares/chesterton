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
class VerdictControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private static String flagPayload(String verdict) {
        return """
                {
                  "repo": "acme/storefront",
                  "pr": 1,
                  "head_sha": "abc123",
                  "hunk_hash": "9f2c1a0b4d6e8f10",
                  "decision_id": null,
                  "verdict": "%s",
                  "payload": {
                    "id": 0,
                    "repo": "acme/storefront",
                    "pr": 1,
                    "head_sha": "abc123",
                    "file": "services/payments/client.py",
                    "line": 12,
                    "kind": "contradiction",
                    "verdict": "%s",
                    "reason": "raising MAX_RETRIES contradicts ENG-212",
                    "citations": [],
                    "hunk_hash": "9f2c1a0b4d6e8f10",
                    "status": "open"
                  }
                }
                """.formatted(verdict, verdict);
    }

    @Test
    void createsVerdictAndReturnsNestedPayload() throws Exception {
        mockMvc.perform(post("/verdicts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(flagPayload("YES")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").isNumber())
                .andExpect(jsonPath("$.repo").value("acme/storefront"))
                .andExpect(jsonPath("$.pr").value(1))
                .andExpect(jsonPath("$.head_sha").value("abc123"))
                .andExpect(jsonPath("$.hunk_hash").value("9f2c1a0b4d6e8f10"))
                .andExpect(jsonPath("$.verdict").value("YES"))
                .andExpect(jsonPath("$.payload.kind").value("contradiction"))
                .andExpect(jsonPath("$.payload.file").value("services/payments/client.py"));
    }

    @Test
    void upsertsOnRepoHeadShaHunkHashInsteadOfDuplicating() throws Exception {
        MvcResult first = mockMvc.perform(post("/verdicts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(flagPayload("NO_EVIDENCE")))
                .andExpect(status().isOk())
                .andReturn();
        String firstBody = first.getResponse().getContentAsString();

        // Same (repo, head_sha, hunk_hash) key, different verdict value -> update in place.
        MvcResult second = mockMvc.perform(post("/verdicts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(flagPayload("YES")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verdict").value("YES"))
                .andReturn();
        String secondBody = second.getResponse().getContentAsString();

        // Same id was reused (updated), not a new row.
        org.assertj.core.api.Assertions.assertThat(JsonPath.<Integer>read(secondBody, "$.id"))
                .isEqualTo(JsonPath.<Integer>read(firstBody, "$.id"));

        mockMvc.perform(get("/verdicts").param("repo", "acme/storefront").param("pr", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].verdict").value("YES"));
    }

    @Test
    void listsVerdictsByRepoAndPr() throws Exception {
        mockMvc.perform(post("/verdicts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(flagPayload("YES")))
                .andExpect(status().isOk());

        mockMvc.perform(get("/verdicts").param("repo", "acme/storefront").param("pr", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].payload.reason").value("raising MAX_RETRIES contradicts ENG-212"));

        mockMvc.perform(get("/verdicts").param("repo", "acme/storefront").param("pr", "99"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void listsAllVerdictsForRepoWhenPrIsOmitted() throws Exception {
        // Two verdicts, same repo, different pr/hunk_hash (hunk_hash is part of the upsert key,
        // so distinct hashes avoid colliding with each other).
        mockMvc.perform(post("/verdicts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "repo": "acme/storefront",
                                  "pr": 1,
                                  "head_sha": "abc123",
                                  "hunk_hash": "hash-pr-1",
                                  "decision_id": null,
                                  "verdict": "YES",
                                  "payload": {"id": 0, "repo": "acme/storefront", "pr": 1,
                                    "head_sha": "abc123", "file": "a.py", "line": 1,
                                    "kind": "contradiction", "verdict": "YES", "reason": "r1",
                                    "citations": [], "hunk_hash": "hash-pr-1", "status": "open"}
                                }
                                """))
                .andExpect(status().isOk());
        mockMvc.perform(post("/verdicts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "repo": "acme/storefront",
                                  "pr": 2,
                                  "head_sha": "def456",
                                  "hunk_hash": "hash-pr-2",
                                  "decision_id": null,
                                  "verdict": "NO",
                                  "payload": {"id": 0, "repo": "acme/storefront", "pr": 2,
                                    "head_sha": "def456", "file": "b.py", "line": 5,
                                    "kind": "contradiction", "verdict": "NO", "reason": "r2",
                                    "citations": [], "hunk_hash": "hash-pr-2", "status": "open"}
                                }
                                """))
                .andExpect(status().isOk());

        // pr omitted -> both rows for the repo, regardless of pr.
        mockMvc.perform(get("/verdicts").param("repo", "acme/storefront"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));

        // Existing behavior unchanged: pr supplied still filters to that pr only.
        mockMvc.perform(get("/verdicts").param("repo", "acme/storefront").param("pr", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].pr").value(1));
    }

}
