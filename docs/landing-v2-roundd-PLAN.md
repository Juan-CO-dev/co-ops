# Round D — landing-only LCP experiments

Base: `9872e9b5`, branch `feat/landing-v2`. CC's supplied review authorizes this sequence; global inlineCss is rejected.

1. Capture unchanged perf:ci (ten runs), baseline landing geometry/CSS and login CSS. Identify root stylesheet dependencies.
2. Experiment 1a: process only `app/eat/landing-v2.css` into a committed minified artifact, read it server-side from the landing layout, and replace that route's CSS import with an inline style after root CSS. Add generator freshness and rendered HTML regression coverage, failing first. Preserve all font URLs and CSS ordering. Files: landing layout, landing CSS generator/artifact/reader, package scripts/dependency declaration, landing tests. No root CSS/layout, CSP or perf configuration changes.
3. Measure ten unchanged perf:ci runs. If insufficient, inspect traces and evaluate landing-only client scheduling/fetch priority; retain only a qualifying experiment. SSR hero movement alone cannot remove Next's root framework dependency.
4. Run ten diagnostic applied-throttling Lighthouse loads using scratch configuration; never substitute them for the simulated gate.
5. Run landing Vitest, security headers, typecheck, assets, build, changed-file ESLint, full built E2E with two workers; compare visuals, login CSS and traced server assets. Append experiments, every run, trace ordering and assertion ledger to RESULT.

Risks: inline stylesheet cascade/streaming order, generated artifact freshness and deployment tracing, increased landing HTML/RSC bytes, hydration/privacy timing, CLS. One heavy job at a time; stop servers after each measurement. Leave all round D work uncommitted for CC.
