# W4a — Catering Prep-Demand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a catering lead is confirmed/out, resolve its quote into an append-only `catering_prep_demand` ledger (item grain) and surface it as a date-scoped demand overlay + over-par alert + manual par-bump — the prep layer of the catering↔inventory moat.

**Architecture:** One migration adds the `catering_prep_demand` ledger. A new `lib/catering/prep-demand.ts` holds the reserve/consume/release lifecycle + the quote→demand resolution walk; `moveStage()` calls it best-effort on the confirm/out/revert transitions. A read lib derives the overlay + whole-equivalent over-par comparison (reusing `lib/items.ts` par primitives + W1a `PORTION_FRACTION`). A standalone admin "Catering Prep Demand" manager view renders it. DORMANT until catering data lands (empty overlay, no errors).

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`, route `params` is a Promise), React 19, Tailwind v4, TS strict + `noUncheckedIndexedAccess`, Supabase (service-role + RLS, project `bgcvurheqzylyfehqgzh`), integer money / numeric qty. Tests = `tsx` seeded smoke. Branch: `claude/w4a-catering-prep-demand`.

**Model tiering (per W1a/W1b/3a):** CC authors T1 (migration — CC owns prod), T2/T3/T4 (lib cores — prescriptive) inline; Sonnet 4.6 on T5 (UI); Fable 5 on T6 (smoke). CC is SOLE reviewer of every diff + owns the prod migration (0137) + all git.

---

## Confirm-before-authoring — VERIFIED against live DB + code (2026-07-19)

- **Schema (queried live):** `catering_quotes` has `pipeline_id, location_id, status, event_date (nullable), superseded_at, root_id, version, created_at`. `catering_quote_items` cols: `id, quote_id, item_id, menu_item_id, package_id, description, quantity, unit_price_cents, line_total_cents, display_order, portion`; `one_ref` CHECK = `(item_id IS NULL OR menu_item_id IS NULL)` (package lines: both null + `package_id`). `catering_package_items` has `slot_type` (`fixed|choice`), `item_id`, `menu_item_id`, `quantity`, `active`. `item_par_levels`: `item_id, location_id, day_of_week, par_value, par_unit, par_mode, active` — **`item`-only** (no `menu_item` pars). Next repo migration = **0137**.
- **`lib/catering/pipeline.ts`:** `PIPELINE_STAGES = ["inquiry","quote_sent","confirmed","out","completed","lost"]`; sole transition fn `moveStage(actor, {id, toStage, note?})`; error class `CateringPipelineError(status, code, message?)`; `requireLevel(actor, min)`; `PIPELINE_WRITE_MIN=6`, `PIPELINE_READ_MIN=5`; `getServiceRoleClient` from `@/lib/supabase-server`; `audit({actorId, actorRole, action, resourceTable, resourceId, metadata, ipAddress, userAgent})` from `@/lib/audit`; `getRoleLevel` from `@/lib/roles`; `AuthContext` from `@/lib/session`.
- **`lib/items.ts` (par primitives, all exported):** `loadItemDefns(service, itemIds) → Map<id, {name, nameEs, defaultPar, defaultParUnit}>`; `loadItemOverrides(service, itemIds, locationId) → Map<id, ItemParRow[]>` (each `{dayOfWeek, parValue, parUnit, parMode}`); `pickOverride(rows, dayOfWeek) → {parValue, parUnit, parMode} | null`; `operationalDayOfWeek(yyyyMmDd) → number`. Par value semantic: `par = override?.parMode==='manual' ? override.parValue : item.defaultPar`.
- **`lib/catering/pricing-derivation.ts`:** `export type Portion = "quarter"|"half"|"whole"`; `export const PORTION_FRACTION: Record<Portion, number> = { quarter: 0.25, half: 0.5, whole: 1 }`.
- **RLS pattern (0113/0120):** child tables use `catering_pipeline_loc(uuid)` / `catering_quote_loc(uuid)` SECURITY-DEFINER helpers because they DON'T store location. **W4a stores `location_id` on the row (NOT NULL)** → gate directly on it (no helper needed), mirroring the read shape `level >= 9 OR location ∈ current_user_locations()`.
- **Admin catering hub:** `app/admin/catering/page.tsx` renders a card grid from an `EDITORS` array (`{id, href, i18nKey, minLevel}`), gated `level >= 6`. Sub-pages follow `requireSessionFromHeaders("/admin")` → `ROLES[role].level` → `redirect("/dashboard")` if below floor. **DEVIATION FROM SPEC §6:** there is **no admin pipeline lead-detail page** (pipeline UI is the board at `app/(authed)/catering/pipeline`). So the "per-lead breakdown" is **folded into the standalone view** (demand annotated by source lead); a dedicated per-lead page is deferred. `loadLeadPrepDemand` is still built (cheap, used for the annotation + future page).

---

## File Structure

- **Create** `supabase/migrations/0137_catering_prep_demand.sql` — the ledger table + RLS + indexes (CC applies to prod).
- **Create** `lib/catering/prep-demand.ts` — lifecycle (`reservePrepDemand`/`consumePrepDemand`/`releasePrepDemand`/`resyncPrepDemand`) + resolution walk + read (`loadCateringPrepDemand`/`loadLeadPrepDemand`).
- **Modify** `lib/catering/pipeline.ts` — `moveStage()` calls the lifecycle best-effort on confirm/out/completed/revert/lost.
- **Create** `app/admin/catering/prep-demand/page.tsx` + `components/admin/catering/prep-demand/PrepDemandClient.tsx` — the manager view.
- **Modify** `app/admin/catering/page.tsx` — add the hub `EDITORS` card.
- **Modify** `lib/i18n/en.json` + `lib/i18n/es.json` — `admin.catering.prep_demand.*` keys.
- **Create** `scripts/w4a-smoke.ts` — seeded lifecycle smoke.

---

## Task 1: Migration 0137 — `catering_prep_demand` ledger (CC authors + applies)

**Files:** Create `supabase/migrations/0137_catering_prep_demand.sql`; apply via Supabase MCP (CC only).

**Context:** Additive, dormant-safe. CC applies to prod via `apply_migration` then commits the repo file. Location is stored on the row (NOT NULL) so RLS gates directly (no parent-loc helper).

- [ ] **Step 1: Write the migration file**
```sql
-- Migration 0137_catering_prep_demand
-- Applied via Supabase MCP apply_migration on 2026-07-19.
-- Canonical reference: docs/superpowers/specs/2026-07-19-w4a-catering-prep-demand-design.md
--                      + lib/catering/prep-demand.ts
--
-- W4a: an append-only ledger of prep demand generated by confirmed catering leads.
-- One row per resolved prep unit. reserve on stage->confirmed; consume on ->out/completed;
-- release on revert/lost. 3-way XOR ref: a resolved item, a resolved menu_item, or an
-- UNRESOLVED W1b choice slot (choice_package_item_id).

