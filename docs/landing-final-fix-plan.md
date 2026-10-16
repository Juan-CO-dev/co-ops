# Final landing fix round

Custody: `feat/landing-p1` at `9aeb73a1`, dedicated clone `C:/Users/conta/co-ops-landing`. This round remains uncommitted. CC's supplied final rulings and Aggie's cross-family findings are the reviewed implementation contract.

1. Measure the unchanged production build with LHCI in both consent states (three cold runs). Inspect resource and chunk composition. Reduce unnecessary landing client code, defer offscreen images, defer the consented Pixel until idle after load, and derive a small square brand icon. Preserve real food assets and bilingual native interactions.
2. Test monitor hard-failure pauses versus review alerts; add a two-hour heartbeat checker and reviewed-baseline instructions, leaving activation off.
3. Test the actual not-found asset policy, a successful local counter RPC and a dead-provider production response. Correct custody/local-only evidence references; scan then untrack refund logs. Remove unused performance gate logic or integrate the real reporting path.
4. Run landing tests, full Vitest with three workers, TypeScript, production build, Chromium/WebKit e2e, and LHCI. Report each cold run and median, first/third-party bytes, failures and external activation gaps.

Risks: browser lazy heuristics can fetch below-fold media early; consent withdrawal must cancel pending SDK insertion; local CPU throttling may leave performance goals red. No production data, deploy configuration, migration application, push or merge is authorized.

Confirmed differences from the review: fix-D already uses the allowed SVG wordmark on the 404 page; the provider loader is already fail-soft. Retain those fixes and prove them rather than reimplementing them.
