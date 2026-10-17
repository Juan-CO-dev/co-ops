# LANDING v2 — BUILD plan: A, Crunch in Motion

2026-10-16 · Plan only · Uncommitted · CC cross-family review pending.

Clone `C:/Users/conta/co-ops-landing`; branch `feat/landing-v2`.
This task changes only this document. The chunks below describe future implementation, not completed work. No production, environment, connected-database, deployment, commit, push or merge actions are authorized here. Migration 0273 remains FILE ONLY; CC owns its later review and application.

## Decision and confirmed ground truth

Juan selected **A as actually prototyped** in `tmp/v2-proto/a/index.html`: red `#ed3308`, giant cream DM Sans, mustard shop links, full-bleed real P013, then the native-scroll P016-to-L083 texture sequence. Preserve its separate food and copy rectangles. The original creative document's mustard hero and ingredient assembly are superseded by this selection. The prototype's ordering dialogs, permanently visible bar, English-only copy and 818,778-byte initial transfer are experiments to replace, not production behavior to carry over.

Read before drafting: `docs/landing-v2-creative-plan.md`, `docs/landing-v2-facts.md`, prototype A/README/three-provenance, `app/eat/page.tsx`, `app/eat/layout.tsx`, landing Hero/HeroMotion/DeferredMotion/SubdexMoment/OrderLink/TrackingProvider/Lineup/Shops/Footer/Catering, tenant config and assets, landing stores/config/media/products/attribution/tracking/counter/Meta/rate-limit modules, 0273, SQL harness, asset inventory validator, Playwright config, performance runner and CI workflow. Read local Next robots/sitemap guides; they warn that metadata routes cache by default. Visually inspected A's mobile hero/texture screenshots and the three candidate frames listed below. Apply real-food-law and confirm-before-authoring throughout the build.

| Verified discrepancy | Resolution in this plan |
|---|---|
| Old plan says retain 0273; SQL and TS hard-code two ad codes | Replace with bounded table-backed eligibility, including the browser/server path that currently discards new codes. |
| SUBDEX play rejection sets permanent failure; readiness can await an LCP entry forever | Bounded readiness, real gesture retry, decoded-frame reveal and permanent still. Root cause on Juan's phone remains unproven. |
| Project named WebKit uses Desktop Safari at phone dimensions | Add a real iPhone descriptor; retain distinct native-device decoding evidence. |
| Hours/coordinates null; footer empty; DB failure returns no shops | Tenant-owned verified public facts shared by visible content and JSON-LD, preserving optional DB projection without a DB write. |
| Canonical currently includes lang; proxy always disallows robots and emits empty sitemap | One production-host policy controls metadata, headers, robots and sitemap. |
| Asset validator only admits the pinned SUBDEX drawn recipe and reconstructs resize-only images | Explicit reviewed source recipes for new photos/touches; add crop reconstruction without weakening source identity, size or held-source checks. |
| Prototype A initial transfer 818,778 B; hero file alone 736,560 B | Responsive derivatives and request timing first. No transfer exemption for decorative assets. |

These are resolved by Juan's current brief; they do not require another creative selection. This plan must receive CC-arranged cross-family review before application code is written.

## Experience and contracts

Sequence: hero → crave/texture → ten-sub lineup → L083 Field Guide → SUBDEX → catering → shops/map → footer. Keep native scrolling and meaningful content without JavaScript. The crave sequence replaces the speculative ingredient assembly; no synthetic build stages or mismatched cut-out stack. Retain existing approved illustrated spin as an optional, labeled, user-played below-fold asset, separate from real food. Do not introduce new photoreal invented food.

Use tenant config for brand/shop/menu vocabulary and both `lib/i18n/en.json` and `lib/i18n/es.json` for every visible string and accessible label. Keep menu names unchanged between languages. Copy all ten complete ingredient lists from the creative plan, checked against the facts/glossary: Crunchy Boi, Farmers Market After Dark, Hot Pants, Never Been Cheddar, Our French Dip, Sicky Wicky Club, The Frex, The Teamster, Turkey Caesar Sub, Vesuvio II. Include the sub roll; glossary combines Vodka + Marinara as vodka sauce. Confirm “Balsamic Vin” wording against the supplied source before final copy approval. No invented allergy, portion or availability claims; Marisa remains excluded.

All order controls are native `OrderLink` anchors with the existing Appfront branch IDs and servingOptionType=a. No ordering modal. Catering keeps the verified Toast URL and `CateringClick`; inquiry keeps `Lead`. Events never delay navigation. Preserve consent, withdrawal, DNT/GPC, bounded query handling, vendor-footer semantics and approximate consented-click counter meaning.

### Sticky, inviting CTAs

