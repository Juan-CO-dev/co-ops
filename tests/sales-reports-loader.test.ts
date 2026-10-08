import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no database in unit tests"); }) }));

import { getServiceRoleClient } from "@/lib/supabase-server";
import {
  SalesReportError, assertSalesScope, decodeSalesCursor, encodeSalesCursor, loadSalesBreakdown, loadSalesCatering, loadSalesCheckDetail,
  loadSalesCheckPage, loadSalesEzcaterOrders, loadSalesSummary, mapBounded, resolveSalesRange, salesListContext,
} from "@/lib/sales-reports";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const TODAY = "2026-10-08";
const gm = { userId: "u-gm", level: 7, locations: [A] };
const agm = { userId: "u-agm", level: 6, locations: [A] };
const moo = { userId: "u-moo", level: 8, locations: [] as string[] };

type Call = { fn: string; args: Record<string, unknown> };
function fakeClient(handler: (fn: string, args: Record<string, unknown>) => unknown) {
  const calls: Call[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      const out = handler(fn, args);
      return out instanceof Error ? { data: null, error: { message: out.message, code: (out as Error & { code?: string }).code } } : { data: out, error: null };
    },
    from: () => { throw new Error("unexpected table read"); },
  };
  return { client: client as never, calls, maxInFlight: () => maxInFlight };
}
const emptyDaily = { classes: [], tips: [], discounts: [], refunds: [], captured_days: [], ezcater: [] };

beforeEach(() => vi.clearAllMocks());

describe("access matrix: GM+ own shop, 8+ every shop, below GM refused, all checked BEFORE any I/O", () => {
  const range = resolveSalesRange({}, TODAY);
  const loaders = [
    (v: typeof gm, loc: string) => loadSalesSummary(v, { locationId: loc, range }),
    (v: typeof gm, loc: string) => loadSalesBreakdown(v, { locationId: loc, range, dimension: "server" }),
    (v: typeof gm, loc: string) => loadSalesCheckPage(v, { locationId: loc, range, filters: {} }),
    (v: typeof gm, loc: string) => loadSalesCheckDetail(v, { locationId: loc, businessDate: "2026-10-06", checkGuid: "c1" }),
    (v: typeof gm, loc: string) => loadSalesCatering(v, { locationId: loc, range }),
    (v: typeof gm, loc: string) => loadSalesEzcaterOrders(v, { locationId: loc, range }),
  ];
  it("below GM (an AGM at level 6, even at their own shop) is refused with no database work", async () => {
    for (const load of loaders) {
      await expect(load(agm, A)).rejects.toMatchObject({ status: 403, code: "role_insufficient" });
    }
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });
  it("a GM asking for another shop is refused before any database work", async () => {
    for (const load of loaders) await expect(load(gm, B)).rejects.toMatchObject({ status: 403, code: "location_forbidden" });
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });
  it("`all`, a non-uuid or a missing shop is never passed to SQL as a wildcard", async () => {
    for (const loc of ["all", "", "not-a-uuid"]) for (const load of loaders) await expect(load(moo, loc)).rejects.toMatchObject({ status: 400 });
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });
  it("a GM reads their own shop; level 8+ reads an unassigned shop", () => {
    expect(() => assertSalesScope(gm, A)).not.toThrow();
    expect(() => assertSalesScope(moo, B)).not.toThrow();
    expect(() => assertSalesScope({ ...moo, level: 9 }, A)).not.toThrow();
  });
});

describe("range windowing: 12 months is twelve-ish bounded statements, two at a time", () => {
  it("every daily call spans <= 31 days, all inside the range, at most 2 in flight", async () => {
    const range = resolveSalesRange({ range: "last12m" }, TODAY);
    const f = fakeClient(() => emptyDaily);
    await loadSalesSummary(moo, { locationId: B, range }, { client: f.client });
    const daily = f.calls.filter((c) => c.fn === "sales_report_daily");
    expect(daily.length).toBeGreaterThanOrEqual(11);
    expect(daily.length).toBeLessThanOrEqual(13);
    for (const c of daily) {
      expect(c.args.p_location_id).toBe(B);
      const days = (Date.parse(String(c.args.p_to)) - Date.parse(String(c.args.p_from))) / 86_400_000 + 1;
      expect(days).toBeLessThanOrEqual(31);
      expect(String(c.args.p_from) >= range.from && String(c.args.p_to) <= range.to).toBe(true);
    }
    expect(f.maxInFlight()).toBeLessThanOrEqual(2);
  });
  it("compare loads the previous window through the same bounded windows", async () => {
    const range = resolveSalesRange({ compare: "true" }, TODAY);
    const f = fakeClient(() => emptyDaily);
    const s = await loadSalesSummary(gm, { locationId: A, range }, { client: f.client });
    expect(f.calls.map((c) => [c.args.p_from, c.args.p_to])).toEqual(expect.arrayContaining([["2026-10-01", "2026-10-07"], ["2026-09-24", "2026-09-30"]]));
    expect(s.previous).not.toBeNull();
  });
  it("an unapplied 0232 surfaces as 503 sales_reads_not_installed, never an empty report", async () => {
    const f = fakeClient(() => Object.assign(new Error("Could not find the function"), { code: "PGRST202" }));
    await expect(loadSalesSummary(gm, { locationId: A, range: resolveSalesRange({}, TODAY) }, { client: f.client }))
      .rejects.toBeInstanceOf(SalesReportError);
    await expect(loadSalesSummary(gm, { locationId: A, range: resolveSalesRange({}, TODAY) }, { client: f.client }))
      .rejects.toMatchObject({ status: 503, code: "sales_reads_not_installed" });
  });
  it("any other read error throws (distinct from empty)", async () => {
    const f = fakeClient(() => new Error("statement timeout"));
    await expect(loadSalesBreakdown(gm, { locationId: A, range: resolveSalesRange({}, TODAY), dimension: "item" }, { client: f.client })).rejects.toThrow(/statement timeout/);
  });
  it("an empty range makes no call", async () => {
    const f = fakeClient(() => emptyDaily);
    const range = resolveSalesRange({ range: "this_month" }, "2026-10-01");
    expect((await loadSalesSummary(gm, { locationId: A, range }, { client: f.client })).buckets).toEqual([]);
    expect(f.calls).toEqual([]);
  });
});

