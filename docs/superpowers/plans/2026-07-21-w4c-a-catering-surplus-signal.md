# W4c-a Catering Surplus Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect catering surplus (released reservations from cancelled confirmed orders) and surface it, classified by the 72h prep-start window — cancelled ≥3 days before the need date → raw SKU surplus; cancelled <3 days out → perishable prepped-item surplus — with destination hints, on the prep-demand view + LTO page + catering hub.

**Architecture:** A read-time classifier over W4a's ledger. A tiny migration stamps `released_at` when a reservation releases; `releasePrepDemand` sets it; a new `lib/catering/surplus.ts` reads released rows, classifies each by `need_date − released_at`, flattens raw-SKU surplus via W4b's primitives and keeps prep-surplus at item grain, and groups the result. Three read surfaces consume it. Advisory, dormant until catering data.

**Tech Stack:** Next.js 16 (App Router, server components), React 19, TypeScript strict + `noUncheckedIndexedAccess`, Supabase Postgres (service-role reads/writes), Tailwind v4. No unit-test framework — smoke via `tsx`.

**Model tiering:** CC (main loop) = sole reviewer + owns prod migration 0140 + all git; authors Tasks 1–3 + 6 inline. Sonnet 4.6 = Task 5 (UI surfaces). Fable 5 = Task 4 (surplus smoke). Sonnet + Fable dispatched in parallel (disjoint files; neither commits).

**Grounding verified 2026-07-21 (confirm-before-authoring):** next migration = 0140; `catering_prep_demand` has `consumed_at` but **no `released_at`**; RLS is column-agnostic + writes are service-role (no RLS change); W4b flatten primitives `perUnitSkuOzForItem`/`perUnitSkuOzForMenuItem` + `loadMeasures` + `skuContentOz` reusable; `resolveRefs` in `prep-demand.ts` is module-internal (must be exported for reuse); prep-demand page wrapper uses `Promise.all` + `loadPackageLocations`; `PrepDemandClient` tab state is `useState<"prep" | "sku">`.

---

## File Structure

- **`supabase/migrations/0140_catering_prep_demand_released_at.sql`** (create) — adds `released_at timestamptz` to `catering_prep_demand`.
- **`lib/catering/prep-demand.ts`** (modify) — stamp `released_at` in `releasePrepDemand`; `export` the internal `resolveRefs`.
- **`lib/catering/surplus.ts`** (create) — the surplus read: `loadCateringSurplus`, `loadPerishableSurplus`, classification, SKU flatten, `PREP_START_LEAD_DAYS`, `SURPLUS_READ_MIN`, types.
- **`app/admin/catering/prep-demand/page.tsx`** (modify) — load `loadCateringSurplus`, pass `surplus` to the client.
- **`components/admin/catering/prep-demand/PrepDemandClient.tsx`** (modify) — a `[Surplus]` third tab.
- **`app/lto/page.tsx`** (modify) — surface perishable surplus (W4c-b teaser) for level ≥6, keep the Module #17 placeholder note.
- **`app/admin/catering/page.tsx`** (modify) — a light perishable-surplus count on the prep-demand hub card.
- **`lib/i18n/en.json` + `lib/i18n/es.json`** (modify) — `catering.surplus.*` keys.
- **`scripts/w4c-a-surplus-smoke.ts`** (create) — seeded classification + churn-exclusion assertions.

---

## Task 1: Migration 0140 — `released_at` stamp column (CC)

**Files:**
- Create: `supabase/migrations/0140_catering_prep_demand_released_at.sql`

- [ ] **Step 1: Apply to prod via Supabase MCP** (CC only, project `bgcvurheqzylyfehqgzh`), name `0140_catering_prep_demand_released_at`:

```sql
-- Migration 0140_catering_prep_demand_released_at
-- W4c-a surplus signal: stamp when a reservation releases, so surplus can be classified by the
-- 72h prep-start window (need_date − released_at). Nullable; set by releasePrepDemand. RLS unchanged
-- (catering_prep_demand policies are column-agnostic; writes are service-role).

ALTER TABLE public.catering_prep_demand
  ADD COLUMN released_at timestamptz;
```

- [ ] **Step 2: Verify** via `execute_sql`:
```sql
select column_name, data_type, is_nullable from information_schema.columns
where table_schema='public' and table_name='catering_prep_demand' and column_name='released_at';
```
Expected: 1 row — `released_at timestamp with time zone YES`.

