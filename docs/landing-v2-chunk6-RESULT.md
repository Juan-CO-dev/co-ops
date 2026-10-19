# Landing v2 chunk 6 result

Worktree: `C:/Users/conta/co-ops-landing`; branch `feat/landing-v2`; base `d16a7468`. All changes UNCOMMITTED. No push, merge, deployment or database operation.

## Status

Implementation is complete and uncommitted. Landing tests, assets, TypeScript and production build pass. Full browser runs and the full unit suite were executed; this is NOT an overall clean-green handoff: the latest concurrent browser run had 14 WebKit failures, all passing in an isolated one-worker rerun, and the full unit suite retains two environment startup failures. T2 is complete within its original budget at 27,463 bytes; no larger-file exception was used. Advisory performance completed ten measurements and failed the LCP gate.

## Implementation

- Consent notice retains `?lang`; horizontal alignment, exact SUBDEX controls and order-independent footer destinations are fenced. Dead CSS removed, Spanish restored to `si está configurado`, and chunk3b legal-copy attribution corrected.
- Sticky order uses IntersectionObserver bands on a cached inline-link inventory, with no per-scroll link queries/layout reads. Real photos may pass beneath it per CC's ruling. Consent stays stationary and the rail stacks above it. Collision suppression recovers after clearance/dwell; privacy expansion, short height and hidden documents do not latch. Focus moves to the section heading when a focused rail disappears. The dead second hint and tuple contract are removed.
- Crave reserves its control and normal-motion runway before hydration; no-JS and reduced-motion have static CSS fallbacks. Field Guide owns its rem-sensitive legend layout and exposes a labelled ingredient group. Catering uses approved real-photo source 014 instead of a third L083 instance. Crave's title-based ViewContent exception is now in `docs/tracking.md`.
- Playful accents have fixed, varied assignments; one animation owner; one automatic appearance plus one intent attempt per slot; no queued competition; maximum 1,000 ms actual duration. Loads wait until visible and after paint; animation waits for image load, stops offscreen/hidden and stays static with reduced motion/save-data. Decorative nodes are aria-hidden and cannot intercept input.
- Approved new outputs: empty bag 7,322 B; isolated staff head 3,076 B; empty-handed office worker 18,154 B; illustrated code-native chip 280 B; authentic mark derivative 27,463 B. Total 56,295 B. Source/output hashes, crops, inspection, vector tolerances, tool versions and byte ceilings are pinned. Export validates all outputs before writes. Fingerprinting preserves the exact pinned touch filenames. Mark comparison evidence: `tmp/landing-v2/chunk6/mark-derivation-evidence.json`.
- T1 checker is omitted on mobile under the BUILD's explicit no-safe-gutter exception. Its DOM reservation is hidden; this is asserted, not counted as a visible touch. Desktop retains it.
- Rail recovery uses a directional 124px look-ahead and no trailing buffer; IntersectionObserver owns both direction bands. The scroll listener only reads scroll position and switches the active band on direction changes. Missing IntersectionObserver leaves the optional rail inert and inline ordering usable.

## Changed assertions and justification

File groups changed: `app/eat/{page.tsx,layout.tsx,landing-v2.css}`; `components/landing/{ConsentNotice,StickyOrderBar,CraveScene,FieldGuide,Catering,Hero,Lineup,Shops,PlayfulTouch}.tsx`; `lib/landing/{media,sticky-order-shared,playful-touches-shared}.ts`; `lib/i18n/{en,es}.json`; tenant asset/touch inventories; approved/source manifests, six touch provenance sidecars, the doodle source and five public derivatives; `scripts/assets/{inventory,fingerprint,export-landing-touches,touch-recipes,mark-source}.mjs`; the tests enumerated below; `docs/tracking.md`, the chunk3b attribution correction, this result and the build-results index. `PlayfulTouch`, its shared arbiter, touch config/export/recipe/mark modules and the touch/mark/SSR test files are new.

No performance threshold, consent gate, tracking schema or food-source safety check was weakened. Sticky acceptance follows CC's explicitly replaced availability/flicker contract.