CREATE TABLE public.catering_prep_demand (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id             uuid NOT NULL REFERENCES public.catering_pipeline(id),
  quote_id                uuid NOT NULL REFERENCES public.catering_quotes(id),
  location_id             uuid NOT NULL REFERENCES public.locations(id),
  need_date               date NOT NULL,
  item_id                 uuid REFERENCES public.items(id),
  menu_item_id            uuid REFERENCES public.menu_items(id),
  choice_package_item_id  uuid REFERENCES public.catering_package_items(id),
  portion                 text CHECK (portion IN ('quarter','half','whole')),
  qty                     numeric NOT NULL CHECK (qty > 0),
  status                  text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','consumed','released')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES public.users(id),
  consumed_at             timestamptz,
  CONSTRAINT catering_prep_demand_one_ref CHECK (
    (item_id IS NOT NULL)::int + (menu_item_id IS NOT NULL)::int + (choice_package_item_id IS NOT NULL)::int = 1
  )
);

-- The overlay read: reserved demand at a location over a date window.
CREATE INDEX catering_prep_demand_overlay
  ON public.catering_prep_demand (location_id, need_date) WHERE status = 'reserved';
-- Lifecycle ops key off the lead.
CREATE INDEX catering_prep_demand_pipeline
  ON public.catering_prep_demand (pipeline_id);

ALTER TABLE public.catering_prep_demand ENABLE ROW LEVEL SECURITY;
-- Read: owner/cgs (>=9) globally, or staff whose locations include the row's location.
CREATE POLICY catering_prep_demand_read ON public.catering_prep_demand FOR SELECT
  USING (
    public.current_user_role_level() >= 9
    OR location_id = ANY (public.current_user_locations())
  );
