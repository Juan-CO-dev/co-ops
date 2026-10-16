# Landing page, phase 1: spec (CC initial plan)

**Owner:** CC (initial plan) · **Builder:** Astra writes the build plan and builds · **Review:** CO CC or Aggie per chunk; Juan approves section by section on his phone
**Date:** 2026-10-16 · **Amended:** 2026-10-16 (real-food wording, hero tech). **Gates:** the paid launch. Every ad points here from day one (Juan, 10-16).
**Inputs:**
- Launch plan: https://claude.ai/artifact/7eiaZjX3TKjbmtyAB5MVE4
- Juan's landing-page direction of 10-05: memory `project_landing_page_plan`
- Ad engine state: memory `project_ad_engine_state_2026-09-30`

**Revision r4:** r3 documents committed at `4cbd3b12` (base `b1aa4c67`), branch `feat/landing-p1`, dedicated clone `C:/Users/conta/co-ops-landing`. This revision is docs-only and UNCOMMITTED; no push, merge, deployment or production data changes. Applies Aggie r3 findings and lead rulings; implementation evidence remains future work.

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
  - 44 px tap targets paired with `items-center`;
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

T0-compliant configuration: all URLs (per-store orders/branch ids, Toast catering, inquiry, gift cards, socials), hosts, hours and facts absent from locations live in ONE typed `config/tenant/landing.ts`, read through `lib/landing/config.ts`. Environment identity/origins and LANDING_HOSTS are resolved through the same loader; effective hosts still require the nonempty deployment allowlist. Existing locations supplies store name/address/phone/coordinates through a server-only public read loader with an explicit public projection; verify schema before implementation. Components contain no tenant literals; links/stores modules are adapters. Do NOT copy app/order debt. Deterministic CI asserts rendered links against config; live 200/redirect/branch-payload and manual merchant-flow probes are non-blocking ordinary CI but blocking at launch (not a passing SPA shell alone).

## 5. Measuring which ad worked
- **Ad identity:** every ad links with `?ad=<code>` (for example `?ad=subsim-photo`) plus UTM parameters. The page keeps the code for the session.
- **Meta Pixel** fires:
  - PageView;
  - ViewContent per section;
  - **Lead** for "Ask us about catering";
  - **CUSTOM OrderClick** on store order clicks, with store and ad code;
  - **CUSTOM CateringClick** on the catering-order button (Lead remains for the inquiry button).

  Checkout happens on Appfront: NEVER report an outbound click as InitiateCheckout. Meta optimizes CRAVE/RETARGET using a custom conversion built on OrderClick; custom events use trackCustom. Do not emit Purchase. The Pixel ID comes from the Pete session and lives in an env var; the page works with it absent.
- **Conversions API:** a server route sends the same OrderClick/CateringClick/Lead events, deduplicated by event_id. Delivery is best-effort and cannot promise to defeat blockers. Requires approved matching data/consent and configured credentials. Limiter is Vercel WAF rate-limit rules, configured at deploy time with Juan's OK; code ships a unit-tested activation/refusal adapter, while E4 manually verifies entitlement, exact rule scope, bursts/concurrency, 429s, spoof resistance and x-real-ip/XFF at real ingress. If the tier lacks WAF rate limiting, launch PIXEL-ONLY with CAPI dormant. Paid spend is NOT blocked on CAPI. E4 requires pixel Test Events; dedup/match-quality evidence applies only once CAPI is activated. CAPI itself has no service-role client or DB writes.
- **Independent KPI counter:** POST `/api/landing/order-click` increments our own aggregate counts per ad code and store, independent of Meta/CAPI activation and respecting consent/DNT/GPC. Minimal `landing_order_click_counts` storage keyed by UTC day/store/ad with bigint count only: no personal data, IP/UA, event ids or raw events. A planned FILE-ONLY migration (next unused lineage number, never applied by Astra) sets deny-all RLS, revokes anon/authenticated access, and adds a service-role-only atomic increment writer with SECURITY DEFINER/fixed search_path/revoked PUBLIC execution. No direct UPDATE/reset/delete access; this derived increment-only counter does not mutate operational history. Bound/allowlist keys, collapse unknown ads to unattributed, reject unknown stores/extra fields, use no automatic retries, and never block native navigation. Count direct-store clicks, excluding third-party footer destinations; compare daily totals against Meta OrderClick and Appfront/Toast orders in the marketing KPI plan. SQL grants/concurrency are tested separately from pure Vitest. When WAF is unavailable, retain bounded inputs/cardinality and document possible anonymous count inflation; never use identifier-bearing DB rate-limit buckets. These are approximate clicks, not purchases or unique users.
- **Order codes:** if Appfront supports promo codes or a promo URL parameter, pass the ad code through to it. Otherwise show the code on the page ("Use code SUBSIM at checkout") only for ads that carry an offer.

  **Open question for the build plan:** what does Appfront support? Astra checks the docs. No guessing.
- **Privacy:**
  - a cookie notice that is honest and minimal;
  - no personal data in URLs;
  - the pixel respects Do Not Track / consent per Meta's terms.

