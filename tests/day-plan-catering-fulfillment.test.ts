/**
 * Nav PR 5, group 16 (plan r4, 5.3 Catering; spec 3.3.4 fulfillment states): to_go_out / out / completed / not_tracked /
 * cancelled. An untracked (ezCater, no pipeline lead) order is never urgent and never "out", counts in the total and its
 * window; a cancelled one is ignored. (r3, D5) The done lines never say an untracked order went out: `catering.done` only
 * when every order is tracked and out; `done_mixed_*` and `done_untracked_*` otherwise, checked after the untracked
 * windows end, in both languages through the reference renderer.
 */
import { describe, expect, it } from "vitest";
import { buildDay, type CateringOrder, type DayItem } from "@/lib/day-plan-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { hm, iso, ok, order, PLAN_DATE, reasonText } from "./fixtures/day-plan/build";
import { pStreet } from "./fixtures/day-plan/p-street";
import { renderReason } from "./fixtures/day-plan/render";

const catering = (t: string, orders: CateringOrder[]): DayItem => {
  const f = { ...pStreet(hm(t)), cateringToday: ok({ forDate: PLAN_DATE, orders }) };
  return buildDay(PLAN_DATE, hm(t), f).items.find((i) => i.id === "catering_today")!;
};
const tracked = (id: string, eventQ: number, headcount: number, outT: string | null = null) =>
  order({ id, eventQ, headcount, ...(outT ? { state: "out" as const, outAt: iso(PLAN_DATE, outT) } : {}) });
const untracked = (id: string, eventQ: number | null, headcount: number | null) => order({ id, source: "ezcater", eventQ, headcount, state: "not_tracked" });

describe("catering fulfillment states", () => {
  it("an untracked order is never urgent (and never late), but counts in the total and its window", () => {
    for (const t of ["11:30", "12:00", "12:30", "15:00"]) expect(catering(t, [untracked("u1", 48, 40)]).band, t).not.toBe("urgent");
    expect(catering("10:00", [untracked("u1", 48, 40)])).toMatchObject({ band: "now", heavy: true });
    expect(reasonText(catering("07:00", [untracked("u1", 48, 40)]).reasons[0]!)).toBe("catering.upcoming_one{guests=40,time=12:00,start=08:30}");
  });

  it("a cancelled order is ignored entirely", () => {
    const i = catering("11:45", [order({ id: "x", eventQ: 48, headcount: 200, state: "cancelled" })]);
    expect(reasonText(i.reasons[0]!)).toBe("catering.none{}");
    expect(i.heavy).toBe(false);
  });

  it("tracked to_go_out is urgent 30 minutes before its time and late after; out and completed count as out", () => {
    expect(catering("11:29", [tracked("t", 48, 25)]).band).toBe("now");
    expect(reasonText(catering("11:30", [tracked("t", 48, 25)]).reasons[0]!)).toBe("catering.urgent{time=12:00,guests=25}");
    expect(reasonText(catering("12:10", [tracked("t", 48, 25)]).reasons[0]!)).toBe("catering.late{time=12:00,guests=25}");
    expect(catering("12:10", [order({ id: "c", eventQ: 48, headcount: 25, state: "completed" })]).band).toBe("done");
  });

  it("never catering.done while an untracked order's time is ahead; the untracked line is shown", () => {
    const i = catering("13:00", [tracked("t", 48, 25, "11:40"), untracked("u", 60, 20)]);
    expect(i.band).not.toBe("done");
    expect(i.reasons.map((r) => r.key)).not.toContain("day.reason.catering.done");
    expect(i.reasons.map(reasonText)).toContain("catering.untracked_one{}");
  });

  it("(r3, D5) tracked out + one untracked, after its window ends: done, catering.done_mixed_one {}, never catering.done", () => {
    const i = catering("15:30", [tracked("t", 48, 25, "11:40"), untracked("u", 60, 20)]);
    expect(i.band).toBe("done");
    expect(i.reasons.map(reasonText)).toEqual(["catering.done_mixed_one{}"]);
    const two = catering("15:30", [tracked("t", 48, 25, "11:40"), untracked("u", 60, 20), untracked("v", 56, 10)]);
    expect(two.reasons.map(reasonText)).toEqual(["catering.done_mixed_other{n=2}"]);
  });

  it("two untracked orders only, both passed: catering.done_untracked_other {n: 2}; one: done_untracked_one {}", () => {
    expect(catering("16:00", [untracked("u", 60, 20), untracked("v", 52, 15)]).reasons.map(reasonText)).toEqual(["catering.done_untracked_other{n=2}"]);
    expect(catering("16:00", [untracked("u", 60, 20)]).reasons.map(reasonText)).toEqual(["catering.done_untracked_one{}"]);
  });

  it("every order tracked and out: catering.done, with the latest out time", () => {
    const i = catering("13:00", [tracked("t", 48, 25, "11:40"), tracked("s", 46, 10, "11:10")]);
    expect(i.reasons.map(reasonText)).toEqual(["catering.done{}"]);
    expect(i.done?.at).toBe(iso(PLAN_DATE, "11:40"));
  });

  it("no guest count and no time are named, never zeroed silently", () => {
    const i = catering("07:00", [tracked("t", 48, 25), untracked("u", null, null)]);
    expect(i.reasons.map(reasonText)).toEqual([
      "catering.upcoming_other{n=2,guests=25,time=12:00,start=08:30}", "catering.untracked_one{}",
      "catering.no_count_one{guests=25}", "catering.no_time_one{}",
    ]);
  });

  it("in both languages, no done line says the untracked orders went out", () => {
    const lines = [
      catering("15:30", [tracked("t", 48, 25, "11:40"), untracked("u", 60, 20)]),
      catering("15:30", [tracked("t", 48, 25, "11:40"), untracked("u", 60, 20), untracked("v", 56, 10)]),
      catering("16:00", [untracked("u", 60, 20)]),
      catering("16:00", [untracked("u", 60, 20), untracked("v", 52, 15)]),
    ].map((i) => i.reasons[0]!);
    for (const r of lines) {
      const enText = renderReason(r, "en", en);
      const esText = renderReason(r, "es", es);
      expect(enText).toMatch(/not tracked here/);
      expect(esText).toMatch(/no se sigue/);
      expect(enText).not.toMatch(/^Every order today is out/);
    }
  });
});
