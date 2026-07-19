# W1b — Catering Package Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the existing catering-package KB into a builder — spine-linked line items, a per-line locked FIXED / interchangeable CHOICE-SLOT model, and W1a-derived price advice (recommended à-la-carte value + implied bundle discount) — with the team's flat price staying authoritative.

**Architecture:** Extend `catering_packages` + `catering_package_items` (do NOT rebuild). One migration adds `slot_type` + a `catering_package_slot_options` table. The builder lib grows fixed-ref + choice-slot ops; a new `package-pricing.ts` holds the picker + the advisory `recommendPackagePrice` (reuses `lib/catering/pricing-derivation.ts`). DORMANT until menu data lands (same posture as W1a/3a).

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`, route `params` is a Promise), React 19, Tailwind v4, TS strict + `noUncheckedIndexedAccess`, Supabase (service-role + RLS, project `bgcvurheqzylyfehqgzh`), integer-cents, bps rates. Tests = `tsx` seeded smoke. Branch: `claude/w1b-catering-package-builder`.

**Model tiering (per Juan's W1a/3a pattern):** Fable 5 on the pricing core + smoke (T5, T8); Opus 4.8 on migration/lib/routes (T1–T4, T6); Sonnet 4.6 on the UI (T7). CC (main loop) is SOLE reviewer of every diff + owns the prod migration + all git.

---

## Confirm-before-authoring — VERIFIED against live DB (2026-07-19)

- `catering_package_items`: cols `id, package_id, item_id, menu_item_id, description, quantity(numeric), display_order, active, created_at, created_by`. CHECKs: `catering_package_items_one_ref` = `(item_id IS NULL OR menu_item_id IS NULL)` (mutually exclusive, both-null allowed); `quantity > 0`. FKs to items/menu_items/catering_packages/users. **No `slot_type` yet.**
- `catering_packages`: `pricing_mode` (`per_head|per_platter|fixed` CHECK) + `price_cents` (int ≥ 0, team-set) + `location_id` (nullable = global). 0 packages / 0 items (dormant).
- `lib/catering/pricing-derivation.ts` exports: `cateringUnitPriceCents(regularCents, portion, rateBps)`, `impliedRateBps(chosenCents, baselineCents)` → `chosen/baseline × 10000` (null if baseline ≤ 0), `sumComponentsCents(lines: {unitCents, qty}[])`, `resolveRateBps(rules, {kind, entityId, section})`, `RateRule {scope, scopeRef, rateBps}`, `DEFAULT_RATE_BPS=10000`.
- `lib/catering/rate-rules.ts`: `loadActiveRateRules(locationId): Promise<RateRule[]>` (un-gated service-role read).
- `lib/catering/menu.ts`: `loadCateringMenuItems(actor, locationId)` bundles the per-location rate (so the picker needs a location-AGNOSTIC raw query; the rate is applied in `recommendPackagePrice`). `CateringMenuItem { kind, id, name, section, portionable, regularPriceCents, rateBps, unitPriceCents, portionPricesCents }`.
- `lib/admin/catering/packages.ts` (existing): `PACKAGE_WRITE_MIN=6`, `AdminCateringError`, Tier A for line-item ops / Tier B for create+deactivate, append-only, `hydratePackages`, `addPackageLineItem`/`removePackageLineItem`, `requirePackageRow`/`requireLineItemRow`.
- Next migration number: **0136** (0135 is the tip after the security pass).

## File Structure

- Create: `supabase/migrations/0136_catering_package_slots.sql` — `slot_type` + `catering_package_slot_options`.
- Modify: `lib/admin/catering/packages.ts` — slot_type in views/hydrate; `addPackageLine` (fixed ref | choice slot); `addSlotOption`/`removeSlotOption`; cascade options on line remove.
- Create: `lib/admin/catering/package-pricing.ts` — `loadPackagePickerMenu` (location-agnostic catering-available items) + `recommendPackagePrice` (à-la-carte value + implied discount).
- Modify: `app/api/admin/catering/packages/[id]/route.ts` (+ line/slot sub-routes as needed) + a `recommend` GET route.
- Modify: `app/admin/catering/packages/page.tsx` + Create: `app/admin/catering/packages/packages-client.tsx` — the builder.
- Modify: `lib/i18n/en.json` + `lib/i18n/es.json` — `catering.package.*` keys.
- Create: `scripts/w1b-smoke.ts` — seeded lifecycle smoke.

---

## Task 1: Migration 0136 — slot_type + slot-options table

**Files:** Create `supabase/migrations/0136_catering_package_slots.sql`; apply via Supabase MCP (CC only).

**Context:** CC applies to prod via the MCP + commits the repo file — the implementer WRITES the SQL only. Schema-only, additive, dormant-safe.

- [ ] **Step 1: Write the migration file**
```sql
-- Migration 0136_catering_package_slots
-- Applied via Supabase MCP apply_migration on 2026-07-19.
-- Canonical reference: docs/superpowers/specs/2026-07-19-w1b-catering-package-builder-design.md
--                      + lib/admin/catering/packages.ts
--
-- W1b: a package line is a locked FIXED item (spine-linked ref) or an interchangeable CHOICE SLOT
-- (pick N from a designated eligible group). slot_type discriminates; the eligible group lives in
-- catering_package_slot_options.

