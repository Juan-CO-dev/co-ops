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

// ── Resolution: a lead's current quote → concrete prep demand (item grain) ──────────

/** A resolved demand row to insert (exactly one of item/menuItem/choice ref set). */
interface ResolvedDemand {
  itemId: string | null;
  menuItemId: string | null;
  choicePackageItemId: string | null;
  portion: Portion | null;
  qty: number;
}

interface PackageComp { id: string; package_id: string; slot_type: string; item_id: string | null; menu_item_id: string | null; quantity: number | string }

/** Resolve a lead's current quote lines into concrete prep demand. Fixed package components resolve
 *  to concrete refs. A choice slot resolves to the CUSTOMER'S STORED PICKS (catering_quote_item_options,
 *  sub-project B) — each chosen sub becomes concrete demand scaled by package-line-qty × pick-qty; only
 *  an UNCONFIGURED package (no stored picks) falls back to one advisory "needs a pick" row. Package
 *  lines are processed PER quote-line (two lines of the same package can hold different picks). */
export async function resolveQuoteDemand(sb: Sb, quoteId: string): Promise<ResolvedDemand[]> {
  const { data: lines, error } = await sb
    .from("catering_quote_items")
    .select("id, item_id, menu_item_id, package_id, quantity, portion")
    .eq("quote_id", quoteId)
    .returns<Array<{ id: string; item_id: string | null; menu_item_id: string | null; package_id: string | null; quantity: number | string; portion: Portion | null }>>();
  if (error) throw new Error(`resolveQuoteDemand items: ${error.message}`);

  const out: ResolvedDemand[] = [];
  const pkgLines: Array<{ quoteItemId: string; packageId: string; qty: number }> = [];
  for (const l of lines ?? []) {
    const qty = typeof l.quantity === "string" ? Number(l.quantity) : l.quantity;
    if (l.item_id) {
      out.push({ itemId: l.item_id, menuItemId: null, choicePackageItemId: null, portion: l.portion, qty });
    } else if (l.menu_item_id) {
      out.push({ itemId: null, menuItemId: l.menu_item_id, choicePackageItemId: null, portion: l.portion, qty });
    } else if (l.package_id) {
      pkgLines.push({ quoteItemId: l.id, packageId: l.package_id, qty });
    }
  }

  if (pkgLines.length) {
    const packageIds = [...new Set(pkgLines.map((p) => p.packageId))];
    const { data: comps, error: cErr } = await sb
      .from("catering_package_items")
      .select("id, package_id, slot_type, item_id, menu_item_id, quantity")
      .in("package_id", packageIds)
      .eq("active", true)
      .returns<PackageComp[]>();
    if (cErr) throw new Error(`resolveQuoteDemand package components: ${cErr.message}`);
    const compsByPackage = new Map<string, PackageComp[]>();
    for (const c of comps ?? []) { const arr = compsByPackage.get(c.package_id) ?? []; arr.push(c); compsByPackage.set(c.package_id, arr); }

    // The customer's stored slot picks (sub-project B), keyed `${quote_item_id}:${package_item_id}`.
    const { data: optRows, error: oErr } = await sb
      .from("catering_quote_item_options")
      .select("quote_item_id, package_item_id, item_id, menu_item_id, quantity")
      .in("quote_item_id", pkgLines.map((p) => p.quoteItemId))
      .returns<Array<{ quote_item_id: string; package_item_id: string; item_id: string | null; menu_item_id: string | null; quantity: number | string }>>();
    if (oErr) throw new Error(`resolveQuoteDemand package options: ${oErr.message}`);
    const picksBySlot = new Map<string, Array<{ itemId: string | null; menuItemId: string | null; qty: number }>>();
    for (const o of optRows ?? []) {
      const key = `${o.quote_item_id}:${o.package_item_id}`;
      const arr = picksBySlot.get(key) ?? [];
      arr.push({ itemId: o.item_id, menuItemId: o.menu_item_id, qty: typeof o.quantity === "string" ? Number(o.quantity) : o.quantity });
      picksBySlot.set(key, arr);
    }

    for (const pl of pkgLines) {
      for (const c of compsByPackage.get(pl.packageId) ?? []) {
        const compQty = typeof c.quantity === "string" ? Number(c.quantity) : c.quantity;
        if (c.slot_type === "choice") {
          const picks = picksBySlot.get(`${pl.quoteItemId}:${c.id}`);
          if (picks && picks.length > 0) {
            for (const p of picks) {
              const qty = pl.qty * p.qty;
              if (qty <= 0) continue;
              out.push({ itemId: p.itemId, menuItemId: p.menuItemId, choicePackageItemId: null, portion: null, qty });
            }
          } else {
            const qty = pl.qty * compQty;
            if (qty > 0) out.push({ itemId: null, menuItemId: null, choicePackageItemId: c.id, portion: null, qty });
          }
        } else if (c.menu_item_id) {
          const qty = pl.qty * compQty;
          if (qty > 0) out.push({ itemId: null, menuItemId: c.menu_item_id, choicePackageItemId: null, portion: null, qty });
        } else if (c.item_id) {
          const qty = pl.qty * compQty;
          if (qty > 0) out.push({ itemId: c.item_id, menuItemId: null, choicePackageItemId: null, portion: null, qty });
        }
      }
    }
  }
  return out;
}

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

