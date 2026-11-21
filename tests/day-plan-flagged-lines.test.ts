/**
 * Nav PR 5, group 17 (plan r4, 5.5; spec 3.3.11 "What the flagged count means"), engine side: the count of flagged
 * catering prep lines passes through unchanged into heavy.flagged_one/_other; a failed fact omits the line (never
 * "0 lines" from a failure). Both languages say what the flag means. (Equality with the Prep demand page's own count is
 * PR 6: the flag is computed inline in a server module.)
 */
import { describe, expect, it } from "vitest";
import { buildDay, type ShopFacts } from "@/lib/day-plan-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { hm, ok, PLAN_DATE, reasonText } from "./fixtures/day-plan/build";
import { pStreet } from "./fixtures/day-plan/p-street";

const openingReasons = (f: ShopFacts) => buildDay(PLAN_DATE, hm("08:00"), f).items.find((i) => i.id === "opening")!.reasons.map(reasonText);
const heavy = (today: number) => ({ ...pStreet(hm("08:00"), { heavy: true }), flaggedLines: ok({ today, tomorrow: 0 }) });

describe("flagged prep lines", () => {
  it.each([[0, "heavy.flagged_other{n=0}"], [1, "heavy.flagged_one{}"], [4, "heavy.flagged_other{n=4}"]])("%i passes through unchanged", (n, line) => {
    expect(openingReasons(heavy(n)).at(-1)).toBe(line);
  });

  it("a failed fact omits the line", () => {
    const reasons = openingReasons({ ...pStreet(hm("08:00"), { heavy: true }), flaggedLines: { kind: "failed" } });
    expect(reasons.some((r) => r.startsWith("heavy.flagged"))).toBe(false);
    expect(reasons.some((r) => r.startsWith("heavy.today"))).toBe(true);
  });

  it("tomorrow's count rides on the AM prep list at night on the evening before a heavy day", () => {
    const f = { ...pStreet(hm("20:30"), { nightBefore: true }), flaggedLines: ok({ today: 9, tomorrow: 1 }) };
    const am = buildDay("2026-11-17", hm("20:30"), f).items.find((i) => i.id === "am_prep")!;
    expect(am.reasons.map(reasonText).at(-1)).toBe("heavy.flagged_one{}");
  });

  it("both languages say what the flag means", () => {
    for (const k of ["day.reason.heavy.flagged_one", "day.reason.heavy.flagged_other"] as const) {
      expect(en[k]).toContain("at or over par, or no par set");
      expect(es[k]).toContain("en el par o por encima, o sin par");
    }
  });
});
