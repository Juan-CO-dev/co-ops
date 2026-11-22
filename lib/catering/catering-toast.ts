/**
 * Item 21 PR 2 — server reads for house catering leads vs Toast (migration 0344). READ-ONLY: nothing here writes a
 * link, a decision, a ring code or a setting. Every read is per shop, paged, and gated by that shop's
 * `catering_toast_settings.enabled` (no row = off). 0344 not applied = "not installed": no house rows, no failure of
 * the ezCater list. Any other read error throws (never an empty list that looks like "all rung").
 */
import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import type { NotInToastOrder } from "./not-in-toast-shared";
import { assertSalesScope } from "@/lib/sales-reports";
import { salesWindows, type CateringValues, type SalesRange } from "@/lib/sales-reports-shared";
import type { ReportScopeViewer } from "@/lib/report-scope";
import {
  CATERING_TOAST_SETTINGS_COLUMNS, HOUSE_STATUS_COLUMNS, houseNotInToastOrder, houseRowListed, mergePipelineReconciliation,
  pipelineLabelMatchesDisplayed, plannerWindows, suggestionsFor,
  type CateringToastPlanRow, type CateringToastShopSettings, type HouseStatusRow, type HouseSuggestions,
  type PipelineReconciliation, type PipelineReconciliationRaw,
} from "./catering-toast-shared";

type Sb = ReturnType<typeof getServiceRoleClient>;

/** A relation or function 0344 adds is missing: the migration is not applied yet. */
export const NOT_INSTALLED = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
export class CateringToastNotInstalled extends Error { constructor() { super("catering_toast_not_installed"); } }
export function raise(error: { code?: string; message?: string }): never {
  if (error.code && NOT_INSTALLED.has(error.code)) throw new CateringToastNotInstalled();
  throw new Error("catering_toast_read_failed");
}

export async function shopSettings(sb: Sb, locationId: string): Promise<CateringToastShopSettings | null> {
  const { data, error } = await sb.from("catering_toast_settings").select(CATERING_TOAST_SETTINGS_COLUMNS)
    .eq("location_id", locationId).eq("enabled", true).order("location_id").range(0, 0);
  if (error) raise(error);
  const row = (data as Array<{ enabled: boolean; include_toast_origin_leads: boolean }> | null)?.[0];
  return row ? { enabled: row.enabled === true, includeToastOriginLeads: row.include_toast_origin_leads === true } : null;
}

/** Whether a shop's house orders are checked against Toast at all: `on` (its settings row is enabled), `off` (no
 *  enabled row: the default) or `not_installed` (0344 is not applied). */
export type HouseReconciliationState = "on" | "off" | "not_installed";

/**
 * The house half of the not-rung seam for ONE shop, WITH whether that shop's house orders are checked at all (nav PR 8,
 * A6): a completeness line may speak for house orders only when this says `on`. Same date contract as readNotInToast.
 * The rows are only the leads the reconciliation lists as `not_rung_in_toast`; an order it treats as `no_ring_expected`
 * is not among them, so an empty list never proves every order is in Toast (lead rulings r2, B1).
 */
export async function readHouseNotInToastWithState(sb: Sb, locationId: string, dates: { from?: string; through: string }):
  Promise<{ rows: NotInToastOrder[]; house: HouseReconciliationState }> {
  try {
    const settings = await shopSettings(sb, locationId);
    if (!settings) return { rows: [], house: "off" };
    const rows = await selectAllRows<HouseStatusRow>(async (from, to) => {
      let q = sb.from("catering_reconciliation_status").select(HOUSE_STATUS_COLUMNS)
        .eq("location_id", locationId).eq("status", "not_rung_in_toast").lte("event_date", dates.through);
      if (dates.from) q = q.gte("event_date", dates.from);
      const res = await q.order("event_date").order("lead_id").range(from, to);
      if (res.error) raise(res.error);
      return res;
    });
    return { rows: rows.filter((row) => houseRowListed(row, settings)).map(houseNotInToastOrder), house: "on" };
  } catch (error) {
    if (error instanceof CateringToastNotInstalled) return { rows: [], house: "not_installed" };
    throw error;
  }
}

/** The house half of the not-rung seam. Same date contract as readNotInToast. A loop over the per-shop read: 0344 not
 *  installed = no house rows at all (as before: the first shop that finds it missing ends the read with []). */
export async function readHouseNotInToast(sb: Sb, locationIds: readonly string[], dates: { from?: string; through: string }): Promise<NotInToastOrder[]> {
  const out: NotInToastOrder[] = [];
  for (const locationId of new Set(locationIds)) {
    const one = await readHouseNotInToastWithState(sb, locationId, dates);
    if (one.house === "not_installed") return [];
    out.push(...one.rows);
  }
  return out;
}