-- 1. slot_type on the line: 'fixed' (a specific/locked item) | 'choice' (a pick-N slot).
ALTER TABLE public.catering_package_items
  ADD COLUMN slot_type text NOT NULL DEFAULT 'fixed'
  CHECK (slot_type IN ('fixed','choice'));

-- 2. The eligible options for a choice slot. An option is ALWAYS a concrete item (exactly one FK).
CREATE TABLE public.catering_package_slot_options (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_item_id  uuid NOT NULL REFERENCES public.catering_package_items(id),
  item_id          uuid REFERENCES public.items(id),
  menu_item_id     uuid REFERENCES public.menu_items(id),
  display_order    integer NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES public.users(id),
  CONSTRAINT catering_package_slot_options_one_ref CHECK ((item_id IS NULL) <> (menu_item_id IS NULL))
);

CREATE INDEX catering_package_slot_options_package_item
  ON public.catering_package_slot_options (package_item_id) WHERE active;

ALTER TABLE public.catering_package_slot_options ENABLE ROW LEVEL SECURITY;
-- Deny-all to end users; service-role only (the lib is the authority), like the other catering-KB tables.
```

- [ ] **Step 2: (CC) apply via Supabase MCP + verify**
CC runs `apply_migration(name="0136_catering_package_slots", query=<SQL>)`, then:
```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='catering_package_items_slot_type_check';
-- Expect: CHECK ((slot_type = ANY (ARRAY['fixed','choice'])))
SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='catering_package_slot_options';
-- Expect: 8
SELECT relrowsecurity FROM pg_class WHERE relname='catering_package_slot_options';  -- Expect: true
```

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/0136_catering_package_slots.sql
git commit -m "feat(w1b): migration 0136 — package slot_type + slot-options table"
```

---

## Task 2: `packages.ts` — slot_type in the view types + hydration

**Files:** Modify `lib/admin/catering/packages.ts`.

**Context:** Grow `PackageLineItemView` with `slotType` + (for choice lines) resolved `options`, and have `hydratePackages` batch-load the active slot options + resolve fixed/option names from `items`/`menu_items`.

- [ ] **Step 1: Add the slot-option view type + extend the line view**
```ts
export type LineSlotType = "fixed" | "choice";

export interface SlotOptionView {
  id: string;
  kind: "item" | "menu_item";
  refId: string;
  name: string;
}

export interface PackageLineItemView {
  id: string;
  slotType: LineSlotType;
  itemId: string | null;        // fixed spine-link (or null: choice / freeform)
  menuItemId: string | null;
  refName: string | null;       // resolved name of the fixed spine ref (null when freeform/choice)
  description: string | null;   // freeform label (fixed) OR the slot label (choice)
  quantity: number;
  displayOrder: number;
  options: SlotOptionView[];    // populated for choice lines (empty otherwise)
}
```

