# CC rail-rule replacement - 2026-10-17

Current status: Part A committed at 49a143ab, parent 9ea1da96. Part A′ review fixes QUALIFIED. Part B implemented and functionally verified, but NOT performance-qualified: advisory LCP fails in both consent states. CI and physical iPhone release gates remain open. See the appended sections; historical results below belong to superseded work.

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

`git diff --check`: PASS (exit 0). Harness teardown completed; its PID file is absent and no listener remains on ports 44170-44175. Branch **feat/landing-v2**, Part A committed at **49a143ab**, parent **9ea1da96**, worktree **C:/Users/conta/co-ops-landing**. This records the committed Part A baseline; subsequent Part A′ changes are recorded separately below.



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

## Part A′ — frozen-head review fixes (2026-10-17)

Plan: preserve and inspect the interrupted edits against CC's numbered rulings, qualify the existing component/policy/i18n changes, then finish this result before Part B. No asset, server, API or data changes. The reviewed CC packet supplies the bounded implementation decisions; final independent review remains CC's.

Assertion ledger (relative to 49a143ab):

- `sticky-review.spec.ts`: restore the privacy test's `abs(scrollY-y) <= 1` assertion (stronger; no dead captured position). Representative sweeps now call `settleLayout()` before starting the measurement clock; coverage, transition, spacing, consent and hint assertions are unchanged. Product qualification still requires all six cells to achieve at least 85% across five runs.
- `sticky-review.test.ts`: add component-contract assertions tying both observer margins and released hero state to `STICKY_SHOW_CLEARANCE`, checking `!entry.isIntersecting`, and checking the missing-footer inert guard precedes observer construction (stronger).
- `sticky-order.test.ts`: add hide-to-show dwell checks for all three blockers and six release delays, including 399/400 ms boundaries (stronger). Remove only redundant recovery arithmetic from the implementation; retain 400 ms sustained dwell.
- `languages.spec.ts`: add en/es whole-page absence assertions for Illustrated/Ilustrad/AI, including after section scrolling and spin attachment; pin the neutral accessible spin name. Replace the chip's illustrated accessible name with empty-alt decorative semantics while retaining exact image inventory, real-photo URLs, dimensions and full ingredients.
- `playful-touches.spec.ts`: require every touch, including the chip, to be aria-hidden with empty alt; geometry, pointer-event and motion checks remain. This is the intentional accessibility-contract change required by Juan's 2026-10-17 ruling.
- `static-v2.spec.ts`: replace the illustrated spin's accessible name with `Crunchy Boi spin`; keep click-only source attachment and native controls assertions.
- `playful-touches.test.ts`: rename the test to distinguish internal illustrated provenance; all provenance assertions remain unchanged.
- `crave-field-guide.spec.ts`: remove the inert optional FontFace injection and its comment; primary-font load and geometry assertions remain unchanged.

Files: `StickyOrderBar`, `IllustratedSpin`, `PlayfulTouch`, `FieldGuide`, `app/eat/page.tsx`, sticky policy, en/es dictionaries, the eight test files listed above, BUILD and this RESULT. BUILD/RESULT now identify Part A as committed at 49a143ab, parent 9ea1da96. No visible classification tags; internal provenance and asset identity checks remain.

Verification (logs and screenshots: `tmp/landing-v2/chunk7/aprime-*`):

- `npm.cmd test -- tests/landing --maxWorkers=2`: PASS, 48 files / 369 tests, exit 0.
- `npm.cmd run assets:check`: PASS, 45 assets, exit 0.
- `npx.cmd tsc --noEmit`: PASS, exit 0.
- `npm.cmd run build`: PASS, exit 0.
- `npx.cmd eslint <changed .ts/.tsx files>`: exit 1; only the pre-existing `StickyOrderBar.tsx:16` set-state-in-effect error and `app/eat/page.tsx:41` no-img-element warning. The unused-variable warning is gone. Baseline findings retained per CC's ruling.
- `LANDING_E2E_USE_BUILD=1 npm.cmd run test:e2e -- --workers=2`: PASS, **391 passed / 5 existing skips**, 14.6 minutes, captured native exit 0 and status JSON. The restored privacy-position assertion passes in BOTH engines; no anchoring exception or renamed test needed. Four en/es Chromium/WebKit screenshots are saved under `aprime-*-subdex.png`; the Chromium English capture was visually inspected. Windows WebKit decoder skips remain unresolved native evidence.
- Full-suite teardown: PID file absent; no listeners found on 44170–44175 before starting the repeat matrix.
- `LANDING_E2E_USE_BUILD=1 npm.cmd run test:e2e -- tests/e2e/landing/sticky-review.spec.ts --grep "representative rail" --repeat-each=5 --workers=2`: PASS, **30 passed**, 19.6 minutes, captured native exit 0. `aprime-repeat5-summary.json` records `qualified: true` for the independent >=85% product threshold. Each cell below is the minimum of five repeats × four profiles.

| Engine | Viewport | Minimum coverage | Max transitions | Min pair ms | Min pair px |
|---|---|---:|---:|---:|---:|
| Chromium | 375x667 | 90.67% | 2 | 5334 | 6384 |
| Chromium | 375x812 | 91.12% | 2 | 5549.2 | 6655 |
| Chromium | 1440x900 | 91.77% | 2 | 5858 | 7040 |
| WebKit | 375x667 | 90.57% | 2 | 5335 | 6402 |
| WebKit | 375x812 | 90.60% | 2 | 5543 | 6620 |
| WebKit | 1440x900 | 89.67% | 2 | 5806 | 7029 |

Every trace has one consent-top value. Matrix teardown: PID file absent and no listener found on 44170–44175. Part A′ is complete before Part B changes. Changes remain uncommitted on `feat/landing-v2`, HEAD `49a143ab87baa62d56508e5b9e8e34840287dcbb`, worktree `C:/Users/conta/co-ops-landing`.

## Part B — SUBDEX reliability and iPhone coverage