| Test | Change | Strength / justification |
|---|---|---|
| `fixround.spec.ts` | Add horizontal centring and exact language-bearing privacy URL in en/es | Stronger; retains size, vertical alignment and toggle checks |
| `remaining-sections.spec.ts` | Sort expected and actual footer URLs | Same exact multiset, order-independent as CC requested |
| `remaining-sections.spec.ts` | Add exactly one button across all of SUBDEX | Stronger; retains scoped no-video/no-extra-control checks |
| `sticky-order.test.ts` | Replace permanent direction-latch expectations with successful sustained-clearance recovery | Intentional CC contract correction; collision still hides immediately, dwell and hero-return checks retained |
| `sticky-order.test.ts` | Add same-position transient suppression recovery | Stronger |
| `helpers/sticky.ts` | Gap search excludes photos, retains inline links; wait allows recovery dwell | CC explicitly allows food beneath the rail; helper never forces visibility |
| `sticky-order.spec.ts` | Exclusion probes protect inline links instead of photos+links | Explicit CC acceptance replacement; consent separation and hero threshold retained |
| `sticky-order.spec.ts` | Save viewport and full-page en/es screenshots at all three requested sizes | Additional evidence; hidden mobile T1 is not scrolled into view |
| `sticky-review.spec.ts` | Replace global <=2 toggles with >=70% post-hero coverage and >=400 ms / >=120 px between transition pairs | Stronger availability/flicker contract requested by CC; stationary consent and stable hint retained; JSON includes samples and transitions |
| `sticky-review.spec.ts` | Hero-shop focus expectation becomes visible-section heading; add mid-page collision case | Explicit CC focus correction; prevents body/offscreen-hero fallback |
| `sticky-review.spec.ts` | Add privacy expand/collapse recovery and no inline-query/layout-read scroll probes | Stronger; original no-computed-style-scroll probe retained |
| `crave-field-guide.spec.ts` | Positive image height becomes pre-attachment positive height plus before/after equality at the same scroll coordinate | Stronger no-shift evidence |
| `crave-field-guide.spec.ts` | No-JS SSR `data-motion=false` becomes `pending`, plus actual grid/no-transform/static-position checks | Server cannot know motion preference; CSS behavior is now directly asserted, not inferred from an attribute |
| `crave-field-guide.spec.ts` | Add delayed-hydration geometry at all three sizes, no-JS normal-motion fallback, no-JS 200% en/es geometry and named group | Stronger |
| `remaining-sections.test.ts` | Catering L083 URL/srcset/720x1080 pin becomes source014 URL/srcset/750x1125 | CC-approved distinct-photo requirement; adds different-from-crave plus real-photo/resize-only/source identity checks; retains single-image/lazy/noscript, Toast and inquiry checks |
| `hero-poster.test.ts` | Add language to ConsentLabels fixture and SSR privacy href assertion | Required type contract plus stronger URL coverage; no assertion removed |
| `fixround.test.ts` | Pin Spanish conditional to `si está configurado` | Exact CC-reviewed wording restored; permission, purpose and either-way reassurance checks retained |
| New `crave-ssr.test.ts` | Reserved control without inactive button, pending SSR state, named group | Additional regression coverage |
| New `playful-touches.test.ts` | Unique slots/characters, bounded durations, mutual exclusion, bounded automatic+intent attempts, wrong-owner release and consumed competition; runtime rejection | Additional feature coverage |
| New `touch-assets.test.ts` | Exact sources/recipes; reject changed hashes/paths/classification/inspection/crops/budgets/vector tolerance and renamed IDs; require T2 and runtime path/dimension parity | Additional provenance and completeness coverage; final focused checks pass |
| New `playful-touches.spec.ts` | en/es, mobile/desktop, 100%/200% text, zero envelope overlap, transformed containment, delayed requests, reduced-motion, input transparency, mobile checker omission | Additional visual behavior coverage; missing T2 is a soft assertion so later slots still get checked |
| `v2-assets.test.ts` | No assertion change | Existing complete runtime equality caught the legacy filename suffix defect; implementation fixed instead |
| `languages.spec.ts`, `crave-field-guide.spec.ts` | Scope source/decode/dimension checks to protected food containers; separately assert exact decorative image counts and empty alt | Same food requirements plus stronger explicit inventory; decorations no longer violate an accidental singleton selector |
| `crave-field-guide.spec.ts` | Reduced-motion crave requires two food images plus one static stamp; JS-off requires two food images and no client-loaded stamp | Exact expected sets, not a relaxed total count |
| `crave-field-guide.spec.ts` | Set root font size directly and assert 32px; explicitly load FontFaces before hydration geometry measurement | Avoids traced addStyleTag and document-load/font readiness deadlocks; all original geometry comparisons retained |
| `sticky-review.spec.ts` | Scroll preservation uses absolute delta <=1 CSS px | Justified browser subpixel tolerance: WebKit reported 3921.5 versus 3921; focus target and hidden-rail checks remain exact |
| `sticky-order.spec.ts` | Screenshot preparation scrolls synchronously rather than waiting for animated-element stability | Setup-only correction; all screenshots and assertions retained |
| `tracking.spec.ts` | Simulate privacy signals on Navigator.prototype and assert the value before storage/network assertions | Stronger verified input; storage clearing, zero Meta requests and no Pixel node remain required |
| `playful-touches.spec.ts` | Batch five pose measurements while holding the actual CSS recipe active | Same pose/envelope/overlap requirements, less protocol overhead; mandatory mark image retained |
| New `mark-source.test.ts` | Preserve original compound subpaths/cutouts and reject malformed source | Additional deterministic derivative safety coverage |
| `sticky-order.spec.ts` | Dispatch viewport resize after injecting the synthetic 34px safe-area inset | Accurate simulation for an already-hydrated rail; exact consent/rail geometry assertions retained. The unsynchronized version failed by exactly 33px (34px minus its existing 1px tolerance) |
| `sticky-order.spec.ts` | Visit every protected photo and require complete/nonzero image data before full-page capture; restore lineup's horizontal start | Stronger screenshot evidence through normal lazy-loading paths; no production loading behavior changed |
| `sticky-order.spec.ts` | Batch capture preparation inside one browser evaluation and require image.decode() for photos and visible image touches | Stronger image readiness, same 5-second image deadline; eliminates protocol overhead, not checks |
| `shell.spec.ts` | Batch target rectangles/text in evaluateAll instead of roughly 80 sequential protocol calls | Identical target selector and per-target >=44px assertion; traced timeout occurred during the old measurement loop |
| `playful-touches.spec.ts` | Direct scroll before the existing visibility/envelope/pose assertions | Setup-only removal of animated-element stability waits; every size/overlap assertion retained |

