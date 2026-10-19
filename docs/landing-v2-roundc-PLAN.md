# Fix round C implementation plan

Base: `feat/landing-v2`, `610ca9bb`, dedicated clone `C:/Users/conta/co-ops-landing`. Uncommitted handoff; no push or merge.

The dispatch contains CC's reviewed, bounded rulings for the media and assertion fixes. Read-back confirms the cited implementation except P3-4: `waitForMediaReadiness` already calls its clock-based `check()` on the second RAF. Test the timer-before-second-RAF ordering directly; do not claim a missing check was added.

1. P0 first: retain the unchanged `perf:ci` baseline, then capture the Lighthouse trace and Lantern graph. Distinguish observed paint from simulated paint. Select a product fix from evidence, preserving the image, layout, consent gates and performance thresholds. Record every before/after run. Files depend on the identified critical dependency, principally `Hero.tsx` and the landing client/layout path.
2. `HeroMotion.tsx`: remove offscreen subscription; preserve state identity on unchanged frames (including the attachment wrapper); add failing-first state/render regression coverage and retain viewport-exit pause. Re-arm completed playback only after a physical viewport exit, never document hide or a still-intersecting edge. Keep one attached video and direct gesture playback.
3. Tests: expand bilingual tag absence; retain simulated controls and add native Chromium controls; render a missing-footer fixture and test inert rail through scroll; exercise readiness timer/RAF ordering; replace completed-no-reentry behavior with once-per-arrival assertions; assert synchronous handler/play ordering.
4. `helpers/sticky.ts`: wait for hydration/fonts/layout; clear both hero and an in-flow consent notice and assert both policy conditions. No rail product-policy change.
5. Update BUILD and append RESULT with an assertion ledger and exact validation outcomes.

Validation: landing Vitest (`--maxWorkers=2`), TypeScript, assets check, production build, changed-file ESLint; full landing Playwright including iPhone (`LANDING_E2E_USE_BUILD=1 --workers=2`); unchanged `perf:ci` (`LANDING_PERF_NO_SANDBOX=1`, all ten runs <2500 ms target). One heavy job at a time. Repeat the rail matrix if rail-related changes warrant it under the dispatch. Close all owned servers.

Risks: simulated dependency timing versus observed painting; hidden-tab events mistaken for physical exit; async stale media attempts; layout settling in short desktop viewports; Windows WebKit is not native iPhone decoder evidence. Final independent code review remains CC's.

## P0 next experiment — awaiting CC's cross-family plan review

Proposed file: `next.config.ts`, add `experimental: { inlineCss: true }`. Installed documentation: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/inlineCss.md`. This removes the two stylesheet fetches and their render-blocking wait; the hypothesis is that hero presentation can then precede the React runtime's evaluation rather than race it. No successful measurement is claimed for this proposal.

Scope/risk: Next explicitly applies this option globally, not per route. Styles are duplicated into the RSC payload and cannot be cached independently on first loads. The operations app shares this build, so this goes beyond a landing-only markup hint and requires the charter's cross-family review before coding. Preserve the exact CSS, image candidates, all consent/media gates, and every performance assertion. If approved: rebuild; measure all ten cold runs with unchanged perf:ci; inspect trace ordering, transfer bytes, hero/consent geometry and a staff login render; rerun affected validation. Revert the experiment if it does not remove the slow band or introduces material regressions. Handoff stays uncommitted.
