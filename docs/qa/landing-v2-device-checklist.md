# Landing v3: physical iPhone Safari release gate

**Status: NOT RUN.** Playwright WebKit and iPhone emulation are not native iOS Safari evidence. Juan smoke-tests the preview on his own iPhone; CC records the results below before release.

## What to record
- Device model, iOS/Safari version, date
- Preview URL and the deployed SHA, which must equal the reviewed SHA
- Language
- Consent state
- Low Power Mode, Reduce Motion and Low Data Mode settings

## The checks
1. **Hero:**
   - The page opens on the still Crunchy Boi photo, with no movement before the first scroll.
   - Scrolling down pushes the camera in on the sub, smoothly, with no jump.
   - The order buttons are readable and tappable.
2. **"A little crunch?":**
   - The section pins while you scroll.
   - The caption above the photo changes from the iceberg line to the chips line as the second photo slides in.
   - "Keep it still" stops the motion.
   - Leave the section and come back: the motion still follows the scroll.
3. **Choose your fighter:**
   - The Crunchy Boi stage does one arrival spin.
   - It turns as you scroll and as you drag sideways, while vertical swipes still scroll the page.
   - The roster advances on its own about every 5 s. The Player 1 cursor hops between cards.
   - "Auto-scroll" pauses and resumes it, and any tap or drag inside the screen stops it.
   - Tapping a sub swaps the stage and the pixel guy cheers.
   - "Order {sub}" opens the shop sheet. Both links open the right Appfront shop. Closing the sheet returns focus.
4. **Field Guide:**
   - Words with pixel pickups sit above the cut-open photo.
   - On arrival one line at a time draws to its ingredient, fades, and the word turns "collected"; the counter reaches 6/6.
   - No word or line covers the food permanently.
5. **Catering ("Co-op mode"):**
   - The real spread photo shows with the box inset and the walking pixel guy.
   - Exactly one strong "Start a catering order" button, plus a light "Ask us" link.
6. **Pick your shop:**
   - A real DC street map shows both pins.
   - "Find my nearest shop" asks for location, drops your blue dot and zooms to fit you and the nearest shop.
   - The nearest card shows a big Directions button that opens Apple Maps. No coordinates appear in the URL.
   - Away from DC, you get the edge arrow and the "outside this map" note.
7. **Reduce Motion, then Low Power and Low Data Mode, each separately:**
   - No auto-advance, no spin frames loaded, and no hero push-in.
   - Every caption and every Field Guide line is shown statically.
   - Nothing is missing.
8. **Throughout:**
   - No "Illustrated", "AI", "Drawn" or "Edited" text anywhere.
   - The sticky order bar works.
   - en/es look right at normal and enlarged text sizes.
   - Back/forward and background/foreground restore cleanly.

## Release conditions
- CC's independent review.
- The authoritative Landing checks CI run (applied-throttling perf gate) on the exact pushed SHA.
- `perf:launch` against the approved HTTPS revision stays separate from the offline first-party harness.

_History: the v2 SUBDEX/video gate this file used to hold was retired with the SUBDEX section (Juan, 2026-10-19)._