## Actual failing-first evidence

- Sticky recovery tests: 2 failed / 5 passed against the original permanent latch, then 12/12 sticky tests passed after implementation.
- Crave SSR tests: 2 expected failures for missing control reservation and named group, then 5/5 SSR+motion tests passed.
- New playful module and decorative entries each failed before implementation. Four-asset/controller checks then passed 26 tests; final fingerprint/controller rerun passed 11 tests.
- Full suite caught the fingerprint suffix bug before its fix. Existing equality assertion stayed unchanged.
- Full browser run caught mobile rail coverage below 70%, the missing-IntersectionObserver crash, stale image singletons, missing T2 and browser setup deadlocks. These were corrected without lowering coverage/flicker or geometry thresholds; targeted 20-case rerun passed.
- Renaming a decorative asset ID initially bypassed the exact-recipe gate; its new rejection test failed first, then passed after validating source IDs and touch output paths as well.
- Browser red attempts did NOT execute assertions: overlapping builds were stopped and the main build artifact was absent at harness startup. They are not claimed as failing-first browser evidence. Alignment/control-set/footer-order assertions cover behavior already present. Documentation and dead-code fixes do not have fabricated red runs.

## Verification

- Initial full unit suite: `npm.cmd run test -- --maxWorkers=3`: 5 failed, 13,758 passed, 3 skipped, 800 files. See `tmp/landing-v2/chunk6/unit-full.log`.
- Two unrelated startup tests failed before reaching their intended no-credentials check: `tsx` -> `os.userInfo()` -> `uv_os_get_passwd ENOMEM`. No database access occurred. Their assertions were not weakened.
- Other initial failures: Catering's superseded photo expectation, fingerprint suffix bug, and intentional missing T2.
- Final `npm.cmd run test -- --maxWorkers=3`: 13,764 passed, 2 failed, 3 skipped across 801 files (`unit-final.log`, 421.76s). Only failures are the two startup tests above; no landing failure remains.
- `npm.cmd run test -- tests/landing --maxWorkers=3`: 365 passed across 48 files (`landing-final.log`).
- Final `npm.cmd run build`: PASS (`build-complete.log`).
- `npm.cmd run assets:check`: 45 approved assets PASS (`assets-final.log`).
- `npx.cmd tsc --noEmit`: PASS (`tsc-final.log`).
- Corrective browser run: 20 passed across Chromium/WebKit (`e2e-targeted.log`). Both engines: rail visibility 70.68% (375x667), 73.60% (375x812), 86.07% (1440x900); all 400ms/120px transition and stationary-consent checks passed.
- First complete browser run: 330 passed, 53 failed, 5 skipped (`e2e-full.log`); failures were investigated and fixed as described above.
- Second complete browser run: 382 passed, 1 failed, 5 skipped, 14.3 minutes (`e2e-complete.log`). Sole failure was the corrected synthetic safe-area setup race; its trace is preserved as `safe-inset-race-trace.zip`.
- Latest `LANDING_E2E_USE_BUILD=1 npm.cmd run test:e2e`: 369 passed, 14 failed, 5 existing decoder skips, 18.0 minutes (`e2e-final.log`). All 14 failures were WebKit: eight deadlines (texture, four touch cases, skeleton and two captures), three geolocation-fixture outcomes, one delayed consent-flow response, and two rail gates (69.63% coverage; a sampled 335ms pair). Do not call this a full-suite pass. Failure artifacts are retained in `e2e-final-failures/`.
- `LANDING_E2E_USE_BUILD=1 npm.cmd run test:e2e -- --last-failed --workers=1`: all 14 passed, 8.1 minutes including the separately rebuilt fixture (`e2e-isolated.log`). No geometry, coverage, flicker or time limit was relaxed. Shell/capture measurement batching and direct touch scrolling remove traced protocol overhead; geolocation, consent and rail assertions remain unchanged. This is an isolated rerun, not a clean concurrent result.
- Artifact audit: 24 PNGs plus six rail JSON files verified and indexed in `artifact-index.json`. Viewports are CSS pixels; Chromium uses DPR 1 and WebKit DPR 2. Refreshed mobile/desktop en/es renders were visually inspected; photo capture now visits and decodes lazy sections.
- Advisory `npm.cmd run perf:ci`: EXIT 1, five cold runs for each consent state, unchanged thresholds. UNSET median performance 0.93 / LCP 3088.846ms / TBT 105.5ms; ACCEPTED 0.93 / 3091.573ms / 95ms. First-party bytes are 301,361 on every run. Both states fail the 2500ms LCP limit. This is the first-party-only protocol with Pixel blocked, not a third-party-cost or production measurement. Raw evidence: `tmp/landing-performance/2026-10-17T13-32-51.187Z-merge-6235b4e3`; console: `tmp/landing-v2/chunk6/perf.log`. Pinned local LHCI 0.15.1 was used; no gate waiver or CI pass is claimed.
- `git diff --check`: PASS; Git prints line-ending conversion advisories only.
- All five requested trailing-newline checks passed.
- Standalone tsc initially exposed the new browser probe's missing `this` annotation and a ConsentLabels fixture missing language; both fixed before the passing run.

## Open risks / handoff

- T2 budget issue is resolved without an exception; all six assignments are implemented, with the explicitly permitted mobile T1 omission.
- Concurrent WebKit timing remains a verification risk. All failed cases passed in isolation, but no clean concurrent full-suite exit is claimed. Rail JSON and screenshots are under `tmp/landing-v2/chunk6/`.
- Latest passing rail artifacts: Chromium 70.68% / 73.60% / 86.07%; WebKit 70.68% / 72.59% / 86.07% (375x667 / 375x812 / 1440x900). Minimum recorded transition spacing across those artifacts: 417.7ms and 160px; stationary consent checks pass.
- Local performance is advisory; authoritative CI for these uncommitted changes requires CC's later submission. No CI pass is claimed.
- Save-Data is only known client-side; switching to the intentional static crave fallback can change its runway. Normal and reduced-motion hydration geometry have explicit tests.
- CC owns independent cross-family review and any later commit/merge. This packet does not claim that review occurred.