- Observe the **hero button group**, not the hero image or a guessed scroll offset. Reveal the mobile bar only after that group has passed above the viewport; hide it when the group returns. Evaluate on mount, restored scroll, resize and bfcache restoration. Reserve its space; account for safe-area, keyboard, consent and 200% zoom.
- Keep both named shop links one tap away. Minimize collapses decoration/microcopy into a compact two-link rail, with a separate accessible Restore button. Persist minimization in sessionStorage through navigation/reload/language changes; denial of storage falls back to in-memory preference. Scrolling never expands it again. No tracking is attached to minimize/restore.
- Desktop has a compact persistent two-shop header rail after the hero links leave view. No-JS has native shop links at each section; do not make the basic page depend on observers.
- A decorative chip/prop lands **beside the button's border**, in a reserved accessory slot outside the clickable rectangle and label. The brief's “hops onto” is implemented as a visual association without covering the CTA. Touch devices use section dwell, never a long-press that prevents navigation. Hover/focus can invite a touch but does not fire an order event.
- Microcopy alternates on separate eligible appearances/intent, not an endless timer: “psst, lunch?” / “¿psst, almorzamos?” and “your shop's ready” / “tu tienda está lista”. The shop link name stays fixed. No live region for decorative copy. One gentle 120 ms press-scale; no shaking, urgency, countdown, pop-up, modal or auto-scroll.

| CTA location | Placement | Event |
|---|---|---|
| Hero two shops / secondary catering | `hero` | `OrderClick` / `CateringClick` |
| Mobile full/minimized bar, desktop persistent rail | new `sticky` | `OrderClick` |
| Texture sequence end | new `crave` | `OrderClick` |
| Lineup / Field Guide / shops / footer | existing `lineup`, `field-guide`, `shops`, `footer` | `OrderClick` |
| SUBDEX and optional illustrated spin decision area | new `subdex` | `OrderClick` |
| Catering / inquiry | existing `catering` | `CateringClick` / `Lead` |

Use `LANDING_PLACEMENTS` as the provider's shared list, replacing the duplicate literal in `app/eat/layout.tsx`. Pin every new spot in schema, tracker and browser tests. Keep section-view vocabulary distinct from CTA placement; include `crave` as a section without changing ViewContent into a server event.

### Playful touches system and inventory

Decorative slots are outside food, copy and CTA bounds at every breakpoint. `aria-hidden`, empty alt, pointer-events none; no layout shifts. At most one accent animates at once; at most one automatic touch per section per page lifetime. Intent replay is bounded to one additional play per slot, never by timer. Each runs ≤1.2 s including entrance and exit. No recurring guide; no character is used more than once on a page, and the selector also rejects consecutive identical character IDs. Props/checker/marks dominate the inventory.

Load the controller after paint and assets only near their section or on intent. Pause timers/RAF/video when offscreen or document-hidden; do not accumulate delayed plays. Reduced motion, save-data and no-JS show a small still or omit purely decorative detail. Do not fetch sprite/video motion under reduced motion. A static source animated with CSS is preferred over a sprite or new video decoder.

| ID / family | Source and inspection status | Derivation and use | Maximum duration / lazy allowance |
|---|---|---|---|
| T1 `checker-peek` | Existing black/white motif; new code-native geometry | CSS strip peeks once in hero margin after paint; never a scrolling marquee | 0.6 s / 0 image bytes |
| T2 `mark-nod` | `~/co-3d/logo-pack/vector/co-icon-flat.svg`; source identity/visual review required in chunk 6 | Reuse the actual mark, no redraw/invented logo; small rotation/translation in crave margin | 0.65 s / ≤30 KB |
| T3 `doodle-chip` | New code-native hand-drawn outline, explicitly illustrated | SVG ridges/outline with CSS hop in CTA accessory slot; still is the same drawing. No image model or photo input | 0.8 s / ≤5 KB |
| T4 `clay-bag` | `~/co-3d/kid-again/03-hero/alts/prop-clay-to-go-bag-blank-AI-DRAWN.png`; inspected: stylized bag, no food, visible AI tag at bottom | Crop away the tag outside the bag; retain classification in provenance. Resize/encode; frame as a small opaque tile unless a verified alpha source exists. Short tilt in lineup margin | 0.9 s / ≤35 KB |
| T5 `lowpoly-prop` | `~/co-3d/lowpoly-bank/pilgrim/rgba/pilgrim-idle-rgba-AI-DRAWN.png`; inspected: stylized empty-handed figure with staff, no food | Crop the isolated upper staff head, not a recurring pilgrim. Keep its background if needed; inspect crop for residual body. CSS quarter-turn near shops | 0.7 s / ≤25 KB |
| T6 `office-wave` | `~/co-3d/clay-bank/office-worker/office-worker-wave-rgba-AI-DRAWN.png`; inspected: empty-handed clay worker, no food | Crop/resize single pose; tiny slide/tilt in catering margin. Do not claim articulated animation or trust “rgba” to prove transparency | 1.0 s / ≤45 KB |
| T7 `clay-chip` reserve | No standalone inspected clay-chip source located | Search `clay-ideas` props during chunk 6. Admit only an inspected clearly stylized, non-photoreal source with provenance. T3 is the specified default; never substitute a photoreal generated chip | ≤1.0 s / within T3 replacement budget |
| T8 `meeting-prop` reserve | `~/co-3d/meeting-legends` and `~/co-3d/clay-ideas/refs/conference-plate-AI-DRAWN.png`; not visually approved | Candidate non-food office prop only. Inspect full source and final crop; reject food/held-food/unknown provenance. Alternative to T6, not an additional character slot | ≤1.0 s / within T6 replacement budget |

