# ⑤ Order-Funnel Carry-Through (design)

**Status:** approved 2026-07-21 (Juan). Funnel-continuity follow-up to 3a-core (the order
draft artifact) and Stage 6 of the operational seed (which populated the real catering menu
this feature now surfaces).

## Goal

Make the storefront `/order` "function like a cart without being one": tapping **Add to order**
on menu items captures a lightweight selection that carries through the intake + magic-link
round-trip and **pre-seeds the `/order/build` cart**, so the customer lands in the builder with
their picks already in the cart. Also: retire the storefront's hardcoded mockup data so the
marketing page renders from the real seeded menu and stays in sync forever.

## Current state (grounded 2026-07-21)

- **`/order` storefront** (`app/order/page.tsx`) — a **static marketing mockup**: hardcoded
  `SUBS`/`PLATTER_SIZES`/`SIDES`/`SWEETS`/`DRINKS` arrays; per-sub Toast S3 photos keyed by name;
  the "Add to order" chips are **decorative** (not clickable); the only real CTA is
  `<CtaButton>` → `/order/start`.
- **`/order/build`** (`app/order/build/page.tsx`) — **fully live**, server-backed: loads the
  customer's owned draft (`?draft=<quoteId>` → `GET /api/portal/order/draft/[quoteId]`), renders
  the **real** catering menu (`draft.menu`, `CateringMenuItem[]`), and **hydrates its cart from
  `draft.items`** (persisted `catering_quote_items`). Post-Stage-6 the menu is populated (62
  menu_items). **No change needed here** — a draft born with lines just shows them.
- **The thread** — intake flows server-side: `start-client.tsx` new-client path POSTs the full
  `intake` payload to `/api/portal/magic-link/request`; on magic-link consume the server calls
  `createDraftFromIntake(customerId, intake)` (`lib/portal/draft.ts:205`) which creates the
  `catering_quotes` draft + pipeline lead. `DraftIntake` is defined at `lib/portal/draft.ts:48`.
  (An older client-side sessionStorage intake hand-off was intentionally removed; the intake now
  rides the magic link server-side.)

## Architecture (three pieces + a data-source swap)

### A. Data-driven storefront (same marketing layout, real data)
`app/order/page.tsx` becomes a **Server Component** that loads the real catering menu (reuse the
public, un-gated menu loader already used to build `draft.menu` — `lib/portal/menu.ts` /
`lib/catering/menu.ts`, `CateringMenuItem`) and renders the existing marketing layout from it:
- **Subs grid** ← portionable `menu_item`s (section "Subs"), each with a real id + name + price
  + description + photo (see Images below) and a functional **Add to order** button.
- **Sandwich Platters / Lunch Boxes / Really Big Subs** ← `catering_packages` (labels, prices,
  serves). Packages are choose-your-sub — for the carry-through they forward as a package
  selection reference (a `catering_packages` id), OR are left as marketing-only CTAs in v1 (they
  need the slot-picker that lives in the builder). **v1 decision:** packages stay marketing CTAs
  (→ `/order/start`); only à-la-carte subs/sides/drinks get Add-to-order (they map cleanly to a
  single `menu_item`/`item`). Packages carry-through is a fast-follow once the builder grows a
  package path.
- **Sides / Sweets / Drinks** ← resale `menu_item`s + `items` where `sold_directly` (the salads/
  dips): Add-to-order carries the `menu_item` id (resale) or `item` id (sold-directly side).
- Static marketing sections (hero, how-it-works, reviews, locations, FAQ) stay as-is.

Drop the hardcoded menu arrays. The page is public + un-gated (same exposure as today — not linked
from the main marketing site).

**Images:** `menu_items` has no image column. Keep a small **name→image presentational map**
(`components/portal/storefront-images.ts`) seeded from the current Toast S3 URLs (they key by sub
name and match), with a generic fallback for unmapped items. Zero schema change. (A durable
`menu_items.image_url` column is a clean future follow-up, out of scope here.)

### B. Selection tray (client island)
New `components/portal/StorefrontOrderTray.tsx` (client), mounted by the server page and given
the menu ids it renders Add-to-order buttons for:
- State: `Map<refKey, { kind: "menu_item"|"item"; id: string; name: string; qty: number }>`
  where `refKey = ${kind}:${id}` (mirrors the build page's cart key so id-spaces don't collide).
