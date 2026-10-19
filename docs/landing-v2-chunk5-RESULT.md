# LANDING v2 - chunk 5 result

Implementation and local verification complete for CC review. The authoritative CI performance exit remains pending; this is not an overall green release claim.

Branch `feat/landing-v2`, baseline `fa004048`, dedicated clone `C:/Users/conta/co-ops-landing`. All edits uncommitted; no push, merge, deployment, production access or new food generation.

## Changes

- Part A: pure rail policy with 120px show clearance, immediate hide on an actual intersection, 240ms clear dwell and a collision latch reset by a deliberate >120px reversal. This preserves zero overlap and bounds continuous one-direction scrolling to at most two transitions. Inline ordering remains available after a collision. This conservative trade-off remains explicit for CC review.
- Consent stays in its original bottom position; the rail sits above it. Rail visibility never changes dock positioning. The first hint stays fixed for the session. Before hiding a focused rail, focus returns to the first hero shop link. The toggle controls the real heading id. Geometry changes, not scroll frames, resolve styles. Dead/duplicate CSS is removed; desktop heading scroll margins use the measured rail height. Spanish punctuation is corrected; consent wording and light inline shop links are unchanged.
- Part B: native P016-to-L083 texture travel uses a 175svh stage (0.75 viewport extra travel), CSS scroll timeline where supported and the existing shared scheduler otherwise. Still/reduced-motion/save-data/short-screen/no-JS modes keep the real photographs and readable content. Desktop copy and food occupy separate columns. No wheel interception or forced completion before ordering.
- Texture URLs attach only after 10% viewport intersection, preventing a measured 19px desktop first-screen sliver from causing an early download. The no-early-download assertion is unchanged. Missing IntersectionObserver uses the explicit typeof guard and a native lazy fallback, fixing the full-suite blank-page regression. Dimensions are reserved before URLs attach, and noscript preserves complete images.
- The Field Guide leads with the tenant's Crunchy Boi name and complete canonical ingredient translation. Six external labels identify visible food. Phone and enlarged-text layouts use a wrapping legend; normal desktop labels retain normalized vertical bands. Catering shares the exact responsive L083 URLs. At 200% text, real desktop label collisions were reproduced before adding the enlarged-text wrapping fallback; text is neither shrunk nor clipped.
- No new asset bytes: all existing 40 approved assets and their derivation/source sidecars are reused. Full-frame L083 was inspected at 720x1080; normalized anchors are bread(.30,.035), chips(.37,.09), turkey(.31,.16), iceberg(.38,.24), pickles(.73,.56), provolone(.51,.83). Label ticks stop outside the photo; the recorded x-coordinate identifies the inspected feature without placing a marker over food. No guessed garlic-mayo/oil/onion callouts.

### Bounded tracking integration amendment

The new crave runway made the existing whole-wrapper 50% ViewContent trigger unreachable on three requested phone/language combinations. Standalone Chromium measurements against the pre-fix build, with accepted consent and offline Meta, recorded:

| Viewport / language | Observed wrapper height | Maximum intersection ratio | Events after 1.4s at maximum visibility |
|---|---:|---:|---:|
| 375x667 en | 1343.25px | 0.496557 | 0 |
| 375x667 es | 1383.25px | 0.482198 | 0 |
| 375x812 en | 1597px | 0.508453 | 1 |
| 375x812 es | 1637px | 0.496029 | 0 |

Intro-position dwell produced zero events in all four cases. Evidence: `tmp/landing-v2/chunk5/crave-viewcontent-red.json`.

The approved integration amendment adds optional `observationTargetId` to `SectionView`; only crave supplies `crave-title`. The target must exist inside the section wrapper. All other sections retain wrapper observation. The 50% threshold, 1000ms dwell, document-visibility cancellation, consent checks and once-per-section tracker deduplication are unchanged. No tracking transport, server event, or attribution behavior changes. Eight new browser cases cover en/es, 667/812, accepted/rejected consent: brief dwell does not send; leaving cancels; a full intro dwell sends once; re-entry does not duplicate; rejection loads no Pixel and sends no event.

## Every changed existing assertion

