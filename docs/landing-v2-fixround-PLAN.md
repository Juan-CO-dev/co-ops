# Landing v2 fix round

Branch: `feat/landing-v2`, baseline `3708d0f3`. Implementation follows the supplied CC/Aggie review and CC's explicit fix rulings; no commit, push, merge, deployment or production writes.

1. Reproduce the three CI assertions and add failing regression coverage for consent meaning/targets/toggle, light section links, eager wordmark, footer vendor restrictions and rounded mile plurals.
2. Restore en/es permission, conditional Meta sharing and purpose. Keep the dock compact with the privacy link as a centred 44px control alongside the actions. Preserve unknown consent independently from notice expansion.
3. Replace crave/lineup/Field Guide/SUBDEX button pairs with light native text-link pairs at the same tracking placements. Retain shop-card ordering and hero/sticky/catering controls; supply the requested final footer direct-order pair (absent at baseline).
4. Correct stale assertions: Uber Eats is at Dupont only; rejected SUBDEX playback must remove its own video/controls, while the separate manual illustrated spin remains available. Strengthen exact destination checks, built stylesheet isolation, consent/copy geometry and all-target accessibility coverage.
5. Make exporter verdict preservation portable without relaxing pinned source hashes; explicitly disposition legacy hero assets, cold-start readiness and prior accepted assertion changes.
6. Run landing unit tests, asset checks, TypeScript, build, full Chromium/WebKit landing e2e with the separately compiled fixture, and full Vitest suite with three workers. Save logs and screenshots under `tmp/landing-v2/fixround/` and document every changed assertion and remaining risk.

Contracts: consent remains opt-in; footer vendor events have no store; direct shop events retain stores and placement; assets retain source identity; no-JS links stay native. Risks: longer legal copy affects short-screen geometry; CSS changes must remain route-only; production-build readiness must exercise actual routes without masking navigation failures.
