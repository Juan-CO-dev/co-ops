/**
 * PR SCH (plan r5, 12.1; r1 8.1 and 8.6): the day total at the four call sites, and the source guard. "Heavy" is the DAY's
 * total guests (PR 5's `isHeavyCateringDay`), never one order alone; every window is `cateringPrepWindowQ`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cateringPrepWindowQ, isHeavyCateringDay } from "@/lib/scheduling/catering-day-shared";
import type { DayContext } from "@/lib/scheduling/context-shared";
import { crewRequired } from "@/lib/scheduling/crew-gap-verifier-shared";
import { buildDayNeed } from "@/lib/scheduling/need-shared";
import { cateringWindows } from "@/lib/scheduling/people-rules-shared";
import { crewCateringHours } from "@/lib/scheduling/settings";
import { scheduledOut, type ScheduleStructure, type ShiftType } from "@/lib/scheduling/structure-shared";
import { I, structure } from "./fixtures/schedule/fixtures";
import { stripComments } from "./fixtures/schedule/no-notify-closure";

type Ev = { id: string; headcount: number; eventQ: number | null };
const ev = (id: string, headcount: number, eventQ: number | null): Ev => ({ id, headcount, eventQ });

/** r1 8.1's table (the shipped catering settings: 30 guests, 1 extra head, 210 min lead). */
const TABLE: Array<{ name: string; events: Ev[]; minHeadcount?: number; heavy: boolean }> = [
  { name: "3 × 20 (heavy by total)", events: [ev("a", 20, 36), ev("b", 20, 44), ev("c", 20, 50)], heavy: true },
  { name: "1 × 25 (not)", events: [ev("a", 25, 48)], heavy: false },
  { name: "1 × 120 (heavy)", events: [ev("a", 120, 36)], heavy: true },
  { name: "20 + 0 + 15 (heavy, 35; the uncounted order's window counts)", events: [ev("a", 20, 40), ev("b", 0, 38), ev("c", 15, null)], heavy: true },
  { name: "minHeadcount 0, one order (heavy)", events: [ev("a", 5, 52)], minHeadcount: 0, heavy: true },
  { name: "minHeadcount 0, no order (not)", events: [], minHeadcount: 0, heavy: false },
];

/** Site A's fixture: Prep/Dishwasher may hold 2 heads, so the extra head shows on its own (no per-day rise needed). */
const siteA = (minHeadcount = 30, extra = 1): ScheduleStructure => structure((s) => {
  s.catering.minHeadcount = minHeadcount; s.catering.extraPrepDishHeads = extra;
  s.positions[I.$DISH]!.headsBefore = 2;
});
const cateringOf = (s: ScheduleStructure, events: Ev[]) =>
  buildDayNeed({ structure: s, dayType: "normal", scheduledOutQ: scheduledOut(s, 45), hourlyCents: null, demandKind: "no_history", catering: events })
    .need.sources.filter((r) => r.source === "catering");
/** The quarters the catering extra may use: every order's window, clipped to the day's start (and the position's open). */
const windowQuarters = (s: ScheduleStructure, events: Ev[]) => {
  const out = new Set<number>();
  for (const e of events) {
    const [a, z] = cateringPrepWindowQ(e.eventQ, s.catering);
    for (let q = Math.max(a, s.shopDay.prepStartQ, s.positions[I.$DISH]!.openQ); q < z; q++) out.add(q);
  }
  return [...out].sort((x, y) => x - y);
};
const runQuarters = (runs: ReturnType<typeof cateringOf>) => runs.flatMap((r) => Array.from({ length: r.toQ - r.fromQ }, (_, i) => r.fromQ + i)).sort((a, b) => a - b);

const TYPE: ShiftType = { id: "morning", name: "Morning", fromQ: 28, toQ: 60, startFlexQ: 0, minLengthQ: 16, headcount: { slow: 1, normal: 1, busy: 1, weekend: 1 }, stations: [I.$PREP], countsTowardMod: true };
const crewStructure = (minHeadcount = 30): ScheduleStructure => structure((s) => {
  s.engine = "crew"; s.shiftTypes = [TYPE];
  s.catering.minHeadcount = minHeadcount;
  s.catering.crewShift = { enabled: true, typeId: "morning", extraHeads: 2 };
});
const crewDay = (s: ScheduleStructure, events: Ev[]) => ({ structure: s, dayType: "normal", inputs: { cateringEvents: events } }) as unknown as DayContext;

