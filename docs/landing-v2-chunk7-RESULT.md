# CC rail-rule replacement - 2026-10-17

Current status: PART A QUALIFIED under CC's replacement rail rule. Part B NOT STARTED; stop cleanly after the sustained Part A verification. Historical results below belong to the superseded inline-link policy.

## Bounded implementation plan (CC supplied rule)

Change StickyOrderBar.tsx and sticky-order-shared.ts to observe only hero/final-footer boundaries, keep 120 px hysteresis and 400 ms release dwell, retain stationary consent stacking and recoverable transient suppression. Update rail unit/browser tests, their helper, BUILD and this RESULT. Preserve the other Part A edits. No server/API/data contract changes. Risk: asynchronous boundary observation, fast-scroll availability and restored viewport geometry. Validate landing Vitest with two workers, TypeScript, production build, full Chromium/WebKit suite with one worker, then five-repeat representative matrix (final full/repeat runs use two browser workers within the current two-worker cap, one heavy job at a time). CC's current dispatch replaces the old collision rule and authorizes this bounded implementation; independent final review remains CC's.

## New assertion ledger (supersedes historical rail entries)

- Unit policy: replace immediate-first-show/240 ms recovery expectations with 120 px hero/footer release buffers and 400 ms sustained dwell. Explicitly test boundary hover resetting dwell, immediate boundary hide and no-latch transient recovery at unchanged position.
- Representative sweep: gate increases from 70% to 80%; measure visible scroll DISTANCE between hero departure and footer arrival, not time/frame count through the whole page. Fling rest frames cannot inflate coverage. Product qualification remains the stricter 85% minimum across five repeats. Transition cap becomes four, replacing the per-inline-band allowance; 400 ms AND 120 px spacing remains unchanged. Sample stationary consent top and stable hint as before.
- Inline-link focus regression: require rail to stay visible and keep focus when a light inline link passes beneath it, replacing collision-driven hide/focus evacuation. Hero-driven focus evacuation remains tested.
- Threshold/overlap tests: remove obsolete inline-band blockers; retain hero/footer exclusion and stationary consent stacking. Test helper now moves beyond the measured hero release buffer instead of searching inline-link gaps.
- Add final footer takeover, reverse recovery and short-viewport recovery at mid-page. Same-position recovery is pinned by the pure policy and privacy tests; viewport resizing may legitimately trigger browser scroll anchoring. Existing expanded privacy/off-screen recovery tests remain.
- Font, chip accessibility/provenance and catering assertions from the previous Part A work remain intact.

## Final qualification for the replacement rule

- Landing unit tests: `npm.cmd test -- tests/landing --maxWorkers=2` PASS, 48 files / 366 tests. Log: `tmp/landing-v2/chunk7/rule-unit.log`.
- TypeScript: `npm.cmd run typecheck` PASS, including the corrected browser test. Log: `rule-tsc-final.log`.
- Assets: `npm.cmd run assets:check` PASS, 45 assets. Log: `rule-assets.log`.
- Production: `npm.cmd run build` PASS, exit 0. Log: `rule-build.log`. No production code changed afterward (only whitespace, browser-test correction and documentation).
- FULL browser suite, no grep/retry filter: `LANDING_E2E_USE_BUILD=1 npm.cmd run test:e2e -- --workers=2`: **387 passed / 5 existing skips / zero failed**, 14.2 minutes. `rule-e2e-final.log` and copied Playwright `rule-e2e-final-status.json` (status passed, failedTests empty). The outer PowerShell session returned 1 after a redirected git-ignore permission warning became NativeCommandError; the native exit code was not separately captured for that invocation. Do not misreport that wrapper as exit 0. Playwright's final report and status file establish the test outcome.
- Five-repeat matrix: `LANDING_E2E_USE_BUILD=1 npm.cmd run test:e2e -- tests/e2e/landing/sticky-review.spec.ts --grep "representative rail" --repeat-each=5 --workers=2`: **30 passed**, 19.9 minutes; explicitly captured native exit **0** in `rule-repeat5.exit.txt`. Log: `rule-repeat5.log`.
- `node tmp/landing-v2/chunk7/summarize.cjs`: PASS, stricter product target >=85% checked independently of the >=80% e2e gate. Full per-profile evidence: `rule-repeat5-summary.json` and the 30 `rail-{engine}-{viewport}-{repeat}.json` files. Each row below is the minimum across five runs times four profiles, not an average.