export const PLAN_PAGE_SIZE = 1000;
export const PLAN_MAX_PAGES = 50;
/** `plan_catering_toast` is set-returning: PostgREST cuts it at max-rows silently, and a 62-day window bounds dates,
 * not candidate pairs. So it is read to COMPLETION or refused by name (review r1 P2 #1): pages of 1,000 by `range`
 * over the function's TOTAL order (one row per (lead, order, check), the key its DISTINCT ON and ORDER BY use), with an
 * exact count; a missing or moving count, a short page before the count, or more than PLAN_MAX_PAGES pages throws
 * `catering_toast_plan_incomplete`. Never a truncated list that reads as "no matching Toast check". */
export async function readPlanToCompletion(sb: Sb, args: Record<string, unknown>): Promise<CateringToastPlanRow[]> {
  const out: CateringToastPlanRow[] = [];
  let expected: number | null = null;
  for (let page = 0; ; page += 1) {
    if (page >= PLAN_MAX_PAGES) throw new Error("catering_toast_plan_incomplete");
    const from = page * PLAN_PAGE_SIZE;
    const res = await sb.rpc("plan_catering_toast", args, { count: "exact" })
      .order("lead_id").order("order_guid").order("check_guid").range(from, from + PLAN_PAGE_SIZE - 1);
    if (res.error) raise(res.error);
    const count = typeof res.count === "number" ? res.count : null;
    if (count === null || (expected !== null && count !== expected)) throw new Error("catering_toast_plan_incomplete");
    expected = count;
    const rows = (res.data ?? []) as CateringToastPlanRow[];
    out.push(...rows);
    if (out.length >= expected) break;
    if (rows.length < PLAN_PAGE_SIZE) throw new Error("catering_toast_plan_incomplete");
  }
  if (out.length !== expected) throw new Error("catering_toast_plan_incomplete");
  return out;
}

/** Suggestions for listed house rows: one bounded planner call per shop and <= 62-day window. Ring codes typed as
 * SPECIAL_REQUEST notes are not looked up here (no Toast API call on a page render); the PR 4 reconcile pass carries
 * them (runbook contract 3). A failed read answers null for the affected rows: the row stays listed. */
export async function loadHouseSuggestions(sb: Sb, rows: readonly NotInToastOrder[]): Promise<Map<string, HouseSuggestions | null>> {
  const out = new Map<string, HouseSuggestions | null>();
  const byShop = new Map<string, NotInToastOrder[]>();
  for (const row of rows) if (row.source === "house" && row.lead_id) byShop.set(row.location_id, [...(byShop.get(row.location_id) ?? []), row]);
  for (const [locationId, shopRows] of byShop) {
    for (const window of plannerWindows(shopRows.map((r) => r.event_date))) {
      const inWindow = shopRows.filter((r) => r.event_date >= window.from && r.event_date <= window.to);
      let plan: CateringToastPlanRow[] | null;
      try {
        plan = await readPlanToCompletion(sb, { p_location_id: locationId, p_from: window.from, p_to: window.to, p_note_codes: [] });
      } catch {
        plan = null;
      }
      for (const row of inWindow) out.set(row.lead_id!, plan ? suggestionsFor(row.lead_id!, plan) : null);
    }
  }
  return out;
}

/** The partition of the unchanged pipeline value, summed over the Sales page's windows. null = not installed, shop
 * off, or a partition that does not sum (never a wrong label). */
export async function loadPipelineReconciliation(sb: Sb, locationId: string, windows: ReadonlyArray<{ from: string; to: string }>): Promise<PipelineReconciliation | null> {
  try {
    if (!await shopSettings(sb, locationId)) return null;
    const raws: PipelineReconciliationRaw[] = [];
    for (const w of windows) {
      const { data, error } = await sb.rpc("catering_pipeline_reconciliation", { p_location_id: locationId, p_from: w.from, p_to: w.to });
      if (error) raise(error);
      raws.push(data as PipelineReconciliationRaw);
    }
    return mergePipelineReconciliation(raws);
  } catch (error) {
    if (error instanceof CateringToastNotInstalled) return null;
    throw error;
  }
}

/** Sales → Catering, block 3: "of this, $X is also rung in Toast". The Sales read gate first (before any I/O), then
 * the same windows as the block it labels. The label is a SECOND read, so it is checked against the numbers block 3
 * DISPLAYED (`displayed`, loadSalesCatering's own pipeline): any difference in money, events or unvalued count (an
 * estimate changed or an order confirmed between the reads) is "changed" and the page withholds the breakdown with
 * that reason (review r1 P2 #2), never "Of this: $800" under a $500 total. */
export async function loadSalesPipelineToastLabel(viewer: ReportScopeViewer,
  args: { locationId: string; range: SalesRange; displayed: CateringValues },
  deps: { client?: Sb } = {}): Promise<PipelineReconciliation | null | "changed"> {
  assertSalesScope(viewer, args.locationId);
  if (args.range.empty) return null;
  const label = await loadPipelineReconciliation(deps.client ?? getServiceRoleClient(), args.locationId, salesWindows(args.range.from, args.range.to));
  if (!label) return null;
  return pipelineLabelMatchesDisplayed(label, args.displayed) ? label : "changed";
}
