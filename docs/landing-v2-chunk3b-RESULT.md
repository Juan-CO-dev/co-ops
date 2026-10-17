# LANDING v2 — chunk 3b

Worktree: `C:/Users/conta/co-ops-landing`; branch: `feat/landing-v2`. Changes remain **UNCOMMITTED**. No push, merge, deployment, or production-data changes.

## Scope and implementation

CC's design review and chunk 2 rulings are the implementation plan: restore prototype A's hero, separate consent from food/actions, strengthen the height/media assertions, and resolve the reviewed public-shop defects before chunk 4.

- `components/landing/Hero.tsx`, `app/eat/landing-v2.css`, `lib/i18n/{en,es}.json`: uppercase two-line prototype-scale title, eyebrow, subline, yellow shop links and Crunchy Boi footline. Original P013 bytes are unchanged; uniform CSS cover crops provide the full-bleed composition. Small text stays dark to preserve AA contrast on the approved red; the large heading stays cream.
- `components/landing/ConsentNotice.tsx`: compact measured bottom reservation on phones; desktop card is bottom-left, capped at 380px. Correction (fix-round review): the notice had already lost its permission framing, conditional Meta sharing and advertising purpose before chunk 3b. That was a regression, not preserved legal copy; the fix round restores all three in en/es. Accept/reject/withdraw behavior remained. Text zoom and narrow/short viewports retain the accessible in-flow fallback.
- `components/landing/CateringLink.tsx`, `app/eat/page.tsx`: secondary catering action moves into the first-screen header, retaining its tracked native destination and 44px target. All repeated shop CTAs use the loaded public shop set, so a successful DB read narrows them consistently.
- `config/tenant/landing.ts`, `lib/landing/{config,stores}.ts`: explicit config `active` is authoritative; live DB membership only narrows, outages use config-active shops. Visible phone strings are separate from E.164 telephone links.
- `components/landing/{NearbyShop,Shops,ShopMap,Footer}.tsx`: miles; Dupont-only Uber Eats card link; valid-coordinate filtering and shared geographic map scale. `lib/landing/products.ts` validates ingredient keys against both dictionaries without the unchecked roster cast.
- `lib/landing/tracking-{client,schema-shared}.ts`: preserve footer delivery tracking and allow only the additional `ubereats / shops / dupont` combination. Tests retain Pixel/CAPI deduplication and exclude delivery clicks from the direct-order counter.

## Assertions

- `hero-poster.spec.ts`: replace positive-only height with the prototype's exact 740px desktop height, bounded mobile height, and original 2:3 ratio for the narrow accessibility fallback. Painted-width checks now describe `object-cover`; responsive candidate, hydration identity, preload, decode and no-JS checks remain.
- `motion.spec.ts`: new pre-scroll tests for unset, accepted and rejected consent require no hero video, no spin video, no media request and zero scroll. `IllustratedSpin.tsx` now mounts its video only on Play, retaining user activation and an equal-size placeholder. Existing manual-spin/error/reduced-motion checks remain. The static spin assertion likewise strengthens source absence to element absence before Play; its accessible-label check moves after mounting.
- `chunk3b-geometry.spec.ts`: both languages at 375×667, 375×812 and 1440×900; consent/food and consent/CTA rectangles must not intersect; consent height ≤120px, desktop width ≤380px; mobile photo ≥40% of viewport; desktop copy/food centres align. Captures go to `tmp/landing-v2/chunk3b/`.
- `static-v2.spec.ts` keeps all three first-screen action and keyboard-target checks by including catering's new header location. The hero SSR test verifies that actual shared catering component's destination and both exact title lines, eyebrow, body and footline.
- `reflow.spec.ts` additionally waits for the ResizeObserver-driven `data-flow=true` layout after changing text size, then retains every original overflow, 44px width/height and keyboard-focus assertion. The header wraps directly in CSS, including before hydration.
- Shop tests add loader-level inactive/outage cases, formatted phones, valid map geometry, missing dictionary keys, delivery placement and live staff-host `geolocation=()` coverage. Existing consent, no unsolicited geolocation, no-JS, overflow and tracking checks remain.