describe("the four call sites follow the day total (r1 8.1)", () => {
  for (const row of TABLE) {
    it(row.name, () => {
      const s = siteA(row.minHeadcount ?? 30);
      expect(isHeavyCateringDay(row.events, s.catering)).toBe(row.heavy);
      // A: every order's window on a heavy day (clipped to the day's start); none otherwise.
      expect(runQuarters(cateringOf(s, row.events))).toEqual(row.heavy ? windowQuarters(s, row.events) : []);
      // B and C: the crew engine's catering hours and its required heads.
      const cs = crewStructure(row.minHeadcount ?? 30);
      expect(crewCateringHours(cs, row.events)).toBe(row.heavy ? 8 * 2 : 0);
      expect(crewRequired(TYPE, crewDay(cs, row.events))).toBe(1 + (row.heavy ? 2 : 0));
      // D: cateringWindows = cateringPrepWindowQ per order, id-sorted (no behaviour change).
      const sorted = [...row.events].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      expect(cateringWindows(crewDay(s, row.events))).toEqual(sorted.map((e) => [...cateringPrepWindowQ(e.eventQ, s.catering)]));
    });
  }
  it("site A: extraPrepDishHeads 0 gives no extra head on a heavy day", () => {
    expect(cateringOf(siteA(30, 0), [ev("a", 120, 36)])).toEqual([]);
  });
  it("site A: the extra is clipped to the day's start (a 9:00 order's 5:30 window adds nothing before 7:00)", () => {
    const s = structure((x) => { x.positions[I.$DISH]!.headsBefore = 2; x.positions[I.$DISH]!.openQ = 20; });
    expect(runQuarters(cateringOf(s, [ev("a", 120, 36)]))).toEqual(Array.from({ length: 8 }, (_, i) => 28 + i));
  });
  it("a day can become heavy, never stop being heavy: over 500 order sets, one order passing alone ⇒ heavy by total", () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let i = 0; i < 500; i++) {
      const min = rnd(80);
      const events = Array.from({ length: rnd(5) }, (_, k) => ({ headcount: rnd(90), id: `${k}` }));
      const oldHeavy = events.some((e) => e.headcount >= min);
      if (oldHeavy) expect(isHeavyCateringDay(events, { minHeadcount: min })).toBe(true);
    }
  });
});

// ─── The source guard (r1 8.6) ───────────────────────────────────────────────

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("the source guard (r1 8.6)", () => {
  it("outside catering-day-shared and the structure validator, no scheduling or Dashboard file compares a headcount, and no lib file compares minHeadcount", () => {
    const skip = (f: string) => /catering-day-shared\.ts$|structure-shared\.ts$/.test(f);
    const src = (f: string) => stripComments(readFileSync(f, "utf8"));
    // (Other lib modules range-check an intake headcount, which is not the heavy rule; they never name minHeadcount.)
    const scope = [...walk("lib/scheduling"), ...walk("lib").filter((f) => /[\\/]day-plan[^\\/]*\.ts$/.test(f))].filter((f) => !skip(f));
    expect(scope.filter((f) => /day-plan-shared\.ts$/.test(f))).toHaveLength(1);
    expect(scope.filter((f) => /headcount\s*[<>]=?|[<>]=?\s*\S*minHeadcount/.test(src(f)))).toEqual([]);
    expect(walk("lib").filter((f) => !skip(f)).filter((f) => /minHeadcount\s*[<>]|[<>]=?\s*[\w.!?()]*minHeadcount/.test(src(f)))).toEqual([]);
  });
  it("both sides import the one rule from catering-day-shared", () => {
    for (const f of ["lib/scheduling/need-shared.ts", "lib/scheduling/crew-gap-verifier-shared.ts", "lib/scheduling/people-rules-shared.ts",
      "lib/scheduling/settings.ts", "lib/scheduling/opening-shared.ts", "lib/day-plan-shared.ts"]) {
      expect(readFileSync(f, "utf8"), f).toMatch(/from "(\.\/|@\/lib\/scheduling\/)catering-day-shared"/);
    }
  });
  it("the dependency points one way: no scheduling module imports the Dashboard engine", () => {
    expect(walk("lib/scheduling").filter((f) => /from\s+"[^"]*day-plan(-shared|-load-shared)?"/.test(stripComments(readFileSync(f, "utf8"))))).toEqual([]);
  });
});