T1–T6 are the bounded first library, with T2 source review still required; T7/T8 are reserves, not certified assets or unbounded extra work. One static frame plus CSS animation means every contributing frame can be accounted for. For any proposed multi-frame replacement, inspect **every output frame**, record timecodes/contact sheet and classification, and re-run all coverage/byte checks. Rejected or unknown candidates never enter the public manifest. Do not use the `_rejects` directories. Existing SUBDEX remains its own illustrated moment, not the site's mascot.

## Asset derivation and provenance

Do not copy prototype lossless outputs into production. Original photos remain read-only. New real-photo outputs permit EXIF orientation, crop, uniform resize, metadata stripping and deterministic WebP encoding only; no AI, recolor, relight, synthesis, warp or food retouch. Cropping to fill a window must preserve aspect ratio rather than stretch food. Lossy encoding is a recorded delivery transform, not an excuse to alter the product.

| Asset | Exact source / custody | Planned outputs and timing |
|---|---|---|
| P013 hero | `~/co-chief-assets/picks-full/P013.jpg`, prior source SHA256 `52a07051eeb065785ada32af719604c113bfe4605ceabcd895dd70069de9fbde` | Widths 320, 480, 640, 960, 1280; correct sizes for mobile full width / desktop half width; eager high-priority image and matching responsive preload, one selected download. Each ≤100 KB; initial selected target ≤95 KB. |
| P016 texture | `~/co-chief-assets/picks-full/P016.jpg`, prior SHA256 `781031156a21799f1f16fc83f496d046056a23a72fae4eeae9b62d8df3da3eb2` | Widths 480, 720, 960; lazy near crave after paint, ≤100 KB each. |
| L083 cross-sections / Field Guide / catering | `~/co-chief-assets/picks-full/L083.jpg`, prior SHA256 `4960db2947693c5e450b4c9752c7d16cea772640ea1b387c62638273b8840b0c` | Widths 480, 720, 960; shared URLs across all three sections, ≤100 KB each. Fix crop before measuring label anchors; no duplicated downloads for catering. |
| Ten lineup photographs | Existing `config/tenant/landing-products.json` sources and `assets/provenance/lineup-*.json` | Reuse existing 480/full assets and verified source identity; lazy loading, complete ingredient text in HTML. French Dip keeps its existing real photograph. No new substitute required. |
| SUBDEX | Existing `subdex-poster` / `subdex-catch` sidecars: approved source cut 17.3–18.2 s, poster 17.5 s, square crop (0,780,1080,1080) | Reuse current hashed 720 WebP and 0.9 s H.264/yuv420p/faststart/no-audio MP4. Preserve always-mounted still, no re-encode unless decoder evidence requires it. |
| Illustrated spin | Existing `assets/provenance/hero-spin.json` and configured `crunchy-boi-spin` | Reuse existing hashed file only after explicit Play below fold; visible bilingual “Illustrated” description. Never replace P013 with the spin on initial paint. |
| T1–T6 | Sources above; T1/T3 authored SVG/CSS, T2 original mark, T4–T6 existing AI-DRAWN non-food frames | T2 SVG; T3 SVG; T4/T5/T6 WebP at maximum 256 px wide with no enlargement. Animate transforms in code, not generated frames. |
| Map | Supplied exact coordinates and OSM origin recorded in facts | Code-native schematic with readable addresses, two pins and OSM attribution; “schematic” label, not street-level navigation. Directions links use verified addresses. No initial tile/interactive-map request. |

Recompute all source hashes; prior hashes are reference values, not verification performed in this turn. Every new output gets source ID/path/hash, classification, crop box, dimensions, encoding parameters/tool version, output hash/bytes, derivation command, public path, inspection verdict and reviewer in its sidecar. Public runtime config contains only approved IDs/paths/dimensions, not local paths or review metadata. Preserve existing web “illustrated” labeling for drawn food. Do not place operational provenance stamps on public accents.

Generated file naming is exact by recipe: `public/media/v2-{p013|p016|l083}-{width}-{sha12}.webp`, `public/media/touch-{clay-bag|lowpoly-prop|office-wave}-{sha12}.webp`, `public/brand/touch-{mark-nod|doodle-chip}-{sha12}.svg`; matching sidecars `assets/provenance/v2-{source}-{width}.json` and `assets/provenance/touch-{id}.json`. `{sha12}` is computed from final bytes, never guessed in a plan. The finite widths and IDs above are the complete output set; reserves replace an entry only after review.

Extend `assets/source-manifest.json` with explicit photo-detail and decorative-source entries; do not add P013/P016/L083 as extra menu products or relax the ten-product identity checks. Extend `scripts/assets/inventory.mjs` with deterministic crop/resize and explicit decorative recipes while keeping the pinned SUBDEX rule intact. Verify source and output hashes and exact reconstruction. The existing ≤100 KB raster ceiling stays. Local contact sheets/evidence live under ignored `tmp/landing-v2/`; source libraries are not modified.

## Performance and verification protocol — applies to EVERY chunk

Each chunk has 1–3 tasks in red-test → implementation → verification order. Do not proceed to the next chunk until **`npm.cmd run perf:ci` passes** for the current tree. A blocked measurement is a blocked chunk, never a waiver. No changes to thresholds, run counts, consent behavior or Pixel-blocking scope.

