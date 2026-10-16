# Catalog Phase 4a chunk 4 work log

Base: `bb82512d`, branch `feat/catalog-p4a`, dedicated clone `C:\Users\conta\co-ops-astra-p4`. The lead's dispatch authorizes the chunk-3 fixes first, then the five tasks of the approved BUILD plan. All changes remain uncommitted; no fetch, push, merge, deployment, or real database access.

## Sequence and contracts

1. Close chunk-3 P2-1/P2-2 and P3-1 through P3-4 with tests: owner-name DTO/rendering, scope-attributed SKU readiness, exact installed trigger set, behavioural operational-consumer tests, catering reference validation, scoped batch context, and builder fieldset layout. Preserve a separate review-fix patch before chunk-4 implementation.
2. Implement the approved creation/owned-edit contracts across SKU/menu writers, registry libraries/routes/components, recipe libraries/routes and legacy builder. Explicit global creation remains MoO+; omission may infer one authorized membership only. Owner-sensitive writes bind the owner observed by authorization, including null owners, and refuse zero affected rows. Tier E and registry Tier B remain unchanged.
3. Exercise successes, denials and owner-change races; atomic recipe/inline-item creation uses the existing real 0264 PGlite writer. Keep 3b catalog-page editors and guided jobs in their assigned later chunks.
4. Run touched tests, SQL harnesses 0262/0263, all 0264 suites, full Vitest with three workers, and nonincremental TypeScript. Record exact outcomes in the handoff.

Referenced contracts were re-read in the chunk-3 handoff, approved BUILD plan, actual ownership helpers/writers, migration 0264 and current repository laws. The shipped 3b helper `requireGlobalLineWriter` now exists in the legacy library; its shared-global restriction must remain while the approved owned-default writer path is added. No new catalog-page editor is implied.

## Release packet: org-wide graph cost (P3-5)

Org-wide catalog, menu-costing and weight views resolve an additional full recipe graph for each distinct shop owning an included entity; menu/weight costing also reads that owner's prices. Recipe detail cost composition likewise uses owner scope. This increases page read work with the number of distinct owning shops (currently bounded by eight shops), rather than the number of owned rows. No latency measurement was taken in the chunk-3 review. Preserve this limitation for CC's release packet and measure realistic owner populations before claiming unchanged page latency.

The chunk-3 deferred P3-b/P3-g ledger remains unchanged. CC retains independent cross-family review and release approval.

## Completion evidence

The review-fix checkpoint is preserved as `%TEMP%/catalog-p4a-chunk3-review-fixes.patch` before chunk-4 changes. All five chunk-4 tasks are implemented. See `2026-10-16-catalog-phase4a-chunk4-handoff.md` for file groups, TDD evidence, exact final checks, and deferred verification. All writes remain uncommitted and unstaged.
