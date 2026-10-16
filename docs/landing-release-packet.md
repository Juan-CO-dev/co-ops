# Landing release packet - CC review

Latest verification: [Final fix round](landing-final-fix-result.md). The older evidence below is historical; the final report supersedes its test counts and performance status.

Current-round base/HEAD `9aeb73a1` (fix-D, committed by CC), branch `feat/landing-p1`, dedicated worktree `C:/Users/conta/co-ops-landing`. Earlier landing rounds are committed; FINAL FIX ROUND changes remain UNCOMMITTED. No push, merge, deployment, new resources, deployment variables, domain/alias or production-data changes. Migration 0273 remains unchanged/file-only.

Historical local-only artifacts (gitignored; unavailable in a checkout):

1. Chunk-C rulings patch - local-only `tmp/landing-release-packet/01-chunk-c-rulings.patch`: tracking, geometric browser checks, provenance/derivation, one 014 output, codec-independent controls and housekeeping. The existing drawn SUBDEX frame has its own approved source identity; no photo relabeling or blanket-gate exception.
2. Chunk E patch - local-only `tmp/landing-release-packet/02-chunk-e.patch`: reflow, payload reductions, measured transfer/LHCI harness, metadata, E5 monitor and deployment preparation.

These earlier binary patches targeted 814e3a30 and are superseded by the committed rounds through 9aeb73a1. Do not apply them to this worktree. Review the current uncommitted diff against 9aeb73a1 and docs/landing-final-fix-plan.md. Historical artifacts are not approvals.

- [Verification evidence and exact commands](qa/phase1.md)
- [Activation runbook](deploy.md)
- [Release checklist](release-checklist.md)
- [Monitoring and pause criteria](monitoring.md)
- [Single phone PREVIEW section](../README.md#preview)
- Local review request - local-only `tmp/landing-release-packet/QA-REVIEW.md`
- Preserved full browser report - local-only `tmp/landing-release-packet/playwright-full/index.html`

Local tests/build can pass without launch approval. Aggie measured Lighthouse on 8720af81; its performance gate failed. Current-round measurements are recorded separately after verification. Real-device, live merchant/Pixel/WAF/ingress, monitoring delivery/heartbeat and Juan/CC acceptance gates remain open. The exact existing Vercel branch-preview hostname must be retrieved by CC; none is invented here.