Plan (CC's BUILD chunk 7): reproduce readiness/retry failures first; preserve the SSR poster and source identity; bound readiness after two paint opportunities; retain gesture retry, decode-gated reveal, eight-second stall recovery and one-shot completion; add the scoped iPhone project and device release checklist. Risks: asynchronous media events, platform decoder support, initial JS/transfer cost and CI duration. No deployment or device access is available.

Diagnosis: before product changes, `partb-red.log` records **four expected failures**, both regressions in both Chromium and WebKit. A supported LCP observer emitting no entries never set readiness; a rejected `play()` removed both video and retry control permanently. `partb-readiness-red.log` is only a missing-module unit-test setup failure, not runtime reproduction. Juan's particular phone incident is still unattributed: no device/revision/network trace was supplied. The existing `muted` and `playsInline` attributes were already present; they were not the missing implementation.

Changes: `DeferredMotion` now preserves one poster subtree instead of replacing it after scrolling; `HeroMotion` defers media attachment using the shared viewport scheduler and bounded readiness, keeps a mounted retryable video, calls Play directly in the user gesture, reveals only decoded progress, pauses offscreen/hidden, restores a still on an eight-second stall, and does not loop or automatically restart a completed excerpt. A failed poster has reserved geometry and a neutral bilingual accessible fallback. The readiness helper accepts load/LCP or a 1.5-second deadline only after two RAF opportunities. Initial media still cannot attach offscreen or under Reduce Motion/Save-Data. This trades the former dynamic component import for a small initial controller; transfer/performance must be measured, not presumed unchanged.

Assertion ledger:

- `iphone-subdex.spec.ts`: new en/es × unset/accepted/rejected poster and native-order coverage, keyboard gesture retry after an actual rejected attempt, LCP/load stall, unavailable observers, pre-hydration scroll with poster-node continuity, document hide/show, no-decoded-progress concealment, eight-second stall/retry, completed-excerpt no-replay, poster/MP4 404, Save-Data, no-JS and unshimmed decoded-dimensions/time proof. New coverage; no prior assertion removed.
- `remaining-sections.spec.ts`: replace permanent-failure/no-control expectations with a hidden video plus usable retry control. Keep the successful-play-attempt requirement, visible still and spin privacy assertions. The keyboard/viewport control test explicitly uses the new media simulation in all engines, replacing its former Windows-only `playing` shim; it is state-machine evidence, not decoder evidence. Add no-loop assertion; native playback proof now has its own unshimmed test.
- `media-policy.test.ts`: add completed-excerpt automatic-play denial; keep every readiness/privacy/preference gate.
- `media-readiness.test.ts`: require two paint opportunities even after signal/deadline, and check 1499/1500 ms timeout and earlier post-paint signal release.
- `video-proof.spec.ts`: preserve source hashes and first-frame pixel thresholds; add `videoWidth > 0` and advancing native playback time (stronger).
- `playwright.config.ts`: retain both full engine projects, add only the reviewed scoped iPhone 13 Mini media project, and cap default workers at two. CI timeout remains 25 minutes.

Native iOS release checklist: [docs/qa/landing-v2-device-checklist.md](qa/landing-v2-device-checklist.md). Windows emulation cannot establish native iOS Safari decoding, Low Power Mode behavior or deployed-poster correctness. [WebKit's policy](https://webkit.org/blog/6784/new-video-policies-for-ios/) supports direct gesture-handler playback; physical testing remains required.

Verification (logs/screenshots use `tmp/landing-v2/chunk7/partb-*`):

- `npm.cmd test -- tests/landing --maxWorkers=2`: PASS, 49 files / 371 tests, exit 0.
- `npm.cmd run assets:check`: PASS, 45 assets, exit 0; no asset/provenance changes.
- `npx.cmd tsc --noEmit`: PASS before build and after final browser-test edits (`partb-tsc-final.log`), exit 0.
- `npm.cmd run build`: PASS, exit 0. No production code changed afterward.
- Changed/new-file ESLint: exit 1, only the retained `StickyOrderBar:16` effect error and existing page/SubdexMoment no-img-element warnings. New media/readiness/test code passes targeted ESLint with exit 0.
- FULL `LANDING_E2E_USE_BUILD=1 npm.cmd run test:e2e -- --workers=2`: **468 passed, 12 skipped, zero failed/flaky**, captured native exit 0, **16.9 minutes**. Chromium 214/214; WebKit 208 passed/6 skipped; iPhone WebKit 46 passed/6 skipped. Each WebKit project skips five existing spin codec cases plus the new native SUBDEX decoder case on Windows; simulations are not counted as decoder proof. Native Chromium SUBDEX dimensions/time and the four strengthened decoder-reference tests pass.
- Saved HTML-report data in `partb-report.json`; `partb-timings.json` derives actual project elapsed spans from result startTime/duration: Chromium 260.536 s, WebKit 553.684 s, scoped iPhone 92.200 s; total including setup 1014.063 s. Local targets met (iPhone <3 min, full <22 min); actual CI job duration/exit remains pending because this handoff is uncommitted and unpushed. CI's 25-minute timeout is unchanged.
- Captured en/es × three consent states in all three projects under `partb-*-{lang}-{consent}.png`; visually inspected the Chromium Spanish unset capture: decoded poster, readable shop links, no asset tags.
- Advisory `npm.cmd run perf:ci`: **FAIL, native exit 1**. First two attempts (Playwright Chromium and installed Chrome) timed out before measurements, both states incomplete. The harness-supported `LANDING_PERF_NO_SANDBOX=1` launch mode resolved the launcher timeout; it ran all ten cold measurements using the installed cached LHCI 0.15.1 CLI and the existing build. No thresholds/config files were relaxed. The third attempt also reports Windows cleanup `ERROR: Access denied`; unlike earlier historical runs, this attempt has a real LCP assertion failure too.

| Consent | Cold runs | Median performance | Accessibility | LCP ms | TBT ms | CLS | First-party bytes, every run |
|---|---:|---:|---:|---:|---:|---:|---:|
| Unset | 5 | 0.93 | 1.00 | **3092.306 FAIL** | 66 | 0.002750 | 302342 |
| Accepted | 5 | 0.93 | 1.00 | **3097.252 FAIL** | 64.5 | 0.052699 | 302342 |

Evidence: `partb-perf-restricted.log`, captured exit file, `partb-perf-summary.json`; all ten raw reports and assertion results in `tmp/landing-performance/2026-10-17T23-58-53.846Z-merge-65a7ed67/`. First two incomplete attempts are retained at `2026-10-17T23-54-41.510Z-merge-5785eb02` and `2026-10-17T23-56-51.384Z-merge-2c48f8b5`. Pixel is blocked only in this offline measurement harness, not product code; no real-Pixel performance claim.

LCP diagnosis at the stop point: Lighthouse identifies the unchanged P013 hero image. Its discovery audit passes (SSR-discoverable, eager, high priority); a sampled unset report attributes 2204 ms of 3172 ms to render delay. This does not establish a root cause or prove the failure predates Part B. The earlier successful r2 report is from a different implementation, so it is not a controlled regression comparison. Do not waive the 2499.999 ms gate or label performance green.

**Clean stop / remaining work:** Part A′ is complete. Part B source and functional tests are complete, but performance qualification remains open: investigate hero render delay and obtain the authoritative CI gate/actual job duration; then CC must run the deployed-revision/poster and physical iPhone normal/Low Power checks in the linked checklist. Juan's original device incident cannot be uniquely attributed without that evidence. No native iOS Safari result is claimed.

Final cleanup: harness PID file absent; no listeners found on ports 44170–44175 after the last run. No servers remain from these runs. All changes are UNCOMMITTED on `feat/landing-v2`, HEAD `49a143ab87baa62d56508e5b9e8e34840287dcbb`, worktree `C:/Users/conta/co-ops-landing`. No push, merge, deployment or production data access.

## Fix round C (base 610ca9bb)

Status: media/assertion fixes implemented and functional verification complete, including the repeat rail matrix. P0 is NOT resolved; this is NOT merge-ready. Branch `feat/landing-v2`, dedicated worktree `C:/Users/conta/co-ops-landing`; uncommitted, no push/merge/deploy. Plan: `docs/landing-v2-roundc-PLAN.md`.

### P0 evidence and experiments

The supplied CI LHRs report *simulated* LCP. In sampled fast/slow CI reports, observed LCP is 151/132 ms, not 2338/3045 ms. The local trace at `tmp/landing-v2/chunk7/roundc-trace-trace.json` establishes image load end 71.7 ms, initial layout 91.25–118.55 ms, image paint 120.47 ms, image decode 124.00–128.04 ms, React core evaluation 138.08–162.59 ms, and first presented LCP 186.09 ms. There is no observed 1.8-second image decode or hydration reveal gate.

The matching Lantern graph (`roundc-trace-graph.json`) includes React's `0rin-2ldzqm~l.js` because it evaluates before that presentation. It is the critical dependency: optimistic network completion 2890 ms plus evaluation to 2988 ms; pessimistic completion/evaluation 3040/3138 ms; combined LCP 3063 ms. The hero image ends at 2126 ms in this graph. In the local fast baseline run, core download ends at 294 ms, after observed LCP 277 ms, so it falls outside this paint dependency set. This identifies the timing-band mechanism; it does not establish a successful product remedy.

Unchanged `LANDING_PERF_NO_SANDBOX=1 LANDING_E2E_USE_BUILD=1 npm.cmd run perf:ci` using cached LHCI 0.15.1 and installed Chrome, five cold runs per consent state:

| Candidate | Unset LCP ms, all five | Accepted LCP ms, all five | Outcome |
|---|---|---|---|
| Baseline build | 2477.113, 2999.835, 3062.560, 3031.893, 3047.152 | 3081.531, 3047.076, 3052.341, 3048.579, 3043.383 | FAIL, exit 1 |
| Hero `decoding="sync"` | 3068.447, 3015.743, 3079.926, 3061.840, 3004.994 | 3064.993, 3064.302, 2995.936, 3034.203, 3119.599 | FAIL, exit 1; reverted |
| Final media fixes (sync reverted) | 3061.866, 3069.653, 3051.858, 2997.871, 2999.893 | 3073.223, 3059.261, 3045.174, 3057.534, 3054.179 | FAIL, exit 1; 0/10 under 2500 ms |

Raw runs: `tmp/landing-performance/2026-10-18T02-12-24.771Z-merge-0300b798/` and `2026-10-18T02-20-33.368Z-merge-85ca548f/`. First baseline invocation without explicit CHROME_PATH failed Chrome discovery and collected no runs (`02-11-30.354Z-merge-8a7d3bd8`); it is not a measurement. No budget/config assertion changed. The synchronous-decode markup assertion failed first in both languages, but the performance experiment failed, so neither the attribute nor its assertion remains.

Sol's read-only analysis confirmed the framework chunk cannot be removed by simply moving existing SSR hero nodes outside their client wrapper. Next's documented `experimental.inlineCss` is a candidate because it removes blocking stylesheet requests, but it is GLOBAL. CC plan review was requested before making that broader change, per AGENTS.md. No config change is made. Throwaway response-interception inline experiments are NOT gate evidence: the uncompressed response distorted transfer size; the gzip interception did not yield a valid hero-image measurement. Neither is counted as a pass.

### Changed-assertion ledger

- `hero-motion-runtime.test.ts`: invokes the real component's updater/effects through deterministic hooks. Sixty identical scroll callbacks must retain state identity, observer registration must omit offscreen mode, and a real exit must pause. Failed first on the old allocation behavior; passes after fixing both the viewport updater and attachment wrapper.
- `media-readiness.test.ts`: runtime timer-before-two-RAFs regression; readiness releases exactly once on the second RAF after the deadline. This PASSES on 610ca9bb: the requested second-RAF clock check already existed, so no speculative helper rewrite.
- `languages.spec.ts`: stronger word-safe en/es absence pattern for Illustrated/Ilustrad/AI/Drawn/Edited/Dibujad/Editad/Generad/standalone IA. No visible tags added.
- `remaining-sections.spec.ts`: retain all-engine simulated keyboard/viewport test and add an unshimmed Chromium variant requiring decoded dimensions and progressing time.
- `sticky-missing-footer.spec.ts` plus the isolated nearby fixture: actually render without Footer's order group, observe the real rail while scrolling, and require hidden/inert/aria-hidden throughout. No production test switch or rail policy change.
- `helpers/sticky.ts`: replace the timing-dependent scroll with mounted consent measurement, font/two-frame settling, clearance of both hero actions and an in-flow notice, and explicit assertions explaining eligibility. Product suppression/dwell rules unchanged.
- `iphone-subdex.spec.ts`: wrap the actual React click handler and assert enter → play → exit, plus active-handler marker and existing userActivation evidence. Replace no-replay-after-reentry with completion → still; stay/jitter/hide-show → no replay; full exit/reentry → exactly one replay using the same video node; second completion → still.
- BUILD: Juan's once-per-arrival rule supersedes Part B's page-lifetime completion latch. Reduce Motion/Save-Data, hidden-tab pause, initial media gates and manual replay remain.

### Verification

- Landing Vitest: `npm.cmd test -- tests/landing --maxWorkers=2` PASS, 50 files / 373 tests, exit 0.
- `npm.cmd run assets:check`: PASS, 45 assets, exit 0.
- `npx.cmd tsc --noEmit`: PASS, exit 0.
- Changed-file ESLint: PASS, exit 0 (`roundc-eslint-final.log`).
- Final `npm.cmd run build`: PASS, exit 0 (`roundc-final2-build.log`); no product source edits afterward.
- FULL `LANDING_E2E_USE_BUILD=1 npm.cmd run test:e2e -- --workers=2`: **471 passed, 13 skipped, zero failed/flaky**, native exit 0, 17.3 minutes. Report data preserved as `roundc-e2e-report.json`. The extra skip is the Chromium-only native keyboard/viewport test on WebKit; the other 12 are retained Windows codec skips. Native Chromium control/decoder proof passed; simulations are not decoder proof.
- Final `LANDING_PERF_NO_SANDBOX=1 LANDING_E2E_USE_BUILD=1 npm.cmd run perf:ci`: FAIL, native exit 1, all ten LCP values above. Raw reports: `tmp/landing-performance/2026-10-18T02-55-41.771Z-merge-e49e979d/`; log `roundc-perf-final.log`. First-party transfer 302492 bytes in every run; both consent states fail only the LCP summary check. No performance budgets/assertions changed.
- `LANDING_E2E_USE_BUILD=1 npm.cmd run test:e2e -- tests/e2e/landing/sticky-review.spec.ts --grep "representative rail" --repeat-each=5 --workers=2`: **30 passed, zero failed/flaky/skipped**, native exit 0, 19.4 minutes. All 30 trace files are newer than the recorded run start; copies retained in `tmp/landing-v2/chunk7/roundc-rail-evidence/`. Report: `roundc-rail-report.json`; strict qualification: `roundc-repeat5-summary.json`, qualified=true across 120 profiles. Every profile has one consent-top value.
- P0 all-ten-under-2500 target: NOT MET. No CI-green or physical iOS claim.

| Engine | Viewport | Minimum coverage (20 profiles) | Max transitions | Min pair ms | Min pair px |
|---|---|---:|---:|---:|---:|
| Chromium | 375x667 | 90.80% | 2 | 5349.1 | 6393 |
| Chromium | 375x812 | 91.01% | 2 | 5551.3 | 6645 |
| Chromium | 1440x900 | 91.76% | 2 | 5845.2 | 7020 |
| WebKit | 375x667 | 90.33% | 2 | 5326 | 6396 |
| WebKit | 375x812 | 90.53% | 2 | 5539 | 6639 |
| WebKit | 1440x900 | 90.46% | 2 | 5805 | 7038 |

Remaining blocker: no successful P0 product fix. The concrete next experiment and risks are in `docs/landing-v2-roundc-PLAN.md`; CC's cross-family plan review was requested and has not arrived. The supplied charter (`C:/Users/conta/.codex/AGENTS.md`) requires "a reviewer from another family reads it before you code (CC arranges this)." The proposed global Next configuration change has therefore not been authored. Final independent code review also remains CC's responsibility.

Cleanup: PID file absent; TCP probes confirm ports 44170 through 44175 closed after the final matrix. All changes remain UNCOMMITTED on `feat/landing-v2`, HEAD `610ca9bb`, worktree `C:/Users/conta/co-ops-landing`. No push, merge, deployment, production data change, asset change or visible tag added.


## Round D - landing-scoped LCP experiments (base 9872e9b5)

**LCP remains unresolved.** CC's reviewed landing-only sequence was followed; global experimental.inlineCss, root layout, ops routes/styles, CSP and the performance configuration/budgets were not changed. Plan: docs/landing-v2-roundd-PLAN.md. The CSS-only candidate failed all ten runs and has been reverted. Final functional verification passed; the final performance gate still fails. No visible tags or asset changes.

### Experiment 1a and unchanged perf:ci

The candidate replaced only the /eat CSS import with a server-read, processed inline style, preserving its position after root CSS. Lightning CSS 1.32.0 generated the artifact; a freshness test and npm prebuild/predev regenerated it. Next traced the artifact into both /eat and /eat/privacy functions without a config exception. The existing self-hosted font URLs stayed in the unmodified root bundle. This was a real build, not response interception.

| Build | Unset LCP ms (all five) | Accepted LCP ms (all five) | Outcome |
|---|---|---|---|
| Round C baseline | 3058.955, 3052.148, 3000.925, 3008.102, 3074.853 | 3093.775, 3091.389, 3049.816, 3055.383, 3062.167 | FAIL, exit 1; 0/10 <2500 |
| 1a, landing CSS inline | 3086.611, 3069.492, 2947.092, 2947.205, 2930.579 | 2942.295, 2985.141, 3116.296, 3003.436, 2986.401 | FAIL, exit 1; 0/10 <2500 |
| Restored Round C, final verification | 3076.587, 3053.595, 3009.153, 3044.526, 3045.325 | 3070.847, 3012.762, 3082.321, 3063.838, 2998.479 | FAIL, exit 1; 0/10 <2500 |

Commands used explicit CHROME_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe, LANDING_PERF_NO_SANDBOX=1, LANDING_E2E_USE_BUILD=1, and the cached LHCI 0.15.1 CLI. All three matrices ran unmodified npm.cmd run perf:ci. Raw evidence: tmp/landing-performance/2026-10-18T03-23-15.358Z-merge-0a7bb42f and tmp/landing-performance/2026-10-18T03-30-17.638Z-merge-e1311022. Logs: tmp/landing-v2/chunk7/roundd-{baseline,inline-perf}.log. Baseline transferred 302492 first-party bytes per run; the candidate transferred 304390 (+1898), despite removing one stylesheet request. CLS was identical across all ten runs in each build: unset 0.00274989231721226; accepted 0.0526993970522216. These remain offline first-party-only measurements, with Pixel blocked by the existing harness.

English and Spanish 375x812 reduced-motion screenshots were byte-identical before/after; hero/consent rectangles, font values, margins and padding also matched exactly. Root CSS SHA-256 remained 3296cc9c2d8f1bd765deef4b2fc3fcb7d90fd4bdaf3381def1079df9ac1f15d8. The initial /login-path CSS check also matched (that path is the staff 404; the actual login route is / and was compared separately after rebuilding the restored source). Evidence: roundd-before/roundd-inline JSON, HTML and PNG files. No visual-equivalence claim is based solely on a screenshot glance.

### What /eat inherits from globals.css

The supplied three-request premise does not match this HEAD's real network log: /eat requests TWO stylesheets. Root 09g.k_tok-kbd.css = 90957 B raw, 14895 B with this Node gzip run; landing 0sn3ubcrz66kb.css = 13895 B raw, 3001 B gzip. The third CSS artifact on disk is 0t48hzs_6fshe.css (10572 B), Leaflet, and is NOT requested by /eat. next/font/local's DM Sans CSS is merged into the root bundle, not a third request. No third stylesheet was removed speculatively.

The root dependency includes Tailwind Preflight/reset (box sizing, margins, heading/list/button/link/image defaults), theme variables, root palette variables, html/body typography and backgrounds, DM Sans @font-face/fallback/variable declarations, utility rules and their property initialization. The landing still uses the following root classes across English/Spanish home/privacy at 375 and 1440 pixels:

antialiased, aspect-square, backdrop-blur-sm, bg-[#FFE560], bg-[var(--co-cta)], bg-co-bg, bg-co-surface, bg-co-surface/70, block, border, border-2, border-co-border, border-co-border/70, border-co-cta-text, border-co-text, cursor-pointer, dmsans_fad5d34c-module__HgcYia__variable, flex, flex-col, flex-wrap, focus-visible:outline-2, focus-visible:outline-offset-4, font-black, font-bold, gap-2, gap-3, gap-5, gap-x-10, gap-x-5, gap-y-2, gap-y-4, grid, group, group-open:rotate-45, h-12, h-auto, h-full, inline-flex, items-center, justify-between, justify-center, leading-none, leading-relaxed, list-none, max-w-2xl, max-w-full, max-w-lg, max-w-xl, min-h-11, min-h-[52px], min-h-full, min-h-screen, min-w-11, motion-safe:duration-300, motion-safe:transition-transform, mt-2, mt-3, mt-4, mt-6, mx-auto, not-italic, object-contain, overflow-hidden, overflow-x-auto, p-4, p-5, pb-32, pb-4, pb-5, px-3, px-4, px-5, py-10, py-3, py-4, relative, rounded, rounded-2xl, rounded-lg, rounded-xl, shrink-0, sm:grid-cols-2, sm:text-base, snap-mandatory, snap-start, snap-x, space-y-6, sr-only, text-2xl, text-3xl, text-[var(--co-text)], text-co-cta-text, text-co-text, text-co-text-dim, text-co-text-muted, text-left, text-lg, text-sm, text-xl, tracking-tight, underline, w-44, w-[280px], w-full

A conservative class-matched extract retaining base/theme/fonts/@property rules is **21468 B raw / 5475 B gzip** (roundd-root-subset.css/json). This is a dependency inventory, NOT a proven minimal replacement: pseudo states and complete variable/property definitions are retained. Chrome's CSS coverage reports 83052 B due to nested/layer ranges; it is not a reliable byte-minimum and was not used as one. No ops CSS was edited or removed.

### Step 2 - framework evaluation versus paint

All times below are milliseconds after navigation; image paint is PaintImage, presented frame is the hero's largestContentfulPaint::Candidate. First framework is the first /_next EvaluateScript; core is 0rin-2ldzqm~l.js. The first three are slow; delay-core is a deliberately controlled fast diagnostic, not a naturally passing gate run. No natural fast run occurred in any of the three ten-run matrices.

| Trace | Simulated LCP | Hero paint | Presented frame | First framework evaluate | Core evaluate |
|---|---:|---:|---:|---:|---:|
| before | 3054.464 | 132.339 | 198.626 | 88.585 | 149.836 |
| inline | 3069.239 | 155.501 | 219.479 | 102.469 | 163.32 |
| root-only | 2929.176 | 95.017 | 149.258 | 64.648 | 111.779 |
| delay-core | 2306.940 | 95.91 | 142.723 | 103.217 | 372.298 |

Evidence: roundd-{before,inline,root-only,delay-core}-trace-{lhr,trace,graph,ordering}.json under tmp/landing-v2/chunk7. The baseline core evaluation runs for 21.502 ms. The relevant distinction remains image paint versus presentation, not image fetching or a hydration visibility gate.

- Hero is already a Server Component; its children pass through client wrappers as server-rendered content. Moving nodes alone does not suppress root framework scripts. Next 16.2.4's server/app-render/required-scripts.js derives them from buildManifest.rootMainFiles, and app-render.js calls preinitScripts independently of the landing's client islands.
- root-only blocks every non-root application script request in a scratch Lighthouse diagnostic (the ordinary SSR HTML still renders). Even this stronger-than-idle island removal leaves core evaluation ahead of the hero frame and LCP at 2929 ms. It deliberately prevents hydration and is NOT a shippable change or privacy/interaction pass. Deferring rail/touches/motion/consent effects would not defer the root framework evaluation demonstrated here, so no such ineffective behavior change was retained.
- All baseline framework and application script requests already have Low priority. Adding fetchPriority=low would not lower the observed priority. Fetch priority also cannot enforce execution-after-presentation.
- delay-core holds ONLY the core request for 300 ms using Puppeteer interception, without rewriting HTML. It gives the controlled fast ordering above and simulated LCP 2307 ms. It proves the scheduling mechanism; it does not implement a product scheduler, and smaller framework scripts still evaluate before the frame. No CDP/interception hook was added to product code or perf:ci.

### Applied-throttling diagnostic

Ten Lighthouse devtools runs completed on the same inline-CSS build. Scratch config tmp/landing-v2/chunk7/roundd-devtools.cjs overrides only throttlingMethod; each consent state uses five cold runs and the same consent harness. The repository lighthouserc, gate and assertions remain unchanged. Both collections exit 0; LHCI also prints Windows cleanup ERROR: Access denied, with all ten reports saved and child servers explicitly stopped. Diagnostic results never count as simulated-gate passes.

| Consent | Applied LCP ms, all five | Median ms | Range ms |
|---|---|---:|---|
| unset | 2069.924, 2837.153, 2458.920, 2446.946, 2373.502 | 2446.946 | 2069.924-2837.153 |
| accepted | 2038.083, 2517.622, 2479.350, 3087.306, 2418.474 | 2479.350 | 2038.083-3087.306 |

Seven of ten are below 2500 ms. Recorded applied settings: requestLatencyMs=562.5, downloadThroughputKbps=1474.56, uploadThroughputKbps=675, cpuSlowdownMultiplier=4 (Lighthouse mobile defaults); rttMs=150 and throughputKbps=1600 remain in config but belong to simulation. This method-only switch does not mean the simulator and applied network models are identical. Evidence: roundd-devtools/{unset,accepted}/summary.json plus every raw LHR; roundd-devtools.log and .exit.

### Assertion ledger and final verification

The candidate's new server-markup assertion failed first on Round C (roundd-inline-red.log): no inline style existed. It passed after the product change. The candidate also added generated-CSS freshness coverage and a browser assertion that landing rules are inline after root CSS, are absent from linked CSS, and never appear in staff markup. Candidate-only assertions were removed with the reverted implementation; no pre-existing assertion is weakened or deleted.

Candidate verification: landing Vitest + tests/security-headers.test.ts: 52 files / 399 tests PASS (roundd-unit.log); tsc, assets:check, changed-file ESLint and build all exit 0. Processed CSS artifact present in both landing function trace manifests. The offline npm metadata request was not cached, so the exact already-installed Lightning CSS version was declared directly in package.json/package-lock.json; those experimental declarations are also reverted. The eight candidate files and tracked diff are preserved in tmp/landing-v2/chunk7/roundd-inline-candidate/. Git index writes are sandbox-denied, so restoration used exact git show HEAD:file bytes with read-back verification; it did not change the index or Round C. Read-only index metadata can leave stale M flags for layout/package.json in git status; direct HEAD-byte comparisons and git diff confirm no source differences.

Final product source was restored byte-for-byte from HEAD; git diff has no application, package, security, perf-config or existing-test changes. Only this RESULT and the Round D PLAN remain for handoff. Final commands/outcomes:

- npm.cmd test -- tests/landing tests/security-headers.test.ts --maxWorkers=2: PASS, 51 files / 397 tests, exit 0 (roundd-final-unit.log).
- npx.cmd tsc --noEmit: PASS, exit 0 (roundd-final-tsc.log).
- npm.cmd run assets:check: PASS, 45 assets, exit 0 (roundd-final-assets.log).
- npm.cmd run build: PASS, exit 0 (roundd-final-build.log).
- Changed-file ESLint passed for the experimental code before reversion; no changed JS/TS remains to lint in the final diff.
- Actual staff login shell at http://127.0.0.1:44170/ (the fixture location-unavailable state, visually inspected; not a production/authentication test) was captured on the inline build and the restored build: PNG bytes, root CSS hash and computed geometry all match. The same comparison is exact for English/Spanish landing captures (roundd-inline-actual-login and roundd-restored artifacts). The earlier /login 404 comparison is not being presented as login-page proof.
- FULL LANDING_E2E_USE_BUILD=1 npm.cmd run test:e2e -- --workers=2 --reporter=list,json: PASS, 471 passed / 13 existing skips / zero failed or flaky, exit 0, 17.5 minutes. Machine-readable report: roundd-final-e2e-report.json (PLAYWRIGHT_JSON_OUTPUT_FILE); log: roundd-final-e2e.log. All pre-existing assertions remain intact; Windows codec skips and the Chromium-only playback case on WebKit remain skips, not decoder proof.
- Final unchanged npm.cmd run perf:ci: FAIL, native exit 1; all ten LCP values are in the table above. LCP is the only failed assertion in both consent states. Evidence: tmp/landing-performance/2026-10-18T04-00-33.283Z-merge-459dd14a; roundd-final-perf.log and .exit. First-party bytes 302488 per run; no gate/config change.
- Cleanup: harness PID file absent; TCP probes confirm ports 44170-44175 closed (roundd-cleanup.json). No harness servers remain.
- git diff --quiet -- app components lib scripts tests package.json package-lock.json next.config.ts lighthouserc.cjs: exit 0 (no retained product/config/test diff). git diff --check: PASS. Prior RESULT content preserved; Round D is append-only.

### Proposed scope expansion for CC (not implemented)

A supported way to remove the remaining shared root stylesheet from /eat is a separate landing root/layout with its own processed base/font/utility CSS. This requires CC approval: the present app has 18 top-level directories and 439 tracked files (292 API, four landing, 143 remaining). A route-group design would move the ops page trees (including (authed), admin, order, training and the root login page), distribute metadata/error/not-found ownership, preserve fonts and relative imports, and review pathname/file-path tests; API handlers need not be moved merely to change page layouts. Estimate: roughly 15 page-directory moves plus root entry files, two root layouts, about 140 non-API/non-landing files to audit, plus path-sensitive tests/config, and 1-2 engineering days including cross-family review, auth/staff regression tests, browser checks and repeated ten-run performance measurements. This is an estimate, not approval or a guarantee of LCP success. No route restructuring was performed.

Branch/worktree: feat/landing-v2 at C:/Users/conta/co-ops-landing, base 9872e9b5. Round C is preserved. Round D remains uncommitted; no push, merge, deployment or production access.

## Round E — controlled A/B and lazy HeroMotion candidate (base 16950ac4)

The historical fast mode did **not** reproduce locally: `49a143ab` and unchanged HEAD both measured **0/10 below 2500 ms**. Therefore CC's step 3 applies: test only step 2a, retain the bounded lazy-import candidate for CI judgment, and do not bisect poster/readiness/media-policy changes. This local A/B cannot attribute the historical CI regression. Plan: `docs/landing-v2-rounde-PLAN.md` (CC's supplied reviewed sequence).

### Controlled A/B

Both builds used `npm.cmd run build` (Next 16.2.4 Turbopack), then unchanged `npm.cmd run perf:ci`, sequentially on this machine. Environment: `CHROME_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe`, `LANDING_PERF_NO_SANDBOX=1`, `LANDING_E2E_USE_BUILD=1`, `LHCI_CLI_PATH=C:/Users/conta/AppData/Local/npm-cache/_npx/7c4c7312e9ccc7bf/node_modules/@lhci/cli/src/cli.js` (cached 0.15.1). The four performance harness/config files, package versions, Next config, root layout and root CSS have no baseline-to-HEAD diff. No server was listening on 44170–44175 before the first build; the harness tears its servers down between consent sets.

| Build | Unset LCP ms (all five) | Accepted LCP ms (all five) | Fast / slow | Gate |
|---|---|---|---|---|
| 49a143ab archive | 3081.411, 3026.242, 3005.351, 3049.668, 3048.995 | 3022.874, 3123.621, 3072.129, 3051.175, 3003.005 | 0 / 10 | FAIL, exit 1 |
| HEAD 16950ac4, round C source | 2841.500, 3009.437, 3019.947, 3003.755, 3047.482 | 3062.542, 3056.665, 3046.396, 3066.240, 3050.078 | 0 / 10 | FAIL, exit 1 |

Unset/accepted medians: old 3048.995 / 3051.175 ms; HEAD 3009.437 / 3056.665 ms. First-party transfer: old 301293 B in each run; HEAD 302490 B in each run. Both summary checks fail only LCP; one old accepted run has TBT 238.957 ms, but the unchanged median TBT assertion passes. These are first-party-only, Pixel-blocked merge measurements, not a measurement of real Pixel cost.

Evidence under `tmp/landing-v2/chunk7/`: `rounde-{old,head}-{build,perf}.log` and `.exit`, `rounde-ab-summary.json`; archived raw reports copied to `rounde-old-evidence/2026-10-18T04-08-52.307Z-merge-3b937791/`. HEAD raw reports: `tmp/landing-performance/2026-10-18T04-13-53.965Z-merge-3418d1e6/`. The old source came from `git archive 49a143ab`, with a directory junction to clone dependencies. Next automatically selected the outer clone as its workspace root; there was no config override. Archive location can affect generated module names, so this is a same-machine/harness comparison, not an assertion of CI byte identity.

### Kept step 2a and assertion ledger

- `components/landing/DeferredMotion.tsx`: restore scroll-triggered dynamic import, including the already-scrolled/pre-hydration path. The SSR poster, fallback, geometry and outer node remain mounted outside the lazy boundary. Module failure leaves the still intact. No visible tags.
- `components/landing/HeroMotion.tsx`: playback portals into persistent media/control slots. The media slot follows the fallback permanently, so a late image error cannot insert fallback above the playing video. Round C's updater bailout, visit/replay refs, synchronous gesture retry, readiness helper, media policy, decoder-progress watchdog and hidden-tab handling are retained. Poster-error handling now belongs to the eagerly mounted shell.
- `tests/landing/hero-motion-runtime.test.ts`: adapt only the shell-ref input and video-ref index to the new component boundary. All prior bailout/observer/pause assertions remain unchanged.
- `tests/e2e/landing/iphone-subdex.spec.ts`: add a real script-response assertion that playback code is absent before scroll and arrives after scroll; assert the same shell and image nodes survive, and late fallback precedes video. It failed on unchanged HEAD at the eager-script assertion (`rounde-lazy-red.log`, exit 1). No existing assertion or skip was weakened or removed.
- No edits to readiness/media-policy helpers, lighthouserc, perf harness, budgets, throttling, 2.5 s gate, root/ops code, assets or visible copy. The stale `M` entries on layout/package are byte-identical to HEAD, verified directly.

The first full-suite preparation was interrupted before browser execution to add the permanent overlay slot after reviewing late-error stacking. Its log is preserved as `rounde-e2e-interrupted-fixture.log`; it is not a test pass. The idle `npx eslint` launcher was interrupted; direct installed-binary ESLint is the recorded check. Final verification and candidate measurements follow below.

### Bisect table and final candidate measurement

| Step | Change | Fast / slow | Disposition |
|---|---|---|---|
| 2a | Scroll-triggered lazy HeroMotion, persistent SSR poster shell | 0 / 10 | Kept UNCOMMITTED for CC's CI judgment under step 3; not an LCP fix |
| 2b | Revert poster-subtree behavior | Not run | Step 3 says do nothing else when old baseline is also 0/10 |
| 2c | Readiness/media-policy changes | Not run | Same stop condition; helpers unchanged |
| 2d | Other hero/page/root changes | Not run | Same stop condition; no scope expansion |

| Candidate | Unset LCP ms (all five) | Accepted LCP ms (all five) | Gate |
|---|---|---|---|
| Final step 2a | 3080.168, 3042.791, 3062.511, 3083.910, 3029.899 | 3019.674, 3052.536, 3057.610, 3107.214, 3051.018 | FAIL, exit 1; 0/10 fast |

Unset/accepted medians are 3062.511 / 3052.536 ms: neither passes. First-party transfer is 301461 B every run, 1029 B less than unchanged HEAD. Only LCP fails the summaries and LHCI assertions; the 2500 ms all-ten target is **not met**. The separate playback chunk is `10t-chbk52prb.js`, 4587 B raw (`rounde-chunks.json`), and the new browser assertion passed in Chromium, WebKit and iPhone WebKit: it is absent before scroll, loaded afterward, and preserves the poster node. There is no claim that smaller eager JavaScript restores fast mode locally or that CI will pass.

Raw final evidence: `tmp/landing-performance/2026-10-18T04-46-00.438Z-merge-0cae3af8/` (all ten LHRs and assertions). Log/exit: `tmp/landing-v2/chunk7/rounde-lazy-perf.{log,exit}`. `rounde-ab-summary.json` includes all three matrices at full precision.

### Final verification

All final commands ran sequentially, one heavy job at a time. Logs below are in `tmp/landing-v2/chunk7/`.

- `npm.cmd test -- tests/landing --maxWorkers=2`: PASS, 50 files / 373 tests, exit 0 (`rounde-unit.log`).
- `node node_modules/typescript/bin/tsc --noEmit`: PASS, exit 0 (`rounde-tsc.log`).
- `npm.cmd run assets:check`: PASS, 45 assets, exit 0 (`rounde-assets.log`); no asset changes.
- `node node_modules/eslint/bin/eslint.js components/landing/DeferredMotion.tsx components/landing/HeroMotion.tsx tests/landing/hero-motion-runtime.test.ts tests/e2e/landing/iphone-subdex.spec.ts`: PASS, no findings, exit 0 (`rounde-eslint-direct.log`).
- `npm.cmd run build`: PASS, exit 0 (`rounde-lazy-build.log`); no product edits afterward.
- `LANDING_E2E_USE_BUILD=1 npm.cmd run test:e2e -- --workers=2 --reporter=list,json`: PASS, **474 passed / 13 existing skips / 0 failed / 0 flaky**, exit 0, 17.4 minutes (`rounde-e2e.log`, `rounde-e2e-report.json`). Chromium native decoder checks passed; Windows WebKit codec skips remain skips, and this is not physical iOS verification.
- `npm.cmd run perf:ci` with the explicit environment above: FAIL, exit 1, all ten values reported. No budget, assertion or measurement-method edits.
- `git diff --check`: PASS. Direct HEAD-byte comparison confirms layout/package stale status entries contain no changes. Existing RESULT content is preserved, with Round E appended.

### Junction and server cleanup proof

The archived source and both new E2E fixture directories used directory junctions to the clone's `node_modules`. Each junction was removed FIRST with `cmd.exe /c rmdir <exact-scratch-path>\node_modules`, with **no `/s`**, then checked absent while `node_modules/next/package.json` in the clone was checked present. Paths: `tmp/rounde-49a143ab`, `tmp/landing-nearby-1792297394072` (interrupted preparation), and `tmp/landing-nearby-1792297705531` (completed suite). Proof: `rounde-old-cleanup.txt`, `rounde-fixture-cleanup.txt`, `rounde-cleanup.json`.

Recursive deletion of the detached archived scratch directory was rejected by automatic command policy, including a separate PowerShell cleanup attempt; the tool returned only “blocked by policy”, without a more specific reason. No approval escalation or alternate deletion mechanism was used. The detached scratch directories remain under `tmp/`, with **all three new junctions absent**; they are not shipped changes. This is the remaining cleanup limitation.

Final TCP probes: ports **44170–44175 all closed**; harness PID file absent; clone dependencies present. No harness servers remain. All requested source/test/doc changes are **UNCOMMITTED** on `feat/landing-v2`, HEAD `16950ac4`, worktree `C:/Users/conta/co-ops-landing`. No push, merge, deployment or production access. Open outcome: local fast mode unresolved; CC must judge the retained step-2a candidate in CI and review it before any commit.

## Round F - applied performance methodology, Aggie P3s, and CI timeout (base 88ab4379)

**Implementation is uncommitted; the performance gate remains RED on TBT.** All four applied LCP medians pass 2.5 s. Applied TBT medians are 246.617 / 232.920 ms in matrix 1 and 266.944 / 263.054 ms in matrix 2 (unset / accepted), above the unchanged 200 ms limit. No threshold was relaxed or moved to warning in the applied collection. This is an escalation to CC with measured evidence, not a claim that the TBT budget is meaningless or permission to recalibrate it. Further performance/budget decisions stop at this handoff.

### Methodology and before/after contract

Juan approved 2026-10-18. CC's recommendation replaces Lantern as the blocking measurement because Round D/E traced framework-chunk dependency bimodality despite observed LCP around 150 ms. CI fast-run shares supplied in the dispatch were 7/10 at 49a143ab, 4/10 at 610ca9bb, and 2/5 at 88ab4379; run 39098500802 hit the old 25-minute timeout during performance collection. The historical evidence above remains intact.

Before (`lighthouserc.cjs`):
```js
throttlingMethod: 'simulate'
throttling: {rttMs:150, throughputKbps:1600, cpuSlowdownMultiplier:4}
'largest-contentful-paint': ['error', {maxNumericValue:2499.999, aggregationMethod:'median'}]
```
After, the blocking collection:
```js
throttlingMethod: 'devtools'
throttling: {
  rttMs:150, throughputKbps:1600,
  requestLatencyMs:562.5, downloadThroughputKbps:1474.56,
  uploadThroughputKbps:675, cpuSlowdownMultiplier:4
}
'largest-contentful-paint': ['error', {maxNumericValue:2499.999, aggregationMethod:'median'}]
```
The separate `LANDING_PERF_COLLECTION=simulated-report-only` collection selects `simulate` and sets **every LHCI assertion to `warn`**. `collectionBlocks` excludes its CLI exits and custom budget/consent failures from the job exit; errors remain recorded in its evidence. An applied failure cannot be cleared by a later simulated pass. Raw reports and summaries are separated under `applied-blocking/` and `simulated-report-only/`, including native assertion results and collection durations. The shared config/runner also uses these two collections for the existing accepted-only real-Pixel launch mode; that HTTPS release measurement was not run here.

Unchanged blocking contracts: five cold samples per consent state, median aggregation, LCP <2500 ms, TBT <=200 ms, CLS <=0.1, performance >=0.85, accessibility >=0.95, first-party transfer <=500,000 B **each run**, and the existing consent/Pixel-blocking verification. Full-scroll/JS/critical-byte browser budgets remain unchanged and passed. Each local `perf:ci` now collects **10 blocking + 10 report-only samples**; both complete matrices below retain all 40 samples.

`.github/workflows/landing-checks.yml`: timeout **25 -> 35 minutes**. The perf step sets `LANDING_E2E_USE_BUILD=1` to reuse the revision already built by e2e, avoiding four redundant Next builds while retaining both collections. No coverage was removed.

### Every LCP sample and collection duration

Milliseconds, rounded to 0.001 below; full-precision values remain in raw LHRs and `tmp/roundf-perf-summary.json`. Samples retain collection order; none were discarded.

| Matrix | Collection | Consent | LCP samples 1-5 (ms) | Median (ms) | Collection seconds | CLI exit |
|---|---|---|---|---:|---:|---:|
| 1 | applied-blocking | unset | 2165.27, 2205.413, 2230.067, 2201.958, 2271.723 | 2205.413 | 206.075 | 1 |
| 1 | applied-blocking | accepted | 2022.944, 2274.929, 2523.747, 2131.115, 2292.127 | 2274.929 | 140.422 | 1 |
| 1 | simulated-report-only | unset | 3098.188, 3049.738, 3069.317, 3041.89, 3004.804 | 3049.738 | 76.485 | 0 |
| 1 | simulated-report-only | accepted | 3086.708, 3056.711, 3049.159, 3034.399, 3047.54 | 3049.159 | 75.641 | 0 |
| 2 | applied-blocking | unset | 2026.407, 2166.746, 2179.194, 2086.401, 2288.429 | 2166.746 | 143.206 | 1 |
| 2 | applied-blocking | accepted | 2013.333, 2300.813, 2182.813, 2178.037, 2245.959 | 2182.813 | 141.405 | 1 |
| 2 | simulated-report-only | unset | 3019.942, 3017.137, 2317.047, 3018.126, 3111.598 | 3018.126 | 76.419 | 0 |
| 2 | simulated-report-only | accepted | 3053.504, 3020.001, 3048.393, 3000.563, 3133.441 | 3048.393 | 75.791 | 0 |

Every native applied assertion result contains **only `total-blocking-time` at `error`**; every simulated assertion result contains **only `largest-contentful-paint` at `warn`**. Applied raw settings all confirm `devtools` and the exact throttling values above. Simulated settings confirm `simulate`.

| Matrix | Collection / consent | TBT samples (ms) | TBT median | Performance median | Accessibility minimum | CLS maximum |
|---|---|---|---:|---:|---:|---:|
| 1 | applied-blocking / unset | 338.562, 215.591, 268.946, 246.617, 233.803 | 246.617 | 0.92 | 1 | 0.002749892 |
| 1 | applied-blocking / accepted | 117.968, 232.92, 238.575, 205.348, 318.427 | 232.92 | 0.91 | 1 | 0.052699397 |
| 1 | simulated-report-only / unset | 28.5, 45, 51.561, 44.5, 54.5 | 45 | 0.94 | 1 | 0.002749892 |
| 1 | simulated-report-only / accepted | 33.5, 48, 44, 36.5, 46 | 44 | 0.94 | 1 | 0.052699397 |
| 2 | applied-blocking / unset | 121.015, 289.386, 266.944, 230.398, 306.901 | 266.944 | 0.91 | 1 | 0.002749892 |
| 2 | applied-blocking / accepted | 110.48, 272.975, 351.66, 258.991, 263.054 | 263.054 | 0.9 | 1 | 0.052699397 |
| 2 | simulated-report-only / unset | 29, 30, 53.5, 30.5, 63.634 | 30.5 | 0.94 | 1 | 0.002749892 |
| 2 | simulated-report-only / accepted | 18, 28.5, 54.536, 19.5, 61.5 | 28.5 | 0.94 | 1 | 0.052699397 |

First-party transfer is **301,620 B in every one of the 40 samples**, third-party transfer 0 B. This is Pixel-blocked evidence, not a real-Pixel cost measurement. The applied-versus-simulated TBT delta is material: applied medians 232.920-266.944 ms versus simulated 28.5-45 ms. It is reported to CC without changing the existing budget or silently declaring the methods interchangeable.

Evidence roots:

- Matrix 1: `tmp/landing-performance/2026-10-18T14-37-50.300Z-merge-3c493e58/` (all 20 raw LHRs, HTML reports, assertion results and four summaries).
- Matrix 2: `tmp/landing-performance/2026-10-18T14-46-17.624Z-merge-e3089ab0/` (all 20 raw LHRs, HTML reports, assertion results and four summaries).

Environment for both matrices: `CHROME_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe`, `LANDING_PERF_NO_SANDBOX=1`, `LANDING_E2E_USE_BUILD=1`, `LHCI_CLI_PATH=C:/Users/conta/AppData/Local/npm-cache/_npx/7c4c7312e9ccc7bf/node_modules/@lhci/cli/src/cli.js` (cached pinned LHCI 0.15.1). Same production build and unchanged application/config between matrices; one heavy job at a time. No server was listening on 44170-44175 between e2e and perf, or between the two matrices.

### Durations and verification

- `node node_modules/vitest/vitest.mjs run tests/landing tests/security-headers.test.ts --pool=threads --maxWorkers=3`: **PASS**, 52 files / 399 tests, exit 0; 7.880 s wall time (`tmp/roundf-vitest.log`). Includes the config/severity test and the bounded import-retry unit test.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: **PASS**, exit 0, 47.067 s (`tmp/roundf-tsc.log`).
- `npm.cmd run assets:check`: **PASS**, 45 assets, exit 0, 0.370 s (`tmp/roundf-assets.log`). No asset edits.
- `npm.cmd run build`: **PASS**, exit 0, 146.474 s (`tmp/roundf-build.log`, `tmp/roundf-build-result.json`). No application edits after this build.
- Changed-file ESLint: changed TS/TSX files **PASS**, exit 0 (`tmp/roundf-eslint-ts.log`); changed `.mjs`/`.cjs` files **PASS**, exit 0 with `--config tmp/roundf-eslint.config.mjs` (`tmp/roundf-eslint-js.log`). The initial combined command exited **2** because the existing repo config applies JSX-a11y rules to CJS without registering that plugin. The temporary wrapper imports the existing config and registers its exact existing `jsx-a11y` plugin globally; it disables no rules. `eslint.config.mjs` is unchanged. Initial failure remains in `tmp/roundf-eslint.log` and `tmp/roundf-checks.json`.
- `LANDING_E2E_USE_BUILD=1 node node_modules/@playwright/test/cli.js test --workers=2`: **PASS**, **486 passed / 13 existing skips / 0 failures**, exit 0, **1016.525 s = 16m 56.525s** (`tmp/roundf-full-e2e.log`, `tmp/roundf-full-e2e-result.json`, Playwright report). All new cases pass in Chromium, WebKit and scoped iPhone WebKit. Existing Windows WebKit decoder / Chromium-only skips remain skips; no physical iPhone claim.
- `npm.cmd run perf:ci`, matrix 1: **FAIL**, exit 1, **498.949 s = 8m 18.949s** (`tmp/roundf-perf1.log`, `tmp/roundf-perf1-result.json`). Applied TBT is the only blocking failure in each state; both simulated collections exit 0 with LCP warnings.
- Same command, matrix 2: **FAIL**, exit 1, **437.161 s = 7m 17.161s** (`tmp/roundf-perf2.log`, `tmp/roundf-perf2-result.json`); same blocking failure and report-only behavior.

Local full e2e + one complete perf matrix totals **25m 15.474s** for matrix 1, or **24m 13.686s** for matrix 2. Against 35 minutes this leaves roughly 9m45s-10m46s for CI's install, main build (local e2e reused it), type/unit checks, repeated lineup/tracking suite and artifact steps. This is a timing sanity check, **not** proof of CI duration. Both collections are retained; no trade-off was silently made. Exact-revision CI remains CC's follow-up because no push is authorized.

### Aggie P3 ledger

| Finding | Change | Verification / limit |
|---|---|---|
| P3-1 | DeferredMotion catches import failure, exposes `failed`, and re-arms scroll once (two attempts maximum); disposal prevents late updates. | New runtime unit test proves loading/failed twice and no third attempt. Browser failure preserves the poster and reload recovers. **Turbopack caches rejected chunk promises**, so the second import can still fail without a new network request; no forced recovery is claimed. |
| P3-2 | Nonvisual `data-motion-state="idle\|loading\|ready\|failed"`; shell owns import lifecycle and child reports bounded readiness. | Browser checks idle/failed/ready; unit checks loading/failed transitions. `data-media-ready` remains the child paint/readiness gate, not decoded progress; `data-media-failed` remains playback failure, not poster/import failure. Documented in source and BUILD. |
| P3-3 | Check Reduce Motion and Save-Data before import. Keep scroll activation armed and listen for preference changes after a scroll. | Both preferences produce zero playback-chunk requests; clearing either activates the same shell and playback in all three projects. Chunk paths are discovered from the built child-only marker. |
| P3-4 | Replay re-arms only on a physical section exit `bottom < -8 \|\| top > innerHeight + 8`; hidden-tab notifications do not re-arm it. | Fractional DPR 1.25 test proves a 1.6px outside sliver does not replay, then a continued exit beyond the margin does. Offscreen observer notifications are required to detect that continued exit; the existing state bailout test still passes. |
| P3-5 | Replace generic `requestVideoFrameCallback` chunk identification with unique `data-hero-motion-playback`. | Lazy-fetch/poster-identity test and built-chunk preference tests pass; no fixed chunk hash/name. |
| P3-6 | Replace positional ref/effect assertions in `hero-motion-runtime.test.ts` with tagged video lookup and named `observeMotion` / `syncPlayback` effects. | Runtime bailout, offscreen, pause and observer assertions pass. |

The initial focused Chromium run was **20 passed / 1 failed**, 181.678 s (`tmp/roundf-focused-e2e.log`). Its failed assertion expected an aborted chunk to recover from a repeated import. That expectation was disproved by Turbopack's cached rejection; the final test explicitly covers failed state, poster retention and reload recovery, while the unit test independently proves the requested bounded retry. The complete final browser suite passes. This limitation is also documented in BUILD.

Changed files: `.github/workflows/landing-checks.yml`; `lighthouserc.cjs`; `scripts/landing/{perf-ci,performance-report}.mjs`; `components/landing/{DeferredMotion,HeroMotion}.tsx`; `tests/landing/{performance-budget,hero-motion-runtime,deferred-motion-runtime}.test.ts`; `tests/e2e/landing/{iphone-subdex.spec,playback-chunk}.ts`; `docs/landing-v2-{BUILD,roundf-PLAN,chunk7-RESULT}.md`.

All changes remain **UNCOMMITTED** on `feat/landing-v2`, HEAD `88ab4379`, worktree `C:/Users/conta/co-ops-landing`. No push, merge, deployment or production access. No visible tags. Open items: applied TBT qualification / CC's judgment on the measurement delta, exact-revision CI timing and cross-family review, the cached-import limitation, and the existing native-device release checks.

Final cleanup/checks: ports **44170-44175 closed**, harness PID file absent; `git diff --check` passes. `app/eat/layout.tsx` and `package.json` retain their pre-existing stale status entries with no content diff. Scratch fixture directories remain under ignored `tmp/`; no recursive deletion was attempted.

## Round G � Aggie round F P3 closure

Scope: five bounded P3 findings only, based on `e51fc32f` on `feat/landing-v2`. No performance optimization, visible tags, budget/threshold/throttling changes, push, merge or commit.

| Finding | Change | Verification |
|---|---|---|
| P3-1 | `perf-housekeeping.mjs` guards PID parsing/removal, individual kills and error-evidence writes with log-and-continue behavior. `e2e-server.mjs` publishes PID JSON by sibling temp-file rename. | Four regression tests cover malformed JSON plus failed unlink, continuing after a kill failure, failed error evidence, and write-before-rename publication. |
| P3-2 | `lighthouserc.cjs` uses separate consent/collection output directories. `perf-ci.mjs` runs simulated first, applied last so root assertions describe the blocking lane; per-collection raw assertions remain preserved. | Config test pins output naming; the complete perf matrix checks artifacts. |
| P3-3 | `DeferredMotion.tsx` exposes nonvisual `suppressed` when Reduce Motion/Save-Data refuses activation. Updated `iphone-subdex.spec.ts` and BUILD. | Both preference cases still require zero chunk requests and later `ready` after clearing the preference. |
| P3-4 | `performance-budget.test.ts` pins the complete `[level, params]` tuples for all five assertions in both lanes. | Performance, accessibility, LCP, CLS and TBT values and median aggregation remain unchanged. |
| P3-5 | Retained workflow perf-step `LANDING_E2E_USE_BUILD: "1"` and explicitly documented build reuse as a separate Round F change alongside the timeout. | `.github/workflows/landing-checks.yml` already has it at this HEAD; no additional workflow diff in Round G. |

Validation results and all local perf samples follow after the running suites complete. Local perf is advisory; exact-revision CI remains CC's gate. The user reports CI run 39138254523 green on base e51fc32f; that is not a CI result for this uncommitted diff.

### Verification

- `node node_modules/vitest/vitest.mjs run tests/landing tests/security-headers.test.ts --pool=threads --maxWorkers=3`: PASS, 53 files / 403 tests (7.43 s).
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: PASS, exit 0.
- `npm.cmd run assets:check`: PASS, 45 assets.
- `npm.cmd run build`: PASS, exit 0, 96.997 s.
- Changed-file ESLint (eight TS/TSX/MJS/CJS files): PASS, exit 0. Used existing `--config tmp/roundf-eslint.config.mjs` wrapper to register the existing jsx-a11y plugin globally; no rules disabled, repo lint config unchanged.
- `LANDING_E2E_USE_BUILD=1 node node_modules/@playwright/test/cli.js test --workers=2`: PASS, 486 passed / 13 existing skips / 0 failures, exit 0, 1035.586 s. Reduce Motion and Save-Data suppressed-to-ready checks pass in all three projects. No physical-device claim.
- `npm.cmd run perf:ci` exactly once: FAIL, exit 1, 437.029 s. Applied TBT alone fails in both states (medians 260.566 / 247.039 ms); simulated LCP warnings remain report-only, both simulated CLI exits 0. Applied LCP medians 2174.360 / 2428.795 ms pass; all CLS values pass. No gate waiver or TBT tuning.

Logs: `tmp/roundg-{vitest,tsc,assets,eslint,build,full-e2e,perf}.log`; timing/exit records: `tmp/roundg-{build,full-e2e,perf}-result.json`.

Perf environment: `CHROME_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe`, `LANDING_PERF_NO_SANDBOX=1`, `LANDING_E2E_USE_BUILD=1`, cached pinned LHCI 0.15.1 via `LHCI_CLI_PATH=C:/Users/conta/AppData/Local/npm-cache/_npx/7c4c7312e9ccc7bf/node_modules/@lhci/cli/src/cli.js`. One heavy job at a time. Evidence root: `
tmp/landing-performance/2026-10-18T15-50-06.490Z-merge-b63e5243
`.

### Every local perf sample

LCP/TBT in milliseconds, rounded to 0.001; CLS rounded to 9 decimals. All 20 samples retained, including the accepted applied outlier. Full precision remains in raw LHRs.

| Collection | Consent | Run | LCP | TBT | CLS |
|---|---|---:|---:|---:|---:|
| simulated-report-only | unset | 1 | 3030.720 | 23.000 | 0.002749892 |
| simulated-report-only | unset | 2 | 3122.767 | 54.500 | 0.002749892 |
| simulated-report-only | unset | 3 | 3048.704 | 45.500 | 0.002749892 |
| simulated-report-only | unset | 4 | 3064.721 | 110.426 | 0.002749892 |
| simulated-report-only | unset | 5 | 2999.439 | 44.000 | 0.002749892 |
| simulated-report-only | accepted | 1 | 3061.744 | 19.500 | 0.052699397 |
| simulated-report-only | accepted | 2 | 3016.421 | 33.360 | 0.052699397 |
| simulated-report-only | accepted | 3 | 3054.122 | 47.000 | 0.052699397 |
| simulated-report-only | accepted | 4 | 3059.655 | 47.500 | 0.052699397 |
| simulated-report-only | accepted | 5 | 3053.751 | 46.000 | 0.052699397 |
| applied-blocking | unset | 1 | 2015.589 | 114.207 | 0.002749892 |
| applied-blocking | unset | 2 | 2172.137 | 196.393 | 0.002749892 |
| applied-blocking | unset | 3 | 2174.360 | 260.566 | 0.002749892 |
| applied-blocking | unset | 4 | 2197.731 | 314.708 | 0.002749892 |
| applied-blocking | unset | 5 | 2175.917 | 268.536 | 0.002749892 |
| applied-blocking | accepted | 1 | 2082.890 | 146.846 | 0.052699397 |
| applied-blocking | accepted | 2 | 2428.795 | 223.152 | 0.052699397 |
| applied-blocking | accepted | 3 | 3062.116 | 496.746 | 0.052699397 |
| applied-blocking | accepted | 4 | 2229.019 | 247.039 | 0.052699397 |
| applied-blocking | accepted | 5 | 2484.767 | 256.374 | 0.052699397 |

Every sample transferred 301,635 first-party bytes and zero third-party bytes (Pixel blocked). This does not measure real Pixel cost.

Artifact verification: all four `reports-{unset|accepted}-{simulated|applied}` directories exist. Top-level `.lighthouseci/assertion-results.json` matches the final applied/accepted TBT error (200 ms expected, 247.039 ms actual); each timestamped raw directory retains its own assertions. Pre-existing unsuffixed local report directories are from earlier rounds, not outputs of Round G.

Changed files: `components/landing/DeferredMotion.tsx`; `scripts/landing/{perf-ci,e2e-server,perf-housekeeping}.mjs`; `lighthouserc.cjs`; `tests/landing/{performance-budget,perf-housekeeping}.test.ts`; `tests/e2e/landing/iphone-subdex.spec.ts`; `docs/landing-v2-{BUILD,chunk7-RESULT}.md`.

Handoff: UNCOMMITTED on `feat/landing-v2`, HEAD `e51fc32f`, worktree `C:/Users/conta/co-ops-landing`. No push, merge, deployment or production access. Ports 44170-44175 closed; PID file absent. The two initial stale status entries (`app/eat/layout.tsx`, `package.json`) still have no content diff.

Open risks: local applied TBT remains above budget; exact-revision CI and CC review are outstanding. Existing WebKit decoder skips, native-device release checks and cached-import retry limitation are unchanged. All five requested P3 implementation items are complete; CI remains the gate.
