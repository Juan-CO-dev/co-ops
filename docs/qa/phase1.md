# Landing Phase 1 release evidence — 2026-10-16

Latest verification: [Merge-gate round](../landing-merge-gate-result.md). The older evidence below is historical; the current report supersedes its test counts and performance status.

Custody (2026-10-16): branch `feat/landing-p1`, HEAD/base `21eeedde`, dedicated clone `C:/Users/conta/co-ops-landing`; clean before this round. Only this merge-gate/P3 round is UNCOMMITTED. Earlier rounds are committed. No push, merge, deploy, environment change or production write; 0273 remains file-only. Current evidence: [merge-gate result](../landing-merge-gate-result.md).

## Source identities and derivation

Every real-photo entry and every raster under `/media/` requires `crop-resize-only`, encoder parameters and an approved source ID. The twenty real-photo derivatives resolve only to the ten approved product originals. The existing DRAWN SUBDEX poster resolves to a separately pinned DRAWN source frame, extracted from the already supplied video at the Chunk D timecode/crop. Its source record pins the video hash, frame hash and extraction recipe; local release checking reproduces that extraction AND the Sharp rotate/resize/WebP bytes. CI checks the identity/recipe/manifest/output hashes without external masters. DRAWN source IDs are rejected for real-photo/real-edited classifications. This satisfies the same raster rule without a classification exception or relabeling.

## Ordered change sets

1. **CC's chunk-C rulings:** lineup in client/server placement allowlists and typed OrderLink; CTA discovery regression includes all current sections and verifies reserved footer placement; lineup click browser proof with test flags enabled, both POST requests and queued Pixel ID; geometric no-JS/JS reachability; crop/resize/source/sidecar gates and forged A/B refusals; duplicate-byte check and hero/lineup reuse of one 014 output; narrower WebKit skip with hero and SUBDEX control-policy adapters; Field Guide scaffold/no-photo test; remove debug.log, ignore logs, exclude tmp/. Existing Chunk D had already corrected the historical chunk-C handoff wording.
2. **Chunk E:** measured transfer-budget harness and stricter LHCI configuration/consent scenarios; 200% English/Spanish reflow fix; native lazy lineup images and smaller 480px exports (quality capped at 78, all sources/derivations reverified); brand-only OG card with existing wordmark and scoped theme metadata; E5 probe/workflow/failure fixtures; activation runbook, release checklist and one README PREVIEW section.

Historical local-only binary patches were prepared in `tmp/landing-release-packet/01-chunk-c-rulings.patch` and `02-chunk-e.patch`. They are gitignored artifacts from the earlier 814e3a30 review, unavailable in a checkout and superseded by the committed rounds through 21eeedde. Do not apply them to the current worktree. These are not approval claims.

## Test-first evidence and findings

- `tmp-landing-e-red.log`: lineup dispatched zero tracking calls before the allowlist fix.
- `tmp-landing-e-assets-red.log`: forged drawn-media entry and hash-consistent/non-derived bytes were admitted before enforcement.
- `tmp-landing-e-metadata-red.log`: OG card missing before implementation.
- `tmp-landing-e-monitor-red.log`: immediate retry hid first landing 503; final monitor tests preserve it and initiate incident checks.
- Initial browser pass exposed real Spanish text overflow and initial Chromium transfer 517,902 bytes (accepted). The critical-byte harness initially overcounted asynchronous JS as blocking. It now counts HTML/CSS/fonts/poster and only synchronous non-module scripts; all initial JS remains separately capped at 200KB.
- A follow-up pinpointed the remaining Spanish overflow in the long SUBDEX heading; scoped word wrapping fixes text without clipping or hiding it. The enabled-counter fixture now returns a realistic JSON rejection for unsupported writes; its previous empty 404 was interpreted as success by the client.

## Verification commands and results

Logs are local ignored files; no production credentials or customer data are included. Full-suite git-ignore permission warnings were non-fatal (exit 0).

