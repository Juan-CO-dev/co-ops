/**
 * Operational-day (America/New_York) primitives (hardening 2026-07-31, council
 * P1 — the UTC-vs-Eastern bug family). These pins guard the two sites they fix:
 * midshift maintenance-notes bucketing + catering surplus ±1-day classification.
 */
import { describe, it, expect } from "vitest";
import { etCalendarDate, etYmdMinusDays, operationalDayUtcRange } from "@/lib/operational-day";

describe("etCalendarDate", () => {
  it("a late-evening ET instant belongs to the ET day, not the next UTC day", () => {
    // 01:45 UTC on the 11th = 21:45 EDT on the 10th.
    expect(etCalendarDate("2026-07-11T01:45:00Z")).toBe("2026-07-10");
  });
  it("a midday UTC instant is the same ET day", () => {
    expect(etCalendarDate("2026-07-10T16:00:00Z")).toBe("2026-07-10");
  });
  it("winter (EST −5) boundary", () => {
    // 04:30 UTC Jan 15 = 23:30 EST Jan 14.
    expect(etCalendarDate("2026-01-15T04:30:00Z")).toBe("2026-01-14");
  });
});

describe("operationalDayUtcRange", () => {
  it("an EDT (−4) day starts at 04:00Z and ends 24h later", () => {
    const { startIso, endExclusiveIso } = operationalDayUtcRange("2026-07-10");
    expect(startIso).toBe("2026-07-10T04:00:00.000Z");
    expect(endExclusiveIso).toBe("2026-07-11T04:00:00.000Z");
  });
  it("an EST (−5) day starts at 05:00Z", () => {
    const { startIso, endExclusiveIso } = operationalDayUtcRange("2026-01-14");
    expect(startIso).toBe("2026-01-14T05:00:00.000Z");
    expect(endExclusiveIso).toBe("2026-01-15T05:00:00.000Z");
  });
  it("a 22:00-ET note (02:00Z next day) falls INSIDE its own ET day's range", () => {
    const { startIso, endExclusiveIso } = operationalDayUtcRange("2026-07-10");
    const note = "2026-07-11T02:00:00.000Z"; // 22:00 EDT on the 10th
    expect(note >= startIso && note < endExclusiveIso).toBe(true);
  });
});

describe("etYmdMinusDays (council audit 2026-08-08 P1-2: the winter cron D-2 bug)", () => {
  it("simple midmonth", () => {
    expect(etYmdMinusDays("2026-08-09", 1)).toBe("2026-08-08");
  });
  it("month boundary", () => {
    expect(etYmdMinusDays("2026-08-01", 1)).toBe("2026-07-31");
  });
  it("year boundary", () => {
    expect(etYmdMinusDays("2026-01-01", 1)).toBe("2025-12-31");
  });
  it("leap day", () => {
    expect(etYmdMinusDays("2028-03-01", 1)).toBe("2028-02-29");
  });
  it("across the fall-back DST date (pure grid math — DST cannot shift it)", () => {
    expect(etYmdMinusDays("2026-11-02", 1)).toBe("2026-11-01");
  });
  it("across the spring-forward DST date", () => {
    expect(etYmdMinusDays("2026-03-09", 1)).toBe("2026-03-08");
  });
  it("the exact winter-cron composition: a 09:00Z January firing computes D-1, not D-2", () => {
    // 2026-01-09T09:00Z = 04:00 EST Jan 9 → ET today = Jan 9 → yesterday = Jan 8.
    expect(etYmdMinusDays(etCalendarDate("2026-01-09T09:00:00Z"), 1)).toBe("2026-01-08");
  });
  it("the summer composition still holds", () => {
    // 2026-08-09T09:00Z = 05:00 EDT Aug 9 → yesterday = Aug 8.
    expect(etYmdMinusDays(etCalendarDate("2026-08-09T09:00:00Z"), 1)).toBe("2026-08-08");
  });
  it("rejects malformed input", () => {
    expect(() => etYmdMinusDays("Jan 9 2026", 1)).toThrow();
  });
});
