/**
 * PR SCH (plan r5, 12.5; r1 8.4): the before / after goldens. The "before" cuts were frozen on main's code (93172bf1) in
 * SCH commit 1, before any lib change (`sch-before.json`; never regenerated). The "after" cut (`sch-after.json`) was frozen in
 * SCH commit 4 with its reason: on a HEAVY stations day the per-day structure raises Prep/Dishwasher's head limit by the
 * catering extra, so the extra person is really added inside each order's window (ruling C2); no other change.
 *   UPDATE_SCH_AFTER=1 npx vitest run tests/schedule-sch-goldens.test.ts   (only with a written reason in the commit)
 * Each fixture is cut per date (`schSlices`), so the test names exactly which dates changed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isHeavyCateringDay } from "@/lib/scheduling/catering-day-shared";
import { canonicalJson } from "@/lib/scheduling/context-shared";
import { buildWeek } from "@/lib/scheduling/generator/build-shared";
import { generateWeek } from "@/lib/scheduling/generator/dispatch-shared";
import { generatorInputFor } from "@/lib/scheduling/inputs-shared";
import { WEEK as CREW_WEEK } from "./fixtures/schedule/crew-p-street-2026-10-19";
import { DATES, structure } from "./fixtures/schedule/fixtures";
import { SCH_ORDERS, changedDates, schCrewInputs, schSlices, schStationsWeek, schTightWeek, type WeekSlices } from "./fixtures/schedule/sch-fixtures";

const BEFORE = path.resolve(__dirname, "fixtures/schedule/sch-before.json");
const AFTER = path.resolve(__dirname, "fixtures/schedule/sch-after.json");
const write = (file: string, v: unknown) => writeFileSync(file, JSON.stringify(JSON.parse(canonicalJson(v)), null, 1) + "\n");

type Cuts = { stations: WeekSlices; tight: WeekSlices; crew: WeekSlices };
function outputs(): Cuts {
  return {
    stations: schSlices(buildWeek(schStationsWeek())),
    tight: schSlices(buildWeek(schTightWeek())),
    crew: schSlices(generateWeek(generatorInputFor(schCrewInputs(), CREW_WEEK, { today: CREW_WEEK }))),
  };
}
const before = JSON.parse(readFileSync(BEFORE, "utf8")) as Cuts;
/** The table's heavy dates by the DAY TOTAL (Tue 60, Wed 120, Thu 40, Sun 37 at the shipped 30): r1 8.4. */
const HEAVY = DATES.filter((_, i) => isHeavyCateringDay((SCH_ORDERS[i] ?? []).map(([headcount]) => ({ headcount })), structure().catering));

describe("PR SCH: the week changes only where it should (12.5)", () => {
  const now = outputs();
  if (process.env.UPDATE_SCH_AFTER === "1") write(AFTER, { _header: "PR SCH after-cut, frozen in SCH commit 4: the heavy-day Prep/Dishwasher limit rise. Regenerate only with a written reason.", ...now });

  it("the heavy dates are Tue, Wed, Thu and Sun (Tue and Sun heavy only by the day total)", () => {
    expect(HEAVY).toEqual([DATES[1], DATES[2], DATES[3], DATES[6]]);
  });

  /** The users whose shifts differ on `d` between two cuts. */
  const movedOn = (a: WeekSlices, b: WeekSlices, d: string) => {
    const of = (cut: WeekSlices) => {
      const m = new Map<string, string>();
      for (const sh of cut.byDate[d]!.shifts as Array<{ userId: string }>) m.set(sh.userId, `${m.get(sh.userId) ?? ""}${canonicalJson(sh)}`);
      return m;
    };
    const x = of(a), y = of(b);
    return new Set([...x.keys(), ...y.keys()].filter((u) => x.get(u) !== y.get(u)));
  };
  /** Weekly coupling (plan risk 5): a person may move on an unaffected date only if they also moved on an affected one. */
  const coupledOnly = (a: WeekSlices, b: WeekSlices) => {
    const affected = new Set(HEAVY.flatMap((d) => [...movedOn(a, b, d)]));
    for (const d of DATES.filter((x) => !HEAVY.includes(x))) for (const u of movedOn(a, b, d)) expect(affected.has(u), `${u} moved on ${d} only`).toBe(true);
  };

  it("stations, mode manual: every date that is not heavy keeps its context (structure, need, inputs) byte for byte; the 120-guest Wednesday changed; the whole cut is the frozen after-golden", () => {
    const changed = changedDates(before.stations, now.stations);
    expect(changed).toContain(DATES[2]);
    for (const d of DATES.filter((x) => !HEAVY.includes(x))) expect(now.stations.byDate[d]!.context, d).toBe(before.stations.byDate[d]!.context);
    for (const d of HEAVY.filter((x) => (SCH_ORDERS[DATES.indexOf(x)] ?? []).length > 0)) expect(now.stations.byDate[d]!.context, d).not.toBe(before.stations.byDate[d]!.context);
    // The generator is week-level (two days off chosen from every date's need, overtime, caps): on this ample roster the extra
    // heavy-day heads re-choose people's days off, so SHIFTS on unaffected dates move too (plan risk 5, weekly coupling);
    // their CONTEXTS above do not. The whole cut is pinned below; the tight fixture pins the coupling rule.
    expect(existsSync(AFTER)).toBe(true);
    expect(canonicalJson(now.stations)).toBe(canonicalJson((JSON.parse(readFileSync(AFTER, "utf8")) as Cuts).stations));
  });

  it("the tight fixture: strict per-date context equality on unaffected dates; a person whose shifts moved there also moved on an affected date", () => {
    const unaffected = DATES.filter((d) => !HEAVY.includes(d));
    for (const d of unaffected) expect(now.tight.byDate[d]!.context, d).toBe(before.tight.byDate[d]!.context);
    coupledOnly(before.tight, now.tight);
    expect(canonicalJson(now.tight)).toBe(canonicalJson((JSON.parse(readFileSync(AFTER, "utf8")) as Cuts).tight));
  });

  it("crew, LIVE configuration (crewShift absent, mode manual) with heavy days: no date changes at all (nothing changes at P Street on ship)", () => {
    expect(changedDates(before.crew, now.crew)).toEqual([]);
    expect(canonicalJson(now.crew)).toBe(canonicalJson(before.crew));
  });
}, 180000);