// ── Lifecycle: reserve / consume / release / resync ─────────────────────────────────

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
    .update({ status: "released", released_at: new Date().toISOString() })
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
    .update({ status: "released", released_at: new Date().toISOString() })
    .eq("pipeline_id", pipelineId)
    .eq("status", "reserved");
  if (error) throw new Error(`releasePrepDemand: ${error.message}`);
  void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.prep_demand.release", resourceTable: "catering_prep_demand", resourceId: pipelineId, metadata: {}, ipAddress: null, userAgent: null });
}

/**
 * Re-resolve a lead's reserved demand from its CURRENT quote after a quote
 * revision (hardening 2026-07-31, council P1: this existed but was never called,
 * so a revise on a confirmed lead left the kitchen's W4a/W4b demand pointing at
 * the pre-revision quantities). SELF-GUARDING on stage: only a CONFIRMED lead
 * carries reserved demand — reserving here for a non-confirmed lead would create
 * demand before the lead is confirmed, so we no-op unless confirmed. reserve
 * already release-then-reinserts (idempotent), and reads the CURRENT quote, so
 * it picks up the new revision automatically.
 */
export async function resyncPrepDemand(actor: AuthContext, pipelineId: string): Promise<void> {
  requireLevel(actor, PREP_DEMAND_READ_MIN);
  const sb = getServiceRoleClient();
  const { data: lead, error } = await sb
    .from("catering_pipeline").select("stage").eq("id", pipelineId)
    .maybeSingle<{ stage: string }>();
  if (error) throw new Error(`resyncPrepDemand load stage: ${error.message}`);
  if (lead?.stage !== "confirmed") return; // no reserved demand to resync

  // PACKAGE CARRY-FORWARD GAP (adversarial review C1, 2026-07-31): a staff quote
  // revise does NOT copy the customer's choice-slot picks
  // (catering_quote_item_options) onto the new quote version. Re-resolving a
  // package-bearing quote here would therefore REGRESS concrete sub demand to
  // advisory "needs-pick" rows. Until revise carries picks forward (tracked
  // follow-up), SKIP the resync when the current quote holds any package line —
  // leaving the existing (concrete) reserved rows intact (no worse than today,
  // where resync never ran). Item/sub-only leads resync fully — the common case
  // and the actual P1 this fix targets.
  const quote = await loadCurrentQuote(sb, pipelineId);
  if (!quote) return;
  const { data: pkgLines, error: pErr } = await sb
    .from("catering_quote_items").select("id")
    .eq("quote_id", quote.id).not("package_id", "is", null).limit(1)
    .returns<Array<{ id: string }>>();
  if (pErr) throw new Error(`resyncPrepDemand package-line check: ${pErr.message}`);
  if (pkgLines && pkgLines.length > 0) {
    void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.prep_demand.resync_skipped_package", resourceTable: "catering_prep_demand", resourceId: pipelineId, metadata: { quote_id: quote.id, reason: "package_picks_not_carried_forward" }, ipAddress: null, userAgent: null });
    return;
  }
  await reservePrepDemand(actor, pipelineId);
}