- [ ] **Step 2: Extend `DbLineItemRow` + `hydratePackages` to load slot_type + options + names**
In `DbLineItemRow` add `slot_type: string`. In the line-items select, add `slot_type`. After loading `itemRows`, batch-load: (a) the active slot options for those line ids; (b) the names for every referenced `item_id`/`menu_item_id` (from both fixed lines and options), then map:
```ts
// after itemRows load:
const lineIds = (itemRows ?? []).map((r) => r.id);
const { data: optRows } = lineIds.length
  ? await sb.from("catering_package_slot_options")
      .select("id, package_item_id, item_id, menu_item_id, display_order")
      .in("package_item_id", lineIds).eq("active", true)
      .order("display_order", { ascending: true })
      .returns<Array<{ id: string; package_item_id: string; item_id: string | null; menu_item_id: string | null; display_order: number }>>()
  : { data: [] as Array<{ id: string; package_item_id: string; item_id: string | null; menu_item_id: string | null; display_order: number }> };
// collect all item_id / menu_item_id refs from fixed lines + options; batch-load names:
const itemIds = new Set<string>(); const menuItemIds = new Set<string>();
for (const r of itemRows ?? []) { if (r.item_id) itemIds.add(r.item_id); if (r.menu_item_id) menuItemIds.add(r.menu_item_id); }
for (const o of optRows ?? []) { if (o.item_id) itemIds.add(o.item_id); if (o.menu_item_id) menuItemIds.add(o.menu_item_id); }
const nameByItem = new Map<string, string>(); const nameByMenuItem = new Map<string, string>();
if (itemIds.size) { const { data } = await sb.from("items").select("id, name").in("id", [...itemIds]).returns<Array<{id:string;name:string}>>(); for (const x of data ?? []) nameByItem.set(x.id, x.name); }
if (menuItemIds.size) { const { data } = await sb.from("menu_items").select("id, name").in("id", [...menuItemIds]).returns<Array<{id:string;name:string}>>(); for (const x of data ?? []) nameByMenuItem.set(x.id, x.name); }
const optionsByLine = new Map<string, SlotOptionView[]>();
for (const o of optRows ?? []) {
  const kind = o.menu_item_id ? "menu_item" as const : "item" as const;
  const refId = (o.menu_item_id ?? o.item_id)!;
  const name = kind === "menu_item" ? nameByMenuItem.get(refId) ?? "Item" : nameByItem.get(refId) ?? "Item";
  const arr = optionsByLine.get(o.package_item_id) ?? []; arr.push({ id: o.id, kind, refId, name }); optionsByLine.set(o.package_item_id, arr);
}
```
Then in the `itemsByPackage` push, set `slotType`, `refName` (`r.menu_item_id ? nameByMenuItem.get(r.menu_item_id) : r.item_id ? nameByItem.get(r.item_id) : null`), and `options: optionsByLine.get(it.id) ?? []`.

- [ ] **Step 3: Typecheck + commit**
```bash
npm run typecheck
git add lib/admin/catering/packages.ts
git commit -m "feat(w1b): package line view carries slot_type + resolved options"
```

---

## Task 3: `packages.ts` — `addPackageLine` (fixed spine-ref | choice slot)

**Files:** Modify `lib/admin/catering/packages.ts`.

**Context:** Supersede the freeform-only `addPackageLineItem` with `addPackageLine` that accepts a `slot_type`. A `fixed` line takes an optional catering-available `ref` (`{kind, id}`) OR a freeform `description`; a `choice` line takes a `description` (slot label) + `quantity` (N), FKs null. Validate a fixed ref is catering-available. Keep `addPackageLineItem` as a thin `fixed`+freeform wrapper (existing callers/routes).

- [ ] **Step 1: A catering-available ref validator**
```ts
/** Verify a {kind,id} ref points at an ACTIVE, catering-available item/menu_item. */
async function assertCateringRef(ref: { kind: "item" | "menu_item"; id: string }): Promise<void> {
  const sb = getServiceRoleClient();
  const table = ref.kind === "menu_item" ? "menu_items" : "items";
  const { data, error } = await sb.from(table).select("id").eq("id", ref.id).eq("active", true).eq("catering_available", true).maybeSingle<{ id: string }>();
  if (error) throw new Error(`assertCateringRef failed: ${error.message}`);
  if (!data) throw new AdminCateringError(400, "invalid_ref", "That item is not catering-available");
}
```

