import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSalesScope, loadSalesBreakdown, SalesReportError } from "@/lib/sales-reports";
import { mergeBreakdown, resolveSalesRange, summarizeSales, type BreakdownRaw, type DailyRaw } from "@/lib/sales-reports-shared";
import { shiftReportDate } from "@/lib/report-range";
import { withAbort } from "@/lib/pulse/abort";
import type { PulseCtx, SalesFacts } from "@/lib/pulse/sections";

// Cold prod (2026-10-10): pulse_sales_baseline took 4.6 s at MEP, 1.3 s at EM. Under the 8 s statement timeout.
export const BASELINE_DEADLINE_MS = 6_000;
/** The baseline covers PAST days only, so a successful result is valid all shift: cache successes, never misses. */
export const BASELINE_TTL_MS = 6 * 60 * 60 * 1000;
const baselineCache = new Map<string, { value: BaselineRaw; expires: number }>();
export function clearBaselineCache(): void { baselineCache.clear(); }
type TodayRaw = Pick<DailyRaw, "classes" | "discounts" | "refunds" | "captured_days"> & { captured_at: string | null };
type BaselineRaw = { hours: BreakdownRaw[]; captured_days: string[] };

async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") throw new SalesReportError(503, "sales_reads_not_installed");
    throw new Error(`${name}: ${error.message}`);
  }
  if (!data) throw new Error(`${name}: missing result`);
  return data as T;
}

/** Independent deadline: even a client that ignores abort cannot hold today's result hostage. */
async function baseline(client: SupabaseClient, args: Record<string, unknown>): Promise<BaselineRaw | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      rpc<BaselineRaw>(withAbort(client, controller.signal), "pulse_sales_baseline", args),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve(null); }, BASELINE_DEADLINE_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function cachedBaseline(client: SupabaseClient, locationId: string, date: string): Promise<BaselineRaw | null> {
  const key = `${locationId}:${date}`;
  const hit = baselineCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await baseline(client, { p_location_id: locationId, p_from: shiftReportDate(date, -28), p_to: shiftReportDate(date, -1) });
  if (value) baselineCache.set(key, { value, expires: Date.now() + BASELINE_TTL_MS });
  return value;
}

/**
 * The freshness stamp of today's sales: `finished_at` of the latest COMPLETED full-day capture for this
 * shop/day, null before the first one. This is the SAME definition 0242's `pulse_sales_today` uses for
 * `captured_at` (status = 'completed' only — a running run has published nothing: 0221's
 * `toast_capture_finish` moves the pointers and flips the status in one transaction; 0237's
 * modified-order runs end as 'modified_completed' and are not full-day coverage), so the card's
 * "Toast synced" label and the cache key move together. One indexed single-row read
 * (toast_capture_runs_location_date), cheap enough to run on every poll.
 */
export async function loadCaptureStamp(client: SupabaseClient, locationId: string, date: string, signal?: AbortSignal): Promise<string | null> {
  const probe = signal ? withAbort(client, signal) : client;
  const { data, error } = await probe.from("toast_capture_runs").select("finished_at")
    .eq("location_id", locationId).eq("business_date", date).eq("status", "completed")
    .order("finished_at", { ascending: false }).limit(1)
    .maybeSingle<{ finished_at: string | null }>();
  if (error) throw new Error(`pulse capture stamp: ${error.message}`);
  return data?.finished_at ?? null;
}

/** Seven bounded RPCs on a cold source; no report accounting or coverage-discovery reads. */
export async function loadPulseSales(client: SupabaseClient, ctx: PulseCtx): Promise<SalesFacts> {
  const viewer = { userId: ctx.auth.user.id, level: ctx.auth.level, locations: ctx.auth.locations };
  assertSalesScope(viewer, ctx.locationId);
  const range = resolveSalesRange({ range: "today" }, ctx.date);
  const one = { locationId: ctx.locationId, range };
  const [raw, items, channels, discounts, servers, hoursToday, history] = await Promise.all([
    rpc<TodayRaw>(client, "pulse_sales_today", { p_location_id: ctx.locationId, p_from: ctx.date, p_to: ctx.date }),
    loadSalesBreakdown(viewer, { ...one, dimension: "item" }, { client }),
    loadSalesBreakdown(viewer, { ...one, dimension: "channel" }, { client }),
    loadSalesBreakdown(viewer, { ...one, dimension: "discount" }, { client }),
    loadSalesBreakdown(viewer, { ...one, dimension: "server" }, { client }),
    loadSalesBreakdown(viewer, { ...one, dimension: "hour_weekday" }, { client }),
    cachedBaseline(client, ctx.locationId, ctx.date),
  ]);
  const today = summarizeSales([{ ...raw, tips: [], ezcater: [] }], ctx.date, ctx.date, "day");
  return {
    today: { totals: today.totals, capturedAt: raw.captured_at },
    items, channels, discounts, servers, hoursToday,
    heatTrailing: history ? mergeBreakdown("hour_weekday", [history.hours]) : [],
    trailing: history ? { buckets: [...new Set(history.captured_days)].map((from) => ({ from, coveredDays: 1 })) } : null,
  };
}
