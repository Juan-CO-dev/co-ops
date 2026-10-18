# SUBDEX — physical iPhone Safari release gate

Status: NOT RUN. Windows Playwright WebKit and iPhone emulation are not native iOS Safari evidence. No approved HTTPS preview or physical device was available in this dispatch. CC must record the following before release.

Record device model, iOS/Safari version, date, approved HTTPS URL, reviewed commit SHA, deployed SHA, language, consent state, Low Power Mode and Low Data Mode settings. Archive response headers, raw HTML, screenshots and playback measurements with those identifiers.

1. Verify deployed SHA equals the reviewed revision. Fetch raw HTML from that same host for en/es and consent unset/accepted/rejected. Confirm the SUBDEX server-rendered image is 720×720 and uses `/media/subdex-poster-drawn-4f35ab463487.webp`.
2. Fetch that exact URL on the preview host. Require HTTP 200, `image/webp`, 16,874 bytes and SHA256 `4f35ab4634873d62b3dcf2e1595c1fb10486796671790c40d1a06a0c72e8369d`. Record redirects and cache headers. On the phone require `naturalWidth === 720`, nonzero visible bounds and a nonblank screenshot after scrolling to SUBDEX. Diagnose wrong revision, host/URL failure, image decoding and video playback separately.
3. In normal power mode, scroll to SUBDEX. Confirm the still is visible before motion, then inline muted playback occurs once, without fullscreen takeover or looping. With no playback shim, record `readyState >= 2`, `videoWidth > 0` and two increasing currentTime/frame readings during the 0.9-second clip. Reload if the excerpt ends before measurements can be captured.
4. In Low Power Mode, verify the poster remains visible even if autoplay is blocked. Tap Play and confirm inline playback or a persistent usable Play control with the still. Confirm the control retains focus after retry; orders and language navigation work.
5. Enable Reduce Motion and then Low Data Mode separately. Confirm the still decodes and optional automatic video is not downloaded where Save-Data is exposed. iOS Low Data Mode's browser exposure must be recorded, not assumed from desktop simulation.
6. Exercise back/forward restoration, scroll before hydration on a slow connection, background/foreground, viewport exit/re-entry, keyboard/zoom and failed MP4/poster requests. No collapsed media region; failures retain the still or the bilingual accessible text fallback. A completed clip must not auto-replay on re-entry.
7. Verify no text, control or decorative touch covers real-food photos, no public classification labels appear, and direct ordering remains usable. Capture English and Spanish views at normal and enlarged text sizes.

Release also requires CC's independent review and authoritative Landing checks CI exit. Keep the CI job at 25 minutes; record actual duration, with <=22 minutes total and <=3 additional iPhone-project minutes as targets. Local timing is advisory, not a CI duration claim. `perf:launch` against the approved HTTPS revision remains separate from the offline first-party performance harness.

Policy reference: [WebKit's inline video and user-gesture policy](https://webkit.org/blog/6784/new-video-policies-for-ios/). Direct user-handler `play()` and `muted`/`playsInline` are implemented; device/OS behavior still needs the measurements above.
