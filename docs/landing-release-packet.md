# Landing release packet - CC review

Base/HEAD `814e3a30`, branch `feat/landing-p1`, dedicated worktree `C:/Users/conta/co-ops-landing`. All changes UNCOMMITTED. No push, merge, deployment, new resources, deployment variables, domain/alias or production-data changes. Migration 0273 remains unchanged/file-only.

Review in order:

1. [Chunk-C rulings patch](../tmp/landing-release-packet/01-chunk-c-rulings.patch): tracking, geometric browser checks, provenance/derivation, one 014 output, codec-independent controls and housekeeping. The existing drawn SUBDEX frame has its own approved source identity; no photo relabeling or blanket-gate exception.
2. [Chunk E patch](../tmp/landing-release-packet/02-chunk-e.patch): reflow, payload reductions, measured transfer/LHCI harness, metadata, E5 monitor and deployment preparation.

These local ignored binary patches target a clean copy of 814e3a30 in order. Do not apply them over this already modified worktree. Patch application and final-file parity are checked in an isolated local snapshot. They are not commits or approvals.

- [Verification evidence and exact commands](qa/phase1.md)
- [Activation runbook](deploy.md)
- [Release checklist](release-checklist.md)
- [Monitoring and pause criteria](monitoring.md)
- [Single phone PREVIEW section](../README.md#preview)
- [Local review request](../tmp/landing-release-packet/QA-REVIEW.md)
- [Preserved full browser report](../tmp/landing-release-packet/playwright-full/index.html)

Local tests/build can pass without launch approval. Lighthouse measurement is blocked by registry EACCES; exact CC commands are in the runbook. Real-device, live merchant/Pixel/WAF/ingress, monitoring delivery/heartbeat and Juan/CC acceptance gates remain open. The exact existing Vercel branch-preview hostname must be retrieved by CC; none is invented here.
