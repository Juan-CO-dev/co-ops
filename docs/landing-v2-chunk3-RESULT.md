# LANDING v2 — Part A and chunk 3 result

Worktree: `C:/Users/conta/co-ops-landing`; branch `feat/landing-v2`; baseline `392cfd1c`. Changes are UNCOMMITTED. No push, merge, migration, deployment, environment-file or database changes.

## Part A

- `scripts/assets/export-landing-v2.mjs`: retain the prior inspection object when the regenerated output hash is identical. Different output bytes still refuse replacement.
- `scripts/assets/fingerprint.mjs`: retain optional runtime dimensions, taking their values from the approved manifest. Only explicitly selected public fields enter runtime config.
- `tests/landing/v2-assets.test.ts`: new exporter-rerun regression, new fingerprint-rerun regression, and PASS/reviewer/date assertions for every v2 asset.
- `docs/landing-v2-chunk1-RESULT.md`, `docs/landing-v2-build-results.md`: correct historical commit custody.

Failing-first evidence: exporter regression failed with dated PASS replaced by pending (1 failed / 4 passed); preservation fix passed. Fingerprint regression failed with all eleven width/height pairs removed (1 failed / 5 passed); fix passed (6/6). The exporter rerun requires private originals and skips when P013 is unavailable; the committed-verdict assertions and fingerprint regression always run.

| Review item | Disposition |
|---|---|
| P2-1 | Fixed; preserve the complete inspection object only for identical output hashes. All eleven committed entries require PASS, reviewer and date. |
| P3-1 | Retain the reviewed 480×721 bytes and ±1 rounding allowance. This is libvips shrink-on-load rounding, not stretching. The existing chunk-1 result records it; no re-encode or provenance rewrite solely to duplicate that explanation in eleven records. |
| P3-2 | Retain a required local source gate, documented below. Auto-generation inside the validator is deferred: the checker remains read-only, and the source pack still requires private originals/video outside Git. A clean checkout must extract the approved SUBDEX frame before `--sources`. Neither clean-checkout self-containment nor CI source reconstruction is claimed. This limitation remains open. |
| P3-3 | Retain the fast-check trust boundary: a self-consistent changed encode/height is not source proof. Mandatory local `--sources` reconstruction plus decoded v2 dimension assertions supply this handoff's evidence. Re-encoding cannot be proven from shipped hashes alone; no claim that the fast gate catches it. |
| P3-4 | Fixed the destructive writer; dimensions remain optional public metadata for backward compatibility with the existing 29 path-only consumers. Fingerprinting retains dimensioned records using authoritative manifest values. |
| P3-5 | Intentional portability: `source:<ID>` resolves through the committed source manifest to original path/hash. Absolute master paths remain outside runtime data; use the manifest with a standalone sidecar. |
| P3-6 | Corrected historical docs: chunk 1 was committed at `21922b70`, chunk 2 at `392cfd1c`. Earlier test results remain explicitly historical. |
| P3-7 | Retain the stricter canonical crop-step array. Future crop recipes must use EXIF orientation, integer oriented-coordinate crop, uniform no-enlargement resize, WebP/metadata stripping, in that order; sidecar equality also remains enforced. |

Local handoff/pre-push gate (CC owns any later push): ensure the private source pack is mounted and the pinned SUBDEX frame has been extracted with `scripts/assets/subdex-source.mjs`, then run `npm.cmd run assets:check -- --sources`. A missing source/intermediate is a failed gate, never a waiver. This run passed all 40 assets. `assets:check` without sources also passed all 40. No public asset bytes or sidecars changed in this task.

## Part B

- `app/eat/page.tsx`, `app/eat/layout.tsx`, new `app/eat/landing-v2.css`: red direction-A hero, edge-to-edge P013, giant cream heading, editorial sections; route-only stylesheet with every selector scoped under `.landing-v2`. Existing lineup/catering/footer components receive scoped styling without a global staff-style change.
- `components/landing/Hero.tsx`, `lib/landing/media.ts`: native named shop anchors and secondary catering link, matching preload/srcset/sizes for five P013 candidates; full-frame photo separated from copy; no automatic hero video.
- `components/landing/ConsentNotice.tsx`, `components/landing/TrackingProvider.tsx`: one consent notice rendered after hero actions through provider context; ordinary bottom dock, measured bottom reservation, expanded text/zoom/short-viewport in-flow fallback. Privacy page retains its own notice. Consent and event behavior retain the existing provider.
- New `components/landing/IllustratedSpin.tsx`: separately labeled below-fold illustration, no media source until explicit Play, native controls/retry.
- `lib/i18n/en.json`, `lib/i18n/es.json`: bilingual hero title, illustrated label and concise consent description.
- `tests/landing/hero-poster.test.ts`; `tests/e2e/landing/hero.spec.ts`, `hero-poster.spec.ts`, `motion.spec.ts`, new `static-v2.spec.ts`: assertion changes below.

