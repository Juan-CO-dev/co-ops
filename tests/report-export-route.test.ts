import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
// The search corpus reads the database; the stand-in matches on the report id (the filter PATH is what is under test).
vi.mock("@/lib/reports-search", () => ({
  buildSearchCorpus: vi.fn(async () => new Map()),
  searchReport: vi.fn((item: { id: string }, _label: string, _corpus: unknown, q: string) => ({ matched: item.id.includes(q), snippet: null })),
}));
vi.mock("@/lib/reports-hub", async (orig) => ({
  ...(await orig<typeof import("@/lib/reports-hub")>()),
  listReports: vi.fn(),
  loadReportDetail: vi.fn(),
}));

import { GET } from "@/app/api/reports/export/route";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listReports, loadReportDetail, type ReportListItem } from "@/lib/reports-hub";
import { operationsFilters } from "@/lib/report-export";
import { CSV_BOM } from "@/lib/report-export-shared";

const SHOP_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const SHOP_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const SHOPS: Record<string, { id: string; code: string; name: string }> = {
  [SHOP_A]: { id: SHOP_A, code: "MEP", name: "Capitol Hill" },
  [SHOP_B]: { id: SHOP_B, code: "EM", name: "P Street" },
};

function session(role: string, level: number, locations: string[]) {
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: "viewer-1", role, name: "Viewer One", language: "en" }, role, level, locations, session: {},
  } as never);
}

/** Only the shop-name lookup touches the client; every report read goes through the mocked loaders. */
function fakeClient() {
  const chain = { id: "" } as { id: string };
  const q = {
    select: () => q,
    eq: (_c: string, v: string) => { chain.id = v; return q; },
    maybeSingle: async () => ({ data: SHOPS[chain.id] ?? null, error: null }),
  };
  return { from: (table: string) => { if (table !== "locations") throw new Error(`unexpected read: ${table}`); return q; } };
}

const get = (query: string) => GET(new NextRequest(`https://example.test/api/reports/export?${query}`));
const items = (locationId: string): ReportListItem[] => [
  { type: "closing", id: "k1", date: "2026-10-05", locationId, submitterName: "Ana", status: "confirmed",
    signalSummary: { underPar: 2, overPar: 0, skipped: 1, tempFlags: 0, cashOverShortCents: null } },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getServiceRoleClient).mockReturnValue(fakeClient() as never);
  vi.mocked(listReports).mockImplementation(async (_sb, f) => items(f.locationId));
});