- `node scripts/assets/inventory.mjs --sources`: PASS, **26 assets**, including **20 real-photo derivatives** and the pinned DRAWN source-frame/poster chain; `tmp-landing-e-assets-sources-final.log`. The initial strict gate rejected the old unregistered SUBDEX poster; the explicit DRAWN source identity resolved that failure without weakening the rule.
- `node node_modules/next/dist/bin/next build`: PASS (Turbopack); `tmp-landing-e-build-release.log`.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: PASS, no diagnostics, exit 0; `tmp-landing-e-tsc-verified.log`. Earlier test-helper type errors were fixed.
- Targeted reflow + host-isolation: **34 passed** Chromium/WebKit, `tmp-landing-e-reflow-fixed.log`.
- Monitor: **13 passed**, `tmp-landing-e-monitor-green.log`.
- `node node_modules/vitest/vitest.mjs run tests/landing --maxWorkers=3`: **29 files / 232 tests passed**, zero failures; `tmp-landing-e-unit-verified.log`.
- `node node_modules/vitest/vitest.mjs run --pool=threads --no-cache --maxWorkers=3`: **647 files passed / 1 skipped; 9,873 tests passed / 3 skipped; zero failures**, exit 0; `tmp-landing-e-full-final.log`.
- Final complete browser pass: **139 passed / 5 skipped / zero failures**, Chromium + WebKit; `tmp-landing-e-e2e-release.log`. Skips are only invalid-H264 decode and four decoder proof cases on non-Darwin WebKit. Hero and SUBDEX keyboard/offscreen policy run in WebKit through the explicit media adapter; hero visibilitychange and geometry also run. Real decoder/device proof remains a separate gate.
- `playwright test lineup.spec.ts tracking.spec.ts --repeat-each=2`: **28 passed** against the final build, including enabled client flags and both POST calls; `tmp-landing-e-repeat2-release.log`. The earlier expanded repeat also ran SUBDEX controls twice in both engines: 48 passed.
- `playwright test lineup.spec.ts --repeat-each=3`: **12 passed**, both engines, JS on/off; `tmp-landing-e-repeat3-release.log` (final build).

## Measured local transfer (bytes)

All four measurements passed the 250KB critical / 200KB initial JS / 500KB initial / 5MB full-scroll gates. Hero response is 45,341 bytes including headers. These figures include the explicit offline Meta fixture, not real provider cost.

| Engine | Consent | Initial | Initial JS | Critical | Full scroll |
| --- | --- | ---: | ---: | ---: | ---: |
| Chromium | accepted | 466167 | 168095 | 112687 | 1193200 |
| Chromium | unset | 466027 | 167955 | 112687 | 1193060 |
| WebKit | accepted | 468164 | 167835 | 112563 | 934251 |
| WebKit | unset | 468018 | 167689 | 112563 | 934105 |

Measured against the final build including the equivalent SUBDEX raster export (16,874 bytes). Raw captured attachments: `tmp/landing-release-packet/transfer-attachments.json`.

## Lighthouse and performance limits

`npm.cmd view @lhci/cli@0.15.1 version --fetch-retries=0 --fetch-timeout=15000` exited 1 with `EACCES` fetching `https://registry.npmjs.org/@lhci%2fcli` (`tmp-landing-e-lhci-registry.log`). **No Lighthouse score was measured.** The exact runnable commands are in docs/deploy.md. Following CC's 2026-10-16 sampling review, all six LHCI gates use medians of five cold mobile runs at 375px, simulated 1.6Mbps/150ms RTT/4x CPU. Accepted consent is seeded before navigation; unset consent is also reported. Cookie handling follows the [official LHCI configuration](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md#puppeteerscript).

Browser transfer measurements use production Next, cold contexts, both engines and consent states, with an explicitly NON-representative offline Meta stub. They prove local payload budgets, not real Meta cost or Lighthouse timings. Mandatory activation repeat uses the actual Pixel/public HTTPS; missing live Pixel evidence blocks spend. Missing CAPI alone does not block a verified PIXEL-ONLY release.

## Open external evidence

Exact Vercel branch-preview hostname/phone URL, actual ingress host/header/cache isolation, live merchant endpoint/schema and both serving-option flows, Juan content/device approvals, real iPhone H264/VoiceOver and Android/4G, actual Lighthouse and live Meta performance, Pete's Pixel Test Events/AEM/conversion setup, optional CAPI/WAF/dedup/match quality, separately authorized counter migration, US monitoring runner/baseline, successful external run, received intentional alert and independent stale-heartbeat proof remain open. Production indexing remains intentionally held (metadata noindex, proxy robots disallow, empty sitemap); SITE_ORIGIN alone cannot enable it.

CC must perform cross-family review and independent verification before acceptance; parallel Aggie chunk-D feedback was not supplied in this turn. See docs/release-checklist.md for owners/gates. No launch approval or completed deployment is implied.
