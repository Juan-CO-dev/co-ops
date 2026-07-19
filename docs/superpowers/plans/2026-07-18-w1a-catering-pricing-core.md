# W1a — Catering Pricing Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the catering menu a live, per-location price derivation — subs (`menu_items`) in ¼/½/whole portions and extras (`items`) whole, all derived from the regular sell price × a section/entity catering rate — so the dormant self-serve portal prices real orders once data is authored.

**Architecture:** A pure bidirectional engine (`lib/catering/pricing-derivation.ts`) computes prices on read; rates come from a new append-only `catering_rate_rules` table resolved most-specific-wins; the catering menu loaders union catering-tagged `items` + `menu_items`; the existing quote snapshot freezes prices on a submitted order. No stored prices, no recompute sweeps.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), React 19, Tailwind v4, TS strict + `noUncheckedIndexedAccess`, Supabase Postgres (service-role + RLS), integer-cents money, basis-points rates. Tests = `tsx` assertion/smoke scripts (no unit framework). Gates: `npm run typecheck`, `npm run lint`, `npm run build`.

**Design spec:** `docs/superpowers/specs/2026-07-18-w1a-catering-pricing-core-design.md` (read §0 + §2 first).

**Branch:** `claude/w1a-catering-pricing-core` (already checked out).

**Live DB:** Supabase project `bgcvurheqzylyfehqgzh`. Migrations applied via the Supabase MCP `apply_migration`; the `.sql` file is also committed (AGENTS.md migration-capture convention). Next number = **0128**.

---

## File Structure

**Create:**
- `supabase/migrations/0128_catering_pricing_core.sql` — schema (menu_items catering tags + portion/section, `catering_rate_rules`, `catering_quote_items.portion`).
- `lib/catering/pricing-derivation.ts` — pure engine (forward/reverse/sum + `resolveRateBps`).
- `lib/catering/rate-rules.ts` — un-gated service-role reader `loadActiveRateRules(locationId)` (shared by portal + staff menu loaders).
- `lib/admin/catering/rate-rules.ts` — admin authoring lib (load/upsert/deactivate), mirrors `lib/admin/catering/pricing.ts`.
- `app/api/admin/catering/rate-rules/route.ts` — GET list + POST upsert.
- `app/api/admin/catering/rate-rules/[ruleId]/route.ts` — DELETE (deactivate).
- `app/(authed)/admin/catering/rate-rules/page.tsx` + a client component — authoring UI.
- `scripts/w1a-derivation-test.ts` — pure-engine assertions.
- `scripts/w1a-smoke.ts` — seeded dormant smoke.

**Modify:**
- `lib/catering/menu.ts` — `CateringMenuItem` grows fields; `loadCateringMenuItems` unions menu_items + applies rate + portions.
- `lib/portal/menu.ts` — `loadPublicCateringMenu(locationId)` gains param, unions menu_items + applies rate.
- `lib/portal/orders.ts` — `SubmitLineInput` gains `menuItemId?` + `portion?`; resolve from unified map; persist FK + portion.
- `lib/catering/quotes.ts` — `QuoteLineInput`/`ResolvedLine` gain `portion?`; persist `portion` on `catering_quote_items` insert.
- `app/order/build/page.tsx` — portion selector per sub in cart; send `menuItemId` + `portion`.
- `lib/i18n/en.json` + `lib/i18n/es.json` — new keys for the authoring UI + portion labels (EN+ES parity).

---

## Task 1: Migration 0128 — schema

**Files:**
- Create: `supabase/migrations/0128_catering_pricing_core.sql`

- [ ] **Step 1: Re-verify live schema before authoring (confirm-before-authoring)**

Run these via the Supabase MCP `execute_sql` (project `bgcvurheqzylyfehqgzh`) and confirm the design's §0 still holds (nothing shifted since 2026-07-18):
```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='menu_items' order by ordinal_position;
-- expect: id,name,name_es,menu_price,toast_ref,active,created_at,created_by,updated_at,updated_by (NO catering_* / section / portion)
select conname from pg_constraint where conrelid='public.menu_items'::regclass;
-- expect: menu_items_menu_price_check, menu_items_pkey (no dual-FK surprises)
```
Expected: matches §0. If `menu_items` already has any `catering_*`/`portion`/`section` column, STOP and reconcile before proceeding.

- [ ] **Step 2: Write the migration SQL file**

