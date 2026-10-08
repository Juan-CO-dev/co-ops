/**
 * Sales reports — the authorized READ boundary (server-only). Reports hub piece 4, Phase 2b.
 *
 * Every loader:
 *   1. authorizes BEFORE any I/O — level >= SALES_READ_MIN (GM, Juan 2026-10-08) and the concrete
 *      shop through the reports-hub scope (own shop below 8, any shop at 8+). `all` is never a
 *      shop: the pages expand it into per-shop panels after the level-8 check. A URL or a cursor
 *      never grants a shop;
 *   2. windows by (shop, business date) FIRST: a range becomes <= 31-day windows (0232 refuses
 *      wider), fetched two at a time and merged in lib/sales-reports-shared.ts. Twelve months is
 *      twelve bounded statements, never one unbounded scan (the #418/#419 lesson);
 *   3. reads only the 0232 RPCs (aggregated in SQL, PII-free by construction) plus the existing
 *      0195 catering window and the capture-run table for "captured through".
 *
 * Exports (lib/report-export.ts) call these SAME loaders with the SAME viewer, so a file never
 * shows more than the screen.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canReadScopedReport, type ReportScopeViewer } from "@/lib/report-scope";
import { validReportDate } from "@/lib/report-range";
import { getServiceRoleClient } from "@/lib/supabase-server";
import {
  SALES_PAGE_SIZE, SALES_READ_MIN, SALES_WINDOW_CONCURRENCY, mergeBreakdown, mergeEzcaterSummaries, salesDeltaPct,
  salesListContext, salesWindows, summarizeSales, toCheckDetail, toCheckRow, toEzcaterRow,
  type BreakdownRaw, type BreakdownRow, type DailyRaw, type EzcaterSummary, type EzcaterSummaryRaw,
  type SalesCheckDetail, type SalesCheckFilters, type SalesCheckRow, type SalesDimension, type SalesEzcaterRow,
  type SalesRange, type SalesSummaryDto,
} from "@/lib/sales-reports-shared";

export * from "@/lib/sales-reports-shared";

export class SalesReportError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
    this.name = "SalesReportError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHECK_GUID = /^[A-Za-z0-9-]{1,64}$/;

/** The gate every loader runs first. Throws; never returns a partial grant. */
export function assertSalesScope(viewer: ReportScopeViewer, locationId: string | undefined): asserts locationId is string {
  if (viewer.level < SALES_READ_MIN) throw new SalesReportError(403, "role_insufficient");
  if (!locationId || locationId === "all" || !UUID.test(locationId)) throw new SalesReportError(400, "invalid_location");
  if (!canReadScopedReport(viewer, locationId)) throw new SalesReportError(403, "location_forbidden");
}

type Client = Pick<SupabaseClient, "rpc" | "from">;
export interface SalesDeps { client?: Client }

async function call<T>(sb: Client, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    // 0232 not applied yet: say so on the page, never a fake empty report.
    if (error.code === "PGRST202" || error.code === "42883") throw new SalesReportError(503, "sales_reads_not_installed");
    throw new Error(`${fn}: ${error.message}`);
  }
  return data as T;
}

/** Order-preserving map with at most `limit` calls in flight. */
export async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function windowArgs(locationId: string, w: { from: string; to: string }) {
  return { p_location_id: locationId, p_from: w.from, p_to: w.to };
}

// ── Summary ─────────────────────────────────────────────────────────────────────────────────


async function dailyTotals(sb: Client, locationId: string, from: string, to: string, grain: SalesRange["grain"]) {
  const raws = await mapBounded(salesWindows(from, to), SALES_WINDOW_CONCURRENCY,
    (w) => call<DailyRaw>(sb, "sales_report_daily", windowArgs(locationId, w)));
  return summarizeSales(raws, from, to, grain);
}

export async function loadSalesSummary(viewer: ReportScopeViewer, args: { locationId: string; range: SalesRange }, deps: SalesDeps = {}): Promise<SalesSummaryDto> {
  assertSalesScope(viewer, args.locationId);
  const sb = deps.client ?? getServiceRoleClient();
  const { range, locationId } = args;
  if (range.empty) {
    const empty = summarizeSales([], range.from, range.from > range.to ? range.from : range.to, range.grain);
    return { locationId, range, buckets: [], totals: { ...empty.totals, expectedDays: 0, coverage: "missing" }, previous: null, deltaPct: null, capturedAt: null };
  }
  const [current, previous, capturedAt] = await Promise.all([
    dailyTotals(sb, locationId, range.from, range.to, range.grain),
    range.compare ? dailyTotals(sb, locationId, range.previous.from, range.previous.to, range.grain) : Promise.resolve(null),
    range.todaySoFar ? latestCapture(sb, locationId, range.to) : Promise.resolve(null),
  ]);
  return {
    locationId, range, buckets: current.buckets, totals: current.totals, previous: previous?.totals ?? null,
    deltaPct: salesDeltaPct(current.totals, previous?.totals ?? null), capturedAt,
  };
}