The existing merge gate remains: median of five cold runs **per state**, UNSET and ACCEPTED with Pixel blocked only in the measurement harness; performance ≥0.85, accessibility ≥0.95, LCP <2.5 s, TBT ≤200 ms, CLS ≤0.1. First-party transfer ≤500,000 B **each run**, lazy media ≤5 MB after full scroll. Retain existing JS ≤200 KB and critical ≤250 KB checks. Preserve raw runs and state validation. Real-Pixel `perf:launch` on approved HTTPS remains a separate later release requirement.

Initial working allocation: HTML/CSS 65 KB, JS 180 KB, fonts 55 KB, selected hero 95 KB, other initial images 35 KB = 430 KB; leave 70 KB margin. Lazy working allocation: P016/L083 300 KB, lineup 850 KB, touches 250 KB including stills/controller overhead, optional spin 1.1 MB, SUBDEX 800 KB, other 500 KB = 3.8 MB. These are targets, not measurements or permissions to increase existing files. Touch/scroll controller combined target ≤8 KB compressed. No Three.js, canvas renderer, animation framework or live map runtime added.

Run serially where build/browser/performance harnesses share build output or ports:

```powershell
npm.cmd test -- tests/landing --maxWorkers=3
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run assets:check
npm.cmd run perf:ci
git diff --check
```

Asset chunks additionally run `npm.cmd run assets:check -- --sources`. Use targeted tests first to record the meaningful red failure, then the green landing suite. Host changes also run `npm.cmd test -- tests/security-headers.test.ts tests/sim-isolation.test.ts`. Final chunk runs full `npm.cmd test -- --maxWorkers=3`. Record failures without changing test timeouts to hide them. Optional offline LHCI must be the already supported pinned 0.15.1 CLI; never replace a missing package with a different measurement.

## Ordered implementation chunks

Paths in braces below are finite expansions, not permission for unrelated edits. “New” identifies files to create. Every chunk also updates the evidence in new `docs/landing-v2-build-results.md`; the unchanged verification protocol above is its exit gate.

### 1. Responsive asset foundation — 2 tasks

1. Tests first: add deterministic source/crop/output reconstruction, ≤100 KB raster, source-ID exclusion, wrong hash/held-source rejection and responsive recipe cases. Confirm A's 818,778 B baseline is recorded as a prototype measurement, not the current app's performance score.
2. Derive P013/P016/L083 and register their finite inventory; no page swap yet. Read back manifests and inspect final crops at mobile/desktop sizes. Run source checks and **perf:ci** against the unchanged page before advancing.

Exact files: new `scripts/assets/export-landing-v2.mjs`, new `tests/landing/v2-assets.test.ts`; edit `scripts/assets/inventory.mjs`, `tests/landing/assets.test.ts`, `assets/source-manifest.json`, `assets/approved-media.json`, `config/tenant/landing-assets.json`; add the 11 photo outputs and 11 sidecars specified above. No package or lockfile change is expected.

### 2. Verified facts and complete menu — 3 tasks

1. Tests first: pin all ten en/es ingredient lists, roll, no Marisa, supplied hours/phone/coordinates/footer URLs, no Facebook, DB-outage behavior and no private-field leakage. Test explicit inactive shops are not resurrected by a fallback; distinguish successful empty query from provider failure.
2. Add tenant-owned public facts and structured address/hours. Use the same public model for visible shops and later JSON-LD; on a provider outage use verified tenant fallback, on successful reads honor active membership and use verified fact overrides for supplied shops. Keep service-role projection restricted to `code,name,address,phone` and avoid new DB columns or writes.
3. Render ingredients, daily hours, telephone and directions links; add the schematic and official footer destinations including `careers`. No automatic geolocation; test opt-in denial and straight-line-distance label. Run full chunk gates including **perf:ci**.

Exact files: `config/tenant/landing.ts`, `config/tenant/landing-products.json`, `lib/landing/{products,stores}.ts`, `lib/i18n/{en,es}.json`, `components/landing/{Lineup,Shops,NearbyShop,Footer}.tsx`; new `components/landing/ShopMap.tsx`; tests `tests/landing/{products,stores,stores-failure,content,config,footer-tracking,nearby}.test.ts`, `tests/e2e/landing/{lineup,shops,languages}.spec.ts`.

Facts: MEP, 526 8th St SE Ste A, Washington DC 20003, +12026218645, daily 10:30–18:00, (38.8817492,-76.9947597); EM, 2029 P St NW Front 1, Washington DC 20036, +12027944638, daily 10:30–20:00, (38.9098292,-77.0462506). Preserve suite/Front 1. Capitol Hill directions share a building with Jeni's; verify the destination, not just a pin. Footer links come verbatim from the supplied facts; omit callback from careers URL.

### 3. A static visual foundation — 2 tasks

1. Tests first: both named hero shop links plus secondary catering visible at 375×667 and 375×812 with consent notice; both languages, 200% zoom, keyboard, no-JS, no overflow, visible decoded hero, one responsive hero download, staff UI unaffected. Screenshot review includes 1440×900.
2. Replace the rounded-card shell with A's red/full-bleed composition, oversized type and editorial sections. Wire P013 responsive preload/srcset/sizes together. Keep hero free of automatic video; move the existing illustrated spin below fold with an explicit Play control. Keep fallback content complete. Exit with **perf:ci** before adding motion.