-- Writes are service-role only (the lib is the authority) — deny all end-user writes.
CREATE POLICY catering_prep_demand_no_user_insert ON public.catering_prep_demand FOR INSERT WITH CHECK (false);
CREATE POLICY catering_prep_demand_no_user_update ON public.catering_prep_demand FOR UPDATE USING (false);
CREATE POLICY catering_prep_demand_no_user_delete ON public.catering_prep_demand FOR DELETE USING (false);
```

- [ ] **Step 2: (CC) apply via Supabase MCP + verify**
CC runs `apply_migration(name="0137_catering_prep_demand", query=<SQL>)`, then:
```sql
SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='catering_prep_demand'; -- Expect: 13
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='catering_prep_demand_one_ref';
-- Expect the 3-way XOR sum = 1
SELECT relrowsecurity FROM pg_class WHERE relname='catering_prep_demand'; -- Expect: true
SELECT count(*)::int FROM pg_policies WHERE tablename='catering_prep_demand'; -- Expect: 4
```

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/0137_catering_prep_demand.sql
git commit -m "feat(w4a): migration 0137 — catering_prep_demand ledger"
```

---

## Task 2: `lib/catering/prep-demand.ts` — lifecycle + resolution + read (CC authors)

**Files:** Create `lib/catering/prep-demand.ts`.

**Context:** Service-role, server-only. The lifecycle fns are called by `moveStage` (T3); the read fns feed the UI (T5). Mirrors the catering-lib conventions (error class, `requireLevel`, `audit`, `getServiceRoleClient`).

- [ ] **Step 1: Header + imports + constants + the resolution walk**
```ts
/**
 * W4a catering prep-demand — SERVER-ONLY, service-role. The prep layer of the catering↔inventory
 * moat. Confirmed leads resolve their current quote into an append-only catering_prep_demand ledger;
 * the read fns derive a date-scoped demand overlay + whole-equivalent over-par alert. Advisory only —
 * nothing here holds/decrements stock (there is no stored on-hand). DORMANT until catering data lands.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { audit } from "@/lib/audit";
import { PORTION_FRACTION, type Portion } from "@/lib/catering/pricing-derivation";
import { loadItemDefns, loadItemOverrides, pickOverride, operationalDayOfWeek } from "@/lib/items";

export const PREP_DEMAND_READ_MIN = 6; // catering_mgr+ views the demand surface

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new Error("prep-demand: insufficient role level");
}

type Sb = ReturnType<typeof getServiceRoleClient>;

/** A resolved demand row to insert (one of item/menuItem/choice ref set). */
interface ResolvedDemand {
  itemId: string | null;
  menuItemId: string | null;
  choicePackageItemId: string | null;
  portion: Portion | null;
  qty: number;
}

/** Resolve a lead's current quote lines into concrete prep demand (item grain). */
async function resolveQuoteDemand(sb: Sb, quoteId: string): Promise<ResolvedDemand[]> {
  const { data: lines, error } = await sb
    .from("catering_quote_items")
    .select("item_id, menu_item_id, package_id, quantity, portion")
    .eq("quote_id", quoteId)
    .returns<Array<{ item_id: string | null; menu_item_id: string | null; package_id: string | null; quantity: number | string; portion: Portion | null }>>();
  if (error) throw new Error(`resolveQuoteDemand items: ${error.message}`);

  const out: ResolvedDemand[] = [];
  const packageLineQty = new Map<string, number>(); // package_id -> line quantity (to multiply components)
  for (const l of lines ?? []) {
    const qty = typeof l.quantity === "string" ? Number(l.quantity) : l.quantity;
    if (l.item_id) { out.push({ itemId: l.item_id, menuItemId: null, choicePackageItemId: null, portion: l.portion, qty }); continue; }
    if (l.menu_item_id) { out.push({ itemId: null, menuItemId: l.menu_item_id, choicePackageItemId: null, portion: l.portion, qty }); continue; }
    if (l.package_id) packageLineQty.set(l.package_id, (packageLineQty.get(l.package_id) ?? 0) + qty);
  }

  // Resolve package lines → their active components (fixed → concrete ref; choice → unresolved slot).
  if (packageLineQty.size) {
    const { data: comps, error: cErr } = await sb
      .from("catering_package_items")
      .select("id, package_id, slot_type, item_id, menu_item_id, quantity")
      .in("package_id", [...packageLineQty.keys()])
      .eq("active", true)
      .returns<Array<{ id: string; package_id: string; slot_type: string; item_id: string | null; menu_item_id: string | null; quantity: number | string }>>();
    if (cErr) throw new Error(`resolveQuoteDemand package components: ${cErr.message}`);
    for (const c of comps ?? []) {
      const lineQty = packageLineQty.get(c.package_id) ?? 0;
      const compQty = typeof c.quantity === "string" ? Number(c.quantity) : c.quantity;
      const qty = lineQty * compQty;
      if (qty <= 0) continue;
      if (c.slot_type === "choice") {
        out.push({ itemId: null, menuItemId: null, choicePackageItemId: c.id, portion: null, qty });
      } else if (c.menu_item_id) {
        out.push({ itemId: null, menuItemId: c.menu_item_id, choicePackageItemId: null, portion: null, qty });
      } else if (c.item_id) {
        out.push({ itemId: c.item_id, menuItemId: null, choicePackageItemId: null, portion: null, qty });
      }
    }
  }
  return out;
}
```