// ── Read: overlay (over-par) + per-lead breakdown ───────────────────────────────────

export interface PrepDemandLine {
  key: string;                 // stable group key (ref + portion)
  refKind: "item" | "menu_item" | "choice";
  refId: string;               // item_id / menu_item_id / choice_package_item_id
  name: string;                // resolved display name (or slot label for choice)
  portion: Portion | null;
  qty: number;                 // summed demand
  parValue: number | null;     // item-grain standing par (item refs only; null otherwise)
  wholeEquivDemand: number;    // qty × PORTION_FRACTION (for par comparison)
  overPar: boolean;            // item ref where wholeEquivDemand >= par, or no par set
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
  const itemIds = new Set<string>();
  const menuIds = new Set<string>();
  const choiceIds = new Set<string>();
  for (const r of demandRows) {
    const qty = typeof r.qty === "string" ? Number(r.qty) : r.qty;
    const refKind = r.item_id ? ("item" as const) : r.menu_item_id ? ("menu_item" as const) : ("choice" as const);
    const refId = (r.item_id ?? r.menu_item_id ?? r.choice_package_item_id)!;
    if (refKind === "item") itemIds.add(refId);
    else if (refKind === "menu_item") menuIds.add(refId);
    else choiceIds.add(refId);
    const key = `${r.need_date}|${refKind}:${refId}|${r.portion ?? ""}`;
    const g = groups.get(key) ?? { needDate: r.need_date, refKind, refId, portion: r.portion, qty: 0 };
    g.qty += qty;
    groups.set(key, g);
  }

  const refs = await resolveRefs(sb, itemIds, menuIds, choiceIds);
  // Item-grain par: reuse the item defaults resolveRefs already loaded + day-aware location overrides.
  const overrides = await loadItemOverrides(sb, [...itemIds], args.locationId);

