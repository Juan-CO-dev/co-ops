# Catering Menu Sub-project A (à-la-carte + side sizes) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`. Real code + a migration + a gated prod seed. CC (main loop) authors the sensitive server/pricing/cart layers (Tasks 1–5), owns the migration (apply via Supabase MCP) + all git, and is SOLE reviewer of every diff; Sonnet builds the build-page + storefront UI (Tasks 6–7); a Fable smoke in Task 8. Ships as one PR through the CI build gate; Juan merges.

**Goal:** Give side `items` explicit-price catering **sizes** (½-pint / 32oz…) that thread through the whole order pipeline, and seed the catering-only bundles/new salads — so the `/order` à-la-carte catering menu is complete.

**Architecture:** New `item_sizes` table (per-item, explicit `price_cents`) + `catering_quote_items.size_id`. `buildCateringMenuItem` derives each size's catering price (`size.price_cents × rate`); the portal loader joins sizes onto `CateringMenuItem.sizes`; the cart line carries `sizeId`, priced server-side by `resolveLines` from the loaded menu's sizes (D20). Build page gets a SizeSelector; storefront Add carries the default size. Packages (B) + admin (C) are out of scope.

**Tech Stack:** Next 16, React 19, Tailwind v4, TS strict + `noUncheckedIndexedAccess`, Supabase (service-role + RLS), the existing `lib/catering/menu.ts` + `lib/portal/{menu,draft}.ts`.

**Branch:** `claude/catering-menu-sizes-a` (off `origin/main` @ 256c8b6; spec committed).

---

## File structure
- **Create** `supabase/migrations/0143_item_sizes.sql` (Task 1).
- **Modify** `lib/catering/menu.ts` — `CateringMenuItem.sizes` + `buildCateringMenuItem` sizes (Task 2).
- **Modify** `lib/portal/menu.ts` — join `item_sizes` in `loadPublicCateringMenu` (Task 3).
- **Modify** `lib/portal/draft.ts` — `DraftLineInput.sizeId`, `resolveLines` size branch, `DraftItem.sizeId`, `loadDraft` `size_id` (Task 4).
- **Modify** `app/api/portal/magic-link/request/route.ts` — `parsePreselect` `sizeId` (Task 4).
- **Create** `scripts/seed/08-catering-sizes.ts` (Task 5).
- **Modify** `app/order/build/page.tsx` — SizeSelector + cart sizeId (Task 6).
- **Modify** `app/order/page.tsx` + `components/portal/StorefrontOrderTray.tsx` — "from" price + default-size Add (Task 7).

---

## Task 1: Migration 0143 — `item_sizes` + `catering_quote_items.size_id` (CC)

**Files:** Create `supabase/migrations/0143_item_sizes.sql`.

- [ ] **Step 1: Confirm 0143 is next** — `list_migrations` tail shows 0142 latest.
- [ ] **Step 2: Apply via Supabase MCP `apply_migration`** (name `0143_item_sizes`), with the split deny-all RLS mirroring `item_components` (NO select policy → default-deny; explicit insert/update/delete denies — never `FOR ALL`):

```sql
-- Migration 0143_item_sizes
-- Applied via Supabase MCP apply_migration on 2026-07-22.
-- Catering sub-project A: per-item explicit-price catering sizes for side items + the chosen
-- size on a cart line. Deny-all config table (service-role/lib authority) — mirrors item_components.
create table public.item_sizes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  label text not null,
  price_cents integer not null check (price_cents >= 0),
  serves numeric,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (item_id, label)
);
alter table public.item_sizes enable row level security;
create policy item_sizes_no_user_insert on public.item_sizes for insert with check (false);
create policy item_sizes_no_user_update on public.item_sizes for update using (false);
create policy item_sizes_no_user_delete on public.item_sizes for delete using (false);
create index item_sizes_item_id_idx on public.item_sizes(item_id) where active;

alter table public.catering_quote_items
  add column size_id uuid references public.item_sizes(id);
```

- [ ] **Step 3: Verify on prod** — `execute_sql`: `select count(*) from item_sizes;` (0) and `information_schema.columns` shows `catering_quote_items.size_id`.
- [ ] **Step 4: Write the repo file** `supabase/migrations/0143_item_sizes.sql` (exact SQL above with the standard provenance header) + commit.
```bash
git add supabase/migrations/0143_item_sizes.sql
git commit -m "feat(catering): migration 0143 — item_sizes + catering_quote_items.size_id"
```

---

## Task 2: `CateringMenuItem.sizes` + `buildCateringMenuItem` derivation (CC)

**Files:** Modify `lib/catering/menu.ts`.

Re-read `lib/catering/menu.ts:30-64` first (the exact `CateringMenuItem` + `buildCateringMenuItem`).

