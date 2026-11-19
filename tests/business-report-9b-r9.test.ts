// Item 9b fix round 9 (review ITEM9B-r9), failing-first.
//  P2  The Overview's rush badge rendered `figureValueText(day.rush.count)`: the value ALONE, with neither the
//      figure's reason nor its qualifications. A day with one rush found beside untimed checks (a floor: "there may
//      be more"), with uncompared 15 minutes, or with baseline days left out of the usual read a plain "1 rushes".
//      The leak is closed at the helper: the figure module exports NO value-only text, so no surface can write a
//      figure's number without its state; the census fails by name on any value-only accessor.
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

import * as FigureModule from "@/lib/business-figure-shared";
import { loadBusinessReport, type BusinessReportDto } from "@/lib/business-report";
import { resolveBusinessRange } from "@/lib/business-report-shared";
import { A, fakeClient } from "./helpers/business-report-fake";
import { EN, visibleText } from "./helpers/business-report-states";
import { BusinessHours, BusinessOverview, BusinessPeople, BusinessChannels } from "./helpers/business-report-views";
import { censusOf } from "./helpers/business-figure-census";

const ROOT = path.resolve(__dirname, "..");
const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const moo = { userId: "u-moo", level: 8, role: "moo" as const, locations: [] as string[] };
const range = resolveBusinessRange({ range: "custom", from: "2026-10-01", to: "2026-10-07" }, "2026-10-08");
const load = () => loadBusinessReport(moo, { locationId: A, range }, { client: fakeClient().client, env: ON });
const text = (el: Parameters<typeof renderToStaticMarkup>[0]) => visibleText(renderToStaticMarkup(el));
const R = (k: string, v: Record<string, string | number> = {}) => {
  let s = EN[`reports.business.${k}`] ?? `<<reports.business.${k} is not translated>>`;
  for (const [a, b] of Object.entries(v)) s = s.split(`{${a}}`).join(String(b));
  return s;
};
const X = "2026-10-03";
const W = { startAt: `${X}T16:00:00.000Z`, endAt: `${X}T16:30:00.000Z`, quarters: 2, checks: 8, cents: 40_000, baselineChecks: 2, baselineCents: 4_000 };
/** Day X found one rush; `extra` adds what qualifies the count. */
function oneRush(dto: BusinessReportDto, extra: Record<string, number>): BusinessReportDto {
  return { ...dto, days: dto.days.map((d) => (d.date === X ? { ...d, rush: { ...d.rush!, state: "ok", windows: [W], uncompared: 0, untimed: 0, baselineUntimed: 0, ...extra } } : d)) } as BusinessReportDto;
}

describe("ITEM9B-r9 P2: the Overview's rush badge carries the count's state", () => {
  it("a rush found beside untimed checks: the badge says there may be more", async () => {
    const dto = oneRush(await load(), { untimed: 2 });
    expect(dto.days.find((d) => d.date === X)!.rush).toBeTruthy();
    const t = text(createElement(BusinessOverview, { dto, language: "en" }));
    expect(t).toContain(R("rush.untimed_more", { n: 2 }));
  });
  it("uncompared 15 minutes: the badge says not every 15 minutes was compared", async () => {
    const t = text(createElement(BusinessOverview, { dto: oneRush(await load(), { uncompared: 1 }), language: "en" }));
    expect(t).toContain(R("rush.not_all_compared"));
  });
  it("baseline days left out of the usual: the badge names them", async () => {
    const t = text(createElement(BusinessOverview, { dto: oneRush(await load(), { baselineUntimed: 1 }), language: "en" }));
    expect(t).toContain(R("qual.baseline_untimed", { n: 1 }));
  });
  it("Hours keeps saying the same thing (one formatter on both tabs)", async () => {
    const t = text(createElement(BusinessHours, { dto: oneRush(await load(), { untimed: 2 }), language: "en" }));
    expect(t).toContain(R("rush.untimed_more", { n: 2 }));
  });
  it("a plain rush count stays plain: no stray parenthesis", async () => {
    const t = text(createElement(BusinessOverview, { dto: oneRush(await load(), {}), language: "en" }));
    expect(t).toContain(R("rush.count", { n: 1 }));
    expect(t).not.toContain(`${R("rush.count", { n: 1 })} (`);
  });
  it("every tab renders with no value-only text (smoke over the other tabs)", async () => {
    const dto = oneRush(await load(), { untimed: 2 });
    for (const C of [BusinessPeople, BusinessChannels]) expect(text(createElement(C, { dto, language: "en" })).length).toBeGreaterThan(0);
  });
});

describe("ITEM9B-r9: the figure module exports no value-only text", () => {
  it("figureValueText (or any value-without-state helper) is not exported", () => {
    const names = Object.keys(FigureModule);
    expect(names).not.toContain("figureValueText");
    // The only ways a figure becomes words outside the module: its full line, its display (value + reason + notes,
    // read only by the page's one formatter), the reason/why, a change, a file's cells.
    expect(names.filter((n) => /Text$|Words$|ValueText|Value$/.test(n)).sort()).toEqual(["figureText"]);
  });
  it("no surface defines or imports a value-only accessor", () => {
    for (const f of ["components/reports-business/BusinessParts.tsx", "components/reports-business/BusinessReport.tsx"]) {
      expect(readFileSync(path.join(ROOT, f), "utf8"), f).not.toMatch(/figureValueText|figureValueWords|valueWords/);
    }
  });
  const LEAKS: Array<[string, string]> = [
    ["{t(\"reports.business.rush.count\", { n: figureValueText(day.rush.count, language) ?? \"\" })}", "a value-only figure accessor"],
    ["const n = valueWords(checks, fmt);", "a value-only figure accessor"],
    ["const d = figureDisplay(f, fmt); return d.words;", "a figure display outside the page's one formatter"],
    ["<span title={figureDisplay(f, fmt).words} />", "a figure display outside the page's one formatter"],
  ];
  for (const [line, rule] of LEAKS) {
    it(`census fails by name on: ${line}`, () => {
      const found = censusOf("components/reports-business/Planted.tsx", `const ok = 1;\n${line}\n`);
      expect(found.join("\n")).toContain(rule);
      expect(found[0]).toMatch(/^components\/reports-business\/Planted\.tsx:2 {2}/);
    });
  }
  it("the page's one formatter may read a display (it renders the reason and notes beside the words)", () => {
    expect(censusOf("components/reports-business/BusinessParts.tsx", "const d = figureDisplay(f, fmt);\nconst w = d.words;\n")).toEqual([]);
  });
});
