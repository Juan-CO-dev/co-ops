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
| `git diff --check` | CORRECTED in Round B: the original HEAD claim was inaccurate; `git diff --check 2eb38e1b 6751c487` failed on the trailing blank line in ad-codes-shared.ts. See Round B for whole-chunk verification. |

The 13 skips are 12 existing Windows/WebKit decoder cases plus one Chromium-only native playback case. No new skip or retry was added; no physical iPhone decoder pass is claimed. The earlier full browser run also passed 500/13 in 18.3 minutes before the pure-module move; the final run above covers the final application. Raw final ports 44170-44175 all returned ECONNREFUSED after teardown; PID file absent.

Intermediate verification history: migration regression initially 2 failed / 2 passed, then 4 passed after implementation. First TypeScript run failed on new test annotations (TS18046 unknown row and TS2345 optional header values), corrected before successful rerun. One unit rerun had 433 passed / 1 timeout at `performance-blocking.test.ts:36`, source-file scan: `Error: Test timed out in 30000ms.` Isolated unchanged retry passed 5 tests in 455 ms; full unchanged rerun passed all 434 then-existing tests, and final full run passed all 435. No timeout/assertion was weakened. A suspected JS trailing-line-break acceptance did NOT reproduce: added newline/CR/CRLF tests passed on the existing validator; no validator rewrite was made. These cases also pass the SQL registry CHECK.

Original Round A 0273 SHA-256 (workspace bytes, superseded by Round B below): `89b1c10ea264817b18afd67470c649ab3771b51650d28065a522a5436397fd67`. CC must compare against the final reviewed SQL artifact at apply time, accounting for any Git line-ending normalization.

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

## Round B — Aggie's P3s only (2026-10-18)

CC's eleven rulings are the bounded implementation plan. Starting HEAD: `6751c487`.

| Finding | Resolution and regression evidence |
|---|---|
| P3-1 | `proxy.ts`: production alias 301 applies only to document rewrite/redirect decisions. All three API POSTs and assets/icons stay in place with noindex; alias robots disallows and sitemap is empty. Unit and browser indexing coverage updated. |
| P3-2 | Alias `/eat` and `/eat/privacy` map directly to canonical `/` and `/privacy`, preserving search. Unit tests follow the redirect and assert no second hop. |
| P3-3 | Removed the final blank line from `ad-codes-shared.ts`; corrected the original verification row above. Whole-chunk check uses `git diff --check 2eb38e1b`. |
| P3-4 | Ad-code route consults `landingRateLimit(env)` before resolving: refused 429, unavailable 503, matching sibling semantics. Tests prove no lookup on refusal. BUILD §10 retains the 20/min edge rule as a launch item, not deployed enforcement. |
| P3-5 | Home SSR loads stores and resolves ad concurrently. Shared SSR resolver uses 300 ms on home/privacy; CAPI/default remains 750 ms and client abort remains 1 s. Tests exercise concurrent starts, real SSR abort/fallback, privacy fallback and unchanged default timeout. |
| P3-6 | 0273 has explicit begin/commit, a P0001 owner-equality assertion against both tables, and an intentionally non-idempotent re-application warning. PGlite proves normal application, each mismatch, full-wrapper rollback and re-application refusal. |
| P3-7 | No index added. SQL documents expected `unindexed_foreign_keys` for `ad_code`: no parent DELETE/code-UPDATE grant and an index would add hot-increment write cost. See advisor checklist below. |
| P3-8 | `structured-data-shared.ts` owns optional inventory lookup. Missing `v2-p013-1280` omits only image, preserving the remaining nodes; unit regression covers this. |
| P3-9 | Proxy strips/rebuilds `x-landing-explicit-language`; only explicit single valid lang determines canonical. Accept-Language selects rendering. Landing HTML is private, no-store; no Node header adapter remains (CC gate amendment below). |
| P3-10 | Tracker buffers at most ten calls in memory during enable, keeping original event IDs/times and flushing with resolved ad after Pixel initialization. Withdrawal/unmount/new generation clears via consent reset. Unit tests pin bound, section dedup, no repeat flush and withdrawal/generation clearing; browser tests click during lookup and verify resolved dispatch or withdrawal drop. Native links remain immediate. |
| P3-11 | Rejected Host matching a listed landing hostname after lowercasing, port removal and exactly one trailing-dot removal returns 404/noindex. It is never promoted to a parsed authority. Tests prove listed failures and byte-identical staff responses for unlisted/malformed non-landing Hosts. |