No playful touches or sticky rail are introduced in chunk 3. Their absence is asserted; reveal/minimize/reverse-scroll behavior belongs to chunk 4, and touch envelopes to chunk 6. No motion enhancement, craving sequence or L083 Field Guide is pulled forward from later chunks.

## Changed assertions

1. `v2-assets.test.ts`: exact inspection-object preservation across a real local exporter rerun; runtime inventory equality across fingerprint rerun; verdict `/^PASS/`, truthy reviewer and date for all eleven assets. Existing hash/recipe/crop/size/sidecar assertions remain.
2. `hero-poster.test.ts`: P013 candidates 320/480/640/960/1280 replace 014 candidates 320/640/960; sizes now `(min-width: 768px) 50vw, 100vw`; intrinsic fallback 960×1440 replaces 750×1125. Added copy/action/consent-slot/catering URL assertions. Preload equality, one image, eager/high priority, accessible heading/alt and no automatic video stay enforced. Both languages first failed against the old hero, then passed. Added SSR `data-flow="false"` assertion: first failed on the in-flow initial state, then passed after fixing the hydration layout jump.
3. `hero.spec.ts`: no-JS intrinsic dimensions updated to 960×1440; native links, no optimizer/media request and overflow assertions retained.
4. `hero-poster.spec.ts`: painted width now full viewport below 768 and half above; removed obsolete 28rem height-cap assertion, retaining positive height and sizes/paint equality. DPR 1/2/3 at 375 select P013 480/960/1280; one download, decode, hydration identity, preload, visibility and no masking remain enforced.
5. New `static-v2.spec.ts`: both languages at 375×667/812, 34px safe-inset fixture, header ≤52px, copy ≤340px, action bottom ≤392px, dock ≤200px, dock top ≥height−234, ≥41px action clearance, three ≥44px links and keyboard focus, no overflow/sticky/touches/hero video. Expanded-text fallback checks ordered rectangles and retained focus. Desktop 1440×900 red/full-bleed screenshot. Cold first-party transfer ≤500,000 bytes at DPR 1/2/3 for unset/accepted consent; no initial video request. Meta is stubbed, never counted as live-provider performance evidence. Added explicit-Play/source attachment/native-controls coverage, absence of landing markup on the staff host, and no-JS footer clearance at 375px plus native narrow-zoom reflow at 187px.

6. `motion.spec.ts` is an explicit additional compatibility file: its nine old cases targeted the removed autoplay hero and would deterministically fail CI on the missing selector. They now target the manual below-fold spin. Reduced-motion/save-data still require zero automatic media requests. Decode/rejected-play failures now require the static hero plus usable retry/native controls instead of removing an automatic overlay. Keyboard Play requires one source attachment and stable geometry, rather than automatic scroll playback/custom pause/offscreen resume. Pending play retains usable controls instead of an automatic eight-second watchdog removal. The three former watchdog-event cases now assert scroll/resize/visibility cannot substitute for explicit Play. The pre-existing non-Darwin WebKit decode skip is retained: a trial without it produced no H.264 request on Windows, so that decoder-failure path remains unproven here. Actual decoder evidence remains in unchanged `video-proof.spec.ts`; SUBDEX reliability remains chunk 7. This is a disclosed contract migration, not a green claim for the retired autoplay behavior.

## Failing-first browser corrections

- First scoped run: 86 passed / 8 failed. All eight failures were axe contrast on cream 14px body/link text over `#ed3308` (3.92:1). Small hero copy/link are now black; oversized headline stays cream. Next run: 98/98 passed in 2.1 minutes, including explicit-Play and staff checks.
- A no-JS probe then reproduced footer occlusion: link bottom 618.71875px, consent top 493.40625px. Added a server-default 234px bottom reserve and narrow-header wrap. Final browser rerun includes the regression; results below.
- SSR consent initially rendered in-flow before docking, which would shift the hero image. The added unit assertion failed on `data-flow="true"`, then passed with the ordinary dock rendered initially. CSS handles narrow/short viewports before hydration; measured enhanced-text behavior retains focus.

## Verification