Exact files: `app/eat/{page,layout}.tsx`; new `app/eat/landing-v2.css`; `components/landing/{Hero,Lineup,LineupPhoto,Catering,Footer}.tsx`; new `components/landing/IllustratedSpin.tsx`; `lib/landing/media.ts`, `lib/i18n/{en,es}.json`; tests `tests/landing/hero-poster.test.ts`, `tests/e2e/landing/{hero,hero-poster,shell,reflow,languages,accessibility}.spec.ts`.

### 4. Sticky order intent and placement contracts — 3 tasks

1. Tests first: button-group threshold in both scroll directions, restored scroll, minimization persistence/storage denial, consent stacking, focus retention, safe area, one click/one event, unchanged native destination, both shops accessible when minimized. Test hover/dwell/press emits no order event.
2. Implement mobile bar and desktop rail with shared state, fixed accessible shop names, bounded rotating microcopy and gentle press animation. Reserve accessory slots but do not load animated artwork yet.
3. Add `sticky`, `crave`, `subdex` to shared placement vocabulary/provider tests; wire all actual spots. Maintain vendor-only footer rules. Exit with **perf:ci**.

Exact files: new `components/landing/StickyOrderBar.tsx`, new `lib/landing/sticky-order-shared.ts`, new `tests/landing/sticky-order.test.ts`, new `tests/e2e/landing/sticky-order.spec.ts`; `app/eat/{page,layout}.tsx`, `app/eat/landing-v2.css`, `components/landing/{Hero,OrderLink,ConsentNotice}.tsx`, `lib/landing/tracking-schema-shared.ts`, `lib/i18n/{en,es}.json`; tests `tests/landing/{placements,meta-schema,tracking-client}.test.ts`, `tests/e2e/landing/{order-links,tracking,dedup}.spec.ts`.

### 5. Texture signature and L083 Field Guide — 3 tasks

1. Tests first: no early texture download, dimension reservation, native scroll/reverse/resize, offscreen/hidden teardown, still control, no-JS/reduced-motion complete content, no food/copy/CTA intersection. Field Guide text and ingredient list remain readable without motion.
2. Build a short scroll stage matching A: P016 moves horizontally to L083; copy remains in its own rectangle. Limit extra scroll travel to approximately 1.5 viewports; remove sticky runway for reduced motion/still/no-JS/short-screen layouts. CSS scroll timeline when available, one passive RAF update fallback only while active. No forced completion before ordering.
3. Add L083 anatomy labels outside the photo with normalized anchors measured on final crop. Point only to visible turkey, provolone, ridged chips, iceberg, pickles or bread. Garlic mayo/oil/onion may appear in ingredient text, never guessed image callouts. Reuse L083 in catering; end with explicit crave/Field Guide shop links. **perf:ci** must pass.

Exact files: new `components/landing/{CraveScene,FieldGuide}.tsx`, new `lib/landing/crave-motion-shared.ts`, new `tests/landing/crave-motion.test.ts`, new `tests/e2e/landing/crave-field-guide.spec.ts`; `app/eat/page.tsx`, `app/eat/landing-v2.css`, `components/landing/Catering.tsx`, `lib/landing/media.ts`, `lib/i18n/{en,es}.json`; tests `tests/e2e/landing/{motion,performance,remaining-sections}.spec.ts`.

### 6. Varied playful touches — 3 tasks

1. Tests first: ≤1.2 s duration; no repeated character; one section play plus bounded intent replay; no early requests; no pointer interception; reduced-motion still; offscreen/hidden pause; resize/zoom/Spanish coverage; source/hash/recipe rejection. Inventory tests must fail for uninspected sources or photoreal invented food.
2. Inspect T2 and re-check T4–T6 final crops; derive T2–T6 (T1 is CSS). Record every source/output and motion recipe. T3 is the illustrated chip fallback; do not hold the whole build for an unverified clay-chip source. Reserve candidates require the same inspection and replacement budget before admission.
3. Add one small lazy controller with deterministic slot assignments, shared one-animation arbitration, source dimensions and still mode. Slots: checker hero, mark crave, bag lineup, doodle Field Guide/CTA accessory, office worker catering, low-poly prop shops. If an intent touch competes with a section touch, finish/skip rather than overlap. **perf:ci** and full-scroll bytes pass before advancing.

Exact files: new `components/landing/PlayfulTouch.tsx`, new `lib/landing/playful-touches-shared.ts`, new `config/tenant/landing-touches.json`, new `scripts/assets/export-landing-touches.mjs`, new `tests/landing/playful-touches.test.ts`, new `tests/e2e/landing/playful-touches.spec.ts`; `app/eat/landing-v2.css`, `components/landing/{Hero,CraveScene,FieldGuide,Lineup,Catering,Shops,StickyOrderBar}.tsx`; `scripts/assets/inventory.mjs`, `assets/source-manifest.json`, `assets/approved-media.json`, `config/tenant/landing-assets.json`, `tests/landing/assets.test.ts`; the five T2–T6 outputs/sidecars defined above. Record T1's CSS recipe in new `assets/provenance/touch-checker-peek.json` without inventing a public image entry.

### 7. SUBDEX reliability and iPhone coverage — 3 tasks

