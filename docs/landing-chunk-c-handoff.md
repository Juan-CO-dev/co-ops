# Landing Chunk C handoff

Branch `feat/landing-p1`, base `de31dae4392640ffdbd09be7cca9f37fecff2c4b`.
Workspace `C:/Users/conta/co-ops-landing`. Historical Chunk C delivery committed by CC as `51829f5e`; the outcomes below describe that delivery before commitment. Subsequent review fixes and Chunk D are tracked separately. No push, merge, deployment, production data access, or migration application. 0273 unchanged and file-only.

## Delivered

- CC rulings: repeated-slash e2e permits at most two same-host 308 hops without loops; single trailing slashes require one. Six H.264 decode/playback checks skip only on non-Darwin WebKit, with explicit reasons. All poster/no-JS/reduced-motion/autoplay/stalled fallback tests remain active. Real-iPhone Safari preview check added to deploy.md.
- `scripts/assets/export.mjs`: ten direct original-photo exports, full-frame uniform resize and WebP encoding only, each under 100 KB. Per-photo `crop-resize-only` mode, hashes, dimensions, encoder/command evidence and sidecars. V4 remains deferred separately. `docs/assets.md` records sharpness rankings and original edge crops; no representative substitutions.
- `config/tenant/landing-products.json`, `lib/landing/products.ts`, `components/landing/Lineup.tsx`, page and bilingual dictionary wiring: ten unique name-only cards, native horizontal scroll snap, keyboard focus, lazy dimensioned responsive images, two store ordering anchors. Exact roster paths added to the host/optimizer allowlist; no wildcard media permission.
- Tests cover source/identity uniqueness and held/mismatched refusal, provenance mode/budgets, asset routing, real browser image decoding, keyboard/no-JS navigation and page overflow.
- Verification integration: the older co-scenes public-photo guard now permits only manifest-listed landing derivatives (private training-photo restrictions retained). `tsconfig.json` excludes old incomplete replay snapshots in `tmp/landing-review`; no application sources excluded.

## Explicit holds

Field Guide implementation is STOPPED: approved 014 is a whole-sub hero, not a confirmed cut-face anatomy photo. Existing scaffold unchanged; no substitute or invented callouts. Juan must approve a real original such as L082/L083/L135, or explicitly include phone-build IMG_3237 with source evidence. See `docs/content-evidence.md` for specifics and all ten ingredient lists to supply. Cards show names only meanwhile. Marisa remains held and absent.

Phone composition, real-iPhone Safari and cross-family review remain open. This does not claim Chunk C acceptance or launch readiness. Aggie's pending de31dae4 findings are not included yet.

## Test-first evidence

`tmp-landing-c-red.log`: products module missing before implementation. `tmp-landing-c-host-red.log`: direct/optimizer lineup access failed before the exact-path allowlist change. The initial full-suite photo-guard failure and scratch-snapshot tsc failures are retained in `tmp-landing-c-full.log` and `tmp-landing-c-tsc.log`. The obsolete intermediate build was stopped after the asset-routing omission was found; only final build results count.

## Review request for CC

QA correctness/completeness: review the direct-export provenance and identity mapping; finite host allowlist; lazy images/no-JS strip; the manifest-scoped photo-guard exception; codec skip boundaries; and the explicit Field Guide hold. Report P1/P2/P3 with file:line and concrete failure scenarios, including BC-040 refusal behavior. CC arranges cross-family review and runs independent verification before accepting/committing. No review approval is claimed.

## Final verification

All final commands exited 0. Commands ran locally, with no production credentials/data access.

- `npx.cmd vitest run tests/landing --maxWorkers=3`: 22 files, 188 tests passed (`tmp-landing-c-unit-static.log`).
- `npx.cmd vitest run --pool=threads --no-cache --maxWorkers=3`: 640 files passed / 1 skipped; 9,829 tests passed / 3 skipped (`tmp-landing-c-full-serial.log`). Final run used cmd.exe and ran without a concurrent build. An earlier overlapping run hit the existing vendor-rhythm exhaustive test's 30-second timeout; the timeout was not relaxed.
- `npx.cmd tsc --noEmit`: passed, no diagnostics (`tmp-landing-c-tsc-verified.log`). This also caught and resolved a test-only out-of-scope locator reference before the final browser run.
- `npm.cmd run build`: passed (`tmp-landing-c-build-static.log`). Subsequent changes were test/doc-only; production code stayed frozen.
- `LANDING_E2E_USE_BUILD=1 npx.cmd playwright test`: Chromium + WebKit, 98 passed / exactly 6 authorized codec skips (`tmp-landing-c-e2e-static.log`). All no-JS, poster, autoplay/stalled fallback, reduced-motion, axe and lineup cases passed. All ten card images decoded in both browsers, with and without JS.
- `node scripts/assets/inventory.mjs --sources`: 23 assets passed, including all original-source hashes and both lineup sizes. `git diff --check`: passed.

Inspected the export contact sheet (`tmp/lineup-contact.jpg`) and the final 375px browser lineup screenshot (`test-results/lineup-lineup-is-usable-with-JS-true-chromium/lineup-375.png`). Names stay below photos; keyboard focus is visible; both order links fit without page overflow. This is local visual QA, not Juan's phone acceptance.

Final HEAD remains de31dae4 on feat/landing-p1. No staged changes, commits, pushes, merges or deployments. Field Guide and physical Safari/phone approval remain explicit holds above.

Browser integration correction: runtime image optimization stalled two lineup requests in the first production e2e. The lineup now uses direct, pre-encoded 480/750px WebP candidates in a native picture with next/image unoptimized; both sizes have complete provenance and exact-path allowlisting. Images remain lazy and responsive, with no runtime re-encoding. The first run (87 passed / 11 failed / 6 authorized skips) is retained in tmp-landing-c-e2e.log. It also exposed stale three-CTA expectations and an End-key assumption; tests now expect four placement pairs and native ArrowRight scrolling.
