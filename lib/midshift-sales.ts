/**
 * Mid-shift sales pulse: legacy selection events remain the default until CC
 * enables DEPLETION_SOURCE=capture. Capture reads completed day coverage,
 * check amounts for pre-tax net sales, and top-level selection units.
 * Completed empty days are zero; absent coverage or missing money is unknown.
 * Yesterday and the trailing same-weekday baseline use the same source.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  addDaysYmd,
  aggregateDaySales,
  pctDelta,
  sameWeekdayBaselineDates,
  topItemsForDay,
  type DaySalesAgg,
  type SalesEventRow,
  type TopItem,
} from "@/lib/midshift-sales-shared";

import { loadCapturedToastDay } from "@/lib/toast/depletion";
import { capturedDayPulse } from "@/lib/toast/capture-pulse-shared";

export type { DaySalesAgg, TopItem };

const BASELINE_WEEKS = 4;
const TOP_ITEMS_LIMIT = 3;

export interface SalesPulse {
  source?: "legacy" | "capture";
  todayYmd: string;
  /** Today's aggregate, or null when no events have been pulled for today yet. */
  today: DaySalesAgg | null;
  yesterday: DaySalesAgg | null;
  /** Yesterday vs the same weekday one week prior (whole %), null when uncomparable. */
  yesterdayDeltaPct: number | null;
  /** Average net across the trailing same-weekday baseline days that have data. */
  baselineAvgCents: number | null;
  /** How many of the trailing weeks actually had data (honest denominator). */
  baselineWeeks: number;
  topToday: TopItem[];
  /** Freshest pull timestamp among today's rows (the "as of" stamp). */
  lastPulledAt: string | null;
}

interface QueriedRow extends Omit<SalesEventRow, "quantity"> {
  quantity: number | string; // numeric can arrive as string from PostgREST
  pulled_at: string;
}

const PAGE_SIZE = 1000;

async function loadDayRows(
  service: SupabaseClient,
  locationId: string,
  businessDate: string,
): Promise<{ rows: SalesEventRow[]; maxPulledAt: string | null; aggregate?: DaySalesAgg }> {
  if (process.env.DEPLETION_SOURCE === "capture") {
    const captured = await loadCapturedToastDay(locationId, businessDate);
    if (!captured) return { rows: [], maxPulledAt: null };
    try { return { ...capturedDayPulse(businessDate, captured.orders), maxPulledAt: captured.coverage.finishedAt }; }
    catch (error) {
      if (error instanceof Error && error.message === "capture_pulse_amount_missing") return { rows: [], maxPulledAt: null };
      throw error;
    }
  }
  // Inline pagination (not selectAllRows) to preserve the error throw — the
  // page boundary catches it and degrades to the honest empty panel.
  const raw: QueriedRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await service
      .from("toast_sales_events")
      .select(
        "business_date, check_guid, selection_guid, parent_selection_guid, item_name, quantity, price_cents, voided, snapshot_version, pulled_at",
      )
      .eq("location_id", locationId)
      .eq("business_date", businessDate)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
      .returns<QueriedRow[]>();
    if (error) throw new Error(`midshift sales ${businessDate}: ${error.message}`);
    const page = data ?? [];
    raw.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  let maxPulledAt: string | null = null;
  const rows = raw.map((r) => {
    if (maxPulledAt == null || r.pulled_at > maxPulledAt) maxPulledAt = r.pulled_at;
    return { ...r, quantity: Number(r.quantity) };
  });
  return { rows, maxPulledAt };
}

/** The all-null pulse — the render fallback when the sales read fails, so a
 *  Toast/DB hiccup on this SECONDARY lane degrades to the panel's honest
 *  empty state instead of taking down the operational pulse. */
export function emptySalesPulse(todayYmd: string): SalesPulse {
  return {
    source: process.env.DEPLETION_SOURCE === "capture" ? "capture" : "legacy",
    todayYmd,
    today: null,
    yesterday: null,
    yesterdayDeltaPct: null,
    baselineAvgCents: null,
    baselineWeeks: 0,
    topToday: [],
    lastPulledAt: null,
  };
}

export async function loadSalesPulse(
  service: SupabaseClient,
  args: { locationId: string; todayYmd: string },
): Promise<SalesPulse> {
  const { locationId, todayYmd } = args;
  const yesterdayYmd = addDaysYmd(todayYmd, -1);
  const yesterdayBaseYmd = addDaysYmd(todayYmd, -8); // yesterday's same weekday, one week prior
  const baselineDates = sameWeekdayBaselineDates(todayYmd, BASELINE_WEEKS);

  const [today, yesterday, yesterdayBase, ...baseline] = await Promise.all([
    loadDayRows(service, locationId, todayYmd),
    loadDayRows(service, locationId, yesterdayYmd),
    loadDayRows(service, locationId, yesterdayBaseYmd),
    ...baselineDates.map((d) => loadDayRows(service, locationId, d)),
  ]);

  const todayAgg = today.aggregate ?? (today.rows.length > 0 ? aggregateDaySales(todayYmd, today.rows) : null);
  const yesterdayAgg = yesterday.aggregate ?? (yesterday.rows.length > 0 ? aggregateDaySales(yesterdayYmd, yesterday.rows) : null);
  const yesterdayBaseAgg =
    yesterdayBase.aggregate ?? (yesterdayBase.rows.length > 0 ? aggregateDaySales(yesterdayBaseYmd, yesterdayBase.rows) : null);

  const baselineAggs = baseline
    .map((b, i) => (b.aggregate ?? (b.rows.length > 0 ? aggregateDaySales(baselineDates[i]!, b.rows) : null)))
    .filter((a): a is DaySalesAgg => a !== null);
  const baselineAvgCents =
    baselineAggs.length > 0
      ? Math.round(baselineAggs.reduce((s, a) => s + a.netCents, 0) / baselineAggs.length)
      : null;

  return {
    source: process.env.DEPLETION_SOURCE === "capture" ? "capture" : "legacy",
    todayYmd,
    today: todayAgg,
    yesterday: yesterdayAgg,
    yesterdayDeltaPct:
      yesterdayAgg && yesterdayBaseAgg ? pctDelta(yesterdayAgg.netCents, yesterdayBaseAgg.netCents) : null,
    baselineAvgCents,
    baselineWeeks: baselineAggs.length,
    topToday: topItemsForDay(today.rows, TOP_ITEMS_LIMIT),
    lastPulledAt: today.maxPulledAt,
  };
}
