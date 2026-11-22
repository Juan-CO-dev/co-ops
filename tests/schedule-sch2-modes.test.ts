/**
 * PR SCH-2 (plan r5 4.1, 4.2, 12.2, 12.5; rulings A2, C3, C4, C6, H1): the per-shop earlier-opening MODE switched on.
 * `earlyOpenModeOf` reads `catering.earlyOpenMode` (absent = manual), and `resolveOpening` — called by `buildDayNeed` (both
 * engines) and by `generatorInputFor` (the estimated-availability widening) — follows it with no other change.
 *
 *  - the mode: absent / manual / semi / auto, and an unknown value read as manual;
 *  - SEMI NEVER APPLIES ITSELF: a firing trigger stores a `proposed` opening and nothing else — the per-day structure, the
 *    need, the availability, every shift, gap and reason are the manual week's, on both engines, across regenerates and
 *    edits of other dates; only a GM's Accept applies it;
 *  - AUTO applies the candidate start on exactly the dates whose trigger fires (heavy days only, T1 or T2), recomputed on
 *    every rebuild; a GM's Decline silences it and survives regenerates;
 *  - the goldens (plan 12.5, amended by ruling H1): every date's own inputs other than the trigger dates' stay the manual
 *    week's (modulo the mode key itself), and every other change is a CONSEQUENCE of the trigger dates' inputs — proved by
 *    the counterfactual (the trigger dates' per-day need and, on the crew engine, their widened availability swapped back to
 *    the manual week's reproduce the manual week byte for byte) and by the isolated slack week (only the trigger dates move);
 *  - the no-change proof: the default (no key, the gate closed) reproduces SCH-1's frozen after-cut and the crew before-cut.
 * Frozen semi / auto cuts: `tests/fixtures/schedule/sch2-modes.json` (UPDATE_SCH2_MODES=1, only with a written reason).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canonicalJson } from "@/lib/scheduling/context-shared";
import { buildWeek, type GeneratorInput, type GeneratorOutput } from "@/lib/scheduling/generator/build-shared";
import { generateWeek } from "@/lib/scheduling/generator/dispatch-shared";
import { generatorInputFor, type SchedulingInputs } from "@/lib/scheduling/inputs-shared";
import { earlyOpenModeOf, openingTriggers, resolveOpening } from "@/lib/scheduling/opening-shared";
import type { EarlyOpenMode, ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { DATES as CREW_DATES, WEEK as CREW_WEEK } from "./fixtures/schedule/crew-p-street-2026-10-19";
import { DATES, structure } from "./fixtures/schedule/fixtures";
import { SCH_ORDERS, SCH_SLACK_ORDERS, changedDates, schCrewInputs, schSlackWeek, schSlices, schStationsWeek, schTightWeek, type WeekSlices } from "./fixtures/schedule/sch-fixtures";

/** The counterfactual swap (as tests/schedule-sch-goldens.test.ts): catering-id key → the manual week's buildDayNeed result. */
const swap = vi.hoisted(() => ({ manual: false, keys: new Set<string>(), hits: 0 }));
const swapKey = (catering: ReadonlyArray<{ id: string }>) => catering.map((c) => c.id).sort().join(",");
vi.mock("@/lib/scheduling/need-shared", async (orig) => {
  const real = await orig<typeof import("@/lib/scheduling/need-shared")>();
  const buildDayNeed: typeof real.buildDayNeed = (input) => {
    if (!swap.manual || !swap.keys.has(swapKey(input.catering))) return real.buildDayNeed(input);
    swap.hits++;
    // The date as the MANUAL week builds it: the same inputs with the mode removed.
    return real.buildDayNeed({ ...input, structure: withMode(input.structure, undefined) });
  };
  return { ...real, buildDayNeed };
});

