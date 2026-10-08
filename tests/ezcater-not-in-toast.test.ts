import { describe, expect, it } from "vitest";
import { toastReadyAt, toastRingTiming, type NotInToastOrder } from "@/lib/catering/not-in-toast-shared";

const order = (over: Partial<NotInToastOrder> = {}): NotInToastOrder => ({
  order_id: "o", lead_id: "lead", location_id: "shop", event_date: "2026-10-08", order_number: "ABC123",
  handoff_time: "2026-10-08T15:30:00Z", event_timestamp: "2026-10-08T16:00:00Z", headcount: 12, total_cents: 14000, ...over,
});
const timing = (iso: string, over: Partial<NotInToastOrder> = {}, opening: number | null = 11 * 60) => toastRingTiming(order(over), new Date(iso), opening);

describe("Toast ring due/overdue, ET", () => {
  it("is upcoming before opening and due at opening, independent of the machine zone", () => {
    expect(timing("2026-10-08T14:59:59.999Z")).toBe("upcoming");
    expect(timing("2026-10-08T15:00:00Z")).toBe("due");
  });
  it("becomes overdue only after handoff time has passed", () => {
    expect(timing("2026-10-08T15:30:00Z")).toBe("due");
    expect(timing("2026-10-08T15:30:00.001Z")).toBe("overdue");
    expect(toastReadyAt(order())).toBe("2026-10-08T15:30:00Z");
  });
  it("uses event deliver-by when handoff is absent or invalid", () => {
    for (const handoff_time of [null, "bad", "2026-10-08T11:30:00"]) {
      expect(timing("2026-10-08T15:45:00Z", { handoff_time })).toBe("due");
      expect(timing("2026-10-08T16:00:00.001Z", { handoff_time })).toBe("overdue");
    }
  });
  it.each([
    ["2026-10-08", "2026-10-09T03:59:59.999Z", "2026-10-09T04:00:00Z"],
    ["2026-03-08", "2026-03-09T03:59:59.999Z", "2026-03-09T04:00:00Z"],
    ["2026-11-01", "2026-11-02T04:59:59.999Z", "2026-11-02T05:00:00Z"],
  ])("missing ready expires at ET midnight after %s, including DST", (event_date, before, after) => {
    const noTime = { event_date, handoff_time: null, event_timestamp: null };
    expect(timing(before, noTime)).toBe("due");
    expect(timing(after, noTime)).toBe("overdue");
  });
  it("uses ET date for past and future eligibility", () => {
    expect(timing("2026-10-08T03:59:59Z")).toBe("upcoming");
    expect(timing("2026-10-09T04:00:00Z")).toBe("overdue");
  });
  it("never invents an opening schedule, but still identifies overdue orders", () => {
    expect(timing("2026-10-08T15:00:00Z", {}, null)).toBe("opening_unknown");
    expect(timing("2026-10-08T15:30:01Z", {}, null)).toBe("overdue");
  });
});
