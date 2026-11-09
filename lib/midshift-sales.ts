/**
 * Mid-shift sales pulse reads completed capture day coverage,
 * check amounts for pre-tax net sales, and top-level selection units.
 * Completed empty days are zero; absent coverage or missing money is unknown.
 * Yesterday and the trailing same-weekday baseline use the same source.
 */

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  addDaysYmd,
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
  source?: "capture";
  /** A requested capture day is missing or has unreviewed channel coverage. */
  coverageDegraded?: boolean;
  todayYmd: string;
  /** Today's aggregate, or null when successful capture or eligible check money is missing. */
  today: DaySalesAgg | null;
  yesterday: DaySalesAgg | null;
  /** Yesterday vs the same weekday one week prior (whole %), null when uncomparable. */
  yesterdayDeltaPct: number | null;
  /** Average net across the trailing same-weekday baseline days that have data. */
  baselineAvgCents: number | null;
  /** How many of the trailing weeks actually had data (honest denominator). */
  baselineWeeks: number;
  topToday: TopItem[];
  /** Successful capture completion timestamp (the "as of" stamp). */
  lastPulledAt: string | null;
}

type PulseDayRows = { rows: SalesEventRow[]; maxPulledAt: string | null; aggregate?: DaySalesAgg; coverageDegraded?: boolean };

async function loadDaysRows(locationId: string, dates: readonly string[]): Promise<PulseDayRows[]> {
  return Promise.all(dates.map(async (businessDate): Promise<PulseDayRows> => {
    const captured = await loadCapturedToastDay(locationId, businessDate);
    if (!captured) return { rows: [], maxPulledAt: null, coverageDegraded: true };
    try { return { ...capturedDayPulse(businessDate, captured.orders), maxPulledAt: captured.coverage.finishedAt, coverageDegraded: captured.coverage.configDegraded }; }
    catch (error) {
      if (error instanceof Error && error.message === "capture_pulse_amount_missing") return { rows: [], maxPulledAt: null, coverageDegraded: true };
      throw error;
    }
  }));
}

/** The all-null pulse — the render fallback when the sales read fails, so a
 *  Toast/DB hiccup on this SECONDARY lane degrades to the panel's honest
 *  empty state instead of taking down the operational pulse. */
export function emptySalesPulse(todayYmd: string): SalesPulse {
  return {
    source: "capture",
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

export function loadSalesPulse(service: SupabaseClient, args: { locationId: string; todayYmd: string }): Promise<SalesPulse> {
  return loadSalesPulseForRender(service, args.locationId, args.todayYmd);
}

// Primitive keys deduplicate the seven-day read when multiple panels share a render.
const loadSalesPulseForRender = cache(async (service: SupabaseClient, locationId: string, todayYmd: string): Promise<SalesPulse> => {
  const yesterdayYmd = addDaysYmd(todayYmd, -1);
  const yesterdayBaseYmd = addDaysYmd(todayYmd, -8); // yesterday's same weekday, one week prior
  const baselineDates = sameWeekdayBaselineDates(todayYmd, BASELINE_WEEKS);

  const loaded = await loadDaysRows(locationId, [todayYmd, yesterdayYmd, yesterdayBaseYmd, ...baselineDates]);
  const today = loaded[0]!;
  const yesterday = loaded[1]!;
  const yesterdayBase = loaded[2]!;
  const baseline = loaded.slice(3);

  const todayAgg = today.aggregate ?? null;
  const yesterdayAgg = yesterday.aggregate ?? null;
  const yesterdayBaseAgg =
    yesterdayBase.aggregate ?? null;

  const baselineAggs = baseline
    .map((b) => b.aggregate ?? null)
    .filter((a): a is DaySalesAgg => a !== null);
  const baselineAvgCents =
    baselineAggs.length > 0
      ? Math.round(baselineAggs.reduce((s, a) => s + a.netCents, 0) / baselineAggs.length)
      : null;

  return {
    source: "capture",
    todayYmd,
    coverageDegraded: loaded.some(day => day.coverageDegraded),
    today: todayAgg,
    yesterday: yesterdayAgg,
    yesterdayDeltaPct:
      yesterdayAgg && yesterdayBaseAgg ? pctDelta(yesterdayAgg.netCents, yesterdayBaseAgg.netCents) : null,
    baselineAvgCents,
    baselineWeeks: baselineAggs.length,
    topToday: topItemsForDay(today.rows, TOP_ITEMS_LIMIT),
    lastPulledAt: today.maxPulledAt,
  };
});
