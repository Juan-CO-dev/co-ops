/**
 * Audit W20/B200: the "most used items" rank (receiving prefill + the ordering walk) took its
 * 30-day sales bound from the UTC date of "now minus 30 days". After 8 PM ET (7 PM in winter)
 * that is a day AHEAD of the Eastern date, so the sales lane lost a whole business day while
 * the production lane kept it. Both lanes now start at the same ET business day.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { trailingEtWindow } from "@/lib/operational-day";

describe("trailingEtWindow", () => {
  it("an ET-evening load keeps the day 30 back", () => {
    // 2026-11-15T02:00Z is 9 PM ET on Nov 14. The old bound was the UTC date 2026-10-16.
    expect(trailingEtWindow("2026-11-15T02:00:00Z", 30)).toEqual({ fromDate: "2026-10-15", startIso: "2026-10-15T04:00:00.000Z" });
  });
  it("a morning load on the same ET day gives the same window", () => {
    expect(trailingEtWindow("2026-11-14T15:00:00Z", 30)).toEqual(trailingEtWindow("2026-11-15T02:00:00Z", 30));
  });
  it("the start is that day's ET midnight on either side of a clock change", () => {
    // Winter start (EST, UTC-5), read from daylight time.
    expect(trailingEtWindow("2026-03-20T12:00:00Z", 30)).toEqual({ fromDate: "2026-02-18", startIso: "2026-02-18T05:00:00.000Z" });
    // The spring-forward day itself: midnight is still standard time.
    expect(trailingEtWindow("2026-04-07T12:00:00Z", 30)).toEqual({ fromDate: "2026-03-08", startIso: "2026-03-08T05:00:00.000Z" });
    // The fall-back day itself: midnight is still daylight time.
    expect(trailingEtWindow("2026-12-01T12:00:00Z", 30)).toEqual({ fromDate: "2026-11-01", startIso: "2026-11-01T04:00:00.000Z" });
  });
  it("refuses a nonsense window", () => {
    expect(() => trailingEtWindow("2026-11-14T15:00:00Z", -1)).toThrow();
    expect(() => trailingEtWindow("not a date", 30)).toThrow();
  });
});

describe("both usage-rank twins use one ET window for both lanes", () => {
  for (const file of ["lib/receiving.ts", "lib/ordering.ts"]) {
    it(file, () => {
      const src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      const start = src.indexOf("async function loadSkuUsageRank(");
      expect(start).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf("\n}\n", start));
      expect(body).toContain("trailingEtWindow(new Date().toISOString(), 30)");
      expect(body).not.toContain(".slice(0, 10)");
      expect(body).not.toContain("cutoffIso");
      // Production lane: from the ET start of that day, inclusive. Sales lane: that same date.
      expect(body).toContain('.gte("produced_at", startIso)');
      expect(body).toContain("fromDate })");
    });
  }
});
