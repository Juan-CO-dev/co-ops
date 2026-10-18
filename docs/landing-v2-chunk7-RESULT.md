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