async function latestCapture(sb: Client, locationId: string, businessDate: string): Promise<string | null> {
  const { data, error } = await sb.from("toast_capture_runs").select("finished_at")
    .eq("location_id", locationId).eq("business_date", businessDate).eq("status", "completed")
    .order("finished_at", { ascending: false }).limit(1).maybeSingle<{ finished_at: string }>();
  if (error) throw new Error(`sales capture run: ${error.message}`);
  return data?.finished_at ?? null;
}

// ── Breakdowns ──────────────────────────────────────────────────────────────────────────────

export async function loadSalesBreakdown(viewer: ReportScopeViewer, args: { locationId: string; range: SalesRange; dimension: SalesDimension }, deps: SalesDeps = {}): Promise<BreakdownRow[]> {
  assertSalesScope(viewer, args.locationId);
  const sb = deps.client ?? getServiceRoleClient();
  if (args.range.empty) return [];
  const chunks = await mapBounded(salesWindows(args.range.from, args.range.to), SALES_WINDOW_CONCURRENCY,
    (w) => call<BreakdownRaw[]>(sb, "sales_report_breakdown", { ...windowArgs(args.locationId, w), p_dimension: args.dimension }));
  return mergeBreakdown(args.dimension, chunks);
}

// ── Keyset cursors ──────────────────────────────────────────────────────────────────────────

interface CursorBody { d: string; k: string; x: string }
export function encodeSalesCursor(date: string, key: string, context: string): string {
  return Buffer.from(JSON.stringify({ d: date, k: key, x: context } satisfies CursorBody)).toString("base64url");
}
/** A tampered, oversized or other-context cursor decodes to null: the list restarts at page one. */
export function decodeSalesCursor(cursor: string | undefined, context: string, key: RegExp): { date: string; key: string } | null {
  if (!cursor || cursor.length > 2048) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString()) as Partial<CursorBody>;
    if (v.x !== context || !validReportDate(v.d) || typeof v.k !== "string" || !key.test(v.k)) return null;
    return { date: v.d, key: v.k };
  } catch {
    return null;
  }
}

/**
 * Walks the windows newest-first until a page (+1 lookahead) is filled. Windows wholly newer than
 * the cursor are skipped; the cursor's tuple is passed only to the window that contains it.
 */
async function keysetWalk<T>(windows: Array<{ from: string; to: string }>, after: { date: string; key: string } | null, pageSize: number,
  fetch: (w: { from: string; to: string }, after: { date: string; key: string } | null, limit: number) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  for (const w of windows) {
    if (after && w.from > after.date) continue;
    const inside = after && after.date >= w.from && after.date <= w.to ? after : null;
    rows.push(...await fetch(w, inside, pageSize + 1 - rows.length));
    if (rows.length > pageSize) break;
  }
  return rows;
}

// ── Checks ──────────────────────────────────────────────────────────────────────────────────

export interface SalesCheckPage { rows: SalesCheckRow[]; nextCursor: string | null; cursorReset: boolean }

export async function loadSalesCheckPage(viewer: ReportScopeViewer, args: {
  locationId: string; range: SalesRange; filters: SalesCheckFilters; cursor?: string; pageSize?: number;
}, deps: SalesDeps = {}): Promise<SalesCheckPage> {
  assertSalesScope(viewer, args.locationId);
  const sb = deps.client ?? getServiceRoleClient();
  const pageSize = Math.min(Math.max(args.pageSize ?? SALES_PAGE_SIZE, 1), 100);
  if (args.range.empty) return { rows: [], nextCursor: null, cursorReset: false };
  const context = salesListContext(args.locationId, args.range.from, args.range.to, args.filters);
  const after = decodeSalesCursor(args.cursor, context, CHECK_GUID);
  const f = args.filters;
  const raw = await keysetWalk(salesWindows(args.range.from, args.range.to), after, pageSize, (w, a, limit) =>
    call<Array<Record<string, unknown>>>(sb, "sales_report_check_page", {
      ...windowArgs(args.locationId, w), p_after_date: a?.date ?? null, p_after_check: a?.key ?? null, p_limit: limit,
      p_channel: f.channel ?? null, p_provider: f.provider ?? null, p_server: f.server ?? null, p_discount: f.discount ?? null,
      p_dow: f.dow ?? null, p_hour: f.hour ?? null,
    }));
  const rows = raw.slice(0, pageSize).map(toCheckRow);
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor: raw.length > pageSize && last ? encodeSalesCursor(last.businessDate, last.checkGuid, context) : null,
    cursorReset: !!args.cursor && !after,
  };
}

