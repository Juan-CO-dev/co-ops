// Item 9 PR 9b, fix round 5 (review ITEM9B-r5 P2): an EMPTY range stays empty. Failing-first.
// On 2026-10-08, `range=custom&from=2026-10-08&to=2026-10-08` (today only) or a future-only request resolves to
// `empty: true` with its dates normalized to yesterday. Every link the page builds (range controls, tabs, the
// report nav, the shop tabs, both exports) used to rebuild the query from those NORMALIZED dates, so the next click
// asked for yesterday — a populated neighbouring day. The query a link carries now re-resolves to the SAME range
// (`businessRangeQuery`), and the export of an empty range is an explicit "no closed days in this range" file.
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

import { GET } from "@/app/api/reports/export/route";
import { BusinessRangeControls } from "@/components/reports-business/BusinessParts";
import { BUSINESS_EXPORT_TABS } from "@/lib/report-export-shared";
import { businessRangeQuery, resolveBusinessRange, type BusinessRange } from "@/lib/business-report-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { A, fakeClient } from "./helpers/business-report-fake";

const TODAY = "2026-10-08";
const ROOT = path.resolve(__dirname, "..");
const src = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const same = (a: BusinessRange, b: BusinessRange) => expect(b).toEqual(a);

describe("the query a link carries re-resolves to the SAME range", () => {
  const cases: Array<Record<string, string | undefined>> = [
    { range: "custom", from: TODAY, to: TODAY },                 // today only
    { range: "custom", from: "2026-10-20", to: "2026-10-25" },   // future only
    { range: "custom", from: "2026-10-20" },                     // future from, no to
    { from: TODAY, to: TODAY },                                  // custom implied by the dates
    { range: "custom", from: "2026-10-05", to: "2026-10-01" },   // from after to
    { range: "custom", from: "2026-10-01", to: "2026-10-07" },
    { range: "custom", from: "2026-09-01", to: "2026-10-30" },   // to clipped to yesterday
    { range: "custom", from: "2025-01-01", to: "2026-10-07" },   // shortened
    { range: "custom", from: "nope", to: "2026-10-03" },
    { range: "yesterday" }, { range: "last7" }, { range: "last30" }, { range: "last90" }, {},
  ];
  for (const p of cases) {
    it(JSON.stringify(p), () => {
      const r = resolveBusinessRange(p, TODAY);
      const q = businessRangeQuery(r, p);
      same(r, resolveBusinessRange(q, TODAY));
      // And again: a link built from a link's own range is the same link.
      expect(businessRangeQuery(resolveBusinessRange(q, TODAY), q)).toEqual(q);
    });
  }
  it("today only and future only stay EMPTY, with the requested bounds, never yesterday", () => {
    const today = resolveBusinessRange({ range: "custom", from: TODAY, to: TODAY }, TODAY);
    expect(today.empty).toBe(true);
    expect(businessRangeQuery(today, { range: "custom", from: TODAY, to: TODAY })).toEqual({ range: "custom", from: TODAY, to: TODAY });
    const future = resolveBusinessRange({ range: "custom", from: "2026-10-20", to: "2026-10-25" }, TODAY);
    expect(businessRangeQuery(future, { from: "2026-10-20", to: "2026-10-25" })).toEqual({ range: "custom", from: "2026-10-20", to: "2026-10-25" });
  });
});

describe("the range controls show what was asked", () => {
  it("an empty custom range keeps its requested dates in the form (submitting it again stays empty)", () => {
    const p = { range: "custom", from: TODAY, to: TODAY };
    const range = resolveBusinessRange(p, TODAY);
    const html = renderToStaticMarkup(createElement(BusinessRangeControls, { range, query: businessRangeQuery(range, p), locationId: A, tab: "hours", language: "en" }));
    expect(html).toContain(`name="from" value="${TODAY}"`);
    expect(html).toContain(`name="to" value="${TODAY}"`);
    expect(html).not.toContain("2026-10-07");
  });
});