1. Tests first: iPhone 13 mini descriptor (mobile/touch/DPR), en/es and consent unset/accepted/rejected. Require an attempted play before asserting rejection fallback. Simulate supported LCP with zero entries, unavailable observer, restored scroll/pre-hydration scroll, autoplay rejection then successful gesture retry, stall, 404 MP4/poster, hide/show, reduced motion/save-data, clean focus and navigation.
2. Introduce a bounded readiness path: first paint opportunity (two RAFs after hydration), then load/LCP signal or a ≤1.5 s fallback; mount near section with visibility/intent checks. Do not wait forever on load or LCP, and do not fetch optional motion before paint. Keep a server-rendered reserved poster in both deferred/active states. Retry must call play in the user gesture with a mounted, muted, playsInline video; clear recoverable policy failure. Reveal only after decoded progress (`requestVideoFrameCallback` or readyState/videoWidth/time progression). Keep the eight-second stall recovery and user controls. Play SUBDEX once; no endless loop. Poster stays visible on every failure; a failed poster gets a stable accessible fallback, never a blank collapsed section.
3. Run Chromium + existing WebKit + new iPhone WebKit. Native decoder evidence must assert readyState≥2, videoWidth>0 and advancing time/frames without a play shim. Windows codec failure is explicitly unresolved, not a decoder pass. Record a physical iPhone Safari checklist for normal/Low Power modes on later approved HTTPS (device/OS/revision/date/consent); no device claim from emulation. Exit local chunk with **perf:ci** and record the separate device release gate.

Exact files: `components/landing/{SubdexMoment,DeferredMotion,HeroMotion,IllustratedSpin}.tsx`, `lib/landing/media-policy-shared.ts`, `lib/i18n/{en,es}.json`, `playwright.config.ts`; new `lib/landing/media-readiness-shared.ts`, new `tests/landing/media-readiness.test.ts`, new `tests/e2e/landing/iphone-subdex.spec.ts`, new `docs/qa/landing-v2-device-checklist.md`; tests `tests/landing/media-policy.test.ts`, `tests/e2e/landing/{remaining-sections,motion,video-proof}.spec.ts`. Reuse existing SUBDEX outputs; no media edit planned.

### 8. Production indexing and shop structured data — 3 tasks

1. Tests first: production, preview, unlisted, staff, missing/malformed configuration and disagreeing forwarded-host fixtures. Verify raw response headers and rendered metadata together, robots/sitemap bodies, query-free canonical, XSS escaping and alternating-host cache isolation.
2. Add a pure indexing policy: production deployment identity **and** approved landing request whose Host authority matches configured SITE_ORIGIN; preview deployment is never indexable even if misconfigured with that origin. Use existing server deployment context (`VERCEL_ENV`, injected fixtures in tests), not NODE_ENV alone or a client header. Forward only a proxy-derived decision after stripping incoming internal hints. Production public `/` and `/privacy` get clean canonicals, no noindex headers/meta, allow robots and a sitemap of those two clean URLs. Previews get noindex/nofollow, Disallow:/ and empty sitemap. Keep current proxy-owned endpoints instead of adding duplicate root metadata routes. Preserve staff routing/headers and no-store HTML isolation.
3. Server-render escaped JSON-LD `@graph` with two `Restaurant` nodes, IDs `SITE_ORIGIN/#capitol-hill` and `/#dupont`, name, image, public section URL, exact PostalAddress, geo, international telephone, seven-day hours, shop menu link. Escape `<` as `\u003c`; never serialize DB records wholesale. Schema and visible facts must agree; no ratings/prices invented. **perf:ci** plus host/security tests pass.

Exact files: new `lib/landing/indexing-shared.ts`, new `lib/landing/structured-data-shared.ts`, new `components/landing/ShopStructuredData.tsx`, new `tests/landing/{indexing,structured-data}.test.ts`, new `tests/e2e/landing/indexing.spec.ts`; `proxy.ts`, `lib/landing/config.ts`, `app/eat/{layout,page}.tsx`; tests `tests/landing/{metadata,host-matrix,staff-routing,cache-inventory}.test.ts`, `tests/e2e/landing/{host-isolation,cache}.spec.ts`. Inspect inherited root metadata during implementation; no global staff SEO policy change.

### 9. Revise FILE-ONLY 0273 and registry-backed attribution — 3 tasks

1. Tests first: extend isolated PGlite harness and route tests for new active code beyond today's seeds, 12 family codes plus campaign/email-send codes, unknown/inactive fallback, syntax/length bound, full registry, concurrent slot claim, reserved fallback, ACLs and aggregate monotonicity. Adapt old blanket “no GRANT INSERT/UPDATE anywhere” test to target the counter table specifically; registry management is intentionally separate.
2. Revise 0273 per the SQL contract below, retaining NOT APPLIED header and provenance. Test using ephemeral in-process PGlite only, not a connected database or migration apply. PGlite serializes one connection; mark true independent-session contention evidence as CC's later gate.
3. Replace static ad eligibility across capture/server parsing with the registry contract below; preserve native navigation and dormant flags. Mock registry outage/pre-migration state. Run `node --experimental-strip-types scripts/landing/order-click-sql-check.ts`, landing/browser tests and **perf:ci**. No environment activation.