- [ ] **Step 3: Write the repo file** `supabase/migrations/0140_catering_prep_demand_released_at.sql`:
```sql
-- Migration 0140_catering_prep_demand_released_at
-- Applied via Supabase MCP apply_migration on 2026-07-21.
-- Canonical reference: lib/catering/surplus.ts + lib/catering/prep-demand.ts releasePrepDemand.

-- W4c-a surplus signal: stamp when a reservation releases, so surplus can be classified by the
-- 72h prep-start window (need_date − released_at). Nullable; set by releasePrepDemand. RLS unchanged
-- (catering_prep_demand policies are column-agnostic; writes are service-role).

ALTER TABLE public.catering_prep_demand
  ADD COLUMN released_at timestamptz;
```

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/0140_catering_prep_demand_released_at.sql
git commit -m "feat(w4c-a): migration 0140 — catering_prep_demand.released_at"
```

---

## Task 2: `releasePrepDemand` stamps `released_at` + export `resolveRefs` (CC)

**Files:**
- Modify: `lib/catering/prep-demand.ts` (releasePrepDemand ~153-163; resolveRefs signature ~311)

- [ ] **Step 1: Stamp `released_at` in `releasePrepDemand`**

In `lib/catering/prep-demand.ts`, change the `releasePrepDemand` update to also set `released_at`:

```ts
export async function releasePrepDemand(actor: AuthContext, pipelineId: string): Promise<void> {
  requireLevel(actor, PREP_DEMAND_READ_MIN);
  const sb = getServiceRoleClient();
  const { error } = await sb
    .from("catering_prep_demand")
    .update({ status: "released", released_at: new Date().toISOString() })
    .eq("pipeline_id", pipelineId)
    .eq("status", "reserved");
  if (error) throw new Error(`releasePrepDemand: ${error.message}`);
  void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.prep_demand.release", resourceTable: "catering_prep_demand", resourceId: pipelineId, metadata: {}, ipAddress: null, userAgent: null });
}
```

- [ ] **Step 2: Also stamp `released_at` in `reservePrepDemand`'s prior-row retirement**

In `reservePrepDemand`, the "retire prior reserved rows" update also sets `released_at` (so churn rows have a timestamp too; the surplus reader excludes them via the reserved-pipeline filter, but a stamped timestamp keeps the column consistent):

```ts
  // Idempotency: retire prior reserved rows (append-only — mark released, never delete).
  const { error: relErr } = await sb
    .from("catering_prep_demand")
    .update({ status: "released", released_at: new Date().toISOString() })
    .eq("pipeline_id", pipelineId)
    .eq("status", "reserved");
  if (relErr) throw new Error(`reservePrepDemand release-prior: ${relErr.message}`);
