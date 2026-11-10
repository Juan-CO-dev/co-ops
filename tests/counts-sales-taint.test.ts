/**
 * Sales-window silent-zero taint (hardening 2026-07-31, council P1). A missing
 * materialized day read as 0 sales silently inflated on-hand; a same-ET-day
 * recount dropped that day's sales from variance. salesWindowUntrustworthy
 * forces the sales term to null (advisory) in both cases — the pure decision
 * these tests pin.
 */
import { describe, it, expect } from "vitest";
import { salesWindowUntrustworthy } from "@/lib/counts-shared";

const gaps = (...d: string[]) => new Set(d);

describe("salesWindowUntrustworthy", () => {
  it("clean since-window (no gaps) is trustworthy", () => {
    expect(salesWindowUntrustworthy(gaps(), "2026-07-23", null)).toBe(false);
  });

  it("a gap date inside the open since-window taints", () => {
    expect(salesWindowUntrustworthy(gaps("2026-07-26"), "2026-07-23", null)).toBe(true);
  });

  it("a gap date BEFORE the window start does not taint", () => {
    expect(salesWindowUntrustworthy(gaps("2026-07-20"), "2026-07-23", null)).toBe(false);
  });

  it("a gap date at/after the between-window's exclusive end does not taint", () => {
    // window [23, 26): a gap on the 26th is outside it.
    expect(salesWindowUntrustworthy(gaps("2026-07-26"), "2026-07-23", "2026-07-26")).toBe(false);
    expect(salesWindowUntrustworthy(gaps("2026-07-25"), "2026-07-23", "2026-07-26")).toBe(true);
  });

  it("a collapsed same-ET-day between-window always taints (variance advisory)", () => {
    expect(salesWindowUntrustworthy(gaps(), "2026-07-26", "2026-07-26")).toBe(true);
    // defensive: inverted bounds also taint
    expect(salesWindowUntrustworthy(gaps(), "2026-07-27", "2026-07-26")).toBe(true);
  });

  it("the since-window's own anchor date IS inside the window (inclusive from)", () => {
    expect(salesWindowUntrustworthy(gaps("2026-07-23"), "2026-07-23", null)).toBe(true);
  });
});
