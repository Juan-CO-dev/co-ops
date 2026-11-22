/**
 * PR SCH (plan r5, 12.5; r1 8.4): the before / after goldens. The "before" cuts were frozen on main's code (93172bf1) in
 * SCH commit 1, before any lib change (`sch-before.json`; never regenerated). The "after" cut (`sch-after.json`) was frozen in
 * SCH commit 4 with its reason: on a HEAVY stations day the per-day structure raises Prep/Dishwasher's head limit by the
 * catering extra, so the extra person is really added inside each order's window (ruling C2); no other change.
 *   UPDATE_SCH_AFTER=1 npx vitest run tests/schedule-sch-goldens.test.ts   (only with a written reason in the commit)
 * Each fixture is cut per date (`schSlices`), so the test names exactly which dates changed.
 *
 * Lead ruling H1 (SCH-1 code review r1) amends 12.5's "every non-heavy date byte-identical" to: SCH may change a non-heavy
 * date's shifts, gaps or reasons ONLY AS A CONSEQUENCE OF A HEAVY DATE'S CHANGED INPUTS; non-heavy dates' own inputs
 * (contexts) stay byte-identical. Proved two ways below: (a) the COUNTERFACTUAL: the new generator, with each heavy date's
 * context swapped back to its before-cut context, reproduces the whole before-cut week byte for byte (stations and tight);
 * (b) the ISOLATED SLACK week (`sch-slack-before.json`, frozen on main's code), where a heavy date cannot couple to any other
 * date, keeps every non-heavy slice byte-identical. (c), the concrete chain that moves `u-13-sam` and `u-n-noe` on the
 * stations week's Mon, Fri and Sat, is written at the stations test.
 *
 * The counterfactual swap: `buildDayNeed` is the ONE place a date's per-day structure and need are made (`buildWeek` stores
 * exactly what it returns; the rest of the context is the date's raw inputs). The module is wrapped (a pass-through unless a
 * swap is set) so that, for a heavy date, it returns the before-cut context's parts: the shop's own structure (no `base`, no
 * `opening`) and main's need grid for that date (`sch-before-heavy-needs.json`, frozen on main's code). The test checks each
 * swapped context's digest against `sch-before.json` before it compares anything else, so the swap is exact.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isHeavyCateringDay } from "@/lib/scheduling/catering-day-shared";
import { canonicalJson, type DayNeed } from "@/lib/scheduling/context-shared";
import { buildWeek, type GeneratorInput } from "@/lib/scheduling/generator/build-shared";
import { generateWeek } from "@/lib/scheduling/generator/dispatch-shared";
import { generatorInputFor } from "@/lib/scheduling/inputs-shared";
import { WEEK as CREW_WEEK } from "./fixtures/schedule/crew-p-street-2026-10-19";
import { DATES, structure } from "./fixtures/schedule/fixtures";
import {
  SCH_ORDERS, SCH_SLACK_ORDERS, changedDates, schCrewInputs, schSlackWeek, schSlices, schStationsWeek, schTightWeek, type WeekSlices,
} from "./fixtures/schedule/sch-fixtures";

/** The counterfactual swap: catering-id key -> the before-cut need. Empty = the real `buildDayNeed`, untouched. */
const swap = vi.hoisted(() => ({ needs: new Map<string, unknown>(), hits: 0 }));
const swapKey = (catering: ReadonlyArray<{ id: string }>) => catering.map((c) => c.id).sort().join(",");
vi.mock("@/lib/scheduling/need-shared", async (orig) => {
  const real = await orig<typeof import("@/lib/scheduling/need-shared")>();
  const buildDayNeed: typeof real.buildDayNeed = (input) => {
    const need = swap.needs.get(swapKey(input.catering));
    if (need === undefined) return real.buildDayNeed(input);
    swap.hits++;
    // The shape (line heads, the shape note) is the shop's own structure's: no catering, no decision = no per-day structure.
    const plain = real.buildDayNeed({ ...input, catering: [], decision: null });
    return { ...plain, need: structuredClone(need) as DayNeed, structure: input.structure, base: null, opening: null };
  };
  return { ...real, buildDayNeed };
});

