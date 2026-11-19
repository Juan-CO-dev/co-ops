// Item 9 PR 9b, fix round 6 (review ITEM9B-r6 P2): the custom-range form never shows a date the person did not
// give. Failing-first. On 2026-11-18, `?range=custom&to=2026-10-01` resolved `from` to a DEFAULT (2026-11-11), found
// the range empty, normalized both dates to 2026-10-01 and the form showed 2026-10-01 in BOTH boxes — Apply then
// loaded October 1's figures. The class is closed by ONE pure parse (`parseBusinessRangeRequest`) that the
// resolver, the form, every link and both exports read; this file proves every surface agrees on every row.
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
import { BUSINESS_EMPTY_KEY, BusinessRangeControls } from "@/components/reports-business/BusinessParts";
import {
  BUSINESS_HISTORY_FLOOR, BUSINESS_RANGE_EMPTY_REASONS, BUSINESS_REPORT_MAX_DAYS, parseBusinessRangeRequest,
  type BusinessRangeRequest,
} from "@/lib/business-report-shared";
import { shiftReportDate } from "@/lib/report-range";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { A, fakeClient } from "./helpers/business-report-fake";

const TODAY = "2026-10-08";
const YESTERDAY = "2026-10-07";
const ROOT = path.resolve(__dirname, "..");
const src = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
type P = Record<string, string | undefined>;

type Expect =
  | { kind: "empty"; reason: (typeof BUSINESS_RANGE_EMPTY_REASONS)[number]; form: { from: string; to: string } }
  | { kind: "range"; from: string; to: string; shortened: boolean; form: { from: string; to: string } };

const beforeFloor = shiftReportDate(BUSINESS_HISTORY_FLOOR, -10);
const ROWS: Array<[string, P, Expect]> = [
  // The reviewer's scenario: an older `to`, no `from`. Never a default `from`, never `to` copied into it.
  ["missing from", { range: "custom", to: "2026-10-01" }, { kind: "empty", reason: "dates_missing", form: { from: "", to: "2026-10-01" } }],
  ["missing from (custom implied)", { to: "2026-10-01" }, { kind: "empty", reason: "dates_missing", form: { from: "", to: "2026-10-01" } }],
  ["missing to", { range: "custom", from: "2026-10-01" }, { kind: "empty", reason: "dates_missing", form: { from: "2026-10-01", to: "" } }],
  ["both missing", { range: "custom" }, { kind: "empty", reason: "dates_missing", form: { from: "", to: "" } }],
  ["both blank (a submitted empty form)", { range: "custom", from: "", to: "" }, { kind: "empty", reason: "dates_missing", form: { from: "", to: "" } }],
  ["from after to", { range: "custom", from: "2026-10-05", to: "2026-10-01" }, { kind: "empty", reason: "from_after_to", form: { from: "2026-10-05", to: "2026-10-01" } }],
  ["to before the history floor", { range: "custom", from: shiftReportDate(beforeFloor, -6), to: beforeFloor },
    { kind: "range", from: shiftReportDate(beforeFloor, -6), to: beforeFloor, shortened: false, form: { from: shiftReportDate(beforeFloor, -6), to: beforeFloor } }],
  ["to in the future", { range: "custom", from: "2026-10-01", to: "2026-10-30" },
    { kind: "range", from: "2026-10-01", to: YESTERDAY, shortened: false, form: { from: "2026-10-01", to: "2026-10-30" } }],
  ["today only", { range: "custom", from: TODAY, to: TODAY }, { kind: "empty", reason: "no_finished_days", form: { from: TODAY, to: TODAY } }],
  ["future only", { range: "custom", from: "2026-10-20", to: "2026-10-25" }, { kind: "empty", reason: "no_finished_days", form: { from: "2026-10-20", to: "2026-10-25" } }],
  ["more than BUSINESS_REPORT_MAX_DAYS", { range: "custom", from: "2025-01-01", to: YESTERDAY },
    { kind: "range", from: shiftReportDate(YESTERDAY, -(BUSINESS_REPORT_MAX_DAYS - 1)), to: YESTERDAY, shortened: true, form: { from: "2025-01-01", to: YESTERDAY } }],
  ["malformed from", { range: "custom", from: "nope", to: "2026-10-03" }, { kind: "empty", reason: "dates_missing", form: { from: "", to: "2026-10-03" } }],
  ["malformed to (impossible date)", { range: "custom", from: "2026-10-01", to: "2026-02-30" }, { kind: "empty", reason: "dates_missing", form: { from: "2026-10-01", to: "" } }],
  ["malformed both", { range: "custom", from: "2026-13-01", to: "10/03/2026" }, { kind: "empty", reason: "dates_missing", form: { from: "", to: "" } }],
  ["a plain week", { range: "custom", from: "2026-10-01", to: YESTERDAY }, { kind: "range", from: "2026-10-01", to: YESTERDAY, shortened: false, form: { from: "2026-10-01", to: YESTERDAY } }],
  ["preset last7", { range: "last7" }, { kind: "range", from: "2026-10-01", to: YESTERDAY, shortened: false, form: { from: "2026-10-01", to: YESTERDAY } }],
  ["preset yesterday (stray dates ignored)", { range: "yesterday", from: "2026-01-01", to: "2026-01-02" }, { kind: "range", from: YESTERDAY, to: YESTERDAY, shortened: false, form: { from: YESTERDAY, to: YESTERDAY } }],
  ["no params", {}, { kind: "range", from: "2026-10-01", to: YESTERDAY, shortened: false, form: { from: "2026-10-01", to: YESTERDAY } }],
];

