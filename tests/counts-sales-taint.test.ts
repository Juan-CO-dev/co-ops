/**
 * Sales-window silent-zero taint (hardening 2026-07-31, council P1). A missing
 * materialized day read as 0 sales silently inflated on-hand; a same-ET-day
 * recount dropped that day's sales from variance. salesWindowUntrustworthy
 * forces the sales term to null (advisory) in both cases — the pure decision
 * these tests pin.
 */
import { describe, it, expect } from "vitest";
import { isGapEligibleDate, salesWindowUntrustworthy } from "@/lib/counts-shared";

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

/**
 * Open-day gap exclusion (council 2026-07-31 Fable C3): same-day event pulls
 * (mid-shift on-visit / closing-confirm) land events HOURS before the ledger
 * materializes. The open ET business date must never count as a gap, or the
 * first same-day pull advisory-nulls every SKU's on-hand until nightfall.
 * Closed days keep strict gap semantics.
 */
describe("isGapEligibleDate", () => {
  it("a closed (past) business date is gap-eligible", () => {
    expect(isGapEligibleDate("2026-07-30", "2026-07-31")).toBe(true);
  });

  it("the OPEN (current) business date is NEVER gap-eligible", () => {
    expect(isGapEligibleDate("2026-07-31", "2026-07-31")).toBe(false);
  });

  it("a future business date is not gap-eligible (defensive)", () => {
    expect(isGapEligibleDate("2026-08-01", "2026-07-31")).toBe(false);
  });

  it("lexicographic comparison holds across month/year boundaries", () => {
    expect(isGapEligibleDate("2026-07-31", "2026-08-01")).toBe(true);
    expect(isGapEligibleDate("2025-12-31", "2026-01-01")).toBe(true);
  });
});
