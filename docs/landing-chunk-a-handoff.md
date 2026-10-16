# Landing phase 1 — chunk A handoff

Historical Chunk A base: approved r4 `051d5100`; reviewed implementation `df131fa7`. Current branch: `feat/landing-p1`.
Worktree: `C:/Users/conta/co-ops-landing`.
All implementation changes are UNCOMMITTED. No fetch, push, merge, deployment, resources, production reads/writes, or remote migration apply.

## Delivered scope

A1–A5: seven-section bilingual skeleton and privacy page; strict host-first routing; tenant config and exact native ordering links; consent/attribution/offers; browser Pixel and dormant CAPI; independent increment-only click counter; production browser harness and conditional CI gates. Real assets, motion, final shop facts, offers and paid activation remain later gates.

## Files

- Routing/security: `proxy.ts`, `next.config.ts`, `instrumentation.ts`, `lib/security-headers.ts`, `lib/landing/host-shared.ts`. R5 deletes `lib/landing/vary-server.ts` and its test, restoring instrumentation.ts to 051d5100.
- Shell/config: `config/tenant/landing.ts`, `lib/landing/config.ts`, `lib/landing/links.ts`, `lib/landing/stores.ts`, `lib/landing/language-shared.ts`, `app/eat/{layout,page}.tsx`, `app/eat/privacy/page.tsx`, `components/landing/LanguageToggle.tsx`, both `lib/i18n/{en,es}.json`.
- Progressive enhancement: `components/portal/{Reveal,FaqItem}.tsx`.
- Browser measurement: `lib/landing/{attribution-shared,consent-shared,offers,tracking-client}.ts`, `components/landing/{ConsentNotice,TrackingProvider,SectionView,OrderLink,OfferCode}.tsx`.
- Server measurement: `app/api/landing/{events,order-click}/route.ts`, `lib/landing/{request-server,meta-server,rate-limit,tracking-schema-shared,order-click-server,order-click-shared}.ts`.
- File-only SQL: `supabase/migrations/0273_landing_order_click_counts.sql`; local proof `scripts/landing/order-click-sql-check.ts`.
- Tooling: `.env.example`, `.gitignore`, `package.json`, `package-lock.json`, `playwright.config.ts`, `lighthouserc.cjs`, `.github/workflows/landing-checks.yml`, `scripts/landing/{e2e-server.mjs,e2e-teardown.ts,performance-report.ts}`.
- Tests: all `tests/landing/*`, `tests/e2e/landing/*`, `tests/live/landing-links.probe.ts`; additions to `tests/security-headers.test.ts` and `tests/sim-isolation.test.ts`.
- Supporting documentation: `docs/dependency-baseline.md`, `docs/tracking.md`, this handoff.

## Historical verification of Chunk A at df131fa7 (not the r5 rerun)

- `npm run build`: passed (Next16.2.4 production build).
- `npx vitest run tests/landing --pool=threads --no-cache --maxWorkers=3`: 18 files, 163 tests passed.
- `LANDING_E2E_USE_BUILD=1 npm run test:e2e`: 52 tests passed across Chromium and WebKit against the freshly completed production build. CI defaults to building before starting both servers.
- `npx vitest run --pool=threads --no-cache --maxWorkers=3`: 636 files passed, 1 skipped; 9,804 tests passed, 3 skipped (9807 total).
- `npx tsc --noEmit --incremental false`: passed, exit 0 with no diagnostics.
- `git diff --check`: passed.
- `npm run perf:ci`: blocked (LHCI package unavailable offline; registry access denied). No Lighthouse score claimed.

TDD red runs were observed for missing host/config/tracking/server modules, progressive visibility, dataset matching and preserved fbclid timestamps. The first full run overlapped authoring and caught transient new-test failures. The second full run caught the deliberately red timestamp regression plus an existing vendor-export test timeout under load. No preexisting test expectations have been relaxed.

