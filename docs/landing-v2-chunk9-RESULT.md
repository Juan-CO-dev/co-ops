# Landing v2 chunk 9 - FILE-ONLY registry attribution

2026-10-18. UNCOMMITTED on `feat/landing-v2`, base/HEAD `2eb38e1b252d7e81b6646179717f5d4cd027df26`, dedicated clone `C:/Users/conta/co-ops-landing`. No commit, push, merge, deployment, connected database action or persistent environment change. Counter activation remains OFF. Existing package.json dirty status was present on entry and left alone (no content diff).

## Part 0 result

See the separate [Chunk 8 fold-ins](landing-v2-chunk8-RESULT.md#chunk-8-fold-ins). All six CC rulings implemented. Production alias and language canonical changes are explicit contract amendments in BUILD section 8. No staff login caching change. Public passthrough now forwards sanitized headers: Next's internal middleware request-override headers intentionally differ; status/routing/body and public HTTP response headers retain the baseline. Authenticated staff identity forwarding and mutation sentinels remain tested.

## Implementation

- `supabase/migrations/0273_landing_order_click_counts.sql`, `scripts/landing/order-click-sql-check.ts`, `tests/landing/order-click-migration.test.ts`: revised SQL, executable PGlite contract checks and scoped grant assertions.

- New `lib/landing/ad-codes-shared.ts`: pure bounded candidate syntax and single-query candidate extraction. Browser lookup and storage reads live in tracking-client.ts: same-origin lookup with a one-second abort signal and exact candidate-or-fallback response validation.
- New `lib/landing/ad-codes-server.ts` and `app/api/landing/ad-code/route.ts`: exact active-code projection, 750 ms abort plus bounded Promise race, request-local reuse; React server cache is request-scoped. Missing table, timeout or provider failure becomes `unattributed`. POST uses the unchanged request guard and 512-byte body bound; exactly one candidate, no list or write endpoint, private/no-store and fixed errors.
- `attribution-shared.ts`, `tracking-schema-shared.ts`, `order-click-shared.ts`, `tracking-client.ts`, `meta-server.ts`, `TrackingProvider.tsx`, tenant config and landing pages: no static eligibility list. Query/restored candidate is resolved only after browser marketing consent, before Pixel init; version and consent are rechecked after await. No unresolved query is persisted. Withdrawal invalidates pending results. Counter passes bounded candidates to the authoritative RPC; CAPI independently resolves eligibility. New registered codes require no build. Offer rules stay separate.
- Server page/privacy links use only a resolved candidate plus fallback. The layout still has no searchParams and serializes no registry list. No registry I/O for absent/invalid candidates, including the ordinary hero/perf URL; no media or hero loading changes.
- `host-shared.ts` adds only exact `/api/landing/ad-code`; request-server is unchanged. Browser fixture adds an exact fictional registry read; it never connects to a database. `privacy/page.tsx`, fixture and adjacent hero/host browser assertions are documented additions to the exact file list in BUILD.

## Assertion ledger

| Assertions | Evidence / reason |
|---|---|
| Lifetime registry capacity, 12 new family codes plus campaign/send, 1/64 boundaries, malformed/65/null rejection | Isolated SQL harness; no static list or active-count churn loophole. |
| Complete table/column ACLs, explicit RLS, actual non-superuser/non-BYPASSRLS function owner | Harness simulates hostile default grants and exercises RLS separately from ACLs. No FORCE RLS. |
| Reserved fallback active CHECK, retirement/reactivation retains history, unknown flood one fallback | SQLSTATE 23514 pinned; existing aggregates remain monotone. |
| Queued same-slot collision and 100 queued increments | One success/23505 collision and exact count. Explicitly NOT independent-session contention evidence. |
| Bigint overflow | 22003, maximum value unchanged, preceding transaction mutation rolled back. No saturation/reset/wrap. |
| Resolver eligibility, timeout/failure, request reuse, no cross-request retirement cache | New ad-codes unit tests; malformed candidates avoid lookup. |
| POST guards, one candidate/512 bytes, no registry list or reflected diagnostics | New ad-codes route unit tests and real local HTTP fixture test, including unavailable registry. |
| Capture/language and CAPI new-code support, retired fallback | Injected accepted policy and resolver tests; old static seed no longer implicitly accepted. |
| Counter unknown candidate | Intentional assertion change: syntactically valid unknown travels to RPC; SQL chooses fallback. Not app-level static normalization. |
| Consent-before-lookup, lookup-before-Pixel, withdrawal race, restored retired code, outage/navigation | Browser tests in tracking.spec.ts; dedup fixture explicitly resolves a code. Native no-JS order test retained. |
| Staff/host isolation | Exact route allowlist plus denied staff-host path; public forged hints removed; production malformed host logs once. |
| SEO contract | Per-language canonical/hreflang; four sitemap URLs; aliases 301; apex/preview behavior; approved image and individual visible shop anchors, no invented menu anchor. |

## Deliberate test relaxation - registry management grants

The old blanket "no GRANT INSERT/UPDATE anywhere" assertion now targets `landing_order_click_counts`. This is deliberate: `landing_ad_codes` is service-role managed and requires SELECT + INSERT + column UPDATE(active). The counter remains service-role SELECT-only with mutation solely through the definer. Runtime ACL checks cover both tables and every relevant column; registry code/slot UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER remain forbidden. This is an approved contract change, not an incidental test fix.

## Revised 0273 SQL summary

Header retains FILE ONLY, NOT APPLIED and original provenance, adds 2026-10-18 chunk 9 revision and CC's supplied evidence, and states self-contained/no dependency on already-applied 0274/0275. It can be manually applied out of numeric order.

`public.landing_ad_codes`: code text primary key with lowercase opaque syntax `[a-z0-9][a-z0-9_-]{0,63}`; slot smallint NOT NULL UNIQUE with 1..1024 CHECK; active boolean NOT NULL default true; CHECK forbids retiring `unattributed`. Seeds `unattributed` slot 1 and `subsim-photo` slot 2. Slots are lifetime allocations including retired codes. Registry authors must use campaign/send codes only, never recipient IDs or customer identity; syntax alone cannot enforce that semantic administrative rule.

`public.landing_order_click_counts`: day_utc date, store_key checked to two stores, ad_code FK to registry without cascade, positive bigint click_count, primary key(day_utc,store_key,ad_code). At most 1,024 dimensions x 2 stores = 2,048 rows per UTC day. Neither table stores individual identifiers, event records or request payloads.

Both tables ENABLE RLS, with separate SELECT USING(false), INSERT WITH CHECK(false), UPDATE USING(false) WITH CHECK(false), DELETE USING(false) policies. Explicit REVOKE ALL from PUBLIC, anon, authenticated, service_role precedes grants. Registry service_role SELECT/INSERT and UPDATE(active) only; counter service_role SELECT only. No public/anon/authenticated access.

`public.increment_landing_order_click(text,text)` is SECURITY DEFINER with `search_path = pg_catalog, public`, qualified tables, service_role EXECUTE only after explicit revokes. Rejects invalid/null store, null/overlength ad; bounded empty/malformed/unknown/inactive code resolves to fallback. SELECT FOR SHARE locks matched active registry row against retirement UPDATE; never inserts a requested code. UTC server clock and atomic ON CONFLICT +1. Bigint overflow fails atomically.

## Verification

| Command | Outcome / evidence |
|---|---|
| `node --experimental-strip-types scripts/landing/order-click-sql-check.ts` | PASS, 164 checks, isolated PGlite only; `tmp/chunk9-sql.log`. |
| `npm.cmd test -- tests/landing tests/security-headers.test.ts --maxWorkers=2` | PASS, final 56 files / 435 tests, 11.72 s; `tmp/chunk9-unit-final.log`. Includes host/staff tests. |
| `npm.cmd run typecheck` | PASS; `tmp/chunk9-tsc-final.log`. Final production build also checks TypeScript. |
| `npm.cmd run assets:check` | PASS, 45 assets; `tmp/chunk9-assets.log`. No asset changes. |
| Changed-file ESLint, plus last proxy/indexing-test check | PASS, exit 0; 0 errors / 2 pre-existing warnings: page no-img-element and host-shared unused `_search`. `tmp/chunk9-eslint-final.log`, `tmp/chunk9-last-lint.log`. |
| `npm.cmd run build` | PASS, exit 0; `tmp/chunk9-build-final.log`. Includes final pure-module correction and duplicate-lang alignment. |
| `$env:LANDING_E2E_USE_BUILD='1'; npx.cmd playwright test --workers=2` | PASS, exit 0, final 500 passed / 13 existing skips / zero failures, 18.4 minutes; `tmp/chunk9-e2e-final.log`, `playwright-report/index.html`. Chromium, WebKit, scoped iPhone WebKit. |
| `git diff --check` | PASS. |

The 13 skips are 12 existing Windows/WebKit decoder cases plus one Chromium-only native playback case. No new skip or retry was added; no physical iPhone decoder pass is claimed. The earlier full browser run also passed 500/13 in 18.3 minutes before the pure-module move; the final run above covers the final application. Raw final ports 44170-44175 all returned ECONNREFUSED after teardown; PID file absent.

Intermediate verification history: migration regression initially 2 failed / 2 passed, then 4 passed after implementation. First TypeScript run failed on new test annotations (TS18046 unknown row and TS2345 optional header values), corrected before successful rerun. One unit rerun had 433 passed / 1 timeout at `performance-blocking.test.ts:36`, source-file scan: `Error: Test timed out in 30000ms.` Isolated unchanged retry passed 5 tests in 455 ms; full unchanged rerun passed all 434 then-existing tests, and final full run passed all 435. No timeout/assertion was weakened. A suspected JS trailing-line-break acceptance did NOT reproduce: added newline/CR/CRLF tests passed on the existing validator; no validator rewrite was made. These cases also pass the SQL registry CHECK.

Current uncommitted 0273 SHA-256 (workspace bytes): `89b1c10ea264817b18afd67470c649ab3771b51650d28065a522a5436397fd67`. CC must compare against the final reviewed SQL artifact at apply time, accounting for any Git line-ending normalization.

## Advisory performance - one run, exit 1

Command: `npm.cmd run perf:ci`, with process-local `LANDING_E2E_USE_BUILD=1`, `CHROME_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe`, `LANDING_PERF_NO_SANDBOX=1`, and `LHCI_CLI_PATH=C:/Users/conta/AppData/Local/npm-cache/_npx/7c4c7312e9ccc7bf/node_modules/@lhci/cli/src/cli.js`. No persistent environment edits. Exactly one invocation; no retry, discarded sample or threshold change.

Evidence: `tmp/chunk9-perf.log`, `tmp/landing-performance/2026-10-18T17-49-14.162Z-merge-7e690ff4` (state summaries and raw reports). All 20 cold samples are retained below. Pixel was blocked by the harness: first-party-only evidence, not real-Pixel cost.

| Collection / consent | Median score | Median LCP ms | Median TBT ms | Exit / failed metric |
|---|---:|---:|---:|---|
| simulated-report-only / unset | 0.94 | 3051.894 | 39.000 | 0 / lcp |
| simulated-report-only / accepted | 0.94 | 3046.075 | 44.000 | 0 / lcp |
| applied-blocking / unset | 0.91 | 2212.471 | 257.096 | 1 / tbt |
| applied-blocking / accepted | 0.85 | 2301.996 | 319.957 | 1 / tbt |

Applied median TBT fails the unchanged <=200 ms gate in both states (257.096 and 319.957 ms). Median LCP remains below 2,500 ms and score >=0.85. Simulated LCP misses are report-only. Every sample transferred 303,405 first-party bytes and zero third-party bytes, within 500 KB. No performance pass or waiver is claimed; local results are advisory. Windows emitted `ERROR: Access denied` cleanup messages; the actual reported assertion failures are TBT, and after the perf run, independent TCP probes of all six ports 44170-44175 returned ECONNREFUSED and the server PID file was absent.

| Collection / consent / sample | Score | LCP ms | TBT ms |
|---|---:|---:|---:|
| simulated-report-only / unset / 1 | 0.94 | 3051.894 | 28.500 |
| simulated-report-only / unset / 2 | 0.94 | 3031.582 | 33.500 |
| simulated-report-only / unset / 3 | 0.94 | 3037.718 | 39.000 |
| simulated-report-only / unset / 4 | 0.94 | 3077.569 | 56.500 |
| simulated-report-only / unset / 5 | 0.94 | 3096.432 | 40.500 |
| simulated-report-only / accepted / 1 | 0.93 | 3068.268 | 21.500 |
| simulated-report-only / accepted / 2 | 0.94 | 3046.075 | 44.000 |
| simulated-report-only / accepted / 3 | 0.94 | 3042.882 | 49.500 |
| simulated-report-only / accepted / 4 | 0.93 | 3054.560 | 47.500 |
| simulated-report-only / accepted / 5 | 0.94 | 3037.706 | 39.000 |
| applied-blocking / unset / 1 | 0.95 | 2051.204 | 166.884 |
| applied-blocking / unset / 2 | 0.92 | 2263.280 | 246.599 |
| applied-blocking / unset / 3 | 0.89 | 2575.470 | 260.909 |
| applied-blocking / unset / 4 | 0.91 | 2212.471 | 257.096 |
| applied-blocking / unset / 5 | 0.90 | 2202.154 | 308.527 |
| applied-blocking / accepted / 1 | 0.96 | 2018.363 | 120.704 |
| applied-blocking / accepted / 2 | 0.85 | 2675.206 | 319.957 |
| applied-blocking / accepted / 3 | 0.89 | 2301.996 | 274.078 |
| applied-blocking / accepted / 4 | 0.78 | 2839.241 | 543.580 |
| applied-blocking / accepted / 5 | 0.81 | 2222.710 | 578.324 |


## CC apply-time gates - sim, then prod

Supplied evidence (not queried by this task), 2026-10-18: PROD `bgcvurheqzylyfehqgzh` and SIM `jepgzucrvklhqpthowsc` each have zero schema_migrations entries matching landing/order_click/ad_code, absent registry/counter tables and zero increment functions. Latest PROD: 20261017203642 schedule_weeks (0275), 20261017203629 schedule_settings (0274). Latest SIM: 20261017085200 schedule_weeks, 20261017085138 schedule_settings. Thus in-place FILE-ONLY revision authorized; do not infer application from numeric order.

SIM checklist (CC's later authorized runner):

1. Refresh schema_migrations and object-absence evidence; confirm reviewed SQL hash, intended owner, default privileges and independent-session test setup. Stop if objects or migration application appeared meanwhile.
2. Dry-run exact self-contained SQL transactionally with the intended migration owner, inspect objects/grants/constraints/function and ROLLBACK. Verify no leftover objects or lineage entry. Do not pretend PGlite substitutes for the real runner's ACL defaults.
3. Apply exact reviewed SQL through the manual runner, capture schema_migrations version/name and SQL hash. Do not apply 0274/0275 again. Keep flags off.
4. VERIFY all three registry columns, seeds, syntax/slot/reserved CHECKs, FK/no cascade, count PK/positive bigint, four deny policies per table, ENABLE/no FORCE, full table+column ACLs, function owner/security/search_path and EXECUTE restrictions. Verify active code, inactive/unknown fallback and aggregate continuity with synthetic sim data.
5. Independent sessions: competing inserts for one unused slot must produce one winner and 23505 loser; simultaneous increments for one aggregate must have no lost count; increment-first retirement must wait until its SHARE lock releases; retirement-first increment must wait then fall back after commit. Also exercise rollback paths. Record blocking/wait timing, transaction boundaries, exact counts and cleanup. PGlite serializes one connection and proves none of these contention timings.
6. Retain sim dry-run/apply/VERIFY and contention evidence for CC review; only then seek the existing production apply authorization path.

PROD checklist (CC/Juan only, separate authorization): refresh lineage/object absence and record evidence; repeat exact-runner transactional dry-run/rollback and verify no residue; apply reviewed same SQL once with explicit out-of-order lineage; VERIFY owner/RLS/ACLs/constraints/seeds/function and record version/name/hash. Do not create fake production click history for load tests. Stamp the migration header APPLIED TO PROD with date/version/name while retaining authoring gate/provenance. No automatic counter/CAPI/Pixel activation: WAF, privacy, physical-device, real-Pixel perf and release approvals remain independent gates.

## Author inspection (not independent review)

Checked applicable catalog surfaces: BC-002 column grant ceiling/projection; BC-004 active-to-retired and allowed-to-denied tests; BC-007 atomic increment; BC-008 explicit UTC contract (not an operational local-day counter); BC-009 active eligibility; BC-017/051 removal of static vocabulary across consumers; BC-023 append-only registry allocation; BC-030 synthetic fixtures distinguished from real contention; BC-037 unique-slot races; BC-038 unapplied evidence and pre-migration fallback; BC-042 revised SEO/staff boundary; BC-055 parameterized exact lookup; BC-056 PUBLIC/default function ACL revocation; BC-057 fixed timeout/outage fallback; BC-058 bounded async lookup and post-await consent; BC-061 no cross-request eligibility cache. BC-043 remains an external gate: author checks are not CC's cross-family approval.

## Open risks and handoff

Independent-session contention, CC cross-family final review, exact-revision CI and public HTTPS/device/real-Pixel release gates remain external. This work provides no connected DB or production application evidence. Local perf is advisory under unchanged applied throttling; "Registry failure is NOT a score."

Branch/worktree: `feat/landing-v2`, `C:/Users/conta/co-ops-landing`; all changes remain uncommitted.