| File / assertion | Change and justification |
|---|---|
| `tests/landing/remaining-sections.test.ts`: Catering forbids every img | Replaced the obsolete hold with exactly one approved L083 img, exact shared src/srcset, 720x1080 dimensions, lazy loading and noscript. Existing no-form, translated controls and approved destination assertions remain. Intentional requirement change with stronger asset identity checks. |
| `tests/e2e/landing/languages.spec.ts`: Field Guide forbids any /media/ and all images | Initial no-loaded-img/picture/video assertion remains. The blanket /media/ prohibition becomes exact approved L083 noscript-source evidence. After the original initial consent assertions, the test scrolls the guide and requires exactly one approved src/srcset image, 720x1080, bilingual alt, no video and the complete canonical ingredient string. The former hold is intentionally superseded by the required real-photo guide. |
| `tests/e2e/landing/sticky-order.spec.ts`: visible immediately after hero threshold if unobstructed | Hero-visible and collision-hidden checks remain. Appearance is checked after real clearance plus dwell, reflecting the required hysteresis instead of treating hero exit as sufficient. New policy boundaries and whole-page transition checks strengthen coverage. |
| Same: dock above rail with 34px gap | Stacking reverses: rail bottom is at or above the stationary dock top. The 34px safe-inset assertion remains in its existing test. New linear-scroll evidence pins constant consent top across all samples. This is the explicit behavior change that stops consent jumping. |
| Same: three consecutive visible assertions around capture | Keeps one assertion before capture; removes two repetitions without an intervening action, as P3-3 requested. Adds independent state-transition tests. Capture path moves to chunk5. |
| Same and `dedup.spec.ts`: fixed-offset scroll helper | Both use `helpers/sticky.ts`, which derives candidate gaps from actual protected rectangles plus 120px clearance, re-checks geometry and waits 280ms for the real 240ms dwell. This replaces old fixed1200-3000px offsets and the intermediate 80px iterative scan that wasted the existing timeout. It neither forces visibility nor extends test timeouts. Native click, dispatch count, shared event IDs and final visible assertions remain unchanged. |
| `tests/landing/sticky-order.test.ts` | Existing assertions remain; new tests pin clearance119/120px, dwell boundaries, safe immediate hide, collision latch, deliberate reverse and hero re-entry. |
| `tests/e2e/landing/crave-field-guide.spec.ts`: combined normal/enlarged geometry case | Split the 200% section into six independent cases after WebKit desktop exhausted the original 30s while doing both capture sequences. The six normal cases retain every original assertion and five full-photo progress samples; the six enlarged cases retain the same guide readability/exclusion helper, screenshot-before-assertion and all five full-photo progress samples. Each retains the existing 30s timeout; no timeout or assertion is weakened. |

### New assertion inventory and corrections during this chunk

- `sticky-review.test.ts` and `sticky-review.spec.ts`: ARIA relationship, stable hint, Spanish punctuation, CSS cleanup, no per-scroll root style resolution, visible-rail axe, focus restoration, open/expanded notice and keyboard suppression, non-vacuous rail appearance, at most two linear-scroll visibility changes, invariant consent top and hint at all three requested sizes.
- `crave-motion.test.ts`: clamped/reversible native progress and resize math, still/reduced/save-data/short-screen eligibility, and the six inspected normalized anchors.
- `crave-field-guide.spec.ts`: unchanged empty initial texture-request list; reserved geometry; successful image decoding before guide capture and both texture endpoints; exact full ingredient strings; six labels; native reverse and still behavior; hidden/offscreen state; no-JS and reduced-motion content; and the new consented ViewContent matrix above.
- Food exclusion samples the full transformed photo rectangles at scroll progress0/.25/.5/.75/1 in en/es at375x667,375x812,1440x900, at both100% and200% text. An early draft clipped those rectangles to the photo window; that clipping was removed, strengthening the contract. Guide checks include all labels, headings, prose, caption and order controls, plus pairwise label nonoverlap.
- Label readability initially used scrollWidth/clientWidth, which falsely counted intentional outside ::after ticks as clipped text on desktop. It now uses Range.selectNodeContents text rectangles inside padded label bounds, plus positive visible rectangles and viewport-width containment. Decorative ticks no longer cause a false failure; actual text clipping remains forbidden.
- Real200% label overlap was separately measured: en bread/chips1442.885px^2 and chips/turkey330.653px^2; es bread/chips5542.969px^2, chips/turkey1460.996px^2 and turkey/iceberg972.941px^2.375px mobile had none. The approved flow-mode wrapping legend fixes the actual defect; it is not an assertion exception. Evidence: `label-text200-probe.json` and probe screenshots under `tmp/landing-v2/chunk5/`.
- Screenshots retain full-page captures and explicit guide/texture captures for both languages and all three dimensions. Guide captures begin16px before the Crunchy Boi heading; text200 captures precede their geometry assertion so failures remain inspectable.

No existing performance budget, timeout, consent rule, real-food exclusion, or source-validator threshold is weakened. No-early-texture-download remains an exact zero-request assertion.

## Verification