describe("the page builds every link from that query", () => {
  const page = src("app/(authed)/reports/business/page.tsx");
  it("no link is rebuilt from the normalized dates", () => {
    expect(page).toContain("businessRangeQuery(range, params)");
    expect(page).not.toMatch(/from: range\.from/);
    expect(page).not.toMatch(/to: range\.to/);
    // The range controls get the same query; the export links and the tabs ride on `context`, built from it.
    expect(page).toMatch(/<BusinessRangeControls[^>]*query=\{rangeQuery\}/);
    expect(page).toMatch(/const context: Params = \{ \.\.\.rangeQuery/);
  });
  it("the export re-resolves the range the same way and never loads a neighbour for an empty one", () => {
    const lib = src("lib/report-export.ts");
    expect(lib).toContain("businessEmptyRangeRows");
  });
});

// ── The export ──────────────────────────────────────────────────────────────────────────────────

function session(role: string, level: number, locations: string[]) {
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: "viewer-1", role, name: "Viewer One", language: "en" }, role, level, locations, session: {},
  } as never);
}
let rpcs = 0;
function wire() {
  const biz = fakeClient();
  const shopQ = { select: () => shopQ, eq: () => shopQ, maybeSingle: async () => ({ data: { id: A, code: "MEP", name: "Capitol Hill" }, error: null }) };
  vi.mocked(getServiceRoleClient).mockImplementation(() => ({
    rpc: (...a: unknown[]) => { rpcs++; return (biz.client as { rpc: (...x: unknown[]) => unknown }).rpc(...a); },
    from: (t: string) => (t === "locations" ? shopQ : (biz.client as { from: (x: string) => unknown }).from(t)),
  }) as never);
}
const get = (q: string) => GET(new NextRequest(`https://example.test/api/reports/export?family=business&${q}`));
const lines = async (r: Response) => (await r.text()).replace(/^﻿/, "").trim().split("\r\n");

beforeEach(() => {
  vi.clearAllMocks();
  rpcs = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T16:00:00Z"));
  vi.stubEnv("BUSINESS_REPORT", "1"); vi.stubEnv("FACT_LAYER", "1"); vi.stubEnv("FACT_LAYER_LABOR", "1");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("the export of an empty range is an explicit 'no closed days' file, never a neighbouring range", () => {
  for (const [label, q] of [["today only", `from=${TODAY}&to=${TODAY}`], ["future only", "from=2026-10-20&to=2026-10-25"]] as const) {
    for (const tab of BUSINESS_EXPORT_TABS) {
      it(`${label}, ${tab}`, async () => {
        session("owner", 9, []); wire();
        const r = await get(`location=${A}&format=csv&tab=${tab}&range=custom&${q}`);
        expect(r.status).toBe(200);
        const disposition = r.headers.get("content-disposition")!;
        expect(disposition).not.toContain("2026-10-07");
        const [, from, to] = /_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.csv/.exec(disposition)!;
        expect(`from=${from}&to=${to}`).toBe(q);
        const text = await lines(r);
        expect(text[0]).toBe((en as Record<string, string>)["reports.business.export.no_finished_days"]);
        const header = text[1]!.split(",");
        const body = text.slice(2).map((l) => l.split(","));
        expect(body).toHaveLength(1);
        expect(body[0]![header.indexOf("row_type")]).toBe("notice");
        expect(body[0]![header.indexOf("status")]).toBe("no_finished_days");
        expect(text.join("\n")).not.toContain("2026-10-07");
        expect(rpcs).toBe(0); // nothing from a neighbouring range was even read
      });
    }
  }
  it("the sentence exists in en and es", () => {
    expect((en as Record<string, string>)["reports.business.export.no_finished_days"]).toMatch(/no closed days/i);
    expect((es as Record<string, string>)["reports.business.export.no_finished_days"]).toBeTruthy();
  });
  it("the gates still run first: an AGM is 403 on an empty range too", async () => {
    session("agm", 6, [A]); wire();
    const r = await get(`location=${A}&format=csv&range=custom&from=${TODAY}&to=${TODAY}`);
    expect(r.status).toBe(403);
  });
});