function withMode<T extends ScheduleStructure>(s: T, mode: EarlyOpenMode | undefined): T {
  const n = { ...s, catering: { ...s.catering } };
  if (mode === undefined) delete n.catering.earlyOpenMode; else n.catering.earlyOpenMode = mode;
  return n;
}
/** The output with the mode key removed everywhere (the only input every date shares) and, for semi, the proposals removed. */
function normalized(out: GeneratorOutput, dropProposals = false): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (k === "earlyOpenMode") continue;
        if (dropProposals && k === "opening" && (x as { status?: string })?.status === "proposed") continue;
        o[k] = walk(x);
      }
      return o;
    }
    return v;
  };
  return canonicalJson(walk(out));
}

const stations = (mode?: EarlyOpenMode): GeneratorInput => { const g = schStationsWeek(); return { ...g, structure: withMode(g.structure, mode) }; };
const tight = (mode?: EarlyOpenMode): GeneratorInput => { const g = schTightWeek(); return { ...g, structure: withMode(g.structure, mode) }; };
const slack = (mode?: EarlyOpenMode): GeneratorInput => { const g = schSlackWeek(); return { ...g, structure: withMode(g.structure, mode) }; };
const crewInputs = (mode?: EarlyOpenMode): SchedulingInputs => {
  const i = schCrewInputs();
  i.structure = { ...i.structure, structure: withMode(i.structure.structure, mode) };
  return i;
};
const crewInput = (mode?: EarlyOpenMode) => generatorInputFor(crewInputs(mode), CREW_WEEK, { today: CREW_WEEK });
const run = (g: GeneratorInput) => (g.structure.engine === "crew" ? generateWeek(g) : buildWeek(g));

/** The trigger dates (heavy AND T1 or T2) of a stations fixture week, by its order table. */
const triggerDates = (orders: typeof SCH_ORDERS, prefix: string) => DATES.filter((_, i) =>
  openingTriggers(structure(), (orders[i] ?? []).map(([headcount, eventQ], k) => ({ id: `${prefix}${i}-${k}`, headcount, eventQ }))).triggers.length > 0);
const STATIONS_TRIGGERS = triggerDates(SCH_ORDERS, "ev-");
const SLACK_TRIGGERS = triggerDates(SCH_SLACK_ORDERS, "ev-s");
const CREW_TRIGGERS = [CREW_DATES[1]!, CREW_DATES[3]!]; // 3 × 20 at 9:00 (60 guests: T1 and T2), 120 at 9:00

describe("the mode (earlyOpenModeOf)", () => {
  it("absent = manual; each stored mode is read; anything else reads as manual (never a guess)", () => {
    expect(earlyOpenModeOf(structure())).toBe("manual");
    for (const m of ["manual", "semi", "auto"] as const) expect(earlyOpenModeOf(withMode(structure(), m))).toBe(m);
    for (const bad of ["Auto", "", null, 1]) expect(earlyOpenModeOf({ ...structure(), catering: { ...structure().catering, earlyOpenMode: bad as never } })).toBe("manual");
  });
  it("resolveOpening follows the structure's mode when none is passed", () => {
    const heavy = [{ headcount: 120, eventQ: 36 }];
    expect(resolveOpening(structure(), heavy, null)).toBeNull();
    expect(resolveOpening(withMode(structure(), "manual"), heavy, null)).toBeNull();
    expect(resolveOpening(withMode(structure(), "semi"), heavy, null)).toMatchObject({ status: "proposed", startQ: 22, triggers: ["prep_fit", "huge_day"] });
    expect(resolveOpening(withMode(structure(), "auto"), heavy, null)).toMatchObject({ status: "auto", startQ: 22 });
    // An explicit mode still wins (the helper-level tests in schedule-opening.test.ts keep passing their own).
    expect(resolveOpening(withMode(structure(), "auto"), heavy, null, "manual")).toBeNull();
  });
  it("the fixtures' trigger dates: stations Tue (60, T1+T2), Wed (120, T1+T2), Sun (37, T1); never Thu (40 at 1:00 PM) or the light Mon / Fri", () => {
    expect(STATIONS_TRIGGERS).toEqual([DATES[1], DATES[2], DATES[6]]);
    expect(SLACK_TRIGGERS).toEqual([DATES[2], DATES[6]]);
  });
});

