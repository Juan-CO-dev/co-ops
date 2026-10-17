# CO-OPS landing v2 — creative plan

2026-10-16 · PLAN + THROWAWAY PROTOTYPE ONLY · CC review pending.
Branch `feat/landing-v2`, base `f59a489a0545ca6e137f9a076ede0de41846f977`, clone `C:/Users/conta/co-ops-landing`. The branch already existed at the requested base; local main points elsewhere and was not reset. Leave all work uncommitted.

## Recommendation

**A — Crunch, in Motion.** A bold food poster that becomes a short scroll performance: real Crunchy Boi photography, huge DM Sans headlines, chips orbiting in the margins, then a direct shop choice. Recommend this: it makes the product the spectacle and is achievable without a video decoder or a 3D runtime.

**B — The Clay Deli.** A miniature handmade deli opens around a real Crunchy Boi: clay explorer, paper scenery, checker stage and oversized real food. The visitor moves through small theatrical scenes rather than a food assembly.

Both remove the dashboard language: no repeated rounded cards, uniform hairline dividers, status badges or admin-panel grids. Keep mustard #FFE560, mayo #FFF9E4, ink #141414 and sparing red #FF3A44 for ordering; retain the existing wordmark and DM Sans. Use full-width compositions, deliberate empty space and a clear typographic hierarchy. Text never overlays real food. One attention cue at a time; every scene ends at an ordering opportunity.

## Scope and confirmed references

This task writes only this document and local scratch under `tmp/v2-proto/`. No application, config, migration, environment or deployment changes. The small disposable prototype is a visual experiment, not the production implementation subject to the later cross-family plan/build review.

Read before authoring: `docs/landing-v2-facts.md`; `app/eat/{page,layout}.tsx`; `components/landing/{SubdexMoment,DeferredMotion,HeroMotion,OrderLink,TrackingProvider}.tsx`; `lib/landing/{media,media-policy-shared,config,stores,tracking-client,meta-server,rate-limit,order-click-server}.ts`; `proxy.ts`; tenant landing config/products/assets; release checklist/deploy/release packet; browser media tests; SUBDEX exporter and export tests; 0273; local Next metadata robots/sitemap guides; asset sidecars. The local real-food-law and confirm-before-authoring skills were read. No live database or env files were read.

| Check | Reality / disposition |
|---|---|
| Base | Requested commit is HEAD on requested branch; keep it. |
| Facts | CC's verified file exists, untracked on arrival; preserve it. Hours/coordinates still null and footer links empty in application config. |
| Field Guide | v1 has text/FAQ, no anatomy image. L083 now supplied and visually inspected. |
| Food | User's task-specific rule is stricter than the skill's broader edited-food allowance. No generated sandwiches/ingredients or AI food editing for v2. Existing approved renders/spins and clearly stylized clay props are permitted by the brief; keep their original provenance classifications. |
| Ingredient parts | `cb-built` is an open, completed sub photo, not a closed hero. Separate cut-outs have differing bounds/perspectives; filenames do not prove stack registration. |
| SUBDEX | Still exists independently of motion and consent. No proven on-device root cause yet; diagnosis below distinguishes facts from hypotheses. |
| Meta | Existing checklist permits pixel-only launch; Juan now requires BOTH. Supersede that option in the future release-doc change. |

## A — Crunch, in Motion

**Idea:** The scroll builds appetite, then hands you a shop button.

**Hero moment:** A huge “MEET YOUR / CRUNCH.” headline, a real Crunchy Boi cut-out framed by mustard, and two red order links. Food and type occupy separate rectangles, not overlapping layers. Desktop: editorial split with oversized product; phone: compact title, shop links, secondary catering, then food. At 375×667 as well as 375×812 the two shop choices must be visible without scrolling, including with the consent notice. No intro, spinner or animation gate. Start from `cb-hero-014` / existing approved hero poster; compare P013 before substituting it. Existing spin is optional below the fold and competes for the same media budget.

