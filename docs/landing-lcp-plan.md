# Landing LCP focused round plan

Custody: feat/landing-p1 at c8563eb8, C:/Users/conta/co-ops-landing. Leave work uncommitted. No push, merge, deployment, environment-file changes or migration application. 0273 stays file-only.

## Confirmed evidence

The existing Lighthouse median LCP element is the server-rendered Crunchy Boi hero photo: /media/crunchy-boi-014-3566a724066c.webp, 750x1125 source displayed at 295x443 at 375px. It already has eager loading, high fetch priority and a preload. Median breakdown: TTFB 468.8 ms, load delay 207.8 ms, load time 192.4 ms, render delay 1855.0 ms. Server-response audit: 49.1 ms. No blocking-resource savings; font-display passes. Critical chain contains only the root document. Do not claim lazy loading is the defect.

Fresh unchanged production-build baseline: accepted LCP 2659.7/2647.3/2577.6 ms; unset 2592.8/2572.6/2614.6 ms. Each run transfers 293921 first-party bytes. Real accepted Pixel remains incomplete, so collect a separately labelled route-blocked baseline and after set.

## Implementation plan for CC cross-family review

CC (Claude) approved this plan in the task instruction, with step 0 first: inspect the hero and every ancestor for reveal/opacity/visibility/transform/clip, async decoding and hydration replacement; require server-rendered visible H1/poster, and capture before/after production trace and LHCI LCP breakdown. No above-the-fold reveal is permitted.

1. Add original-photo WebP derivatives at 320/640/960 widths through a bounded reproducible script under scripts/assets, with source hash verification, full-frame uniform resize, content-addressed files, provenance sidecars and approved/public inventory updates. Preserve the original 750px asset used by the lineup.
2. Add a shared poster srcset/sizes contract in lib/landing/media.ts and use it identically on components/landing/Hero.tsx preload and img. Keep server HTML, eager/high priority, intrinsic dimensions, aspect and bilingual alt unchanged. Choose sizes from actual object-contain rendered width, including the 28rem height cap. Cover DPR 1/2/3.
3. Test the rendered preload/img contract first; add production-browser checks for exactly one poster fetch and expected DPR candidate in en/es with JavaScript disabled. Verify asset derivations.
4. Add explicitly opt-in Pixel route-blocking to LHCI measurement only, label reports as first-party-only, validate blocking evidence, preserve the default real-Pixel completion requirement. Keep all thresholds unchanged. Test before implementation.
5. Investigate render delay using fresh timing and trace evidence. Change fonts or stream shop reads only if measurements show those changes address the bottleneck. Root layout/font changes affect staff routes and require a narrower justification than image sizing.
6. Run landing tests, full suite --maxWorkers=3, tsc, production build, full Playwright suite, npm run perf:ci, and three isolated cold runs per consent state before and after. Report every run and medians without turning incomplete Pixel traffic into measured third-party cost.

Risks: responsive preload mismatch can double-fetch; object-contain means element width is not always painted image width; font metrics affect hero position; pending provider requests make accepted results misleading; resizing alone may not remove dominant render delay. Cross-family plan review is approved; final implementation review belongs to CC. All work remains uncommitted.
