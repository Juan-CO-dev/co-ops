/**
 * Nav PR 5, group 7 (plan r4, 5.3 Ordering): one rule for today's and tomorrow's cutoffs, the digest's `cutoffsTomorrow`
 * (governing cutoff by `cutoffForOrderDay`; "an order is in" = a PO at or beyond confirmed after cutoff − 24 h, a LOWER
 * bound only, lib/report-digests-v2-shared.ts:317, so a late confirmed order also clears the cutoff).
 */
import { describe, expect, it } from "vitest";
import { buildDay, type DayItem, type ShopFacts } from "@/lib/day-plan-shared";
import type { PoFact, VendorCutoff } from "@/lib/report-digests-v2-shared";
import { hm, iso, ok, PLAN_DATE, reasonText } from "./fixtures/day-plan/build";
import { P_SHOP, po, pStreet, VENDORS } from "./fixtures/day-plan/p-street";

const withOrdering = (min: number, cutoffs: readonly VendorCutoff[], pos: readonly PoFact[] = [], opts: Parameters<typeof pStreet>[1] = {}): ShopFacts =>
  ({ ...pStreet(min, opts), ordering: ok({ forDate: PLAN_DATE, vendors: VENDORS, cutoffs, pos }) });
const ordering = (t: string, f: ShopFacts): DayItem => buildDay(PLAN_DATE, hm(t), f).items.find((i) => i.id === "ordering")!;
const sortedIds = (t: string, f: ShopFacts) => buildDay(PLAN_DATE, hm(t), f).items.filter((i) => i.band === "upcoming").map((i) => i.id);
const cut = (vendorId: string, orderDay: number, cutoffTime: string, locationId: string | null = P_SHOP.id): VendorCutoff => ({ vendorId, locationId, orderDay, cutoffTime });

describe("today's cutoffs", () => {
  it("no cutoff today: ordering.none, untimed, at the bottom of upcoming", () => {
    const f = withOrdering(hm("07:00"), []);
    expect(ordering("07:00", f)).toMatchObject({ band: "upcoming", at: null });
    expect(reasonText(ordering("07:00", f).reasons[0]!)).toBe("ordering.none{}");
    expect(sortedIds("07:00", f).at(-1)).toBe("ordering");
  });

  it("a missed cutoff is urgent and stays urgent", () => {
    for (const t of ["14:01", "16:00", "23:59"]) {
      const o = ordering(t, withOrdering(hm(t), [cut("v-a", 3, "14:00:00")]));
      expect(o.band, t).toBe("urgent");
      expect(reasonText(o.reasons[0]!)).toBe("ordering.missed{vendor=Vendor A,time=14:00}");
    }
  });

  it("the boundaries: upcoming over 120 minutes away, now within 120, urgent within 30 (inclusive), 1 minute left", () => {
    const f = (t: string) => ordering(t, withOrdering(hm(t), [cut("v-a", 3, "14:00:00")]));
    expect(f("11:59").band).toBe("upcoming");
    expect(f("12:00").band).toBe("now");
    expect(f("13:29").band).toBe("now");
    expect(f("13:30").band).toBe("urgent");
    expect(reasonText(f("13:59").reasons[0]!)).toBe("ordering.urgent_one{vendor=Vendor A,time=14:00}");
  });

  it("a shared row and a shop row for the same vendor: the shop row governs", () => {
    const f = withOrdering(hm("07:00"), [cut("v-b", 3, "21:00:00", null), cut("v-b", 3, "13:00:00")]);
    expect(ordering("07:00", f).at).toBe(hm("13:00"));
    const other = withOrdering(hm("07:00"), [cut("v-b", 3, "21:00:00", null), cut("v-b", 3, "13:00:00", "shop-c")]);
    expect(ordering("07:00", other).at).toBe(hm("21:00"));
  });

  it("an order placed last evening inside the 24 h window clears a 10:00 cutoff", () => {
    const evening = po({ id: "po-eve", vendorId: "v-a", status: "placed", createdAt: iso("2026-11-17", "18:00"), placedAt: iso("2026-11-17", "18:00") });
    const o = ordering("08:00", withOrdering(hm("08:00"), [cut("v-a", 3, "10:00:00")], [evening]));
    expect(o.band).toBe("done");
    expect(reasonText(o.reasons[0]!)).toBe("ordering.done{}");
    const tooEarly = po({ ...evening, id: "po-old", createdAt: iso("2026-11-17", "09:00"), placedAt: iso("2026-11-17", "09:00") });
    expect(ordering("08:00", withOrdering(hm("08:00"), [cut("v-a", 3, "10:00:00")], [tooEarly])).band).toBe("now");
  });

  it("(Astra's note) a confirmed order placed AFTER the cutoff clears it too: the row is not missed", () => {
    const late = po({ id: "po-late", vendorId: "v-a", status: "confirmed", createdAt: iso(PLAN_DATE, "14:20"), confirmedAt: iso(PLAN_DATE, "14:20") });
    const o = ordering("14:30", withOrdering(hm("14:30"), [cut("v-a", 3, "14:00:00")], [late]));
    expect(o.band).toBe("done");
    expect(o.reasons.map((r) => r.key)).not.toContain("day.reason.ordering.missed");
  });

  it("a draft does not clear a cutoff", () => {
    const draft = po({ id: "po-d", vendorId: "v-a", status: "draft", createdAt: iso(PLAN_DATE, "12:00") });
    expect(ordering("13:00", withOrdering(hm("13:00"), [cut("v-a", 3, "14:00:00")], [draft])).band).toBe("now");
  });
});

describe("tonight's early cutoffs (a cutoff tomorrow before prep start + 60 minutes)", () => {
  it("7:30 tomorrow with prep at 7:00 counts tonight: upcoming and untimed until Night, now in Night", () => {
    const cutoffs = [cut("v-c", 4, "07:30:00")];
    const day = ordering("15:00", withOrdering(hm("15:00"), cutoffs));
    expect(day).toMatchObject({ band: "upcoming", at: null });
    expect(reasonText(day.reasons[0]!)).toBe("ordering.tonight_one{vendor=Vendor C,time=07:30}");
    const night = ordering("20:30", withOrdering(hm("20:30"), cutoffs));
    expect(night.band).toBe("now");
  });

  it("8:30 tomorrow is not tonight's", () => {
    const o = ordering("20:30", withOrdering(hm("20:30"), [cut("v-c", 4, "08:30:00")]));
    expect(reasonText(o.reasons[0]!)).toBe("ordering.none{}");
  });

  it("an early cutoff already ordered is done; one beside today's cutoff joins the row as an extra line", () => {
    const placed = po({ id: "po-e", vendorId: "v-c", status: "confirmed", createdAt: iso(PLAN_DATE, "19:00"), confirmedAt: iso(PLAN_DATE, "19:00") });
    expect(ordering("20:30", withOrdering(hm("20:30"), [cut("v-c", 4, "07:30:00")], [placed])).band).toBe("done");
    const both = ordering("15:00", withOrdering(hm("15:00"), [cut("v-a", 3, "16:00:00"), cut("v-c", 4, "07:30:00")]));
    expect(both.reasons.map(reasonText)).toEqual(["ordering.soon{vendor=Vendor A,time=16:00,day=2026-11-19}", "ordering.tonight_one{vendor=Vendor C,time=07:30}"]);
    expect(both.band).toBe("now");
  });
});
