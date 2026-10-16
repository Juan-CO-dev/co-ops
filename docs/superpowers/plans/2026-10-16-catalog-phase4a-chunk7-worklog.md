# Catalog Phase 4a Chunk 7 execution

Baseline: `feat/catalog-p4a` at `0cb4988a`; clean dedicated clone. User authorizes the approved BUILD Chunk 7 and the explicit review rulings. All changes remain uncommitted; migrations are files only and database tests use PGlite.

Plan: first isolate Chunk 6 fixes with regression tests (UTF-8 dictionaries, replay identity/notice, request factory lifecycle, journal ceilings). Then wire authenticated job/setup/share/swap/Toast/Back endpoints over existing engines, pin route tiers and named/positional refusals, scope journal reads at the database, add destructive swap audit actions and ordering/par disclosure. Extend permission/location-bind checks. Publish concrete 4b DTO and disclosure contracts plus the deferred Chunk 8 stale-preview test.

Files: new catalog route handlers/helper and route tests; `lib/catalog/swap-vendor.ts`, audit registry, dictionaries; permission, location-bind, tier and swap tests; AGENTS/disclosure documentation and handoff. Reference reads confirm the engine exports and reviewed route inventory. Next route-handler documentation confirms request-time handlers and asynchronous params. No new migration or guided page is required.

Risks: unknown post-save setup outcomes must remain unconfirmed, replay must not claim latest edits applied, preview tokens are not authorization, foreign journal reads must be scoped before transfer, and caller-owned IDs must never override route identity. Preserve distinct ownership/recipe/menu refusal namespaces and the catalog E / Toast A / registry B split.

Verification: focused red/green tests, both SQL harnesses, 0264/0265 tests, full Vitest with `--maxWorkers=3`, and `npx tsc --noEmit --incremental false`. Cross-family final review belongs to CC's handoff.


## Execution evidence

Review fixes went red on missing replay fields/copy and corrupted Spanish, then green (74 tests). Swap integration went red in four cases (scoped queries, empty completion query, social-role exclusion, ordering disclosure), then green with dedicated destructive audits (46 tests). The mapper tests required exporting the existing status map; the apparent menu bridge gap was disproved by its existing shared mapper, so no redundant bridge was added. The expanded scanner now explicitly detects wrapped and delegated job writers. Two old PGlite replay assertions were corrected to require replayed true while preserving identity/row/audit invariants (17 passed).

HTTP tests first failed on absent routes, then cover all 15 POSTs and journal GET, positive and negative gates, explicit dependency baselines, scoped identity, translated replay/unknown-save/ordering messages, safe unknown failures and every ownership/swap status in both languages. Original parser tests were restored unchanged and HTTP tests use a separate file. Named legacy guide/barcode/Toast refusals gained missing copy. JSON parse errors retain invalid_json but show a plain localized retry message.

Pre-freeze inspection covered path-identity binding (BC-001/022), route step-up (BC-003), scoped/paginated/bounded journal reads (BC-006/010/025), closed vocabulary and i18n (BC-017/018), error boundaries and honest unknown outcomes (BC-027/032/040), real migration fixtures (BC-030), and migration-release/stale-preview handoff (BC-038). This is author verification, not CC's cross-family approval.

Consolidated focused run: 25 files / 602 tests passed, zero failures, exit 0 (88.83 s), including the 0264/0265 tests. Both SQL harnesses passed. Final full-suite/typecheck evidence is in the handoff; no production/SIM action was taken.

Final verification: full Vitest 659 files passed / 1 skipped, 10,387 tests passed / 3 skipped, zero failures, native exit 0 (452.09 s). Non-incremental TypeScript exit 0, zero diagnostics. All changes remain uncommitted at baseline HEAD; no migration files changed.
