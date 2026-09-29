# Training build: video first, interactive scene when ready

Status: GLM and DeepSeek reviews read in full; implementation authorized by CC with no further plan round.
Branch: `astra/training-video-first`. Dedicated clone: `C:/Users/conta/co-ops-astra-video`.
No push, merge, production writes, upload, or video rendering in this task.

## Confirmed contracts

- `LearnTheBuild.tsx` currently mounts the live element and replaces failed startup with a step list. `viewer-start.ts` already bounds import and preparation separately; retain those ceilings and first-outcome-wins behavior.
- The route performs full `requireSession` before manifest lookup and conditional responses. Local photos are hash-checked; deployed photos redirect to a service-role signed URL. MP4 delivery must instead stream through the authenticated same-origin route.
- `co-scenes/web/render-video.ts` emits H.264 MP4 with faststart, a JPEG poster, and a `co-scenes-video/1` sidecar. Output names contain a 16-character SHA-256 prefix; sources record the full SHA-256 and byte count. The sidecar carries step times, provenance stamps, and illustrated intervals. The vendored manifest presently has no video entry.
- `co-scenes/src/web/crunchy-build.ts` fetches video with `redirect: 'error'` and checks the full source hash. Its built-in selection is live-to-video fallback, not concurrent video-first/live preparation. Use an immediately rendered native video plus a separately prepared live element; do not change the vendored bundle.
- Migration 0212 restricts the private bucket to PNG and 2 MiB. A new, unapplied migration is necessary for MP4/JPEG and a bounded 12 MiB media limit; preserve private status and service-role-only access. Do not modify the historical migration.
- No MP4 bytes or SHA-256 are supplied. Do not invent a manifest hash or claim video delivery is operational before CC provides the artifacts.

## Files and implementation

1. `lib/training/co-scenes-shared.ts`, `training-assets-shared.ts`, `co-scenes-files.ts`:
   extend the existing `photos`-style private media store to allow content-addressed MP4 and JPEG alongside PNG. Preserve exact manifest membership, safe single-segment paths, full hash agreement, and MIME allowlisting. Add a typed optional video entry pointing to validated media metadata. Keep all client imports pure.
2. New pure video/HTTP helpers in `lib/training/`:
   validate video metadata and decide video/scene/list visibility. Resolve single byte ranges (bounded, open-ended, suffix), ignore unsupported multi-ranges by serving the full representation, return 416 for unsatisfiable ranges, and honor strong If-Range semantics.
3. `lib/training/training-assets.ts` and `app/api/training/co-scenes/[...path]/route.ts`:
   obtain private storage access only after session and allowlist checks. Fetch storage server-side and pipe the response body, without exposing a signed URL or buffering the entire MP4. GET supports 200/206/416; HEAD ignores Range and returns full-representation headers without a body. Include Content-Length, Content-Range, Accept-Ranges, strong manifest ETag, private revalidation and nosniff. Validate upstream status/range metadata; never relay upstream credentials, redirects, or error bodies. Keep existing PNG delivery behavior. Local video delivery must have equivalent range semantics.
4. `components/training/LearnTheBuild.tsx`, `lib/training/viewer-start.ts`, en/es dictionaries:
   render the video from the first page render independently of the dynamic scene import; muted, inline, with controls and reduced-motion-aware autoplay. Prepare the live element in a sized, inaccessible hidden layer; reveal it only on successful readiness. Remove/pause the video on success. Leave video on failure, timeout, missing scene data, and language remount. Show the step list only when video is unavailable/failed and the scene is not ready. Keep Illustrated labeling tied to the visible content. Clean up stale effects and prevent late events from changing a remounted viewer.
5. New `scripts/import-training-video.ts`, existing upload script, manifest metadata, runbook:
   import CC's existing renderer output without rendering. Verify source byte count, SHA-256, clean provenance, stage look and empty illustrated intervals; validate step correspondence to the current build card. Copy media only into the ignored store using full-hash names. Rewrite source/poster URLs in a derived sidecar, rehash that JSON, and register its hash in `files` plus MP4/poster metadata in the optional `video` entry. Preserve the original renderer provenance. Make repeated imports safe. Upload with the correct MIME and never overwrite. Do not add placeholder manifest entries while artifacts are absent.
