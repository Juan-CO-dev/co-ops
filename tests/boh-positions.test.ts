/**
 * Scheduling Phase 1, Task 14b (R3) — the BOH positions dry run's pure report, over fixture rows. The script
 * is read-only and never run here; the data step is a human act through the station admin.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOH_POSITION_NAMES, bohPositionsReport, formatBohReport, type BohPositionRow } from "@/lib/people/boh-positions-shared";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OFF = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const shops = [{ id: B, name: "Shop B", active: true }, { id: A, name: "Shop A", active: true }, { id: OFF, name: "Closed", active: false }];
const stations = [
  { id: "sa", location_id: A, name: "Prep", active: true },
  { id: "sb", location_id: B, name: "Back of house", active: true },
];
const pos = (id: string, station: string, loc: string, name: string, active = true, es: string | null = null): BohPositionRow =>
  ({ id, station_id: station, location_id: loc, name, name_es: es, active });

describe("bohPositionsReport", () => {
  it("both shops with both positions active → ready (exit 0); inactive shops are not reported", () => {
    const r = bohPositionsReport(shops, stations, [
      pos("p1", "sa", A, "Prep", true, "Prep"), pos("p2", "sa", A, "Prep/Dishwasher", true, "Prep/Lavaplatos"),
      pos("p3", "sb", B, "Prep"), pos("p4", "sb", B, "Prep/Dishwasher"),
    ]);
    expect(r.ready).toBe(true);
    expect(r.shops.map((s) => s.shop)).toEqual(["Shop A", "Shop B"]);
    expect(r.shops[0]!.findings[1]).toEqual({ name: "Prep/Dishwasher", state: "ok", matches: [{ positionId: "p2", station: "Prep", nameEs: "Prep/Lavaplatos", active: true }] });
    expect(formatBohReport(r)).toContain("All shops have both positions. Exit 0.");
  });

  it("missing, inactive and duplicate are named; one gap makes the whole report not ready", () => {
    const r = bohPositionsReport(shops, stations, [
      pos("p1", "sa", A, "Prep"), pos("p1b", "sa", A, "Prep"),
      pos("p3", "sb", B, "Prep/Dishwasher", false),
    ]);
    expect(r.ready).toBe(false);
    const states = r.shops.map((s) => s.findings.map((f) => `${f.name}:${f.state}`));
    expect(states).toEqual([["Prep:duplicate", "Prep/Dishwasher:missing"], ["Prep:missing", "Prep/Dishwasher:inactive"]]);
    const text = formatBohReport(r);
    expect(text).toContain("Shop A (" + A + "): NOT READY");
    expect(text).toContain("Prep/Dishwasher: inactive — Back of house [inactive] · es: (none)");
    expect(text).toContain("Exit 1.");
  });

  it("names match EXACTLY (a report, not logic): 'prep' or 'Prep ' do not count", () => {
    const r = bohPositionsReport(shops, stations, [pos("x", "sa", A, "prep"), pos("y", "sa", A, "Prep "), pos("z", "sa", A, "Prep / Dishwasher")]);
    expect(r.shops[0]!.findings.every((f) => f.state === "missing")).toBe(true);
    expect(BOH_POSITION_NAMES).toEqual(["Prep", "Prep/Dishwasher"]);
  });

  it("no active shop → not ready", () => {
    expect(bohPositionsReport([], [], []).ready).toBe(false);
  });

  it("the script is read-only, guarded by pathToFileURL, and never keys on a shop code", () => {
    const src = readFileSync("scripts/check-boh-positions.ts", "utf8");
    expect(src).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
    expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    expect(src).not.toMatch(/["'](EM|MEP)["']/);
    const runbook = readFileSync("docs/runbooks/boh-positions.md", "utf8");
    expect(runbook).toContain("/admin/stations");
    expect(runbook).toContain("never a migration");
  });
});
