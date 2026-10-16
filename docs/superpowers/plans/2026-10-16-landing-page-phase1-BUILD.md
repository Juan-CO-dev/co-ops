# Landing page phase 1 — BUILD PLAN

Date: 2026-10-16. Revision **r3**, docs only. Supersedes r2's standalone scaffolding following Juan's decision: build inside CO-OPS beside the catering portal, on its own host. Reuse the portal look, avoid a new project, and make the later catering hand-off seamless. Base `origin/main` b1aa4c67; branch `feat/landing-p1`; dedicated clone `C:/Users/conta/co-ops-landing`. Source: `docs/superpowers/specs/2026-10-16-landing-page-phase1-design.md`. Plan and spec section 6 edited, UNCOMMITTED. No app code, resource creation, push, merge or deployment. CC arranges cross-family review of r3 before implementation.

## Read-before-authoring findings and decisions

This revision re-read the current plan/spec, real-food-law, global routing/capabilities, confirm-before-authoring and INTAKE. The prior plan records finisher/adapter/house-plan inspection; re-read those implementations before executing the asset tasks. This revision applies the supplied cross-family review and lead rulings; it does not implement the page. CC arranges another-family review before app code; resolve the affected decisions before their tasks run. Juan reviews each completed chunk on his phone before the next chunk starts. No phase 2 game or personalized pages.

| Reference | Finding | Plan treatment |
|---|---|---|
| Amended spec §§2–3, §6 | Native spin and SUBDEX approved | DRAWN hero; real sm_014 poster/reduced-motion/failure fallback. SUBDEX unblocked, never photo-captioned. |
| Lead iOS ruling | No browser alpha dependency | Required opaque H.264 MP4 for all browsers; exact solid section colour. |
| INTAKE 10-05 | Juan confirmed groups 1–7 | Lead correction overrides stale spec whitelist: ten eligible subs, Marisa held for legal. |
| `C:/Users/conta/co-scenes-fx-copy/tools/vfx-footage/fxv4/finish.py` | FOUND; v4 photo finishing changes food pixels | Record derivatives REAL-EDITED in manifest/ledger, never untouched real-photo. No visible classification labels, per current brief. |
| `C:/Users/conta/co-3d/logo-pack/vector/` | Existing stamp, wordmark and icon SVG/PNG files | Reuse original marks; do not generate a logo. |
| Spec's launch artifact and named memories | Not independently retrieved in this pass | Spec is the bounded implementation contract; CC supplies any additional binding copy before content approval. |

The law classifies photo-textured 3D as DRAWN; photoreal appearance does not establish real-photo provenance. Spin provenance must be attached before use. SUBDEX source filenames explicitly say AI-DRAWN. Do not silently call either untouched food. Approval is settled; hashes, provenance and export QA remain publication gates.

## CO-OPS baseline, reuse and host isolation

Read against b1aa4c67: `proxy.ts`, `lib/security-headers.ts`, `next.config.ts`, `package.json`, `.github/workflows/build.yml`, `vitest.config.ts`, `app/layout.tsx`, `app/globals.css`, both session modules and the portal components below. Some root working-tree files deny reads; their committed contents were read with `git show HEAD:<path>`. The original r2 read-before-authoring paragraph and source asset observations below are retained r2 evidence, not new inspections. Re-read asset sources before exporting.

Keep the existing package/lockfile and Node 22.x (`.nvmrc`), Next 16.2.4, React/React DOM 19.2.4, TypeScript strict with noUncheckedIndexedAccess, Tailwind v4 CSS-first and Vitest ^4.1.10. Playwright 1.63.0 is already a dev dependency; add landing browser suites, LHCI and axe integration without replacing house tooling or upgrading the framework. Resolve/pin compatible added tools and record their lockfile/engine checks at A1. No standalone scaffold, `src/` tree, Tailwind config or Node 24 migration. Read installed `node_modules/next/dist/docs/` guides for proxy, headers, routing and metadata before implementation; no code is authored in this revision.

### Exact reuse versus new files

- Reuse `app/globals.css` tokens: Mayo `--co-bg` #FFF9E4, Diet Coke `--co-text` #141414, Mustard `--co-gold` #FFE560, white `--co-surface`, borders, muted text and card shadows. Gold only on dark for landing; red only for CTAs, using `--co-cta` fill and AA `--co-cta-text` on light. Keep shared tokens stable; scope solid landing section backgrounds locally so baked video matches exactly.
- Reuse root `app/layout.tsx` self-hosted DM Sans (`app/fonts/dm-sans-latin.woff2`, `--font-dm-sans`), existing typography and logo pack. Do not add remote fonts or import staff shells/providers.
- Reuse `components/portal/Reveal.tsx` for optional entrances; its current initial motion-safe opacity is zero, so add a small shared progressive-enhancement fix with portal regression coverage: SSR/no-JS content visible, motion enabled only after hydration, all content visible for reduced motion. Never wrap the LCP poster or critical anchors in hidden content.
- Reuse `components/portal/FaqItem.tsx` for approved supplemental Q&A within existing sections, translated q/a props; verify keyboard/44px/reduced-motion behavior and a visible no-JS answer fallback. Reuse `components/portal/GoodToKnow.tsx` with one item and translated label, `tone="dark"` or `surface`; one item avoids the current unpausable five-second cycling. `FaqOpen` from that module is the static alternative. Do not introduce an eighth section.
- Reuse `components/portal/storefront-images.ts` exports `subImage`, `hasSubImage`, `GENERIC_SUB_IMG` as the existing identity/source lookup through `lib/landing/media.ts`. Its remote URLs and generic fallback are NOT approvals: the landing adapter cross-checks the r2 confirmed source manifest, locally exports approved media, and rejects misses/legal-held identities rather than showing a generic photo as a named sub. The ten pro-shoot selections below remain authoritative; no wholesale replacement by Toast photos.
- New `components/landing/*`: Hero, HeroMotion, FieldGuide, Lineup, SubdexMoment, Shops, NearbyShop, Catering, Footer, OrderLink, OfferCode, ConsentNotice, TrackingProvider, SectionView. New `lib/landing/*` owns links/media/products/stores/offers and tracking. Shared pure decisions use `*-shared.ts` (attribution, consent, tracking-schema and media-policy use that suffix in the task file lists); Meta server module is `server-only`. No client import of service-role code.
- Every visible string and ARIA label goes into `lib/i18n/en.json` AND `lib/i18n/es.json` under landing keys using house translation helpers/parity tests; English default, real Spanish translations in the same implementation. No standalone English content file. Use tenant identity via `lib/tenant.ts`; store vocabulary/content comes through existing allowed public configuration/DB reads, not new hardcoded tenant literals. `lib/landing/stores.ts` is an adapter, not a second location registry. The explicitly approved merchant URLs remain centralized configuration.

### Host-gated routing (A1, A4, A5; launch-blocking)