- `npm.cmd test -- tests/landing --maxWorkers=1`: PASS, 37 files / 309 tests (`tmp/chunk3-landing-verified.log`).
- `npm.cmd run assets:check`: PASS, 40 assets. `npm.cmd run assets:check -- --sources`: PASS, 40 assets, including deterministic photo reconstruction. No public asset bytes changed afterward.
- `node node_modules/next/dist/bin/next typegen`, then `node node_modules/typescript/bin/tsc --noEmit`: PASS, explicit exit 0 for each. Earlier `npx.cmd` invocations also passed.
- `npm.cmd run build`: PASS on final application/CSS, explicit exit 0 (`tmp/chunk3-build-final-css.log`). Final type generation and standalone tsc also exit 0 after the motion-spec migration. Two earlier interrupted intermediate builds are not counted as passes.
- Scoped e2e only: `hero.spec.ts hero-poster.spec.ts static-v2.spec.ts shell.spec.ts reflow.spec.ts languages.spec.ts accessibility.spec.ts`, plus the migrated `motion.spec.ts`. Both Chromium and WebKit. Test-process-only `LANDING_E2E_USE_BUILD=1` reuses the production build; `LANDING_PERF_CONSENT=unset` skips the unrelated separately compiled nearby fixture. No environment file changed. Initial 8 contrast failures were fixed. Final static group: **102 passed**, exit 0, 2.0 minutes (`tmp/chunk3-e2e-final.log`). Manual-spin compatibility group: **17 passed / 1 skipped**, exit 0, 35.8 seconds (`tmp/chunk3-motion-verified.log`). Total scoped cases: **119 passed / 1 skipped**. The skip is the pre-existing non-Darwin WebKit H.264 decoder limitation; a trial without the skip failed to initiate the media request (`tmp/chunk3-motion-final.log`), so native decoding remains unverified, not passed.
- `npm.cmd test -- --maxWorkers=3`: **745 files passed, 1 skipped, 2 failed; 12,144 tests passed, 3 skipped, 2 failed**. Duration 664.00s. Raw evidence: `tmp/chunk3-full-suite.log`.

Known tsx subprocess failures, listed separately (no other full-suite failures):

| Test | Diagnostic |
|---|---|
| `tests/people-chunkE-review.test.ts:130` | `tsx` fails before the expected missing-credentials exit: `uv_os_get_passwd returned ENOMEM`, `node:os:305`, `tsx/dist/temporary-directory-CwHp0_NW.mjs`. |
| `tests/pm-criteria.test.ts:140` | Same `uv_os_get_passwd returned ENOMEM` startup failure instead of the expected named exit 2. |

These are failed tests, not passes or silently skipped cases. No connected database was used.

PR #491 CI is the authoritative perf/e2e gate. No CI submission or green CI claim is made for this uncommitted revision.


Reproducible local source gate after mounting the private originals/video (PowerShell):

```powershell
@'
import {mkdirSync,writeFileSync} from "node:fs";
import {dirname} from "node:path";
import {extractSubdexFrame,FRAME_PATH} from "./scripts/assets/subdex-source.mjs";
mkdirSync(dirname(FRAME_PATH),{recursive:true});
writeFileSync(FRAME_PATH,extractSubdexFrame());
'@ | node --input-type=module
npm.cmd run assets:check -- --sources
```

This explicitly prepares the gitignored SUBDEX intermediate; it does not turn the fast validator into a derivation proof or remove the private-source prerequisite.


## Final transfer and visual evidence

Cold initial first-party response body + header bytes, at 375x667, using the production build and offline Meta stub. Both UNSET and ACCEPTED consent produced the same totals within each browser/DPR pair; all twelve measurements passed the unchanged 500,000-byte ceiling.

| Browser | DPR 1 | DPR 2 | DPR 3 |
|---|---:|---:|---:|
| Chromium | 301,341 | 355,996 | 401,871 |
| WebKit | 301,574 | 356,510 | 401,068 |

Worst measured initial first-party transfer: **401,871 bytes**, leaving **98,129 bytes** below the ceiling. These are local first-party transfer measurements, not Lighthouse/LCP/TBT scores or live Meta costs. PR #491 CI remains authoritative for perf/e2e.

Final static screenshots and HTML report/transfer attachments are preserved under `tmp/landing-v2/chunk3-static-e2e/` before the separate motion run reset Playwright's output directory. Inspected the phone en/es 375x667 renders and 1440x900 desktop screenshot; button focus outlines in the phone captures are intentional keyboard evidence. Automated coverage also includes 375x812, 200% text, 187px no-JS narrow viewport, responsive decode/one-download and staff markup. Final contrast checks pass. The no-JS footer regression passes in both engines.

## Remaining gates and handoff

- CI for this exact uncommitted revision, cross-family/CC review, and later release actions remain external. No push, merge, deployment or production change was performed.
- Private-source reconstruction remains a local gate with explicit source/intermediate prerequisites (P3-2); the fast check cannot prove a self-consistent re-encode (P3-3).
- Windows WebKit H.264 decoding is unverified; actual iPhone/Safari evidence and SUBDEX readiness work remain chunk 7.
- The full suite is NOT wholly green: the two known tsx ENOMEM failures are listed above and their logs are retained. No new full-suite failure was hidden or skipped.
- `git diff --check`: PASS. HEAD remains `392cfd1c`; all changes are uncommitted on `feat/landing-v2` at `C:/Users/conta/co-ops-landing`.