  const byDate = new Map<string, PrepDemandDay>();
  for (const g of groups.values()) {
    let parValue: number | null = null;
    if (g.refKind === "item") {
      const ov = pickOverride(overrides.get(g.refId) ?? [], operationalDayOfWeek(g.needDate));
      parValue = ov && ov.parMode === "manual" ? ov.parValue : (refs.itemDefns.get(g.refId)?.defaultPar ?? null);
    }
    const wholeEquiv = g.portion ? g.qty * PORTION_FRACTION[g.portion] : g.qty;
    const overPar = g.refKind === "item" && (parValue == null || wholeEquiv >= parValue);
    const line: PrepDemandLine = {
      key: `${g.refKind}:${g.refId}:${g.portion ?? ""}`,
      refKind: g.refKind,
      refId: g.refId,
      name: refs.name(g.refKind, g.refId),
      portion: g.portion,
      qty: g.qty,
      parValue,
      wholeEquivDemand: wholeEquiv,
      overPar,
      needsPick: g.refKind === "choice",
    };
    const day = byDate.get(g.needDate) ?? { needDate: g.needDate, lines: [] };
    day.lines.push(line);
    byDate.set(g.needDate, day);
  }
  return [...byDate.values()]
    .sort((a, b) => a.needDate.localeCompare(b.needDate))
    .map((d) => ({ ...d, lines: d.lines.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/**
 * A single lead's own demand breakdown ("this order will consume …"). Scoped to the lead's
 * pipeline_id (NOT the location overlay), reserved+consumed, aggregated by ref+portion. No par
 * enrichment (that's the location-date overlay's job). Used for the standalone view's per-lead
 * annotation + a future lead-detail surface.
 */
export async function loadLeadPrepDemand(actor: AuthContext, pipelineId: string): Promise<PrepDemandLine[]> {
  requireLevel(actor, PREP_DEMAND_READ_MIN);
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb
    .from("catering_prep_demand")
    .select("item_id, menu_item_id, choice_package_item_id, portion, qty")
    .eq("pipeline_id", pipelineId)
    .in("status", ["reserved", "consumed"])
    .returns<Array<{ item_id: string | null; menu_item_id: string | null; choice_package_item_id: string | null; portion: Portion | null; qty: number | string }>>();
  if (error) throw new Error(`loadLeadPrepDemand: ${error.message}`);

  const groups = new Map<string, { refKind: "item" | "menu_item" | "choice"; refId: string; portion: Portion | null; qty: number }>();
  const itemIds = new Set<string>();
  const menuIds = new Set<string>();
  const choiceIds = new Set<string>();
  for (const r of rows ?? []) {
    const qty = typeof r.qty === "string" ? Number(r.qty) : r.qty;
    const refKind = r.item_id ? ("item" as const) : r.menu_item_id ? ("menu_item" as const) : ("choice" as const);
    const refId = (r.item_id ?? r.menu_item_id ?? r.choice_package_item_id)!;
    if (refKind === "item") itemIds.add(refId);
    else if (refKind === "menu_item") menuIds.add(refId);
    else choiceIds.add(refId);
    const key = `${refKind}:${refId}|${r.portion ?? ""}`;
    const g = groups.get(key) ?? { refKind, refId, portion: r.portion, qty: 0 };
    g.qty += qty;
    groups.set(key, g);
  }

  const refs = await resolveRefs(sb, itemIds, menuIds, choiceIds);
  return [...groups.values()]
    .map((g) => ({
      key: `${g.refKind}:${g.refId}:${g.portion ?? ""}`,
      refKind: g.refKind,
      refId: g.refId,
      name: refs.name(g.refKind, g.refId),
      portion: g.portion,
      qty: g.qty,
      parValue: null,
      wholeEquivDemand: g.portion ? g.qty * PORTION_FRACTION[g.portion] : g.qty,
      overPar: false,
      needsPick: g.refKind === "choice",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

type ItemDefnMap = Awaited<ReturnType<typeof loadItemDefns>>;

/** Batch-resolve display names for item/menu_item/choice-slot refs, and expose the loaded item
 *  defaults so callers can reuse them for par (avoids a second `items` query). */
export async function resolveRefs(
  sb: Sb,
  itemIds: Set<string>,
  menuIds: Set<string>,
  choiceIds: Set<string>,
): Promise<{ name: (kind: "item" | "menu_item" | "choice", id: string) => string; itemDefns: ItemDefnMap }> {
  const itemDefns: ItemDefnMap = await loadItemDefns(sb, [...itemIds]); // early-returns empty on []
  const nameByMenu = new Map<string, string>();
  if (menuIds.size) {
    const { data } = await sb.from("menu_items").select("id, name").in("id", [...menuIds]).returns<Array<{ id: string; name: string }>>();
    for (const x of data ?? []) nameByMenu.set(x.id, x.name);
  }
  const labelByChoice = new Map<string, string>();
  if (choiceIds.size) {
    const { data } = await sb.from("catering_package_items").select("id, description").in("id", [...choiceIds]).returns<Array<{ id: string; description: string | null }>>();
    for (const x of data ?? []) labelByChoice.set(x.id, x.description ?? "Choice slot");
  }
  const name = (kind: "item" | "menu_item" | "choice", id: string): string => {
    if (kind === "item") return itemDefns.get(id)?.name ?? "Item";
    if (kind === "menu_item") return nameByMenu.get(id) ?? "Sub";
    return labelByChoice.get(id) ?? "Choice slot";
  };
  return { name, itemDefns };
}
