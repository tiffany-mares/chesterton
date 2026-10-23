package com.chesterton.ledger.web;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * MockMvc tests against the real H2-backed application context (docs/contracts.md
 * "ledger (Spring Boot)" section). @Transactional rolls each test back so they don't pollute
 * the shared in-memory H2 database.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class DecisionControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void createsDecisionAndAssignsId() throws Exception {
        mockMvc.perform(post("/decisions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "repo": "acme/storefront",
                                  "file": "services/payments/client.py",
                                  "line_start": 10,
                                  "line_end": 10,
                                  "summary": "MAX_RETRIES=3 caps payment retries after ENG-212",
                                  "citations": [
                                    {"type": "linear", "url": "http://localhost:4100/linear/issue/ENG-212", "title": "ENG-212"}
                                  ],
                                  "source": "seed"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").isNumber())
                .andExpect(jsonPath("$.repo").value("acme/storefront"))
                .andExpect(jsonPath("$.file").value("services/payments/client.py"))
                .andExpect(jsonPath("$.line_start").value(10))
                .andExpect(jsonPath("$.line_end").value(10))
                .andExpect(jsonPath("$.source").value("seed"))
                .andExpect(jsonPath("$.citations[0].type").value("linear"))
                .andExpect(jsonPath("$.citations[0].title").value("ENG-212"));
    }

    @Test
    void listsDecisionsFilteredByRepoAndFile() throws Exception {
        createDecision("acme/storefront", "services/payments/client.py", "payments fence");
        createDecision("acme/storefront", "services/inventory/stock.py", "inventory fence");
        createDecision("other/repo", "services/payments/client.py", "other repo fence");

        mockMvc.perform(get("/decisions").param("repo", "acme/storefront").param("file", "services/payments/client.py"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].summary").value("payments fence"));

        mockMvc.perform(get("/decisions").param("repo", "acme/storefront"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    void importsOneDecisionPerFenceFromKnowledgeJson() throws Exception {
        mockMvc.perform(post("/decisions/import")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "repo": "acme/storefront",
                                  "fences": [
                                    {
                                      "id": "fence-1",
                                      "file": "services/payments/client.py",
                                      "line_start": 10,
                                      "line_end": 10,
                                      "code": "MAX_RETRIES = 3",
                                      "summary": "retry cap, see ENG-212",
                                      "citations": [
                                        {"type": "linear", "url": "http://localhost:4100/linear/issue/ENG-212", "title": "ENG-212"}
                                      ]
                                    },
                                    {
                                      "id": "fence-2",
                                      "file": "services/checkout/api.py",
                                      "line_start": 30,
                                      "line_end": 30,
                                      "code": "CHECKOUT_TIMEOUT_SECONDS = 30",
                                      "summary": "timeout, see ENG-310",
                                      "citations": []
                                    }
                                  ]
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.repo").value("acme/storefront"))
                .andExpect(jsonPath("$.imported").value(2));

        mockMvc.perform(get("/decisions").param("repo", "acme/storefront"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].source").value("seed"))
                .andExpect(jsonPath("$[1].source").value("seed"));
    }

    private void createDecision(String repo, String file, String summary) throws Exception {
        mockMvc.perform(post("/decisions")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {
                          "repo": "%s",
                          "file": "%s",
                          "line_start": 1,
                          "line_end": 2,
                          "summary": "%s",
                          "citations": [],
                          "source": "seed"
                        }
                        """.formatted(repo, file, summary)))
                .andExpect(status().isOk());
    }
}