| Scroll section | Composition, exact assets and appearance/disappearance | Conversion purpose |
|---|---|---|
| Hero | Static photo/H1 first paint. After first paint, one small checker accent slides in behind the composition. No hero image fade-in. | “Order Capitol Hill” / “Order Dupont”; “Catering” immediately secondary. |
| Crave / build | A single short sticky stage, roughly 1.5 viewport scroll distances. Open roll (`cb-bread-open`) enters; registered real turkey/cheese/pickle/lettuce parts may settle in verified kitchen order; 4–6 `cb-chip-01..06` cut-outs pop through empty margins; finish on `cb-built` or an approved finished hero. Prototype demonstrates bread→built reveal and chip arcs only. | Reveal resolves beside the persistent shop choices; no forced completion to order. |
| Lineup | Crunchy Boi leads an asymmetric editorial index, then the other nine. One image slides 24px into place as its menu name enters; previous images do not disappear until offscreen. Mobile vertical list with optional native horizontal gallery, no scroll hijack. Real cut-outs; use existing approved real image for Our French Dip because no French Dip cut-out was found in the listed library. Exclude Marisa. | Ingredients visible without hover; direct ordering after selection. |
| Field Guide | L083 large and still on mayo. Numbered labels live in a separate gutter; markers stop at the silhouette edge. Desktop labels reveal once; mobile numbered list below image. No extrapolated invisible layers. | Proof of what is in the Crunchy Boi; repeat two shop links. |
| SUBDEX | A deliberate ink interlude with existing approved pixel-character poster and optional 0.9s excerpt. Do not enlarge a tiny motion loop into a mandatory full-screen delay. Frame the graphic separately from real food; inspect the excerpt for prohibited generated food before reuse. | A brief brand reward with order links outside the visual. |
| Catering | Oversized “FEED YOUR PEOPLE.” / “DALES DE COMER A LOS TUYOS.” beside real L083 rounds, reused rather than another media download. No invented tray/package portions. | Primary catering link to verified Toast destination; inquiry secondary. |
| Shops / hours / map | Two generous editorial address blocks, readable daily hours and phone links. Lightweight schematic with two exact coordinates, not an invented navigational map; directions links by address. Optional actual map only on explicit interaction. | Shop-specific order link at each address. |
| Footer | Wordmark, verified destinations, privacy and language links, last two shop links. Checker strip ends the page. | No dead social icons or distracting animation. |

**Motion system:** Keep scrolling native. CSS scroll timelines where supported; a passive scroll listener schedules at most one requestAnimationFrame update as fallback, with geometry cached on resize and work limited to the active section. Transform/opacity only; uniform food scale, no morph, liquify, lighting filters or generated in-between food. Behind-food graphics may move freely; chip paths stay outside the sandwich silhouette so no fly-over exception is needed. No perpetual orbit. Scroll reverses the short sequence. Below-fold media loads near visibility after first paint; reserve all dimensions. Reduced motion, save-data and no JS show the finished still and all copy; no long empty sticky runway. Stop work when the document is hidden. A pause/still control is available for any continuing animation.

**Byte plan (targets, not measured results):** initial first-party ≤430,000 bytes, including HTML/CSS/framework JS/fonts and ≤95KB responsive hero; reserve 70KB against the 500,000-byte gate. Suggested split: HTML/CSS 65KB, initial JS 180KB, fonts 55KB, hero 95KB, other initial images 35KB. Lazy media combined ≤4.2MB: build parts 650KB, lineup 850KB, L083 220KB, hero spin 1.1MB, SUBDEX 800KB, map/catering/other 580KB. These are allocations, not entitlements; count actual browser transfers, deduplicate reused URLs, and drop motion before sacrificing the poster. Build enhancement JS ≤8KB compressed, loaded after paint. No WebGL or canvas needed.

**Risks:** differing cut-out cameras can make a false build; only align verified parts without distorting proportions, otherwise use authentic photographic stages. Overlarge typography can push CTA below fold in Spanish or at zoom; test geometry, not screenshots alone. Too much pinning delays ordering; cap it and provide skip. Large alpha PNG masters are several MB each; derive responsive assets with provenance before shipping. Ordinary uniform resizing/encoding is permitted; no AI touches these photos.

## B — The Clay Deli

**Idea:** The world's smallest deli presents a very real lunch.

**Hero moment:** A real Crunchy Boi on a checker tabletop, framed by a static miniature proscenium. Large “BIG LUNCH ENERGY.” / “UN ALMUERZO A LO GRANDE.” A clay explorer peeks from outside the food area only after paint. Start with an immediate photo and real order links; the set is decoration, not a loading screen.