- **Add to order** increments qty; a persistent floating pill **"N items · Start your order →"**
  (bottom-center, mobile-first) opens a compact tray with per-line +/− and remove. **No prices,
  no coverage, no portions** — item + qty only.
- On "Start your order", writes the selection to `sessionStorage` under a scoped key
  (`co_order_preselect`) and navigates to `/order/start`. (sessionStorage is the transport for
  this same-session storefront→intake hop only; it is NOT the intake payload — the intake still
  flows server-side via the magic link.) Empty tray → the pill still routes to `/order/start`
  (unchanged behavior).

### C. Pre-seed the draft
1. **`DraftIntake`** (`lib/portal/draft.ts`) gains optional
   `preselect?: Array<{ menuItemId?: string | null; itemId?: string | null; quantity: number }>`
   (exactly one of menuItemId/itemId per entry; quantity a positive int).
2. **`start-client.tsx`** reads `sessionStorage.co_order_preselect` on mount, shows a small
   "N items from the menu will be added to your order" confirmation line in the intake form, and
   includes `preselect` in the `intake` object POSTed to `/api/portal/magic-link/request`.
   Clears the sessionStorage key after reading.
3. **`parseIntake`** (the intake whitelist/validator on the magic-link request path — same place
   FR-b extended for routing fields) accepts `preselect`, validating each entry: a real UUID in
   exactly one of menuItemId/itemId, `1 ≤ quantity ≤ 99` (integer); drops malformed entries.
4. **`createDraftFromIntake`** — after creating the quote, if `intake.preselect` is non-empty,
   resolve each ref against the location's active catering menu (guard: only insert refs that
   exist in the menu + are catering-orderable — never trust the client ref blindly), insert them
   as `catering_quote_items` (portion `whole`, the given qty, server-derived unit price), and
   recompute the charge stack (reuse the same line-insert + stack recompute the draft-lines API
   uses). Audit the pre-seed on the quote.
5. **Build page** — unchanged; hydrates the pre-seeded lines from `draft.items`.

## Data flow (one line)
`/order` tap Add → tray (client state) → `sessionStorage` → `/order/start` intake form → `intake.preselect`
→ `/api/portal/magic-link/request` (validated) → email → consume → `createDraftFromIntake` inserts
`catering_quote_items` → `/order/build` hydrates cart.

## Security / integrity
- Server-side price + existence authority is preserved: `createDraftFromIntake` **re-resolves**
  every preselect ref against the real menu and derives prices server-side; the client only ever
  sends references + qty (same contract as the build page's draft-lines API, D20).
- `preselect` is validated + capped in `parseIntake`; malformed/oversized entries are dropped, not
  errored (the intake must still succeed).
- No new auth surface: the storefront stays public/un-gated (read-only menu); the draft is still
  born only on magic-link consume tied to the verified customer.

## Out of scope (fast-follows)
- **Package carry-through** (platters/lunch boxes/footers) — needs a builder package/slot path;
  v1 leaves packages as marketing CTAs.
- **Portion carry-through** (¼/½/whole from the storefront) — portions stay a build-page choice.
- **Durable `menu_items.image_url`** — presentational name→image map for now.
- **Coverage/pricing on the storefront** — intentionally absent (it's not a cart).

## Testing
- Build-green + `tsc`. Screenshot the data-driven storefront (renders real menu, marketing layout
  intact, images present). Smoke the full thread on a preview: tap Add on 2 subs → Start your
  order → intake → magic link → build page shows the 2 subs pre-seeded with the correct
  server-priced subtotal. Empty-tray path still works (→ intake, empty draft). Malformed preselect
  (hand-crafted) is dropped, intake still succeeds.

## Files
- Modify: `app/order/page.tsx` (server component + real menu render + mount tray).
- Create: `components/portal/StorefrontOrderTray.tsx`, `components/portal/storefront-images.ts`.
- Modify: `app/order/start/start-client.tsx` (read preselect, confirm line, include in payload).
- Modify: `lib/portal/draft.ts` (`DraftIntake` + `createDraftFromIntake` pre-seed).
- Modify: the magic-link request route / `parseIntake` (whitelist `preselect`).
- Reuse: `lib/portal/menu.ts` / `lib/catering/menu.ts` (public menu loader), the draft-lines
  insert + charge-stack recompute in `lib/portal/draft.ts`.