Exact files: `supabase/migrations/0273_landing_order_click_counts.sql`, `scripts/landing/order-click-sql-check.ts`; new `lib/landing/ad-codes-server.ts`, new `lib/landing/ad-codes-shared.ts`, new `tests/landing/ad-codes.test.ts`; `lib/landing/{config,attribution-shared,tracking-schema-shared,tracking-client,order-click-shared,order-click-server,meta-server}.ts`, `config/tenant/landing.ts`, `app/eat/{layout,page}.tsx`, `components/landing/{TrackingProvider,LanguageToggle}.tsx`; tests `tests/landing/{order-click-migration,order-click,attribution,meta-schema,meta-route,tracking-client,language}.test.ts`, `tests/e2e/landing/{tracking,dedup,order-links}.spec.ts`.

**SQL contract:**

- New `landing_ad_codes`: `code text PRIMARY KEY`, `slot smallint NOT NULL UNIQUE CHECK (slot BETWEEN 1 AND 1024)`, `active boolean NOT NULL DEFAULT true`. Lowercase opaque code syntax `[a-z0-9][a-z0-9_-]{0,63}`; no email address, recipient ID or customer identity. Per-email means a registered send/campaign code, never an individual's address. Seed slots 1/2 with `unattributed`/`subsim-photo`; keep `unattributed` active by CHECK. This is a lifetime bound including retired codes, not a count of active rows that permits unbounded churn. Raising it requires a reviewed migration.
- Service-role managed: deny-all RLS, revoke all public/anon/authenticated privileges; service role SELECT + INSERT and column UPDATE(active) only on the registry. No DELETE, TRUNCATE, REFERENCES, TRIGGER, code or slot UPDATE. Finite unique slots enforce capacity under concurrency without a racy COUNT trigger. Administrative inserts choose an unused slot; collisions are explicit errors. No public registry-write endpoint is added.
- Counter `ad_code` references registry `code` with no cascade; remove the literal ad-code CHECK. Keep `(day_utc,store_key,ad_code)` primary key, two-store validation, positive bigint counts, UTC server time and atomic `ON CONFLICT ... + 1`.
- `increment_landing_order_click` keeps SECURITY DEFINER and `SET search_path = pg_catalog, public`; qualify tables. Resolve an active registered code inside the function, otherwise use `unattributed`. Retain rejection of null/overlength inputs; empty/malformed bounded strings normalize to fallback. Lock the matched registry row sufficiently to serialize an active-code decision against retirement. Never insert a registry code from request data.
- Preserve the **privilege ceiling** on counts: service role SELECT only plus EXECUTE on increment; no direct INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER. PUBLIC/anon/authenticated cannot execute the definer. Bigint overflow must fail atomically, never reset/wrap/decrement. Current SQL has no special numeric saturation threshold; do not misreport one as existing posture.
- Bound is at most 1,024 ad dimensions × 2 stores = 2,048 aggregate rows per UTC day. Unknown-code floods add only existing fallback rows. No event/customer/session IDs or request payloads in either table. Historical retired-code aggregates stay intact.

**Application contract:** server-only bounded resolver queries active registry eligibility with a short timeout and request-scoped reuse. Do not serialize 1,024 codes into initial HTML. The page can resolve its bounded searchParams for offer/language links; a layout does not receive searchParams. TrackingProvider therefore resolves its query or restored session candidate through a bounded same-origin lookup **after marketing consent is allowed and before initializing Pixel**. Until then, navigation works and attribution is fallback; never persist an unresolved query. Recheck consent after the async lookup to prevent a withdrawal race. Give the client only the accepted code plus fallback. Implement that lookup in new `app/api/landing/ad-code/route.ts` using the existing consent-enforcing `guardLandingRequest`, 512-byte POST body, at most one candidate and no registry-list response; add its exact path to `lib/landing/host-shared.ts` and tests `tests/landing/{ad-codes,host-matrix}.test.ts`. These three paths are additional exact chunk-9 files. No endpoint writes the registry. If the lookup is unavailable, degrade attribution to `unattributed`, never block navigation or load Pixel with unsanitized query data. Do not fall back to an old static list that can resurrect retired codes. Before 0273 is applied, missing table means fallback attribution and counter flag remains off.

Counter parsing validates bounded syntax and passes the candidate to the RPC, whose table check is authoritative; CAPI revalidates independently through the same resolver. Extend parser signatures with injected policy rather than a second hard-coded vocabulary. Keep the existing offer-code policy separate: registering an ad never creates a discount. New registry codes require no application rebuild. Reuse `lib/landing/request-server.ts` unchanged: its guard already enforces host/origin, POST, consent and DNT/GPC without a path-specific list. Preserve no-store and fixed error responses; never reflect provider errors.

### 10. Meta/WAF readiness and final review packet — 3 tasks

