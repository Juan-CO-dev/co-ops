/**
 * W4c-a catering surplus signal — SERVER-ONLY, service-role. The cancellation flip-side of the moat:
 * released catering reservations (from cancelled confirmed orders) become surplus, classified by the
 * 72h prep-start window — cancelled ≥PREP_START_LEAD_DAYS before need_date → raw SKU surplus (flatten
 * via W4b); cancelled inside the window → perishable prepped-item surplus. Advisory; the manager
 * acting on it (LTO/discount) is W4c-b. DORMANT until catering data.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { etCalendarDate } from "@/lib/operational-day";
import type { AuthContext } from "@/lib/session";
import { PORTION_FRACTION, type Portion } from "@/lib/catering/pricing-derivation";
import { resolveRefs } from "@/lib/catering/prep-demand";
import { loadRecipeGraph, loadMeasures } from "@/lib/prep-consumption";
import { perUnitSkuOzForItemFromGraph, perUnitSkuOzForMenuItemFromGraph } from "@/lib/prep-consumption-graph";
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
/** Whole ET-calendar days between a release timestamp and a YYYY-MM-DD need date
 *  (need − released). The release timestamp is reduced to its ET calendar date
 *  FIRST so the integer-day arithmetic is robust to the DC UTC−4/−5 offset
 *  (hardening 2026-07-31, council P1: a late-night ET cancel previously
 *  misclassified ±1 day — need-date anchored to UTC midnight but released_at was
 *  a UTC wall-clock instant). Both operands are now ET calendar dates at UTC
 *  midnight, so the difference is a clean whole-day count. */
function daysBetween(releasedAtIso: string, needDate: string): number {
  const rel = Date.parse(`${etCalendarDate(releasedAtIso)}T00:00:00Z`);
  const need = Date.parse(`${needDate}T00:00:00Z`);
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
  let recipeGraph: Awaited<ReturnType<typeof loadRecipeGraph>> | null = null;
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
      // ONE graph load for the whole pass (see loadRecipeGraph); resolution is pure/in-memory.
      recipeGraph ??= await loadRecipeGraph();
      perUnit = isItem ? perUnitSkuOzForItemFromGraph(recipeGraph, refId) : perUnitSkuOzForMenuItemFromGraph(recipeGraph, refId);
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