/** What the browser submits for the rendered form: the selected range and both date boxes AS SHOWN. */
function submitRenderedForm(request: BusinessRangeRequest): P {
  const html = renderToStaticMarkup(createElement(BusinessRangeControls, { request, locationId: A, tab: "overview", language: "en" }));
  const input = (name: string) => {
    const tag = new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0];
    expect(tag, `the ${name} box is rendered`).toBeTruthy();
    return /\svalue="([^"]*)"/.exec(tag!)?.[1] ?? "";
  };
  const selected = /<option value="([^"]+)" selected="">/.exec(html)?.[1];
  expect(selected).toBeTruthy();
  return { location: A, tab: "overview", range: selected, from: input("from"), to: input("to") };
}
const sameRequest = (a: BusinessRangeRequest, b: BusinessRangeRequest) => expect(b).toEqual(a);

describe("ONE parse: every row, every surface", () => {
  for (const [label, params, want] of ROWS) {
    describe(label, () => {
      const request = parseBusinessRangeRequest(params, TODAY);
      it("parses to the expected request", () => {
        expect(request.kind).toBe(want.kind);
        expect(request.form).toEqual(want.form);
        if (want.kind === "empty") expect(request.kind === "empty" && request.reason).toBe(want.reason);
        else {
          expect(request.kind).toBe("range");
          if (request.kind === "range") expect(request.range).toMatchObject({ from: want.from, to: want.to, shortened: want.shortened, empty: false });
        }
      });
      it("the form shows only what was asked (or the preset's own dates), and Apply re-asks the SAME request", () => {
        const submitted = submitRenderedForm(request);
        expect({ from: submitted.from, to: submitted.to }).toEqual(want.form);
        sameRequest(request, parseBusinessRangeRequest(submitted, TODAY));
      });
      it("every link (the query) re-parses to the SAME request, twice over", () => {
        const again = parseBusinessRangeRequest(request.query, TODAY);
        sameRequest(request, again);
        expect(parseBusinessRangeRequest(again.query, TODAY).query).toEqual(request.query);
      });
      it("no surface ever shows a date the person did not give in a custom request", () => {
        if (request.query.range !== "custom") return;
        const given = new Set([params.from, params.to].filter((d): d is string => !!d));
        for (const d of [request.form.from, request.form.to, request.query.from, request.query.to]) if (d) expect(given.has(d)).toBe(true);
      });
    });
  }
  it("every reason has its page sentence in en and es", () => {
    for (const reason of BUSINESS_RANGE_EMPTY_REASONS) {
      expect((en as Record<string, string>)[BUSINESS_EMPTY_KEY[reason]]).toBeTruthy();
      expect((es as Record<string, string>)[BUSINESS_EMPTY_KEY[reason]]).toBeTruthy();
    }
    expect((es as Record<string, string>)["reports.business.export.from_after_to"]).toBeTruthy();
  });
});