## Verification

- `npm.cmd run assets:check`: PASS, 40 assets.
- `npm.cmd run typecheck`: PASS, exit 0.
- `npm.cmd test -- tests/landing --maxWorkers=1`: PASS, 38 files / 318 tests (`tmp/landing-v2/chunk3b/landing-tests.log`).
- Focused shop checks: PASS, 7 files / 32 tests. Focused tracking checks: PASS, 4 files / 15 tests.
- Initial intermediate landing run: 307 passed / 6 failed (four pending assertion migrations, untranslated identical vendor label, filesystem-scan timeout). Final landing rerun above resolves all six.
- Final landing rerun after browser fixes: PASS, 38 files / 318 tests (`landing-tests-final.log`).
- `npm.cmd test -- --maxWorkers=3`: **FAIL**, 746 files passed, 1 skipped, 2 failed; 12,153 tests passed, 3 skipped, 2 failed (`full-suite.log`). Both failures are the recorded chunk 3 baseline: `tests/people-chunkE-review.test.ts:130` and `tests/pm-criteria.test.ts:140`, where `tsx` fails before script execution with `uv_os_get_passwd returned ENOMEM`. Both tests and invoked scripts are unchanged versus HEAD. No production database was contacted.
- `npm.cmd run build`: PASS on final source, exit 0, including TypeScript (`build-final.log`).
- Initial scoped browser run: 169 passed, 22 failed, 1 skipped. Failures identified contrast, old-build desktop placement, short-desktop fallback, zoomed header shrinkage, and an empty spin video mounted before Play. Corrections preserve or strengthen the assertions.
- Second browser run: 145 passed, 2 failed, 1 skipped (`e2e-final.log`); only WebKit's immediate post-font-change overflow check failed before the observer applied flow. The final CSS/readiness correction resolves both.
- **Final scoped browser run: PASS, 147 passed / 1 skipped**, Chromium and WebKit (`e2e-verified.log`). The skip is the existing non-Darwin WebKit H.264 decode limitation; native Safari evidence remains required. All twelve requested geometry cases pass, plus short-desktop flow, text zoom, axe AA, no-JS, shops, keyboard, poster sizing and playback. Initial first-party bytes remain below 403 KB at DPR 1-3 (500 KB assertion retained).
- The additional 44 host-isolation / review-regression cases passed in the initial run with the separately compiled fixture, including live staff `geolocation=()` and Dupont-only vendor tracking. Their implementation was unchanged by subsequent layout/playback fixes.
- `git diff --check`: PASS. All changes remain uncommitted.

Final scoped command (the extra fixture had already passed; this setting skips its redundant compilation):

```powershell
$env:LANDING_E2E_USE_BUILD='1'
$env:LANDING_PERF_CONSENT='unset'
npx.cmd playwright test hero.spec.ts hero-poster.spec.ts motion.spec.ts static-v2.spec.ts chunk3b-geometry.spec.ts shops.spec.ts accessibility.spec.ts reflow.spec.ts languages.spec.ts order-links.spec.ts --workers=3 --output=tmp/landing-v2/chunk3b/e2e-verified
```

## Review captures

`tmp/landing-v2/chunk3b/{chromium,webkit}-{en,es}-{375x667,375x812,1440x900}.png` contains twelve captures: the six requested combinations in each engine. The geometry test requires food to occupy at least 40% of each phone viewport with consent visible, zero consent/food or consent/CTA intersections, a consent card no taller than 120px, and a desktop card entirely within the red half. Small red-background copy is black for AA contrast; food assets are byte-unchanged.

## Remaining gates

CC's visual review of the new screenshots remains required. PR #491 CI is the authoritative performance gate; local perf is advisory and was not run while the machine was busy. No chunk 4 behavior is included.