| Engine | Viewport | Five-run minimum coverage | Max transitions | Min pair ms | Min pair px |
|---|---|---:|---:|---:|---:|
| chromium | 375x667 | 90.79% | 2 | 5363.5 | 6418 |
| chromium | 375x812 | 91.07% | 2 | 5567.4 | 6674 |
| chromium | 1440x900 | 91.65% | 2 | 5859.9 | 7039 |
| webkit | 375x667 | 90.49% | 2 | 5352.0 | 6407 |
| webkit | 375x812 | 90.70% | 2 | 5545.0 | 6672 |
| webkit | 1440x900 | 89.96% | 2 | 5830.0 | 7047 |

Every profile had exactly two transitions. Every sample series had exactly one consent-top value. Overall minimum coverage **89.96%**; minimum transition spacing **5,352 ms AND 6,407 px**. Representative synthetic profiles are small steps (40 px/150 ms), steady 600 and 1,200 px/s, and repeated 2,400 px/s peak flings with 800 ms linear deceleration/400 ms rest. This is browser-harness evidence, not physical iPhone evidence.

## Correction and remaining limits

The initial replacement full run was **385 passed / 2 failed / 5 skipped** (`rule-e2e.log`). Both failures came from the new combined footer/keyboard test: consent flow changes anchored the page near the footer, bringing the final CTA back on screen after viewport restoration. The footer reverse-scroll assertion passed; the rail correctly stayed hidden when the footer returned. The corrected test exercises keyboard recovery at mid-page, away from the footer, and does not require browser scroll anchoring to preserve an exact scrollY. The pure policy and privacy tests still require recovery at unchanged position. Both corrected browser cases passed in the final FULL run. No product relaxation was used to fix these test failures.

The prior broad Vitest run's two unrelated tsx/os.userInfo ENOMEM failures remain historical; this dispatch reran the requested landing suite, not all 801 files. Windows WebKit decoder skips/native iPhone and Part B remain external/pending. CC's final independent review and any CI run remain after this uncommitted handoff. No push, merge, deployment or production data access.

`git diff --check`: PASS (exit 0). Harness teardown completed; its PID file is absent and no listener remains on ports 44170-44175. Branch **feat/landing-v2**, unchanged HEAD **9ea1da96f36735359200da1f248c052f20acbae5**, worktree **C:/Users/conta/co-ops-landing**. All changes remain UNCOMMITTED, including the preserved earlier Part A work.



---

# LANDING v2 — Part A / chunk 7 handoff

Historical status before the CC replacement: PART A NOT QUALIFIED. Part B had not started. The resumed full browser run completed with six representative-rail failures; do not ship this candidate as passing.

## Restart recovery (2026-10-17)

Read this handoff and the uncommitted diff before resuming. Confirmed branch and base HEAD; preserved all existing edits. Run only one heavy job at a time, with Vitest capped at two workers (the restart instruction supersedes the original three-worker request) and Playwright at one worker.

- `npm.cmd test -- tests/landing --maxWorkers=2`: PASS, 48 files / 367 tests; 33.31 s. `tmp/landing-v2/chunk7/resume-unit.log`.
- `npm.cmd run typecheck`: PASS (exit 0). `tmp/landing-v2/chunk7/resume-tsc.log`.
- `npm.cmd run assets:check`: PASS, 45 assets.
- `npm.cmd run build`: PASS (exit 0). `tmp/landing-v2/chunk7/resume-build.log`.
- `LANDING_E2E_USE_BUILD=1 npm.cmd run test:e2e -- --workers=1`: FAIL, **379 passed / 6 failed / 5 skipped**, 28.4 minutes, exit 1. All six failures are `sticky-review.spec.ts:29`, one representative-sweep case per viewport/engine. `tmp/landing-v2/chunk7/resume-e2e.log`. This was the FULL suite, with no grep, retry or last-failed filter. All six font/hydration cases passed. Off-screen expanded privacy, bilingual chip accessibility, catering lazy-photo and CTA non-overlap cases passed in both engines.
- `npm.cmd test -- --maxWorkers=2`: FAIL (exit 1), **13,766 passed / 2 failed / 3 skipped**, 801 files, 329.79 s. Failures are `tests/people-chunkE-review.test.ts:130` and `tests/pm-criteria.test.ts:140`: both spawn `tsx`, which fails in `os.userInfo()` with `uv_os_get_passwd returned ENOMEM` before the intended no-credentials diagnostic. Same failure class recorded in chunk 6; neither file changed here. No database access occurred. Full output: `tmp/landing-v2/chunk7/resume-full-unit.log`. Their assertions remain unchanged.
- **Five-repeat qualification has NOT run.** The first complete six-case matrix already fails. The following figures are one run per viewport/engine, NOT five-run minima, and cannot satisfy the requested qualification.

