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
class OverrideControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private long createFlaggedVerdict() throws Exception {
        MvcResult result = mockMvc.perform(post("/verdicts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "repo": "acme/storefront",
                                  "pr": 1,
                                  "head_sha": "abc123",
                                  "hunk_hash": "9f2c1a0b4d6e8f10",
                                  "decision_id": null,
                                  "verdict": "YES",
                                  "payload": {
                                    "id": 0,
                                    "repo": "acme/storefront",
                                    "pr": 1,
                                    "head_sha": "abc123",
                                    "file": "services/payments/client.py",
                                    "line": 12,
                                    "kind": "contradiction",
                                    "verdict": "YES",
                                    "reason": "raising MAX_RETRIES contradicts ENG-212",
                                    "citations": [],
                                    "hunk_hash": "9f2c1a0b4d6e8f10",
                                    "status": "open"
                                  }
                                }
                                """))
                .andExpect(status().isOk())
                .andReturn();
        Integer id = JsonPath.read(result.getResponse().getContentAsString(), "$.id");
        return id.longValue();
    }

    @Test
    void createsOverrideAndAnchoredDecisionSideEffect() throws Exception {
        long verdictId = createFlaggedVerdict();

        mockMvc.perform(post("/overrides")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"verdict_id": %d, "reason": "retry cap raise is intentional for Black Friday", "author": "alice"}
                                """.formatted(verdictId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").isNumber())
                .andExpect(jsonPath("$.verdict_id").value(verdictId))
                .andExpect(jsonPath("$.reason").value("retry cap raise is intentional for Black Friday"))
                .andExpect(jsonPath("$.author").value("alice"))
                .andExpect(jsonPath("$.verdict.id").value(verdictId));

        // Side effect: a new decision row anchored to the verdict's file/line, source=override,
        // with a single override citation.
        mockMvc.perform(get("/decisions")
                        .param("repo", "acme/storefront")
                        .param("file", "services/payments/client.py"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].line_start").value(12))
                .andExpect(jsonPath("$[0].line_end").value(12))
                .andExpect(jsonPath("$[0].source").value("override"))
                .andExpect(jsonPath("$[0].summary").value("retry cap raise is intentional for Black Friday"))
                .andExpect(jsonPath("$[0].citations[0].type").value("override"))
                .andExpect(jsonPath("$[0].citations[0].url").value(""))
                .andExpect(jsonPath("$[0].citations[0].title").value("Reviewer override by alice"));
    }

    @Test
    void listsOverridesJoinedWithVerdictInfo() throws Exception {
        long verdictId = createFlaggedVerdict();
        mockMvc.perform(post("/overrides")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"verdict_id": %d, "reason": "false positive", "author": "bob"}
                                """.formatted(verdictId)))
                .andExpect(status().isOk());

        mockMvc.perform(get("/overrides").param("repo", "acme/storefront"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].author").value("bob"))
                .andExpect(jsonPath("$[0].verdict.repo").value("acme/storefront"))
                .andExpect(jsonPath("$[0].verdict.hunk_hash").value("9f2c1a0b4d6e8f10"));

        mockMvc.perform(get("/overrides").param("repo", "other/repo"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void postOverrideWithNonexistentVerdictIdReturns404() throws Exception {
        // decision_id/verdict_id now have real FK constraints (fk_verdict_decision_id,
        // fk_override_verdict_id) backing this, but the 404 itself is produced by the
        // application-level check in OverrideService.create (VerdictService#getEntityOrThrow)
        // before any insert is attempted, so behavior is unchanged from before the FK was added.
        mockMvc.perform(post("/overrides")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"verdict_id": 999999, "reason": "no such verdict", "author": "carol"}
                                """))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("not_found"));
    }

    @Test
    void postOverrideWithValidVerdictIdStillInsertsSuccessfully() throws Exception {
        long verdictId = createFlaggedVerdict();

        mockMvc.perform(post("/overrides")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"verdict_id": %d, "reason": "valid insert after FK addition", "author": "dave"}
                                """.formatted(verdictId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").isNumber())
                .andExpect(jsonPath("$.verdict_id").value(verdictId))
                .andExpect(jsonPath("$.verdict.id").value(verdictId));
    }
}