Use `app/eat/page.tsx`, `app/eat/layout.tsx`, `app/eat/privacy/page.tsx` and public `app/api/landing/events/route.ts`. Landing-host `/` rewrites to `/eat`; `/privacy` rewrites to `/eat/privacy`. Direct `/eat` paths remain host-gated. The staff root remains login. Landing layout alone mounts tracking after the server host check; never root `app/layout.tsx` or `/order`. Read host at request time and prevent shared HTML/RSC caching across host variants; browser code receives only a server-approved flag. Client input cannot set that flag.

`LANDING_HOSTS` is a server-only exact hostname allowlist, no wildcard/suffix matching; empty means tracking disabled. Normalize case/ports with strict authority parsing, reject malformed/multiple hosts, and exclude the configured `STAFF_ORIGIN` host even if accidentally listed. `SITE_ORIGIN` must be an approved landing HTTPS origin. Do not trust arbitrary X-Forwarded-Host or client x-landing headers; define trusted ingress behavior for Vercel and overwrite internal hints. Preview tracking is off unless its exact dedicated host is explicitly allowlisted with test configuration; never allow all vercel.app hosts.

Current `proxy.ts` excludes `/`, `/order/*`, auth, portal APIs, webhooks and crons in its matcher, BEFORE `PUBLIC_PATHS` runs. Replace those exclusions with a matcher that runs host isolation on every application route, including those public endpoints and image-looking route suffixes (non-capturing regex groups only). Prefer matching all paths and performing an explicit static allowlist inside the proxy; never exempt arbitrary `.png`/`.webp` paths as authorization. Host classification runs BEFORE public bypass and staff JWT verification. Add `/eat`, `/eat/privacy` and `/api/landing/*` to public-path handling only after host checks. Preserve staff auth, portal, cron and webhook behavior on the staff host.

On a landing host serve only the landing pages, `/api/landing/events`, landing metadata and explicit public static assets (`/_next/static`, validated `/_next/image`, approved `/media` and `/brand` assets/icons). Reject every other application path with 404, including `/order`, `/api/auth/*`, `/api/portal/*`, `/api/cron/*`, `/api/webhooks/*`, login/verify/reset/admin/dashboard/training routes; do not run their handlers or set their cookies. Limit the image optimizer to intended public media; it must not proxy staff resources. Staff host and unlisted previews return 404 for `/eat*` and `/api/landing/*`; this is the chosen permitted staff behavior. Preview review uses an explicitly allowlisted dedicated alias, noindex, tracking dormant until separately configured. No request-host-derived redirects or open redirect target.

Future catering switch: one `cateringPortalLive` flag in `lib/landing/links.ts` selects Toast now versus `/order` resolved against fixed `STAFF_ORIGIN` when fully live. A bare `/order` on the landing host would 404; the configured absolute portal URL intentionally crosses origin. No need to expose staff routes or widen cookies on the landing host. Tests pin both states; E5 follows the active config destination.

`lib/security-headers.ts` builds a global **Content-Security-Policy-Report-Only**, wired through `next.config.ts`. Keep staff policy and Report-Only rollout unchanged; add host-specific policy generation/wiring with one effective CSP header per response, including rewrites/404s/static paths. Only landing-host policy adds the browser Pixel domains (`https://connect.facebook.net` scripts and `https://www.facebook.com` image/connect, verify actual required domains at activation); no global Meta additions and no browser permission for server-only Graph API. Report-Only is NOT an enforcement barrier: host checks and script omission enforce isolation. Current Permissions-Policy denies geolocation everywhere: allow `geolocation=(self)` only on landing responses for D2's explicit opt-in; staff remains denied. Preserve other security headers.

| Host | `/`, landing/privacy | Staff/auth/admin/API | `/order`, portal/webhook/cron | Landing CAPI | Static assets |
|---|---|---|---|---|---|
| Allowlisted landing | 200 landing; direct `/eat` guarded | 404, no handler/cookie | 404 | public POST with strict route guards | explicit allowlist only |
| Staff | existing login; `/eat*` 404 | existing auth rules | existing public/route guards | 404 | existing behavior |
| Unlisted preview | existing app behavior; `/eat*` 404 | existing auth rules | existing route guards | 404 | existing behavior |
| Explicit landing preview | same landing isolation; noindex | 404 | 404 | dormant unless test env complete | explicit allowlist only |

Tests exercise matrix through the actual production matcher/rewrite/headers, not only helper calls: GET/HEAD/POST, nested routes, suffix tricks, forged forwarded headers, missing/malformed host, valid staff cookie on landing, no cookie and invalid cookie. On staff/unlisted preview, even with consent and all Pixel env set: no Pixel script/noscript/preconnect, tracker initialization, Meta network, CAPI send or Meta CSP domain. Inspect HTML/RSC plus browser requests; navigate between origins and verify no cache leakage. Retest staff login, reset, portal, cron and webhook regressions.

### Cookies and public CAPI boundary

Confirmed `lib/session.ts:cookieOptions` and `lib/portal/session.ts:cookieOpts` omit Domain: `co_ops_session` and `co_ops_portal` are host-only, httpOnly, sameSite=lax, path=/ and secure in production. Set/clear helpers share those options; no fix needed now. Add response-level tests for staff login issuance, logout/invalid-session clearing, portal issuance/clearing: no Domain attribute at all, specifically never `.complimentsonlysubs.com`. Browser tests verify cookies set on staff are not sent to landing. Landing never issues either cookie. Recheck all writers before implementation; if any bypass adds Domain, remove it in that writer with a regression test. Do not relax sameSite or Domain for the portal hand-off.

CAPI is public relative to staff auth, NOT unrestricted: POST-only `/api/landing/events`, independently validate request host against LANDING_HOSTS AND exact HTTPS Origin against configured landing origins, require same-origin host agreement, reject missing/null/foreign Origin and forged host, no wildcard CORS. Then bounded body/schema/consent/time/event validation, rate limit, and server-only Meta send. Dormant valid requests return 204 without DB or network when config incomplete; wrong host/origin is still refused. No customer PII, IP, UA, fbclid/fbc/fbp or event payload written to the DB, logs or audit.

House `lib/portal/csrf.ts:assertSameOrigin` requires Origin and rejects cross-site fetches; follow its refusal pattern but strengthen it with the landing host/HTTPS allowlist. House `lib/portal/rate-limit.ts` uses service-role `portal_rate_limit_hit`, but fails open and can persist identifier-bearing keys. Do not reuse that DB limiter for landing: even hashed IPs are pseudonymous identifiers, so the no-customer-PII DB rule chooses a non-DB managed edge rate limiter. A5 must specify and test the same-project Vercel edge rule/provider before activation (no resource creation now), plus a server-only adapter where needed; no process-local-only limiter in serverless. Initial cap: 30 events/minute per trusted client IP and 600/minute aggregate, reviewed against launch traffic. Missing limiter configuration or health evidence means no Meta send (503); limit hit 429. Verify spoof resistance and concurrent enforcement across instances; use house trusted-client-IP handling, never a payload IP. Document provider retention/disclosure with Juan before activation. CAPI needs no service-role client or DB writes. No audit per marketing event and no invented audit action; any later required operational audit must use the closed vocabulary and exclude identifiers. Tests mock Meta and prove zero DB calls and no secret leakage.

### Existing CI and landing additions