0273 remains **FILE ONLY, NOT APPLIED**. Workspace SHA-256: `816e21522ab54c6878e0e4967b57d71e8c82142238f3b3a7842c4258b48a2e35`.

CC post-apply advisor checklist addition: expect `unindexed_foreign_keys` on `landing_order_click_counts.ad_code`; compare it to the reviewed SQL annotation and verify no DELETE/code-UPDATE grant was introduced. Do not add an index merely to silence this accepted lint. All existing owner/ACL/RLS and independent-session sim gates still apply.

### Round B verification

| Command | Outcome / evidence |
|---|---|
| `node --experimental-strip-types scripts/landing/order-click-sql-check.ts` | PASS, 174 checks, isolated PGlite; `tmp/round-b-sql.log`. |
| `npm.cmd test -- tests/landing tests/security-headers.test.ts --maxWorkers=2` | SUPERSEDED: pre-revert result, not evidence for the final round-B tree; `tmp/round-b-unit-final.log`. |
| `npm.cmd run typecheck` | PASS; `tmp/round-b-tsc-final.log`. |
| `npm.cmd run assets:check` | PASS, 45 assets; `tmp/round-b-assets.log`. No asset bytes changed. |
| Changed-file `npx.cmd eslint` including new files | PASS, zero errors / one existing page no-img-element warning; `tmp/round-b-eslint-final.log`. |
| `npm.cmd run build` | PASS; `tmp/round-b-build-final.log`. |
| `LANDING_E2E_USE_BUILD=1 npx.cmd playwright test --workers=2` | PASS, 504 passed / 13 existing skips / zero failures, 18.2 minutes; `tmp/round-b-e2e-final.log`, `playwright-report/index.html`. No skips/retries added. |
| `git diff --check 2eb38e1b` | PASS, exit 0, whole chunk through working tree. |
| `npm.cmd run perf:ci` (exactly once) | ADVISORY FAIL, exit 1, applied median TBT above 200 ms in both states; `tmp/round-b-perf.log`. No retry or threshold/throttling change. |

Browser and perf runs used explicit `CHROME_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe` and `LANDING_PERF_NO_SANDBOX=1`. Perf also used process-local `LANDING_E2E_USE_BUILD=1` and `LHCI_CLI_PATH=C:/Users/conta/AppData/Local/npm-cache/_npx/7c4c7312e9ccc7bf/node_modules/@lhci/cli/src/cli.js`. After both teardowns all six ports 44170–44175 returned ECONNREFUSED and the PID file was absent; final evidence: `tmp/round-b-teardown.json`. Scoped iPhone WebKit is not physical-device evidence.

### Round B advisory performance — one run, exit 1

All 20 cold samples, including failures, remain in `tmp/landing-performance/2026-10-18T18-47-17.826Z-merge-f4d9bbe2` (four JSON summaries and raw reports). Pixel was blocked by the harness: first-party-only evidence, no real-Pixel performance claim.

| Collection / consent | Median score | Median LCP ms | Median TBT ms | Exit / failed metric |
|---|---:|---:|---:|---|
| simulated-report-only / unset | 0.94 | 3059.697 | 52.000 | 0 / lcp |
| simulated-report-only / accepted | 0.93 | 3057.976 | 46.000 | 0 / lcp |
| applied-blocking / unset | 0.92 | 2247.325 | 219.127 | 1 / tbt |
| applied-blocking / accepted | 0.90 | 2238.155 | 249.885 | 1 / tbt |

Applied median TBT fails the unchanged <=200 ms gate. Applied median LCP and score pass; simulated LCP misses remain report-only. Each sample transferred 303,594 first-party bytes and zero third-party bytes, within 500 KB. Windows emitted `ERROR: Access denied` cleanup diagnostics, but all 20 samples completed and independent final port probes prove no test server remains. No perf pass or waiver is claimed. "Registry failure is NOT a score."

Open gates: CC's cross-family review, independent-session SQL contention and later authorized sim/prod apply, WAF/Meta activation, real-Pixel/device evidence and deployed HTTPS header smoke. No release action is authorized by these local results.

One harness-authoring failure was corrected before its passing rerun: JavaScript string replacement interpreted SQL `$$` as replacement syntax, producing a syntax error in the mismatch fixture. A replacement callback now preserves the literal SQL delimiter. No migration failure was hidden or assertion weakened.

