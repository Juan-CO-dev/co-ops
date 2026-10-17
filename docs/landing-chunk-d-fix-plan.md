# Chunk-D fix round — CC rulings, 2026-10-16

Base: `feat/landing-p1` at `8720af81`. Execute CC's reviewed rulings; leave all changes uncommitted.

- `lib/landing/stores.ts`, `app/eat/page.tsx`: catch query results and thrown loader failures, emit one fixed PII-free class/message, omit shops and footer addresses while preserving the page.
- `app/not-found.tsx`, `proxy.ts`: use the approved wordmark, remove the redundant brand condition, pin short public caching for brand/robots/sitemap and no-store for landing APIs. Preserve staff routing.
- `lib/landing/nearby-shared.ts`, config and NearbyShop: one coordinate eligibility predicate. Real tenant coordinates remain null.
- `components/landing/Footer.tsx`: map delivery keys to tracked vendors at footer placement; retain native links and 44px targets.
- `lib/i18n/{en,es}.json`: N-shop fallback copy. Remove the tracked-image existence exemption. Verify log deletion, CI assets filter, placement coverage and keyboard scrolling already present in chunk E.
- Regression tests first: loader rejection and error result, render omission, cache/404 asset checks, footer dispatch, keyboard motion starting at zero. Production browser coverage includes unavailable DB and an isolated fixture build with coordinates to inspect merged response headers.
- Gates: landing unit tests; full Vitest suite with `--maxWorkers=3`; TypeScript; production build; Chromium + WebKit landing e2e.

Risks: logs must never include raw provider errors; fixture coordinates must never enter the deployable tenant config; proxy caching must not alter staff behavior. No migration, deployment, production-data or environment-file changes. 0273 remains file-only. CC/Aggie own external review.

Execution adjustment: simultaneous review used the same default browser ports. Add a test-only port-base setting and readiness from the child processes themselves, then rerun on 45170-45175. This changes browser infrastructure only, not production routing/configuration.
