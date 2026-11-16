/** Item 1 PR B canary — CC operator entry, READ-ONLY. Runbook: docs/runbooks/toast-line-prices.md.
 * Run with TOAST_LINE_PRICES UNSET, after PR B is deployed, BEFORE the switch is turned on.
 *   npx tsx scripts/toast-line-price-canary.ts [--date YYYY-MM-DD ...] [--location <uuid>]
 * Default days: T−10 and T−11, T = today's ET calendar date. A day must be closed (≤ T−4).
 * For every shop-day: re-reads Toast ordersBulk, normalizes with line prices ON, hashes, and compares
 * with toast_orders (SELECT only). Exit 1 unless every day is representative (≥ 50 orders) and has zero
 * absent-with-same-modified_at orders. Prints counts and order GUIDs only; never prices or payloads.
 * Never imports env files; never writes (no insert / update / upsert / rpc). */
import { pathToFileURL } from "node:url";
import { etCalendarDate, etYmdMinusDays } from "../lib/operational-day";
import { classifyCanaryDay, type CanaryDay, type CanaryFetchedOrder, type CanaryStoredSnapshot } from "../lib/toast/line-price-canary-shared";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The newest day the canary may read: outside intraday (T, T−1), the nightly (T−1..T−3) and B0's T−4 edge. */
const CLOSED_LAG_DAYS = 4;

export function parseCanaryArgs(args: string[], today = etCalendarDate(new Date().toISOString())) {
  const dates: string[] = [];
  let location: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--date") {
      const value = args[++i] ?? "";
      if (!YMD.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error("canary_invalid_date");
      dates.push(value);
    } else if (args[i] === "--location") {
      location = args[++i] ?? "";
      if (!UUID.test(location)) throw new Error("canary_invalid_location");
    } else throw new Error("canary_unknown_argument");
  }
  if (!dates.length) dates.push(etYmdMinusDays(today, 10), etYmdMinusDays(today, 11));
  const newest = etYmdMinusDays(today, CLOSED_LAG_DAYS);
  if (dates.some((d) => d > newest)) throw new Error("canary_day_not_closed");
  return { dates, location };
}

type Thenable<T> = PromiseLike<{ data: T | null; error: unknown; count?: number | null }>;
type Query = {
  select(c: string, opts?: { count: "exact" }): Query; eq(k: string, v: unknown): Query; not(k: string, op: string, v: unknown): Query;
  order(k: string): Query; in(k: string, v: string[]): Query; range(from: number, to: number): Query;
} & Thenable<unknown[]>;
interface Deps {
  sb: { from(table: string): Query };
  fetchDay(locationId: string, date: string): Promise<{ skipped?: string; orders: CanaryFetchedOrder[] }>;
  /** Rows asked per request. Below PostgREST's 1000 default so a short page is never mistaken for a cap. */
  pageSize?: number;
  /** A read that would need more pages than this REFUSES (`canary_page_cap`) rather than judge a partial set. */
  maxPages?: number;
}
export type CanaryReport = { pass: boolean; days: (Partial<CanaryDay> & { location: string; date: string; skipped?: string; pass: boolean })[] };

const PAGE_SIZE = 500;
const MAX_PAGES = 200;

/** Fix round 1 (ITEM1B-r1 P2 #1): read EVERY row or refuse. Each request carries `count: "exact"` and a stable
 *  order; the collected set must equal the server's count — a server row cap, a short page or a count that moved
 *  under the read is `canary_history_truncated`, a missing count `canary_history_uncounted`, too many pages
 *  `canary_page_cap`. The canary never judges a partial history (a cut-off latest snapshot reads as "never captured"). */
