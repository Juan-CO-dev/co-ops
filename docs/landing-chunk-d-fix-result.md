# Chunk-D fix round evidence

Base: feat/landing-p1, 8720af81. All changes uncommitted.

## Rulings

- P1: chunk E already includes lineup in the client/server placement contract and its native click Pixel/CAPI/counter browser test. Placement discovery now includes the new footer OrderLink too.
- P2: stores.ts refuses result errors, rejected queries and client-construction errors with one fixed class/message, never raw provider text. The page omits shops and footer addresses on failure; hero, lineup and catering remain.
- P3-1: not-found uses the already-approved SVG wordmark. Inventory provenance stays unchanged.
- P3-2/3: explicit icon rewrite handling replaces the redundant brand clause. Brand/robots/sitemap cache for 300 seconds; landing APIs use no-store. Staff routing is unchanged.
- P3-4/10/11: config and NearbyShop share nearbyEnabled. Real coordinates remain null. The browser fixture builds a separate copy with coordinates and checks the final merged Permissions-Policy on landing and staff.
- P3-5: footer delivery keys map to ubereats/doordash and dispatch through OrderLink at footer placement, without inventing a shop for the counter.
- P3-6: tracked-image hygiene no longer ignores missing working-tree files.
- P3-7: debug.log is absent/untracked; git check-ignore debug.log confirms *.log coverage already landed.
- P3-8: keyboard scrolling starts from an asserted zero and must move after ArrowRight. The final-card geometry assertion remains.
- P3-9: en/es fallback says any of our shops / cualquiera de nuestras tiendas.
- P3-12: assets/ was already included in landing-checks.yml at the supplied base.
- P3-13: staff-root caching left for CC's separate check.
- P3-14: no visible classification labels added; Juan's explicit ruling applies.

## Verification

- Red tests: 5 expected failures across loader failures, cache policy and 404 asset; separate footer test failed with zero tracked links instead of two.
- npx.cmd vitest run tests/landing tests/co-scenes-route.test.ts --maxWorkers=3: 33 files, 265 tests passed.
- npx.cmd vitest run --pool=threads --no-cache --maxWorkers=3: 650 files passed, 1 skipped; 9,880 tests passed, 3 skipped, zero failures (final rerun: 229.10 seconds; initial run also passed).
- npx.cmd tsc --noEmit --incremental false: exit 0, zero diagnostics.
- npm.cmd run build: exit 0, production Turbopack build.
- With LANDING_E2E_USE_BUILD=1 and LANDING_E2E_PORT_BASE=45170, npx.cmd playwright test: exit 0; Chromium + WebKit, 151 passed / 5 skipped / 0 failures (8.9 minutes including the isolated production fixture build). The five skips are the existing non-Darwin WebKit H.264 decode case and four decoder-proof cases; real-iPhone preview verification remains a launch gate.
- Final TypeScript recheck after the harness changes: exit 0, zero diagnostics. Final landing unit recheck: 33 files / 265 passed.
- Harness troubleshooting: early attempts exposed fixture-copy omissions (font/network import, then a staff action dependency); fixed by copying the complete tracked application. These were harness failures before browser tests ran. A subsequent launch encountered ports occupied by another process; it was not terminated. A later port race let Playwright start against that other runner while this fixture was still building; that browser run is invalid and is not counted as evidence. The harness now waits for its own four server readiness messages and supports LANDING_E2E_PORT_BASE (default unchanged); this run uses 45170-45175. PID files are also isolated by port base.

No migration, environment-file, deployment, push or merge changes. 0273 remains file-only. CC/Aggie external review remains the handoff gate.

Local logs (ignored): tmp-landing-unit-final.log, tmp-landing-full-final.log, tmp-landing-tsc-final.log, tmp-landing-build.log, tmp-landing-e2e-isolated.log. Browser trace/report artifacts are in the ignored playwright-report and test-results directories.

## Files left for review

- .gitignore
- app/eat/page.tsx
- app/not-found.tsx
- components/landing/Footer.tsx
- components/landing/NearbyShop.tsx
- lib/i18n/en.json
- lib/i18n/es.json
- lib/landing/config.ts
- lib/landing/nearby-shared.ts
- lib/landing/stores.ts
- playwright.config.ts
- proxy.ts
- scripts/landing/e2e-server.mjs
- scripts/landing/e2e-teardown.ts
- tests/co-scenes-route.test.ts
- tests/e2e/landing/cache.spec.ts
- tests/e2e/landing/cookies.spec.ts
- tests/e2e/landing/dedup.spec.ts
- tests/e2e/landing/hero.spec.ts
- tests/e2e/landing/host-isolation.spec.ts
- tests/e2e/landing/lineup.spec.ts
- tests/e2e/landing/performance.spec.ts
- tests/e2e/landing/tracking.spec.ts
- tests/e2e/landing/vault-regression.spec.ts
- tests/landing/cache-inventory.test.ts
- tests/landing/nearby.test.ts
- tests/landing/placements.test.ts
- docs/landing-chunk-d-fix-plan.md
- docs/landing-chunk-d-fix-result.md
- scripts/landing/e2e-nearby-fixture.mjs
- scripts/landing/e2e-ports.cjs
- tests/e2e/landing/review-regressions.spec.ts
- tests/landing/footer-tracking.test.ts
- tests/landing/not-found.test.ts
- tests/landing/stores-failure.test.ts