Create `supabase/migrations/0128_catering_pricing_core.sql`:
```sql
-- Migration 0128_catering_pricing_core
-- Applied via Supabase MCP apply_migration on 2026-07-18.
-- Canonical reference: docs/superpowers/specs/2026-07-18-w1a-catering-pricing-core-design.md
--                      + lib/catering/pricing-derivation.ts
--
-- W1a: the catering price-derivation substrate. Subs live in menu_items (one entity,
-- catering-tagged); extras in items (existing 0123 flags). A per-location rate table drives
-- derivation. Prices are derived on read, never stored — this migration is schema only.

-- 1. menu_items: catering tags + portion + section (mirror the items 0123 flags).
ALTER TABLE public.menu_items
  ADD COLUMN catering_available boolean NOT NULL DEFAULT false,
  ADD COLUMN catering_only boolean NOT NULL DEFAULT false,
  ADD COLUMN catering_portionable boolean NOT NULL DEFAULT false,
  ADD COLUMN section text;

ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_catering_only_implies_available
  CHECK (NOT catering_only OR catering_available);

CREATE INDEX menu_items_catering_available
  ON public.menu_items (catering_available) WHERE catering_available;

-- 2. catering_rate_rules: catering price as a fraction of regular (bps), most-specific-wins.
--    Distinct from catering_pricing_rules (that is the charge stack: tax/gratuity/service/deposit).
CREATE TABLE public.catering_rate_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id  uuid NOT NULL REFERENCES public.locations(id),
  scope        text NOT NULL CHECK (scope IN ('location','section','item','menu_item')),
  scope_ref    text,  -- null for 'location'; section name for 'section'; entity id (text) for item/menu_item
  rate_bps     integer NOT NULL CHECK (rate_bps >= 0 AND rate_bps <= 30000),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES public.users(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES public.users(id)
);

-- One active rule per (location, scope, scope_ref) — COALESCE the nullable ref (mirrors
-- catering_packages_one_active). scope='location' has scope_ref NULL → coalesced to ''.
CREATE UNIQUE INDEX catering_rate_rules_one_active
  ON public.catering_rate_rules (location_id, scope, COALESCE(scope_ref, ''))
  WHERE active;

ALTER TABLE public.catering_rate_rules ENABLE ROW LEVEL SECURITY;
-- Deny-all to end users; service-role only (the lib is the authority), like the other catering-KB tables.

-- 3. catering_quote_items.portion — the snapshot line's chosen portion (subs).
ALTER TABLE public.catering_quote_items
  ADD COLUMN portion text
  CHECK (portion IS NULL OR portion IN ('quarter','half','whole'));
```

- [ ] **Step 3: Apply the migration via the Supabase MCP**

Apply via `apply_migration` (project `bgcvurheqzylyfehqgzh`, name `0128_catering_pricing_core`, the SQL above).
Expected: success, no error.

- [ ] **Step 4: Verify the applied schema**

Run via `execute_sql`:
```sql
select column_name from information_schema.columns
 where table_schema='public' and table_name='menu_items' and column_name in ('catering_available','catering_only','catering_portionable','section');
select column_name from information_schema.columns
 where table_schema='public' and table_name='catering_quote_items' and column_name='portion';
select indexname from pg_indexes where schemaname='public' and tablename='catering_rate_rules';
select relrowsecurity from pg_class where relname='catering_rate_rules';
```
Expected: 4 menu_items columns; `portion`; index `catering_rate_rules_one_active` (+ pkey); `relrowsecurity = true`.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/0128_catering_pricing_core.sql
git commit -m "feat(w1a): migration 0128 — catering pricing schema (menu_items tags, rate rules, portion)"
```

---

## Task 2: Pure derivation engine + tests

**Files:**
- Create: `lib/catering/pricing-derivation.ts`
- Create: `scripts/w1a-derivation-test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/w1a-derivation-test.ts`:
```ts
import assert from "node:assert/strict";
import {
  cateringUnitPriceCents,
  impliedRateBps,
  sumComponentsCents,
  resolveRateBps,
  type RateRule,
} from "@/lib/catering/pricing-derivation";