export async function loadSalesCheckDetail(viewer: ReportScopeViewer, args: { locationId: string; businessDate: string; checkGuid: string }, deps: SalesDeps = {}): Promise<SalesCheckDetail | null> {
  assertSalesScope(viewer, args.locationId);
  if (!validReportDate(args.businessDate) || !CHECK_GUID.test(args.checkGuid)) return null;
  const sb = deps.client ?? getServiceRoleClient();
  const raw = await call<Record<string, unknown> | null>(sb, "sales_report_check_detail", {
    p_location_id: args.locationId, p_business_date: args.businessDate, p_check_guid: args.checkGuid,
  });
  return raw ? toCheckDetail(raw) : null;
}

export interface SalesEzcaterPage { rows: SalesEzcaterRow[]; nextCursor: string | null }

/** ezCater orders by event date, keyset (event_date desc, order id asc), windowed like every read. */
export async function loadSalesEzcaterOrders(viewer: ReportScopeViewer, args: { locationId: string; range: SalesRange; cursor?: string; pageSize?: number }, deps: SalesDeps = {}): Promise<SalesEzcaterPage> {
  assertSalesScope(viewer, args.locationId);
  const sb = deps.client ?? getServiceRoleClient();
  if (args.range.empty) return { rows: [], nextCursor: null };
  const pageSize = Math.min(Math.max(args.pageSize ?? SALES_PAGE_SIZE, 1), 100);
  const context = salesListContext(args.locationId, args.range.from, args.range.to, {});
  const after = decodeSalesCursor(args.cursor, context, UUID);
  const raw = await keysetWalk(salesWindows(args.range.from, args.range.to), after, pageSize, (w, a, limit) =>
    call<Array<Record<string, unknown>>>(sb, "sales_report_ezcater_page", {
      ...windowArgs(args.locationId, w), p_after_date: a?.date ?? null, p_after_id: a?.key ?? null, p_limit: limit,
    }));
  const rows = raw.slice(0, pageSize).map(toEzcaterRow);
  const last = rows[rows.length - 1];
  return { rows, nextCursor: raw.length > pageSize && last ? encodeSalesCursor(last.eventDate, last.orderId, context) : null };
}

// ── Catering slice ──────────────────────────────────────────────────────────────────────────

export interface SalesCateringDto {
  locationId: string;
  /** Toast catering-channel checks that are sales (house catering, DeliverThat, CO app catering). */
  toastCatering: BreakdownRow[];
  /** ezCater orders (source of truth) and how they line up with Toast. */
  ezcater: EzcaterSummary;
  /** 0195 pipeline values by EVENT date: what was earned vs what is still to earn. Never POS sales. */
  pipeline: { completedCents: number; completedEvents: number; confirmedCents: number; confirmedEvents: number } | null;
  orders: SalesEzcaterPage;
}

export async function loadSalesCatering(viewer: ReportScopeViewer, args: { locationId: string; range: SalesRange; cursor?: string; pageSize?: number }, deps: SalesDeps = {}): Promise<SalesCateringDto> {
  assertSalesScope(viewer, args.locationId);
  const sb = deps.client ?? getServiceRoleClient();
  const { locationId, range } = args;
  if (range.empty) return { locationId, toastCatering: [], ezcater: mergeEzcaterSummaries([]), pipeline: null, orders: { rows: [], nextCursor: null } };
  const [channels, summaries, pipeline, orders] = await Promise.all([
    loadSalesBreakdown(viewer, { locationId, range, dimension: "channel" }, { client: sb }),
    mapBounded(salesWindows(range.from, range.to), SALES_WINDOW_CONCURRENCY,
      (w) => call<EzcaterSummaryRaw>(sb, "sales_report_ezcater_summary", windowArgs(locationId, w))),
    call<Record<string, unknown> | null>(sb, "catering_insights_window", { p_location_ids: [locationId], p_from: range.from, p_to: range.to }),
    loadSalesEzcaterOrders(viewer, { locationId, range, cursor: args.cursor, pageSize: args.pageSize }, { client: sb }),
  ]);
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
  return {
    locationId,
    toastCatering: channels.filter((r) => r.channel === "catering" && r.saleClass === "sale"),
    ezcater: mergeEzcaterSummaries(summaries),
    pipeline: pipeline ? {
      completedCents: num(pipeline.completed_value_cents), completedEvents: num(pipeline.completed_events),
      confirmedCents: num(pipeline.confirmed_value_cents), confirmedEvents: num(pipeline.confirmed_events),
    } : null,
    orders,
  };
}
