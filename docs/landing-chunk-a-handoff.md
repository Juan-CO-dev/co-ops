# Landing phase 1 — chunk A handoff

Branch: `feat/landing-p1` at approved r4 `051d5100`.
Worktree: `C:/Users/conta/co-ops-landing`.
All implementation changes are UNCOMMITTED. No fetch, push, merge, deployment, resources, production reads/writes, or remote migration apply.

## Delivered scope

A1–A5: seven-section bilingual skeleton and privacy page; strict host-first routing; tenant config and exact native ordering links; consent/attribution/offers; browser Pixel and dormant CAPI; independent increment-only click counter; production browser harness and conditional CI gates. Real assets, motion, final shop facts, offers and paid activation remain later gates.

## Files

- Routing/security: `proxy.ts`, `next.config.ts`, `instrumentation.ts`, `lib/security-headers.ts`, `lib/landing/host-shared.ts`, `lib/landing/vary-server.ts`.
- Shell/config: `config/tenant/landing.ts`, `lib/landing/config.ts`, `lib/landing/links.ts`, `lib/landing/stores.ts`, `lib/landing/language-shared.ts`, `app/eat/{layout,page}.tsx`, `app/eat/privacy/page.tsx`, `components/landing/LanguageToggle.tsx`, both `lib/i18n/{en,es}.json`.
- Progressive enhancement: `components/portal/{Reveal,FaqItem}.tsx`.
- Browser measurement: `lib/landing/{attribution-shared,consent-shared,offers,tracking-client}.ts`, `components/landing/{ConsentNotice,TrackingProvider,SectionView,OrderLink,OfferCode}.tsx`.
- Server measurement: `app/api/landing/{events,order-click}/route.ts`, `lib/landing/{request-server,meta-server,rate-limit,tracking-schema-shared,order-click-server,order-click-shared}.ts`.
- File-only SQL: `supabase/migrations/0273_landing_order_click_counts.sql`; local proof `scripts/landing/order-click-sql-check.ts`.
- Tooling: `.env.example`, `.gitignore`, `package.json`, `package-lock.json`, `playwright.config.ts`, `lighthouserc.cjs`, `.github/workflows/landing-checks.yml`, `scripts/landing/{e2e-server.mjs,e2e-teardown.ts,performance-report.ts}`.
- Tests: all `tests/landing/*`, `tests/e2e/landing/*`, `tests/live/landing-links.probe.ts`; additions to `tests/security-headers.test.ts` and `tests/sim-isolation.test.ts`.
- Supporting documentation: `docs/dependency-baseline.md`, `docs/tracking.md`, this handoff.

## Verification

- `npm run build`: passed (Next16.2.4 production build).
- `npx vitest run tests/landing --pool=threads --no-cache --maxWorkers=3`: 18 files, 163 tests passed.
- `LANDING_E2E_USE_BUILD=1 npm run test:e2e`: 52 tests passed across Chromium and WebKit against the freshly completed production build. CI defaults to building before starting both servers.
- `npx vitest run --pool=threads --no-cache --maxWorkers=3`: 636 files passed, 1 skipped; 9,804 tests passed, 3 skipped (9807 total).
- `npx tsc --noEmit --incremental false`: passed, exit 0 with no diagnostics.
- `git diff --check`: passed.
- `npm run perf:ci`: blocked (LHCI package unavailable offline; registry access denied). No Lighthouse score claimed.

TDD red runs were observed for missing host/config/tracking/server modules, progressive visibility, dataset matching and preserved fbclid timestamps. The first full run overlapped authoring and caught transient new-test failures. The second full run caught the deliberately red timestamp regression plus an existing vendor-export test timeout under load. No preexisting test expectations have been relaxed.

`node --experimental-strip-types scripts/landing/order-click-sql-check.ts`: the isolated SQL harness passed 25 checks and 100 concurrently submitted increments. PGlite uses one serialized connection; independent-session Postgres contention remains a separate activation gate.

The first complete browser run proved both-browser axe AA, translated sections, JS-off/native links, consent/DNT/GPC, deduplicated event IDs and dormant endpoints. It exposed Next's pre-proxy slash redirect and overwritten Host Vary. Those defects were fixed; all 52 tests passed on the final production rerun.

## Deviations and review points

- Existing `npm ci` was completed by the lead. Runtime Node22.20.0; framework/React versions retained.
- `axe-core`4.11.3 already existed in the lockfile and is now an explicit dependency; Playwright injects it directly. New wrapper/LHCI installs were blocked by registry EACCES and offline ENOTCACHED. `perf:ci` is pinned to LHCI0.15.1 but produced no score; transitive dependency/engine resolution remains open.
- Default browser installation failed EPERM creating its cache lock. Existing Chromium/WebKit binaries launched and were used.
- Browser ports moved from occupied3100 to43170/43171; test servers use synthetic auth material and no DB/provider credentials.
- Next16.2.4 overwrites Vary in its generated app-page handler. A runtime Node header guard preserves only the proxy's existing Host token; staff responses are unchanged. This additional `instrumentation.ts` integration needs CC review and deployment verification, and should be removed once Next preserves Vary itself.
- Next's slash normalization otherwise precedes host isolation. Disabled that global pre-proxy redirect and retained staff308 behavior inside proxy after host checks.
- Coordinates do not exist in the current locations schema. Public loader explicitly selects code/name/address/phone; coordinates/hours remain null tenant-config fields pending D2. Skeleton renders no invented shop facts and does not query live locations.
- No real assets or offers were introduced. Merchant probe refuses to certify a200 SPA shell without branch payload/manual serving-option evidence.

## Open launch gates

CC cross-family review; merchant link/branch/serving-option and branded-host equivalence evidence; final media/shop facts; Lighthouse measured performance; WAF entitlement/ingress/rule/burst proof before CAPI activation; approved disclosure and real Meta Test Events/custom conversion; real SDK cookie-domain and withdrawal verification; independent-session SQL contention and CC/Juan migration review/application. Pixel-only launch remains allowed if WAF/CAPI is unavailable. The counter needs its own explicit activation after migration; no unique-user/purchase claims.
