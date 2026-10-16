# Landing Chunk A review fixes + Chunk B handoff

Branch `feat/landing-p1`, base `df131fa7f9b0f4d7a5a0032ac9d210aa3bf3a3eb`.
Workspace `C:/Users/conta/co-ops-landing`. Historical implementation committed by CC as `de31dae4`; this handoff records that delivery. Subsequent review fixes are tracked separately; no fetch, push, merge, deployment, production access, or migration application.

## Status

NOT READY FOR ACCEPTANCE. Implementation and real asset exports exist, but three required gates remain unresolved:

1. Stock Next 16.2.4 redirects `/foo//` to `/foo/`, then `/foo`: two 308s. The lead simultaneously requires stock normalization and exactly one hop. The strict test remains failing in both browsers; no custom redirect/skip flag was reintroduced. Other requested single trailing-slash paths redirect once and then terminate. A ruling is needed for the repeated-slash case.
2. Local WebKit does not load the H.264 hero or controls (readyState stays 0). A standalone data-URL MP4 probe outside the app also stays at 0 while Chromium reaches 4, despite WebKit reporting probably for MP4. Chromium playback/decoder tests pass; WebKit playback cannot be certified here. No tests were skipped or changed to claim a pass. Run the strict tests on a functioning WebKit media environment and real iPhone Safari/Android before acceptance. The still remains visible; stalled playback now has an eight-second deadline and never exposes an unusable pause button.
3. B1 v4 finishing smoke and Python lock remain blocked: cv2/numpy/pymatting/rembg/scipy/onnxruntime are missing in the default environment, and none of seven cached uv environments supplies the required stack. Existing model files were found. `requirements.lock.txt` explicitly says UNRESOLVED and execution refuses it. The additional co-3d/.venv also lacks pymatting/rembg/onnxruntime. No dependency/model download or fabricated smoke result.

## Chunk A change set

Routing/config: `proxy.ts`, `next.config.ts`, `lib/landing/host-shared.ts`. Stock slash canonicalization restored; invalid/disagreeing authority is staff with fixed PII-free warning; landing routes/tracking dormant. Empty/absent allowlist routing is compared byte-for-byte with the pre-A routing decisions, including original matcher exclusions. Landing host still refuses staff routes after normalization.

Cache: `instrumentation.ts` restored byte-identically to `051d5100`; Vary guard and its test deleted. HTML/RSC private/no-store and per-host content assertions replace Host-token assertions. No Vary: Host requirement; Vercel CDN keys by host.

Metadata: `app/eat/layout.tsx` plus en/es dictionaries own title, description, OG description, metadataBase and canonical, without staff copy. Tests cover both languages.

Tests/docs: Reveal wrapper opacity, axe in initial/open/accepted/rejected/privacy states, 0273 REFERENCES/TRIGGER ceilings, r5 plan/env/contract amendments and deployment notes. Axe uses reduced motion to scan settled content; separate motion-enabled/no-JS tests cover Reveal. Migration 0273 unchanged and file-only. P3-8 optimizer observation stays in the original Chunk A handoff only.

## Chunk B change set

B1: source/approved manifests, provenance sidecars, inventory/export/v4 adapter tooling, source whitelist and mutation tests, exact existing logo. Source paths stay outside the public bundle. Photo entries must name an eligible source ID; missing/held/unknown provenance, hash/sidecar mismatch, traversal and oversized exports are refused. B1 remains partial until its v4 smoke/lock gate passes.

B2: `components/landing/Hero.tsx`, `lib/landing/media.ts`, page/i18n wiring and hero e2e. Real full-frame sm_014 poster is 750x1125, 44,380 bytes, crop/encode-only (no grading or generated food). Its 375px screenshot was inspected: complete sandwich, separated text and two native order links. Original SVG copied byte-for-byte. One preloaded dimensioned poster, no optimizer or initial video request.

