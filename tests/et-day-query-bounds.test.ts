import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { etYmdMinusDays, operationalDayUtcRange } from "@/lib/operational-day";

// These timestamp filters accept ET calendar dates. Pin every query site that once
// converted those dates to UTC midnight, and the actual boundary on all four day types.
const SITES = [
  ["lib/maintenance.ts", ".gte(\"created_at\", operationalDayUtcRange(args.sinceDate).startIso)"],
  ["lib/ezcater/depletion.ts", ".gte(\"occurred_at\", operationalDayUtcRange(etYmdMinusDays(window.fromDate, 1)).startIso)"],
  ["lib/ezcater/depletion.ts", ".gte(\"produced_at\", operationalDayUtcRange(etYmdMinusDays(window.fromDate, 2)).startIso)"],
  ["lib/ezcater/depletion.ts", ".lt(\"produced_at\", operationalDayUtcRange(etYmdMinusDays(end, -1)).startIso)"],
  ["lib/ezcater/pass2.ts", ".gte(\"occurred_at\", operationalDayUtcRange(etYmdMinusDays(fromDate, 1)).startIso)"],
  ["lib/ezcater/pass2.ts", ".gte(\"produced_at\", operationalDayUtcRange(etYmdMinusDays(fromDate, 2)).startIso)"],
  ["lib/ezcater/pass2.ts", ".lt(\"produced_at\", operationalDayUtcRange(etYmdMinusDays(toDate, -2)).startIso)"],
  ["lib/dynamic-pars.ts", ".gte(\"produced_at\", operationalDayUtcRange(windowStart).startIso)"],
  ["lib/dynamic-pars.ts", ".gte(\"acted_at\", operationalDayUtcRange(budgetFrom).startIso)"],
] as const;

describe("ET calendar dates used as timestamptz query bounds", () => {
  it.each(SITES)("%s uses ET midnight for %s", (file, filter) => {
    expect(readFileSync(file, "utf8")).toContain(filter);
  });

  it.each([
    ["2026-07-10", "2026-07-10T04:00:00.000Z"],
    ["2026-01-14", "2026-01-14T05:00:00.000Z"],
    ["2026-11-01", "2026-11-01T04:00:00.000Z"],
    ["2027-03-14", "2027-03-14T05:00:00.000Z"],
  ])("starts evidence windows at ET midnight on %s", (day, expected) => {
    const start = operationalDayUtcRange(day).startIso;
    expect(start).toBe(expected);
    expect(Date.parse(start) - Date.parse(`${day}T00:00:00Z`)).toBeGreaterThan(0);
    expect(operationalDayUtcRange(etYmdMinusDays(day, -1)).startIso).toBe(operationalDayUtcRange(day).endExclusiveIso);
    // A row immediately before the ET boundary belongs to the prior day.
    expect(new Date(Date.parse(start) - 1).toISOString() < start).toBe(true);
  });
});
