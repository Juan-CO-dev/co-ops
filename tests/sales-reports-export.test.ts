import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/midshift-shared", async (orig) => ({ ...(await orig<typeof import("@/lib/midshift-shared")>()), operationalNow: () => ({ date: "2026-10-08" }) }));

import { GET } from "@/app/api/reports/export/route";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { SALES_EXPORT_COLUMNS, CSV_BOM, NOT_YET_AVAILABLE } from "@/lib/report-export-shared";
import { loadSalesSummary, resolveSalesRange } from "@/lib/sales-reports";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const SHOPS: Record<string, { id: string; code: string; name: string }> = { [A]: { id: A, code: "MEP", name: "Capitol Hill" }, [B]: { id: B, code: "EM", name: "P Street" } };

function session(level: number, locations: string[]) {
  vi.mocked(requireSession).mockResolvedValue({ user: { id: "viewer", name: "Viewer", language: "en" }, role: level >= 8 ? "moo" : level === 7 ? "gm" : "agm", level, locations, session: {} } as never);
}
let rpc: (fn: string, args: Record<string, unknown>) => unknown;
const calls: string[] = [];
function client() {
  const chain = { id: "" };
  const q = { select: () => q, eq: (_c: string, v: string) => { chain.id = v; return q; }, maybeSingle: async () => ({ data: SHOPS[chain.id] ?? null, error: null }) };
  return {
    from: (t: string) => { if (t !== "locations") throw new Error(`unexpected read ${t}`); return q; },
    rpc: async (fn: string, args: Record<string, unknown>) => { calls.push(fn); const out = rpc(fn, args); return out instanceof Error ? { data: null, error: { message: out.message, code: (out as Error & { code?: string }).code } } : { data: out, error: null }; },
  };
}
const daily = (a: Record<string, unknown>) => ({
  classes: [
    { business_date: a.p_to, sale_class: "sale", checks: 4, amount_cents: 8000, tax_cents: 480, amount_missing: 0 },
    { business_date: a.p_to, sale_class: "gift_card", checks: 1, amount_cents: 5000, tax_cents: 0, amount_missing: 0 },
    { business_date: a.p_to, sale_class: "ezcater_linked", checks: 1, amount_cents: 30000, tax_cents: 0, amount_missing: 0 },
  ],
  tips: [], discounts: [{ business_date: a.p_to, count: 1, cents: 300 }], refunds: [], captured_days: [a.p_to],
  ezcater: [{ business_date: a.p_to, orders: 1, subtotal_cents: 28000, amount_missing: 0 }],
});
const get = (q: string) => GET(new NextRequest(`https://example.test/api/reports/export?${q}`));
const lines = async (res: Response) => (await res.text()).replace(CSV_BOM, "").trim().split("\r\n");

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  vi.mocked(getServiceRoleClient).mockImplementation(() => client() as never);
  rpc = (fn, a) => (fn === "sales_report_daily" ? daily(a) : []);
});