describe("semi never applies itself", () => {
  const cases: Array<[string, () => GeneratorInput, () => GeneratorInput, string[]]> = [
    ["stations", () => stations("semi"), () => stations(), STATIONS_TRIGGERS],
    ["tight", () => tight("semi"), () => tight(), STATIONS_TRIGGERS],
    ["slack", () => slack("semi"), () => slack(), SLACK_TRIGGERS],
    ["crew", () => crewInput("semi"), () => crewInput(), CREW_TRIGGERS],
  ];
  for (const [name, semi, manual, triggers] of cases) {
    it(`${name}: a proposal on exactly the trigger dates; every shift, gap, reason, need and structure is the manual week's`, () => {
      const si = semi(), mi = manual();
      // The generator input: no date's availability widens for a proposal.
      expect(canonicalJson(si.people)).toBe(canonicalJson(mi.people));
      const s = run(si), m = run(mi);
      const proposed = Object.entries(s.context.days).filter(([, d]) => d.opening).map(([date, d]) => [date, d.opening!.status, d.opening!.startQ]);
      expect(proposed).toEqual(triggers.map((d) => [d, "proposed", 22]));
      for (const d of triggers) expect(s.context.days[d]!.structure.shopDay.prepStartQ, d).toBe(28);
      expect(normalized(s, true)).toBe(normalized(m));
    }, 120000);
  }
});

describe("auto applies on exactly the trigger dates", () => {
  it("stations: Tue, Wed and Sun open at 5:30 (status auto, the per-day structure's prep start); Thu (heavy, no trigger) and the light dates do not", () => {
    const out = run(stations("auto"));
    for (const d of DATES) {
      const day = out.context.days[d]!;
      if (STATIONS_TRIGGERS.includes(d)) {
        expect(day.opening, d).toMatchObject({ status: "auto", startQ: 22, normalStartQ: 28 });
        expect(day.structure.shopDay.prepStartQ, d).toBe(22);
        expect(day.base?.prepStartQ, d).toBe(28);
      } else {
        expect(day.opening, d).toBeUndefined();
        expect(day.structure.shopDay.prepStartQ, d).toBe(28);
      }
    }
  }, 120000);
  it("crew (P Street's engine): Tue and Thu open at 5:30, their estimated availability widens to it, no other date's does", () => {
    const a = crewInput("auto"), m = crewInput();
    const out = generateWeek(a);
    for (const d of CREW_DATES) {
      const opened = CREW_TRIGGERS.includes(d);
      expect(out.context.days[d]?.opening?.status ?? null, d).toBe(opened ? "auto" : null);
      expect(out.context.days[d]!.structure.shopDay.prepStartQ, d).toBe(opened ? 22 : 28);
    }
    const byUser = new Map(m.people.map((p) => [p.userId, p]));
    for (const p of a.people) {
      const was = byUser.get(p.userId)!;
      for (const d of CREW_DATES) if (!CREW_TRIGGERS.includes(d)) expect(canonicalJson(p.availability[d] ?? null), `${p.userId} ${d}`).toBe(canonicalJson(was.availability[d] ?? null));
      expect(canonicalJson({ ...p, availability: {} })).toBe(canonicalJson({ ...was, availability: {} }));
    }
  }, 120000);
});