- [ ] **Step 2: Lifecycle — reserve / consume / release / resync**
```ts
/** Load the lead's current (latest non-superseded) quote header. */
async function loadCurrentQuote(sb: Sb, pipelineId: string): Promise<{ id: string; location_id: string; event_date: string | null } | null> {
  const { data, error } = await sb
    .from("catering_quotes")
    .select("id, location_id, event_date")
    .eq("pipeline_id", pipelineId)
    .is("superseded_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; location_id: string; event_date: string | null }>();
  if (error) throw new Error(`loadCurrentQuote: ${error.message}`);
  return data ?? null;
}

/**
 * Reserve prep demand for a confirmed lead. Idempotent: releases any existing 'reserved'
 * rows for the lead, then inserts fresh from the current quote (so a re-confirm / resync
 * re-resolves without double-counting). No-op if there's no current quote or no event_date.
 */
export async function reservePrepDemand(actor: AuthContext, pipelineId: string): Promise<void> {
  requireLevel(actor, PREP_DEMAND_READ_MIN);
  const sb = getServiceRoleClient();
  const quote = await loadCurrentQuote(sb, pipelineId);
  if (!quote || !quote.event_date) return; // can't prep-plan without a dated quote

  // Idempotency: retire prior reserved rows (append-only — mark released, never delete).
  const { error: relErr } = await sb
    .from("catering_prep_demand")
    .update({ status: "released" })
    .eq("pipeline_id", pipelineId)
    .eq("status", "reserved");
  if (relErr) throw new Error(`reservePrepDemand release-prior: ${relErr.message}`);

  const demand = await resolveQuoteDemand(sb, quote.id);
  if (demand.length) {
    const rows = demand.map((d) => ({
      pipeline_id: pipelineId,
      quote_id: quote.id,
      location_id: quote.location_id,
      need_date: quote.event_date,
      item_id: d.itemId,
      menu_item_id: d.menuItemId,
      choice_package_item_id: d.choicePackageItemId,
      portion: d.portion,
      qty: d.qty,
      status: "reserved" as const,
      created_by: actor.user.id,
    }));
    const { error: insErr } = await sb.from("catering_prep_demand").insert(rows);
    if (insErr) throw new Error(`reservePrepDemand insert: ${insErr.message}`);
  }
  void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.prep_demand.reserve", resourceTable: "catering_prep_demand", resourceId: pipelineId, metadata: { quote_id: quote.id, rows: demand.length }, ipAddress: null, userAgent: null });
}

/** Consume (deplete) still-reserved demand when the lead goes out/completed. */
export async function consumePrepDemand(actor: AuthContext, pipelineId: string): Promise<void> {
  requireLevel(actor, PREP_DEMAND_READ_MIN);
  const sb = getServiceRoleClient();
  const { error } = await sb
    .from("catering_prep_demand")
    .update({ status: "consumed", consumed_at: new Date().toISOString() })
    .eq("pipeline_id", pipelineId)
    .eq("status", "reserved");
  if (error) throw new Error(`consumePrepDemand: ${error.message}`);
  void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.prep_demand.consume", resourceTable: "catering_prep_demand", resourceId: pipelineId, metadata: {}, ipAddress: null, userAgent: null });
}

/** Release still-reserved demand when the lead reverts / is lost. Consumed rows stay consumed. */
export async function releasePrepDemand(actor: AuthContext, pipelineId: string): Promise<void> {
  requireLevel(actor, PREP_DEMAND_READ_MIN);
  const sb = getServiceRoleClient();
  const { error } = await sb
    .from("catering_prep_demand")
    .update({ status: "released" })
    .eq("pipeline_id", pipelineId)
    .eq("status", "reserved");
  if (error) throw new Error(`releasePrepDemand: ${error.message}`);
  void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.prep_demand.release", resourceTable: "catering_prep_demand", resourceId: pipelineId, metadata: {}, ipAddress: null, userAgent: null });
}

/** Re-resolve a confirmed lead's demand from its current quote (quote re-versioned edge). */
export async function resyncPrepDemand(actor: AuthContext, pipelineId: string): Promise<void> {
  await reservePrepDemand(actor, pipelineId); // reserve already release-then-reinserts
}
```

