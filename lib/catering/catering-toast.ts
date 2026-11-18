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
import { salesWindows, type SalesRange } from "@/lib/sales-reports-shared";
import type { ReportScopeViewer } from "@/lib/report-scope";
import {
  CATERING_TOAST_SETTINGS_COLUMNS, HOUSE_STATUS_COLUMNS, houseNotInToastOrder, houseRowListed, mergePipelineReconciliation,
  plannerWindows, suggestionsFor,
  type CateringToastPlanRow, type CateringToastShopSettings, type HouseStatusRow, type HouseSuggestions,
  type PipelineReconciliation, type PipelineReconciliationRaw,
} from "./catering-toast-shared";

type Sb = ReturnType<typeof getServiceRoleClient>;

/** A relation or function 0344 adds is missing: the migration is not applied yet. */
const NOT_INSTALLED = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
export class CateringToastNotInstalled extends Error { constructor() { super("catering_toast_not_installed"); } }
function raise(error: { code?: string; message?: string }): never {
  if (error.code && NOT_INSTALLED.has(error.code)) throw new CateringToastNotInstalled();
  throw new Error("catering_toast_read_failed");
}

async function shopSettings(sb: Sb, locationId: string): Promise<CateringToastShopSettings | null> {
  const { data, error } = await sb.from("catering_toast_settings").select(CATERING_TOAST_SETTINGS_COLUMNS)
    .eq("location_id", locationId).eq("enabled", true).order("location_id").range(0, 0);
  if (error) raise(error);
  const row = (data as Array<{ enabled: boolean; include_toast_origin_leads: boolean }> | null)?.[0];
  return row ? { enabled: row.enabled === true, includeToastOriginLeads: row.include_toast_origin_leads === true } : null;
}

/** The house half of the not-rung seam. Same date contract as readNotInToast. */
export async function readHouseNotInToast(sb: Sb, locationIds: readonly string[], dates: { from?: string; through: string }): Promise<NotInToastOrder[]> {
  const out: NotInToastOrder[] = [];
  try {
    for (const locationId of new Set(locationIds)) {
      const settings = await shopSettings(sb, locationId);
      if (!settings) continue;
      const rows = await selectAllRows<HouseStatusRow>(async (from, to) => {
        let q = sb.from("catering_reconciliation_status").select(HOUSE_STATUS_COLUMNS)
          .eq("location_id", locationId).eq("status", "not_rung_in_toast").lte("event_date", dates.through);
        if (dates.from) q = q.gte("event_date", dates.from);
        const res = await q.order("event_date").order("lead_id").range(from, to);
        if (res.error) raise(res.error);
        return res;
      });
      out.push(...rows.filter((row) => houseRowListed(row, settings)).map(houseNotInToastOrder));
    }
  } catch (error) {
    if (error instanceof CateringToastNotInstalled) return [];
    throw error;
  }
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
      const { data, error } = await sb.rpc("plan_catering_toast",
        { p_location_id: locationId, p_from: window.from, p_to: window.to, p_note_codes: [] });
      for (const row of inWindow) out.set(row.lead_id!, error ? null : suggestionsFor(row.lead_id!, (data ?? []) as CateringToastPlanRow[]));
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
 * the same windows as the block it labels, so the label partitions exactly the total shown above it. */
export async function loadSalesPipelineToastLabel(viewer: ReportScopeViewer, args: { locationId: string; range: SalesRange },
  deps: { client?: Sb } = {}): Promise<PipelineReconciliation | null> {
  assertSalesScope(viewer, args.locationId);
  if (args.range.empty) return null;
  return loadPipelineReconciliation(deps.client ?? getServiceRoleClient(), args.locationId, salesWindows(args.range.from, args.range.to));
}
