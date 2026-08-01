/**
 * timeWindowMinutes (audit fix 2026-08-01) — pins the chronological sort key
 * for the catering-due-today strip. The original lexicographic sort put
 * "1:00–1:30 PM" ahead of "10:00–10:30 AM"; this parser orders by real
 * minutes-of-day, with free-text/unparseable/null windows sorting last.
 */
import { describe, it, expect } from "vitest";
import { timeWindowMinutes } from "@/lib/midshift-shared";

describe("timeWindowMinutes", () => {
  it("parses the fixed-dropdown AM/PM range shapes", () => {
    expect(timeWindowMinutes("10:00–10:30 AM")).toBe(600);
    expect(timeWindowMinutes("11:30 AM–12:00 PM")).toBe(690);
    expect(timeWindowMinutes("1:00–1:30 PM")).toBe(780);
    expect(timeWindowMinutes("12:00–12:30 PM")).toBe(720); // noon, not midnight
  });

  it("first time inherits the range's trailing meridiem", () => {
    // "11:30 AM–1:00 PM": the first AM/PM after the first time is AM.
    expect(timeWindowMinutes("11:30 AM–1:00 PM")).toBe(690);
  });

  it("handles 24-hour free text without a meridiem", () => {
    expect(timeWindowMinutes("13:00-14:00")).toBe(780);
    expect(timeWindowMinutes("9:00")).toBe(540);
  });

  it("midnight edge: 12:15 AM is 15 minutes past midnight", () => {
    expect(timeWindowMinutes("12:15 AM")).toBe(15);
  });

  it("null and unparseable text sort last", () => {
    expect(timeWindowMinutes(null)).toBe(Infinity);
    expect(timeWindowMinutes("lunchtime")).toBe(Infinity);
    expect(timeWindowMinutes("99:99")).toBe(Infinity);
  });

  it("orders a mixed AM/PM day chronologically (the regression case)", () => {
    const windows = ["1:00–1:30 PM", "10:00–10:30 AM", null, "11:30 AM–12:00 PM"];
    const sorted = [...windows].sort((a, b) => timeWindowMinutes(a) - timeWindowMinutes(b) || 0);
    expect(sorted).toEqual(["10:00–10:30 AM", "11:30 AM–12:00 PM", "1:00–1:30 PM", null]);
  });
});