- [ ] **Step 3: Read — `loadCateringPrepDemand` (overlay + over-par) + `loadLeadPrepDemand`**
```ts
export interface PrepDemandLine {
  key: string;                 // stable group key
  refKind: "item" | "menu_item" | "choice";
  refId: string;               // item_id / menu_item_id / choice_package_item_id
  name: string;                // resolved display name (or slot label for choice)
  portion: Portion | null;
  qty: number;                 // summed demand
  parValue: number | null;     // item-grain standing par (item refs only; null otherwise)
  wholeEquivDemand: number;    // qty × PORTION_FRACTION (for par comparison)
  overPar: boolean;            // wholeEquivDemand >= parValue, OR (item ref with no par)
  needsPick: boolean;          // unresolved choice slot
}
export interface PrepDemandDay { needDate: string; lines: PrepDemandLine[] }

/** Aggregate reserved catering prep demand for a location over [from, to], with over-par flags. */
export async function loadCateringPrepDemand(
  actor: AuthContext,
  args: { locationId: string; from: string; to: string },
): Promise<PrepDemandDay[]> {
  requireLevel(actor, PREP_DEMAND_READ_MIN);
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb
    .from("catering_prep_demand")
    .select("need_date, item_id, menu_item_id, choice_package_item_id, portion, qty")
    .eq("location_id", args.locationId)
    .eq("status", "reserved")
    .gte("need_date", args.from)
    .lte("need_date", args.to)
    .returns<Array<{ need_date: string; item_id: string | null; menu_item_id: string | null; choice_package_item_id: string | null; portion: Portion | null; qty: number | string }>>();
  if (error) throw new Error(`loadCateringPrepDemand: ${error.message}`);
  const demandRows = rows ?? [];

  // Aggregate by (need_date, ref, portion).
  const groups = new Map<string, { needDate: string; refKind: "item" | "menu_item" | "choice"; refId: string; portion: Portion | null; qty: number }>();
  const itemIds = new Set<string>(); const menuIds = new Set<string>(); const choiceIds = new Set<string>();
  for (const r of demandRows) {
    const qty = typeof r.qty === "string" ? Number(r.qty) : r.qty;
    const refKind = r.item_id ? "item" as const : r.menu_item_id ? "menu_item" as const : "choice" as const;
    const refId = (r.item_id ?? r.menu_item_id ?? r.choice_package_item_id)!;
    if (refKind === "item") itemIds.add(refId); else if (refKind === "menu_item") menuIds.add(refId); else choiceIds.add(refId);
    const key = `${r.need_date}|${refKind}:${refId}|${r.portion ?? ""}`;
    const g = groups.get(key) ?? { needDate: r.need_date, refKind, refId, portion: r.portion, qty: 0 };
    g.qty += qty; groups.set(key, g);
  }

  // Resolve names.
  const itemDefns = itemIds.size ? await loadItemDefns(sb, [...itemIds]) : new Map();
  const nameByMenu = new Map<string, string>();
  if (menuIds.size) { const { data } = await sb.from("menu_items").select("id, name").in("id", [...menuIds]).returns<Array<{id:string;name:string}>>(); for (const x of data ?? []) nameByMenu.set(x.id, x.name); }
  const labelByChoice = new Map<string, string>();
  if (choiceIds.size) { const { data } = await sb.from("catering_package_items").select("id, description").in("id", [...choiceIds]).returns<Array<{id:string;description:string|null}>>(); for (const x of data ?? []) labelByChoice.set(x.id, x.description ?? "Choice slot"); }

  // Item-grain par (item refs only): day-aware override per location.
  const overrides = itemIds.size ? await loadItemOverrides(sb, [...itemIds], args.locationId) : new Map();

  const byDate = new Map<string, PrepDemandDay>();
  for (const g of groups.values()) {
    let name = "Item"; let parValue: number | null = null;
    if (g.refKind === "item") {
      const defn = itemDefns.get(g.refId); name = defn?.name ?? "Item";
      const ov = pickOverride(overrides.get(g.refId) ?? [], operationalDayOfWeek(g.needDate));
      parValue = ov && ov.parMode === "manual" ? ov.parValue : (defn?.defaultPar ?? null);
    } else if (g.refKind === "menu_item") { name = nameByMenu.get(g.refId) ?? "Sub"; }
    else { name = labelByChoice.get(g.refId) ?? "Choice slot"; }

    const wholeEquiv = g.portion ? g.qty * PORTION_FRACTION[g.portion] : g.qty;
    const needsPick = g.refKind === "choice";
    // Over-par: only meaningful for item refs. >= par, or item with no par set → flag. Others false.
    const overPar = g.refKind === "item" && (parValue == null || wholeEquiv >= parValue);

    const day = byDate.get(g.needDate) ?? { needDate: g.needDate, lines: [] };
    day.lines.push({ key: `${g.refKind}:${g.refId}:${g.portion ?? ""}`, refKind: g.refKind, refId: g.refId, name, portion: g.portion, qty: g.qty, parValue, wholeEquivDemand: wholeEquiv, overPar, needsPick });
    byDate.set(g.needDate, day);
  }
  return [...byDate.values()].sort((a, b) => a.needDate.localeCompare(b.needDate)).map((d) => ({ ...d, lines: d.lines.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** A single lead's reserved+consumed demand breakdown (for the pipeline annotation / future detail). */
export async function loadLeadPrepDemand(actor: AuthContext, pipelineId: string): Promise<PrepDemandLine[]> {
  requireLevel(actor, PREP_DEMAND_READ_MIN);
  const sb = getServiceRoleClient();
  const { data: lead } = await sb.from("catering_pipeline").select("location_id, event_date").eq("id", pipelineId).maybeSingle<{ location_id: string | null; event_date: string | null }>();
  if (!lead?.location_id || !lead.event_date) return [];
  const days = await loadCateringPrepDemand(actor, { locationId: lead.location_id, from: lead.event_date, to: lead.event_date });
  return days.flatMap((d) => d.lines);
}
```

