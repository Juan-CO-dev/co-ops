# Catalog Phase 4a Chunk 8 execution plan

Baseline: `feat/catalog-p4a` at `35748f42e974a3f7fc81dc1687e5bc1e929bd6ef`, clean at task entry. Worktree: `C:\Users\conta\co-ops-astra-p4`. All task changes remain uncommitted; no fetch, push, merge, deployment or database operation.

Authority: approved `2026-10-15-catalog-phase4a-BUILD.md`, Chunk 8; Aggie's r3 APPROVE; CC's chunk-8 dispatch with explicit chunk-7 review rulings. CC committed the durable rules in `35748f42` after implementation commit `712a57c3`.

## Change sets and contracts

1. Separate chunk-7 repair set: encoding-count regression, safe unexpected-error diagnostics and setup message keys, same-origin-first checks on the nine writes, Back library authority regressions, bounded UUID arrays, and corrected historical handoff. Tests precede implementation. These are the explicit reviewed fixes, not a new design.
2. Concurrency/release set: SIM-only Management API holder/racer runner, rollback scenario and actual F4 integration; 0265 column-addition stale-preview regression; separate gated 0266 exact legacy signature removal; read-only release preflight; release packet and reproducible evidence.

Files: HTTP write routes and `job-http.ts`, `lib/catalog/new-item.ts`, focused regression tests; `scripts/catalog-jobs/`, F4 runner/contracts, `scripts/catalog-release-preflight.sql`, `supabase/migrations/0266_drop_recipe_input_16arg.sql`, migration/stale-preview tests, and these handoff documents. Existing 0264/0265 stay files-only.

Verification: touched tests, both 0262/0263 SQL harnesses, 0264/0265 suites, full Vitest with `--maxWorkers=3`, TypeScript with incremental disabled, production build, diff whitespace check. Record actual commands, exit codes and counts in the final handoff. PGlite verifies SQL semantics only; CC runs real SIM races before apply.

## Risks retained for review

- Management API requests each own one connection/transaction: no lock proof may rely on session state from another request. Positive holder/racer success or exact named refusal, waiting evidence and final rows are required.
- NOWAIT dependency refusals differ from blocking graph/advisory locks and require their own positive control.
- 0266 must wait for READY deployment and old-deployment drain; authoring is not application.
- Arbitrary error messages may contain PII: server diagnostics must use safe bounded messages and avoid request bodies, SQL details, identifiers and credentials.
- Sandwich retry reconciliation, swap preview load/payload, older catalog-write origin policy, and guided-page acceptance remain explicit 4b handoff items.

The bounded implementation is split across Astra's authorized bench. CC owns cross-family review and all external execution/release gates.

Implementation discovery: F4's full-reset inventory predates catalog append-only tables and its service-role DELETE reset cannot handle them. The catalog suite uses explicit additive `catalog-isolated` fixtures under F4's existing lease/server/persona lifecycle, with scoped retirement and no false cold-empty-restore claim. The broad reset manifest is not redesigned. This preserves the approved leased-fixture requirement while adapting to the actual runner.