describe("the page and the export read only the one parse", () => {
  it("the page", () => {
    const page = src("app/(authed)/reports/business/page.tsx");
    expect(page).toContain("parseBusinessRangeRequest(params, today)");
    expect(page).not.toMatch(/resolveBusinessRange\(params/);
    expect(page).toMatch(/<BusinessRangeControls request=\{request\}/);
    expect(page).toMatch(/const context: Params = \{ \.\.\.request\.query/);
  });
  it("the form takes no range and names no fallback date", () => {
    const parts = src("components/reports-business/BusinessParts.tsx");
    expect(parts).toContain("defaultValue={request.form.from}");
    expect(parts).toContain("defaultValue={request.form.to}");
    expect(parts).not.toMatch(/\?\? range\.(from|to)/);
  });
  it("the export", () => {
    const lib = src("lib/report-export.ts");
    expect(lib).toContain("parseBusinessRangeRequest(params, today)");
    expect(lib).not.toMatch(/resolveBusinessRange\(params/);
  });
});

// ── Both exports, every row ─────────────────────────────────────────────────────────────────────

let rpcs = 0;
function wire() {
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: "viewer-1", role: "owner", name: "Viewer One", language: "en" }, role: "owner", level: 9, locations: [], session: {},
  } as never);
  const biz = fakeClient();
  const shopQ = { select: () => shopQ, eq: () => shopQ, maybeSingle: async () => ({ data: { id: A, code: "MEP", name: "Capitol Hill" }, error: null }) };
  vi.mocked(getServiceRoleClient).mockImplementation(() => ({
    rpc: (...a: unknown[]) => { rpcs++; return (biz.client as { rpc: (...x: unknown[]) => unknown }).rpc(...a); },
    from: (t: string) => (t === "locations" ? shopQ : (biz.client as { from: (x: string) => unknown }).from(t)),
  }) as never);
}
beforeEach(() => {
  vi.clearAllMocks();
  rpcs = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T16:00:00Z"));
  vi.stubEnv("BUSINESS_REPORT", "1"); vi.stubEnv("FACT_LAYER", "1"); vi.stubEnv("FACT_LAYER_LABOR", "1");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("CSV and PDF agree with the page on every row", () => {
  for (const [label, params, want] of ROWS) {
    for (const format of ["csv", "pdf"] as const) {
      it(`${label}, ${format}`, async () => {
        wire();
        const request = parseBusinessRangeRequest(params, TODAY);
        // The export link the page renders carries exactly `request.query`.
        const q = new URLSearchParams({ location: A, format, tab: "overview",...request.query } as Record<string, string>);
        const r = await GET(new NextRequest(`https://example.test/api/reports/export?family=business&${q}`));
        if (want.kind === "empty" && want.reason === "dates_missing") {
          expect(r.status).toBe(400);
          expect(rpcs).toBe(0);
          return;
        }
        expect(r.status).toBe(200);
        const [, from, to] = new RegExp(`_(\\d{4}-\\d{2}-\\d{2})_(\\d{4}-\\d{2}-\\d{2})\\.${format}`).exec(r.headers.get("content-disposition")!)!;
        if (want.kind === "empty") {
          // The ASKED period, never a normalized neighbour; nothing loaded.
          expect({ from, to }).toEqual(want.form);
          expect(rpcs).toBe(0);
          if (format === "csv") {
            const text = (await r.text()).replace(/^﻿/, "");
            expect(text).toContain(want.reason);
            expect(text).not.toContain(YESTERDAY);
          }
        } else {
          expect({ from, to }).toEqual({ from: want.from, to: want.to });
        }
      });
    }
  }
});