- [ ] **Step 2: `addPackageLine`**
```ts
export interface AddPackageLineInput {
  packageId: string;
  slotType: LineSlotType;
  ref?: { kind: "item" | "menu_item"; id: string } | null; // fixed spine-link
  description?: string | null;   // freeform label (fixed) OR slot label (choice)
  quantity: number;
}
export async function addPackageLine(actor: AuthContext, input: AddPackageLineInput): Promise<{ id: string }> {
  requireLevel(actor, PACKAGE_WRITE_MIN);
  await requirePackageRow(input.packageId);
  const quantity = normalizeQuantity(input.quantity);
  const description = normalizeOptional(input.description);

  let itemId: string | null = null; let menuItemId: string | null = null;
  if (input.slotType === "fixed") {
    if (input.ref) {
      await assertCateringRef(input.ref);
      if (input.ref.kind === "menu_item") menuItemId = input.ref.id; else itemId = input.ref.id;
    } else if (!description) {
      throw new AdminCateringError(400, "invalid_payload", "A fixed line needs an item or a description");
    }
  } else {
    // choice: FKs stay null; the slot label lives in description; options are added separately.
    if (!description) throw new AdminCateringError(400, "invalid_payload", "A choice slot needs a label");
  }

  const sb = getServiceRoleClient();
  const { data: maxRow } = await sb.from("catering_package_items").select("display_order").eq("package_id", input.packageId).order("display_order", { ascending: false }).limit(1).maybeSingle<{ display_order: number }>();
  const displayOrder = (maxRow?.display_order ?? -1) + 1;
  const { data: inserted, error } = await sb.from("catering_package_items").insert({
    package_id: input.packageId, slot_type: input.slotType, item_id: itemId, menu_item_id: menuItemId,
    description, quantity, display_order: displayOrder, active: true, created_by: actor.user.id,
  }).select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`addPackageLine insert failed: ${error.message}`);
  if (!inserted) throw new Error("addPackageLine insert returned no row");

  void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.kb.packages.line_item_add", resourceTable: "catering_package_items", resourceId: inserted.id, metadata: { package_id: input.packageId, slot_type: input.slotType, ref: input.ref ?? null }, ipAddress: null, userAgent: null });
  return { id: inserted.id };
}
```

- [ ] **Step 3: Keep `addPackageLineItem` as a wrapper**
```ts
/** @deprecated freeform wrapper — prefer addPackageLine. Kept for existing route/callers. */
export async function addPackageLineItem(actor: AuthContext, args: { packageId: string; description: string; quantity: number }): Promise<{ id: string }> {
  return addPackageLine(actor, { packageId: args.packageId, slotType: "fixed", description: args.description, quantity: args.quantity });
}
```

- [ ] **Step 4: Typecheck + commit**
```bash
npm run typecheck
git add lib/admin/catering/packages.ts
git commit -m "feat(w1b): addPackageLine — fixed spine-ref or choice slot"
```

---

## Task 4: `packages.ts` — slot options + cascade on line removal

**Files:** Modify `lib/admin/catering/packages.ts`.