- [ ] **Step 4: Typecheck + commit**
```bash
npm run typecheck
git add lib/catering/prep-demand.ts
git commit -m "feat(w4a): prep-demand lib — reserve/consume/release + resolution + overlay/over-par"
```

---

## Task 3: Hook `moveStage()` → prep-demand (CC authors)

**Files:** Modify `lib/catering/pipeline.ts`.

**Context:** After the stage update + event insert succeed, fire the demand lifecycle **best-effort** — a demand-sync bug must never break the operational stage move. Failure is audited, not thrown.

- [ ] **Step 1: Import the lifecycle fns** — add to `lib/catering/pipeline.ts` imports:
```ts
import { reservePrepDemand, consumePrepDemand, releasePrepDemand } from "@/lib/catering/prep-demand";
```

- [ ] **Step 2: Call the lifecycle inside `moveStage`**, immediately before the existing closing `void audit({... "catering.pipeline.stage_move" ...})` call:
```ts
  // W4a: propagate the stage change to the prep-demand ledger — best-effort; never break the move.
  try {
    if (args.toStage === "confirmed") await reservePrepDemand(actor, args.id);
    else if (args.toStage === "out" || args.toStage === "completed") await consumePrepDemand(actor, args.id);
    else if (args.toStage === "lost" || args.toStage === "inquiry" || args.toStage === "quote_sent") await releasePrepDemand(actor, args.id);
  } catch (e) {
    void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.prep_demand.sync_failed", resourceTable: "catering_pipeline", resourceId: args.id, metadata: { to_stage: args.toStage, error: e instanceof Error ? e.message : String(e) }, ipAddress: null, userAgent: null });
  }
```

- [ ] **Step 3: Typecheck + commit**
```bash
npm run typecheck
git add lib/catering/pipeline.ts
git commit -m "feat(w4a): moveStage propagates confirm/out/revert to the prep-demand ledger (best-effort)"
```

---

## Task 4: (folded into Task 2)

The read fns (`loadCateringPrepDemand`, `loadLeadPrepDemand`) ship in `lib/catering/prep-demand.ts` Task 2 Step 3. No separate task.

---

## Task 5: UI — standalone "Catering Prep Demand" manager view (Sonnet)

**Files:** Create `app/admin/catering/prep-demand/page.tsx`; Create `components/admin/catering/prep-demand/PrepDemandClient.tsx`; Modify `app/admin/catering/page.tsx` (hub card); Modify `lib/i18n/en.json` + `lib/i18n/es.json`.

**Context (read first):** `app/admin/catering/page.tsx` (the `EDITORS` array + card grid + gate); `app/admin/catering/packages/page.tsx` (server-gate pattern: `requireSessionFromHeaders("/admin")` → `ROLES[auth.user.role].level` → `redirect`); a client component (e.g. `components/admin/catering/packages/PackagesClient.tsx`) for the `.co-*` visual system + `useTranslation`. Contracts:
- `loadCateringPrepDemand(auth, { locationId, from, to }) → PrepDemandDay[]` and `loadPackageLocations`-style location loader (reuse `loadPackageLocations` from `lib/admin/catering/packages.ts` for the location select). `PrepDemandDay = { needDate, lines: PrepDemandLine[] }`; `PrepDemandLine` = `{ refKind, name, portion, qty, parValue, wholeEquivDemand, overPar, needsPick }`.
- `PREP_DEMAND_READ_MIN = 6`.