| Scroll section | Composition, assets and appearances | Conversion purpose |
|---|---|---|
| Hero | `cb-hero-014` or approved hero poster foreground; non-food props from `~/co-3d/logo-pack`, `lowpoly-bank`, and `clay-bank/explorer`. Flatten approved set into small transparent still layers. | Same above-fold shop choices and secondary catering. |
| Crave / build | Scroll lifts two paper shutters to reveal a real photo stage; explorer walks along an empty side rail and points toward the shop links. An authentic before/finished photo pair replaces ingredient stacking. Candidate character source `~/co-3d/explorer/01-character`, not an uninspected AI food frame. | Reveal directs gaze toward ordering. |
| Lineup | A deli display window: real cut-outs rest in separate bays; move through with native scrolling and keyboard buttons. Clay props remain outside the bays. Crunchy Boi has the biggest bay. | Visible names/ingredients plus shop choices, no hover requirement. |
| Field Guide | A paper field notebook opens around L083. Tabs slide from the page edge; labels remain in margins. Notebook is CSS/illustration, food is the supplied photograph. | Product clarity and confidence. |
| SUBDEX | The miniature deli has an arcade: approved pixel-character poster inside a CSS cabinet. Tap to play/retry is always available; the cabinet never conceals failure. | Playfulness takes one short beat, then a shop CTA. |
| Catering | Clay office-worker/catering-presenter from `clay-bank`, with a real L083 composition in a separate photo window. Source candidates include `meeting-legends` and `kid-again`; inspect and select non-food character frames before derivation. | “Feed the meeting” with verified catering destination. |
| Shops / hours / map | Two paper storefront placards with real addresses, exact pins and readable hours. Character walks off before the decision area. | Two concrete destinations, one click to order. |
| Footer | Stage closes around the wordmark only after all links; reduced-motion version remains open. | Last order opportunity stays visible. |

**Motion system:** Scene cuts and 120–240ms prop movements via IntersectionObserver, not continuous product choreography. CSS perspective on scenery only, never perspective distortion of real food. No runtime 3D model; rasterized 2.5D set layers and at most one small character sprite sequence. All still compositions are complete. Reduced-motion/no-JS has no shutters covering content. No audio. Pause and offscreen teardown for sprites.

**Byte plan:** same ≤430KB initial target, with ≤30KB static scenery taken out of the hero/other allocation rather than added. Lazy media ≤4.4MB: character/set sprite assets 900KB, real lineup 850KB, L083 220KB, SUBDEX 800KB, hero spin 1.1MB, other 530KB. No GLB/Three.js, shaders, canvas or particle runtime. Character assets remain planning candidates, not certified ready-to-use outputs.

**Risks:** clay may win attention over the food or look like a game portal; keep a real sandwich dominant and ordering unmistakable. Asset preparation/provenance cost is higher. Set animations can occlude content when interrupted; decorative layers must never own content visibility. Existing AI-DRAWN files are concepts, not food photographs. Never recycle a character frame containing an invented photoreal sandwich; use approved clearly stylized clay props only as props.

## Conversion and accessible layout shared by both

At 375px, stack a ≤52px header, compact H1/body and two ≥44px shop links before media. Test short 667px and 812px heights, Spanish expansion, 200% zoom, safe-area insets and consent notice simultaneously. Sticky mobile order bar holds both named shops; reserve its height in document flow and place consent above it without covering either CTA. Keyboard order follows the document, with visible focus and no focus-moving reveals. Catering stays secondary in the hero and becomes primary in its section. Decorative food parts have empty alt; the assembled image has one meaningful bilingual description. No autoplay sound, forced scroll, fake urgency or unverified claims.

Keep `OrderLink`, native href navigation, `OrderClick` and `CateringClick`, consent/DNT/GPC behavior, query sanitization and existing stores. Proposed sticky placement needs coordinated addition to `LANDING_PLACEMENTS`, provider allowedPlacements, schema and tests; do not silently label sticky clicks as hero. The build/crave CTA can reuse `field-guide` only if actually inside that section; otherwise add an explicit `crave` placement. New section keys must remain compatible with SectionView. Counter remains approximate consented order clicks, never completed purchases. Measure order-click rate by shop/placement/ad and catering clicks; do not claim conversion uplift without comparable traffic.

## Carry-forward fixes

### SUBDEX: diagnosis and test that should catch the failure