describe("refusals happen before any report read", () => {
  it("unknown family / format → 400", async () => {
    session("gm", 7, [SHOP_A]);
    expect((await get(`family=payroll&format=csv&location=${SHOP_A}`)).status).toBe(400);
    expect((await get(`family=operations&format=xlsx&location=${SHOP_A}`)).status).toBe(400);
  });

  it("a GM asking for ANOTHER shop is refused (403) and nothing is read", async () => {
    session("gm", 7, [SHOP_A]);
    const res = await get(`family=operations&format=csv&location=${SHOP_B}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "location_forbidden" });
    expect(getServiceRoleClient).not.toHaveBeenCalled();
    expect(listReports).not.toHaveBeenCalled();
  });

  it("location=all is refused: one shop per file", async () => {
    session("owner", 9, []);
    const res = await get("family=operations&format=csv&location=all");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "one_shop_at_a_time" });
  });

  it("cash below key holder (level 3) is refused; team below AGM is refused", async () => {
    session("employee", 3, [SHOP_A]);
    expect((await get(`family=cash&format=csv&location=${SHOP_A}`)).status).toBe(403);
    session("shift_lead", 5, [SHOP_A]);
    expect((await get(`family=team&format=csv&location=${SHOP_A}`)).status).toBe(403);
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });
});

describe("scope: a GM gets their shop, level 8+ gets every shop", () => {
  it("GM, own shop: the page's loader runs with the GM's own viewer and shop", async () => {
    session("gm", 7, [SHOP_A]);
    const res = await get(`family=operations&format=csv&location=${SHOP_A}&range=custom&from=2026-10-01&to=2026-10-06`);
    expect(res.status).toBe(200);
    expect(vi.mocked(listReports).mock.calls[0]![1]).toMatchObject({
      viewer: { userId: "viewer-1", level: 7, locations: [SHOP_A] }, locationId: SHOP_A, dateFrom: "2026-10-01", dateTo: "2026-10-06",
    });
  });

  it("level 8 (MoO) may export a shop it holds no membership at", async () => {
    session("moo", 8, []);
    const res = await get(`family=operations&format=csv&location=${SHOP_B}`);
    expect(res.status).toBe(200);
    expect(vi.mocked(listReports).mock.calls[0]![1]).toMatchObject({ locationId: SHOP_B });
    expect(await res.text()).toContain(",EM,P Street,closing,k1,");
  });
});

describe("the export matches the screen", () => {
  it("the operations filters are the page's: cash type and cash signals are ignored below level 4", () => {
    expect(operationsFilters({ type: "cash", sf_cashOver: "true", sf_underPar: "true" }, 3)).toEqual({ types: undefined, signals: { underPar: true } });
    expect(operationsFilters({ type: "cash", sf_cashOver: "true" }, 4)).toEqual({ types: ["cash"], signals: { cashOver: true } });
    expect(operationsFilters({ type: "nonsense" }, 9)).toEqual({ types: undefined, signals: undefined });
  });

  it("the rows are exactly the loader's rows (no extra read), with the BOM, the filename and the audit row", async () => {
    session("gm", 7, [SHOP_A]);
    const res = await get(`family=operations&format=csv&location=${SHOP_A}&range=custom&from=2026-10-01&to=2026-10-06&type=closing&sf_underPar=true`);
    expect(vi.mocked(listReports).mock.calls[0]![1]).toMatchObject({ types: ["closing"], signalFilters: { underPar: true } });
    const bytes = Buffer.from(await res.arrayBuffer());
    // The BOM must be on the WIRE (Response.text() would silently strip it).
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = bytes.toString("utf8");
    expect(body.startsWith(CSV_BOM)).toBe(true);
    expect(body.trim().split("\r\n")).toHaveLength(2);
    expect(body).toContain("2026-10-05,MEP,Capitol Hill,closing,k1,confirmed,Ana,2,0,1,0,,USD");
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="operations_MEP_2026-10-01_2026-10-06.csv"');
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "report.export", actorId: "viewer-1",
      metadata: expect.objectContaining({ family: "operations", format: "csv", rows: 1, location_id: SHOP_A, from: "2026-10-01", to: "2026-10-06" }),
    }));
  });

  it("cash (level 4+): one row per cash report through the detail loader, which keeps its own redactions", async () => {
    session("key_holder", 4, [SHOP_A]);
    vi.mocked(listReports).mockResolvedValue([{ type: "cash", id: "c1", date: "2026-10-05", locationId: SHOP_A, submitterName: "Ana", status: "ok" }]);
    vi.mocked(loadReportDetail).mockResolvedValue({
      kind: "cash", date: "2026-10-05", locationId: SHOP_A, projectedCents: 50000, drawerTotalCents: 70000, floatCents: 20000,
      depositCents: 50000, overShortCents: 0, cashTipsCents: 900, countMethod: "hand", onShift: [], signedByName: "Ana",
      signedAt: "2026-10-06T02:00:00Z", overShortNote: null, signals: {} as never,
    });
    const res = await get(`family=cash&format=csv&location=${SHOP_A}`);
    expect(res.status).toBe(200);
    expect(vi.mocked(listReports).mock.calls[0]![1]).toMatchObject({ types: ["cash"] });
    expect(vi.mocked(loadReportDetail).mock.calls[0]![1]).toMatchObject({ type: "cash", id: "c1", locationId: SHOP_A, viewer: { level: 4 } });
    expect(await res.text()).toContain("2026-10-05,MEP,Capitol Hill,c1,500.00,700.00,200.00,500.00,0.00,9.00,hand,,Ana,");
  });

  it("PDF: a real document with the PDF content type", async () => {
    session("gm", 7, [SHOP_A]);
    const res = await get(`family=operations&format=pdf&location=${SHOP_A}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("sales: not_yet_available, never zeros", async () => {
    session("gm", 7, [SHOP_A]);
    const body = await (await get(`family=sales&format=csv&location=${SHOP_A}`)).text();
    expect(body).toContain(",MEP,Capitol Hill,not_yet_available,");
    expect(body).not.toContain("0.00");
  });
});

it("next.config keeps pdfkit external (its font files must ship with the function)", () => {
  expect(readFileSync("next.config.ts", "utf8")).toMatch(/serverExternalPackages:\s*\[[^\]]*"pdfkit"/);
});

describe("cash export = the cash screen (Astra P2)", () => {
  const cashItems = (locationId: string): ReportListItem[] => ["c-short-1", "c-over-2", "c-short-3"].map((id, i) => ({
    type: "cash", id, date: `2026-10-0${i + 1}`, locationId, submitterName: "Ana", status: "flags",
    signalSummary: { underPar: 0, overPar: 0, skipped: 0, tempFlags: 0, cashOverShortCents: id.includes("short") ? -100 : 100 },
  }));
  const detail = (id: string) => ({
    kind: "cash" as const, date: "2026-10-01", locationId: SHOP_A, projectedCents: 0, drawerTotalCents: 0, floatCents: 0, depositCents: 0,
    overShortCents: id.includes("short") ? -100 : 100, cashTipsCents: 0, countMethod: "hand" as const, onShift: [], signedByName: null,
    signedAt: "2026-10-02T00:00:00Z", overShortNote: null, signals: {} as never,
  });
  const ids = (csv: string, col: number) => csv.replace(CSV_BOM, "").trim().split("\r\n").slice(1).map((l) => l.split(",")[col]);

  it("the sf_* toggles and the q search reach the cash loader; the page's row ids equal the export's", async () => {
    session("key_holder", 4, [SHOP_A]);
    // listReports applies the signal filter (as the real loader does); the stand-in honours cashShort.
    vi.mocked(listReports).mockImplementation(async (_sb, f) => cashItems(f.locationId)
      .filter((i) => !f.signalFilters?.cashShort || (i.signalSummary?.cashOverShortCents ?? 0) < 0));
    vi.mocked(loadReportDetail).mockImplementation(async (_sb, a) => detail(a.id));
    const query = `location=${SHOP_A}&range=custom&from=2026-10-01&to=2026-10-03&sf_cashShort=true&q=3`;
    // The page: the operations list with type=cash (what /reports/operations renders for this URL).
    const page = await (await get(`family=operations&format=csv&type=cash&${query}`)).text();
    const cash = await (await get(`family=cash&format=csv&${query}`)).text();
    expect(vi.mocked(listReports).mock.calls[1]![1]).toMatchObject({ types: ["cash"], signalFilters: { cashShort: true } });
    expect(ids(page, 4)).toEqual(["c-short-3"]);
    expect(ids(cash, 3)).toEqual(ids(page, 4));
    expect(vi.mocked(loadReportDetail).mock.calls.map((c) => c[1].id)).toEqual(["c-short-3"]);
  });

  it("below key holder the cash toggles are ignored exactly as on the screen", () => {
    expect(operationsFilters({ type: "cash", sf_cashShort: "true" }, 3).signals).toBeUndefined();
  });
});
