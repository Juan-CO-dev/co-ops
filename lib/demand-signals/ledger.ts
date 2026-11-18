import "server-only";
/**
 * Demand signals (item 4 PR 1): the nightly ledger pass's REAL reads, and its heartbeat.
 *
 * OFF unless DEMAND_LEDGER=1 (the nightly never imports this file otherwise). Apply 0341 first: before it the
 * pass answers `not_installed`, reads nothing more and writes no heartbeat.
 * READS ONLY what the three baselines already read: `pulse_sales_baseline` (the scheduler's demand), the live
 * schedule structure and day-type overrides, `items` and `item_par_levels`. The par inputs are handed in by the
 * nightly run that just used them; nothing is loaded twice.
 * WRITES ONLY through 0341's writers (lib/demand-signals/ledger-pass.ts) and one audit heartbeat
 * (cron.success / cron.failure, job `demand-ledger`). Not in JOBS_REGISTRY: nothing emails. No outside call.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import type { DemandInputs } from "@/lib/dynamic-pars-engine-shared";
import type { ItemParRow } from "@/lib/items";
import type { HeatCell } from "@/lib/pulse/baseline-shared";
import { mergeBreakdown, type BreakdownRaw } from "@/lib/sales-reports-shared";
import { loadDayTypes, loadLiveStructure, loadSchedulingDemand } from "@/lib/scheduling/inputs";
import { overrideFor } from "@/lib/scheduling/inputs-shared";
import { selectAllRows } from "@/lib/supabase-paginate";
import type { ParMode } from "@/lib/types";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";
import { runDemandLedgerForShop, type LedgerDeps, type ShopLedgerResult } from "./ledger-pass";
import { LABOR_LEADS, type LaborInputs, type PrepInputs } from "./replay";

/** One shop's pass may take this long; the nightly gives the whole step no more than DEMAND_LEDGER_BUDGET_MS. */
export const DEMAND_LEDGER_BUDGET_MS = 40_000;

/** The labor inputs for a build day: the scheduler's own demand read, its live structure, and the override in force per date. */
export async function loadLaborInputs(sb: SupabaseClient, locationId: string, asOf: string): Promise<LaborInputs> {
  const dates = LABOR_LEADS.map((lead) => addDaysEt(asOf, lead));
  const [{ baseline }, structure, dayTypes] = await Promise.all([
    loadSchedulingDemand(sb, locationId, dates, asOf),
    loadLiveStructure(sb, locationId),
    loadDayTypes(sb, locationId, dates[0]!, dates[dates.length - 1]!),
  ]);
  const overrides: LaborInputs["overrides"] = [];
  for (const date of dates) {
    const o = overrideFor(dayTypes, date); // the scheduler's own "which override is in force" rule
    if (o) overrides.push({ id: o.id, date, dayType: o.dayType });
  }
  return { v: 1, locationId, asOf, baseline, dayTypes: structure.structure.dayTypes, structureId: structure.id, overrides };
}

/** One realized day, by the SAME RPC and the same merge the forecast uses. */
export async function loadLaborDay(sb: SupabaseClient, locationId: string, date: string): Promise<{ heat: HeatCell[]; capturedDays: string[] }> {
  const { data, error } = await sb.rpc("pulse_sales_baseline", { p_location_id: locationId, p_from: date, p_to: date });
  if (error || !data) throw new Error("labor_day_read_failed");
  const raw = data as { hours?: BreakdownRaw[]; captured_days?: string[] };
  const heat = mergeBreakdown("hour_weekday", [raw.hours ?? []]).map((row) => ({ dow: row.dow ?? 0, hour: row.hour ?? -1, cents: row.cents }));
  return { heat, capturedDays: [...new Set(raw.captured_days ?? [])] };
}

/** Every prep item that has a par at this shop: the registry's default par, and the shop's own par rows. */
export async function loadPrepInputs(sb: SupabaseClient, locationId: string): Promise<PrepInputs> {
  const items = await selectAllRows<{ id: string; default_par: number | string | null; default_par_unit: string | null; active: boolean; location_id: string | null }>(
    (from, to) => sb.from("items").select("id, default_par, default_par_unit, active, location_id").order("id", { ascending: true }).range(from, to));
  const levels = await selectAllRows<{ item_id: string; day_of_week: number | null; par_value: number | string | null; par_unit: string | null; par_mode: ParMode }>(
    (from, to) => sb.from("item_par_levels").select("item_id, day_of_week, par_value, par_unit, par_mode").eq("location_id", locationId).eq("active", true)
      .order("item_id", { ascending: true }).order("day_of_week", { ascending: true, nullsFirst: true }).range(from, to));
  const num = (v: number | string | null): number | null => (v === null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const rowsByItem = new Map<string, ItemParRow[]>();
  for (const l of levels) (rowsByItem.get(l.item_id) ?? rowsByItem.set(l.item_id, []).get(l.item_id)!).push({ dayOfWeek: l.day_of_week, parValue: num(l.par_value), parUnit: l.par_unit, parMode: l.par_mode });
  return {
    v: 1, locationId,
    items: items.filter((i) => i.location_id === null || i.location_id === locationId)
      .map((i) => ({ itemId: i.id, defaultPar: num(i.default_par), defaultParUnit: i.default_par_unit, active: i.active === true, parRows: rowsByItem.get(i.id) ?? [] }))
      .filter((i) => i.defaultPar !== null || i.parRows.length > 0),
  };
}

export function ledgerDeps(sb: SupabaseClient, locationId: string, todayEt: string): LedgerDeps {
  return {
    rpc: async (name, args) => {
      const { data, error } = await sb.rpc(name, args);
      return { data, error: error ? { code: error.code, message: error.message } : null };
    },
    loadLabor: () => loadLaborInputs(sb, locationId, todayEt),
    loadLaborDay: (date) => loadLaborDay(sb, locationId, date),
    loadPrep: () => loadPrepInputs(sb, locationId),
    now: () => Date.now(),
  };
}

/** The whole night: each shop in turn, inside one deadline, then one heartbeat. Never throws. */
export async function runDemandLedgerNight(args: {
  sb: SupabaseClient; locationIds: ReadonlyArray<string>; todayEt: string; parInputsByShop: ReadonlyMap<string, DemandInputs>; deadlineAt: number;
}): Promise<Record<string, ShopLedgerResult | { status: "failed" }>> {
  const results: Record<string, ShopLedgerResult | { status: "failed" }> = {};
  for (const locationId of args.locationIds) {
    try {
      results[locationId] = await runDemandLedgerForShop(
        { locationId, todayEt: args.todayEt, parInputs: args.parInputsByShop.get(locationId) ?? null, deadlineAt: args.deadlineAt },
        ledgerDeps(args.sb, locationId, args.todayEt));
    } catch { results[locationId] = { status: "failed" }; }
    // Before 0341 nothing is installed for any shop: stop, and stay silent (no heartbeat for a pass that did not exist).
    if (results[locationId]!.status === "not_installed") return results;
  }
  const statuses = Object.values(results).map((r) => r.status);
  if (statuses.length === 0) return results;
  try {
    await audit({
      actorId: null, actorRole: null, action: statuses.every((s) => s === "ok") ? "cron.success" : "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: { job: "demand-ledger", decision_date: args.todayEt, shops: results }, ipAddress: null, userAgent: null,
    });
  } catch { /* the heartbeat is fail-open */ }
  return results;
}