6. New migration after 0212 (recheck lineage before naming): widen only the training bucket MIME/size constraints for these assets; stage it for CC, never apply it here.
7. Build verification exposed overbroad filesystem tracing masking a missing vendored-data include. Narrow filesystem tracing in `co-scenes-files.ts`, use the explicit route-prefix glob in `next.config.ts`, and inspect the generated route trace for every manifest code/data file and no local media.

## Test-first sequence

- Add failing Vitest cases before implementation: media allowlist/path/hash/MIME guards; malformed sidecars and stale/drawn provenance refusal; upload validation and correct MIME; initial video visibility, ready swap, failed/hung scene retention, language changes and video failure; ranges including `bytes=0-1` (Safari), suffix/open-ended, clipping, unsatisfiable, malformed/multi-range and If-Range.
- Route tests use mocked session/storage only: unauthorized/revoked requests cannot touch storage or return 304; unknown files are refused; MP4 responses never redirect; body is streamed; HEAD and upstream failure paths are bounded and sanitized. No live DB test.
- Run the focused training suite, `npm test`, `npm run typecheck`, targeted ESLint, discipline check as configured in CI, and `npm run build`. Record commands and actual results. Read installed Next.js route-handler docs before editing route code.
- Browser verification with synthetic test media if tooling permits: video exists before scene import completes, ready-only reveal, failed scene retains video, reduced motion, en/es remount, no hidden-layer input focus. Real Safari and artifact delivery smoke remain CC's preview checks once the genuine asset is available.

## Exact CC artifact and release handoff

1. From a clean `~/co-scenes` checkout at the approved render revision (brief: main `6dfa978`), render track C Crunchy Boi **stage**, **720x1280**, **30 fps** using `web/render-video.ts stage 720x1280 30`, with `CO_SCENES_CARD_CSV` pointing to this app's sandwich build sheet and `CO_SCENES_CRUNCHY_ASSETS` to the approved real-photo derived assets. Do not use stub/studio or generated food. The MP4 must be <= 12 MiB.
2. Supply the matching `web/dist-video/index.json` selection, `stage-720x1280-video-<hash16>.json` sidecar, its exact `sources[].url` H.264 MP4, and its exact `poster` JPEG. Include the original provenance stamps; `dirty` must be absent/false and `illustrated` empty. No AV1 required.
3. Run the planned import command against that sidecar. Review the resulting content-addressed manifest and derived sidecar; commit metadata only, never MP4/JPEG/photo bytes. The actual object names and full SHA-256 values come from those verified files, not this plan.
4. Review/apply the staged bucket migration through the normal production approval process. Run the upload dry run, then the uploader against the intended project with the newly registered MP4/poster available alongside the existing photo store. Objects go under `training-assets/co-scenes/<full-hash-name>` with `upsert: false`.
5. On the PR preview, verify authenticated video-first playback and Safari seeking; force WebGL/import failure and confirm video remains; restore and confirm ready-only swap. Confirm a revoked/no-cookie MP4 request is denied. Complete cross-family code review and CC's independent test run before the normal merge process.

## Risks / prerequisites

- Dependencies were installed offline from the adjacent CO-OPS installation after confirming every locked package version matches. No env files were read or copied. Registry access for `npm ci` was denied.
- Genuine initial playback cannot be verified or enabled in the committed manifest until CC produces the artifacts. That is an explicit handoff, not a fabricated completed asset.
- The required different-family review is supplied (GLM APPROVE, DeepSeek CHANGES REQUESTED); resolutions follow below.

## Review resolutions (2026-09-29)