- [ ] **Step 1:** `page.tsx` (server): gate `level >= PREP_DEMAND_READ_MIN` (redirect below); load locations (`loadPackageLocations(auth)`); pick a default location (first, or a `?location=` search param — remember `useSearchParams` needs Suspense only in client comps; server reads `searchParams` prop); compute a default date window (today → +14 days — pass the two ISO dates in as props, since `Date.now()` is fine in a server component render); call `loadCateringPrepDemand(auth, { locationId, from, to })`; render `<PrepDemandClient days={days} locations={locations} locationId={locationId} from={from} to={to} actorLevel={level} />`. Wrap in a title/subtitle like the packages page.
- [ ] **Step 2:** `PrepDemandClient.tsx`: a location selector + date-window controls (navigating changes `?location=`/date via `router.push` — the server re-loads). For each `PrepDemandDay`: a date header, then each `line`: name + portion + `qty` (e.g. "40 × ½ Turkey Sub"); for `overPar` item lines a red/amber alert chip ("over par — standing target {parValue} won't cover {wholeEquivDemand}") + a **par-bump affordance**: a link to the item's admin par editor (the admin items surface) with the **suggested value shown** (`suggested = (parValue ?? 0) + Math.ceil(wholeEquivDemand)`); for `needsPick` (choice) lines a "needs pick" badge (no par math); menu_item lines show demand with an info note ("sub — par comparison in W4b"). Empty state ("no upcoming catering demand"). Mirror the `.co-*` tokens, `min-h-[44px]` targets, phone-first. Reads only — no step-up.
- [ ] **Step 3:** Hub card — in `app/admin/catering/page.tsx`, add to `EDITORS`: `{ id: "prep-demand", href: "/admin/catering/prep-demand", i18nKey: "admin.catering.prep_demand.card", minLevel: 6 }` (match the exact `EDITORS` element shape in that file).
- [ ] **Step 4:** i18n — add `admin.catering.prep_demand.*` keys to BOTH `lib/i18n/en.json` and `lib/i18n/es.json` (EN + ES, tú-form) for every visible string: `title`, `subtitle`, `card`, `location`, `empty`, `over_par`, `needs_pick`, `sub_note`, `suggest_par`, `raise_par`, `no_par`, date-range labels, ARIA labels. One key per string.
- [ ] **Step 5: Build gate + commit**
```bash
npm run build
git add app/admin/catering components/admin/catering/prep-demand lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(w4a): Catering Prep Demand manager view + hub card + i18n"
```

---

## Task 6: Seeded lifecycle smoke (Fable)

**Files:** Create `scripts/w4a-smoke.ts`.

**Context:** Mirror `scripts/w1b-smoke.ts` structure exactly (`import assert from "node:assert/strict"`, `getServiceRoleClient`, seed → drive REAL lib → assert → hard-delete in `finally`, zero residue, `w4a-smoke: PASS`, plain `main().catch()`). Run: `npx tsx --env-file=.env.local scripts/w4a-smoke.ts`. Build a minimal level-≥6 actor: load a real cgs user (`select id, role from users where role='cgs' and active=true limit 1`) and cast `{ user: { id, role }, locations: [] } as unknown as AuthContext` (the lib reads only `actor.user.id`/`actor.user.role`). Pre-flight assert the seed location has zero active `item_par_levels` for the seeded item (so the par math is deterministic) — fail loudly otherwise.

