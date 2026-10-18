# Landing release packet - CC review

Chunk 8 indexing note (2026-10-18): production indexability requires server `VERCEL_ENV=production` and an approved Host authority matching `SITE_ORIGIN`. Matching-origin previews remain noindex. Landing HTML and the proxy-owned robots/sitemap deliberately remain `private, no-store` for host isolation: **no CDN HTML caching despite LCP pressure**. Hashed asset caching is unchanged. This is a deliberate isolation/performance trade-off, not authorization to change environments or domains. Local verification and exact en/es JSON-LD: [chunk 8 result](landing-v2-chunk8-RESULT.md). Public HTTPS verification, exact-revision CI and CC/Juan release approval remain external gates.

Latest verification: [Merge-gate round](landing-merge-gate-result.md). Older evidence below is historical.

Custody (2026-10-16): branch `feat/landing-p1`, HEAD/base `21eeedde`, dedicated clone `C:/Users/conta/co-ops-landing`; clean before this round. Only this merge-gate/P3 round is UNCOMMITTED. Earlier rounds are committed. No push, merge, deploy, environment change or production write; 0273 remains file-only. Current evidence: [merge-gate result](landing-merge-gate-result.md).

Historical local-only artifacts (gitignored; unavailable in a checkout):

1. Chunk-C rulings patch - local-only `tmp/landing-release-packet/01-chunk-c-rulings.patch`: tracking, geometric browser checks, provenance/derivation, one 014 output, codec-independent controls and housekeeping. The existing drawn SUBDEX frame has its own approved source identity; no photo relabeling or blanket-gate exception.
2. Chunk E patch - local-only `tmp/landing-release-packet/02-chunk-e.patch`: reflow, payload reductions, measured transfer/LHCI harness, metadata, E5 monitor and deployment preparation.

These earlier binary patches targeted 814e3a30 and are superseded by the committed rounds through 21eeedde. Do not apply them to this worktree. Review the current uncommitted diff against 21eeedde and docs/landing-merge-gate-result.md. Historical artifacts are not approvals.

- [Verification evidence and exact commands](qa/phase1.md)
- [Activation runbook](deploy.md)
- [Release checklist](release-checklist.md)
- [Monitoring and pause criteria](monitoring.md)
- [Single phone PREVIEW section](../README.md#preview)
- Local review request - local-only `tmp/landing-release-packet/QA-REVIEW.md`
- Preserved full browser report - local-only `tmp/landing-release-packet/playwright-full/index.html`

Local tests/build can pass without launch approval. Aggie's supplied 21eeedde review measured accepted real-Pixel median TBT 210.5 ms and 116,120 third-party bytes; the blocked first-party pass motivated CC's merge/launch split. Those are historical review numbers, not this round's HTTPS launch measurement. Current results are in the merge-gate report. Real-device, live merchant/Pixel/WAF/ingress, monitoring delivery/heartbeat and Juan/CC acceptance gates remain open. The exact existing Vercel branch-preview hostname must be retrieved by CC; none is invented here.

CC ruling: CI gates first-party UNSET and ACCEPTED-with-Pixel-BLOCKED at the unchanged thresholds via `npm run perf:ci`. The independent `npm run perf:launch` command measures real accepted Pixel traffic on `LANDING_PERF_URL` (HTTPS preview); this is a launch/spend checklist gate, not CI. Missing preview measurement remains open. Ordinary order-probe 4xx requires review, not pause; challenge/branch/host/timeout/5xx rules are unchanged.

Launch gate: LANDING_HOSTS must cover EVERY public landing host, including aliases. Verify each production alias 301s to the SITE_ORIGIN authority preserving path/search; verify canonical en/es metadata and preview noindex. Unlisted hosts follow staff routing by design.