B3: `HeroMotion.tsx`, pure media policy, encoder, full-loop opaque H.264, fallback/playback tests and portable decoder proof. MP4 is 720x720, 8 seconds, 30fps, silent, 562,664 bytes, baked on #FFE560. Known-alpha/source samples pass; opaque negative is rejected; original hashes unchanged. Seven derived verification fixtures (1,645,136 bytes) live outside public with exact hashes/commands. Reduced motion, Save-Data, no-JS, rejection/error and stalled playback preserve the real still; offscreen/hidden/manual pause stop playback. No second-aspect fetch. Juan's composition/aspect approval, phone checks and full-loop visual/seam acceptance remain open.

## Verification

Final command outcomes are recorded below. Logs are local `tmp-landing-*.log`; Playwright traces/screenshots are under `test-results/`.

- Full suite via cmd.exe: `npx.cmd vitest run --pool=threads --no-cache --maxWorkers=3` exited 0: 639 files passed, 1 skipped; 9,824 tests passed, 3 skipped. A prior PowerShell run had identical assertion results but wrapper exit 1 with a Git-ignore access warning; the direct-shell rerun resolves that discrepancy. Two additional source-ID omission tests subsequently passed in the targeted asset suite (16/16).
- `node --experimental-strip-types scripts/landing/order-click-sql-check.ts`: exit 0, 31 checks and 100 increments; isolated PGlite only, not independent-session concurrency.
- `node scripts/assets/inventory.mjs --sources`: exit 0, 3 assets; eleven original photo hashes and shipped source hashes intact.
- TDD red evidence: original invalid-host classifier, missing metadata function, missing media policy/manifest, absent hero SSR, omitted photo identity, and stalled-playback controls all failed before their fixes.

## Review/activation handoff

CC arranges cross-family review; no review approval is claimed. Review correctness/completeness with file:line and concrete scenarios, especially host fallback versus staff parity, no-store routing, real-photo provenance, source-ID refusal, and BC-040 (refusal rather than throw). Supply a functioning WebKit media seat and a pinned v4 environment; resolve the repeated-slash contract before calling the chunk accepted. Physical-phone/composition approval remains Juan's gate. Existing WAF/Meta/merchant/performance/migration activation gates remain dormant.

Separate replayable local patches will be saved under `tmp/landing-review/chunk-a-review-fixes.patch` and `chunk-b-assets-hero.patch`; they are review artifacts, not commits. Apply A before B to the stated base. Final patch validation is recorded below.

## Final results

- `npm.cmd run build`: exit 0, final production build.
- `npx.cmd tsc --noEmit --incremental false`: exit 0, no diagnostics.
- `npx.cmd vitest run tests/landing --maxWorkers=3`: exit 0, 21 files / 185 tests passed.
- Full-suite command/results above: exit 0, 9,824 passed / 3 skipped; final added identity tests separately green.
- `LANDING_E2E_USE_BUILD=1 npx.cmd playwright test` on that production build, Chromium + WebKit: exit 1, **92 passed / 8 failed**, no skips. All ten axe scans, native/no-JS hero, bilingual metadata, host fallback/cache isolation, Reveal, consent and stalled-playback fallback pass. Chromium full playback and four decoder comparisons pass. Failures: one-hop `/foo//` in both engines; WebKit corrupt-video request/fallback exercise, actual playback, and four decoder controls.
- `git diff --check`: exit 0.

Representative failing output retained, not reclassified as success:

```text
landing slash canonicalization redirects once: /foo//
Expected: "/foo"
Received: "/foo/"

WebKit decoder proof
Expected readyState: >= 2
Received: 0
```

Replay validation command: `python tmp/landing-review/make-patches.py`. It applies patch A then patch B to a workspace-local snapshot of the base files and compares every result with the final files, checks instrumentation against 051d5100 byte-for-byte, and checks that migration 0273 has no diff. Its result is saved in `tmp/landing-review/patch-validation.txt`. No real checkout/index is modified by that validation.