- [ ] **Step 1: `addSlotOption` (a choice line's eligible option)**
```ts
export async function addSlotOption(actor: AuthContext, args: { lineItemId: string; ref: { kind: "item" | "menu_item"; id: string } }): Promise<{ id: string }> {
  requireLevel(actor, PACKAGE_WRITE_MIN);
  const sb = getServiceRoleClient();
  const { data: line, error: lErr } = await sb.from("catering_package_items").select("id, slot_type").eq("id", args.lineItemId).maybeSingle<{ id: string; slot_type: string }>();
  if (lErr) throw new Error(`addSlotOption line load: ${lErr.message}`);
  if (!line) throw new AdminCateringError(404, "not_found", "Line item not found");
  if (line.slot_type !== "choice") throw new AdminCateringError(409, "not_choice", "Options can only be added to a choice slot");
  await assertCateringRef(args.ref);
  const { data: maxRow } = await sb.from("catering_package_slot_options").select("display_order").eq("package_item_id", args.lineItemId).order("display_order", { ascending: false }).limit(1).maybeSingle<{ display_order: number }>();
  const displayOrder = (maxRow?.display_order ?? -1) + 1;
  const { data: inserted, error } = await sb.from("catering_package_slot_options").insert({
    package_item_id: args.lineItemId,
    item_id: args.ref.kind === "item" ? args.ref.id : null,
    menu_item_id: args.ref.kind === "menu_item" ? args.ref.id : null,
    display_order: displayOrder, active: true, created_by: actor.user.id,
  }).select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`addSlotOption insert failed: ${error.message}`);
  if (!inserted) throw new Error("addSlotOption insert returned no row");
  void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.kb.packages.slot_option_add", resourceTable: "catering_package_slot_options", resourceId: inserted.id, metadata: { line_item_id: args.lineItemId, ref: args.ref }, ipAddress: null, userAgent: null });
  return { id: inserted.id };
}
```

- [ ] **Step 2: `removeSlotOption` (append-only)**
```ts
export async function removeSlotOption(actor: AuthContext, args: { optionId: string }): Promise<void> {
  requireLevel(actor, PACKAGE_WRITE_MIN);
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("catering_package_slot_options").update({ active: false }, { count: "exact" }).eq("id", args.optionId).eq("active", true);
  if (error) throw new Error(`removeSlotOption failed: ${error.message}`);
  if (count === 0) throw new AdminCateringError(404, "not_found", "Option not found or already removed");
  void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.kb.packages.slot_option_remove", resourceTable: "catering_package_slot_options", resourceId: args.optionId, metadata: {}, ipAddress: null, userAgent: null });
}
```

- [ ] **Step 3: Cascade options when a choice line is removed**
In the existing `removePackageLineItem`, after the line's `active=false` update succeeds, deactivate its options:
```ts
  await sb.from("catering_package_slot_options").update({ active: false }).eq("package_item_id", args.itemId).eq("active", true);
```

- [ ] **Step 4: Typecheck + commit**
```bash
npm run typecheck
git add lib/admin/catering/packages.ts
git commit -m "feat(w1b): choice-slot options (add/remove) + cascade on line removal"
```

---

## Task 5: `package-pricing.ts` (NEW) — picker + `recommendPackagePrice`

**Files:** Create `lib/admin/catering/package-pricing.ts`.

**Context:** The advisory pricing core (Fable). `loadPackagePickerMenu` = the location-AGNOSTIC catering-available item set for the pickers (item existence is global; only the RATE is per-location). `recommendPackagePrice` computes the à-la-carte catering value against a location basis + the implied bundle discount vs the package's flat `price_cents`.

- [ ] **Step 1: Header + `loadPackagePickerMenu`**
```ts
/**
 * W1b package pricing advice + picker. SERVER-ONLY, service-role. The picker is LOCATION-AGNOSTIC
 * (catering-available item existence is global); the RATE is applied per basis-location in
 * recommendPackagePrice via lib/catering/pricing-derivation.ts. Advisory only — the team's flat
 * package price_cents stays authoritative.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { loadActiveRateRules } from "@/lib/catering/rate-rules";
import { cateringUnitPriceCents, resolveRateBps, impliedRateBps } from "@/lib/catering/pricing-derivation";

export const PACKAGE_PRICE_READ_MIN = 6;
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new Error("package pricing: insufficient role level");
}
function dollarsToCents(v: number | string | null): number {
  if (v === null) return 0; const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

export interface PickerItem { kind: "item" | "menu_item"; id: string; name: string; section: string | null; regularPriceCents: number; }

export async function loadPackagePickerMenu(actor: AuthContext): Promise<PickerItem[]> {
  requireLevel(actor, PACKAGE_PRICE_READ_MIN);
  const sb = getServiceRoleClient();
  const [{ data: items }, { data: subs }] = await Promise.all([
    sb.from("items").select("id, name, section, menu_price").eq("active", true).eq("catering_available", true).returns<Array<{ id: string; name: string; section: string | null; menu_price: number | string | null }>>(),
    sb.from("menu_items").select("id, name, section, menu_price").eq("active", true).eq("catering_available", true).returns<Array<{ id: string; name: string; section: string | null; menu_price: number | string | null }>>(),
  ]);
  const out: PickerItem[] = [];
  for (const r of items ?? []) out.push({ kind: "item", id: r.id, name: r.name, section: r.section, regularPriceCents: dollarsToCents(r.menu_price) });
  for (const r of subs ?? []) out.push({ kind: "menu_item", id: r.id, name: r.name, section: r.section, regularPriceCents: dollarsToCents(r.menu_price) });
  return out.sort((a, b) => (a.section ?? "").localeCompare(b.section ?? "") || a.name.localeCompare(b.name));
}
```

- [ ] **Step 2: `recommendPackagePrice`**
```ts
export interface PackagePriceRecommendation {
  hasBasis: boolean;            // false when a global package has no preview location, or 0 priceable lines
  alaCarteCents: number;        // Σ constituent catering value
  priceCents: number;          // the team's authoritative flat price
  impliedDiscountBps: number;  // 10000 − impliedRateBps(price, alaCarte); + = discount, − = premium
  unpriceableLines: number;    // fixed-freeform or empty-choice lines that contribute 0
}

export async function recommendPackagePrice(actor: AuthContext, args: { packageId: string; locationId: string | null }): Promise<PackagePriceRecommendation> {
  requireLevel(actor, PACKAGE_PRICE_READ_MIN);
  const sb = getServiceRoleClient();
  const { data: pkg, error: pErr } = await sb.from("catering_packages").select("id, location_id, price_cents").eq("id", args.packageId).maybeSingle<{ id: string; location_id: string | null; price_cents: number }>();
  if (pErr) throw new Error(`recommendPackagePrice package: ${pErr.message}`);
  if (!pkg) throw new Error("recommendPackagePrice: package not found");
  const basisLocation = pkg.location_id ?? args.locationId; // package location wins; else the preview location
  const priceCents = pkg.price_cents;
  if (!basisLocation) return { hasBasis: false, alaCarteCents: 0, priceCents, impliedDiscountBps: 0, unpriceableLines: 0 };

  const rules = await loadActiveRateRules(basisLocation);
  const { data: lines } = await sb.from("catering_package_items").select("id, slot_type, item_id, menu_item_id, quantity").eq("package_id", args.packageId).eq("active", true).returns<Array<{ id: string; slot_type: string; item_id: string | null; menu_item_id: string | null; quantity: number | string }>>();

  // Resolve regular prices + sections for every referenced item (fixed refs + choice options), then derive.
  const lineRows = lines ?? [];
  const choiceIds = lineRows.filter((l) => l.slot_type === "choice").map((l) => l.id);
  const { data: optRows } = choiceIds.length ? await sb.from("catering_package_slot_options").select("package_item_id, item_id, menu_item_id").in("package_item_id", choiceIds).eq("active", true).returns<Array<{ package_item_id: string; item_id: string | null; menu_item_id: string | null }>>() : { data: [] as Array<{ package_item_id: string; item_id: string | null; menu_item_id: string | null }> };

  // Batch price/section lookups (items + menu_items) for all referenced ids.
  const itemIds = new Set<string>(); const menuIds = new Set<string>();
  for (const l of lineRows) { if (l.item_id) itemIds.add(l.item_id); if (l.menu_item_id) menuIds.add(l.menu_item_id); }
  for (const o of optRows ?? []) { if (o.item_id) itemIds.add(o.item_id); if (o.menu_item_id) menuIds.add(o.menu_item_id); }
  const priceOf = new Map<string, { regularCents: number; section: string | null; kind: "item" | "menu_item" }>();
  if (itemIds.size) { const { data } = await sb.from("items").select("id, menu_price, section").in("id", [...itemIds]).returns<Array<{ id: string; menu_price: number | string | null; section: string | null }>>(); for (const x of data ?? []) priceOf.set(`item:${x.id}`, { regularCents: dollarsToCents(x.menu_price), section: x.section, kind: "item" }); }
  if (menuIds.size) { const { data } = await sb.from("menu_items").select("id, menu_price, section").in("id", [...menuIds]).returns<Array<{ id: string; menu_price: number | string | null; section: string | null }>>(); for (const x of data ?? []) priceOf.set(`menu_item:${x.id}`, { regularCents: dollarsToCents(x.menu_price), section: x.section, kind: "menu_item" }); }

  const derived = (kind: "item" | "menu_item", id: string): number | null => {
    const p = priceOf.get(`${kind}:${id}`); if (!p || p.regularCents <= 0) return null;
    return cateringUnitPriceCents(p.regularCents, "whole", resolveRateBps(rules, { kind, entityId: id, section: p.section }));
  };
  const optionsByLine = new Map<string, Array<{ kind: "item" | "menu_item"; id: string }>>();
  for (const o of optRows ?? []) { const kind = o.menu_item_id ? "menu_item" as const : "item" as const; const id = (o.menu_item_id ?? o.item_id)!; const arr = optionsByLine.get(o.package_item_id) ?? []; arr.push({ kind, id }); optionsByLine.set(o.package_item_id, arr); }

  let alaCarteCents = 0; let unpriceableLines = 0;
  for (const l of lineRows) {
    const qty = typeof l.quantity === "string" ? Number(l.quantity) : l.quantity;
    if (l.slot_type === "fixed") {
      const kind = l.menu_item_id ? "menu_item" as const : l.item_id ? "item" as const : null;
      const id = l.menu_item_id ?? l.item_id;
      const unit = kind && id ? derived(kind, id) : null;
      if (unit == null) { unpriceableLines++; continue; }
      alaCarteCents += Math.round(unit * qty);
    } else {
      const opts = optionsByLine.get(l.id) ?? [];
      const unitVals = opts.map((o) => derived(o.kind, o.id)).filter((v): v is number => v != null);
      if (unitVals.length === 0) { unpriceableLines++; continue; }
      const avg = unitVals.reduce((s, v) => s + v, 0) / unitVals.length; // typical value of the slot
      alaCarteCents += Math.round(avg * qty);
    }
  }
  const impRate = impliedRateBps(priceCents, alaCarteCents); // price / alaCarte × 10000
  const impliedDiscountBps = impRate == null ? 0 : 10000 - impRate;
  return { hasBasis: alaCarteCents > 0, alaCarteCents, priceCents, impliedDiscountBps, unpriceableLines };
}
```

- [ ] **Step 3: Typecheck + commit**
```bash
npm run typecheck
git add lib/admin/catering/package-pricing.ts
git commit -m "feat(w1b): package picker + recommendPackagePrice (advisory à-la-carte + implied discount)"
```

---

## Task 6: Routes — slot line/option ops + recommend

**Files:** Modify `app/api/admin/catering/packages/[id]/route.ts` (+ add sub-routes / a `recommend` route as needed). Read the existing route(s) first to mirror the requireSession → level → assertStepUp pattern + the jsonError shape.

- [ ] **Step 1: Line + slot-option endpoints** — expose `addPackageLine` (POST a line with `slotType`/`ref`/`description`/`quantity`), `addSlotOption`/`removeSlotOption` (a choice line's options). Tier A step-up (matching the existing line-item ops). Add a route file `app/api/admin/catering/packages/[id]/lines/route.ts` (POST addPackageLine) and `.../lines/[lineId]/options/route.ts` (POST addSlotOption / DELETE removeSlotOption) — or fold into the existing `[id]` route by a `kind` discriminator; mirror the existing structure (read it first).

- [ ] **Step 2: `recommend` GET** — `app/api/admin/catering/packages/[id]/recommend/route.ts`: `requireSession` → `PACKAGE_WRITE_MIN` → `recommendPackagePrice(ctx, { packageId, locationId: <?location=> })` → the recommendation payload. (Read-only; no step-up.)

- [ ] **Step 3: Typecheck + commit**
```bash
npm run typecheck
git add app/api/admin/catering/packages
git commit -m "feat(w1b): package builder routes — lines, slot options, recommend"
```

---

## Task 7: Admin UI — the builder (Sonnet)

**Files:** Modify `app/admin/catering/packages/page.tsx`; Create `app/admin/catering/packages/packages-client.tsx`. Modify `lib/i18n/en.json` + `lib/i18n/es.json`.

**Context:** Read the existing `packages/page.tsx` + the `rate-rules/rate-rules-client.tsx` (the bidirectional %/target UI to mirror). The page (server component) loads packages (`loadPackages`), locations (`loadPackageLocations`), and the picker menu (`loadPackagePickerMenu`) and passes them to the client. Preserve the existing package list/create/edit; ADD the line builder + price-advice panel.

- [ ] **Step 1:** Server page loads + passes `packages`, `locations`, `pickerMenu` to `<PackagesClient>`.
- [ ] **Step 2:** `packages-client.tsx` — for each package: the line list showing each line's `slotType` (a **Fixed**/**Choice** badge), fixed `refName` or the choice slot label + its `options` (chips); **Add fixed item** (a picker dropdown over `pickerMenu`, grouped by section) and **Add choice slot** (label + N + then add options from the picker); remove line/option (append-only). A **price-advice panel**: a preview-location selector (only needed for GLOBAL packages; per-location packages use their own), the team's flat `price_cents` input, and — from the `recommend` route — the recommended à-la-carte value + the implied discount % live (green = discount, amber = premium/above à-la-carte), with a "use recommended" affordance that sets `price_cents`. Mirror the rate-rules client's fetch-on-change + optimistic display.
- [ ] **Step 3:** i18n — add `catering.package.*` keys (EN + ES): the Fixed/Choice badges, "Add fixed item", "Add choice slot", "Pick N", "Eligible options", "Recommended à-la-carte", "Implied discount", "Use recommended", "Pick a location to preview pricing", etc. (one key per visible string + ARIA labels; tú-form ES).
- [ ] **Step 4: Build gate + commit**
```bash
npm run build
git add app/admin/catering/packages lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(w1b): package builder UI — fixed/choice lines + price advice"
```

---

## Task 8: Seeded lifecycle smoke (Fable)

**Files:** Create `scripts/w1b-smoke.ts`.

**Context:** Mirror `scripts/w1a-smoke.ts` (seed → drive real lib → assert → roll back, zero residue). Uses a service-role client + a synthesized level-9 `AuthContext` (see w1a-smoke for the actor shape, or call the un-gated pricing where possible).

- [ ] **Step 1:** Seed at an active location: a `catering_rate_rules` location rule (rate_bps 8500); two catering-available `menu_items` subs ($12, $16) + one catering-available `items` extra ($2); a `catering_packages` row (fixed price_cents, per_platter). Track every id.
- [ ] **Step 2:** `addPackageLine` a **fixed** line (the $2 extra, qty 2) → assert the line persists `slot_type='fixed'` + the spine FK.
- [ ] **Step 3:** `addPackageLine` a **choice** slot (label "Choose your sub", qty 1) → `addSlotOption` the two subs → assert `loadPackages` hydrates the line `slotType='choice'` + 2 resolved option names.
- [ ] **Step 4:** `recommendPackagePrice({ packageId, locationId })` → assert `alaCarteCents` = fixed(2 × derived($2×0.85)) + choice(avg(derived($12×0.85), derived($16×0.85)) × 1); assert `impliedDiscountBps` = 10000 − round(price_cents/alaCarteCents × 10000) for the seeded flat price.
- [ ] **Step 5:** `removeSlotOption` one option → assert the choice line now hydrates 1 option; `removePackageLineItem` the choice line → assert its remaining options cascade to `active=false`.
- [ ] **Step 6:** Cleanup — delete every seeded row (slot options, package items, package, rate rule, menu_items, item), verify zero residue, print `w1b-smoke: PASS`. Run: `npx tsx --env-file=.env.local scripts/w1b-smoke.ts`.
- [ ] **Step 7: Commit**
```bash
git add scripts/w1b-smoke.ts
git commit -m "test(w1b): seeded package-builder lifecycle smoke (PASS, zero residue)"
```

---

## Task 9: Final gates + PR

- [ ] **Step 1:** `npm run build` (CI gate) → PASS. `npm run typecheck` → PASS. `npx eslint` the new/changed lib → clean.
- [ ] **Step 2:** `npx tsx --env-file=.env.local scripts/w1b-smoke.ts` → PASS, zero residue.
- [ ] **Step 3:** CC runs the recurring-bug-class checklist over the diff (authz: level-6+ + step-up on every write; append-only for lines+options; catering-available ref validation; no silent-at-scale loaders; migration committed + applied).
- [ ] **Step 4:** Open the PR (verify `gh pr view --json state` semantics per #133; don't chain branch-delete after merge). Title: `feat(w1b): catering package builder`. Body: the slot model, price advice, dormant-until-data, deferred fast-follows (customer choice-slot consumption + staff-quote reskin).

---

## Self-Review (against the spec)

**Spec coverage:** §2 slot_type + slot_options → T1. §2 fixed spine-link → T3; choice slot → T3; options → T4. §3 view hydration → T2; picker → T5; lib ops → T3/T4. §4 recommend/reverse → T5 (`recommendPackagePrice` uses `cateringUnitPriceCents`/`resolveRateBps`/`impliedRateBps`; avg for choice; location basis; discount = 10000 − impliedRate). §5 routes + UI → T6/T7. §6 append-only + Tier A → T3/T4/T6. §8 smoke → T8. §9 confirm-before-authoring → done at top + T1.

**Placeholder scan:** the UI task (T7) gives contracts + wiring + a mirror reference (rate-rules-client) rather than 300 lines of verbatim JSX — deliberate (the page is large; the implementer reads the real file), matching how W1a/3a UI shipped. Every lib/migration task has complete code.

**Type consistency:** `LineSlotType`, `SlotOptionView`, `PickerItem`, `PackagePriceRecommendation`, `addPackageLine`/`addSlotOption`/`removeSlotOption`, `recommendPackagePrice` defined once (T2/T3/T4/T5) + consumed consistently in T6/T7/T8. `cateringUnitPriceCents`/`resolveRateBps`/`impliedRateBps`/`RateRule`/`loadActiveRateRules` match `lib/catering/pricing-derivation.ts` + `rate-rules.ts` (verified).