## 6. Tech
- **Inside CO-OPS on its own host** (Juan's decision, 2026-10-16; retained in r4). Next.js App Router, TypeScript and Tailwind in the existing CO-OPS repository and Vercel project, beside `app/order/*` and `components/portal/*`. Juan's reasoning: reuse the portal look, avoid a new project, and make the later catering hand-off seamless.
- **Host isolation is the condition:** exact server-side LANDING_HOSTS gates routing, Pixel and CAPI. Empty/absent is FAIL-CLOSED: NO landing host, `/eat*` and `/api/landing/*` 404 on EVERY host, tracking off, existing staff root preserved. Authoritative source is HTTP Host; strict authority parsing lowercases hostname and strips valid port for matching; reject malformed/multiple, userinfo/path/whitespace, trailing dots and Unicode/punycode variants. When X-Forwarded-Host is present require agreement including normalized effective port; missing/invalid Host or disagreement fails closed before public bypass. Reuse tests/sim-isolation.test.ts negative cases with explicit landing case/port-normalization differences. Ignore/overwrite client internal hints; exclude STAFF_ORIGIN even if accidentally allowlisted.
- **Routing/static matrix:** match all paths first. Landing `/` rewrites to `/eat`; `/privacy` to `/eat/privacy`; direct `/eat` 301s to `/`, direct `/eat/privacy` to `/privacy` without redirect loops. Only landing pages, `/api/landing/events`, `/api/landing/order-click` and explicit assets are allowed. Staff/auth/portal/cron/webhook paths, including currently exempt `/api/locations` and `/api/users/login-options`, return 404 with no handler/cookie. Static allowlist: /_next/static, validated /_next/image, approved /media/ and /brand/, /eat/icon.png, /eat/apple-icon.png, /favicon.ico (landing asset), /robots.txt, /sitemap.xml. Never serve staff root icon.png/apple-icon.png/opengraph-image.png on landing. At 4cbd3b12 next.config has no images.remotePatterns; preserve remote refusal and restrict local optimizer targets too. Empty-env row and every current matcher exemption are tested.
- **Headers/cache/cookies:** force dynamic landing HTML/RSC, `Cache-Control: private, no-store`, merge `Vary: Host` with Next RSC values. Proxy sets landing CSP and geolocation permission at REQUEST TIME with separate origins object, including 404s/static/rewrites; staff defaults and Report-Only remain unchanged. No runtime-env branch in build-time next.config headers(). Real production tests prove one effective header even build-without-env/start-with-env. Host-only cookies are co_ops_session, co_ops_portal AND co_shop (no Domain); landing issues none. Recheck every writer and test cross-origin/browser behavior.

- **Portal design reuse:** Mayo #FFF9E4 / Diet Coke #141414 / Mustard #FFE560, gold only on dark and red only for CTA; existing local fonts, Reveal/FaqItem/GoodToKnow and storefront-images. New landing components live in `components/landing/*`. Consumer grep and regressions cover portal consumers plus staff vault; current vault uses separate SecretReveal. The swipeable lineup is a scoped scroll-snap/overflow exception to catalog chip/button rules, not page-wide overflow. CTA co-cta fill/co-cta-text edges/text retain ratified roles. Preserve approved real-photo selections/provenance; the existing image map does not waive approval.
- **Hero:** native lazy HTML video, required opaque H.264 MP4 baked to the exact solid section background from the approved alpha spin master; optional opaque WebM. Juan picks 1:1 or 9:16 at 375 px. Real-photo sm_014 poster and reduced-motion/failure fallback; no browser alpha dependency or WebGL engine. R3F returns only if a real mesh is separately approved.
- **Images:** next/image AVIF/WebP sized per breakpoint; the LCP poster is pre-sized static media without an optimizer round-trip. Assets copied locally from approved launch/shoot sources after the finish pipeline, no Drive/claude.ai hotlinks.
- **Catering:** one flag in `config/tenant/landing.ts`, consumed through the loader by `lib/landing/links.ts`, selects Toast now and CO-OPS `/order` on the configured staff/portal origin when fully live. The origin crossing preserves landing isolation.
- **Hosting:** add a dedicated domain alias to the SAME Vercel project only with Juan's OK at deploy time. A dedicated Vercel alias can precede GoDaddy access; later use e.g. `eat.complimentsonlysubs.com`. Main site remains SpotHopper; nothing is created in this docs revision.
- **i18n:** anonymous Spanish is in scope: valid ?lang=es|en, else Accept-Language (es* selects Spanish), else English. Visible EN/ES toggle, no language cookie. A1 adds resolver/toggle tests; EVERY section renders translated, nonempty Spanish and English, including ARIA; keep house en/es key parity. Phone-first 375 px, 44px targets paired with items-center.
- **CI/monitoring:** A1 opens with npm ci then installed Next docs. Build the missing browser/live harness and install Chromium/WebKit with dependencies/artifacts. Pure host tests stay in Vitest; real matcher/headers/isolation live in tests/e2e/landing/host-isolation.spec.ts against next build && next start, never next dev. Include existing tests/security-headers.test.ts and tests/sim-isolation.test.ts in A1 changes, preserving staff/Report-Only pins. landing-checks.yml runs every PR with path detection and conditional expensive jobs; an always-running required gate (needs + if: always()) passes legitimate skips/success and fails errors/cancellation. Keep it OUT of build.yml. E5 cron stays separate. Detailed contracts and evidence live in r4 BUILD.
- **Phase-1b reservation:** host classification supports a future /jobs recruitment page on the same host. Keep /jobs 404 until that explicit route task; do not build it now.

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
- Before paid spend, verify pixel PageView/ViewContent/Lead and custom OrderClick/CateringClick in Test Events, and configure the OrderClick custom conversion for CRAVE/RETARGET. CAPI dedup/match quality is required only before CAPI activation; accepted pixel-only launch is not blocked by missing CAPI/WAF tier support. Verify the independent counter separately.
- Reduced-motion is a fully usable page.
- Juan's approval on every section.