The first browser run exposed two stale host expectations (alias assets redirecting and listed trailing-dot Hosts serving staff) and the real Next Vary overwrite. It was stopped, its recorded servers closed, the expectations corrected to CC's rulings, and the Node header-preservation adapter added before rebuilding. The adapter and wire assertion were subsequently removed under the gate amendment below. Evidence: `tmp/round-b-e2e.log`. Initial tsc/build briefly overlapped due to starting build before the typecheck session had exited; subsequent heavy verification runs are serialized.

Branch/worktree: existing `feat/landing-v2`, `C:/Users/conta/co-ops-landing`. Creating `fix/landing-v2-chunk9-round-b` was denied by the sandbox's read-only `.git`; no branch was created. All work remains uncommitted, with no push, merge, deployment, environment change or connected database action.

### CC gate amendment (round B)
CC rejected the `instrumentation.ts` + `lib/landing/vary-server.ts` Node `ServerResponse.prototype.setHeader` patch: it is process-wide (staff included), reaches outside the landing surface, and is fragile across Next/runtime upgrades, all to add a defensive header to a `private, no-store` response. Reverted: `instrumentation.ts` restored byte-identical; `vary-server.ts`, its test, the proxy `Vary` append and both Vary assertions removed. The e2e now asserts landing HTML stays `no-store`. P3-9's real fix (canonical from the explicit `lang` only) is kept. BUILD.md §8 records the cacheability prerequisite. The former P3-9 adapter claim has been removed; this amendment records its rejection.


## Round C - Aggie's round-B residuals only (2026-10-18)

CC's supplied rulings are the bounded implementation plan; starting HEAD `d9ca0c12`, existing branch `feat/landing-v2`.

- P3-B/C: `proxy.ts` excludes the configured staff hostname from rejected-authority 404s and preserves bracketed IPv6 while removing its optional port. Differential tests compare staff status, public headers and body for a listed staff host with a trailing dot, `[::1]`, `[::1]:3000` and `[2001:db8::1]:443`.
- P3-D: `tracking-client.ts` sends resolving-window OrderClick/CateringClick immediately to enabled server transports with unattributed, original ID/time and cookies at click time. These events never enter the buffer or Pixel. After sending, the provider invalidates the pending enable generation: WebKit can reject the lookup on navigation before unmount, and that rejection must not initialize Pixel or flush the departing page. Counter eligibility remains unchanged (store OrderClick only). Transport retains keepalive and same-origin credentials and now explicitly sets no-store. Unit contracts cover both actions, disabled CAPI, absent approval and no duplicate flush. The browser regression follows the actual ordering anchor without preventDefault or href replacement; both analytics endpoints use real Next handlers, with a test-only HTTP relay recording their response statuses after unload. The relay models TLS termination for the HTTPS-configured local fixture; neither analytics POST is fulfilled through browser routing.
- P3-E: `TrackingProvider.tsx` supplies a details factory, so buffered Lead intent reads resolved attribution and current cookies at flush. The contract/browser tests pin original ID/time and the fbc derived from the captured fbclid. Section views and withdrawal/generation clearing remain buffered as before.
- P3-F (documentation only): ad-code retains order-click WAF semantics: dormant/unverified pass; refused/unavailable block. Attribution therefore works before attestation. A transient unavailable permanently drops that visit's campaign by design: URL sanitization and persisted unattributed, no retry. Recorded in BUILD section 10; no route change.
- P3-A: removed obsolete adapter claims and marked the pre-revert unit row superseded. The verification below belongs to the final Round C tree. No Node/global patch; instrumentation and 0273 are untouched.

### Round C verification

No production, DB, Vercel, persistent env, asset or performance-budget changes. Heavy jobs ran serially; Vitest/Playwright used two workers.

| Command | Final-tree outcome / evidence |
|---|---|
| `npm.cmd test -- tests/landing tests/security-headers.test.ts --maxWorkers=2` | PASS, 57 files / 456 tests; includes host/staff differential tests. `tmp/round-c-unit-final.log`. The reported `performance-blocking.test.ts:36` timeout did not recur in either full Round C unit run. |
| `npm.cmd run typecheck` | PASS, exit 0; `tmp/round-c-tsc-final.log`. |
| `npm.cmd run assets:check` | PASS, 45 assets; `tmp/round-c-assets-final.log`. |
| `node node_modules/eslint/bin/eslint.js` on all seven changed TS/TSX files | PASS, zero warnings/errors; `tmp/round-c-eslint-verified.log`. |
| `npm.cmd run build` | PASS, final application build; `tmp/round-c-build-final.log`. |
| `LANDING_E2E_USE_BUILD=1 node node_modules/@playwright/test/cli.js test --workers=2` | PASS, 506 passed / 13 existing skips / zero failures, 18.1 minutes. `tmp/round-c-e2e-verified.log`, native exit `0` in `tmp/round-c-e2e-verified.exit`, `playwright-report/index.html`. No skips/retries added. |
| `git diff --check 2eb38e1b` | PASS, whole chunk through working tree; `tmp/round-c-diff-check.log`. |
| Byte comparisons | `instrumentation.ts` equals HEAD and `2eb38e1b` byte-for-byte (SHA-256 `001065f84da4768163dcaaaf10d27c0027ea1f9fa43c1daac6ca41ed9e5d3e6d`). 0273 equals HEAD byte-for-byte (SHA-256 `816e21522ab54c6878e0e4967b57d71e8c82142238f3b3a7842c4258b48a2e35`); no migration edit in Round C. `tmp/round-c-invariants.json`. |

