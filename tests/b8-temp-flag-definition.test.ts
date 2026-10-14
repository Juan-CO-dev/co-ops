import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isOutOfRangeTemp, isTempFlag } from "@/lib/report-signals";
import { tempItemRegistry } from "@/lib/reports-hub";
import { computeFridgeStatus, FRIDGE_DEFAULT_SAFE_MAX_F } from "@/lib/maintenance";
import { composeReportSummary } from "@/lib/report-summary";
import type { ReportListItem } from "@/lib/reports-hub";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

// B8 #4 (sim walk 2026-10-14): Trends "Fridge Temp Flags 8" beside Pulse "0 out of range".
// Three causes, three fixes: (1) Trends/Reports used a flat 41°F, Pulse each fridge's own
// safe max; (2) the hub summary added a maintenance row's fridge-day flags ON TOP of the same
// readings already counted on their checklist reports; (3) the Trends landing showed 30-day
// window totals under "Relevant right now" with no dates.

const read = (p: string) => readFileSync(p, "utf8");

describe("B8 #4 one temp-flag rule", () => {
  const registry = tempItemRegistry([
    { opening_temp_item_id: "am-walkin", closing_temp_item_id: "pm-walkin", safe_max_f: null },
    { opening_temp_item_id: "am-drinks", closing_temp_item_id: null, safe_max_f: 45 },
    { opening_temp_item_id: "am-cold", closing_temp_item_id: null, safe_max_f: 38 },
  ]);

  it("maps each fridge's temp items to its safe max, 41 when unset", () => {
    expect(registry.get("am-walkin")).toBe(FRIDGE_DEFAULT_SAFE_MAX_F);
    expect(registry.get("pm-walkin")).toBe(41);
    expect(registry.get("am-drinks")).toBe(45);
    expect(registry.has("prep-item")).toBe(false);
  });

  it("flags a reading above ITS fridge's max, exactly like Pulse's fridge status", () => {
    const cases: Array<[string, number, number]> = [["am-walkin", 42, 41], ["am-drinks", 43, 45], ["am-cold", 39, 38], ["am-walkin", 37, 41]];
    for (const [item, value, max] of cases) {
      const pulse = computeFridgeStatus([{ date: "2026-10-14", phase: "AM", valueF: value, at: "x", note: null }], max) === "out_of_range";
      expect(isTempFlag(registry, item, value), `${item}@${value}`).toBe(pulse);
    }
  });

  it("never flags a non-temp item or an empty reading", () => {
    expect(isTempFlag(registry, "prep-item", 99)).toBe(false);
    expect(isTempFlag(registry, "am-walkin", null)).toBe(false);
  });

  it("the walk's 35–38°F readings are never flags", () => {
    for (const v of [35, 36, 37, 38]) expect(isTempFlag(registry, "am-walkin", v)).toBe(false);
  });

  it("isOutOfRangeTemp keeps its 41°F default for existing callers", () => {
    expect(isOutOfRangeTemp(42)).toBe(true);
    expect(isOutOfRangeTemp(41)).toBe(false);
  });

  it("Reports and Trends both count through isTempFlag (no flat-41 compare left)", () => {
    for (const f of ["lib/reports-hub.ts", "lib/reports-trends.ts"]) {
      const src = read(f);
      expect(src, f).toContain("isTempFlag(tempItemIds,");
      expect(src, f).not.toMatch(/countValue > FRIDGE_DEFAULT_SAFE_MAX_F|isOutOfRangeTemp\(c\.count_value\)|isOutOfRangeTemp\(r\.count_value\)/);
    }
  });
});

describe("B8 #4 the hub summary counts each hot reading once", () => {
  const sig = (tempFlags: number) => ({ underPar: 0, overPar: 0, skipped: 0, notStarted: 0, tempFlags, cashOverShortCents: null });
  const item = (type: ReportListItem["type"], tempFlags: number) =>
    ({ type, id: `${type}-1`, date: "2026-10-14", locationId: "shop", submitterName: null, status: "ok", signalSummary: sig(tempFlags) }) as unknown as ReportListItem;

  it("a maintenance day's fridge flags do not add to the opening report's reading flags", () => {
    expect(composeReportSummary([item("opening", 1), item("maintenance", 1)]).signals.tempFlags).toBe(1);
  });
});

describe("B8 #4 Trends landing states its window", () => {
  it("the attention strip and the ops snapshot carry the date range", () => {
    const page = read("app/(authed)/reports/trends/page.tsx");
    expect(page).toContain('sub: inWindow(ops.tempFlags)');
    expect(page).toContain('sub: inWindow(ops.underPar)');
    expect(page).toContain('opsWindow={serverT(language, "reports.trends.landing.window", windowLabel)}');
    expect(read("components/team/TrendsLanding.tsx")).toContain("{opsWindow ? <p");
  });
  it("en + es keys", () => {
    expect(en["reports.trends.landing.count_in_window"]).toBe("{n} · {from} – {to}");
    expect(es["reports.trends.landing.count_in_window"]).toBe("{n} · {from} – {to}");
    expect(es["reports.trends.landing.window"]).toBe("{from} – {to}");
  });
});
