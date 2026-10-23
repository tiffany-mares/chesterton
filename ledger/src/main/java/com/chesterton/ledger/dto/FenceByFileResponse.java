package com.chesterton.ledger.dto;

/** docs/contracts.md "GET /fences/by-file?repo= -> [{file, fence_count, loc}]"; loc enrichment happens elsewhere. */
public record FenceByFileResponse(String file, long fenceCount, long loc) {
}
