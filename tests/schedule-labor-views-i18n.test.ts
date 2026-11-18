// Board two labor views PR 1: every label the labor views can show has en and es (operational tu), with the
// same {params}. No UI ships in PR 1; the keys exist so PR 3's board is born translated, and every reason code
// the loader can serialize has its line.
import { expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { SCHEDULE_LABOR_VIEW_I18N_KEYS, type BoardLaborReason, type BoardLaborDayKind } from "@/lib/scheduling/labor-projection-shared";

const EN = en as Record<string, string>, ES = es as Record<string, string>;
const params = (s: string) => [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]!).sort();

it("every key has a non-empty en and es string with the same params", () => {
  for (const k of SCHEDULE_LABOR_VIEW_I18N_KEYS) {
    expect(EN[k], k).toBeTruthy();
    expect(ES[k], k).toBeTruthy();
    expect(params(ES[k]!), k).toEqual(params(EN[k]!));
  }
});
it("the list is the whole schedule.labor_views namespace, and the es copy never uses usted", () => {
  expect(Object.keys(EN).filter((k) => k.startsWith("schedule.labor_views.")).sort()).toEqual([...SCHEDULE_LABOR_VIEW_I18N_KEYS].sort());
  expect(Object.keys(ES).filter((k) => k.startsWith("schedule.labor_views.")).sort()).toEqual([...SCHEDULE_LABOR_VIEW_I18N_KEYS].sort());
  for (const k of SCHEDULE_LABOR_VIEW_I18N_KEYS) expect(ES[k]).not.toMatch(/\busted\b/i);
});
it("every reason code, day kind and view state the payload can carry has its line (the compiler closes the lists)", () => {
  const reasons: Record<BoardLaborReason, true> = {
    schedule_incomplete: true, actuals_rebuilding: true, ot_not_assessed: true, wage_unknown: true, hours_unknown: true, salary_incomplete: true,
    salary_unknown: true, not_settled: true, no_schedule: true, sales_not_covered: true, net_unknown: true, ezcater_missing: true, zero_sales: true,
    forecast_missing: true, partial_week: true,
  };
  const kinds: Record<BoardLaborDayKind, true> = { actual: true, projected: true, not_settled: true, no_schedule: true };
  const keys = new Set<string>(SCHEDULE_LABOR_VIEW_I18N_KEYS);
  for (const r of Object.keys(reasons)) expect(keys.has(`schedule.labor_views.reason.${r}`), r).toBe(true);
  for (const k of Object.keys(kinds)) expect(keys.has(`schedule.labor_views.kind.${k}`), k).toBe(true);
  for (const s of ["not_installed", "rebuilding", "unavailable"]) expect(keys.has(`schedule.labor_views.state.${s}`), s).toBe(true);
});