`.github/workflows/build.yml` already runs on main PRs/pushes: Node from `.nvmrc`, `npm ci`, both Phase 2 discipline checks (including 0215), `npm test`, `npm run build`, and training deployment-trace verification. It does not currently run an explicit lint/typecheck/Playwright/LHCI step. Preserve these gates. Vitest uses `tests/**/*.test.ts`; put landing unit tests in `tests/landing/`. Keep live tests outside that glob and Playwright in `tests/e2e/landing/*.spec.ts`.

Add `.github/workflows/landing-checks.yml` with path-filtered production-build, typecheck, Playwright Chromium/WebKit + axe, deterministic link/asset checks and LHCI/transfer budgets. Paths include app/eat/**, app/api/landing/**, components/landing/**, lib/landing/**, public landing media/brand, shared portal components, app/layout.tsx, app/globals.css, i18n, proxy.ts, security headers, next.config.ts, package/lockfiles, landing tests/config/scripts and the workflow itself. Shared isolation unit tests still run in the ordinary house suite. Unrelated PRs avoid browser/LHCI cost; handle required-check skip semantics explicitly. Cron E5 is `.github/workflows/launch-monitor.yml` in THIS repo, separate from PR gates.

### Hero choice: video first, real photo always available

Found in `C:/Users/conta/CO-Ads-Launch-2026-10/08 Crunchy Boi 360 Spin (asset)`:

- `Spin_9x16_transparent.webm`: 3,083,919 bytes.
- `Spin_1x1_transparent.webm`: 3,005,028 bytes.
- There are also 16:9 WebM and large ProRes background variants; do not ship ProRes.

These WebMs are prerecorded views, not a mesh. Default compact 1:1; Juan chooses 1:1 versus 9:16 at 375 px. Export/fetch one selected aspect.

Phase 1 does NOT depend on browser alpha compositing anywhere. Hero and SUBDEX sit on solid section backgrounds. PRIMARY source for ALL browsers: H.264 MP4 baked over that exact CSS background colour from the alpha master; optional secondary VP9 WebM is also opaque. MP4 comes first, no alpha feature detection or engine routing. Keep alpha masters private. White-shadow/red-shadow ProRes variants are acceptable only for exactly matching white/red backgrounds. HEVC alpha is phase 2, requiring a Mac.

Encode: probe codec/dimensions/duration; force `-c:v libvpx-vp9` BEFORE WebM input, or use verified ProRes 4444 masters. Default ffmpeg decode can silently drop alpha. Extract alpha plane and verify nonconstant transparency against known-alpha `StampSpin_1x1_3s_ALPHA`; an opaque control fails the decoder check. Composite RGBA onto the recorded section hex BEFORE yuv420p conversion. Export libx264, starting CRF 23/preset slow, 24–30 fps, max 720 px phone dimension, even dimensions/preserved aspect, `-an -movflags +faststart`. Iterate quality/actual bytes: hero full seamless loop ≤1.5 MB; SUBDEX approved 3–5 s catch excerpt from 25 s source ≤1 MB. Optional libvpx-vp9 opaque output has the same budget and is never downloaded alongside MP4. Already-opaque SUBDEX source requires verified matching background; any alpha source follows the same control/decode/composite process.

Prove control/master references and final exports over yellow and ink at 375 px in Playwright Chromium AND WebKit; compare decoder-verified reference frames. Opaque exports retain the exact baked colour, no near-black alpha box or edge/shadow errors. Record real iPhone Safari/Android checks, background hex, commands/tool version, hashes, sizes and screenshots. Failed quality/budget blocks motion acceptance pending adjustment; fallback still alone does not satisfy approved spin motion.

SSR a pre-sized static AVIF/WebP real sm_014 poster (crop/encode only) with dimensioned picture/img and preload only selected responsive candidate; bypass /_next/image for this LCP asset. Attach video after LCP and first-scroll/visibility trigger; muted, playsInline, no audio/scroll-jacking, short CSS entrance. Stop offscreen/hidden, accessible 44 px pause/play control. Reduced motion, Save-Data, JS off, decode failure and autoplay rejection retain the real still.

If CC later approves a real mesh, R3F is a separate amendment with provenance-verified GLB/textures, byte budget and phone measurements; only then select dependencies and add a lazy boundary, capped DPR, demand rendering, context-loss/error fallback and no reduced-motion auto-spin. No mesh creation or WebGL dependency in phase 1.

## Asset pipeline contract

Sources are read-only. Inventory observed: 63 product JPGs `sm_001`–`sm_063`; 101 lifestyle JPGs `sm_064`–`sm_164`.

| Source | Use |
|---|---|
| `C:/Users/conta/co-chief-assets/shoot/Product/compliementsonly_073126_sm_###.JPG` | Confirmed lineup and real hero; preserve the misspelling in source paths. |
| `C:/Users/conta/co-chief-assets/shoot/Lifestyle_Kitchen/complimentsonly_073126_sm_###.JPG` | Catering/shop candidates; identity and visible people/brands checked before selection. |
| `C:/Users/conta/co-3d/logo-pack` | `vector/co-wordmark.svg`, `vector/co-logomark.svg`, `vector/co-icon-flat.svg`; confirm final preferred mark. |
| `C:/Users/conta/CO-Ads-Launch-2026-10/` | Spin above; `03 SUBDEX/SUBDEX_9x16_25s_TEXTLESS-AI-DRAWN.mp4` as approved DRAWN source for a short silent catch excerpt; hashes/timecodes still verified. |

**Confirmed mapping (lead correction; INTAKE 10-05 groups 1–7 confirmation):**

| IDs | Identity | Single representative: highest INTAKE sharp@BIG in range |
|---|---|---|
| 001–004 | Frex | 001 |
| 005–008 | Hot Pants | 005 |
| 009–012 | The Teamster | 011 |
| 014 | Crunchy Boi hero | 014 |
| 018–021 | Marisa Tomei Eats Free | 018, HELD until legal clears name; no card/export |
| 022–025 | Sicky Wicky Club | 024 |
| 026–029 | Never Been Cheddar | 029 |
| 030–033 | Turkey Caesar | 033 |
| 034–037 | Farmers Market | 037 |
| 038–044 | French Dip | 040; avoid soft 042/044 |
| 045–048 | Vesuvio II | 047 |

Ten eligible subs; one card per sub, one unique source ID per card. Unconfirmed/excluded: 013, 015–017, 049, 050–056 and sides 057–063, per lead ruling even where older ledger wording differs. Identity is not crop quality: inspect touched edges particularly 033/040/047; log any substitute within a confirmed range and its reason. Preserve honest portions/hands/jus, no generated reconstruction or duplicate cards for overlapping ranges.
**Found v4 implementation:** `C:/Users/conta/co-scenes-fx-copy/tools/vfx-footage/fxv4/finish.py` (the worktree path associated with fx-copy-matrix). Read `finish_photo(pid, reg, out, target_ab)`, the CLI and the adapter `C:/Users/conta/co-3d/batch4/choose-fighter/scripts/finish_subs.py`. The CLI expects a v3 work registry (`--work`, `--out`, `--only`), not an arbitrary JPG argument. Build a local adapter using an explicit approved source registry; do not assume the built-in PHOTOS list covers these ten eligible products. Recipe: crop/one master resize, BiRefNet matte, closed-form matting, edge decontamination, hero-specific red-bounce correction, grade and capture sharpening. Existing tool emits PNG plus JSON hashes/steps. Inspect its remaining dependencies and pin a Python environment before execution; no tool edits or heavy finishing in this plan task.

Pipeline: source hash + identity evidence → crop registry → v4 RGBA master/sidecar → visual edge/portion/cut-face check → web exports at 480/750/1080 px where source resolution permits → manifest validation. Preserve original and intermediate hashes, tool revision/hash, commands, crop box, dimensions, classification and reviewer. Never overwrite originals. Keep masters/work files ignored under `assets/work/`; copy only approved web derivatives to `public/media/`. Lead ruling overrides spec filename tags: neutral PUBLIC paths; original tagged source names and derived classification live only in private manifest/ledger. Use names such as `crunchy-boi-014.webp`; no classification words appear as UI badges, alt copy or overlaid text. Local manifest contains provenance; public code gets only necessary media metadata, not machine paths.

Use `next/image` with real dimensions and accurate `sizes`, AVIF/WebP negotiation and no below-fold preload. Target static hero poster ≤100 KB at phone size, lineup images ≤100 KB each, spin derivative ≤1.5 MB, SUBDEX excerpt ≤1 MB; if quality fails at the video budget, retain fallback but block motion acceptance until approved adjustment. Crop/encode alone must not be described as food synthesis. v4 grading is REAL-EDITED; no generative fill or portion changes. Unknown provenance fails publication. No asset hotlinking to Drive or claude.ai.

## Order, offer and attribution contracts

All outbound destinations live in `lib/landing/links.ts`; components reference keys, never duplicate URL literals.

| Key | Exact destination |
|---|---|
| `capitolHill` | `https://complimentsonlysubs.appfront.app/order/?branchId=69bdd5a0daeb710cb2cbdb0d&servingOptionType=a` |
| `dupont` | `https://complimentsonlysubs.appfront.app/order/?branchId=69bdddee7150a60c8dc37f73&servingOptionType=a` |
| `cateringOrder` | `https://www.toasttab.com/catering/compliments-only-capitol-hill-526-8th-street-southeast` |
| `cateringInquiry` | `https://complimentsonlysubs.com/washington-capitol-hill-compliments-only-catering-inquiry` |

Prefer branded https://order.complimentsonlysubs.com/order/?branchId=<id>&servingOptionType=a if BOTH branches behave identically in merchant flow. The table is the supplied baseline, not final canonical-host selection. Validate selected store and undocumented servingOptionType=a behavior; do not infer from status. Record exact working parameter form, host and dated evidence in links.ts, avoiding double-encoded %253D= artifacts. Juan confirms below. Resolve the inquiry against the existing main site, never the new landing host. Concurrent spec §4 clarification confirms official links and Toast catering for now; the future fully-live CO-OPS `/order` portal is selected by the single `cateringPortalLive` flag described above, default false; this phase tests both destinations but does not activate the portal. Keep `servingOptionType=a` exactly as Juan supplied; do not reinterpret it as pickup/delivery. Gift cards, app, Uber Eats, DoorDash and social destinations must be sourced from the main site and confirmed before adding to this same config. `tel:` links get syntax tests; every configured HTTP(S) URL gets the live 200 test.

Blocking CI is deterministic: config shape/hosts/branch IDs plus Playwright asserting every rendered href equals its config value. Outbound HTTP(S) anchors set `referrerPolicy="origin"` and `rel="noopener"`, asserted in tests, so Referer excludes ad/fbclid queries.

Live probes are non-blocking in ordinary CI, blocking at launch, and scheduled after deployment in E5. GET, bounded redirects, 15 s timeout and at most one transient retry; record status/final host/response digest. Require 200/approved host; challenge/403/429/timeouts are failure or explicit blocked evidence, never pass. Toast/inquiry can geo-gate non-US runners: use an external US runner. Changed digest raises drift alarm. Assert branch existence from Appfront data payload, not identical SPA shells. Capture manual selected-store and servingOptionType=a checks for both branches on launch day. Automation never places orders.

### Appfront research: supported versus unknown

Official [deal-building instructions](https://help.appfront.ai/en/articles/15538551-building-deals-upsells-in-the-new-portal-a-step-by-step-walkthrough) document promo codes, with restrictions by location/serving option. Official [deep-link technical guide](https://help.appfront.ai/en/articles/16153819-deep-linking-technical-guide-deals-items-locations-serving-options) documents `checkdeal=<DealID>` on the serving-option flow. This is a configured deal identifier, not an arbitrary campaign code. The older [marketing documentation](https://appfront.gitbook.io/portal/digital/marketing) also documents deal links and distinguishes single-use campaign codes that require login.

**Unknown:** no verified generic `promo=`, `coupon=`, or ad-code URL parameter; no proof `checkdeal` composes with this merchant's current `/order/` branch links or survives both branches/serving options. No evidence it automatically produces ad attribution in Toast. Do not append guessed parameters or equate ad code with discount code.

Implement explicit `lib/landing/offers.ts`: ad code → approved display code, terms/expiry, eligible stores, and optional verified DealID/allowed params and link key; links.ts alone owns URL literals and constructs deal destinations. Default links stay unchanged. Only enable deal routing after Juan supplies an active offer/DealID and manual merchant-flow testing passes. Otherwise spec §5 fallback: show “Use code CODE at checkout” only for approved offer-bearing ads, with terms; non-offer/unknown/expired ads show no code. If code redemption itself is not configured, show no offer until it is. Never invent a discount.

Capture only allowlisted `ad`/UTM values plus bounded `fbclid` (1–500 ASCII letters/digits/underscore/hyphen; reject malformed/oversized values); do not store arbitrary query strings, email or phone. Persist approved attribution/fbclid only after consent in sessionStorage; build fbc only from genuine fbclid using documented Meta format and capture timestamp. Test absent/malformed IDs, denial/DNT/GPC/withdrawal and storage errors; before consent use only current-page in-memory allowlisted attribution for offer display, without persistent marketing storage. Handle denied storage and reloads. Strip unrelated query parameters from tracking source URLs. Do not forward landing query strings to vendors by default. Aggregate checkout clicks are a proxy, not purchases or cost per actual order; actual orders/code reconciliation remains an Appfront/Toast/Pete reporting dependency.

## Tracking and privacy contract

Exact environment names (blank in `.env.example`; no real values in repo):

| Variable | Exposure and purpose |
|---|---|
| `NEXT_PUBLIC_META_PIXEL_ID` | Public Pixel ID; absent means no browser Pixel. |
| `META_PIXEL_ID` | Server dataset/Pixel ID for CAPI; must match public ID if both are set. |
| `META_CAPI_ACCESS_TOKEN` | Server-only token. Never `NEXT_PUBLIC_`, logged or returned. |
| `META_GRAPH_API_VERSION` | Explicit supported version verified against Meta docs at activation; absent disables CAPI. |
| `META_TEST_EVENT_CODE` | Optional server-only preview testing; must be unset in production. |
| `SITE_ORIGIN` | Approved landing canonical HTTPS origin; preview scoped separately. |
| `LANDING_HOSTS` | Server-only exact landing host allowlist; empty disables landing tracking. |
| `STAFF_ORIGIN` | Fixed staff/portal HTTPS origin, never allowed as a tracking host. |

No token/ID/version means CAPI performs no outbound request; no public ID means no Pixel script, beacon or noscript tracker. Routes remain safe no-ops (204) when unconfigured. Tests must prove this, including every partially configured state. CAPI can operate without browser Pixel when server settings and consent are valid; browser/CAPI IDs must match when paired.

Before consent, on refusal, DNT=1 or GPC=true: no Meta scripts, cookies, attribution persistence or CAPI traffic. Provide equally accessible Accept/Reject and a persistent privacy-settings control. Consent withdrawal stops future events, clears owned marketing state and applies Pixel revocation; do not replay previously denied events on later acceptance. Store only the consent preference as necessary state. No forms, location coordinates in telemetry, email/phone hashes or customer records. Notice must honestly explain third-party tracking; IP/UA and advertising cookies are personal/online identifiers even though no customer form is collected. Resolve disclosure with Juan before activation.

Events: PageView once per consented page view; ViewContent once per section when meaningfully visible (50% for 1 second); Lead for catering inquiry; InitiateCheckout for both store order links and catering order, carrying allowlisted store/ad/placement. Footer third-party ordering links also emit InitiateCheckout with vendor/store metadata where known. Gift cards/app/social links do not masquerade as store checkout. Do not emit Purchase.

One browser-generated UUID per actual action is shared between Pixel `eventID` and CAPI `event_id`; same `event_name` and dataset. Reuse the ID for retries, create a new one for a new action. `app/api/landing/events/route.ts` accepts only Lead/InitiateCheckout, validated event time/ID, consent, allowed store/ad/placement and sanitized source URL. Same-origin POST only; reject foreign Origin, oversized/malformed bodies, unknown fields/events and invalid consent; impose bounded timeout/rate limits at deployment. Derive consent from the first-party preference plus request, not an unrestricted client boolean. No open proxy, arbitrary destination URL or token in response. Meta response logs contain only redacted status/request diagnostics.

CAPI payload includes `action_source=website`, event name/time/ID, canonical source URL and the minimum consented matching data supported by current Meta requirements (legitimate fbp/fbc if present; UA/IP only if approved and disclosed). Do not invent fbc without a real consented click identifier. Verify current Meta schema/dedup/consent docs during A5; missing lawful usable matching data means do not send a pretend successful event. Use fetch keepalive for navigation delivery; never await analytics before following the native anchor. Delivery is best-effort, not a promise to defeat all blockers. Same-ID transport retries rely on Meta deduplication; do not assume process-local memory works across serverless instances. Tests mock Meta; live Test Events validation is a later credential-dependent gate.

## Implementation chunks

Every task starts with the listed failing tests, then the smallest implementation, then its acceptance command. File lists below name planned files; existing CO-OPS files are amended narrowly, new landing files are isolated. The baseline/reuse and host contracts above also apply to every task. Tests may use fixtures/mocks until approved media or credentials exist, but publication gates cannot be passed by fixtures. Each task is testable on completion; each chunk has 3–5 tasks. CC reviews code and evidence before Juan's phone review and the next chunk.

### Chunk A — skeleton, routing, measurement (5 tasks)

#### Task A1 - integrate portal shell and host boundary

**Files:** `proxy.ts`, `lib/landing/host-shared.ts`, `lib/security-headers.ts`, `next.config.ts`, `app/eat/layout.tsx`, `app/eat/page.tsx`, `components/portal/Reveal.tsx`, `components/portal/FaqItem.tsx`, `lib/i18n/en.json`, `lib/i18n/es.json`, `package.json`, `package-lock.json`, `playwright.config.ts`, `tests/landing/host-matrix.test.ts`, `tests/landing/cookies.test.ts`, `tests/landing/content.test.ts`, `tests/e2e/landing/shell.spec.ts`, `tests/e2e/landing/host-isolation.spec.ts`, `docs/dependency-baseline.md`. Existing config is amended narrowly, not replaced.

**Tests first:** full host/method/route matrix above through production proxy, host-specific CSP/Permissions-Policy, actual response cookie attributes, existing staff/portal regressions; SSR h1/main/native anchors, JS-off visibility, translation parity, 375 px and 44px targets. No tracking on staff even with configured env and accepted consent.

**Acceptance:** `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and new `npm run test:e2e -- tests/e2e/landing/shell.spec.ts tests/e2e/landing/host-isolation.spec.ts` pass; record existing Node 22 runtime/lockfile and added tooling compatibility. Reuse the portal look and local fonts with no new landing WebGL imports. Headers cannot bypass isolation or change staff policy.

#### Task A2 — routing and verified links

**Files:** `lib/landing/links.ts`, `components/landing/OrderLink.tsx`, `app/eat/page.tsx`, `tests/landing/links.test.ts`, `tests/live/landing-links.probe.ts`, `tests/e2e/landing/order-links.spec.ts`, `package.json`.

**Tests first:** config shape, branch separation, inquiry host, every rendered href equals config, origin-only referrer policy/noopener. Live fixtures cover redirects/challenges/missing branches/digest drift. JS-off anchor navigation remains native.

**Acceptance:** targeted unit/Playwright pass deterministically. npm run test:links is separate, non-blocking in ordinary CI and blocking at launch. Preserve both-branch branded-host equivalence and servingOptionType=a merchant-flow evidence; exact working form in links.ts.

#### Task A3 — attribution and offers

**Files:** `lib/landing/offers.ts`, `lib/landing/attribution-shared.ts`, `components/landing/OfferCode.tsx`, `tests/landing/attribution.test.ts`, `tests/landing/offers.test.ts`, `tests/e2e/landing/offers.spec.ts`.

**Tests first:** valid ad and bounded fbclid persist only after consent; genuine fbclid builds fbc, absent/malformed ID does not; unknown/oversized/PII query discarded; unavailable storage safe; offer expired/wrong-store/unapproved has no code; no assumed promo URL parameter; native default order destination remains valid.

**Acceptance:** targeted unit/e2e tests pass with non-offer and approved-offer fixtures. Offer copy cannot be enabled without approved terms and configured merchant redemption. No real offer is created by this task.

#### Task A4 — consent and browser Pixel

**Files:** `.env.example`, `lib/landing/consent-shared.ts`, `lib/landing/tracking-client.ts`, `components/landing/ConsentNotice.tsx`, `components/landing/TrackingProvider.tsx`, `components/landing/SectionView.tsx`, `components/landing/OrderLink.tsx`, `app/eat/layout.tsx`, `tests/landing/consent.test.ts`, `tests/e2e/landing/tracking.spec.ts`.

**Tests first:** absent env/denied/DNT/GPC means zero Meta network requests; accept loads once; withdrawal stops sends; PageView and section visibility events do not duplicate on re-render; keyboard consent controls; inquiry Lead and checkout InitiateCheckout names/parameters correct; IDs stable per dispatch.

**Acceptance:** test suite passes with mocked Pixel and intercepted network; no identifiers in logs or arbitrary URLs. Native order clicks work while Pixel is blocked/slow. Notice meets the disclosure contract.

#### Task A5 — CAPI boundary and initial CI budget

**Files:** `app/api/landing/events/route.ts`, `lib/landing/meta-server.ts`, `lib/landing/rate-limit.ts`, `lib/landing/host-shared.ts`, `lib/landing/tracking-schema-shared.ts`, `lib/landing/tracking-client.ts`, `tests/landing/meta-route.test.ts`, `tests/e2e/landing/dedup.spec.ts`, `.github/workflows/landing-checks.yml`, `lighthouserc.cjs`, `docs/tracking.md`, `package.json`.

**Tests first:** blank/partial env no-op; wrong-host/missing/null/foreign Origin refusal, limiter burst/concurrency/outage and no-PII writes; allowlist and origin/body/time/consent validation; secret redaction; upstream timeout/429/5xx safe; browser and server receive identical event name/ID; repeated transport retains ID; concurrent distinct clicks differ; navigation not delayed. CI fails a deliberately over-budget fixture/config check, then remove the temporary mutation.

**Acceptance:** mocked route/e2e suites, production build and local `npm run perf:ci` pass; workflow defines all gates below. No live Meta call without approved configuration. Document a supported Graph version and current Meta source links before activation; production rejects test event code. Landing CI is an addition to the existing CO-OPS repository workflow, not a replacement.

### Chunk B — asset foundation and hero (3 tasks)

#### Task B1 — asset inventory and provenance adapter

**Files:** `assets/source-manifest.json`, `assets/approved-media.json`, `scripts/assets/inventory.mjs`, `scripts/assets/finish_photos.py`, `scripts/assets/export.mjs`, `scripts/assets/requirements.lock.txt`, `tests/landing/assets.test.ts`, `docs/assets.md`, `.gitignore`.

**Tests first:** whitelist matches eleven confirmed identities, ten eligible; reject legal-held Marisa and all unconfirmed IDs; missing source/hash/sidecar/tag fails; export path cannot escape workspace; original hashes unchanged; fail unknown provenance and oversized export.

**Acceptance:** `npm test -- tests/landing/assets.test.ts` and `npm run assets:check` pass for selected real fixtures. Adapter smoke on one approved image records input/output hashes and tool revision. Remaining media export work follows in C1/D1/D3, with no edits to external originals or tool source.

#### Task B2 — real-photo poster foundation

**Files:** `components/landing/Hero.tsx`, `lib/landing/media.ts`, `app/eat/page.tsx`, `lib/i18n/en.json`, `lib/i18n/es.json`, `public/media/crunchy-boi-014.webp`, `public/brand/co-wordmark.svg`, `assets/approved-media.json`, `tests/e2e/landing/hero.spec.ts`.

**Tests first:** hero image/alt/reserved dimensions and two correct anchors in SSR; JS-off/slow hydration still usable; no optimizer request or video fetch on initial paint; 375 px screenshot with CTAs and no clipped food/text collision.

**Acceptance:** hero e2e and image/manifest gates pass. Juan approves composition and copy. Use static pre-sized original sm_014 crop/encode-only poster, no optimizer round-trip; separate provenance/path from v4 lineup derivative.

#### Task B3 — progressive spin and fallback matrix

**Files:** `components/landing/HeroMotion.tsx`, `components/landing/Hero.tsx`, `lib/landing/media-policy-shared.ts`, `lib/landing/media.ts`, `public/media/crunchy-boi-spin.mp4`, optional `public/media/crunchy-boi-spin.webm`, `scripts/assets/encode-video.mjs`, `assets/approved-media.json`, `tests/landing/media-policy.test.ts`, `tests/e2e/landing/motion.spec.ts`, `docs/hero-decision.md`.

**Tests first:** exactly one aspect fetched after LCP and trigger, reduced motion/Save-Data zero motion download, playback rejection/decode error retains poster, pause/offscreen/visibility behavior, pause keyboard operation; no hydration layout shift. Known-alpha control must pass decoder verification; opaque H.264 primary in Chromium/WebKit over yellow/ink at 375 px; manual iPhone/Android checks.

**Acceptance:** media unit/e2e, decoder-control/browser proof and actual ≤1.5 MB output pass. Record crop/colour/commands/hashes and phone quality. Approved spin required; real still for documented fallback states. No second-aspect fetch or R3F dependencies.

### Chunk C — Field Guide and lineup (3 tasks)

#### Task C1 — finish and export ten eligible products

**Files:** `assets/source-manifest.json`, `assets/approved-media.json`, `public/media/frex-001.webp`, `public/media/hot-pants-005.webp`, `public/media/teamster-011.webp`, `public/media/sicky-wicky-024.webp`, `public/media/never-been-cheddar-029.webp`, `public/media/turkey-caesar-033.webp`, `public/media/farmers-market-037.webp`, `public/media/french-dip-040.webp`, `public/media/vesuvio-047.webp`, `public/media/crunchy-boi-lineup-014.webp`, `tests/landing/assets.test.ts`, `docs/assets.md`.

**Tests first:** every output traces to exact approved ID; dimensions/alpha/hash/budgets; no upscaling below source resolution. Golden visual comparisons check bread edge halos and honest portions, not byte equivalence after grading.

**Acceptance:** `npm run assets:check` and targeted tests pass; review at 375 px and full export scale. French Dip's hand/jus remains authentic; no generated removal. Record representative substitution explicitly if QA demands a different confirmed frame.

#### Task C2 — Field Guide anatomy

**Files:** `components/landing/FieldGuide.tsx`, `lib/i18n/en.json`, `lib/i18n/es.json`, `app/eat/page.tsx`, `tests/e2e/landing/field-guide.spec.ts`, `docs/content-evidence.md`.

**Tests first:** meaningful accessible ingredient list, callouts remain outside food bounds at 375 px and 200% text zoom, order link correct, reduced-motion version reveals all content without scrolling animation dependency.

**Acceptance:** targeted e2e passes; copy/ingredient layers verified against CC's supplied current build sheet; no guessed ingredients. Show real cut face and ending “Fig. 2. Gone.” If sm_014 does not show the required layers clearly, obtain an approved real cut-face source before section approval; do not invent invisible anatomy.

#### Task C3 — swipeable lineup

**Files:** `components/landing/Lineup.tsx`, `lib/landing/products.ts`, `lib/i18n/en.json`, `lib/i18n/es.json`, `app/eat/page.tsx`, `tests/landing/products.test.ts`, `tests/e2e/landing/lineup.spec.ts`.

**Tests first:** ten eligible identities only; legal-held/unconfirmed IDs cannot render; duplicate sub identity or source ID fails (one card per sub, one source per card); keyboard and touch horizontal navigation, usable JS-off overflow layout, lazy responsive images, no page-wide overflow, correct CTA.

**Acceptance:** unit/e2e and asset checks pass; native CSS scroll snap, no auto-carousel, visible focus and accessible controls. Juan approves each card and Field Guide on phone before D.

### Chunk D — remaining sections (4 tasks)

#### Task D1 — SUBDEX moment

**Files:** `components/landing/SubdexMoment.tsx`, `lib/landing/media.ts`, `lib/i18n/en.json`, `lib/i18n/es.json`, `app/eat/page.tsx`, `public/media/subdex-catch.mp4`, `public/media/subdex-catch.webp`, `assets/approved-media.json`, `tests/e2e/landing/subdex.spec.ts`.

**Tests first:** lazy single short muted excerpt, no game controls, no audio download, still on reduced motion/error, play/pause accessible, viewport exit stops playback.

**Acceptance:** targeted e2e/budget and source-hash checks pass, Juan approves catch-sub timecodes. DRAWN approval is settled; never photo-captioned. Apply B3 opaque H.264-primary encode/control/browser matrix and exact solid background, ≤1 MB, including WebKit at 375 px. No alpha dependency; neutral public names/private provenance.

#### Task D2 — store information and opt-in location

**Files:** `components/landing/Shops.tsx`, `components/landing/NearbyShop.tsx`, `lib/landing/stores.ts`, `lib/i18n/en.json`, `lib/i18n/es.json`, `app/eat/page.tsx`, `tests/landing/nearby.test.ts`, `tests/e2e/landing/shops.spec.ts`, `docs/content-evidence.md`.

**Tests first:** no geolocation call on load; explicit click only; grant orders nearest first; denied/timeout/unavailable retains both and native links; no coordinates stored/sent; selectable hours/address/phone and 44 px telephone link.

**Acceptance:** mocked coordinate/distance and e2e tests pass. Juan supplies current addresses/hours/phones and location coordinates. Do not infer walking minutes from straight-line distance: show distance or verified landmark walking copy; both shops remain available.

#### Task D3 — catering

**Files:** `components/landing/Catering.tsx`, `lib/i18n/en.json`, `lib/i18n/es.json`, `app/eat/page.tsx`, `public/media/catering-platter.webp`, `assets/source-manifest.json`, `assets/approved-media.json`, `tests/e2e/landing/catering.spec.ts`.

**Tests first:** only approved real platter photo; two distinct destinations and Lead/InitiateCheckout event semantics; no form/PII collection, text off food, dimensions/alt correct.

**Acceptance:** targeted e2e/asset/URL checks pass. Lifestyle 082–083 are candidates, not preapproved identities; get Juan's photo selection and exact source manifest before export. Copy reads “Catering for the whole office.”

#### Task D4 — footer and final content wiring

**Files:** `components/landing/Footer.tsx`, `lib/landing/links.ts`, `lib/i18n/en.json`, `lib/i18n/es.json`, `app/eat/page.tsx`, `app/eat/privacy/page.tsx`, `tests/e2e/landing/footer.spec.ts`, `tests/live/landing-links.probe.ts`, `docs/content-evidence.md`.

**Tests first:** all required gift/app/social/delivery links from centralized config, selectable addresses, privacy settings reopen, outbound hrefs equal config with origin-only/noopener, gift/app links do not emit InitiateCheckout, heading order remains logical.

**Acceptance:** deterministic e2e passes; live URLs blocking at launch, non-blocking CI. D4 is gated on Juan/Pete supplying verified DoorDash, app/app-store and Facebook destinations (missing from homepage evidence); confirm sourced Uber Eats, Toast gift cards and Instagram too, never invent links; third-party delivery links small and last, warm sign-off approved, consent notice matches privacy copy. Complete all seven sections in order and record Juan's section approvals.

### Chunk E — release evidence and deployment preparation (5 tasks)

#### Task E1 — 375 px, reduced motion and accessibility audit

**Files:** `tests/e2e/landing/mobile.spec.ts`, `tests/e2e/landing/accessibility.spec.ts`, `tests/e2e/landing/resilience.spec.ts`, `playwright.config.ts`, `docs/qa/phase1.md`.

**Tests first:** Chromium and WebKit at 375×812, JS off, reduced motion, blocked media/Meta, keyboard focus/order, 200% zoom, no overflow, images/alt, all interactive targets ≥44×44 CSS px. axe WCAG A/AA scan including consent states.

**Acceptance:** full Playwright passes; zero serious/critical axe violations and all discovered AA failures fixed; manual VoiceOver/iPhone Safari and Android checks recorded. Lighthouse accessibility ≥95 is additional evidence, not proof of conformance. Fixes belong in the responsible earlier task files with regression cases.

#### Task E2 — enforce production performance and CI

**Files:** `lighthouserc.cjs`, `.github/workflows/landing-checks.yml`, `scripts/check-transfer-budget.mjs`, `tests/e2e/landing/performance.spec.ts`, `package.json`, `docs/qa/phase1.md`.

**Tests first:** budget checker fails oversized fixture, browser test asserts no eager video/3D, build served in production mode. LHCI mobile simulated 4G, 4× CPU slowdown, 375 px viewport, three cold runs. Run both consent states; CONSENTED path is the gate. Gate median Performance ≥85, Accessibility ≥95, LCP <2500 ms, CLS ≤0.1, TBT ≤200 ms. Store all reports; inspect variance rather than selectively rerunning a failure.

**Acceptance:** CI npm ci/typecheck/unit/build/Playwright/deterministic-links/assets/perf gates pass; live probes separate/non-blocking. LCP-critical compressed bytes ≤250 KB (poster ≤100 KB plus HTML/critical CSS/fonts/any blocking resources); initial JS ≤200 KB without delaying poster; total initial transfer ≤500 KB is an outer ceiling, not an LCP allowance. After full scroll lazy media total ≤5 MB. Measure browser requests including consented Meta costs; attach video after LCP.

Three cold production runs per state: mobile 4G 1.6 Mbps/150 ms RTT, 4× CPU, 375 px. Seed accepted consent before navigation for gating run; also report no-consent. Deterministic CI may intercept Meta with a versioned representative fixture; activation MUST repeat the CONSENTED gate with real fbevents.js/Meta traffic and identical thresholds, also report no-consent. Missing live configuration blocks paid launch, never silently chooses faster path. Store all reports privately, inspect variance and record mid-range-phone/4G checks.

#### Task E3 — deployment runbook, no resource creation yet

**Files:** `docs/deploy.md`, `docs/release-checklist.md`, `.env.example`, `app/robots.ts`, `app/sitemap.ts`, `app/eat/layout.tsx`, `tests/landing/deployment.test.ts`, `public/brand/og-card.webp`, `app/eat/icon.png`, `app/eat/apple-icon.png`, `public/brand/landing-favicon.ico`.

**Tests first:** preview is noindex, production canonical uses approved origin, OG/Twitter title/description/image and theme-color match approved content, icon set reuses logo-pack assets, no secrets client-side, no production test event code, no remote resources required for local build; native order links unchanged across origins.

**Acceptance:** local suite/build pass and CC-reviewed runbook is ready. Use the existing CO-OPS GitHub repository and Vercel project. Nothing is created now. At deploy time Juan approves the exact domain alias (`eat.complimentsonlysubs.com`, or a dedicated Vercel alias until GoDaddy access) and environment changes; CC handles normal review/commit/push/deploy flow. Astra never pushes/merges/deploys. Configure LANDING_HOSTS, STAFF_ORIGIN and SITE_ORIGIN with separate preview/production scopes. Global Pixel env is never itself permission to load tracking. Verify the host matrix and staff login/portal smoke on the same deployment before ad activation. Keep app-wide metadata/icons and staff canonical intact; landing metadata is scoped under app/eat, with host-aware public robots/sitemap routes included in the proxy allowlist. Never replace the staff root or set the whole project to landing noindex/canonical. If no approved preview exists, CC arranges phone access locally; unavailable access leaves the phone-review gate blocked.

#### Task E4 — Meta activation, approved preview, DNS cutover and rollback

**Files:** `docs/deploy.md`, `docs/qa/phase1.md`, `docs/release-checklist.md`.

**Tests first:** checklist requires preceding evidence, all section approvals, fresh URL 200 checks, production env audit, mandatory Meta activation/Test Events evidence before paid spend, and pre/post-DNS HTTPS/canonical/noindex checks. Dry-run records current DNS values and rollback target without changing DNS.

**Acceptance:** after Juan approves the domain alias and Pete provides GoDaddy access, authorized operator adds the chosen subdomain to the existing CO-OPS Vercel project, uses the exact DNS record Vercel supplies, preserves apex/www/MX/SpotHopper, waits for DNS/TLS verification, sets production origin/canonical and removes production noindex. Re-run smoke/URL/perf/consent checks on public HTTPS before switching ad destinations. Pete owns Meta Business Manager domain verification, pixel host allowlisting and Aggregated Event Measurement configuration before activation. Juan supplies credentials via deployment env only. With env set, Pete records Test Events showing PageView/ViewContent/Lead/InitiateCheckout; paired Lead/InitiateCheckout browser eventID equals server event_id with no duplicate and stable retries. PageView/ViewContent remain browser-only under A5 allowlist. Pete records match-quality acceptance criteria/evidence. Missing configuration or dedup/match-quality failure blocks paid spend: disable tracking and hold/restore previous ad destinations, fix and revalidate. E5 must pass before any spend. Keep prior ad destinations and DNS values for rollback; restore them or roll Vercel back if checks fail. Preview stays noindex. No inferred DNS target, no main-site migration, no claim of completed deployment while access is absent.

#### Task E5 — Launch monitoring (required before paid spend)

**Files:** `.github/workflows/launch-monitor.yml`, `scripts/probe-money-path.mjs`, `tests/landing/monitor.test.ts`, `docs/monitoring.md`, `docs/release-checklist.md`.

**Tests first:** fixtures fail missing/wrong payload branch despite 200 shell; redirects/host drift, response-digest drift, challenge/403/429/timeout, Toast/inquiry geo-blocks, landing 5xx, alerts/recovery. All five destinations independent; deliberate failure must deliver an alert.

**Acceptance:** GitHub Actions cron in this CO-OPS repo, using an external US probe every 15 min once deployed (`*/15 * * * *`): landing page, both order links, the active catering destination (Toast now, configured portal after the flag switches) and inquiry. Discover/document actual Appfront data endpoint/schema in merchant inspection, assert expected branch existence from payload, never shell status or invented endpoint. Record status/final host/response digest plus normalized branch-data digest; reviewed baseline, drift alarm, no auto-accept of changes. Dynamic shell changes may be triaged, never excuse missing branches. Successful external run and intentional alert delivery required before spend.

Default alert: GitHub Actions failure email to repo owner, notifications enabled and receipt tested; Juan selects channel below. GitHub schedules may delay: record heartbeat/stale-run alert and use an external scheduler if quarter-hour cadence cannot be demonstrated. Owner Juan pauses Meta spend for a broken order link, or landing page returning 5xx for more than 10 min. A 15-min baseline cannot promptly prove a 10-min outage: first 5xx triggers 1-min incident rechecks through >10 min; record first failure/recovery and worst-case detection delay, pause immediately if existing evidence proves >10 min. Missing probes are not recovery. Juan verifies recovery before resuming spend. Manual both-store selection/serving-option check is launch-day evidence alongside payload checks.

## Plan handoff and verification limits

This revision edits only this plan and spec section 6; 20 tasks remain (A/B/C/D/E = 5/3/3/4/5). It preserves r2 asset/source evidence, all seven sections, hero encodes, merchant verification, consent/fbclid/dedup, budgets, a11y and monitoring gates. Implementation, encodes, browser runs, Meta activation and deployment remain future acceptance work. Local clone has pre-existing missing tracked public/scripts/supabase files and some root read restrictions; do not treat those as this revision's changes. Revision verification: `npm.cmd test` could not start (EPERM reading package.json); the PowerShell npm shim also hit execution-policy denial. Scoped document whitespace and structural checks are run separately; do not claim runtime isolation tested from docs alone. Branch feat/landing-p1 at b1aa4c67, changes uncommitted. CC cross-family review of r3 remains required before app code.

## Changes from r2

- Retargeted standalone repo/scaffold/version upgrades to existing CO-OPS paths, runtime, lockfile and same Vercel project.
- Added host-first proxy/matcher isolation, exact LANDING_HOSTS gating, staff-safe CSP, preview behavior and production host matrix tests.
- Confirmed host-only staff/portal cookies and planned response/browser regression assertions.
- Moved CAPI to `/api/landing/events`, with independent host/Origin checks, durable rate limiting, dormant configuration and no customer-PII DB writes.
- Named exact portal token/font/component/image-map reuse, progressive-enhancement fixes, en/es parity and single catering destination flag.
- Preserved house CI; added path-filtered browser/LHCI gates and same-repo E5 cron; deploy-time alias approval replaces new repo/project approval.
- Amended spec section 6 with Juan's decision and rationale. All still-applicable r2 content and remaining Juan questions retained.

## Questions for Juan (only remaining decisions)

1. Hero crop: compact 1:1 or taller 9:16 at 375 px? Default 1:1.
2. Confirm any unconfirmed 013/015–017/049/050–056/sides, and Marisa legal hold status; none is required for ten eligible cards.
3. Approve real cut-face/platter selections and current ingredient copy/shop hours/phones/addresses/walking copy; lifestyle 082–083 and 139–144 remain selection candidates.
4. Which ads carry approved offers with terms/expiry/stores; who supplies DealIDs and validates redemption/Toast reporting?
5. Juan: confirm branded ordering host if both branches pass merchant-flow equivalence.
6. Juan/Pete: supply verified DoorDash, app/app-store and Facebook URLs; confirm gift cards, Uber Eats and Instagram for D4.
7. Approve tracking disclosure/minimum matching data; credentials via deployment env only. Pete owns Meta activation; who owns weekly order reconciliation?
8. Approve the exact landing domain alias on the existing CO-OPS Vercel project at deploy time (suggested eat.complimentsonlysubs.com, or a dedicated Vercel alias pending DNS); when can Pete provide GoDaddy access?
9. Which alert channel reaches Juan? Default GitHub Actions failure email to repo owner, receipt tested before spend.
