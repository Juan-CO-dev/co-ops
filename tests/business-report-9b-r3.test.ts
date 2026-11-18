// Item 9b fix round 3 (review ITEM9B-r3). Failing-first. Drawers OPEN (what a tap shows); the closed rows are
// tests/business-report-9b-r3-closed.test.ts with the real CollapsibleSection.
// P2-1: the Hours tab gives a reason for EVERY labor state whose hours are not final, never "No labor" for an
//       unknown, and qualifies provisional minutes ("so far").
// STRUCTURAL: every labor figure is rendered through ONE descriptor (lib/business-figure-shared.ts) — state +
//       reason + qualifiers — on every tab, in every drawer and in the export. This file enumerates every labor
//       state x every surface and pins that BusinessReport.tsx formats no labor number by hand.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/components/ui/CollapsibleSection", async () => {
  const { createElement: h } = await import("react");
  return { CollapsibleSection: ({ title, count, badge, children }: { title: unknown; count?: unknown; badge?: unknown; children: unknown }) =>
    h("section", null, h("span", null, title as never), h("span", null, count as never), badge as never, children as never) };
});

import { loadBusinessReport } from "@/lib/business-report";
import { laborHoursComplete, resolveBusinessRange } from "@/lib/business-report-shared";
import { figureKindOf, hoursFigure, loadedPctFigure, pureCentsFigure, purePctFigure, quarterHoursFigure } from "@/lib/business-figure-shared";
import { businessCompareRows, businessHoursRows, businessOverviewRows } from "@/lib/report-export-shared";
import { BusinessCompare, BusinessHours, BusinessOverview, BusinessPeople } from "@/components/reports-business/BusinessReport";
import { A, fakeClient } from "./helpers/business-report-fake";
import { EN, LOADED_VARIANTS, PURE_STATES, laborIn, loadedIn, reasonOf, visibleText, withLabor } from "./helpers/business-report-states";

const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const moo = { userId: "u-moo", level: 8, role: "moo" as const, locations: [] as string[] };
const SHOP = { id: A, code: "MEP", name: "Capitol Hill" };
const range = resolveBusinessRange({ range: "custom", from: "2026-10-01", to: "2026-10-07" }, "2026-10-08");
const load = async () => loadBusinessReport(moo, { locationId: A, range }, { client: fakeClient().client, env: ON });
const text = (el: Parameters<typeof renderToStaticMarkup>[0]) => visibleText(renderToStaticMarkup(el));
const NO_LABOR = EN["reports.business.hours.no_labor"]!;

describe("the descriptor: one state per figure", () => {
  it("every pure state maps to known / incomplete / unknown, never 'known' when the state is not ok", async () => {
    const base = (await load()).total.labor;
    for (const s of PURE_STATES) {
      const l = laborIn(base, s);
      const pct = purePctFigure(l);
      expect(pct.kind, s).toBe(s === "ok" ? "known" : "unknown");
      if (s !== "ok") expect(pct.reason, s).toBe(`reports.business.labor.state.${s}`);
      const h = hoursFigure(l);
      expect(h.kind, s).toBe(l.minutes === null ? "unknown" : laborHoursComplete(s) ? "known" : "incomplete");
      if (!laborHoursComplete(s)) expect(h.reason, s).toBe(`reports.business.labor.state.${s}`);
      const money = pureCentsFigure(l, "pureHourlyCents");
      if (money.value !== null && !laborHoursComplete(s)) expect(money.kind, s).toBe("incomplete");
    }
  });
  it("a quarter with no minutes is 'No labor' only when the day's hours are final", async () => {
    for (const s of PURE_STATES) {
      const q = quarterHoursFigure(null, s);
      if (laborHoursComplete(s)) { expect(q.kind, s).toBe("known"); expect(q.value, s).toBe(0); }
      else { expect(q.kind, s).toBe("unknown"); expect(q.reason, s).toBe(`reports.business.labor.state.${s}`); }
    }
  });
  it("fully loaded: estimates make it 'estimated', payroll gaps 'incomplete', a missing salary 'unknown'", async () => {
    const base = (await load()).total.labor;
    const kinds = Object.fromEntries(LOADED_VARIANTS.map((v) => [v, loadedPctFigure(loadedIn(base, v)).kind]));
    expect(kinds).toEqual({ known: "known", estimated: "incomplete", salary_incomplete: "unknown", salary_unknown: "unknown" });
    expect(figureKindOf(loadedPctFigure({ ...loadedIn(base, "estimated"), salaryGaps: 0 }))).toBe("estimated");
  });
});

