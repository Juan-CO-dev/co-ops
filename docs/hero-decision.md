# Hero media decision — Chunk B

The provisional hero uses the supplied 1:1 spin, with the complete 8-second loop retained. No food was generated or substituted. This existing AI-reference spin is **DRAWN**, separate from the real-photo sm_014 poster. Juan's final composition/aspect approval and physical-phone quality checks remain open.

The public derivative is `public/media/crunchy-boi-spin.mp4`: H.264/yuv420p, 720 × 720, 30 fps, no audio, faststart, 562,664 bytes (limit 1,500,000). The alpha master is decoded with `libvpx-vp9` explicitly selected BEFORE the input. RGBA compositing uses the exact hero CSS background **#FFE560**, before conversion to yuv420p. No crop; aspect and full loop preserved. Ink comparison exports use the actual app text/ink **#141414**. Lossy YUV encoding can change reconstructed RGB values slightly; the input composite color is exact.

Reproduction (FFmpeg 8.1.1 full build):

```powershell
node scripts/assets/encode-video.mjs 'C:/Users/conta/CO-Ads-Launch-2026-10/08 Crunchy Boi 360 Spin (asset)/Spin_1x1_transparent.webm' 'C:/Users/conta/CO-Ads-Launch-2026-10/19 Brand Assets - Logo Pack/02 3D Stamp Spin/StampSpin_1x1_3s_ALPHA.webm'
```

The encoder verifies a nonconstant decoded alpha plane for the known-alpha stamp control and source frames at 0/2/4/6 seconds. A generated solid-color non-food opaque H.264 control is rejected by the same nonconstant-alpha criterion. It checks codec, pixel format, dimensions, absence of audio, full duration, byte budget, and unchanged source/control hashes. CRF 23 / preset slow passes the budget without reducing duration or resolution further.

`assets/provenance/hero-spin.json` records the source and export SHA-256 hashes, classification, background and processing steps. `assets/work/video/verification.json` retains exact tool arguments/version, probe results, alpha measurements and control hash. The work directory is private/ignored. Public MP4 SHA-256: `dfb8c93fe64d4c2aac3380dab9762a74110423b93f3f545288425ac0b5a2645a`.

Decoder reference PNGs and decoded MP4 PNGs for both source and stamp control, over yellow and ink, are in `assets/work/video/`. `tests/e2e/landing/video-proof.spec.ts` fulfills those private files locally to Chromium/WebKit, compares the first decoded frame at 375 px and records screenshots and RGB error. The tolerance is mean absolute RGB error ≤8/255 and corner error ≤5/255, accommodating H.264/chroma subsampling while rejecting a lost-alpha black box. The required small derived MP4/PNG fixtures and hash/tool/source provenance are tracked in `assets/verification/hero/`, so CI needs no original masters or ignored work directory. They are never served publicly. Browser execution outcomes belong in the final handoff, not inferred from file creation.

Open acceptance gates: actual iPhone Safari and Android device checks have **not** been run; Juan has not approved the aspect/composition. Screenshot/reference checks alone do not certify phone playback, visual quality through the full loop, or the existing master’s seam. No production activation is implied.