`node --experimental-strip-types scripts/landing/order-click-sql-check.ts`: the isolated SQL harness passed 25 checks and 100 concurrently submitted increments. PGlite uses one serialized connection; independent-session Postgres contention remains a separate activation gate.

The first complete browser run proved both-browser axe AA, translated sections, JS-off/native links, consent/DNT/GPC, deduplicated event IDs and dormant endpoints. It exposed Next's pre-proxy slash redirect and overwritten Host Vary. The original workarounds passed those 52 tests, but Aggie later found the slash loop and the lead rejected the Vary guard. R5 replaces both; historical passing counts do not certify those fixes.

## Deviations and review points

- Existing `npm ci` was completed by the lead. Runtime Node22.20.0; framework/React versions retained.
- `axe-core`4.11.3 already existed in the lockfile and is now an explicit dependency; Playwright injects it directly. New wrapper/LHCI installs were blocked by registry EACCES and offline ENOTCACHED. `perf:ci` is pinned to LHCI0.15.1 but produced no score; transitive dependency/engine resolution remains open.
- Default browser installation failed EPERM creating its cache lock. Existing Chromium/WebKit binaries launched and were used.
- Browser ports moved from occupied3100 to43170/43171; test servers use synthetic auth material and no DB/provider credentials.
- R5 removes the Node Vary guard and restores pre-Chunk-A instrumentation verbatim. Landing HTML/RSC is private, no-store; Vercel CDN keys by host; no Vary: Host. Host-specific content and cache-policy assertions replace the guard assertions.
- R5 restores Next stock slash canonicalization and removes the looping proxy 308. Canonical follow-up requests still run host isolation; same-host redirects reveal no staff content.
- Coordinates do not exist in the current locations schema. Public loader explicitly selects code/name/address/phone; coordinates/hours remain null tenant-config fields pending D2. Skeleton renders no invented shop facts and does not query live locations.
- No real assets or offers were introduced. Merchant probe refuses to certify a200 SPA shell without branch payload/manual serving-option evidence.

## Open launch gates

CC cross-family review; merchant link/branch/serving-option and branded-host equivalence evidence; final media/shop facts; Lighthouse measured performance; WAF entitlement/ingress/rule/burst proof before CAPI activation; approved disclosure and real Meta Test Events/custom conversion; real SDK cookie-domain and withdrawal verification; independent-session SQL contention and CC/Juan migration review/application. Pixel-only launch remains allowed if WAF/CAPI is unavailable. The counter needs its own explicit activation after migration; no unique-user/purchase claims.


## R5 review handoff notes

Invalid/unparseable Host or disagreement with X-Forwarded-Host now requires STAFF fallback, landing/tracking dormant and a PII-free warning; it must not 404 the whole app. Empty/absent LANDING_HOSTS preserves existing staff routing. The production ingress smoke remains an activation gate because disagreement disables the landing, not the staff app.

The six activation names are now explicit in the r5 plan table. META_GRAPH_API_VERSION is pinned to v25.0 in code, so env-only upgrades cannot activate another version. LANDING_COUNTER_ENABLED stays false until reviewed 0273 application and independent-session verification; early enablement yields 503 on eligible counter requests without delaying navigation. Migration 0273 remains file-only.

P3-8 (observation only): Aggie observed /_next/image returning 400 for the tested local and absolute image URLs on both hosts at df131fa7. The allowlist was inert for those requests; this is not approval of optimizer behavior for B2/B3. The planned LCP poster bypasses optimization.

Current r5 verification results are to be recorded by the implementing lead after the required reruns. Historical numbers above are not new test claims.

R5 isolated SQL verification: `node --experimental-strip-types scripts/landing/order-click-sql-check.ts` passed 31 checks and 100 concurrently submitted increments. The six new checks assert REFERENCES/TRIGGER ceilings for anon, authenticated and service_role. Migration 0273 was not changed or applied. `git diff --check` passed at the documentation/SQL handoff.