- [ ] **Step 1: Extend `CateringMenuItem`** — add after `portionPricesCents`:
```ts
  sizes: Array<{ id: string; label: string; unitPriceCents: number; serves: number | null }> | null; // present iff the item has active item_sizes
```

- [ ] **Step 2: Extend `buildCateringMenuItem`** — the `row` param gains an optional `sizes` (raw sizes with base `priceCents`); derive each size's catering price via the existing `cateringUnitPriceCents(base, "whole", rateBps)` (whole fraction = 1). The item's top-level `unitPriceCents` becomes the smallest derived size price ("from …") when sizes exist. Full new function body:
```ts
export function buildCateringMenuItem(
  row: { kind: "item" | "menu_item"; id: string; name: string; nameEs: string | null; section: string | null;
         menuPriceCents: number; cateringOnly: boolean; portionable: boolean;
         sizes?: Array<{ id: string; label: string; priceCents: number; serves: number | null }> },
  rules: RateRule[],
): CateringMenuItem | null {
  const hasSizes = !!row.sizes && row.sizes.length > 0;
  if (!hasSizes && !(row.menuPriceCents > 0)) return null;
  const rateBps = resolveRateBps(rules, { kind: row.kind, entityId: row.id, section: row.section });
  const sizes = hasSizes
    ? row.sizes!.map((s) => ({ id: s.id, label: s.label, serves: s.serves,
        unitPriceCents: cateringUnitPriceCents(s.priceCents, "whole", rateBps) }))
      .filter((s) => s.unitPriceCents > 0)
    : null;
  const whole = hasSizes && sizes && sizes.length > 0
    ? Math.min(...sizes.map((s) => s.unitPriceCents))            // "from" price
    : cateringUnitPriceCents(row.menuPriceCents, "whole", rateBps);
  return {
    kind: row.kind, id: row.id, name: row.name, nameEs: row.nameEs, section: row.section,
    cateringOnly: row.cateringOnly, portionable: row.portionable,
    regularPriceCents: row.menuPriceCents, rateBps, unitPriceCents: whole,
    portionPricesCents: row.portionable
      ? { quarter: cateringUnitPriceCents(row.menuPriceCents, "quarter", rateBps),
          half: cateringUnitPriceCents(row.menuPriceCents, "half", rateBps), whole }
      : null,
    sizes: sizes && sizes.length > 0 ? sizes : null,
  };
}
```
- [ ] **Step 3: `loadCateringMenuItems` (staff loader) unchanged** — it calls `buildCateringMenuItem` without `sizes`, so `sizes` is `undefined` → whole-only, behavior unchanged. (Staff-side size support is a later nicety, not A.)
- [ ] **Step 4: `tsc` clean; commit.**
```bash
git add lib/catering/menu.ts
git commit -m "feat(catering): CateringMenuItem.sizes + size price derivation"
```

---

## Task 3: Portal loader joins `item_sizes` (CC)

**Files:** Modify `lib/portal/menu.ts` (`loadPublicCateringMenu`, :68-106).

- [ ] **Step 1: Batch-load sizes for the catering items.** After the `items`/`menu_items` fetch, load active `item_sizes` for the fetched item ids and group by `item_id`:
```ts
  const itemIdList = (itemRows ?? []).map((r) => r.id);
  const sizesByItem = new Map<string, Array<{ id: string; label: string; priceCents: number; serves: number | null }>>();
  if (itemIdList.length > 0) {
    const { data: sizeRows, error: szErr } = await sb
      .from("item_sizes")
      .select("id, item_id, label, price_cents, serves, display_order")
      .in("item_id", itemIdList).eq("active", true)
      .order("display_order", { ascending: true })
      .returns<Array<{ id: string; item_id: string; label: string; price_cents: number; serves: number | string | null; display_order: number }>>();
    if (szErr) throw new Error(`loadPublicCateringMenu sizes: ${szErr.message}`);
    for (const s of sizeRows ?? []) {
      const arr = sizesByItem.get(s.item_id) ?? [];
      arr.push({ id: s.id, label: s.label, priceCents: s.price_cents, serves: s.serves == null ? null : Number(s.serves) });
      sizesByItem.set(s.item_id, arr);
    }
  }
```
- [ ] **Step 2: Pass sizes into `buildCateringMenuItem`** in the items loop:
```ts
  for (const r of itemRows ?? []) {
    const built = buildCateringMenuItem(
      { kind: "item", id: r.id, name: r.name, nameEs: r.name_es, section: r.section,
        menuPriceCents: dollarsToCents(r.menu_price), cateringOnly: r.catering_only, portionable: false,
        sizes: sizesByItem.get(r.id) },
      rules,
    );
    if (built) out.push(built);
  }
```
(the menu_items/subs loop is unchanged.)
- [ ] **Step 3: `tsc` clean; commit.**
```bash
git add lib/portal/menu.ts
git commit -m "feat(catering): portal menu loader joins item_sizes"
```