**Likely explanation for missing motion:** the shared lazy motion path refuses or never starts playback on the phone, then offers no retry. `HeroMotion.tsx` permanently sets `failed` on any rejected play promise; the play button is only rendered after playback starts or pauses. iOS playback policy/power conditions therefore leave only a still. This is a working hypothesis, not a reproduced diagnosis of Juan's device. H.264 itself is not the obvious encoding error: exporter pins opaque H.264, yuv420p, no audio and faststart; video has muted + playsInline. [WebKit's playback policy](https://webkit.org/blog/6784/new-video-policies-for-ios/) explains why rejected playback must remain a supported path.

**A second concrete code risk:** `DeferredMotion` mounts the motion module after scroll. `HeroMotion` uses buffered LCP entries if support is advertised and only uses window load when LCP is unsupported. A browser advertising LCP but delivering no entries can hold `lcpReady=false` forever. Its 8-second playback watchdog only starts after attachment, so it does not recover this gate. Test this explicitly; it is not proof that Juan's Safari did so.

**What does not explain a completely missing still:** `SubdexMoment.tsx` server-renders a 720×720 lazy WebP inside both deferred and active wrappers. It does not consume tracking consent. Reduced motion/save-data intentionally retain the still. IntersectionObserver uses threshold 0.1 but actually gates on `isIntersecting`; a normal square should intersect on iPhone, so this is not evidence of an impossible threshold. Complete invisibility needs investigation of the deployed revision, poster response/decoding, viewport screenshot and media URL/host behavior. Do not report autoplay as a proven explanation for a blank image.

**Fix plan:** keep a reserved, recognizable still always present; preload the below-fold poster only near the section, independent of animation/consent. Replace exclusive LCP readiness with a bounded after-paint/document-load readiness path that cannot attach before the hero gets its first paint. Make scroll activation resilient to restored scroll/hydration and add near-section activation. Add a user-gesture Play/Retry button on autoplay rejection; distinguish recoverable policy failure from decode failure. Reveal video only after a decoded frame/progress, not merely an event; retain poster on every error. Keep mute/playsinline, viewport/document pause, watchdog and real controls. For reduced-motion/save-data, use the designed still without unsolicited video.

**Missing regression:** current `playwright.config.ts` calls the project WebKit but spreads `Desktop Safari` at 375×812, not an iPhone device profile. `remaining-sections.spec.ts` checks posters/rejected play; non-Darwin motion tests replace play() and suppress media errors. The rejection test can pass with no playback attempt because video absence is already true. Those tests cannot certify actual iOS decoding or a genuine catch animation.

Add Playwright WebKit with an iPhone descriptor (including mobile/touch/device scale), both languages and consent unset/accepted/rejected. Physically scroll through the page: assert the poster is decoded (`naturalWidth>0`), has nonzero visible bounds and a nonblank screenshot; require a recorded play attempt before asserting rejected-play fallback. Test zero LCP callbacks, scroll before hydration, restored scroll, blocked/404 poster or MP4, reduced motion/save-data, document hide/show, and CTA focus. Native-decoder run must assert readyState≥2, videoWidth>0 and advancing currentTime/decoded frames; no media adapter counts as a decoder pass. Run actual iPhone Safari on the reviewed HTTPS revision in normal and Low Power modes; record device/OS/date. Windows WebKit is useful for geometry/fallback, not proof of H.264 support.

### Facts, map and footer

Use CC's `docs/landing-v2-facts.md` (official site and OSM evidence as of 2026-10-16); these are supplied verified facts, not a new live-store audit.

| Shop | Address / phone | Daily hours | Exact coordinates |
|---|---|---|---|
| Capitol Hill / MEP | 526 8th St SE Ste A, Washington, DC 20003 · (202) 621-8645 | 10:30am–6pm / Todos los días, 10:30 a. m.–6 p. m. | 38.8817492, -76.9947597 |
| P Street / Dupont / EM | 2029 P St NW Front 1, Washington, DC 20036 · (202) 794-4638 | 10:30am–8pm / Todos los días, 10:30 a. m.–8 p. m. | 38.9098292, -77.0462506 |

Capitol Hill shares a building with Jeni's: pin the supplied coordinates and pair with the exact suite/address; inspect directions endpoint rather than assuming the first building result is the entrance. Use text/directions links before an interactive map; maintain OSM attribution if using OSM data/tiles. No geolocation prompt on load. Valid coordinates enable the existing opt-in nearby-shop path; test denial and straight-line-distance labeling.

Keep the configured Appfront order links/branch IDs and servingOptionType=a unchanged until the merchant flow is verified. Catering remains the supplied Toast URL while portal is not live. Footer additions: Instagram, order/app hub, DoorDash, Uber Eats Dupont, careers (without callback), privacy and shop contacts. URLs are exactly those in the facts file. No Facebook, speculative gift cards or unverified app-store badges. Add `careers` to the footer key/type/label map. Preserve existing vendor event handling for delivery links. Public address/phone currently come from the allowlisted DB projection, hours/geo from tenant config; reconcile the public projection with these facts during implementation without a production data write. Prefer a tenant-owned verified fallback so an optional DB outage cannot erase all shop/structured-data content.

### L083 Field Guide and all ten ingredient lists

Use `~/co-chief-assets/picks-full/L083.jpg` (visually inspected) or a verified `cb-face-083-*` derivative. Visible layers: turkey, pale provolone, ridged chips, shredded iceberg, pickles and bread. Keep numbered markers at the image boundary, leader lines outside food, labels in gutters/below. Do not point at garlic mayo, oil & vinegar or onion unless visibly distinguishable in the chosen crop. Set normalized anchors only after the final crop; no guessed pixel coordinates here. Full ingredient copy can include ingredients not visible in the photograph.

Menu names remain names in both languages. All are on a sub roll / pan para sub. Draft menu words below retain the supplied ingredients; omit routine salt/oregano in display per CC's glossary. No invented claims about allergens, gluten, vegetarian status or portion size.

| Sub | English ingredients | Español |
|---|---|---|
| Crunchy Boi | Turkey, provolone, garlic mayo, onion, pickles, iceberg lettuce, oil & vinegar, ripple potato chips. | Pavo, provolone, mayonesa de ajo, cebolla, pepinillos, lechuga iceberg, aceite y vinagre, papas fritas onduladas. |
| Farmers Market After Dark | Salsa verde, cucumber, onion, sweet peppers, hot peppers, iceberg lettuce, arugula, oil & vinegar. | Salsa verde, pepino, cebolla, pimientos dulces, chiles picantes, lechuga iceberg, rúcula, aceite y vinagre. |
| Hot Pants | Capicola, pepperoni, Genoa salami, provolone, onion, sweet peppers, hot peppers, iceberg lettuce, arugula, oil & vinegar. | Capicola, pepperoni, salami de Génova, provolone, cebolla, pimientos dulces, chiles picantes, lechuga iceberg, rúcula, aceite y vinagre. |
| Never Been Cheddar | Roast beef, cheddar, mustard mayo, radish, arugula, lemon oil. | Roast beef, cheddar, mayonesa de mostaza, rábano, rúcula, aceite de limón. |
| Our French Dip | Roast beef, provolone, caramelized onion, horseradish mayo, black pepper, thyme, au jus for dipping. | Roast beef, provolone, cebolla caramelizada, mayonesa de rábano picante, pimienta negra, tomillo y jugo de carne para mojar. |
| Sicky Wicky Club | Ham, turkey, bacon, provolone, Duke's mayo, iceberg lettuce, onion, tomato, oil & vinegar. | Jamón, pavo, tocino, provolone, mayonesa Duke's, lechuga iceberg, cebolla, tomate, aceite y vinagre. |
| The Frex | Ham, capicola, Genoa salami, pepperoni, prosciutto, fresh mozzarella, hot peppers, arugula, oil & vinegar, balsamic vinaigrette. | Jamón, capicola, salami de Génova, pepperoni, prosciutto, mozzarella fresca, chiles picantes, rúcula, aceite y vinagre, vinagreta balsámica. |
| The Teamster | Ham, capicola, Genoa salami, provolone, onion, sweet peppers, hot peppers, iceberg lettuce, oil & vinegar. | Jamón, capicola, salami de Génova, provolone, cebolla, pimientos dulces, chiles picantes, lechuga iceberg, aceite y vinagre. |
| Turkey Caesar Sub | Turkey, seasoned butter, iceberg lettuce, Caesar dressing, Parmesan, black pepper. | Pavo, mantequilla sazonada, lechuga iceberg, aderezo César, parmesano, pimienta negra. |
| Vesuvio II | Meatballs, vodka sauce, shredded mozzarella, banana peppers. | Albóndigas, salsa de vodka, mozzarella rallada, chiles banana. |

“Balsamic Vin” is rendered as balsamic vinaigrette; confirm that menu wording with CC against the recipe before publication. Vodka + marinara becomes vodka sauce per the supplied glossary. CTA examples use tú: “Elige tu tienda”, “Pide en Capitol Hill”, “Pide en Dupont”, “Mira qué lleva”. Add keys in en/es together, including alt, play/retry/still, map and ARIA labels.

### Indexing: production yes, previews no

Currently `app/eat/layout.tsx` unconditionally sets noindex/nofollow and adds `?lang=` to canonical; `proxy.ts` serves Disallow:/ and an empty sitemap. SITE_ORIGIN alone changes none of that.

Plan a shared host-safe indexing predicate: valid existing landing classification AND normalized request host equals SITE_ORIGIN host AND deployment is Production (`VERCEL_ENV === 'production'`, not merely NODE_ENV). Preview builds also run NODE_ENV=production. Disagreeing/forged host headers must continue to fail closed. Use the predicate for metadata, robots, sitemap and any X-Robots-Tag. Strip incoming internal hints before deriving trusted metadata state as proxy already does. Do not introduce a cached cross-host indexing decision.

On the approved production landing root: robots allow public pages, no noindex meta/header, canonical exactly normalized SITE_ORIGIN + `/`, no ad/fbclid/utm/lang noise. Sitemap contains only canonical public URLs on that origin; exclude internal /eat, staff/API/order and preview URLs. Keep language variants usable; if separately indexable Spanish URLs are introduced later, give them stable self-canonicals/hreflang in a reviewed change rather than contradicting the root canonical. Privacy gets its own clean canonical if included. Preview/other landing hosts remain noindex with Disallow:/ and empty sitemap. Staff behavior/auth isolation is preserved; do not globally mark unrelated staff-host routes indexable.

Server-render two `Restaurant` JSON-LD nodes (specific LocalBusiness subtype), stable IDs `${SITE_ORIGIN}/#capitol-hill` and `/#dupont`. Each includes tenant name + shop name, public image, URL to its section, PostalAddress (US/DC/Washington plus exact street/suite/postal code above), geo above, international telephone (+12026218645 / +12027944638), all seven days openingHoursSpecification 10:30→18:00 / 20:00, and menu = the verified shop-specific order/menu link. JSON must escape `<`; public facts only, never internal IDs. Match visible text exactly, do not invent ratings/prices. [Google's Restaurant guidance](https://developers.google.com/search/docs/appearance/structured-data/local-business) requires crawlable content and supports this shop detail.

Recommend useful per-shop sections for v2 first: “Sub shop in Capitol Hill” and “Sub shop in Dupont Circle”, with address, hours, directions and order link. No keyword stuffing. Later create `/locations/capitol-hill` and `/locations/dupont` only with distinct useful shop content and an explicit proxy allowlist/routing review; anchor sections are not separate ranking URLs. Test robots, canonical, sitemap and JSON-LD in production/preview/unlisted/staff/mismatched-host fixtures plus cache isolation. Validate rendered structured data and public HTTPS headers before submitting sitemap through the existing Search Console owner. Indexability does not guarantee indexing or rankings.

### Meta: Pixel AND CAPI at launch — plan only

The current implementation already shares one generated ID per dispatched OrderClick/CateringClick/Lead across browser `{eventID}` and server `event_id`. PageView and section ViewContent are browser-only today. “Both” means those action events reach both channels with dedup; adding server PageView/ViewContent is separate reviewed schema/client work, not implied existing behavior. No retry queue exists; preserve this unless retries reuse the original ID/time and recheck consent.

Go-live dependencies, owners CC/Pete:

1. Pete's authorized Meta session supplies the correct pixel/dataset identity and CAPI access token. Store token only as server `META_CAPI_ACCESS_TOKEN`, never public config, logs, this document or browser. `META_PIXEL_ID` must match `NEXT_PUBLIC_META_PIXEL_ID`. Verify token permissions, domain, allowed hosts, AEM and custom OrderClick conversion for CRAVE/RETARGET. Current code pins `META_GRAPH_API_VERSION=v25.0`; any provider-version change needs review, not a speculative env bump.
2. Implement/prove actual edge WAF rate limiting on landing hosts + POST `/api/landing/events`, with per-source burst and distributed aggregate bounds across instances. Choose numerical thresholds from load tests/account entitlement before activation; record them and rule IDs. Verify bounded body/content-type/host/origin handling, concurrent bursts, sustained abuse, forged headers, 429 behavior and recovery. A process-local limiter or spoofable request header is insufficient. `landingRateLimit()` is an attestation adapter, not enforcement.
3. Only after those proofs set `LANDING_WAF_STATE=active`, `LANDING_WAF_RULE_IDS`, `LANDING_WAF_VERIFIED_AT` (date), then `LANDING_CAPI_ENABLED=true` in the separately authorized release. Date-shape validation is not automatic expiry: release owner must verify freshness. Unverified/dormant state silently suppresses CAPI; unavailable returns 503, refused 429.
4. Approve the UA disclosure and `LANDING_META_UA_APPROVED=true`; existing server requires UA ≤512 chars and at least one real consented fbc/fbp. No IP collection. Don't fabricate match identifiers; a click before cookies exist can remain Pixel-only even when both transports are enabled. Document delivery/match-quality expectations honestly.
5. Test Events: PageView/ViewContent on Pixel and Lead/OrderClick/CateringClick across both as implemented. Prove matching event names/IDs and dedup in Meta, including slow/blocked SDK, rapid distinct clicks, consent rejection/withdrawal, DNT/GPC and navigation races. Replayed test IDs must not inflate conversions. No `META_TEST_EVENT_CODE` in production (code refuses it).
6. Update `docs/release-checklist.md` and `docs/deploy.md` to replace PIXEL-ONLY launch permission with BOTH required. Retain every existing gate: full unit/type/build/browser tests, source/output asset proof, unchanged perf:ci, real-iPhone/Android/VoiceOver/zoom, merchant payload/branches, ingress/host/cache isolation, DNS/rollback audit, monitor US probe + received failure/recovery/stale-heartbeat evidence, and Juan pause/recovery ownership. Run separate five-cold-run accepted real-Pixel `perf:launch` on approved HTTPS before spend; blocked-Pixel CI cannot certify Meta cost. Record revision/URL/date/owners/private evidence without identifiers or secrets.

If WAF, token, disclosure, dedup or real-Pixel performance evidence is missing, BOTH-at-launch remains blocked. No fallback to pixel-only under this brief.

### Counter: yes after 0273

`LANDING_COUNTER_ENABLED=true` already gates `handleOrderClick`; it calls the existing increment RPC and native navigation never waits. **No application code change is required merely to enable it.** CC must apply/review 0273, stamp provenance, prove independent-session increments, then enable in a separately authorized release. Doing the flag first yields 503s. The table aggregates UTC day/store/ad; no session or customer IDs. The browser currently sends only consented shop OrderClick counters, not vendor clicks, so it is not an all-visitors count. WAF dormant does not block this bounded counter; explicit refused/unavailable does. New ad codes would require coordinated allowlists/RPC/check constraints, outside this visual plan. No migration/env action here.

## Later build split — tests first, perf:ci at every chunk

Every nontrivial chunk gets a short confirmed-file plan and CC-arranged cross-family review before implementation. Never weaken the existing merge gate: median of FIVE cold runs per consent state (UNSET and ACCEPTED with Pixel blocked), performance ≥0.85, accessibility ≥0.95, LCP <2.5s, TBT ≤200ms, CLS ≤0.1; initial first-party ≤500,000 bytes per run, lazy media ≤5MB after full scroll. Preserve initial JS ≤200KB / critical ≤250KB checks too. Real-Pixel perf:launch remains independent. A failed chunk is fixed or reduced before the next begins.

| Chunk | Red tests first | Planned implementation / contracts | Required exit |
|---|---|---|---|
| 1. Facts + media reliability | iPhone SUBDEX cases above; hours/geo/footer/ingredient fixtures; no Facebook; image decode and missing media | tenant config + products + en/es; SubdexMoment/DeferredMotion/HeroMotion; optional verified public-shop fallback | Unit + WebKit/Chromium + assets + perf:ci. Device decoder evidence separately. |
| 2. Static visual foundation | 375×667/812 hero CTA geometry with consent, Spanish, keyboard/zoom/no-JS; sticky links fire one correct event | app/eat composition and scoped landing CSS; Hero/Lineup/Catering/Shops/Footer; new sticky component and placement allowlists | Full landing/browser checks, staff routing regression, type/build + perf:ci. No motion until this passes. |
| 3. Crunch + Field Guide | Reduced-motion/no-JS fully visible, no early effect requests, dimensions/CLS, outside-food labels, scroll/reverse/resize/offscreen; provenance/byte limits | New small CraveScene/FieldGuide, image derivation/manifest; L083 and registered parts; scoped CSS | Real-image fidelity review, source/output asset checks, full-scroll budget, both engines + perf:ci. |
| 4. Indexing | Red host matrix for meta/header/robots/sitemap/JSON-LD; escaping, no query canonicals, no staff leakage | Shared pure indexing predicate; proxy + eat metadata; tenant-owned public schema facts | Host/cache security tests, rendered SEO checks, type/build + perf:ci; no host/env activation. |
| 5. Both-channel release preparation | Dedup/consent/match identifiers/route guards/WAF adapter; migration counter independent calls; all new placement contracts | Any required tracking fixes + release docs; retain 0273 implementation | Full unit suite, type/build, full browser suite, assets + perf:ci. Operator WAF/Meta/DB/HTTPS/device gates recorded separately, not simulated away. |

## Throwaway prototype and verification

`tmp/v2-proto/index.html`: one standalone HTML file with inline CSS/JS, local real cut-outs and local font. Signature moment only: bread-to-built reveal with four real chips in outside lanes; final still is the no-JS/reduced-motion default. Includes bilingual toggle, two real shop links, catering, sticky order bar and a still-motion control. No analytics, cookies or application imports. It is not the eight-section finished page or a perf:ci-certified implementation.

Source copies and sidecars live under `tmp/v2-proto/source/`; browser derivatives under `media/`. Record source/output hashes and exact uniform resize/encoding steps locally. No AI generation, retouch, warp or replacement of ingredients. The prototype's stage switch is an editorial reveal, not a claim to reproduce the recipe build. Keep all scratch ignored/untracked.

Validation results and measured weight are appended below after execution; budgets above remain targets until production chunks are built.

### Executed verification (2026-10-16)

| Command / check | Outcome |
|---|---|
| `npm.cmd test -- tests/landing --maxWorkers=3` | First run: 295 passed, one repository-scan test timed out at 30s. No application code was changed. Full rerun: **36 files / 296 tests passed**, 13.88s. Logs: `tmp/v2-landing-tests.log`, `tmp/v2-landing-tests-retry.log`. |
| `npm.cmd test -- tests/landing/performance-blocking.test.ts --maxWorkers=1` | Targeted retry: **5/5 passed**, unchanged test timeout/config. |
| `node tmp/v2-proto/check.cjs` | Final version: **6/6 scenarios passed**: Chromium and WebKit with iPhone 13 mini device settings at 375×812, each normal/reduced-motion/no-JS. Normal mode also checks Spanish at 375×667, CTA geometry, no horizontal overflow, completed scroll reveal, still control and no page errors. Screenshots and `browser-results.json` are local. |
| Prototype visual inspection | Inspected WebKit hero and scroll screenshots. Real food and chip lanes are separated from text; shop links remain visible. Corrected a prototype browser-global variable collision caught in the first run, then retested. DM Sans face uses its actual normal-weight declaration so headings can synthesize bold. |
| Source custody | All six copied PNG SHA256 hashes equal their originals. Sidecars copied; `provenance.json` records uniform resize + lossless WebP outputs. No original asset modified. |
| `npm.cmd run perf:ci` | **BLOCKED / exit 1:** npm fetch of pinned `@lhci/cli` from registry.npmjs.org returned EACCES. Neither consent state completed five cold runs. No Lighthouse score or performance pass claimed. Log `tmp/v2-perf-ci.log`; evidence `tmp/landing-performance/2026-10-16T23-48-12.438Z-merge-dceaddca/`. Gate and configuration unchanged. |
| `git diff --check`, `git diff --name-only`, `git status --short`, `git check-ignore tmp/v2-proto/index.html` | No tracked-file diff; new plan is untracked, supplied facts remain untracked; tmp is ignored. No commit, push, merge, production/env/DB change. |

Final browser-delivered asset sizes (raw file bytes, not a Lighthouse transfer measurement): HTML **13,181 B** (gzip 4,476 B), media/font/wordmark **721,315 B**, total after scrolling **734,496 B** (~735KB). Static initial document + built photo + font + wordmark = **408,284 B**; reveal assets add **326,212 B** when the section intersects. Local source copies/sidecars total **7,244,986 B** and are not requested by the HTML; screenshots, scripts and evidence are also excluded from browser weight. Full breakdown: `tmp/v2-proto/weight.json`. This lossless study deliberately prioritizes photo integrity; production responsive assets must meet the tighter proposed allocations and actual CI transfer measurements.

Open gates: CC creative selection/cross-family production plan review; accurate ingredient-stage registration; on-device SUBDEX root-cause confirmation; successful perf:ci in an environment able to run the pinned Lighthouse package; all separately owned launch gates above. The small prototype makes no claim to validate v2's future full-page performance or Meta delivery.
