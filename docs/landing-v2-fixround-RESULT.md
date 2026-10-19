# LANDING v2 - fix round

Branch `feat/landing-v2`, dedicated clone `C:/Users/conta/co-ops-landing`, baseline `3708d0f3`. Changes are UNCOMMITTED. No push, merge, deploy or production-data changes.

## Changes and review dispositions

- A1: the missing fifth footer destination was Uber Eats, intentionally moved by CC's chunk-3b ruling to the loaded Dupont shop card. Keep that behavior. The browser test now checks the four exact footer navigation URLs, the exact Uber Eats URL at Dupont, and its absence from the footer. No destination is silently dropped.
- A2: the stray button belongs to the separate, explicitly played illustrated spin introduced in v2, not failed SUBDEX playback. Preserve that working control. The rejection test now requires an actual rejected SUBDEX play attempt, the retained still, no SUBDEX video/control, no pre-Play spin video, and exactly one independent spin Play button.
- A3 / P2-2: reproduced the Privacy link at exactly 14px in both engines. It is now a centred 44px control in the consent action row. No-JS and 200% text tests include aside links. The shell also now asserts all eight section IDs: chunk 4 added crave after the old seven-section assertion.
- P2-1: restore permission, conditional Meta sharing and advertising purpose in both consent notices. The notice still says ordering works either way. Correct the false preservation claim in `docs/landing-v2-chunk3b-RESULT.md`. Unit tests pin all four meanings in en/es.
- C: crave, lineup, Field Guide and SUBDEX use light underlined native shop-link pairs, the explicitly permitted text-pair option. Their tracking placements, store keys, hrefs and no-JS behavior remain. Hero, sticky and catering controls remain; the requested final direct-order footer pair was absent at baseline and is now present for loaded shops only. No texture/Field Guide restyling.
- P3-1: extract and test the actual exporter verdict decision on every platform, including changed-byte refusal and pending review for new derivatives. Assert that the exporter uses it. Retain the existing photo-dependent complete-export test as additional local integration coverage. Pinned source hashes, paths, reconstruction and asset admission are unchanged.
- P3-2: fetch every stylesheet linked by the built staff login page; require successful responses and no `.landing-v2` selectors, in addition to the existing markup check.
- P3-3: add consent-versus-each-hero-copy-block exclusion to the existing phone/desktop, en/es geometry matrix. All old size, target and food-exclusion thresholds remain.
- P3-4: retain the four legacy `hero-poster*` inventory/provenance entries as reviewed historical exports used by the asset integrity tests; removing those records is not necessary for request isolation and would erase useful reconstruction fixtures. They are not current runtime hero/lineup choices. Correct the false lineup comment in `hero-poster.spec.ts`; current responsive request assertions remain P013-only. No asset bytes changed.
- P3-5: footer vendor events require an absent store; only Uber Eats/shops/Dupont may carry a store. Unit coverage includes both vendors and both real shop keys plus malformed values.
- P3-6: Next's listening message is no longer the browser-ready gate. Fully consume successful production route responses (both languages, privacy, staff, dormant, outage and separate fixture) before releasing browsers. Bad status/timeout fails startup; no navigation retry or test skip hides failure. Unit tests prove readiness waits for the body and refuses 307/404/500.
- P3-7: retain both review-accepted changes. `CRUNCH,` remains the current title's host-isolation needle. The object-cover box equals its painted footprint; decoded image/currentSrc, responsive selection, preload and no-masking checks still establish the image content. No additional weakening.
- P3-8: choose mile singular/plural from the rounded displayed value in en/es (including values rounded to 1). The first-visit Privacy settings toggle now actually collapses/reopens without setting consent. The header wordmark loads eagerly with low fetch priority, which avoids React adding a second preload. The hero keeps its sole high-priority preload.

## Files

Runtime: `app/eat/{page.tsx,landing-v2.css}`, `components/landing/{ConsentNotice,Footer,NearbyShop,Shops}.tsx`, `lib/i18n/{en,es}.json`, and `lib/landing/{nearby-shared,tracking-schema-shared}.ts`.

Tools: `scripts/assets/export-landing-v2.mjs`, `scripts/landing/{e2e-server,e2e-readiness}.mjs`. Test changes are enumerated below. Documentation: the fix-round PLAN/RESULT and the chunk-3b correction.

## Changed assertions

1. `remaining-sections.spec.ts`: replace obsolete footer-only count 5 with exact configured footer URLs plus exact Dupont-only Uber Eats checks. Stronger destination/location coverage, justified by CC's vendor ruling. Scope rejected playback controls to SUBDEX and separately assert the manual spin contract, with an actual play-attempt prerequisite.
2. `shell.spec.ts`: count 7 becomes exact ordered IDs for all 8 sections, reflecting chunk 4 crave; add aside links and label target failures. Keep every 44px, no-JS, disclosure and overflow check.
3. `order-links.spec.ts`: 6 becomes 7 visible direct links per shop because the final footer pair was absent. Mid-page text pairs keep their counts; sticky remains excluded while hidden. All href, referrer, noopener and exact placement-set assertions remain.
4. `reflow.spec.ts`: add aside anchors to target/focus checks; no existing assertions removed.
5. `chunk3b-geometry.spec.ts`: add exclusion for every actual copy block (not empty container padding), retain all bounds; screenshots move to this fix-round directory.
6. `static-v2.spec.ts`: add loaded stylesheet status/content checks to staff isolation; retain markup/body checks.
7. `placements.test.ts`: parse all four section-key alternatives in the consolidated text-link row rather than exactly two. Exact placement-set equality and every client/server dispatch assertion remain.
8. `v2-assets.test.ts`: add portable decision/caller tests; retain the original full-export local test and every integrity/reconstruction assertion.
9. `hero-poster.spec.ts`: correct the inaccurate comment and add eager/low-priority wordmark checks beside the unchanged single-hero-preload assertion.
10. `sticky-order.spec.ts`: screenshot destination only; no assertion changed.
11. New `fixround.test.ts`, `e2e-readiness.test.ts` and browser `fixround.spec.ts`: additive consent semantics/targets/toggle, vendor, mile, eager-wordmark, readiness, light-link style, native destination and footer checks.

