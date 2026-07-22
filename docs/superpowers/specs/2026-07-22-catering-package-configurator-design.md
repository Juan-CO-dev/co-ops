# Catering package configurator (sub-project B) — design

**Date:** 2026-07-22
**Status:** approved (design); ready for implementation plan
**Predecessors:** W1a pricing, W1b package builder (migration 0136), the operational seed (16 packages + 108 slot options), sub-project A (per-item sizes, PR #159), the ⑤ order-funnel carry-through (PR #158).

## Goal

Make catering **packages** (lunch boxes, 3-/6-foot subs, sandwich platters) real, orderable, **configurable** line items in the customer order flow — instead of static marketing CTAs. The customer composes each package (picks the sub(s)) on the build page next to the cart; `resolveLines` prices a `packageId` line; the picks are stored structurally so the quote/kitchen see the exact composition.

## Scope

**In (sub-project B):**
- A `packageId` branch in `resolveLines` (D20 server pricing of a package line).
- Structured storage of the customer's slot picks (new table `catering_quote_item_options`).
- A public package loader that includes each package's slot(s) + eligible options + pick-N.
- Build-page **Packages section** + a **configurator** (pick-1 radio; pick-N whole-sub allocator).
- Marketing page (`/order`) package cards get an **"Add to order"** that carries `{packageId, qty}` to the order flow (the ⑤ carry-through, unconfigured).
- Review/quote rendering of a package line with its composition.
- Seed reconcile: platter slot `pick_n` → **whole-sub count** (currently counts pieces).

**Out (deferred):**
- **W4a prep-demand consumption** of the stored picks (choice slot → the chosen concrete subs flowing to prep/SKU demand). Today the W4a path leaves a package's choice slot "unresolved/advisory"; that behavior is unchanged by B. Wiring it to read `catering_quote_item_options` is a fast follow.
- **Sub-project C** — admin catering-menu enable/disable toggle + size/package editing.
- Per-line allergens/notes for package sub picks (the existing 3a display-only pattern applies; no server home).

## Domain model (grounded)

Every seeded package = **one choice slot** with N eligible options (all `menu_item` subs today):

| Package | pricing_mode | price | min_hc | lead | slot | pick-N (seed = pieces) |
|---|---|---|---|---|---|---|
| 8 pc platter | per_platter | $60 | 4 | 24h | "Choose your sub" | 8 → **4 subs** |
| 16 pc platter | per_platter | $115 | 8 | 24h | " | 16 → **8 subs** |
| 32 pc platter | per_platter | $210 | 16 | 24h | " | 32 → **16 subs** |
| 48 pc platter | per_platter | $330 | 24 | 24h | " | 48 → **24 subs** |
| Three Footer | per_platter | $135 | 6 | 48h | "Choose your sub" | 1 (whole-sub) |
| Six Footer | per_platter | $260 | 15 | 72h | " | 1 (whole-sub) |
| Light Lunch | per_head | $12 | 1 | 24h | "Choose your sub" | 1 |
| Full Lunch | per_head | $19.99 | 1 | 24h | " | 1 |

**Platter composition (Juan):** a platter is whole subs cut into fractions — an **8-piece = 4 subs, each halved**. The customer allocates **whole subs** across the eligible sub types (unit stored = whole-sub-equivalents); the piece count + cut are display info. **v1 cut default = halves everywhere** → sub-count = pieces/2 (8→4, 16→8, 32→16, 48→24). 3-/6-footers stay pick-1 (the whole sub is one choice). `pricing_mode` is a display label — all packages price as `price_cents × quantity`.

## Data model

### Migration `0144_catering_quote_item_options`
```sql
create table public.catering_quote_item_options (
  id uuid primary key default gen_random_uuid(),
  quote_item_id uuid not null references public.catering_quote_items(id) on delete cascade,
  package_item_id uuid not null references public.catering_package_items(id),
  item_id uuid references public.items(id),
  menu_item_id uuid references public.menu_items(id),
  quantity numeric not null check (quantity > 0),
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint catering_quote_item_options_one_ref check ((item_id is null) <> (menu_item_id is null))
);
create index catering_quote_item_options_quote_item_idx on public.catering_quote_item_options(quote_item_id);
alter table public.catering_quote_item_options enable row level security;
create policy catering_quote_item_options_no_user_insert on public.catering_quote_item_options for insert with check (false);
create policy catering_quote_item_options_no_user_update on public.catering_quote_item_options for update using (false);
create policy catering_quote_item_options_no_user_delete on public.catering_quote_item_options for delete using (false);
```
- **`ON DELETE CASCADE`** is load-bearing: `setDraftLines` hard-deletes `catering_quote_items` for the quote then re-inserts (draft.ts:439). Cascade removes the stale options automatically; the new options are inserted against the *new* line ids.
- Deny-all RLS, no select policy (default-deny) — service-role/lib is the authority, mirrors `catering_package_slot_options` and `item_sizes`.
- `quantity` = whole-sub-equivalents for that option (platter: e.g. Teamster ×2; lunch box / big sub: 1).

### Seed reconcile (gated, prod)
Script `scripts/seed/09-platter-slot-subs.ts` (idempotent, `SEED_DRY=1` → Juan gate → prod): for the four piece-platters at both locations, set the choice line's `quantity` (pick-N) to the **sub-count** (pieces/2) and update its `description` to read in subs (e.g. "Choose your subs (×4)"). 3-/6-footers + lunch boxes unchanged. Audit `catering.kb.packages.line_item_update` per row.

## Pricing & validation (D20)

`resolveLines` gains a **packageId branch**, after the item/sub branches:
- Loads the package set for the location **once** (only when the payload has package lines) via the extended public package loader; keys by `package_id`.
- `unitPriceCents = package.priceCents`; `lineTotalCents = priceCents × quantity`. The picks **never** affect price.
- Validates each supplied option against the package's real slot options: the `(packageItemId, ref)` must be an active eligible option of that package; `quantity > 0`; the per-slot pick sum must be **≤ pickN** (over-pick → `invalid_line`). **Under-pick / empty is allowed** (an unconfigured carried-in package still prices; completeness is a UI nudge).
- Returns a `ResolvedLine` carrying `packageId` + the validated `options[]` (attached so `setDraftLines` can persist them).
- `description` = the package label (a picks summary is derived client-side + for the quote view; the column stays the label).

`min_headcount` / `lead_time_hours` are **advisory** — surfaced in the configurator + review as guidance, never a hard server gate (consistent with the rest of catering; the team confirms every order anyway).

## Loader + plumbing

**`lib/portal/menu.ts` — `loadPublicCateringPackages`** extended to include, per package: `pricingMode`, `priceCents`, `minHeadcount`, `leadTimeHours`, and `slots: Array<{ packageItemId, label, pickN, options: Array<{ kind: "item"|"menu_item", refId, name }> }>` (mirrors the admin `hydratePackages` options load: batch-load `catering_package_slot_options` for the fixed+choice lines, resolve names). Existing `items`/`unitPriceCents` expansion for fixed lines stays for the marketing display.

**`lib/portal/draft.ts`:**
- `DraftLineInput` gains `packageOptions?: Array<{ packageItemId: string; itemId?: string | null; menuItemId?: string | null; quantity: number }>`.
- `ResolvedLine` gains `options: Array<{ packageItemId; itemId; menuItemId; quantity }>` (empty for non-package lines).
- `resolveLines` packageId branch (above).
- `setDraftLines`: after the re-insert, `.select("id, display_order")` to map `display_order → new quote_item id`, then bulk-insert `catering_quote_item_options` for every resolved line with options. (Cascade already cleared the old ones on delete.)
- `loadDraft`: batch-load `catering_quote_item_options` for the loaded package lines; attach to `DraftItem.options`.
- `DraftItem` gains `options: Array<{ packageItemId; itemId; menuItemId; quantity }>` (empty otherwise).

**`app/api/portal/magic-link/request/route.ts` — `parsePreselect`** accepts a package entry `{ packageId, quantity }` (UUID + qty 1–99). No options carried from marketing (unconfigured). `DraftIntake.preselect` + `createDraftFromIntake`'s `setDraftLines` pre-seed pass it through (best-effort, unchanged pattern).

## UX

### Marketing page (`/order`) — look + carry only
The package marketing sections (platters, big subs, lunch boxes) render from real packages (real ids + prices) but stay visually the marketing cards. Each gets an **"Add to order"** that stashes `{ packageId, quantity: 1 }` into the `co_order_preselect` sessionStorage (the ⑤ mechanism). **No configurator on the marketing page.**

### Build page (`/order/build`) — configure with the cart
- A **Packages** section (from the extended loader) lists each package (name, "from $X", min-headcount/lead advisory) with a **"Choose / Build →"** button.
- **Configurator modal** (shared component), per slot:
  - **pick-1** (lunch boxes, big subs) → a radio list of the eligible subs (choose one).
  - **pick-N** (platters) → a **whole-sub allocator**: `[−] n [+]` per eligible sub with a running "**4 of 4 subs** ✓"; "served as 8 halves" shown as info; **Add** enabled only when the slot(s) are complete (client gate) — but the server still accepts an under-pick for the carried-in case.
  - package quantity stepper (per_head boxes default qty = lead headcount; platters/big-subs default 1).
- **Cart line** for a package: the package name + a **picks summary** ("Teamster ×2, Crunchy Boi ×1, Hot Pants ×1"), qty, `price_cents × qty`; a "Configure" affordance re-opens the modal. A **carried-in** (marketing) package shows **unconfigured** with a "Choose your subs →" prompt.
- Package cart entries key by a **per-instance local id** (not deduped by packageId) so two differently-composed platters are two lines; on hydration they key by the persisted `quote_item` id. `Line` gains `packageId?` + `packageOptions?`; the persisted payload for a package = `{ packageId, quantity, packageOptions }`.
- Coverage: a package counts toward "mains" by its total sub-count × qty (best-effort, consistent with the existing heuristic).

### Review / quote (`/order/review`, `/order/quote/[id]`)
A package line renders with its composition summary (from `DraftItem.options`), qty, and price. Read-only surfaces; no new pricing.

## Error handling
- `resolveLines` throws `PortalDraftError(400, "invalid_line", …)` for: unknown package, an option that isn't an eligible slot option, over-pick (> pickN), non-positive qty. Under-pick is allowed.
- The lines route already maps `PortalDraftError` → its status; the package-options payload is validated shape-only at the route (arrays/strings/UUIDs), re-validated for real in `resolveLines`.
- Marketing carry is best-effort (a stale/invalid `packageId` is dropped in `parsePreselect`, never fails order creation — the ⑤ pattern).

## Testing
- **Fable read-only smoke (prod):** `loadPublicCateringPackages(CAP_HILL)` returns Light Lunch (pick-1, 15 options) + 8pc platter (pick-N = 4 subs after reconcile, 5 options) with correct prices; a package `resolveLines`-backed `setDraftLines` line `{ packageId: <lunch>, quantity: 1, packageOptions: [{ packageItemId, menuItemId: <teamster>, quantity: 1 }] }` prices at 1200 and persists a `catering_quote_item_options` row; an ineligible option and an over-pick both throw `invalid_line`. (If it must create a draft, clean up via service-role.)
- **Manual smoke (preview, Juan):** marketing "Add to order" carries a package → build page shows it unconfigured → configure a lunch box (pick 1) + an 8pc platter (allocate 4 subs) → both price correctly, survive to review with the right composition + subtotal.
- `tsc --noEmit` + `next build` green; CI `build` gate.

## File structure
- **Create** `supabase/migrations/0144_catering_quote_item_options.sql` (CC, apply via MCP).
- **Create** `scripts/seed/09-platter-slot-subs.ts` (CC, gated prod).
- **Modify** `lib/portal/menu.ts` — `loadPublicCateringPackages` slots/options (CC).
- **Modify** `lib/portal/draft.ts` — `DraftLineInput.packageOptions`, `ResolvedLine.options`, `resolveLines` package branch, `setDraftLines` option persistence, `loadDraft` option hydration, `DraftItem.options` (CC — D20).
- **Modify** `app/api/portal/order/draft/lines/route.ts` — pass `packageOptions` through the payload map (CC).
- **Modify** `app/api/portal/magic-link/request/route.ts` — `parsePreselect` package entry (CC).
- **Modify** `app/order/build/page.tsx` (+ a `PackageConfigurator` component) — Packages section + configurator + cart line (Sonnet).
- **Modify** `app/order/page.tsx` (+ storefront package cards) — data-driven package cards + "Add to order" carry (Sonnet).
- **Modify** `app/order/review/*` + `app/order/quote/[id]/*` — render a package line's composition (Sonnet).

## Model tiering
CC authors the migration + seed + the D20/sensitive server layers (`resolveLines`, `draft.ts`, the loader, the routes), owns all git + migrations, and is sole reviewer. Sonnet builds the build-page configurator + marketing cards + review rendering. Fable runs the read-only smoke. Ships as one PR through the CI build gate; Juan merges.
