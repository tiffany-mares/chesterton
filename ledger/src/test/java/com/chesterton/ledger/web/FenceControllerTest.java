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

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class FenceControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private void createDecision(String repo, String file) throws Exception {
        mockMvc.perform(post("/decisions")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"repo": "%s", "file": "%s", "line_start": 1, "line_end": 2, "summary": "x", "citations": [], "source": "seed"}
                        """.formatted(repo, file)))
                .andExpect(status().isOk());
    }

    @Test
    void groupsFenceCountsByFileForRepo() throws Exception {
        createDecision("acme/storefront", "services/payments/client.py");
        createDecision("acme/storefront", "services/payments/client.py");
        createDecision("acme/storefront", "services/checkout/api.py");
        createDecision("other/repo", "services/payments/client.py");

        org.springframework.test.web.servlet.MvcResult result = mockMvc.perform(get("/fences/by-file").param("repo", "acme/storefront"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andReturn();

        String body = result.getResponse().getContentAsString();
        org.assertj.core.api.Assertions.assertThat(body)
                .contains("\"file\":\"services/payments/client.py\"", "\"fence_count\":2")
                .contains("\"file\":\"services/checkout/api.py\"", "\"fence_count\":1")
                .contains("\"loc\":0");
    }
}
