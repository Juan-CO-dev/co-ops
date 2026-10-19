# Landing v3 "CONVERT": locked plan (CC, 2026-10-19)

**Source:** Juan's iPhone smoke of v2 (8 items). Fable and Astra consulted (`scratchpad/landing-v3-consult-*`). CC builds; Astra reviews code (cross-family); CI runs on the exact SHA.

## Laws (unchanged from v2)
- **No visible tags.**
- **No personal data:** geolocation coordinates stay in memory only and never go into any request.
- **No third-party requests before consent.**
- **Perf gate:**
  - LCP under 2.5 s and TBT ≤ 200 ms (applied throttling);
  - first-party ≤ 500 KB per run;
  - transfer budgets in `scripts/check-transfer-budget.mjs`;
  - the hero P013 stays the LCP element.
- **Reduced motion and Save-Data** get complete static equivalents.
- **en/es parity.**
- **Staff byte-identical.**
- **Real-food law:** the drawn 360 spin is never presented as a continuation of a real photo. It is its own object (a game "model viewer"), never morphed from or into real photos. Provenance lives only in manifests and filenames.

## Decisions
1. **Hero:**
   - scroll-zoom on the P013 photo (transform only, after first paint, `overflow: hidden` cell);
   - CSS `animation-timeline` where supported, rAF fallback (iOS 18);
   - bigger CTA type.
2. **Crunch story (pinned, two real-photo beats):**
   - P016 texture → L083 cross-section;
   - a caption rail ABOVE the media swaps per beat, driven by one shared progress contract (CSS-native and rAF paths both update the caption).
3. **Choose your fighter = select screen:**
   - **Stage:** Crunchy Boi is preselected. Its stage is the drag-to-spin turntable: canvas, 48 WebP-alpha frames, idle rotation, plus rotation coupled to scroll delta.
   - **Roster:** a carousel of real photo cards that auto-advances every ~5 s, with a visible 44 px pause chip. It stops for good after a manual swipe or focus, and runs at most one loop.
   - **P1 cursor:** the pixel guy, with a stepped highlight border.
   - **Tap a card = SELECT:** the stage swaps to that sub's photo and `aria-current` moves to the card. A single "Order the {sub}" CTA opens a bottom sheet with two shop links (`OrderClick` `placement=lineup` stays on the outbound link). The sheet is focus-trapped, closes on Escape, and restores focus.
   - The drawn spin is only ever the Crunchy Boi stage object.
4. **Field Guide:**
   - ingredient words outside the photo, each paired with its pixel pickup icon (`aria-hidden`);
   - SVG leader lines draw word → ingredient in sequence, then fade, and the pickup "collects";
   - "6/6" when all are found;
   - one chip term: "Ripple chips";
   - reduced motion shows all lines statically.
5. **SUBDEX section deleted** (component, media, tests, i18n, checklist). Pixel/game assets get specific jobs instead: the P1 cursor, a sticky-bar accessory, pickups, the catering queue and stamp hits. No random decoration.
6. **Spin:**
   - no `<video>`, no controls; the `IllustratedSpin` mp4 is removed;
   - frames are derived via the inventory pipeline as a new "drawn frame-sequence" recipe;
   - ~850 KB at 540 w, measured; lazy, loaded progressively starting with every 4th frame;
   - `createImageBitmap`, DPR capped at 2, `touch-action: pan-y`, keyboard rotation.
7. **Catering:**
   - real shoot photo (hands reaching into a table spread and/or the catering-box stack), crop-resize-only real-photo export;
   - optional pixel NPC queue;
   - ONE primary CTA plus an "Ask us" text link;
   - no logistics claims;
   - the clay touch is removed.
8. **Map:**
   - one static, self-hosted, brand-styled street raster rendered from the on-disk OSM extract (co-scenes-maps-ads `prep.py` map code), with OSM attribution;
   - client-side Mercator you-dot and crop/fit; zero location-dependent requests;
   - a user outside the image gets an edge arrow plus distance;
   - Directions are destination-only: Apple Maps on Apple UAs, Google elsewhere.
9. **Clutter cut:**
   - the 4 per-section inline order-link pairs are removed (CTAs: hero, select screen, sticky, shops, catering, footer);
   - random PlayfulTouch slots are removed;
   - OfferCode stays where attribution needs it.

## Chunks
| Chunk | Contents | Gate |
|---|---|---|
| **A** | Deletions (SUBDEX, IllustratedSpin, touches, inline pairs); hero zoom + type; chip term fix; no-tags test | CI |
| **B** | Spin frame pipeline; SpinCanvas; select screen (roster, P1, sheet, pause) | **Preview to Juan** |
| **C** | Crunch captions | |
| **D** | Field Guide lines + pickups | Can run in parallel with E |
| **E** | Static map + you-dot + Directions | Can run in parallel with D |
| **F** | Catering | |
| **G** | Weave pass + iPhone visual pass (WebKit 390×844 screenshots of every beat) | Preview → Juan |

## Top risks
1. Transfer/byte budgets vs spin and map bytes.
2. iOS 18 has no CSS scroll timelines, and CI never runs real iOS Safari.
3. The real→drawn hand-off rule.
4. Auto-advance vs iOS momentum scroll.
5. TBT from eager island hydration (use deferred dynamic import).