async function readAll<T>(build: () => Query, code: string, pageSize: number, maxPages: number): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; ; page++) {
    if (page >= maxPages) throw new Error("canary_page_cap");
    const { data, error, count } = await build().range(page * pageSize, page * pageSize + pageSize - 1);
    if (error || !data) throw new Error(code);
    if (typeof count !== "number") throw new Error("canary_history_uncounted");
    out.push(...(data as T[]));
    if (out.length > count) throw new Error("canary_history_truncated");
    if (out.length === count) return out;
    if (data.length < pageSize) throw new Error("canary_history_truncated");
  }
}

export async function runCanary(options: ReturnType<typeof parseCanaryArgs>, deps: Deps): Promise<CanaryReport> {
  const pageSize = deps.pageSize ?? PAGE_SIZE, maxPages = deps.maxPages ?? MAX_PAGES;
  const shops = () => {
    const q = deps.sb.from("locations").select("id", { count: "exact" }).eq("active", true).not("toast_restaurant_guid", "is", null);
    return (options.location ? q.eq("id", options.location) : q).order("id");
  };
  const locations = await readAll<{ id: string }>(shops, "canary_locations_unavailable", pageSize, maxPages);
  if (!locations.length) throw new Error("canary_locations_unavailable");
  const report: CanaryReport = { pass: true, days: [] };
  for (const { id: location } of locations) {
    for (const date of options.dates) {
      const fetched = await deps.fetchDay(location, date);
      if (fetched.skipped) { report.days.push({ location, date, skipped: fetched.skipped, pass: false }); report.pass = false; continue; }
      const guids = [...new Set(fetched.orders.map((o) => o.order_guid))];
      const stored: CanaryStoredSnapshot[] = [];
      for (let i = 0; i < guids.length; i += 50) {
        const chunk = guids.slice(i, i + 50);
        const snapshots = await readAll<{ id: string; order_guid: string; content_hash: string; modified_at: string | null }>(
          () => deps.sb.from("toast_orders").select("id,order_guid,content_hash,modified_at", { count: "exact" }).eq("location_id", location).in("order_guid", chunk).order("id"),
          "canary_snapshots_read_failed", pageSize, maxPages);
        const pointers = await readAll<{ order_guid: string; snapshot_id: string }>(
          () => deps.sb.from("toast_order_latest_pointers").select("order_guid,snapshot_id", { count: "exact" }).eq("location_id", location).in("order_guid", chunk).order("order_guid"),
          "canary_pointers_read_failed", pageSize, maxPages);
        // Every stored order must have its latest pointer, and every pointer's snapshot must be in the history
        // read; otherwise an order would be judged without its latest snapshot. Refuse by name.
        const byId = new Map(snapshots.map((s) => [s.id, s]));
        const pointed = new Set<string>();
        for (const p of pointers) {
          if (byId.get(p.snapshot_id)?.order_guid !== p.order_guid) throw new Error("canary_snapshot_history_missing");
          pointed.add(p.order_guid);
        }
        if (snapshots.some((s) => !pointed.has(s.order_guid))) throw new Error("canary_latest_pointer_missing");
        const latest = new Set(pointers.map((p) => p.snapshot_id));
        stored.push(...snapshots.map((s) => ({ ...s, latest: latest.has(s.id) })));
      }
      const day = classifyCanaryDay(fetched.orders, stored);
      report.days.push({ location, date, ...day });
      if (!day.pass) report.pass = false;
    }
  }
  return report;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseCanaryArgs(args); // validate before any client exists
  const { getServiceRoleClient } = await import("../lib/supabase-server");
  const { canaryToastDate, captureEnabled } = await import("../lib/toast/capture");
  if (!captureEnabled()) throw new Error("capture_disabled_or_fixture");
  const report = await runCanary(options, { sb: getServiceRoleClient() as unknown as Deps["sb"], fetchDay: canaryToastDate });
  for (const day of report.days) console.log(JSON.stringify(day));
  console.log(JSON.stringify({ canary: report.pass ? "PASS" : "FAIL", days: report.days.length }));
  if (!report.pass) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error && /^canary_|^capture_/.test(error.message) ? error.message : "canary_failed"); process.exitCode = 1; });
}