describe("ruling H1 applied to the auto goldens: every change is a consequence of the trigger dates' inputs", () => {
  it("(a) the counterfactual, stations and tight: the trigger dates' per-day need swapped back to the manual week's reproduces the manual week byte for byte", () => {
    for (const [name, make] of [["stations", stations], ["tight", tight]] as const) {
      const input = make("auto");
      swap.keys = new Set(STATIONS_TRIGGERS.map((d) => swapKey(input.days.find((x) => x.date === d)!.catering)));
      swap.manual = true; swap.hits = 0;
      let out: GeneratorOutput;
      try { out = run(input); } finally { swap.manual = false; }
      expect(swap.hits, name).toBe(STATIONS_TRIGGERS.length);
      expect(normalized(out), name).toBe(normalized(run(make())));
    }
  }, 180000);
  it("(a) the counterfactual, crew: the trigger dates' need AND their widened availability swapped back reproduce the manual week byte for byte", () => {
    const a = crewInput("auto"), m = crewInput();
    swap.keys = new Set(CREW_TRIGGERS.map((d) => swapKey(a.days.find((x) => x.date === d)!.catering)));
    swap.manual = true; swap.hits = 0;
    let out: GeneratorOutput;
    try { out = generateWeek({ ...a, people: m.people }); } finally { swap.manual = false; }
    expect(swap.hits).toBe(CREW_TRIGGERS.length);
    expect(normalized(out)).toBe(normalized(generateWeek(m)));
  }, 180000);
  it("(b) the isolated slack week: only the trigger dates (Wed, Sun) change; every other slice is the manual week's", () => {
    const strip = (o: GeneratorOutput) => schSlices(JSON.parse(normalized(o)) as GeneratorOutput);
    const a = strip(run(slack("auto"))), m = strip(run(slack()));
    expect(changedDates(m, a)).toEqual(SLACK_TRIGGERS);
  }, 120000);
});

describe("the frozen cuts and the no-change proof", () => {
  const FILE = path.resolve(__dirname, "fixtures/schedule/sch2-modes.json");
  const SCH1_AFTER = path.resolve(__dirname, "fixtures/schedule/sch-after.json");
  const SCH1_BEFORE = path.resolve(__dirname, "fixtures/schedule/sch-before.json");
  type Cuts = Record<string, WeekSlices>;
  const cut = (o: GeneratorOutput) => schSlices(o);
  it("the default (no key: the gate closed) is SCH-1's frozen after-cut (stations, tight) and the crew before-cut, byte for byte", () => {
    const after = JSON.parse(readFileSync(SCH1_AFTER, "utf8")) as Cuts, before = JSON.parse(readFileSync(SCH1_BEFORE, "utf8")) as Cuts;
    expect(canonicalJson(cut(run(stations())))).toBe(canonicalJson(after.stations));
    expect(canonicalJson(cut(run(tight())))).toBe(canonicalJson(after.tight));
    expect(canonicalJson(cut(generateWeek(crewInput())))).toBe(canonicalJson(before.crew));
    // An explicit "manual" stores the key in each date's structure (the setting), and nothing else differs.
    expect(normalized(run(stations("manual")))).toBe(normalized(run(stations())));
  }, 180000);
  it("semi and auto are frozen (stations, tight, slack, crew)", () => {
    const now: Cuts = {};
    for (const mode of ["semi", "auto"] as const) {
      now[`stations_${mode}`] = cut(run(stations(mode)));
      now[`tight_${mode}`] = cut(run(tight(mode)));
      now[`slack_${mode}`] = cut(run(slack(mode)));
      now[`crew_${mode}`] = cut(generateWeek(crewInput(mode)));
    }
    if (process.env.UPDATE_SCH2_MODES === "1") {
      writeFileSync(FILE, JSON.stringify({ _header: "PR SCH-2 semi / auto cuts, frozen in SCH-2 commit 4. Regenerate only with a written reason.", ...JSON.parse(canonicalJson(now)) }, null, 1) + "\n");
    }
    expect(existsSync(FILE)).toBe(true);
    const frozen = JSON.parse(readFileSync(FILE, "utf8")) as Cuts;
    for (const k of Object.keys(now)) expect(canonicalJson(now[k]), k).toBe(canonicalJson(frozen[k]));
  }, 300000);
});