- GLM 1 / DeepSeek 5, 6, 16: explicit `playsInline`, `muted`, native controls. Initial video loading shows its poster and localized loading status; video error/absence shows steps until scene readiness. Reduced motion disables autoplay. Every language remount resets to video-first; stale callbacks cannot swap it. Pause and release video on readiness/unmount, with tests (GLM 3).
- GLM 2: import refuses MP4 without moov before mdat (faststart).
- GLM 4: typed optional `video` holds source/poster metadata; `media/<name>` resolves from it, without duplicate `photos` entries. Bytes live in the existing ignored photos directory.
- DeepSeek 1, 2, 4, 14, 15: ETag is exactly the quoted full source SHA-256. If-Range must equal it byte-for-byte; weak/date/stale values ignore Range and return 200 full. One range resolver and response headers serve local/storage media. `bytes=0-1` gives 206, two bytes and `Content-Range: bytes 0-1/<size>`. Unsupported multi-ranges intentionally return 200 full. Order: full session, safe manifest allowlist, conditional, range, storage.
- HEAD resolution (GLM 3 / DeepSeek 3): HEAD uses the same authentication/allowlist and full-representation headers with no body, ignores Range and returns 200 (or conditional 304). Reject DeepSeek's ranged HEAD suggestion: Range is a GET modifier; GLM's no-206 HEAD interpretation is adopted. Test this explicitly.
- DeepSeek 7: 0212 defines bucket row settings, not a CHECK constraint; no constraint DROP/ADD is appropriate. New 0213 updates only this private bucket to PNG/JPEG/MP4 and a single 12 MiB bucket cap (Storage has one cap per bucket). Uploader retains PNG's 2 MiB cap and uses 12 MiB for video/poster; no new policies or historical migration edits.
- DeepSeek 8–10: source and poster URLs always use the authenticated same-origin route. MP4/JPEG never redirect; server fetch refuses redirects and sanitizes failures. Poster is full-body-only image/jpeg behind the same gate. All media responses carry inline disposition and nosniff; legacy PNG signed delivery remains as scoped in the original plan.
- DeepSeek 11: re-import verifies existing content-addressed bytes before skipping; conflicting files/manifest entries fail. No overwrite. Derived sidecar preserves original provenance, rewrites URLs, and gets its own computed hash.
- DeepSeek 12: current card revision and ordered step identities/ingredients/amounts must agree; step_times must match approved stage narrative completion times, frame-aligned within half a frame (the card has no time boundaries itself).
- DeepSeek 13: reject equating `stamps.scene_commit` with checkout revision: source defines it as last change under src/scene. Verify approved renderer HEAD 6dfa978 separately and recompute provenance against its clean closure and supplied assets; preserve stamps.
- DeepSeek 17: require an executable focused baseline and red tests before implementation. `npm ci` failed EACCES; an offline copy of the existing local installation is acceptable if package versions match the lock (all locked versions compared equal), without modifying lockfiles or reading env files. Reject requiring the literal `npm ci` command to succeed when equivalent installed dependencies permit the requested tests.
- DeepSeek 18: real iOS Safari playback/seeking is a required CC preview release gate, not optional. Local browser verification is additional evidence, never a substitute for device verification or genuine missing artifacts. Native media controls use browser localization; custom accessible labels are en/es.

## Historical preparation checks (before review; 2026-09-29)

- Read the matching Next.js route-handler guide from `C:/Users/conta/co-ops/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`; this clone has no installed copy yet.
- Read `.github/workflows/build.yml`: CI runs `bash scripts/phase2-discipline-check.sh`, `npm test`, then `npm run build`.
- `npm.cmd test` could not start: `'vitest' is not recognized as an internal or external command`.
- `npm.cmd ci --ignore-scripts --offline --cache .tmp-npm-cache` failed with `ENOTCACHED` (the local cache lacks required packages).
- The bounded online retry, `npm.cmd ci --ignore-scripts --cache .tmp-npm-cache --fetch-retries=0 --fetch-timeout=10000 --no-audit --no-fund`, failed with `EACCES` fetching from registry.npmjs.org. Dependencies remain unavailable; no tests passed or ran.
- Implementation and test-first edits have not begun while the required plan review is pending.

## Implementation verification (2026-09-29)