| Engine | Viewport | Minimum across four profiles |
|---|---|---:|
| Chromium | 375x667 | 52.95% |
| Chromium | 375x812 | 55.95% |
| Chromium | 1440x900 | 71.21% |
| WebKit (Windows) | 375x667 | 52.91% |
| WebKit (Windows) | 375x812 | 55.67% |
| WebKit (Windows) | 1440x900 | 76.24% |

Profiles: reading 40 px / 150 ms, steady 600 px/s, steady 1,200 px/s, repeated 2,400 px/s peak flings with 800 ms linear deceleration and 400 ms rest. Coverage is sampled only after hero actions leave view, under these synthetic profiles; it is not a real-user visibility claim. `tmp/landing-v2/chunk7/resume-rail-summary.json` records every profile's coverage, transition minima and churn limit. All six current `rail-*-0.json` files were refreshed by this run.

Representative failure output (full diagnostics in the log):

```text
Chromium 375x667, steady-600: Expected >= 0.7; Received 0.643603133159269
Chromium 375x667, fling:      Expected >= 0.7; Received 0.5295138888888888
Chromium 375x667, fling:      Expected >= 400 ms; Received 349.59999999962747
Chromium 1440x900, steady-600: minimum transition pair 274.7 ms
WebKit 375x667, fling:       coverage 0.5291095890410958; minimum pair 348 ms

Full unit suite startup failures:
SystemError [ERR_SYSTEM_ERROR]: A system error occurred:
uv_os_get_passwd returned ENOMEM (not enough memory)
    at Object.userInfo (node:os:305:11)
    at .../tsx/dist/temporary-directory-CwHp0_NW.mjs:1:84
```

**Exact resume point:** P2-1/P2-2 and P3-2 remain unresolved in the product. Immediate first appearance, the existing 124 px directional guard and 240 ms recovery dwell do not meet the required margin or strict spacing. A 400 ms hidden-state recovery does not prevent showing immediately before the next collision; the next collision correctly hides the rail, creating a short visible interval. The prior no-dwell/small-guard experiment also failed (recorded below). Next work must fix product availability and safe reappearance, preserve immediate collision suppression and the strict assertions, then rerun the complete suite and five-repeat matrix. No further speculative product change was made during this restart qualification; all pre-restart edits were preserved. Part B remains gated on that result.

The full browser harness exited and its four recorded Next server PIDs (21672, 21836, 19104, 18924) were confirmed absent before starting full Vitest. Current-run screenshots from existing tests' older chunk paths are copied under `tmp/landing-v2/chunk7/screenshots/`; 84 files indexed in `resume-screenshot-index.json`. No native iOS evidence is claimed.

Branch/worktree: `feat/landing-v2`, base `9ea1da96f36735359200da1f248c052f20acbae5`, `C:/Users/conta/co-ops-landing`. Changes are uncommitted. No push, merge, deployment or production data access.

## Part A implementation plan

Apply CC's supplied review rulings to the font harness, sticky visibility policy/component, decorative inventory/Field Guide label and provenance, landing browser/unit tests, and BUILD documentation. Preserve ordering/consent/tracking and food image bytes. Tests first where testable; then landing tests, asset check, TypeScript, build, both full browser projects and full Vitest with two workers (restart resource limit). Qualify representative rail coverage across five repeats per viewport/engine before Part B. Risks: strict temporal/spatial spacing versus fast-scroll availability; local machine contention; real iOS remains external evidence.

## Changed assertion ledger