1. Tests first: shared event name/ID between Pixel and CAPI for OrderClick/CateringClick/Lead at every placement, distinct rapid clicks, blocked/slow SDK, navigation races, withdrawal/DNT/GPC, absent match cookies, dormant/unverified/refused/unavailable WAF states, host/origin/content type/size limits and forged headers. PageView/ViewContent remain browser-only. No automatic retry queue added; any future retry must reuse original ID/time and recheck consent.
2. Write the operator-ready WAF/Meta checklist below and replace old pixel-only release permission with BOTH required. Token acquisition waits for Pete's session; no secrets/env files read or written. Keep CAPI's UA disclosure approval, genuine fbc/fbp matching requirement, no IP collection, two-second timeout, fixed errors and production test-code refusal. Missing matching identifiers can legitimately suppress an individual CAPI event; do not promise every click delivers twice.
3. Run full unit/type/build/browser/asset suite and **perf:ci**, inspect final mobile/desktop en/es renders, review the diff with CC and the required cross-family seats before any later merge. Record chunk results, device gates, remaining source reviews and performance evidence. Stop at uncommitted reviewed handoff; release actions remain external.

Exact files: `docs/release-checklist.md`, `docs/deploy.md`, `docs/landing-release-packet.md`; new `docs/landing-v2-meta-waf-readiness.md`; tests `tests/landing/{tracking-client,meta-route,meta-schema,rate-limit}.test.ts`, `tests/e2e/landing/{dedup,tracking,cookies,performance}.spec.ts`; `docs/landing-v2-build-results.md`, `docs/qa/landing-v2-device-checklist.md`. If red tests expose tracking implementation defects, amend the reviewed file list with the implicated `lib/landing` module before fixing; do not rewrite the working transport speculatively.

**WAF plan for CC/Pete's later activation:** match approved landing hosts and POST `/api/landing/events`; cover `/api/landing/order-click` and the bounded `/api/landing/ad-code` lookup with separate route rules. Propose an initial test envelope of 30 requests/minute/source with burst 10 for events, 60/minute/source with burst 15 for counter, and 20/minute/source with burst 5 for lookup; host/route aggregate ceilings 600/1,200/400 per minute respectively. These are review/load-test starting values, not claims of deployed rules or provider entitlement. Use edge-derived source identity, never trusted client-supplied IP headers; do not store it in application data. Verify cross-instance enforcement, shared-NAT legitimate traffic, distributed spray, sustained bursts, 429 response and recovery. Adjust from measured traffic and entitlement before approval; record final numbers, rule IDs, test revision/date and owner. If distributed enforcement is unavailable, CAPI readiness is blocked, not replaced with process-local counters.

Only a later authorized operator may attest `LANDING_WAF_STATE`, rule IDs and verified date, approve UA disclosure, supply matching Pixel/dataset IDs and server-only `META_CAPI_ACCESS_TOKEN`, and enable CAPI/counter after their independent gates. Verify Meta Test Events dedup by matching event_name + event_id, correct custom conversion, token permissions and domain. Never include token or private identifiers in the packet. No production META_TEST_EVENT_CODE. Real-Pixel five-cold-run `perf:launch`, actual iPhone/Android/VoiceOver, merchant destination checks, public HTTPS indexability, monitor failure/recovery/stale-heartbeat and rollback ownership remain release evidence owned by CC/Pete/Juan. Indexable does not mean already indexed; no Search Console submission in this build.

## Plan-turn verification and remaining risks

Executed on the existing tree; no implementation or migration was changed:

- `npm.cmd test -- tests/landing --maxWorkers=3`: 295 passed, 1 failed; `performance-blocking.test.ts` repository scan exceeded its existing 30,000 ms timeout.
- `npm.cmd test -- tests/landing --maxWorkers=1`: **36 files / 296 tests passed**, 13.87 s; no timeout/config change.
- `npm.cmd run perf:ci`: **BLOCKED / exit 1**, npm EACCES fetching pinned `@lhci/cli` from registry.npmjs.org. Both consent states have no completed runs; failures include `five-cold-runs-required`. Evidence: `tmp/landing-performance/2026-10-17T01-16-55.345Z-merge-2b6a5ec7/`. No Lighthouse score or pass claimed. This is a prerequisite to completing chunk 1, not grounds to weaken the gate.
- Visual inspection: A mobile hero/texture; T4 bag, T5 low-poly source and T6 office worker. Final derived frames, T2 mark and reserve candidates still require inspection during build.
- Read-back and `git diff --check` passed; status contains only this new untracked plan and the two pre-existing untracked creative/facts documents. No tracked application diff.

Open risks: responsive P013 fidelity under the current image ceiling; short-screen Spanish/consent geometry; physical iPhone decoding; registry introduction before SQL activation; production/preview host cache isolation; source eligibility for accents; actual WAF entitlement/dedup proof and Pete's pending token session. CC must arrange cross-family review of this plan before coding. The original creative plan/facts and ignored prototypes are preserved.

## Result

Uncommitted deliverable: `docs/landing-v2-BUILD.md`. Ten chunks: responsive assets; verified facts/menu; static A; sticky CTAs; texture/Field Guide; playful touches; SUBDEX/iPhone; indexing/JSON-LD; file-only counter registry; Meta/WAF/final verification. Each requires tests first and a passing unchanged `perf:ci` before advancing.

Touches inventory: checker peek, authentic mark nod, illustrated chip doodle, clay bag, low-poly staff prop, one office-worker cameo; inspected clay-chip/meeting props may replace entries later. No recurring mascot. Branch/worktree: `feat/landing-v2` at `C:/Users/conta/co-ops-landing`.
