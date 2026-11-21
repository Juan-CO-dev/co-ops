/**
 * Nav PR 5, group 8 (plan r4, 5.3 Receiving): the engine's own selection over three complete reads (every open order
 * with no complete delivery, every half-logged delivery, the deliveries completed today). An order is due on its order
 * day + its pair's lead; inside a skip window the truck is dropped; overdue however old. Precedence urgent > now >
 * upcoming (undated) > done. It agrees with the digest's `deliveriesLookahead(planDate − 1)` on inputs with no partial
 * delivery.
 */
import { describe, expect, it } from "vitest";
import { buildDay, type DayItem, type ReceivingFacts, type RhythmFacts } from "@/lib/day-plan-shared";
import { deliveriesLookahead, type PoFact } from "@/lib/report-digests-v2-shared";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";
import { hm, iso, ok, PLAN_DATE, reasonText } from "./fixtures/day-plan/build";
import { P_SHOP, po, pStreet, VENDORS } from "./fixtures/day-plan/p-street";

/** Every vendor orders any day with lead 1 (Monday..Sunday), except Vendor B, which has no pair at all. */
const RHYTHM: RhythmFacts = {
  rows: ["v-a", "v-c"].flatMap((vendorId) => [0, 1, 2, 3, 4, 5, 6].map((orderDow) => ({ vendorId, locationId: P_SHOP.id, orderDow, leadDays: 1 }))),
  skips: [],
};
const placedOn = (id: string, vendorId: string, day: string): PoFact =>
  po({ id, vendorId, status: "placed", createdAt: iso(day, "15:00"), placedAt: iso(day, "15:00") });

function receiving(r: Partial<Omit<ReceivingFacts, "forDate" | "vendors">>, rhythm: RhythmFacts = RHYTHM): DayItem {
  const facts = { ...pStreet(hm("12:00")), rhythm: ok(rhythm),
    receiving: ok({ forDate: PLAN_DATE, vendors: VENDORS, openOrders: [], halfLogged: [], completedToday: [], ...r }) };
  return buildDay(PLAN_DATE, hm("12:00"), facts).items.find((i) => i.id === "receiving")!;
}
const yesterday = addDaysEt(PLAN_DATE, -1);

describe("receiving", () => {
  it("due today: now, untimed", () => {
    const i = receiving({ openOrders: [placedOn("p1", "v-a", yesterday), placedOn("p2", "v-c", yesterday)] });
    expect(i).toMatchObject({ band: "now", at: null });
    expect(i.reasons.map(reasonText)).toEqual(["receiving.expected_other{n=2,vendors=Vendor A+Vendor C}"]);
  });

  it("overdue (urgent), and overdue by 40 days still urgent", () => {
    const i = receiving({ openOrders: [placedOn("p1", "v-a", addDaysEt(PLAN_DATE, -3))] });
    expect(i.band).toBe("urgent");
    expect(reasonText(i.reasons[0]!)).toBe(`receiving.overdue{vendor=Vendor A,day=${addDaysEt(PLAN_DATE, -2)}}`);
    expect(receiving({ openOrders: [placedOn("p1", "v-a", addDaysEt(PLAN_DATE, -41))] }).band).toBe("urgent");
  });

  it("undated (no pair for the order day): upcoming", () => {
    const i = receiving({ openOrders: [placedOn("p1", "v-b", yesterday)] });
    expect(i.band).toBe("upcoming");
    expect(reasonText(i.reasons[0]!)).toBe("receiving.undated{vendor=Vendor B}");
  });

  it("a truck inside a skip window is dropped (cancelled, not moved)", () => {
    const skip = { ...RHYTHM, skips: [{ vendorId: "v-a", skipFrom: PLAN_DATE, skipThrough: PLAN_DATE }] };
    const i = receiving({ openOrders: [placedOn("p1", "v-a", yesterday)] }, skip);
    expect(reasonText(i.reasons[0]!)).toBe("receiving.none{}");
  });

  it("25 half-logged deliveries, the oldest from 30 days ago: listed (now), and its order still open", () => {
    const halfLogged = Array.from({ length: 25 }, (_, k) => ({ id: `h${k}`, vendorId: k === 24 ? "v-c" : "v-a", startedAt: iso(addDaysEt(PLAN_DATE, k === 24 ? -30 : -k), "09:00") }));
    const i = receiving({ halfLogged, openOrders: [placedOn("p-old", "v-c", addDaysEt(PLAN_DATE, -31))] });
    expect(i.band).toBe("urgent");
    expect(i.reasons.map(reasonText)).toContain("receiving.half_logged{vendor=Vendor C}");
    expect(i.reasons.map((r) => r.key)).toContain("day.reason.receiving.overdue");
    expect(receiving({ halfLogged }).band).toBe("now");
  });

  it("done only when every order due today is complete and nothing is half logged", () => {
    const done = { id: "d1", vendorId: "v-a", at: iso(PLAN_DATE, "10:15") };
    expect(receiving({ completedToday: [done] })).toMatchObject({ band: "done", state: "done" });
    expect(reasonText(receiving({ completedToday: [done] }).reasons[0]!)).toBe("receiving.done_one{}");
    expect(reasonText(receiving({ completedToday: [done, { ...done, id: "d2" }] }).reasons[0]!)).toBe("receiving.done_other{n=2}");
    expect(receiving({ completedToday: [done], openOrders: [placedOn("p1", "v-a", yesterday)] }).band).toBe("now");
    expect(receiving({ completedToday: [done], halfLogged: [{ id: "h", vendorId: "v-a", startedAt: iso(PLAN_DATE, "09:00") }] }).band).toBe("now");
    expect(receiving({ completedToday: [done], openOrders: [placedOn("p1", "v-b", yesterday)] }).band).toBe("upcoming");
    expect(reasonText(receiving({}).reasons[0]!)).toBe("receiving.none{}");
  });

  it("agrees with deliveriesLookahead(planDate − 1) on due / overdue / undated when nothing is partly delivered", () => {
    const openOrders = [
      placedOn("p1", "v-a", yesterday), placedOn("p2", "v-c", yesterday), placedOn("p3", "v-a", addDaysEt(PLAN_DATE, -5)),
      placedOn("p4", "v-b", yesterday), placedOn("p5", "v-c", PLAN_DATE),
    ];
    const digest = deliveriesLookahead({ day: yesterday, locationId: P_SHOP.id, pos: openOrders, vendors: VENDORS, rhythm: RHYTHM.rows, skips: [], receivedPoIds: new Set() });
    const i = receiving({ openOrders });
    const keys = i.reasons.map((r) => r.key);
    expect(digest.overdue.length > 0).toBe(keys.includes("day.reason.receiving.overdue"));
    expect(i.reasons.find((r) => r.key === "day.reason.receiving.expected_other")?.params.n).toEqual({ t: "count", v: digest.due.length });
    expect(digest.undated.length > 0).toBe(keys.includes("day.reason.receiving.undated"));
    expect(digest.due.map((d) => d.vendorName)).toEqual(["Vendor A", "Vendor C"]);
  });
});