const BEFORE = path.resolve(__dirname, "fixtures/schedule/sch-before.json");
const AFTER = path.resolve(__dirname, "fixtures/schedule/sch-after.json");
const BEFORE_NEEDS = path.resolve(__dirname, "fixtures/schedule/sch-before-heavy-needs.json");
const SLACK_BEFORE = path.resolve(__dirname, "fixtures/schedule/sch-slack-before.json");
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
    // their CONTEXTS above do not. The whole cut is pinned below; the tight fixture pins the coupling rule; the counterfactual
    // test below proves the movement comes from the heavy dates' inputs and nothing else (ruling H1 a).
    //
    // Ruling H1 (c), the concrete chain that moves u-13-sam and u-n-noe on Mon, Fri and Sat although neither changes on a heavy
    // date (both are FOH line people, so neither can take the extra Prep/Dishwasher head):
    //  1. The heavy dates' need grids grow (the limit rise lets the extra head in). Need head-quarters: Tue 205 -> 227,
    //     Wed 246 -> 254, Thu 246 -> 260, Sun 254 -> 270. Mon 205, Fri 250 and Sat 254 are unchanged.
    //  2. `chooseOffDays` (H9, two days off) ranks each hourly person's open dates by need per open person, walks people in id
    //     order, and takes each chosen off day out of `openCount` for everyone after. u-02-leo, the first with a choice, now
    //     ranks Tue above Mon and takes Mon off (was Tue). Everyone after him sees different open counts, so the off days
    //     cascade: 15 of the 17 people with a choice move theirs, among them u-06-iris (Sat -> Mon), u-10-nora (Mon -> Tue),
    //     u-m-mia (Thu+Fri -> Mon+Sat) and u-n-noe (Sat+Sun -> Tue+Thu). u-13-sam keeps his (Wed).
    //  3. The first fill tier never puts anyone on a chosen off day, and later picks rank people by how far under their soft
    //     minimum the week so far leaves them. So the Mon/Fri/Sat line crews are drawn from different people:
    //     - Mon: leo, iris and mia are off now. leo's Crunchy Boi run (9:30-14:00) goes to noe; mia's 3rd Party run
    //       (9:30-15:30) goes to sam, who moves off Expo (11:30-15:30) to it (+2 h); nora, who now works Mon, takes Expo.
    //     - Fri: mia works Fri now. She takes 3rd Party (9:30-15:30) and, as an adjacent extension, Expo 15:30-16:00, so sam's
    //       Expo is 11:30-15:30 (it was 11:30-16:00: he got that extension for being under his soft minimum). nora's Fri Walk
    //       (11:00-15:00) goes to u-14-wren, so nora is free for the Expo close run (16:00-20:00) and, 16 h under her soft
    //       minimum against noe's 15.5 h (noe now carries Mon's 4.5 h), ranks first: noe loses Fri.
    //     - Sat: mia is off Sat now, so the Expo 15:30-16:00 extension she carried goes to sam (11:30-16:00, under his soft
    //       minimum), and noe, no longer off Sat, takes the Walk run (11:00-15:00).
    //  So both move only through other people's re-chosen off days and the week's running hours, both driven by the heavy
    //  dates' bigger need grids: exactly what the counterfactual removes.
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

  it("ruling H1 (a), the counterfactual: with each heavy date's context swapped back to its before-cut context, the new generator's whole week (shifts, gaps, reasons, notes on every date) is the before-cut byte for byte, stations and tight", () => {
    const needs = JSON.parse(readFileSync(BEFORE_NEEDS, "utf8")) as Record<"stations" | "tight", Record<string, DayNeed>>;
    const weeks: Array<["stations" | "tight", () => GeneratorInput]> = [["stations", schStationsWeek], ["tight", schTightWeek]];
    for (const [name, make] of weeks) {
      const input = make();
      expect(Object.keys(needs[name]).sort(), name).toEqual([...HEAVY].sort());
      swap.needs.clear();
      swap.hits = 0;
      for (const d of HEAVY) swap.needs.set(swapKey(input.days.find((x) => x.date === d)!.catering), needs[name][d]);
      expect(swap.needs.size, name).toBe(HEAVY.length); // every heavy date's orders are its own
      let cut: WeekSlices;
      try { cut = schSlices(buildWeek(input)); } finally { swap.needs.clear(); }
      expect(swap.hits, name).toBe(HEAVY.length);
      // The swap is exact: every date's context (heavy ones included) is the before-cut's, digest for digest.
      for (const d of DATES) expect(cut.byDate[d]!.context, `${name} ${d}`).toBe(before[name].byDate[d]!.context);
      expect(changedDates(before[name], cut), name).toEqual([]);
      expect(canonicalJson(cut), name).toBe(canonicalJson(before[name]));
    }
  });

  it("ruling H1 (b), the isolated slack week: a crew per date, so a heavy date cannot couple to another; only the heavy dates change, and every other slice is the before-cut (main's code) byte for byte", () => {
    const was = (JSON.parse(readFileSync(SLACK_BEFORE, "utf8")) as { slack: WeekSlices }).slack;
    const cut = schSlices(buildWeek(schSlackWeek()));
    const heavy = DATES.filter((_, i) => isHeavyCateringDay((SCH_SLACK_ORDERS[i] ?? []).map(([headcount]) => ({ headcount })), structure().catering));
    expect(heavy).toEqual([DATES[2], DATES[6]]); // Wed 120; Sun 12 + 25, heavy only by the day total
    // Nothing is left to the week-wide repair search (its step counter is shared by every date and printed in a certificate).
    for (const d of DATES) expect(cut.byDate[d]!.gaps, d).toEqual([]);
    expect(changedDates(was, cut)).toEqual(heavy);
    for (const d of DATES.filter((x) => !heavy.includes(x))) {
      expect(canonicalJson(cut.byDate[d]), d).toBe(canonicalJson(was.byDate[d]));
      expect((cut.stats as { hourlyHoursByDate: Record<string, number> }).hourlyHoursByDate[d], d).toBe((was.stats as { hourlyHoursByDate: Record<string, number> }).hourlyHoursByDate[d]);
    }
    for (const d of heavy) expect(cut.byDate[d]!.context, d).not.toBe(was.byDate[d]!.context);
    expect(cut.weekNotes).toEqual(was.weekNotes);
    expect(cut.people).toBe(was.people);
  });
}, 180000);