## Failing-first evidence

Logs are in `tmp/landing-v2/fixround/`.

- `baseline-e2e.log`: 6 failures / 12 passes across both engines: obsolete footer count, independent spin button and newly exposed seven-versus-eight shell count.
- `red-shell.log`: after pinning the correct eight IDs, 2 failures / 6 passes; both identify Privacy at 14px versus the unchanged 44px floor.
- `red-unit.log`: all 4 newly added tests failed before their implementations (consent copy, footer vendor store, mile formatter, eager wordmark).
- `red-browser.log`: all 6 new browser cases failed against the baseline build (consent targets in both languages and heavy mid-page controls, both engines).
- `red-portable.log` and `red-readiness.log`: new portable exporter and readiness cases fail before their helpers exist, then pass in the landing suite.
- `diagnostic-e2e-r2.log`: 108 passed / 8 failed. It confirmed all original regressions fixed, then caught the eager wordmark's second preload and the English consent label wrapping to three lines (phone photo 265.97px versus the unchanged 266.8px minimum). Low fetch priority and a wider consent action column fix those. The four desktop failures came from the new guard counting empty container padding as copy; it now checks every actual copy child, retaining the old container-centering assertion.
- `typecheck-final.log`: caught a nullable `textContent()` diagnostic message in the shell test. A fallback label fixes the type without changing the target-size assertion; standalone TypeScript is rerun afterward.
- The stylesheet and copy-exclusion additions close missing regression coverage; they were not claims of an existing CSS leak or desktop collision. P3-4/P3-7 are reasoned dispositions, not claimed failing implementations.

## Verification

- `npm.cmd test -- tests/landing --maxWorkers=1`: PASS, 42 files / 344 tests (`landing-final.log`, exit 0).
- `npm.cmd run assets:check`: PASS, all 40 assets (`assets-final.log`, exit 0).
- `npm.cmd run typecheck` (`tsc --noEmit`): PASS on final files (`typecheck-verified.log`, exit 0).
- `npm.cmd run build`: PASS (`build-final.log`, exit 0).
- `LANDING_E2E_USE_BUILD=1 npm.cmd run test:e2e -- --output=tmp/landing-v2/fixround/e2e-full`: PASS, **287 passed / 5 skipped**, Chromium + WebKit, 292 cases total, 13.8 minutes including the separately compiled fixture (`e2e-full.log`, exit 0). `LANDING_PERF_CONSENT` was explicitly unset: no scoped spec selection or fixture-skipping mode was used. The five existing skips are non-Darwin WebKit H.264 decoder cases (one motion test, four video-proof cases). No added skip, retry, timeout increase, failure or `ERR_ABORTED`. All original CI regression cases pass in both engines.
- `npm.cmd test -- --maxWorkers=3`: **FAIL**, 749 files passed / 3 failed / 1 skipped; **12,178 tests passed / 3 failed / 3 skipped**, 523.24 seconds (`full-suite-final.log`, exit 1). Two failures are the unchanged prior baseline: `tests/people-chunkE-review.test.ts:130` and `tests/pm-criteria.test.ts:140`, where child `tsx` fails before the script starts with `uv_os_get_passwd returned ENOMEM`. The third is the unchanged `tests/landing/performance-blocking.test.ts:36` whole-application source scan exceeding its existing 30-second timeout. None of these three test files was modified. The earlier full run in this round had only the two bootstrap failures (12,178 passed / 2 failed / 3 skipped; before restoring the additional full-export integration case).
- `npm.cmd test -- tests/landing/performance-blocking.test.ts --maxWorkers=3`: PASS, all 5 tests; 18.69 seconds in tests, 21.69 seconds total (`source-scan-recheck.log`, exit 0). Assertions and the 30-second timeout are unchanged. This successful standalone rerun does not erase the final full-suite failure.
- `git diff --check`: PASS (`diff-check.exit` = 0). Source assets, public files and tenant config have no diff.

The `LandingStoreLoadError` entries are expected: the dedicated outage process deliberately points at unused loopback port +4. Its en/es browser tests pass with HTTP 200 and both config-active shops, and loader unit cases retain active filtering. No production service is contacted by that harness.

Screenshots: 12 hero captures in `tmp/landing-v2/fixround/{chromium,webkit}-{en,es}-{375x667,375x812,1440x900}.png`; 12 sticky captures under `tmp/landing-v2/fixround/sticky/` with the same names. All were regenerated by the final full run. Visual inspection covered English phone and en/es desktop hero captures in Chromium, English phone and Spanish phone/desktop in WebKit, plus phone/desktop sticky examples showing the light links. Hero captures have explicit geometry assertions; sticky captures require rail visibility before and after capture, with separate rail/food/CTA collision tests. Geometry attachments remain under `e2e-full/`; failed diagnostic traces remain under the baseline and diagnostic run directories.

## Remaining review gates

The full suite is not green: the two baseline bootstrap errors and full-run source-scan timeout remain recorded above. CC's independent review and PR #491 performance CI remain external gates. Native Safari decoding evidence is not replaced by Playwright WebKit on Windows. Historical asset inventory retention is the deliberate P3-4 disposition above.