Browser/perf commands use explicit `CHROME_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe` and `LANDING_PERF_NO_SANDBOX=1`. Final e2e teardown: all six ports 44170-44175 ECONNREFUSED and PID file absent (`tmp/round-c-e2e-teardown.json`).

Earlier failures retained, not counted as passes:

- Initial changed-file ESLint found two prefer-const errors in the new test fixture; fixed before final lint/tests.
- The first full e2e attempt stopped before tests on the existing 60-second readiness timeout (`tmp/round-c-e2e.log`). Recorded servers were closed and all six ports refused connections before rerunning; no timeout change.
- The next full run had 504 passes / 13 skips / two failing new native-navigation assertions (`tmp/round-c-e2e-browser-observer.log`). Page response listeners could not establish receipt after unload, so the final test observes the real handler responses at the relay.
- Targeted relay runs exposed invalid three-digit fixture cookie timestamps (corrected to valid 13-digit values), an overly early synchronous click that canceled lookup before server receipt, and the real WebKit lookup-cancellation/Pixel race. Logs: `tmp/round-c-native-targeted.log`, `tmp/round-c-native-final.log`, `tmp/round-c-native-synchronous.log`, `tmp/round-c-native-receipt.log`. The provider generation fix makes the strict zero-Pixel assertion pass; no production timeout or assertion relaxed. Final complete tracking spec: 20 passed (`tmp/round-c-tracking-final.log`); the final full-suite native exit above is the authoritative browser gate.


### Round C advisory performance - one run, exit 1

`npm.cmd run perf:ci` ran exactly once, using the Chrome/no-sandbox settings above, `LANDING_E2E_USE_BUILD=1`, and process-local `LHCI_CLI_PATH=C:/Users/conta/AppData/Local/npm-cache/_npx/7c4c7312e9ccc7bf/node_modules/@lhci/cli/src/cli.js`. Evidence: `tmp/round-c-perf.log`, `tmp/round-c-perf.exit`; all 20 cold samples and raw reports retained in `tmp/landing-performance/2026-10-18T20-16-16.420Z-merge-ab707547`. No rerun, discarded sample or budget change.

| Collection / consent | Median score | Median LCP ms | Median TBT ms | Exit / failed metric |
|---|---:|---:|---:|---|
| simulated-report-only / unset | 0.94 | 3061.320 | 43.000 | 0 / lcp |
| simulated-report-only / accepted | 0.93 | 3032.153 | 34.500 | 0 / lcp |
| applied-blocking / unset | 0.90 | 2282.684 | 247.723 | 1 / tbt |
| applied-blocking / accepted | 0.91 | 2169.854 | 253.612 | 1 / tbt |

Applied median TBT exceeds the unchanged 200 ms budget in both consent states: **advisory FAIL**, not a perf pass or waiver. Applied median score/LCP pass; simulated LCP misses remain report-only. Each sample transferred 303,682 first-party bytes and zero third-party bytes, within 500 KB. Pixel was blocked by the harness: no real-Pixel performance claim. Windows emitted access-denied cleanup diagnostics; all 20 samples completed. Independent final teardown confirms all six ports 44170-44175 ECONNREFUSED and the PID file absent (`tmp/round-c-final-teardown.json`). Each native-navigation test also closes its temporary relay in finally.

Open risks/gates: local advisory TBT failure, CC cross-family review, and the existing later operator-owned WAF/Meta, real-device/real-Pixel, deployed HTTPS and sim/prod gates. No database action was performed. Registry failure is NOT a score.

Branch/worktree: `feat/landing-v2` at `d9ca0c12`, `C:/Users/conta/co-ops-landing`. All nine changed files remain **UNCOMMITTED**. No push, merge or deployment.