// Forward: whole sub $12.00 @ 85% → $10.20 / $5.10 / $2.55
assert.equal(cateringUnitPriceCents(1200, "whole", 8500), 1020);
assert.equal(cateringUnitPriceCents(1200, "half", 8500), 510);
assert.equal(cateringUnitPriceCents(1200, "quarter", 8500), 255);
// Raise: 110% whole → $13.20
assert.equal(cateringUnitPriceCents(1200, "whole", 11000), 1320);
// Rounding: 999¢ half @ 8500 = 424.575 → 425
assert.equal(cateringUnitPriceCents(999, "half", 8500), 425);

// Reverse
assert.equal(impliedRateBps(4500, 4900), 9184); // round(4500/4900*10000)
assert.equal(impliedRateBps(100, 0), null);      // baseline 0 → null

// Auto-sum
assert.equal(sumComponentsCents([{ unitCents: 510, qty: 2 }, { unitCents: 255, qty: 1 }]), 1275);

// Resolver: most-specific wins (menu_item > section > location > default 10000)
const rules: RateRule[] = [
  { scope: "location", scopeRef: null, rateBps: 9000 },
  { scope: "section", scopeRef: "Subs", rateBps: 8500 },
  { scope: "menu_item", scopeRef: "sub-1", rateBps: 8000 },
];
assert.equal(resolveRateBps(rules, { kind: "menu_item", entityId: "sub-1", section: "Subs" }), 8000);
assert.equal(resolveRateBps(rules, { kind: "menu_item", entityId: "sub-2", section: "Subs" }), 8500);
assert.equal(resolveRateBps(rules, { kind: "item", entityId: "x", section: "Drinks" }), 9000);
assert.equal(resolveRateBps([], { kind: "item", entityId: "x", section: null }), 10000);

console.log("w1a-derivation-test: all assertions passed");
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx tsx scripts/w1a-derivation-test.ts`
Expected: FAIL — cannot resolve `@/lib/catering/pricing-derivation` (module not created yet).

- [ ] **Step 3: Implement the engine**

Create `lib/catering/pricing-derivation.ts`:
```ts
/**
 * Catering price derivation — PURE, server/client-agnostic, no I/O (W1a).
 *
 * Catering price = regular price × portion fraction × catering rate. The rate is bps
 * (10000 = 100% = regular; < 10000 = wholesale discount; > 10000 = raise). Rounding is
 * nearest-cent (Math.round), consistent with lib/catering/quotes.ts bpsOf/lineTotalCents.
 */

export type Portion = "quarter" | "half" | "whole";
export const PORTION_FRACTION: Record<Portion, number> = { quarter: 0.25, half: 0.5, whole: 1 };
export const RATE_BPS_MIN = 0;
export const RATE_BPS_MAX = 30000;
export const DEFAULT_RATE_BPS = 10000;

/** Forward: recommended catering unit price for a portion. */
export function cateringUnitPriceCents(regularCents: number, portion: Portion, rateBps: number): number {
  return Math.round((regularCents * PORTION_FRACTION[portion] * rateBps) / 10000);
}

/** Reverse: implied effective rate (bps) from a chosen price vs a baseline. null if baseline ≤ 0. */
export function impliedRateBps(chosenCents: number, baselineCents: number): number | null {
  if (!Number.isFinite(baselineCents) || baselineCents <= 0) return null;
  return Math.round((chosenCents / baselineCents) * 10000);
}

/** Auto-sum primitive for combos/packages (W1b consumes this). */
export function sumComponentsCents(lines: Array<{ unitCents: number; qty: number }>): number {
  return lines.reduce((s, l) => s + Math.round(l.unitCents * l.qty), 0);
}

export interface RateRule {
  scope: "location" | "section" | "item" | "menu_item";
  scopeRef: string | null;
  rateBps: number;
}

/**
 * Most-specific-wins rate resolution: entity (item/menu_item) → section → location → default 10000.
 * Only pass ACTIVE rules. `kind` selects which entity scope matches `entityId`.
 */
