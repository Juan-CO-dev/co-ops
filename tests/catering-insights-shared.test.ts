/**
 * Insights v2 pure core — window keys, ET month grid (Mon-start), event grouping, stage dots.
 */
import { describe, it, expect } from "vitest";
import {
  INSIGHT_WINDOWS, monthGrid, groupEventsByDate, stageDot, shiftMonth, monthKey, type CalendarEvent,
} from "@/lib/catering/insights-shared";

const ev = (date: string, stage: CalendarEvent["stage"], id = date + stage): CalendarEvent =>
  ({ id, eventDate: date, timeWindow: null, name: "x", headcount: 10, source: "ezcater", stage, locationId: "L", valueCents: 100 });

describe("insights-shared", () => {
  it("has exactly the four ruled windows in order", () => {
    expect(INSIGHT_WINDOWS.map((w) => w.key)).toEqual(["this_week", "this_month", "last_30", "all_time"]);
  });
  it("monthGrid is Monday-start, 6 rows max, with leading/trailing days flagged outside", () => {
    const g = monthGrid("2026-09");           // Sep 2026 starts on a Tuesday
    expect(g.weeks.length).toBeGreaterThanOrEqual(5);
    expect(g.weeks[0]![0]!.date).toBe("2026-08-31");
    expect(g.weeks[0]![0]!.inMonth).toBe(false);
    expect(g.weeks[0]![1]!.date).toBe("2026-09-01");
    expect(g.weeks[0]![1]!.inMonth).toBe(true);
    const last = g.weeks[g.weeks.length - 1]!;
    expect(last.length).toBe(7);
    expect(g.weeks.flat().filter((d) => d.inMonth).length).toBe(30);
  });
  it("monthKey and shiftMonth walk the calendar without Date math surprises", () => {
    expect(monthKey("2026-09-05")).toBe("2026-09");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
  it("groups events by date, chronologically within a day, unparseable windows last", () => {
    const g = groupEventsByDate([
      { ...ev("2026-09-08", "confirmed", "a"), timeWindow: "1:00–1:30 PM" },
      { ...ev("2026-09-08", "confirmed", "b"), timeWindow: "10:00–10:30 AM" },
      { ...ev("2026-09-08", "out", "c"), timeWindow: null },
      ev("2026-09-11", "completed"),
    ]);
    expect([...g.keys()]).toEqual(["2026-09-08", "2026-09-11"]);
    expect(g.get("2026-09-08")!.map((e) => e.id)).toEqual(["b", "a", "c"]);
  });
  it("stage dots use the token roles, never raw status colours as text", () => {
    expect(stageDot("confirmed")).toBe("bg-co-gold");
    expect(stageDot("out")).toBe("bg-co-text");
    expect(stageDot("completed")).toBe("bg-co-success");
  });
});