describe("P2-1: Hours tab, every labor state", () => {
  for (const s of PURE_STATES) {
    it(`state ${s}: a reason whenever hours are not final, never 'No labor' for unknown, provisional minutes 'so far'`, async () => {
      const dto = withLabor(await load(), (l) => laborIn(l, s));
      const t = text(createElement(BusinessHours, { dto, language: "en" }));
      if (laborHoursComplete(s)) {
        expect(t).toContain(NO_LABOR);
        expect(t).not.toContain("so far");
        return;
      }
      expect(t).not.toContain(NO_LABOR);
      // One reason per day at least (the day line) and beside every sales-only quarter.
      expect(t.split(reasonOf(s)).length - 1, s).toBeGreaterThanOrEqual(dto.days.length * 2);
      // Every labor-carrying quarter (0.75 h) is qualified as provisional.
      expect((t.match(/0\.75 h(?! so far)/g) ?? []).length, s).toBe(0);
      expect(t).toContain("0.75 h so far");
    });
  }
});

describe("every surface, every labor state: nothing plain when the state is not known", () => {
  for (const s of PURE_STATES.filter((x) => x !== "ok")) {
    it(`state ${s}: Overview (cards + drawers), People, Compare name the reason; no bare labor %`, async () => {
      const dto = withLabor(await load(), (l) => laborIn(l, s));
      const reason = reasonOf(s);
      const overview = text(createElement(BusinessOverview, { dto, language: "en" }));
      // Every week and day drawer, plus the cards: the reason travels with the figure.
      expect(overview.split(reason).length - 1, s).toBeGreaterThanOrEqual(dto.days.length + dto.weeks.length);
      expect(overview, s).not.toMatch(/Hourly \d/);
      expect(overview, s).not.toMatch(/Fully loaded \d/);
      if (!laborHoursComplete(s)) expect(overview, s).toContain("so far");
      const people = text(createElement(BusinessPeople, { dto, language: "en" }));
      if (!laborHoursComplete(s)) expect(people, s).toContain(reason);
      const compare = text(createElement(BusinessCompare, { dto, previous: dto, language: "en" }));
      expect(compare, s).toContain(reason);
    });
  }
});

describe("the export carries the same descriptor", () => {
  for (const s of PURE_STATES) {
    it(`state ${s}: a % only when known; hours rows name the day's labor state`, async () => {
      const dto = withLabor(await load(), (l) => laborIn(l, s));
      for (const r of [...businessOverviewRows(dto, SHOP), ...businessCompareRows(dto, dto, SHOP).filter((x) => x.period !== "last_year")]) {
        if (r.labor_state === undefined) continue;
        expect(r.labor_state, s).toBe(s);
        if (s !== "ok") { expect(r.pure_hourly_pct, s).toBeNull(); expect(r.fully_loaded_pct, s).toBeNull(); }
      }
      for (const r of businessHoursRows(dto, SHOP).filter((x) => x.row_type === "quarter")) {
        expect(r.labor_state, s).toBe(s);
        // A sales-only quarter on a day whose hours are not final is unknown (empty), never 0.
        if (!laborHoursComplete(s) && r.checks === 3) expect(r.labor_hours, s).toBeNull();
      }
    });
  }
  it("the hours tab's file has a labor_state column", async () => {
    const { BUSINESS_EXPORT_COLUMNS } = await import("@/lib/report-export-shared");
    expect(BUSINESS_EXPORT_COLUMNS.hours.map((c) => c.key)).toContain("labor_state");
  });
});

describe("structural pin: BusinessReport.tsx formats no labor figure by hand", () => {
  const src = readFileSync(path.resolve(__dirname, "../components/reports-business/BusinessReport.tsx"), "utf8");
  it("labor numbers go through the descriptor (FigureView / figureText), never pctText / hoursText / laborHoursText / a hand dash", () => {
    for (const banned of ["pctText(", "hoursText(", "laborHoursText(", "hours.no_labor", "laborReasonKey(", "loadedReasonKey(", "LoadedQualifiers"]) {
      expect(src.includes(banned), banned).toBe(false);
    }
  });
});
