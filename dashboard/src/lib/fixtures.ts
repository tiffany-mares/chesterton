import type { Decision, FileFences, Flag, Override, Stats } from "./api";

export const files: FileFences[] = [
  { file: "services/payments/client.py", fence_count: 6, loc: 120 },
  { file: "services/payments/webhooks.py", fence_count: 4, loc: 210 },
  { file: "services/checkout/cart.ts", fence_count: 3, loc: 340 },
  { file: "services/checkout/pricing.ts", fence_count: 5, loc: 180 },
  { file: "services/auth/session.go", fence_count: 2, loc: 260 },
  { file: "services/auth/tokens.go", fence_count: 1, loc: 90 },
  { file: "web/src/components/ProductGrid.tsx", fence_count: 0, loc: 420 },
  { file: "web/src/lib/analytics.ts", fence_count: 1, loc: 150 },
  { file: "infra/terraform/rds.tf", fence_count: 3, loc: 75 },
  { file: "infra/k8s/payments-deploy.yaml", fence_count: 2, loc: 60 },
  { file: "services/inventory/sync.py", fence_count: 0, loc: 290 },
  { file: "README.md", fence_count: 0, loc: 40 },
];

const retryCitations = [
  { type: "slack" as const, url: "https://slack.com/archives/C01/p1", title: "#oncall: retry cap" },
  { type: "linear" as const, url: "https://linear.app/acme/issue/ENG-212", title: "ENG-212: Cap payment retries at 3" },
  { type: "pr" as const, url: "https://github.com/acme/storefront/pull/88", title: "Cap payment retries (fixes ENG-212)" },
];

export const decisions: Decision[] = [
  {
    id: 3, file: "services/payments/client.py", line_start: 5, line_end: 5,
    summary: "Payment retries are capped at 3 with backoff, after checkout started hammering the payments provider during an incident.",
    citations: retryCitations, source: "seed",
  },
  {
    id: 4, file: "services/payments/client.py", line_start: 22, line_end: 31,
    summary: "Idempotency keys are derived from the order ID, never generated per-request, so retries can't double-charge.",
    citations: [{ type: "pr", url: "https://github.com/acme/storefront/pull/61", title: "Stable idempotency keys" }], source: "seed",
  },
];

export const flags: Flag[] = [
  {
    id: 1, repo: "acme/storefront", pr: 1, head_sha: "83013a2", file: "services/payments/client.py", line: 5,
    kind: "contradiction", verdict: "YES",
    reason: "MAX_RETRIES = 3 exists because: checkout hammered the payments provider during an incident. This PR raises it to 10 without addressing the provider's rate limit.",
    citations: retryCitations, hunk_hash: "165b1d6186de254f", status: "overridden",
  },
  {
    id: 5, repo: "acme/storefront", pr: 4, head_sha: "a91fe02", file: "services/checkout/pricing.ts", line: 48,
    kind: "stale_comment", verdict: "NO_EVIDENCE",
    reason: "The comment says tax is computed server-side, but this hunk moves tax calculation into the client.",
    citations: [{ type: "linear", url: "https://linear.app/acme/issue/ENG-301", title: "ENG-301: Server-side tax" }],
    hunk_hash: "9be0c1a2f4d3e811", status: "open",
  },
];

export const overrides: Override[] = [
  { id: 2, verdict_id: 1, reason: "payments provider autoscales now; the cap can move", author: "sam", created_at: "2026-10-24T05:02:58Z", verdict: flags[0]! },
];

export const stats: Stats = { verdicts_total: 14, flags_total: 2, overrides_total: 1, false_positive_rate: 0.5 };
