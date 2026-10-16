# Landing page, phase 1: spec (CC initial plan)

**Owner:** CC (initial plan) · **Builder:** Astra writes the build plan and builds · **Review:** CO CC or Aggie per chunk; Juan approves section by section on his phone
**Date:** 2026-10-16 · **Amended:** 2026-10-16 (real-food wording, hero tech). **Gates:** the paid launch. Every ad points here from day one (Juan, 10-16).
**Inputs:**
- Launch plan: https://claude.ai/artifact/7eiaZjX3TKjbmtyAB5MVE4
- Juan's landing-page direction of 10-05: memory `project_landing_page_plan`
- Ad engine state: memory `project_ad_engine_state_2026-09-30`

## 1. Job, audience, success
**One job:** turn a person who just watched one of our ads into a person who places a direct order (pickup or delivery) or starts a catering order. The page does it by showing off the food.

**Audience:** people within 3–5 miles of either store, mostly on phones, arriving from Instagram or Facebook ads, or from the RETARGET layer.

**Success:**
- clicks into ordering from the page;
- direct online orders and coded orders in Toast;
- the cost per direct order, on Pete's weekly page.

## 2. Hard rules
- **Real-food law** (the house skill; amended 2026-10-16 after Astra's build-plan review). **Photo sections** (the Lineup, the Field Guide cut face, the catering platter) use REAL photos only; edits through the v4 finish pipeline are tagged REAL-EDITED in filenames. **Juan-approved drawn assets** (the photo-textured Crunchy Boi spin; the SUBDEX pixel-hero excerpt) may appear, as Juan directed for this page on 10-05 and as already used in his approved ads. They are tagged DRAWN in filenames and never presented or captioned as photographs. Nothing is newly AI-generated for this page.
- **No visible labels or tags** on imagery ("AI", "photo", campaign names). Tags live only in filenames.
- **Phone first.** It must look and work great at 375 px. Desktop is a scaled-up version, not the target.
- **Fast:**
  - LCP under 2.5 s on mid-range 4G;
  - 3D and video load lazily, after the first paint, each with a still-image fallback;
  - the page is usable with JavaScript slow or off (plain order buttons always render).
- **Accessible:**
  - meets `prefers-reduced-motion`: no scroll-jacking, no auto-spin;
  - 44 px tap targets;
  - alt text on every image;
  - colour contrast AA.
- **Brand:** the CO yellow / ink palette and the logo pack (`~/co-3d/logo-pack`). The tone matches the ads: warm, a little playful, confident.
- **No customer data collected on the page** in phase 1. It only links out. No forms, except linking to the existing catering inquiry page.

## 3. Sections, top to bottom
1. **Hero:** the photoreal Crunchy Boi spin (the asset in `08 Crunchy Boi 360 Spin`). It slams in on first scroll; on a reduced-motion device it is a still. One line, plus two buttons: **Order Capitol Hill** and **Order Dupont**.
2. **Field Guide:** the anatomy of the Crunchy Boi on the real cut face. Callouts for each layer, ending "Fig. 2. Gone." Then an order button.
3. **The lineup:** "Choose your fighter". A swipeable card per sub, using the real finished photos from the 07-31 pro shoot (`co-chief-assets/shoot/Product`), properly cropped and touched up with the v4 finish pipeline.
   - Only subs whose photo Juan has confirmed appear.
   - Unconfirmed IDs (INTAKE.md groups 1–7) are left out until he confirms them. Ship with the confirmed set.
4. **The SUBDEX moment:** a short "graphics update" beat that reuses the SUBDEX ad's pixel hero catching a sub. It is a nod to the ads, not a game.
5. **Pick your shop:** both stores, with address, hours, phone (as plain selectable text) and honest walking-time copy.
   - Location is opt-in only, never requested on load. With permission, show the nearer store first; without it, show both.
6. **Feed the meeting:** catering. A real platter photo, the line "Catering for the whole office", and two buttons:
   - Start a catering order (the Toast catering page for Capitol Hill);
   - Ask us about catering (the existing inquiry page).
7. **Footer:** the old-friend-text style sign-off, gift cards, the app link, Uber Eats / DoorDash (small and last), social links, addresses.

## 4. Order routing
Order buttons go to the EXISTING first-party ordering, per store. These were read off complimentsonlysubs.com on 2026-10-16. **Juan confirmed 2026-10-16:** the page pushes to all the OFFICIAL links. Catering goes through Toast for now and switches to our own catering portal (CO-OPS `/order`) as soon as it is fully live. Use the branded host `order.complimentsonlysubs.com` once its deep links are verified per store:
- **Capitol Hill:** `https://complimentsonlysubs.appfront.app/order/?branchId=69bdd5a0daeb710cb2cbdb0d&servingOptionType=a`
- **Dupont:** `https://complimentsonlysubs.appfront.app/order/?branchId=69bdddee7150a60c8dc37f73&servingOptionType=a`
- **Catering:** `https://www.toasttab.com/catering/compliments-only-capitol-hill-526-8th-street-southeast`, plus the inquiry page `/washington-capitol-hill-compliments-only-catering-inquiry`.

All URLs live in ONE config file. The build verifies each URL resolves (HTTP 200) in a test.

## 5. Measuring which ad worked
- **Ad identity:** every ad links with `?ad=<code>` (for example `?ad=subsim-photo`) plus UTM parameters. The page keeps the code for the session.
- **Meta Pixel** fires:
  - PageView;
  - ViewContent per section;
  - **Lead** for "Ask us about catering";
  - **InitiateCheckout** on every order click, with the store and the ad code.

  Purchases happen on Appfront and Toast, where we can't put the pixel, so InitiateCheckout is the conversion Meta optimizes for. The Pixel ID comes from the Pete session and lives in an env var; the page works with it absent.
- **Conversions API:** a server route sends the same InitiateCheckout and Lead events server-side, deduplicated by event_id, so ad blockers don't hide them. Needs a Meta access token, set by Juan. Dormant without it.
- **Order codes:** if Appfront supports promo codes or a promo URL parameter, pass the ad code through to it. Otherwise show the code on the page ("Use code SUBSIM at checkout") only for ads that carry an offer.

  **Open question for the build plan:** what does Appfront support? Astra checks the docs. No guessing.
- **Privacy:**
  - a cookie notice that is honest and minimal;
  - no personal data in URLs;
  - the pixel respects Do Not Track / consent per Meta's terms.

## 6. Tech
- **Inside CO-OPS on its own host** (Juan's decision, 2026-10-16; r3). Next.js App Router, TypeScript and Tailwind in the existing CO-OPS repository and Vercel project, beside `app/order/*` and `components/portal/*`. Juan's reasoning: reuse the portal look, avoid a new project, and make the later catering hand-off seamless.
- **Host isolation is the condition:** an exact server-side `LANDING_HOSTS` allowlist gates landing routing, Meta Pixel and CAPI. On the landing host serve only the landing, its guarded `/api/landing/*` endpoint and approved static assets; staff/auth/portal routes 404. On the staff host the landing route is not served and Pixel/CAPI never load. Host-specific CSP includes Meta domains only on landing; retain the existing Report-Only rollout. Staff and portal session cookies stay host-only (no Domain).
- **Portal design reuse:** Mayo #FFF9E4 / Diet Coke #141414 / Mustard #FFE560, gold only on dark and red only for CTA; existing local fonts, Reveal/FaqItem/GoodToKnow and storefront-images. New landing components live in `components/landing/*`. Preserve approved real-photo selections/provenance; the existing image map does not waive approval.
- **Hero:** native lazy HTML video, required opaque H.264 MP4 baked to the exact solid section background from the approved alpha spin master; optional opaque WebM. Juan picks 1:1 or 9:16 at 375 px. Real-photo sm_014 poster and reduced-motion/failure fallback; no browser alpha dependency or WebGL engine. R3F returns only if a real mesh is separately approved.
- **Images:** next/image AVIF/WebP sized per breakpoint; the LCP poster is pre-sized static media without an optimizer round-trip. Assets copied locally from approved launch/shoot sources after the finish pipeline, no Drive/claude.ai hotlinks.
- **Catering:** one flag in `lib/landing/links.ts` selects Toast now and CO-OPS `/order` on the configured staff/portal origin when fully live. The origin crossing preserves landing isolation.
- **Hosting:** add a dedicated domain alias to the SAME Vercel project only with Juan's OK at deploy time. A dedicated Vercel alias can precede GoDaddy access; later use e.g. `eat.complimentsonlysubs.com`. Main site remains SpotHopper; nothing is created in this docs revision.
- **i18n:** English default; every visible/ARIA key ships in both `lib/i18n/en.json` and `es.json`, with house parity tests. Phone-first 375 px and minimum 44px targets remain mandatory.
- **CI/monitoring:** retain house Vitest/build/discipline/trace gates; add path-filtered Playwright/axe/LHCI checks and an E5 GitHub Actions cron in this repository. Detailed host matrix, consent, performance and launch evidence remain in the r3 build plan.

## 7. Phase 2 (not now)
- Per-ad-type pages for the proven winners once Meta data shows what converts (`?ad=` decides).
- The playable Sub Sim, and the SUBDEX Season Pass hub.

## 8. Chunks (Astra refines these in the build plan)
- **A:** repo skeleton, design tokens, config, pixel and CAPI plumbing (dormant), order routing with URL tests, a Lighthouse budget in CI.
- **B:** the hero spin, with all fallbacks.
- **C:** the Field Guide and the Lineup (asset pipeline: crop, finish, export).
- **D:** SUBDEX moment, Pick your shop, Feed the meeting, footer.
- **E:** a 375 px pass, a reduced-motion pass, the accessibility audit, performance tuning, preview deploy.

Juan reviews each chunk on his phone (preview URL) before the next one starts.

## 9. Acceptance
- Lighthouse mobile: Performance ≥ 85 and Accessibility ≥ 95.
- LCP < 2.5 s.
- Every order button reaches the right store.
- Pixel events verified with Meta's test events tool once the pixel exists.
- Reduced-motion is a fully usable page.
- Juan's approval on every section.
