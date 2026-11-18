// Item 9 PR 9b: the PAGE's pure helpers and its source pins. Failing-first.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import {
  BUSINESS_REPORT_I18N_KEYS, BUSINESS_REPORT_TABS, businessTab, compareChange, laborReasonKey, loadedReasonKey,
} from "@/lib/business-report-shared";
import { BUSINESS_EXPORT_TABS } from "@/lib/report-export-shared";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { parentFor } from "@/lib/nav-parents";

const ROOT = path.resolve(__dirname, "..");
const src = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const EN = en as Record<string, string>;

describe("tabs", () => {
  it("Overview / Hours / Channels / People / Compare; anything else is Overview; the export uses the same list", () => {
    expect(BUSINESS_REPORT_TABS).toEqual(["overview", "hours", "channels", "people", "compare"]);
    expect(BUSINESS_EXPORT_TABS).toBe(BUSINESS_REPORT_TABS);
    expect(businessTab("people")).toBe("people");
    expect(businessTab(undefined)).toBe("overview");
    expect(businessTab("wages")).toBe("overview");
  });
});

describe("compare", () => {
  it("money change is a % only when both periods are complete and the earlier one is above zero", () => {
    expect(compareChange({ value: 110_00, complete: true }, { value: 100_00, complete: true }, "money")).toEqual({ kind: "pct", value: 10 });
    expect(compareChange({ value: 110_00, complete: true }, { value: 100_00, complete: false }, "money")).toEqual({ kind: "not_comparable" });
    expect(compareChange({ value: 110_00, complete: true }, { value: 0, complete: true }, "money")).toEqual({ kind: "not_comparable" });
    expect(compareChange({ value: null, complete: true }, { value: 100, complete: true }, "money")).toEqual({ kind: "not_comparable" });
  });
  it("a labor % changes in POINTS, never a % of a %", () => {
    expect(compareChange({ value: 19.5, complete: true }, { value: 18, complete: true }, "points")).toEqual({ kind: "points", value: 1.5 });
    expect(compareChange({ value: null, complete: true }, { value: 18, complete: true }, "points")).toEqual({ kind: "not_comparable" });
  });
});

describe("every unknown has a sentence", () => {
  it("each labor and fully-loaded state maps to an en + es line", () => {
    for (const s of ["rebuilding", "unbuilt", "before_history", "hours_unknown", "sales_not_covered", "net_unknown", "ezcater_missing", "zero_sales"] as const) {
      expect(EN[laborReasonKey(s)!], s).toBeTruthy();
      expect(EN[loadedReasonKey(s)!], s).toBeTruthy();
    }
    expect(laborReasonKey("ok")).toBeNull();
    expect(EN[loadedReasonKey("salary_incomplete")!]).toMatch(/salar/i);
    expect(EN[loadedReasonKey("salary_unknown")!]).toMatch(/salar/i);
    expect(loadedReasonKey("ok")).toBeNull();
  });
  it("last year says it is empty until July 2027", () => {
    expect(EN["reports.business.last_year.no_data_yet"]).toMatch(/2027/);
    expect((es as Record<string, string>)["reports.business.last_year.no_data_yet"]).toMatch(/2027/);
  });
  it("every key the page uses is in the pinned list", () => {
    const used = new Set<string>();
    for (const f of ["app/(authed)/reports/business/page.tsx", "components/reports-business/BusinessReport.tsx", "components/reports-business/BusinessParts.tsx"]) {
      for (const m of src(f).matchAll(/"(reports\.business\.[a-z0-9_.]+)"/g)) used.add(m[1]!);
    }
    for (const k of used) expect(BUSINESS_REPORT_I18N_KEYS as readonly string[], k).toContain(k);
  });
});

describe("the page is wired like every report page", () => {
  const page = src("app/(authed)/reports/business/page.tsx");
  it("shop via the shared resolver; declared for the shop-context audit; parent is /reports", () => {
    expect(shopParamFor("/reports/business", searchParamValues({ location: "x" }))).toBe("x");
    expect(parentFor("/reports/business").href).toBe("/reports");
  });
  it("dark behind the switch and the role, before any read; GM+ by ROLE", () => {
    const gate = page.indexOf("businessReportEnabled(process.env)");
    expect(gate).toBeGreaterThan(-1);
    expect(page.indexOf("businessReportRefusal(auth.role)")).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(page.indexOf("loadBusinessReport("));
  });
  it("the hub tile shows only when the switch is on and the role may read it", () => {
    const hub = src("app/(authed)/reports/page.tsx");
    expect(hub).toMatch(/businessReportEnabled\(process\.env\) && !businessReportRefusal\(auth\.role\)/);
    expect(hub).toContain("/reports/business?");
  });
  it("phone-first: no horizontal scroll and every control at the 44 px floor", () => {
    for (const f of ["app/(authed)/reports/business/page.tsx", "components/reports-business/BusinessReport.tsx", "components/reports-business/BusinessParts.tsx"]) {
      const s = src(f);
      expect(s, f).not.toMatch(/overflow-x-auto|whitespace-nowrap/);
      for (const m of s.matchAll(/min-h-\[(\d+)px\]/g)) expect(Number(m[1]), f).toBeGreaterThanOrEqual(44);
    }
  });
});