---

## Task 4: Cart threading — `sizeId` (CC)

**Files:** Modify `lib/portal/draft.ts` (`DraftLineInput`, `DraftItem`, `resolveLines` :340, `loadDraft` items map, the `ResolvedLine` + insert), `app/api/portal/magic-link/request/route.ts` (`parsePreselect`).

Re-read `lib/portal/draft.ts` `resolveLines` (:339-369), `ResolvedLine` (:333), the `setDraftLines` insert (:420-424), and `loadDraft`'s item map (:296-301) first.

- [ ] **Step 1: `DraftLineInput` + `DraftItem` + `ResolvedLine` gain `sizeId`.**
  - `DraftLineInput`: add `sizeId?: string | null;`
  - `DraftItem`: add `sizeId: string | null;`
  - `ResolvedLine`: add `sizeId: string | null;`
- [ ] **Step 2: `resolveLines` — size branch (uses the loaded menu's `sizes`; no extra query).** In the `itemId` branch, price by size when `sizeId` (or the item has sizes → default to the first):
```ts
    if (itemId != null && itemId !== "") {
      const it = byKey.get(`item:${itemId}`);
      if (!it) throw new PortalDraftError(400, "invalid_line", `Line ${i + 1}: unknown item`);
      if (it.sizes && it.sizes.length > 0) {
        const size = l.sizeId ? it.sizes.find((s) => s.id === l.sizeId) : it.sizes[0];
        if (!size) throw new PortalDraftError(400, "invalid_line", `Line ${i + 1}: unknown size`);
        return { itemId, menuItemId: null, packageId: null, sizeId: size.id, portion: null,
          description: `${it.name} (${size.label})`, quantity,
          unitPriceCents: size.unitPriceCents, lineTotalCents: lineTotalCents(quantity, size.unitPriceCents), displayOrder: i };
      }
      return { itemId, menuItemId: null, packageId: null, sizeId: null, portion: null, description: it.name, quantity,
        unitPriceCents: it.unitPriceCents, lineTotalCents: lineTotalCents(quantity, it.unitPriceCents), displayOrder: i };
    }
```
  Add `sizeId: null` to the `menuItemId` (sub) return and any other `ResolvedLine` construction so the type is satisfied.
- [ ] **Step 3: `setDraftLines` insert persists `size_id`** — add `size_id: l.sizeId,` to the `catering_quote_items` insert object (:420-424); and to the returned `items` map add `sizeId: l.sizeId`.
- [ ] **Step 4: `loadDraft` reads `size_id`** — add `size_id` to the `.select(...)` (:286) and map `sizeId: r.size_id` into the `DraftItem` (:296-301); update the row type to include `size_id: string | null`.
- [ ] **Step 5: `parsePreselect` (magic-link route) accepts `sizeId`.** In the loop, read `const sizeId = typeof o.sizeId === "string" && UUID_RE.test(o.sizeId) ? o.sizeId : undefined;` and include it: `out.push(menuItemId ? { menuItemId, quantity: q } : { itemId, quantity: q, ...(sizeId ? { sizeId } : {}) });`. Widen the return type to allow `sizeId?: string`. (`DraftLineInput.sizeId` accepts it downstream.)
- [ ] **Step 6: `tsc` clean; commit.**
```bash
git add lib/portal/draft.ts app/api/portal/magic-link/request/route.ts
git commit -m "feat(catering): thread sizeId through the cart (resolveLines/draft/preselect)"
```

---

## Task 5: Seed `08-catering-sizes.ts` (CC, gated on prod)

**Files:** Create `scripts/seed/08-catering-sizes.ts`.

- [ ] **Step 1: Author the seed** — two parts, idempotent, `SEED_DRY=1` dry-run, `pathToFileURL` guard, audit rows.
  - **Sizes** (`item_sizes`, upsert by `(item_id,label)`): resolve each item by name (global active), insert its sizes:
    Tuna Salad → [{"½ pint",425,1},{"32 oz",1800,4}]; Egg Salad → [{"½ pint",425,1},{"32 oz",1600,4}]; Antipasto Pasta → [{"pint",600,1},{"32 oz",1600,4}]; Onion Dip → [{"6 oz",500,1},{"32 oz",2000,4}]. (price_cents, serves)
  - **Bundle/new catering `menu_items`** (upsert by name; `active, catering_available=true, catering_only=true, catering_portionable=false, menu_price=<dollars>, section`):
    House Greek Salad $12 "Catering Sides" · Caesar Salad $12 "Catering Sides" · Quart of Pickle Spears (12) $9 "Catering Sides" · Case of Mini Chips (24) $20 "Catering Sides" · Case of Assorted Chips (24) $52 "Catering Sides" · Dozen Waters $12 "Catering Drinks" · 24 Mixed Sodas $48 "Catering Drinks".
  - Report items not found (don't fabricate). Audit: `item_size.create` / `menu_item.create` with `phase:"catering_sizes_a"`.
- [ ] **Step 2: Dry-run** `SEED_DRY=1 npx tsx --env-file=.env.local scripts/seed/08-catering-sizes.ts` → expect 8 sizes + 7 menu_items; present to Juan (gate).
- [ ] **Step 3: (gate) Run on prod** after Juan's OK; SQL read-back: `item_sizes` count = 8, the 7 catering menu_items present.
- [ ] **Step 4: Commit.**
```bash
git add scripts/seed/08-catering-sizes.ts
git commit -m "seed(catering): item_sizes for salad/dip sides + catering-only bundles"
```

---

## Task 6: Build-page SizeSelector (Sonnet)

**Files:** Modify `app/order/build/page.tsx`.

- [ ] **Step 1** Extend the local `CateringMenuItem`/`DraftItem`/`Line` shapes to carry `sizes` + `sizeId` (mirror the lib types). Add a `SizeSelector` component modeled on the existing `PortionSelector` (chips per size, each showing `money(size.unitPriceCents)`; default = first size). `unitCents(item, line)` uses the selected size's price for a sized item; the persisted line payload adds `sizeId` (mirrors the sub `portion` payload). Hydration + coverage use `sizes`/`size.serves`.
- [ ] **Step 2** `tsc` + `next build` green; commit (CC reviews).

## Task 7: Storefront "from" + default-size Add (Sonnet)

**Files:** Modify `app/order/page.tsx`, `components/portal/StorefrontOrderTray.tsx`.

- [ ] **Step 1** A sided item (has `sizes`) shows `from ${money(item.unitPriceCents)}`; the tray's `add(m)` for a sized item stamps the default size id (`m.sizes[0].id`) on the pick; the preselect entry becomes `{ itemId, sizeId, quantity }` for sized items (`{ menuItemId, quantity }` for subs unchanged). No size UI on the storefront (chosen on the build page).
- [ ] **Step 2** `tsc` + `next build` green; commit (CC reviews).

---

## Task 8: Smoke + PR (Fable + CC)

- [ ] **Step 1: Fable smoke** (`tsx`, deleted after) — `loadPublicCateringMenu(CAP_HILL)` returns Tuna Salad with `sizes` (½ pint 425, 32 oz 1800); a `resolveLines`-backed `setDraftLines` line `{ itemId: <tuna>, sizeId: <32oz>, quantity: 1 }` prices at 1800 and persists `size_id`; a bogus `sizeId` throws `invalid_line`.  (Read-only where possible; if it must create a draft, clean up the rows.)
- [ ] **Step 2: Manual smoke (preview, Juan)** — `/order` shows the 32oz sides ("from …") + the bundles; build-page size picker changes the price; a sized line survives to review with the right subtotal.
- [ ] **Step 3: PR to main; CI `build` green; hold for "merge #NNN".**

---

## Self-review (against the spec)
- **Coverage:** schema (T1), `CateringMenuItem.sizes` + derivation (T2), loader join (T3), cart `sizeId` thread + `resolveLines` + `loadDraft` + `parsePreselect` (T4), seed (T5), build picker (T6), storefront default-size Add (T7), smoke (T8). Packages/admin correctly absent (B/C).
- **Placeholder scan:** concrete SQL, prices, and code — no TBD/TODO.
- **Type consistency:** `CateringMenuItem.sizes` = `{id,label,unitPriceCents,serves}` (T2) is what the loader fills (T3), what `resolveLines` reads (`it.sizes.find`) + `DraftLineInput.sizeId`/`DraftItem.sizeId`/`ResolvedLine.sizeId` (T4), and what the UI consumes (T6/T7). Raw `item_sizes` rows use `priceCents` (base) → derived `unitPriceCents`. `size_id` column ↔ `sizeId` field consistently.
- **RLS correction:** the spec's `FOR ALL using(false)` is replaced by the split `_no_user_{insert,update,delete}` + no-select pattern mirroring `item_components` (per the AGENTS FOR-ALL lesson).
- **Confirm-before-authoring:** re-read `buildCateringMenuItem`, `resolveLines`, `loadDraft`, `parseIntake` at each task; confirm 0143 next.