export function resolveRateBps(
  rules: RateRule[],
  target: { kind: "item" | "menu_item"; entityId: string; section: string | null },
): number {
  const entity = rules.find((r) => r.scope === target.kind && r.scopeRef === target.entityId);
  if (entity) return entity.rateBps;
  if (target.section != null) {
    const section = rules.find((r) => r.scope === "section" && r.scopeRef === target.section);
    if (section) return section.rateBps;
  }
  const loc = rules.find((r) => r.scope === "location");
  if (loc) return loc.rateBps;
  return DEFAULT_RATE_BPS;
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx tsx scripts/w1a-derivation-test.ts`
Expected: `w1a-derivation-test: all assertions passed`.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` → Expected: clean.
```bash
git add lib/catering/pricing-derivation.ts scripts/w1a-derivation-test.ts
git commit -m "feat(w1a): pure catering pricing-derivation engine + tests"
```

---

## Task 3: Rate-rule reader (shared, un-gated)

**Files:**
- Create: `lib/catering/rate-rules.ts`

- [ ] **Step 1: Implement the reader**

Create `lib/catering/rate-rules.ts`:
```ts
/**
 * Active catering rate rules for a location — SERVER-ONLY, service-role, UN-GATED read
 * (mirrors lib/portal/menu.ts: the portal has no staff AuthContext; authority is the customer
 * session at the route + strict server-side price authority). Staff loaders reuse this too.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { RateRule } from "@/lib/catering/pricing-derivation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** All ACTIVE rate rules for a location, shaped for resolveRateBps. Empty array if none. */
export async function loadActiveRateRules(locationId: string): Promise<RateRule[]> {
  if (!UUID_RE.test(locationId)) throw new Error("catering rate-rules: locationId must be a UUID");
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("catering_rate_rules")
    .select("scope, scope_ref, rate_bps")
    .eq("location_id", locationId)
    .eq("active", true)
    .returns<Array<{ scope: RateRule["scope"]; scope_ref: string | null; rate_bps: number }>>();
  if (error) throw new Error(`loadActiveRateRules: ${error.message}`);
  return (data ?? []).map((r) => ({ scope: r.scope, scopeRef: r.scope_ref, rateBps: r.rate_bps }));
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck` → Expected: clean.
```bash
git add lib/catering/rate-rules.ts
git commit -m "feat(w1a): shared active-rate-rules reader"
```

---

## Task 4: Union menu loaders (portal + staff) with derivation

**Files:**
- Modify: `lib/catering/menu.ts` (the `CateringMenuItem` type + `loadCateringMenuItems`)
- Modify: `lib/portal/menu.ts` (`loadPublicCateringMenu`)

**Context to read first:** current `lib/catering/menu.ts` and `lib/portal/menu.ts` (the loaders read `items` only at raw `menu_price`). The `CateringMenuItem` type is imported by `lib/portal/menu.ts` and consumers.

- [ ] **Step 1: Extend `CateringMenuItem` + add a derivation helper in `lib/catering/menu.ts`**

Replace the `CateringMenuItem` interface with:
```ts
export interface CateringMenuItem {
  kind: "item" | "menu_item";
  id: string;                       // item_id OR menu_item_id (per kind)
  name: string;
  nameEs: string | null;
  section: string | null;
  cateringOnly: boolean;
  portionable: boolean;
  regularPriceCents: number;        // basis for recommend/implied-rate
  rateBps: number;                  // resolved effective rate
  unitPriceCents: number;           // whole catering price (= derived whole)
  portionPricesCents: { quarter: number; half: number; whole: number } | null; // present iff portionable
}
```

Add (top of file, after imports) a shared builder that both loaders use:
```ts
import { cateringUnitPriceCents, resolveRateBps, type RateRule } from "@/lib/catering/pricing-derivation";

/** Build a priced CateringMenuItem from a raw row + the location's rate rules. Returns null when
 *  the entity has no usable regular price (unpriceable → excluded, never sold at $0). */
export function buildCateringMenuItem(
  row: { kind: "item" | "menu_item"; id: string; name: string; nameEs: string | null; section: string | null;
         menuPriceCents: number; cateringOnly: boolean; portionable: boolean },
  rules: RateRule[],
): CateringMenuItem | null {
  if (!(row.menuPriceCents > 0)) return null;
  const rateBps = resolveRateBps(rules, { kind: row.kind, entityId: row.id, section: row.section });
  const whole = cateringUnitPriceCents(row.menuPriceCents, "whole", rateBps);
  return {
    kind: row.kind, id: row.id, name: row.name, nameEs: row.nameEs, section: row.section,
    cateringOnly: row.cateringOnly, portionable: row.portionable,
    regularPriceCents: row.menuPriceCents, rateBps, unitPriceCents: whole,
    portionPricesCents: row.portionable
      ? { quarter: cateringUnitPriceCents(row.menuPriceCents, "quarter", rateBps),
          half: cateringUnitPriceCents(row.menuPriceCents, "half", rateBps),
          whole }
      : null,
  };
}
```
(`portionable` for `items` is always false — items have no `catering_portionable`.)

- [ ] **Step 2: Rewrite `loadCateringMenuItems` to union items + menu_items + apply rates**

Change its signature to require a location (rates are per-location): `loadCateringMenuItems(actor: AuthContext, locationId: string)`. Body:
```ts
export async function loadCateringMenuItems(actor: AuthContext, locationId: string): Promise<CateringMenuItem[]> {
  requireLevel(actor, MENU_READ_MIN);
  if (!UUID_RE.test(locationId)) throw new Error("catering menu: invalid locationId");
  const sb = getServiceRoleClient();
  const rules = await loadActiveRateRules(locationId); // from "@/lib/catering/rate-rules"
  const [{ data: itemRows, error: iErr }, { data: subRows, error: sErr }] = await Promise.all([
    sb.from("items").select("id, name, name_es, section, menu_price, catering_only")
      .eq("active", true).eq("catering_available", true),
    sb.from("menu_items").select("id, name, name_es, section, menu_price, catering_only, catering_portionable")
      .eq("active", true).eq("catering_available", true),
  ]);
  if (iErr) throw new Error(`loadCateringMenuItems items: ${iErr.message}`);
  if (sErr) throw new Error(`loadCateringMenuItems menu_items: ${sErr.message}`);
  const out: CateringMenuItem[] = [];
  for (const r of itemRows ?? []) {
    const built = buildCateringMenuItem({ kind: "item", id: r.id, name: r.name, nameEs: r.name_es,
      section: r.section, menuPriceCents: dollarsToCents(r.menu_price), cateringOnly: r.catering_only,
      portionable: false }, rules);
    if (built) out.push(built);
  }
  for (const r of subRows ?? []) {
    const built = buildCateringMenuItem({ kind: "menu_item", id: r.id, name: r.name, nameEs: r.name_es,
      section: r.section, menuPriceCents: dollarsToCents(r.menu_price), cateringOnly: r.catering_only,
      portionable: r.catering_portionable }, rules);
    if (built) out.push(built);
  }
  return out.sort((a, b) => (a.section ?? "").localeCompare(b.section ?? "") || a.name.localeCompare(b.name));
}
```
Add `import { loadActiveRateRules } from "@/lib/catering/rate-rules";` and the `.returns<...>()` generics matching the selected columns (menu_price arrives as `number | string | null`).

- [ ] **Step 3: Rewrite `loadPublicCateringMenu` (portal) to take a locationId + union + derive**

In `lib/portal/menu.ts`, change `loadPublicCateringMenu()` → `loadPublicCateringMenu(locationId: string)`; add `assertLocationId(locationId)` at the top; load `rules` via `loadActiveRateRules(locationId)`; query the same two tables (un-gated) and build via `buildCateringMenuItem` (import it + the type from `lib/catering/menu`). Mirror the staff body above (drop the `requireLevel`).

- [ ] **Step 4: Update `loadPublicCateringMenu`'s caller in `submitOrder`**

`lib/portal/orders.ts` calls `loadPublicCateringMenu()` — Task 5 changes that call to `loadPublicCateringMenu(input.locationId)`. (Leave orders.ts otherwise for Task 5.) Also find any staff caller of `loadCateringMenuItems(actor)` (e.g., the quote builder page/route) and thread the location — `grep -rn "loadCateringMenuItems(" app lib` and fix each call to pass the locationId it already has in scope.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean once all callers pass `locationId`. Fix any caller the compiler flags.

- [ ] **Step 6: Commit**
```bash
git add lib/catering/menu.ts lib/portal/menu.ts app lib
git commit -m "feat(w1a): union catering menu loaders (items + menu_items) with derived portion prices"
```

---

## Task 5: submitOrder — menu_item + portion, server price authority

**Files:**
- Modify: `lib/portal/orders.ts`

**Context to read first:** `lib/portal/orders.ts` `submitOrder` (§4 resolves lines from the loader maps; `catering_quote_items` insert).

- [ ] **Step 1: Extend `SubmitLineInput` + `ResolvedLine`**
```ts
export interface SubmitLineInput {
  itemId?: string | null;
  menuItemId?: string | null;   // NEW — a sub (menu_item) reference
  packageId?: string | null;
  portion?: "quarter" | "half" | "whole" | null; // NEW — sub portion
  quantity: number;
  notes?: string | null;
}
```
Add `portion` + `menuItemId` to the internal `ResolvedLine` interface (`itemId: string | null; menuItemId: string | null; packageId: string | null; portion: "quarter"|"half"|"whole"|null; ...`).

- [ ] **Step 2: Rewrite the line-resolution block to key the unified map by (kind,id) + honor portion**

The menu map is now keyed by `${kind}:${id}`; portioned subs read `portionPricesCents[portion]`:
```ts
const menuByKey = new Map(menuItems.map((m) => [`${m.kind}:${m.id}`, m] as const));
// ...for each input line:
const menuItemId = l.menuItemId ?? null;
if (menuItemId != null && menuItemId !== "") {
  const sub = menuByKey.get(`menu_item:${menuItemId}`);
  if (!sub) throw new PortalOrderError(400, "invalid_line", `Line ${i + 1}: unknown sub`);
  const portion = l.portion ?? "whole";
  if (!sub.portionable && portion !== "whole") throw new PortalOrderError(400, "invalid_line", `Line ${i + 1}: item is not portioned`);
  const unitPriceCents = sub.portionable && sub.portionPricesCents ? sub.portionPricesCents[portion] : sub.unitPriceCents;
  return { itemId: null, menuItemId, packageId: null, portion: sub.portionable ? portion : null,
    description: sub.name, quantity, unitPriceCents, lineTotalCents: lineTotalCents(quantity, unitPriceCents), displayOrder: i };
}
```
Keep the existing `itemId` branch (extras — `portion: null`) and `packageId` branch (unchanged), and update the `loadPublicCateringMenu()` call to `loadPublicCateringMenu(input.locationId)`. Update the item branch to set `portion: null, menuItemId: null`.

- [ ] **Step 3: Persist `portion` + `menu_item_id` on the quote-items insert**

In the `catering_quote_items` insert map, add `menu_item_id: l.menuItemId` and `portion: l.portion`. (`item_id: l.itemId` stays.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck` → Expected: clean.

- [ ] **Step 5: Commit**
```bash
git add lib/portal/orders.ts
git commit -m "feat(w1a): submitOrder resolves menu_item subs + portions under server price authority"
```

---

## Task 6: Staff quote lines carry portion

**Files:**
- Modify: `lib/catering/quotes.ts`

- [ ] **Step 1: Add `portion` to `QuoteLineInput`, `ResolvedLine`, `resolveLines`, `insertQuoteItems`, `parseQuoteLinesFromBody`, `QuoteItem`/`mapItem`, `ITEM_COLS`**

- `QuoteLineInput`: add `portion?: "quarter" | "half" | "whole" | null;`
- `ResolvedLine`: add `portion: "quarter" | "half" | "whole" | null;`
- `resolveLines`: set `portion: l.portion ?? null` on the returned object (no new validation — staff price is caller-supplied; portion is descriptive).
- `insertQuoteItems`: add `portion: l.portion` to the insert map.
- `parseQuoteLinesFromBody`: add `portion: o.portion === "quarter" || o.portion === "half" || o.portion === "whole" ? o.portion : null`.
- `ITEM_COLS`: append `, portion`; `QuoteItem` interface: add `portion: "quarter"|"half"|"whole"|null;`; `mapItem`: map `portion: r.portion ?? null` (add `portion` to the mapItem param type).

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck` → Expected: clean.
```bash
git add lib/catering/quotes.ts
git commit -m "feat(w1a): staff quote lines snapshot portion"
```

---

## Task 7: Seeded dormant smoke

**Files:**
- Create: `scripts/w1a-smoke.ts`

- [ ] **Step 1: Write the smoke**

Create `scripts/w1a-smoke.ts` (run with the service-role env, mirrors `scripts/portal-3-smoke.ts` structure). It must: pick an active location; INSERT a portionable `menu_item` sub (`menu_price=12.00`, `catering_available=true`, `catering_portionable=true`, `section='Subs'`), a catering-available `item` extra (`menu_price=2.00`), a section rate rule (`scope='section', scope_ref='Subs', rate_bps=8500`), and a per-entity override for the extra; then:
```ts
import assert from "node:assert/strict";
import { loadPublicCateringMenu } from "@/lib/portal/menu";
import { submitOrder } from "@/lib/portal/orders";
// ...seed rows (capture ids), then:
const menu = await loadPublicCateringMenu(LOCATION_ID);
const sub = menu.find((m) => m.kind === "menu_item" && m.id === SUB_ID);
assert.ok(sub && sub.portionPricesCents);
assert.equal(sub.portionPricesCents.whole, 1020);
assert.equal(sub.portionPricesCents.half, 510);
assert.equal(sub.portionPricesCents.quarter, 255);
const extra = menu.find((m) => m.kind === "item" && m.id === EXTRA_ID);
assert.ok(extra && extra.portionPricesCents === null);
// submitOrder recomputes + persists; a spoofed client price is ignored (input carries no price field).
// (submitOrder needs a customer id — seed/reuse a catering_customers row like portal-3-smoke.)
console.log("w1a-smoke: PASS");
// ...ALWAYS roll back seeded rows in a finally block (delete by captured ids).
```

- [ ] **Step 2: Run the smoke**

Run: `npx tsx --env-file=.env.local scripts/w1a-smoke.ts`
Expected: `w1a-smoke: PASS`, and the finally block cleans up (re-run leaves 0 residue — verify with a count query).

- [ ] **Step 3: Commit**
```bash
git add scripts/w1a-smoke.ts
git commit -m "test(w1a): seeded dormant smoke — derived portion prices + submit"
```

---

## Task 8: Rate authoring lib

**Files:**
- Create: `lib/admin/catering/rate-rules.ts`

**Context to read first:** `lib/admin/catering/pricing.ts` — mirror its structure exactly (service-role, per-action `requireLevel`, `assertManagesLocation`/`accessibleLocations`, bps validation, append-only, audit).

- [ ] **Step 1: Implement the lib**

Create `lib/admin/catering/rate-rules.ts` mirroring `pricing.ts`, with:
- `RATE_MIN = 8` (MoO+), `RATE_ALL_LOCATIONS_MIN = 9`. Reuse the `accessibleLocations` / `assertManagesLocation` pattern (copy from pricing.ts — do not import its privates).
- `normalizeRateBps(v)`: integer `0..30000` else `AdminCateringError(400,"invalid_rate")`.
- `RateRuleView { id; locationId; scope; scopeRef; rateBps; recommendedNote? }`.
- `loadRateRules(actor, locationId)`: all active rules for a managed location, ordered scope then ref.
- `upsertRateRule(actor, { locationId, scope, scopeRef, rateBps })`: validate scope ∈ enum; scopeRef required unless scope='location' (then null); query-first one-active-per-(location,scope,coalesce(ref)) → update-in-place if exists else insert (mirror pricing.ts create/update split; the partial index backstops races). Audit `catering.kb.rate.create`/`.update`.
- `deactivateRateRule(actor, { ruleId, locationId })`: set active=false; audit `catering.kb.rate.deactivate`.

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck` → Expected: clean.
```bash
git add lib/admin/catering/rate-rules.ts
git commit -m "feat(w1a): rate-rule authoring lib (MoO+, append-only)"
```

---

## Task 9: Rate authoring API routes

**Files:**
- Create: `app/api/admin/catering/rate-rules/route.ts`
- Create: `app/api/admin/catering/rate-rules/[ruleId]/route.ts`

**Context to read first:** the existing `app/api/admin/catering/pricing/route.ts` (auth: `requireSession` → level floor → `assertStepUp` Tier B; error mapping via the `AdminCateringError` shape).

- [ ] **Step 1: GET (list) + POST (upsert) in `route.ts`**

Mirror the pricing route: `requireSession`; `assertStepUp` (Tier B) on POST; parse body (`locationId, scope, scopeRef, rateBps`); call `loadRateRules` / `upsertRateRule`; map `AdminCateringError` → `jsonError(status, code)`; `jsonOk(...)`.

- [ ] **Step 2: DELETE (deactivate) in `[ruleId]/route.ts`**

`await params` (Next 16 — params is a Promise); `assertStepUp` Tier B; call `deactivateRateRule(actor, { ruleId, locationId })` (locationId from query or body); map errors.

- [ ] **Step 3: Typecheck + build + commit**

Run: `npm run typecheck` && `npm run build`
Expected: clean (build catches any `useSearchParams`/Suspense or route-shape issues).
```bash
git add app/api/admin/catering/rate-rules
git commit -m "feat(w1a): rate-rule admin API routes"
```

---

## Task 10: Rate authoring UI

**Files:**
- Create: `app/(authed)/admin/catering/rate-rules/page.tsx` (Server Component — `requireSessionFromHeaders`, load rules + accessible locations, render client)
- Create: `app/(authed)/admin/catering/rate-rules/rate-rules-client.tsx` (client)
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json`

**Context to read first:** the existing catering pricing admin page/client (charge-stack rules) — mirror its layout, StepUp usage, and the per-location card pattern.

- [ ] **Step 1: Build the UI**

Per location the actor manages: a **default rate** input, a **per-section** list, and searchable **per-entity** overrides (subs + extras from `loadCateringMenuItems(actor, locationId)`). Each rate input accepts **% or target price**: on price entry, show `impliedRateBps(price, regular×fraction)`; on % entry, show `cateringUnitPriceCents(...)` — reuse the pure engine client-side. POST to the Task 9 routes; wrap `useSearchParams` (if any) in `<Suspense>`; add all new visible strings + ARIA labels as `catering.rate.*` keys in EN+ES (tú-form Spanish, operational tone).

- [ ] **Step 2: Typecheck + build + lint + commit**

Run: `npm run typecheck` && `npm run build` && `npm run lint`
Expected: clean.
```bash
git add "app/(authed)/admin/catering/rate-rules" lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(w1a): rate-rule authoring UI + i18n"
```

---

## Task 11: Portal build-page portion selector

**Files:**
- Modify: `app/order/build/page.tsx`
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json`

**Context to read first:** `app/order/build/page.tsx` (the cart + coverage; how lines are added + the submit payload shape).

- [ ] **Step 1: Add portion selection for subs**

For a `kind === "menu_item"` portionable item, render a ¼/½/whole selector (default whole) showing the portion price from `portionPricesCents`; each cart line records its `portion`. Extras (kind `item`) add as whole. Coverage counts servings by portion (¼=0.25, ½=0.5, whole=1 of a serving). Submit payload sends `{ menuItemId, portion, quantity }` for subs and `{ itemId, quantity }` for extras (matching Task 5's `SubmitLineInput`). Add `catering.portion.*` i18n keys (EN+ES).

- [ ] **Step 2: Typecheck + build + commit**

Run: `npm run typecheck` && `npm run build`
Expected: clean.
```bash
git add "app/order/build/page.tsx" lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(w1a): portal portion selector for catering subs"
```

---

## Final review (after all tasks)

- [ ] Dispatch a final code-reviewer over the whole diff against the spec (§8 scope + the recurring bug-class checklist: server price authority intact, no client price trusted, UUID guards on `.or()`, append-only rate rules, RLS deny-all, `noUncheckedIndexedAccess` safety on `portionPricesCents[portion]` and map gets).
- [ ] Re-run `npx tsx scripts/w1a-derivation-test.ts` + `npx tsx --env-file=.env.local scripts/w1a-smoke.ts` + `npm run build`.
- [ ] Use superpowers:finishing-a-development-branch.

---

## Self-review (plan vs. spec)

**Spec coverage:** engine + reverse + auto-sum (T2) ✓; `catering_rate_rules` + menu_items tags + `catering_quote_items.portion` (T1) ✓; rate reader/resolver (T2/T3) ✓; union loaders + derivation + portions (T4) ✓; submitOrder menu_item+portion under price authority (T5) ✓; staff quote portion (T6) ✓; seeded dormant smoke (T7) ✓; authoring lib+routes+UI, level-8, %/price bidirectional (T8–T10) ✓; portal portion picker (T11) ✓; §6 edge cases covered in T4 (unpriceable→excluded), T5 (portion-on-extra reject), T8 (bps bounds). Charge stack untouched ✓.

**Placeholder scan:** no TBD/TODO; each code step carries real code or an exact mirror-file + delta. UI tasks (T10/T11) specify exact files + behavior + i18n + the pattern to mirror rather than full JSX (DRY against strong existing components) — acceptable per "follow established patterns."

**Type consistency:** `Portion` = `"quarter"|"half"|"whole"` everywhere; `CateringMenuItem` gains `kind`/`portionable`/`portionPricesCents`/`regularPriceCents`/`rateBps` used consistently in T4/T5/T7/T10/T11; `RateRule` (`scope`/`scopeRef`/`rateBps`) consistent T2/T3/T8; `rate_bps 0..30000` consistent (migration + `normalizeRateBps` + engine `RATE_BPS_MAX`); `catering.kb.rate.*` audit actions consistent T8.