- Dependencies: online `npm.cmd ci --ignore-scripts --cache .tmp-npm-cache --fetch-retries=0 --fetch-timeout=10000 --no-audit --no-fund` failed with registry `EACCES`. Copied the existing installation from the adjacent CO-OPS checkout after comparing all lockfile package versions (no differences). No lockfile or env changes.
- Test-first evidence: route tests returned 404 instead of 206/416 and HEAD was absent; new pure modules initially failed import; uploader tests failed correct-MIME/PNG-cap expectations; browser test caught missing initial loading status; cancellation test failed when signing hung. Each was implemented and rerun green.
- `npm.cmd test -- --maxWorkers=2`: 3,702 passed, one skipped, two failures, both `Test timed out in 30000ms` in unchanged vendor suites. Their isolated rerun (`node node_modules/vitest/vitest.mjs run tests/vendor-exports-catalog-joins.test.ts tests/vendor-rhythm-shared.test.ts --maxWorkers=1 --testTimeout=120000`) passed all 48 tests.
- Final full suite: `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --testTimeout=120000` passed **204 files, 3,707 tests**, one skipped. Timeout was a command-line override only; repo test configuration is unchanged.
- Focused training suite: 12 files / 142 tests passed; the subsequently added signing-cancellation case and affected route/local suites passed (21 tests). Included in the final full-suite count above.
- `npm.cmd run typecheck`: passed after Next generated its image/type declarations and a new test's header-fixture union was explicitly typed. An earlier run had six missing PNG declaration errors and that one test typing error; those were resolved.
- Targeted `node node_modules/eslint/bin/eslint.js` over changed TS/TSX tests, scripts, route and browser harness passed with no warnings; touched transport/filesystem tests were rechecked after the cancellation change.
- `bash scripts/phase2-discipline-check.sh`: passed. `git diff --check`: passed.
- `node tests/browser/training-video-ui.mjs`: Chromium and WebKit passed actual-component first-render video attributes, pending-media status, reduced motion, ready swap/pause, inert focus exclusion, language remount, stale readiness, scene failure retention and media failure fallback. Synthetic black poster/held media and instrumented play/pause; **not** actual decoding or iOS Safari seeking.
- `npm.cmd run build`: failed fetching DM Sans from Google Fonts (network unavailable). With a temporary ignored `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` fixture, the full diagnostic build compiled, typechecked and generated all 189 static pages, exit 0. This is **not** a passing ordinary network/font build. A subsequent compile-mode run is used to inspect the final deployment trace after correcting overbroad tracing; it does not replace the full build gate.
- Final tracing verification: with that same ignored font fixture, `node node_modules/next/dist/bin/next build --experimental-build-mode compile` passed with no warning. The media route's generated `.nft.json` contains all four `manifest.files` entries (plus the manifest), no ignored media, and no unrelated root documents; 255 files total instead of the erroneous 1,944. The route-prefix glob fix in `next.config.ts` is necessary: narrowing the read alone exposed four missing dist files. A route-filtered compile was insufficient to test configured includes, so the final check used all routes.
- No genuine MP4/poster imported, no placeholder manifest entry, no render/upload, no migration applied, no production data accessed, no push or merge. CC's genuine-artifact import and preview Safari/Storage range checks remain the explicit release handoff.

## Author check and review handoff

Applied relevant catalog classes to this diff: BC-001/004 (manifest/session gates in both directions), BC-018 (en/es labels), BC-019 (actual renderer and migration contracts), BC-027/032/040 (cold/failed media and bounded startup), BC-030 (synthetic verification explicitly separated from genuine Storage/decoder verification), BC-035 (browser focus/visibility check), BC-037/044 (immutable artifact collision refusal before writes), BC-038 (staged migration before upload), BC-043 (author tests do not substitute for CC's independent review), BC-051 (typed video registry also consumed by uploader).
The cross-family reviews supplied here were **plan reviews**. Final code review and CC's independent test run remain with CC per the approved handoff; no code-review verdict is fabricated.
