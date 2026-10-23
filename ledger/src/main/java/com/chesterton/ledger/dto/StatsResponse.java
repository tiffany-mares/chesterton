package com.chesterton.ledger.dto;

/** docs/contracts.md "GET /stats?repo= -> {verdicts_total, flags_total, overrides_total, false_positive_rate}". */
public record StatsResponse(long verdictsTotal, long flagsTotal, long overridesTotal, double falsePositiveRate) {
}