- [ ] **Step 1: Seed (capture every id)** at a real active location: a `catering_pipeline` lead (stage `quote_sent`, location_id, event_date = a fixed future date, e.g. pass `NEED_DATE = "2026-08-15"`); a `catering_quotes` row (`pipeline_id`, `location_id`, `event_date=NEED_DATE`, `status='accepted'`, `superseded_at=null`, `total_cents` etc. minimal); an `items` extra (catering-available, `default_par` set e.g. 10) + a seeded... actually set the par via `items.default_par` (simplest deterministic par) OR seed an `item_par_levels` manual row — use `items.default_par=10` and NO item_par_levels row (so `parValue=10` via defaultPar). A `menu_items` sub. A `catering_packages` + `catering_package_items` with one `fixed` component (an item) + one `choice` slot. Then `catering_quote_items`: (a) direct item line (qty 3); (b) direct menu_item line (qty 4, `portion='half'`); (c) a package line (qty 2) referencing the package.
- [ ] **Step 2: reserve** — `reservePrepDemand(actor, pipelineId)` → assert `catering_prep_demand` rows: the direct item (qty 3, portion null), the direct sub (qty 4, portion half), the package fixed component (qty 2 × component.qty), and exactly one `choice_package_item_id` row (qty 2 × component.qty) — all `status='reserved'`, `need_date=NEED_DATE`, `location_id` correct.
- [ ] **Step 3: overlay** — `loadCateringPrepDemand(actor, { locationId, from: NEED_DATE, to: NEED_DATE })` → assert one `PrepDemandDay`; the direct-item line has `parValue=10`, `wholeEquivDemand=3`, `overPar=false` (3 < 10); flip the assertion by asserting an over-par case too — e.g. also assert that if you seed the item's `default_par` low (or assert on the sub line `needsPick=false`, the choice line `needsPick=true`, the sub line has no par comparison). Assert the `half`-portion sub contributes `wholeEquivDemand = 4 × 0.5 = 2`.
- [ ] **Step 4: consume** — `consumePrepDemand(actor, pipelineId)` → assert reserved rows now `status='consumed'` with `consumed_at` set; `loadCateringPrepDemand` now returns empty (no reserved).
- [ ] **Step 5: re-confirm idempotency** — call `reservePrepDemand` again → assert no duplicate active `reserved` rows beyond the fresh set (prior reserved were already consumed, stay consumed; fresh reserved inserted once). Then `releasePrepDemand` → assert reserved→released.
- [ ] **Step 6: Cleanup** — hard-delete every seeded row (catering_prep_demand by pipeline_id, quote_items, quote, package_slot_options, package_items, package, menu_item, item, pipeline lead) in FK-safe order; verify zero residue; print `w4a-smoke: PASS`.
- [ ] **Step 7: Commit**
```bash
git add scripts/w4a-smoke.ts
git commit -m "test(w4a): seeded prep-demand lifecycle smoke (PASS, zero residue)"
```

---

## Task 7: Final gates + PR

- [ ] **Step 1:** `npm run build` → PASS. `npm run typecheck` → PASS. `npx eslint` the new/changed files → clean.
- [ ] **Step 2:** `npx tsx --env-file=.env.local scripts/w4a-smoke.ts` → PASS, zero residue.
- [ ] **Step 3:** CC runs the recurring-bug-class checklist over the diff (authz: level-6+ on reads, service-role-only writes + RLS deny; append-only status transitions; best-effort hook can't break moveStage; no silent-at-scale loaders — the overlay is date+location bounded; migration committed + applied).
- [ ] **Step 4:** Open the PR (verify `gh pr view --json state` semantics; don't chain branch-delete after merge). Title: `feat(w4a): catering prep-demand`. Body: the ledger + lifecycle, the demand overlay + over-par alert + manual par bump, the item-only-par nuance, dormant-until-data, and the deferred fast-follows (W4b SKU cascade; per-lead detail page; prep-list weave; choice-slot resolution).

---

## Self-Review (against the spec)

**Spec coverage:** §3 data model → T1. §4 triggers + resolution → T2 (resolveQuoteDemand + lifecycle) + T3 (moveStage hook). §5 overlay + over-par + par-bump → T2 Step 3 (loadCateringPrepDemand) + T5 (par-bump affordance). §6 read surface → T5 (standalone view; per-lead breakdown folded in via `loadLeadPrepDemand`; dedicated lead page deferred per the verified no-lead-detail-page finding). §7 error handling → T2 (idempotent release-then-reinsert, no-quote/no-date no-op) + T3 (best-effort hook). §8 testing → T6. §9 confirm-before-authoring → done at top + T1.

**Placeholder scan:** T5 (UI) gives contracts + a mirror reference (packages client) not verbatim JSX — deliberate, matching how W1a/W1b/3a UI shipped. T1–T3 + the read lib have complete code.

**Type consistency:** `ResolvedDemand`, `PrepDemandLine`, `PrepDemandDay`, `reservePrepDemand`/`consumePrepDemand`/`releasePrepDemand`/`resyncPrepDemand`, `loadCateringPrepDemand`/`loadLeadPrepDemand`, `PREP_DEMAND_READ_MIN` defined once in T2 + consumed consistently in T3/T5/T6. `PORTION_FRACTION`/`Portion` + `loadItemDefns`/`loadItemOverrides`/`pickOverride`/`operationalDayOfWeek` match `lib/catering/pricing-derivation.ts` + `lib/items.ts` (verified). Migration column names match the lib's insert/select keys (`choice_package_item_id`, `need_date`, `qty`, `status`, `consumed_at`).