- `crave-field-guide.spec.ts`: replace loading every declared FontFace with `Promise.allSettled` for computed primary font families used by stage text, then explicitly assert every used font is loaded. Add an unavailable optional fallback to the computed list as a regression, and require a nonempty set of matched loaded faces (fonts.check alone can succeed for unknown names). Compiled Next CSS declares `src:local(Arial)` for its optional fallback, which need not exist on Linux. The committed DM Sans file remains self-hosted. No required-font failure is accepted.
- Same file: preserve stage/control/photo before-versus-after checks; absolute tolerance becomes <=1 CSS px instead of `toBeCloseTo(...,1)` (~0.05 px), explicitly authorized by CC P3-8. Nonzero geometry, control minimum, hydration and decoded-photo assertions remain.
- `sticky-review.spec.ts`: replace the sole 40 px/100 ms sweep with reading (40 px/150 ms), steady 600 and 1,200 px/s and repeated 2,400 px/s peak flings (800 ms linear deceleration, 400 ms rest). Record profile with every result. Keep >=70% and >=400 ms AND >=120 px; observe actual visibility mutations rather than only sample-to-sample changes. Add <=2*distinct inline bands+2 transition bound. Keep stationary consent/hint checks. Add expanded in-flow notice leaving-view regression. Product acceptance remains >=76%, independent of the test threshold.
- `sticky-order.test.ts`: initial appearance is immediate; subsequent recoveries retain the original 240 ms clearance dwell (CC's authorized reveal lever); retain immediate collision/suppression and 400 ms recovery checks. Remove unused y input and fixture arguments.
- `playful-touches.test.ts`: require all six render slots, reject missing/unknown slots, and require illustrated chip provenance. Missing-slot regression failed before the fix.
- `playful-touches.spec.ts`: all non-food decorations remain aria-hidden; the chip must instead be accessible as “Illustrated chip” / “Papa frita ilustrada”. Bounds, exclusion, pointer-events and motion checks remain.
- `languages.spec.ts`: empty chip alt becomes the exact bilingual illustrated-chip dictionary value, as required by CC P3-6; all image counts, food source/dimensions and language assertions remain. The full run exposed the stale empty-alt assertion before this correction.
- `remaining-sections.spec.ts`: split the no-image/no-form assertion, assert zero requests for all catering photo candidates before approach, explain lazy attachment, then require the specific real-food photo after approaching its section (the section also has a decorative image), an actual photo request and the exact source URL. Stronger than only asserting absence before scroll.

## Pre-restart verification (historical; latest outcomes above)

- Initial missing-slot unit regression: failed as expected.
- Initial immediate-reveal regression: failed as expected.
- Baseline representative sweeps: all six viewport/engine cases failed; artifacts under `tmp/landing-v2/chunk7/rail-*.json` (these will be replaced by subsequent runs; logs retain the baseline).
- Font geometry targeted run: 6 passed, both engines and all three viewports. Log `tmp/landing-v2/part-a-font-red.log` is named for the intended regression run, but fixture compilation delayed test discovery until the fix was present; it is GREEN evidence, not a claimed failing-first font run. The supplied CI failure is the font baseline.
- Landing Vitest: 366 passed, one existing filesystem-scanning performance-blocking test timed out at 30 s during contention. Pending rerun.
- `npm.cmd run assets:check`: PASS, 45 assets.
- TypeScript/build/full suites/rail qualification: pending. No CI-green claim; CC must confirm CI on the next authorized push.

## Reproducibility and external gates

`assets:check -- --sources` additionally requires the gitignored `assets/work/subdex-source-frame.png` and original source custody. The normal shipped-asset check does not establish source availability. Build/full tests require the author's shared `node_modules`, including `three` and `@electric-sql/pglite`, or a reproducible install of the lockfile dependencies. A frozen source archive without these prerequisites is insufficient.

Windows Playwright WebKit is not physical iOS Safari. No chunk-7 readiness, native decoder, deployed-poster, Low Power Mode or physical iPhone evidence is claimed. Those remain CC's checks after Part B implementation and on an approved HTTPS revision.

## Verification correction log

The first rebuilt targeted sticky run exited during the 60-second route warm-up, before tests; its JSON files were still baseline evidence. The first full browser run was stopped after it exposed an introduced initial-consent suppression bug, the stale empty chip alt expectation, and an ambiguous catering img locator. No full-suite pass or new rail qualification is claimed from it. The component now preserves the explicit-settings-open flag and gates that flag by actual notice visibility; the initial consent notice is not mistaken for a user-opened settings panel. The off-screen regression now actually toggles settings before scrolling. The constant-speed 2,400 px/s profile is explicitly named sustained-fast, not mislabeled as a native/decelerating fling. The final candidate replaces that provisional stress case with an explicit decelerating fling trace; the old stress evidence is diagnostic only. Five-run qualification is still pending.

Font API diagnostic: `tmp/landing-v2/font-loading-proof.cjs` confirmed Chromium rejects the whole family-list load and reports check=false when an optional fallback fails; loading the primary succeeds with one matched face. WebKit accepted the whole list in this probe; primary-only succeeds there too. This matches why the reported CI failure is Chromium-only, though the actual CI font failure still needs confirmation after CC pushes. The [CSS Font Loading matching algorithm](https://drafts.csswg.org/css-font-loading/#find-the-matching-font-faces) enumerates supplied families; the harness deliberately supplies only the computed primary family and asserts a nonempty loaded match.

The broad no-dwell / 8 px guard experiment was rejected: it produced ~112 ms pairs at 600 px/s while mobile coverage was still only ~72?73%. It is NOT the handed-off policy. The final candidate retains the 124 px guard and 240 ms recovery dwell, with immediate FIRST appearance only. The recovery-dwell regression failed before restoring that behavior (`tmp/landing-v2/recovery-dwell-red.log`). Scroll-cost tests now wait explicitly for hydration, fonts and two layout frames instead of assuming 500 ms always settles them; their zero-style-read / zero-link-query assertions remain unchanged.