describe("check list keyset paging across windows", () => {
  // 130 checks spread over 90 days; the fake RPC applies the same keyset + limit as 0232.
  const all = Array.from({ length: 130 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 7) - Math.floor(i * 0.7) * 86_400_000).toISOString().slice(0, 10);
    return { business_date: d, check_guid: `chk-${String(i % 7).padStart(2, "0")}-${i}`, amount_cents: 100, units: 1, channel: "dine_in" };
  });
  const sorted = [...all].sort((a, b) => b.business_date.localeCompare(a.business_date) || a.check_guid.localeCompare(b.check_guid));
  const handler = (_fn: string, a: Record<string, unknown>) => sorted.filter((r) => r.business_date >= String(a.p_from) && r.business_date <= String(a.p_to)
    && (a.p_after_date == null || r.business_date < String(a.p_after_date) || (r.business_date === a.p_after_date && r.check_guid > String(a.p_after_check))))
    .slice(0, Number(a.p_limit));
  const range = resolveSalesRange({ range: "last90" }, TODAY);

  it("walks every page with no row skipped or repeated", async () => {
    const f = fakeClient(handler);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const page = await loadSalesCheckPage(gm, { locationId: A, range, filters: {}, cursor }, { client: f.client });
      seen.push(...page.rows.map((r) => r.checkGuid));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    const expected = sorted.filter((r) => r.business_date >= range.from && r.business_date <= range.to).map((r) => r.check_guid);
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(seen.length);
    for (const c of f.calls) expect(Number(c.args.p_limit)).toBeLessThanOrEqual(51);
  });
  it("a tampered or other-context cursor restarts at page one (flagged), never skips", async () => {
    const f = fakeClient(handler);
    const first = await loadSalesCheckPage(gm, { locationId: A, range, filters: {} }, { client: f.client });
    const otherContext = encodeSalesCursor("2026-09-01", "chk-00-1", salesListContext(A, range.from, range.to, { channel: "takeout" }));
    const reset = await loadSalesCheckPage(gm, { locationId: A, range, filters: {}, cursor: otherContext }, { client: f.client });
    expect(reset.cursorReset).toBe(true);
    expect(reset.rows.map((r) => r.checkGuid)).toEqual(first.rows.map((r) => r.checkGuid));
    expect(decodeSalesCursor("%%%garbage", "x", /.*/)).toBeNull();
    expect(decodeSalesCursor(encodeSalesCursor("2026-13-40", "k", "ctx"), "ctx", /.*/)).toBeNull();
  });
  it("filters reach SQL as bound arguments only", async () => {
    const f = fakeClient(() => []);
    await loadSalesCheckPage(gm, { locationId: A, range, filters: { channel: "catering", provider: "", server: "g-1", discount: "Employee Meal", dow: 2, hour: -1 } }, { client: f.client });
    expect(f.calls[0]!.args).toMatchObject({ p_channel: "catering", p_provider: "", p_server: "g-1", p_discount: "Employee Meal", p_dow: 2, p_hour: -1 });
  });
  it("check detail refuses a malformed date or check id without a call", async () => {
    const f = fakeClient(() => null);
    expect(await loadSalesCheckDetail(gm, { locationId: A, businessDate: "2026-02-30", checkGuid: "c1" }, { client: f.client })).toBeNull();
    expect(await loadSalesCheckDetail(gm, { locationId: A, businessDate: "2026-10-06", checkGuid: "x'or 1=1" }, { client: f.client })).toBeNull();
    expect(f.calls).toEqual([]);
  });
});

describe("mapBounded", () => {
  it("keeps order and the concurrency bound", async () => {
    let live = 0; let peak = 0;
    const out = await mapBounded([1, 2, 3, 4, 5], 2, async (x) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 2)); live--; return x * 2; });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });
});