- Failing-first source regression:5/5 fail on old code; after fixes11/11 sticky policy/source tests pass.
- Failing-first policy:2 missing-policy failures; existing4 pass.
- Failing-first browser against existing production build:5 fail/2 pass. Linear scroll counts18,18,13 at375×667,375×812,1440×900; focus remains inactive; four root computed-style reads across four scroll frames. Log `tmp/landing-v2/chunk5-sticky-red.log`.
- New texture pure tests: missing-module red; green3/3.
- `npm.cmd run assets:check -- --sources`: PASS, exit 0, 40 approved assets including source reconstruction (`assets-sources.log`).
- `npx.cmd tsc --noEmit`: PASS, exit 0 after the test-only split (`tsc-verified.log`, empty success output).
- `npm.cmd test -- tests/landing --maxWorkers=3`: PASS, 44 files / 354 tests, 24.04s (`landing-final.log`). Initial 352 pass / 2 fail were the obsolete no-image assertion and untranslated new Provolone label, corrected without weakening the required asset checks.
- `npm.cmd run build`: PASS, exit 0 (`build-verified.log`). No application source changed afterward.
- `npm.cmd test -- --maxWorkers=3`: FAIL, exit 1; 752 files passed / 1 skipped / 2 failed; 12,189 tests passed / 3 skipped / 2 failed, 300.40s (`full-suite-final.log`). Failures are unchanged baseline `tests/people-chunkE-review.test.ts:130` and `tests/pm-criteria.test.ts:140`: child tsx fails before script execution with `uv_os_get_passwd returned ENOMEM`, rather than the expected missing-credentials exit 2. The same failures are recorded in chunk4. No database accessed; no unrelated test changed. This is not a green full-suite claim.
- Last full browser run before the test-only split: 333 passed / 5 skipped / 2 WebKit desktop timeouts, 11.9m (`e2e-verified.log`). Trace shows the full-page capture taking 6.093s; timeout occurs late in the combined enlarged-text sequence. Both traces are preserved as `desktop-*-combined-timeout.zip`. Final full split-test run passed below.
- `$env:LANDING_E2E_USE_BUILD='1'; npm.cmd run test:e2e`: PASS, exit 0, complete Chromium + WebKit, 347 passed / 5 skipped / 0 failed, 10.5m (`e2e-complete.log`). Existing skips are non-Darwin WebKit H.264 decoder proof; native Safari evidence is not claimed. All transfer-budget, consent, tracking, geometry, keyboard and fallback tests pass. Normal desktop WebKit captures took 27.2/27.3s, close to the unchanged 30s limit on this laptop; enlarged desktop cases passed separately in 9.6/11.8s.
- Both engines measured exactly 2 rail transitions at all three sizes, with one consent-top value per scroll and one hint throughout (`rail-summary.json`). Consent top: 562.109375px at375x667, 707.109375px at375x812, 671.109375px at1440x900.
- Screenshot review: normal guide, texture and full-page captures exist for en/es at375x667,375x812,1440x900 in both engines. Inspected phone texture, Spanish phone guide, desktop guide and enlarged desktop composition. All are under `tmp/landing-v2/chunk5/`; final run refreshed them.
- `npm.cmd run perf:ci`: FAIL, exit 1. Used existing build, cached pinned LHCI CLI and installed Chromium, `LANDING_PERF_NO_SANDBOX=1`; no thresholds, run counts or Pixel-blocking changes. Five cold runs per state completed. UNSET median performance0.94 / accessibility1.00 / LCP3053.178ms / TBT77ms / CLS0.002750. ACCEPTED:0.94 /1.00 /3092.990ms /59ms /0.052699. First-party transfer298,966B in every run. Both states fail only the unchanged LCP<2500ms metric; score, accessibility, TBT, CLS, bytes and consent checks pass. A Windows Chrome-cleanup Access denied message is also present; all ten raw reports and their assertion failures were retained. This is first-party-only, Pixel-blocked evidence, not live-Meta or CI evidence. Log `tmp/landing-v2/chunk5/perf-final.log`; summary `perf-summary.json`; raw runs `tmp/landing-performance/2026-10-17T10-34-56.239Z-merge-62197b96/`.
- `git diff --check`: PASS, exit0. Branch/HEAD remain `feat/landing-v2` / `fa004048`; all edits are uncommitted.

CI LHCI median of five per consent state remains authoritative and is not claimed from local checks. No push/CI submission authorized. Existing external release gates remain with CC.
## Changed files

- Application: `app/eat/{page.tsx,landing-v2.css}`; `components/landing/{Catering,CraveScene,FieldGuide,SectionView,StickyOrderBar}.tsx`.
- Shared data/policies: `lib/landing/{media,crave-motion-shared,sticky-order-shared}.ts`; `lib/i18n/{en,es}.json`.
- Unit coverage: `tests/landing/{crave-motion,remaining-sections,sticky-order,sticky-review}.test.ts`.
- Browser coverage: `tests/e2e/landing/{crave-field-guide,dedup,languages,sticky-order,sticky-review}.spec.ts`; `tests/e2e/landing/helpers/sticky.ts`.
- Handoff: this RESULT and `docs/landing-v2-build-results.md`. Existing assets/provenance, dependencies, production data and consent wording are unchanged.

## Remaining gates and limitations

CC must arrange cross-family review and the authoritative five-run CI performance gate for this exact uncommitted revision. The local LCP miss is disclosed; the BUILD protocol makes loaded-laptop scores advisory, but missing green CI blocks implementation exit/advancement. No push, merge or deployment was attempted. Live Meta costs and physical iPhone decoder evidence remain separate release gates. The one-pass rail collision latch and near-limit local WebKit screenshot duration are explicit above. Full-suite Windows startup failures remain unresolved and outside this landing change.