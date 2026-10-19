# Round F plan — base 88ab4379

CC's Juan-approved Round F brief supplies the methodology and bounded P3 fixes.

- `lighthouserc.cjs`, `scripts/landing/perf-ci.mjs`, performance config tests: collect five cold runs per consent state with applied mobile DevTools throttling as the blocking gate, and preserve simulated Lantern as labelled report-only evidence. Preserve all numerical budgets, consent checks and Pixel blocking. Report collection errors without letting the simulated lane affect exit status.
- `.github/workflows/landing-checks.yml`: raise landing timeout from 25 to 35 minutes.
- `DeferredMotion.tsx`, `HeroMotion.tsx` and motion unit/browser tests: expose idle/loading/ready/failed lifecycle; retry import once after another scroll; avoid importing under Reduce Motion/Save-Data; re-arm replay only beyond an eight-pixel physical exit. Identify playback via a unique child marker and replace positional hook assertions with tagged lookups.
- `docs/landing-v2-BUILD.md`, append-only chunk 7 RESULT: document approval, methodology, every measurement, durations and P3 outcomes.

Validation: landing Vitest and security headers, TypeScript, asset inventory, build, changed-file ESLint, full landing Playwright with existing build and two workers, then perf:ci twice. One heavy job at a time, explicit Chrome path and no-sandbox opt-in; close harness servers. Keep changes uncommitted on feat/landing-v2 for CC's cross-family review.

Risks: applied throttling may reveal genuine budget failures; do not adjust thresholds. Both collections double Lighthouse sampling time. Import retries are bounded and preserve the poster; preference changes must leave activation available. Existing stale status entries for layout/package have no content diff.
