/**
 * Mid-shift sales pulse — the READ layer (council 2026-07-31). Two honest
 * lanes over `toast_sales_events` (never the depletion ledger — the
 * double-count law keeps drift ledger-side, display event-side):
 *
 *   TODAY-SO-FAR — whatever the same-day triggers (closing-confirm /
 *     debounced on-visit pull) have landed; "as of" = max pulled_at.
 *   YESTERDAY & PACE — yesterday's final numbers + Δ% vs the same weekday
 *     last week, and a trailing same-weekday baseline for today's context.
 *
 * One small indexed query per business date (7 total, parallel) — each day is
 * ~300 rows, comfortably under the PostgREST row cap; the pure math lives in
 * midshift-sales-shared (tested).
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

export type { DaySalesAgg, TopItem };

const BASELINE_WEEKS = 4;
const TOP_ITEMS_LIMIT = 3;

export interface SalesPulse {
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

async function loadDayRows(
  service: SupabaseClient,
  locationId: string,
  businessDate: string,
): Promise<{ rows: SalesEventRow[]; maxPulledAt: string | null }> {
  const { data, error } = await service
    .from("toast_sales_events")
    .select(
      "business_date, check_guid, selection_guid, parent_selection_guid, item_name, quantity, price_cents, voided, snapshot_version, pulled_at",
    )
    .eq("location_id", locationId)
    .eq("business_date", businessDate)
    .returns<QueriedRow[]>();
  if (error) throw new Error(`midshift sales ${businessDate}: ${error.message}`);
  let maxPulledAt: string | null = null;
  const rows = (data ?? []).map((r) => {
    if (maxPulledAt == null || r.pulled_at > maxPulledAt) maxPulledAt = r.pulled_at;
    return { ...r, quantity: Number(r.quantity) };
  });
  return { rows, maxPulledAt };
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

  const todayAgg = today.rows.length > 0 ? aggregateDaySales(todayYmd, today.rows) : null;
  const yesterdayAgg = yesterday.rows.length > 0 ? aggregateDaySales(yesterdayYmd, yesterday.rows) : null;
  const yesterdayBaseAgg =
    yesterdayBase.rows.length > 0 ? aggregateDaySales(yesterdayBaseYmd, yesterdayBase.rows) : null;

  const baselineAggs = baseline
    .map((b, i) => (b.rows.length > 0 ? aggregateDaySales(baselineDates[i]!, b.rows) : null))
    .filter((a): a is DaySalesAgg => a !== null);
  const baselineAvgCents =
    baselineAggs.length > 0
      ? Math.round(baselineAggs.reduce((s, a) => s + a.netCents, 0) / baselineAggs.length)
      : null;

  return {
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