describe("sales export: the page's gates, before any read", () => {
  it("below GM is refused (403) with no read", async () => {
    session(6, [A]);
    const res = await get(`family=sales&format=csv&location=${A}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "role_insufficient" });
    expect(calls).toEqual([]);
  });
  it("a GM asking for another shop is refused (403)", async () => {
    session(7, [A]);
    expect((await get(`family=sales&format=csv&location=${B}`)).status).toBe(403);
    expect(calls).toEqual([]);
  });
  it("level 8 exports an unassigned shop; `all` is one shop at a time", async () => {
    session(8, []);
    expect((await get(`family=sales&format=csv&location=${B}`)).status).toBe(200);
    expect((await get("family=sales&format=csv&location=all")).status).toBe(400);
  });
});

describe("sales export = the screen", () => {
  it("summary: the header is the contract and the total row equals the page loader's totals", async () => {
    session(7, [A]);
    const res = await get(`family=sales&format=csv&location=${A}&range=last7`);
    expect(res.headers.get("content-disposition")).toContain("sales_MEP_2026-10-01_2026-10-07.csv");
    const out = await lines(res);
    expect(out[0]).toBe(SALES_EXPORT_COLUMNS.summary.map((c) => c.key).join(","));
    const header = out[0]!.split(",");
    const total = out[out.length - 1]!.split(",");
    const cell = (k: string) => total[header.indexOf(k)];
    const screen = await loadSalesSummary({ userId: "viewer", level: 7, locations: [A] }, { locationId: A, range: resolveSalesRange({ range: "last7" }, "2026-10-08") }, { client: client() as never });
    expect(cell("row_type")).toBe("total");
    expect(cell("toast_net_sales")).toBe((screen.totals.toastNetCents / 100).toFixed(2));
    expect(cell("total_sales")).toBe((screen.totals.totalCents / 100).toFixed(2));
    expect(cell("gift_cards_excluded")).toBe("50.00");
    expect(cell("ezcater_linked_toast_excluded")).toBe("300.00");
    expect(cell("ezcater_sales")).toBe("280.00");
    expect(cell("total_sales")).toBe("360.00"); // 80 Toast + 280 ezCater; the 300 linked ring and the 50 gift card are not added
  });
  it("discounts export one row per NAME", async () => {
    session(7, [A]);
    rpc = (fn) => fn === "sales_report_breakdown" ? [{ key: "Employee Meal", label: "Employee Meal", count: 2, checks: 2, cents: 1000 }, { key: "Manager Comp", label: "Manager Comp", count: 1, checks: 1, cents: 700 }] : [];
    const out = await lines(await get(`family=sales&format=csv&location=${A}&view=discounts`));
    expect(out[0]).toBe(SALES_EXPORT_COLUMNS.discounts.map((c) => c.key).join(","));
    expect(out.slice(1).map((l) => l.split(",")[4])).toEqual(["Employee Meal", "Manager Comp"]);
  });
  it("checks export pages through EVERY page at the same filters", async () => {
    session(7, [A]);
    const rows = Array.from({ length: 230 }, (_, i) => ({ business_date: "2026-10-06", check_guid: `c-${String(i).padStart(4, "0")}`, amount_cents: 100, units: 1, channel: "takeout" }));
    rpc = (fn, a) => fn === "sales_report_check_page"
      ? rows.filter((r) => r.business_date >= String(a.p_from) && r.business_date <= String(a.p_to) && (a.p_after_check == null || r.check_guid > String(a.p_after_check))).slice(0, Number(a.p_limit))
      : [];
    const res = await get(`family=sales&format=csv&location=${A}&view=checks&channel=takeout`);
    expect(res.headers.get("content-disposition")).toContain("sales-checks_MEP_");
    const out = await lines(res);
    expect(out.length - 1).toBe(230);
  });
  it("an export past the row cap refuses (413) instead of truncating", async () => {
    session(7, [A]);
    let n = 0;
    rpc = (fn, a) => fn === "sales_report_check_page" ? Array.from({ length: Number(a.p_limit) }, () => ({ business_date: "2026-10-06", check_guid: `c-${String(n++).padStart(8, "0")}`, units: 0 })) : [];
    expect((await get(`family=sales&format=csv&location=${A}&view=checks`)).status).toBe(413);
  });
  it("0232 not applied: the summary says not_yet_available with empty money, never zeros", async () => {
    session(7, [A]);
    rpc = () => Object.assign(new Error("missing"), { code: "PGRST202" });
    const out = await lines(await get(`family=sales&format=csv&location=${A}`));
    expect(out).toHaveLength(2);
    expect(out[1]).toContain(NOT_YET_AVAILABLE);
    expect(out[1]).not.toMatch(/,0\.00,/);
  });
});

describe("no PII, no card data, no free text in any Sales export", () => {
  it("no column of any view names a customer, contact, card, note or comment", () => {
    for (const [view, cols] of Object.entries(SALES_EXPORT_COLUMNS)) {
      for (const c of cols) expect(c.key, `${view}.${c.key}`).not.toMatch(/customer|contact|email|phone|address|(^|_)card_(number|last|brand|type)|last4|note|comment|instruction|reason/);
    }
  });
});