```

- [ ] **Step 3: Export `resolveRefs`**

Change the `resolveRefs` declaration from `async function resolveRefs(` to `export async function resolveRefs(` so `surplus.ts` can reuse it for prep-grain naming. (Its return type `{ name, itemDefns }` and signature `(sb, itemIds, menuIds, choiceIds)` are unchanged.)

- [ ] **Step 4: Typecheck**

Run: `cd ~/co-ops && npx tsc --noEmit; echo "TSC EXIT $?"`
Expected: EXIT 0.

- [ ] **Step 5: Commit**
```bash
git add lib/catering/prep-demand.ts
git commit -m "feat(w4c-a): stamp released_at on release + export resolveRefs"
```

---

## Task 3: Surplus read — `lib/catering/surplus.ts` (CC)

**Files:**
- Create: `lib/catering/surplus.ts`

Reference: `lib/catering/sku-demand.ts` (the W4b flatten pattern — `perUnitSkuOzForItem`/`perUnitSkuOzForMenuItem`, `PORTION_FRACTION` scale, `loadMeasures` + `skuContentOz` + `vendor_items` for SKU content), `lib/catering/prep-demand.ts` (`resolveRefs`, now exported).

- [ ] **Step 1: Write the module**

Create `lib/catering/surplus.ts`:

```ts
/**
 * W4c-a catering surplus signal — SERVER-ONLY, service-role. The cancellation flip-side of the moat:
 * released catering reservations (from cancelled confirmed orders) become surplus, classified by the
 * 72h prep-start window — cancelled ≥PREP_START_LEAD_DAYS before need_date → raw SKU surplus (flatten
 * via W4b); cancelled inside the window → perishable prepped-item surplus. Advisory; the manager
 * acting on it (LTO/discount) is W4c-b. DORMANT until catering data.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { PORTION_FRACTION, type Portion } from "@/lib/catering/pricing-derivation";
import { resolveRefs } from "@/lib/catering/prep-demand";
import { perUnitSkuOzForItem, perUnitSkuOzForMenuItem, loadMeasures } from "@/lib/prep-consumption";
import { skuContentOz } from "@/lib/recipe-math";

export const PREP_START_LEAD_DAYS = 3;    // ~72h prep-start window (Juan: "2–3 days before")
export const SURPLUS_READ_MIN = 6;        // catering_mgr+ (mirrors PREP_DEMAND_READ_MIN)

export type SurplusKind = "raw_sku" | "prep";

export interface SurplusLine {
  kind: SurplusKind;
  refKind: "item" | "menu_item" | "choice" | "sku";
  refId: string;
  name: string;
  portion: Portion | null;      // prep-grain only
  qty: number;                  // prep units (prep) | SKU packs (raw_sku; may be 0 if content unknown)
  oz: number | null;            // freed SKU oz (raw_sku) | null (prep)
  needDate: string;
  daysOut: number;              // floor(need_date − released_at) in days
  pipelineId: string;           // the cancelled lead
  destinationHint: "adjust_ordering" | "perishable";
}
export interface SurplusDay { needDate: string; lines: SurplusLine[] }

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new Error("surplus: insufficient role level");
}
function num(v: number | string | null): number {
  if (v === null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}
/** Whole calendar days between an ISO release timestamp and a YYYY-MM-DD need date (need − released). */
function daysBetween(releasedAtIso: string, needDate: string): number {
  const rel = new Date(releasedAtIso).getTime();
  const need = new Date(`${needDate}T00:00:00Z`).getTime();
  return Math.floor((need - rel) / 86_400_000);
}

interface ReleasedRow {
  pipeline_id: string;
  need_date: string;
  released_at: string | null;
  item_id: string | null;
  menu_item_id: string | null;
  choice_package_item_id: string | null;
  portion: Portion | null;
  qty: number | string;
}

/**
 * Recent catering surplus for a location: released reservations (from cancellations, excluding
 * re-confirm churn) classified by the 72h rule. Grouped by need date.
 */
export async function loadCateringSurplus(
  actor: AuthContext,
  args: { locationId: string; from: string; to: string },
): Promise<SurplusDay[]> {
  requireLevel(actor, SURPLUS_READ_MIN);
  const sb = getServiceRoleClient();

  const { data: released, error } = await sb
    .from("catering_prep_demand")
    .select("pipeline_id, need_date, released_at, item_id, menu_item_id, choice_package_item_id, portion, qty")
    .eq("location_id", args.locationId)
    .eq("status", "released")
    .not("released_at", "is", null)
    .gte("need_date", args.from)
    .lte("need_date", args.to)
    .returns<ReleasedRow[]>();
  if (error) throw new Error(`loadCateringSurplus released: ${error.message}`);
  const rows = released ?? [];
  if (rows.length === 0) return [];

  // Exclude re-confirm churn: a lead currently reserved again isn't a cancellation.
  const { data: reserved, error: rErr } = await sb
    .from("catering_prep_demand")
    .select("pipeline_id")
    .eq("location_id", args.locationId)
    .eq("status", "reserved")
    .returns<Array<{ pipeline_id: string }>>();
  if (rErr) throw new Error(`loadCateringSurplus reserved: ${rErr.message}`);
  const reservedPids = new Set((reserved ?? []).map((r) => r.pipeline_id));
  const cancelled = rows.filter((r) => r.released_at && !reservedPids.has(r.pipeline_id));
  if (cancelled.length === 0) return [];

  // Classify + accumulate. prepLines keyed for grain; skuAcc for raw_sku oz per (sku,date,pipeline).
  const prepLines: SurplusLine[] = [];
  const skuAcc = new Map<string, { skuId: string; needDate: string; pipelineId: string; daysOut: number; oz: number }>();
  const perUnitCache = new Map<string, Map<string, number>>();
  const itemIds = new Set<string>();
  const menuIds = new Set<string>();
  const choiceIds = new Set<string>();

  for (const r of cancelled) {
    const daysOut = daysBetween(r.released_at!, r.need_date);
    const qty = num(r.qty);
    const scale = qty * (r.portion ? PORTION_FRACTION[r.portion] : 1);
    const isChoice = r.choice_package_item_id != null;
    const rawSku = daysOut >= PREP_START_LEAD_DAYS && !isChoice; // choice can't flatten → always prep-grain

    if (!rawSku) {
      // prep-grain surplus line (item / menu_item / choice)
      const refKind = r.item_id ? "item" : r.menu_item_id ? "menu_item" : "choice";
      const refId = (r.item_id ?? r.menu_item_id ?? r.choice_package_item_id)!;
      if (refKind === "item") itemIds.add(refId);
      else if (refKind === "menu_item") menuIds.add(refId);
      else choiceIds.add(refId);
      prepLines.push({
        kind: "prep", refKind, refId, name: "", portion: r.portion, qty, oz: null,
        needDate: r.need_date, daysOut, pipelineId: r.pipeline_id, destinationHint: "perishable",
      });
      continue;
    }

    // raw_sku surplus: flatten to SKU oz via W4b primitives
    const isItem = r.item_id != null;
    const refId = (r.item_id ?? r.menu_item_id)!;
    const cacheKey = `${isItem ? "item" : "menu_item"}:${refId}`;
    let perUnit = perUnitCache.get(cacheKey);
    if (!perUnit) {
      perUnit = isItem ? await perUnitSkuOzForItem(refId) : await perUnitSkuOzForMenuItem(refId);
      perUnitCache.set(cacheKey, perUnit);
    }
    if (perUnit.size === 0 || scale <= 0) continue; // no recipe → nothing to flatten (silent-safe)
    for (const [sku, ozPerUnit] of perUnit) {
      const key = `${sku}|${r.need_date}|${r.pipeline_id}`;
      const acc = skuAcc.get(key) ?? { skuId: sku, needDate: r.need_date, pipelineId: r.pipeline_id, daysOut, oz: 0 };
      acc.oz += ozPerUnit * scale;
      skuAcc.set(key, acc);
    }
  }

  // Resolve prep-grain names.
  const refs = await resolveRefs(sb, itemIds, menuIds, choiceIds);
  for (const l of prepLines) l.name = refs.name(l.refKind as "item" | "menu_item" | "choice", l.refId);

  // Resolve SKU names + content-oz → packs for raw_sku lines.
  const skuIds = [...new Set([...skuAcc.values()].map((a) => a.skuId))];
  const skuMeta = new Map<string, { name: string; contentOz: number | null }>();
  if (skuIds.length) {
    const measures = await loadMeasures();
    const { data: skuRows } = await sb
      .from("vendor_items")
      .select("id, name, units_per_pack, each_size, each_measure, avg_oz_per_each")
      .in("id", skuIds)
      .returns<Array<{ id: string; name: string; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
    for (const s of skuRows ?? []) {
      const contentOz = skuContentOz(
        { unitsPerPack: s.units_per_pack, eachSize: num(s.each_size) || null, eachMeasure: s.each_measure, avgOzPerEach: num(s.avg_oz_per_each) || null },
        measures,
      );
      skuMeta.set(s.id, { name: s.name, contentOz });
    }
  }
  const skuLines: SurplusLine[] = [...skuAcc.values()].map((a) => {
    const meta = skuMeta.get(a.skuId);
    const contentOz = meta?.contentOz ?? null;
    const packs = contentOz != null && contentOz > 0 ? a.oz / contentOz : 0;
    return {
      kind: "raw_sku" as const, refKind: "sku" as const, refId: a.skuId,
      name: meta?.name ?? "SKU", portion: null, qty: packs, oz: a.oz,
      needDate: a.needDate, daysOut: a.daysOut, pipelineId: a.pipelineId, destinationHint: "adjust_ordering" as const,
    };
  });

  // Group by need date.
  const byDate = new Map<string, SurplusLine[]>();
  for (const l of [...prepLines, ...skuLines]) {
    const arr = byDate.get(l.needDate) ?? [];
    arr.push(l);
    byDate.set(l.needDate, arr);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([needDate, lines]) => ({ needDate, lines: lines.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** Prep-grain (perishable) surplus only — the LTO page's W4c-b teaser feed. */
export async function loadPerishableSurplus(
  actor: AuthContext,
  args: { locationId: string; from: string; to: string },
): Promise<SurplusLine[]> {
  const days = await loadCateringSurplus(actor, args);
  return days.flatMap((d) => d.lines).filter((l) => l.kind === "prep");
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/co-ops && npx tsc --noEmit; echo "TSC EXIT $?"`
Expected: EXIT 0. (Watch: `skuContentOz`'s param type only accepts `{unitsPerPack, eachSize, eachMeasure, avgOzPerEach}` — the W4b lesson; pass exactly those four.)

- [ ] **Step 3: Commit**
```bash
git add lib/catering/surplus.ts
git commit -m "feat(w4c-a): surplus read — classify released reservations by 72h prep-start window"
```

---

## Task 4: Surplus smoke — `scripts/w4c-a-surplus-smoke.ts` (Fable)

**Files:**
- Create: `scripts/w4c-a-surplus-smoke.ts`

Run: `npx tsx --env-file=.env.local scripts/w4c-a-surplus-smoke.ts`. Seeds released prep-demand rows directly (bypasses the moveStage lifecycle — tests the classifier), asserts, cleans up. Uses a real active location + a real actor (query one). Assert on `kind`, not exact SKU flatten (which needs recipes that may not exist — so the raw_sku classification is asserted by the row being CLASSIFIED raw_sku via daysOut, tolerating an empty SKU flatten when no recipe exists).

- [ ] **Step 1: Write the smoke**

Create `scripts/w4c-a-surplus-smoke.ts`:

```ts
/**
 * W4c-a surplus smoke — seeds released catering_prep_demand rows and asserts the 72h classifier +
 * churn exclusion. Run: npx tsx --env-file=.env.local scripts/w4c-a-surplus-smoke.ts
 * Seeds prep-demand directly (item refs) so classification is testable without catering recipes.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadCateringSurplus, PREP_START_LEAD_DAYS } from "@/lib/catering/surplus";
import { getRoleLevel } from "@/lib/roles";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

async function main() {
  const sb = getServiceRoleClient();
  const { data: loc } = await sb.from("locations").select("id").eq("active", true).limit(1).maybeSingle<{ id: string }>();
  if (!loc) { console.log("SKIP: no active location."); return; }
  // A real high-level actor for the read gate.
  const { data: u } = await sb.from("users").select("id, role").order("id").limit(50).returns<Array<{ id: string; role: string }>>();
  const admin = (u ?? []).find((x) => getRoleLevel(x.role) >= 6);
  if (!admin) { console.log("SKIP: no level>=6 user."); return; }
  const actor = { user: { id: admin.id, role: admin.role } } as unknown as Parameters<typeof loadCateringSurplus>[0];

  // A real item id (item ref path, no recipe needed for prep-grain classification).
  const { data: item } = await sb.from("items").select("id").eq("active", true).limit(1).maybeSingle<{ id: string }>();
  if (!item) { console.log("SKIP: no active item."); return; }

  // Dates: need_date 10 days out. Use a fabricated pipeline/quote uuid (FK? catering_prep_demand
  // pipeline_id/quote_id are NOT NULL uuids — seed a throwaway pipeline+quote to satisfy FKs if present).
  const needDate = ymd(new Date(Date.now() + 10 * 86_400_000));
  const createdIds: string[] = [];
  const pipelineIds: string[] = [];
  const quoteIds: string[] = [];

  async function seedLead(): Promise<{ pipelineId: string; quoteId: string }> {
    const { data: lead, error: le } = await sb.from("catering_pipeline")
      .insert({ contact_name: "w4c-smoke", stage: "lost", location_id: loc!.id, event_date: needDate, lead_source: "smoke", created_by: null })
      .select("id").single<{ id: string }>();
    if (le) throw new Error(`seed lead: ${le.message}`);
    pipelineIds.push(lead.id);
    const { data: q, error: qe } = await sb.from("catering_quotes")
      .insert({ root_id: null, version: 1, pipeline_id: lead.id, location_id: loc!.id, status: "draft", origin: "self_serve", event_date: needDate, is_delivery: false, created_by: null })
      .select("id").single<{ id: string }>();
    if (qe) throw new Error(`seed quote: ${qe.message}`);
    quoteIds.push(q.id);
    return { pipelineId: lead.id, quoteId: q.id };
  }

  async function seedReleased(pipelineId: string, quoteId: string, releasedAt: string, status = "released"): Promise<string> {
    const { data, error } = await sb.from("catering_prep_demand")
      .insert({ pipeline_id: pipelineId, quote_id: quoteId, location_id: loc!.id, need_date: needDate,
        item_id: item!.id, menu_item_id: null, choice_package_item_id: null, portion: null, qty: 5,
        status, released_at: status === "released" ? releasedAt : null, created_by: null })
      .select("id").single<{ id: string }>();
    if (error) throw new Error(`seed demand: ${error.message}`);
    createdIds.push(data.id);
    return data.id;
  }

  try {
    const from = ymd(new Date(Date.now() - 86_400_000));
    const to = ymd(new Date(Date.now() + 30 * 86_400_000));

    // (a) released 10 days before need (far out) → raw_sku classification (daysOut >= 3).
    const A = await seedLead();
    await seedReleased(A.pipelineId, A.quoteId, new Date(Date.now()).toISOString());
    let days = await loadCateringSurplus(actor, { locationId: loc.id, from, to });
    let all = days.flatMap((d) => d.lines).filter((l) => l.pipelineId === A.pipelineId);
    // With no catering recipe on the item, raw_sku flatten yields 0 SKU lines — that's expected;
    // the classification decision is what we assert: nothing prep-grain should appear for a far-out release.
    assert(all.every((l) => l.kind === "raw_sku"), "far-out release (>=3d) classifies raw_sku (no prep-grain lines)");
    assert(all.every((l) => l.daysOut >= PREP_START_LEAD_DAYS), "far-out daysOut >= PREP_START_LEAD_DAYS");

    // (b) released 1 day before need (inside window) → prep-grain line present.
    const B = await seedLead();
    const bReleased = new Date(new Date(`${needDate}T00:00:00Z`).getTime() - 1 * 86_400_000).toISOString();
    await seedReleased(B.pipelineId, B.quoteId, bReleased);
    days = await loadCateringSurplus(actor, { locationId: loc.id, from, to });
    all = days.flatMap((d) => d.lines).filter((l) => l.pipelineId === B.pipelineId);
    assert(all.length >= 1 && all.every((l) => l.kind === "prep"), "inside-window release (<3d) classifies prep-grain");
    assert(all.some((l) => l.refKind === "item"), "prep-grain surplus resolves the item ref");

    // (c) churn: a lead with BOTH a released and a reserved row is excluded.
    const C = await seedLead();
    await seedReleased(C.pipelineId, C.quoteId, new Date().toISOString());
    await seedReleased(C.pipelineId, C.quoteId, "", "reserved"); // fresh reserved row (re-confirm)
    days = await loadCateringSurplus(actor, { locationId: loc.id, from, to });
    all = days.flatMap((d) => d.lines).filter((l) => l.pipelineId === C.pipelineId);
    assert(all.length === 0, "re-confirm churn (has a reserved row) is excluded from surplus");

    console.log("\nW4c-a surplus smoke: ALL PASS");
  } finally {
    if (createdIds.length) await sb.from("catering_prep_demand").delete().in("id", createdIds);
    if (quoteIds.length) await sb.from("catering_quotes").delete().in("id", quoteIds);
    if (pipelineIds.length) await sb.from("catering_pipeline").delete().in("id", pipelineIds);
    console.log("cleanup done");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run**

Run: `cd ~/co-ops && npx tsx --env-file=.env.local scripts/w4c-a-surplus-smoke.ts`
Expected: `✓` lines then `W4c-a surplus smoke: ALL PASS` + `cleanup done` (or a clean `SKIP`).

If an insert fails on a NOT NULL column not provided, query the table shape and add the required column to the seed; do not weaken an assertion. If a genuine classification assertion fails, STOP and report.

- [ ] **Step 3: Commit** (CC runs the smoke itself before committing)
```bash
git add scripts/w4c-a-surplus-smoke.ts
git commit -m "test(w4c-a): surplus classifier smoke — raw_sku / prep / churn-exclusion"
```

---

## Task 5: Surplus surfaces — tab + LTO page + hub badge (Sonnet)

**Files:**
- Modify: `app/admin/catering/prep-demand/page.tsx`
- Modify: `components/admin/catering/prep-demand/PrepDemandClient.tsx`
- Modify: `app/lto/page.tsx`
- Modify: `app/admin/catering/page.tsx`
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json`

Reference patterns: the existing prep-demand page wrapper (`Promise.all` + `loadPackageLocations` + passes props to `PrepDemandClient`), `PrepDemandClient`'s existing tab (`useState<"prep" | "sku">` at line ~63, tab buttons ~116-140, panels ~143-170), and how other admin reads gate with `requireSessionFromHeaders` + a level check.

- [ ] **Step 1: Load surplus in the prep-demand page wrapper**

In `app/admin/catering/prep-demand/page.tsx`, import `loadCateringSurplus` + `type SurplusDay` from `@/lib/catering/surplus`, add it to the `Promise.all` (same `{locationId, from, to}` window), and pass `surplus={surplus}` to `<PrepDemandClient>`. When `locationId` is null, pass `surplus={[]}`.

- [ ] **Step 2: Add the `[Surplus]` tab to `PrepDemandClient`**

- Add `surplus: SurplusDay[]` to the Props interface + destructure it.
- Change tab state to `useState<"prep" | "sku" | "surplus">("prep")`.
- Add a third tab button "Surplus" (i18n `admin.catering.prep_demand.tab_surplus`) mirroring the existing two buttons' markup + aria-selected pattern.
- Add a panel `{activeTab === "surplus" && (…)}` that renders `surplus` grouped by date. For each `SurplusDay`, a date heading; within it, split lines into **perishable prep surplus** (`kind==='prep'`) and **raw SKU surplus** (`kind==='raw_sku'`) — two labeled sub-sections. Each line: `name`, qty (prep: `qty ×portion` label like the prep tab; raw_sku: `oz` and, when `qty>0`, `~N packs`), `daysOut` ("Nd out"), and the destination hint (`catering.surplus.hint.perishable` / `catering.surplus.hint.adjust_ordering`). Perishable lines get an "act soon" visual emphasis (e.g. `text-co-cta` accent), matching the existing over-par styling. Empty state when `surplus` is empty (i18n `admin.catering.prep_demand.surplus_empty`).

- [ ] **Step 3: Surface perishable surplus on the LTO page**

In `app/lto/page.tsx`: add `requireSessionFromHeaders("/lto")` (import from `@/lib/session`) + `ROLES` level check. For level ≥ `SURPLUS_READ_MIN`, load perishable surplus across the actor's catering locations: `loadPackageLocations(auth)` then `Promise.all` of `loadPerishableSurplus(auth, {locationId, from, to})` (window: today → +14 using the same `todayYmd`/`addDays` helpers as the prep-demand page — copy them locally or inline). Render a "Surplus available to promote" section listing the perishable lines (name / qty / location / needDate). Keep the existing `PlaceholderCard` (Module #17 performance) BELOW as a secondary "Performance tracking — coming" note. For level < min, render the placeholder only. This page becomes a real server component (`async`), so add `export const dynamic = "force-dynamic"` (it now reads the DB via service-role, which throws at build with no env — the Phase-2 build-gate lesson).

- [ ] **Step 4: Hub badge**

In `app/admin/catering/page.tsx`, add a light perishable-surplus count near the prep-demand card: load `loadPerishableSurplus` across the actor's locations (or a cheap count) and, when > 0, render a small chip "N surplus" (i18n `admin.catering.hub.surplus_count`). If this bloats the hub server component, keep it minimal — a count is enough; don't add a full surplus list here. If the hub is a client component or can't easily do the async load, SKIP the badge and note it in your report (the tab + LTO page are the primary surfaces).

- [ ] **Step 5: i18n keys**

Add to BOTH `lib/i18n/en.json` and `lib/i18n/es.json` (Spanish operational tú-form; match the existing flat-dotted style; escape inner quotes as `\"`):
- `admin.catering.prep_demand.tab_surplus`: "Surplus" / "Excedente"
- `admin.catering.prep_demand.surplus_empty`: "No surplus from recent cancellations." / "Sin excedente de cancelaciones recientes."
- `catering.surplus.section_perishable`: "Perishable prep surplus" / "Excedente de prep perecedero"
- `catering.surplus.section_raw`: "Raw SKU surplus" / "Excedente de insumos (SKU)"
- `catering.surplus.hint.perishable`: "Perishable — route to an LTO, discount, or staff meal soon." / "Perecedero — destina a un LTO, descuento o comida de personal pronto."
- `catering.surplus.hint.adjust_ordering`: "Raw stock freed — adjust ordering or use in normal service." / "Insumo liberado — ajusta el pedido o úsalo en el servicio normal."
- `catering.surplus.days_out`: "{n}d out" / "en {n}d"
- `lto.surplus_title`: "Surplus available to promote" / "Excedente disponible para promover"
- `lto.surplus_empty`: "No perishable surplus right now." / "Sin excedente perecedero por ahora."
- `admin.catering.hub.surplus_count`: "{n} surplus" / "{n} excedente"

- [ ] **Step 6: Typecheck + build**

Run: `cd ~/co-ops && npx tsc --noEmit 2>&1 | tail -12 ; echo "TSC EXIT ${PIPESTATUS[0]}"` → EXIT 0.
Run: `cd ~/co-ops && npm run build 2>&1 | tail -15` → success; confirm `/lto` compiles (now `ƒ` dynamic, no prerender error) and both i18n JSON files parse.

- [ ] **Step 7: Report to CC (do NOT commit)**

Report files changed, tsc/build tails, whether the hub badge was added or skipped, and confirm the LTO page keeps the Module #17 placeholder for sub-level users.

---

## Task 6: Gates, review, PR (CC)

- [ ] **Step 1: CC reviews Sonnet's diff** against the recurring-bug-class checklist — focus: the `[Surplus]` tab renders both sub-sections + empty state; the LTO page gates surplus at ≥6 and keeps the placeholder for lower levels + `dynamic="force-dynamic"`; no `useSearchParams` without Suspense; i18n JSON valid; no silent truncation in the new loaders (surplus reads are location+window scoped and small — fine).

- [ ] **Step 2: Full gates**
```bash
cd ~/co-ops && npx tsc --noEmit; echo "TSC EXIT $?"
cd ~/co-ops && npm run build 2>&1 | tail -8
```
Expected: TSC EXIT 0; build success.

- [ ] **Step 3: Commit Sonnet's work + push**
```bash
git add app/admin/catering/prep-demand/page.tsx components/admin/catering/prep-demand/PrepDemandClient.tsx app/lto/page.tsx app/admin/catering/page.tsx lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(w4c-a): surplus surfaces — prep-demand tab + LTO page + hub badge"
git push -u origin claude/w4c-a-catering-surplus
```

- [ ] **Step 4: Open the PR**
```bash
gh pr create --title "feat(w4c-a): catering surplus signal (cancellation flip-side of the moat)" --body "$(cat <<'EOF'
## W4c-a — Catering Surplus Signal

The cancellation flip-side of the reserve/deplete moat (W4a prep / W4b SKU). When a confirmed catering order is cancelled, its released reservations become **surplus**, classified by the 72h prep-start window and surfaced with destination hints. The manager *acting* on surplus (LTO/discount) is **W4c-b** (deferred, own design).

### What shipped
- **Migration 0140** — `catering_prep_demand.released_at` (stamped on release).
- **`lib/catering/surplus.ts`** — `loadCateringSurplus` classifies released reservations by `need_date − released_at`: **≥3 days out → raw SKU surplus** (flatten via W4b, "adjust ordering"); **<3 days → perishable prep surplus** ("LTO/discount/staff meal soon"). Excludes re-confirm churn. `loadPerishableSurplus` feeds the LTO page.
- **Surfaces** — a `[Surplus]` tab on `/admin/catering/prep-demand`, a perishable-surplus section on the LTO page (W4c-b teaser; Module #17 placeholder retained), a hub count badge.
- **Smoke** — raw_sku / prep classification + churn-exclusion (all pass, zero residue).

### Dormant until data
Advisory; no stored on-hand. With 0 catering data every surface renders empty. Activates as confirmed-then-cancelled catering leads accrue.

### Deferred
- **W4c-b** — the LTO/discount action engine (manager turns surplus into a live LTO/discount). Own design; overlaps Module #17.
- General **line** over-prep surplus (over-prep vs sales) as a second source.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Watch CI to green**
```bash
gh pr checks --watch
```
Report the PR number + state to Juan; do NOT merge (Juan reviews + merges).

---

## Notes for the implementer

- **CC owns migration 0140 + all commits + the smoke run.** Sonnet reports, does not commit. Fable's smoke is run by CC before committing.
- **`skuContentOz` param type** accepts only `{unitsPerPack, eachSize, eachMeasure, avgOzPerEach}` (the W4b typecheck lesson) — pass exactly those four.
- **`noUncheckedIndexedAccess`:** guard array/Map access; the smoke's `u.find`, `[0]` accesses, and Map gets need care.
- **Advisory + dormant:** every surface must render a clean empty state with 0 data.
- **Do not re-architect the reserve model** — W4c-a is a read-time classifier only; the sole write is the `released_at` stamp.
