package com.chesterton.ledger.dto;

/** docs/contracts.md "Citation" shape. `type` is one of slack|linear|pr|override. */
public record Citation(String type, String url, String title) {
}
