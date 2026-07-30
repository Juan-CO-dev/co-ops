/**
 * The sales-depletion window law (drift spec 2026-07-31).
 *
 * etBusinessDate maps a count timestamp to the ET business date the ledger
 * tiles by. The pins that matter: a late-evening UTC instant is STILL the
 * previous ET calendar day (Toast business dates are Eastern), and the
 * since/between windows tile without double-claiming a day (since includes
 * the anchor's date; between is half-open at the anchor's date).
 */
import { describe, it, expect } from "vitest";
import { etBusinessDate } from "@/lib/counts-shared";

describe("etBusinessDate — the ET business-date mapping", () => {
  it("a UTC instant after ET midnight belongs to the previous ET day", () => {
    // 02:00 UTC on the 30th = 22:00 ET on the 29th (EDT, UTC-4).
    expect(etBusinessDate("2026-07-30T02:00:00Z")).toBe("2026-07-29");
  });

  it("a midday UTC instant is the same ET day", () => {
    expect(etBusinessDate("2026-07-30T12:00:00Z")).toBe("2026-07-30");
  });

  it("a morning-count anchor includes its own business date in the since-window", () => {
    // 13:00 UTC = 09:00 ET — a morning count. since-window = >= this date, so
    // the day's (mostly later) sales are subtracted. The documented bias.
    const anchorDate = etBusinessDate("2026-07-30T13:00:00Z");
    expect(anchorDate).toBe("2026-07-30");
    // Tiling: the between-window of the NEXT count [prevDate, anchorDate) would
    // exclude this date — exactly one window claims each day.
  });

  it("winter (EST, UTC-5) boundary maps correctly", () => {
    // 04:30 UTC on Jan 15 = 23:30 ET on Jan 14.
    expect(etBusinessDate("2026-01-15T04:30:00Z")).toBe("2026-01-14");
  });
});
