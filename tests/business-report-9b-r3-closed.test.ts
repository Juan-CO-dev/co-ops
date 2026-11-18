// Item 9b fix round 3 (review ITEM9B-r3 P2-2), failing-first, with the REAL CollapsibleSection: every drawer is
// CLOSED here (what the page shows before a tap), so only titles, collapsed summaries and badges are visible.
// A collapsed summary carries the same qualifications as the expanded view: the reason for every labor state,
// and the fully loaded figure's burden / salary estimates and payroll gaps.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

import { loadBusinessReport } from "@/lib/business-report";
import { laborHoursComplete, resolveBusinessRange } from "@/lib/business-report-shared";
// Fix round 4: the page takes the VIEW; these adapters build it from a DTO as the page does.
import { BusinessHours, BusinessOverview } from "./helpers/business-report-views";
import { A, fakeClient } from "./helpers/business-report-fake";
import { EN, LOADED_VARIANTS, PURE_STATES, laborIn, loadedIn, reasonOf, visibleText, withLabor } from "./helpers/business-report-states";

const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const moo = { userId: "u-moo", level: 8, role: "moo" as const, locations: [] as string[] };
const range = resolveBusinessRange({ range: "custom", from: "2026-10-01", to: "2026-10-07" }, "2026-10-08");
const load = async () => loadBusinessReport(moo, { locationId: A, range }, { client: fakeClient().client, env: ON });
const text = (el: Parameters<typeof renderToStaticMarkup>[0]) => visibleText(renderToStaticMarkup(el));
/** "No labor" as the quarter word (not the "No labor history ..." reason, which starts the same). */
const NO_LABOR = new RegExp(`${EN["reports.business.hours.no_labor"]!}(?! history)`);
/** The visible text of each closed week row (Overview: the weeks list is open, each week is closed). */
const weekRows = (t: string) => t.split(/Week (?=[A-Z][a-z]{2}, )/).slice(1);

describe("closed drawers really hide their children (the r1/r2 mock opened every one)", () => {
  it("a closed day row shows no drawer line", async () => {
    const t = text(createElement(BusinessOverview, { dto: await load(), language: "en" }));
    expect(t).not.toContain(EN["reports.business.detail.pure_hourly_cost"]!);
  });
});

describe("P2-2: collapsed week rows keep the fully loaded qualifications", () => {
  const SHORT = { burden: EN["reports.business.qual.burden_estimated"]!, salary: EN["reports.business.qual.salary_estimated"]!,
    gaps: EN["reports.business.qual.salary_gaps"]!.replace("{n}", "2") };
  for (const v of LOADED_VARIANTS) {
    it(`fully loaded ${v}`, async () => {
      const dto = withLabor(await load(), (l) => loadedIn(l, v));
      const rows = weekRows(text(createElement(BusinessOverview, { dto, language: "en" })));
      expect(rows.length).toBe(dto.weeks.length);
      for (const r of rows) {
        if (v === "estimated") for (const s of Object.values(SHORT)) expect(r, s).toContain(s);
        if (v === "known") for (const s of Object.values(SHORT)) expect(r, s).not.toContain(s);
        if (v === "salary_incomplete" || v === "salary_unknown") {
          expect(r).toContain(EN[`reports.business.labor.state.${v}`]!);
          expect(r).not.toMatch(/Fully loaded \d/);
        }
        if (v === "salary_incomplete") expect(r).toContain(SHORT.gaps);
      }
    });
  }
});

describe("collapsed rows, every labor state", () => {
  for (const s of PURE_STATES.filter((x) => x !== "ok")) {
    it(`state ${s}: each closed week row names the reason; no plain labor %`, async () => {
      const dto = withLabor(await load(), (l) => laborIn(l, s));
      for (const r of weekRows(text(createElement(BusinessOverview, { dto, language: "en" })))) {
        expect(r, s).toContain(reasonOf(s));
        expect(r, s).not.toMatch(/Hourly \d/);
        expect(r, s).not.toMatch(/Fully loaded \d/);
      }
    });
    it(`state ${s}: each closed Hours day row says the labor is not final when it is not`, async () => {
      const dto = withLabor(await load(), (l) => laborIn(l, s));
      const t = text(createElement(BusinessHours, { dto, language: "en" }));
      expect(t).not.toMatch(NO_LABOR);
      if (!laborHoursComplete(s)) expect(t.split(reasonOf(s)).length - 1, s).toBe(dto.days.length);
    });
  }
});
