# R7 chunk 4 and chunk-2 review fixes

Base `1dfa40a20de4554ce6bed52f0bacf50e300adf0f`, branch `feat/lockdown-step2`, worktree `C:/Users/conta/co-ops-sol-sec`. Changes remain uncommitted. No push, merge, external database connection, migration application, or .env read.

## Plan and contracts

Read the referenced app paths, actor resolver, 0276 signatures, 0272 migration/harness/tests, R7 and manifest, installed Next page/route guides, and relevant catalog classes before implementing. Plan: reproduce Part A refusals, separate existing-instance READ from INSERT authority, add explicit UI/error/template handling and read-only preflight; mirror 0272 for the five-table lockdown with stronger exact SELECT comparisons and mutation proofs. CC's supplied rulings are the implementation contract. No new independent cross-family plan-review receipt was obtained in this session; CC's review remains required for this diff.

## Files and behavior

- `lib/checklists.ts`: active member OR level >=8 before existing-row read; membership required before creation. Completion cardinality and completion-RPC 23505 become 409 concurrent_modification. All three checklist RPC error paths log PGRST202 with `[checklist 0276_missing]` and operation, without payloads.
- `app/(authed)/operations/closing/page.tsx`: nonmember/refused write actors use the existing-row loader and render readOnly; missing rows show NoInstance. Trainee behavior and member creation/reconciliation retained. Unexpected resolver exceptions still propagate.
- `app/api/checklist/instances/route.ts`: closing template must be active and belong to the requested shop; otherwise 403 template_not_available before mutation.
- `components/auth/PinConfirmModal.tsx`: concurrent_modification and invalid_payload display the existing translated reload message and call onError with the original body.
- `scripts/preflight-0276.mjs`: explicit CHECKLIST_PREFLIGHT_DATABASE_URL, no dotenv; BEGIN READ ONLY, catalog SELECT, ROLLBACK. Checks exact three checklist writers plus report writer and both helper dependencies for existence/service_role EXECUTE. Never calls a writer. CC runs it before app promotion; this session tested it with mocks only.
- `supabase/migrations/0277_postgrest_checklist_write_lockdown.sql`: FILE ONLY. Five table/column write revokes for PUBLIC/anon/authenticated; nine named policy drops; explicit false policies retained. Exact catalog SELECT ACL/policy snapshots, effective grants, permissive write policies including DELETE, RLS, five 0276 functions and service-role rights asserted. Five per-table security.grants_change audits plus one migration summary using that same registered action, with resource_table=schema_migrations.
- `scripts/sql-harness-0277.mjs` and `tests/postgrest-checklist-write-lockdown-migration.test.ts`: role denial/read parity, service DML, six audit rows, and 17 fail-closed mutation scenarios with rollback checks.
- `tests/closing-readonly-actor.test.ts`, `tests/preflight-0276.test.ts`, and three amended tests below provide regression coverage. `2026-10-19-lockdown-step2-manifest.md` records the corrected API contract and current chunk state.

## Changed/removed assertion ledger

No existing test deleted. LRA-227 foreign-GM-before-any-read test is unchanged.

1. `checklist-gate-location-bind.test.ts`: replaced the member-owner read fixture with nonmember owner/cgs/moo fixtures, retaining own-shop GM. This restores global READ coverage at levels 8/9/10. Added nonmember 9/10 existing-read success and missing-row creation refusal.
2. `checklist-service-writers.test.ts`: route refusal matrix now sets exists=false for the instance endpoint. The standalone owner-refusal case also sets exists=false and is named creation refusal. Previous assertions incorrectly denied a legitimate existing-row READ; mutation denials remain asserted.
3. Same file: completion_cardinality's response code expectation changes to concurrent_modification, retaining HTTP 409. Other cardinality codes retain their expectations. Template fixtures now include actual location_id/active fields for the stricter route projection. Added foreign/inactive template refusals, completion 23505/cardinality mapping and all three missing-RPC tags.
4. `pin-confirm-double-submit.test.ts`: additive tests only. Execute the actual response switch and assert translated reload plus exact parent callback for both new cases; existing single-submit/latch tests unchanged.
5. New 0277 assertions strengthen 0272's pattern: SELECT equality for every grantee and column instead of authenticated SELECT non-loss; DELETE/ALL and inherited target-role policies; exact prerequisite signatures; unchanged wider service rights. Column revoke loop statically pinned because PGlite differs from PostgreSQL.
6. Final inspection caught BC-030: the initial audit fixture allowed NULL resource_table, unlike the documented NOT NULL schema and typed audit helper. Tightened fixture and changed the new migration summary target to schema_migrations. This is an added assertion, not a weakened one.

## Verification

- Initial Part A regression run: 13 failed, 98 passed against old implementation. Initial page test run also reproduced the regression; final page tests: 9 passed.
- `npx.cmd tsc --noEmit`: PASS, exit 0, no diagnostics. Initial run found an unnecessary ts-expect-error on the JS script import; removed it and reran.
- `node scripts/sql-harness-0276.mjs`: PASS, 38,417 checks; two-connection sim proof NOT RUN.
- `npx.cmd vitest run checklist opening prep closing written-report pin-confirm-double-submit preflight-0276 --reporter=dot`: PASS, 48 files / 745 tests. Final invocation used Node spawnSync of Vitest to capture its own exit code (0), because PowerShell's stderr redirection reported a nonzero wrapper status despite the first run's passing summary.
- `npx.cmd vitest run tests/postgrest-checklist-write-lockdown-migration.test.ts`: final PASS, 4 tests, including `node scripts/sql-harness-0277.mjs` with 130 checks. Before correction, the tightened NOT NULL fixture reproduced the audit failure. SQL reads now normalize CRLF before regex/mutation checks.
- `git diff --check`: PASS.

## Open gates and limits

No unresolved product/contract question. CC must review the uncommitted diff, run real PostgreSQL column-ACL verification and the existing two-connection sim proof, and control application/migration ordering: 0276, compatible app, then 0277. PGlite cannot prove independent backend lock ordering and its table REVOKE removes column grants unlike PostgreSQL; mutation tests reintroduce column grants to prove the assertions, and source tests pin explicit column revocation.

The preflight requires operator-installed `pg` and explicit connection configuration. No real preflight was run here. Existing revoke/tag/reference writer concurrency exclusions from chunk 3 remain unchanged. No full-repository suite rerun was requested/performed; the requested domain gates passed. Final checks considered BC-001/004/022 (binding and both directions), BC-023 (write closure), BC-030 (fixture fidelity), and BC-038 (deployment ordering).
