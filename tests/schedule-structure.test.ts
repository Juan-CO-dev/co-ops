/**
 * Scheduling Phase 2, Task 1 — the schedule structure (a per-shop SETTING, §5.7) and its validator.
 * The TS half of the ONE rule set: the same case file runs against the SQL CHECK in
 * scripts/sql-harness-0274.mjs (Task 13).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CASE_DEFAULTS, CASE_POSITION_IDS, expectedStructureKey, loadStructureCases, materializeStructureCase, shopBase,
} from "../scripts/schedule-structure-cases.mjs";
import {
  SCHEDULE_STRUCTURE_DEFAULTS, checklistFits, crewFor, lineBounds, positionLimit, primaryOf, scheduledOut,
  secondaryOf, structureFromStations, structureProblem, validScheduleStructure, waveProfile, waveSlots, type ScheduleStructure,
} from "@/lib/scheduling/structure-shared";

interface StructureCase { name: string; valid: boolean; infeasible?: boolean; key?: string }
const cases = loadStructureCases() as StructureCase[];
const I = CASE_POSITION_IDS;

describe("the shared structure case file against validScheduleStructure", () => {
  it("the case file's defaults ARE SCHEDULE_STRUCTURE_DEFAULTS (the SQL harness starts from the same set)", () => {
    expect(CASE_DEFAULTS).toEqual(SCHEDULE_STRUCTURE_DEFAULTS);
  });

  it("the defaults validate and the labor basis defaults to TOTAL (R4), 28%", () => {
    expect(validScheduleStructure(SCHEDULE_STRUCTURE_DEFAULTS)).toEqual({ ok: true });
    expect(SCHEDULE_STRUCTURE_DEFAULTS.labor.basis).toBe("total");
    expect(SCHEDULE_STRUCTURE_DEFAULTS.labor.targetPct).toBe(28);
    expect(SCHEDULE_STRUCTURE_DEFAULTS.limits.managerFloorH).toBe(32);
    // CC chunk B ruling 3: a daily maximum shift length, a per-shop setting (the minimum stays 4 h). CC chunk C ruling 2:
    // the default is 10.5 h (pending Juan) — 10 h was below the v17 line day (10:30 → 20:45 = 10.25 h).
    expect(SCHEDULE_STRUCTURE_DEFAULTS.limits.maxShiftH).toBe(10.5);
    expect(SCHEDULE_STRUCTURE_DEFAULTS.limits.minimumShiftQ).toBe(16);
    // Juan 2026-10-16 (decision 8): no prep manager role is in use and the catering manager is ON the roster by default.
    expect(SCHEDULE_STRUCTURE_DEFAULTS.roster.excludedRoles).toEqual(["cgs", "social_media_mgr"]);
  });

  it("Juan 2026-10-16: the salaried week (decision 4), KH-as-MoD from 7:00 PM (decision 6)", () => {
    // 40 h total target (station + MoD) and a 10 h flex used ONLY by zero-hourly-cost fills; the 32 h station limit stays.
    expect(SCHEDULE_STRUCTURE_DEFAULTS.limits.salariedTargetWeekH).toBe(40);
    expect(SCHEDULE_STRUCTURE_DEFAULTS.limits.salariedFlexH).toBe(10);
    expect(SCHEDULE_STRUCTURE_DEFAULTS.limits.managerFloorH).toBe(32);
    expect(SCHEDULE_STRUCTURE_DEFAULTS.limits.salariedStayLonger).toBe(true);
    // A Key Holder counts as the manager on duty from the 7:00 PM quarter to close, both shops.
    expect(SCHEDULE_STRUCTURE_DEFAULTS.leadership.keyHolderModAfterQ).toBe(76);
    for (const n of ["salaried flex 0 h", "salaried flex 10 h", "salaried flex 10.25 h", "salaried flex negative", "salaried flex off the grid",
      "salaried flex missing", "salaried week target 80.25 h", "salaried week target missing", "salaried week target sent as a string"]) {
      expect(cases.map((c) => c.name)).toContain(n);
    }
  });

  it("every rule in the plan has a valid AND an invalid row", () => {
    const names = cases.map((c) => c.name);
    for (const n of ["open after trim", "trim after close", "position heads 9", "crew heads 9", "slow threshold not below busy",
      "a quarter off the grid (fraction)", "out latest past midnight", "out earliest after out latest", "flex minimum above the minimum shift",
      "flex minimum above the flex maximum", "GM minimum longer than the shop day (the mockup's guard)", "labor target 0%",
      "manager floor 80.25 h", "rush display flag 17 quarters", "line minimum above the head limits",
      "the wave profile under its floor after a trim to 0", "a priority pair of the same position", "a priority primary outside its pair",
      "an unknown role code in allowed roles", "an unknown nested key", "a number sent as a string",
      "max shift equal to the minimum shift", "max shift below the minimum shift", "max shift below the GM minimum", "max shift off the quarter grid", "max shift missing"]) {
      expect(names).toContain(n);
    }
    expect(cases.filter((c) => c.valid).length).toBeGreaterThan(10);
    expect(cases.filter((c) => c.infeasible && c.valid).length).toBe(1);
  });

  for (const c of cases) {
    it(`${c.valid ? "accepts" : "refuses"}: ${c.name}`, () => {
      const value = materializeStructureCase(c);
      const got = validScheduleStructure(value);
      expect(got.ok).toBe(c.valid);
      expect(structureProblem(value)).toBe(expectedStructureKey(c));
    });
  }

  it("the validator never throws, whatever it is handed", () => {
    for (const v of [null, undefined, 1, "x", [], {}, { version: 1 }, { version: 1, positions: null }, { ...CASE_DEFAULTS, crews: [] }]) {
      expect(() => validScheduleStructure(v)).not.toThrow();
      expect(validScheduleStructure(v).ok).toBe(false);
    }
  });
});

describe("crews, the shop day, the line bounds", () => {
  const s = shopBase() as ScheduleStructure;

  it("crewFor reads the day type's crew", () => {
    expect(crewFor(s, "slow").prepHeads).toBe(0);
    expect(crewFor(s, "busy").waves.rush.heads).toBe(4);
  });

  it("scheduledOut = clamp(serviceClose + ceil15(closing minutes), outEarliest, outLatest); checklistFits", () => {
    expect(scheduledOut(s, 45)).toBe(83); // 20:00 + 45 → 20:45
    expect(scheduledOut(s, 50)).toBe(84); // 20:00 + 50 → ceil 21:00
    expect(scheduledOut(s, 0)).toBe(82); // clamped up to outEarliest 20:30
    expect(scheduledOut(s, 90)).toBe(84); // clamped down to outLatest 21:00
    expect(checklistFits(s, 60)).toBe(true);
    expect(checklistFits(s, 61)).toBe(false);
  });

  it("positionLimit = headsBefore before the trim, headsAfter after, 0 outside [open, close)", () => {
    const reg = s.positions[I.$REG]!;
    const twoThenOne = { ...reg, headsBefore: 2, headsAfter: 1 };
    expect(positionLimit(twoThenOne, 63)).toBe(2);
    expect(positionLimit(twoThenOne, 64)).toBe(1);
    expect(positionLimit(twoThenOne, 41)).toBe(0);
    expect(positionLimit(twoThenOne, 84)).toBe(0);
  });

  it("the priority pairs: primary and secondary by id, never by name", () => {
    expect(primaryOf(s, I.$EXPO)).toBe(I.$REG);
    expect(secondaryOf(s, I.$REG)).toBe(I.$EXPO);
    expect(primaryOf(s, I.$BOI)).toBeNull();
  });

  it("minHeads (the floor from lineMinHeads) and maxHeads (the head limits) per quarter; the wave profile lies between", () => {
    const b = lineBounds(s, "normal");
    // 10:30: Register, Walk-ins / Online, Crunchy Boi, 3rd Party (primaries) + Walk-ins (secondary).
    expect(b.minHeads[42]).toBe(4);
    expect(b.maxHeads[42]).toBe(5);
    // 11:30: Expeditor opens.
    expect(b.maxHeads[46]).toBe(6);
    // 14:00 Crunchy Boi closes; 15:30 3rd Party closes.
    expect(b.minHeads[56]).toBe(3);
    expect(b.minHeads[62]).toBe(2);
    // 7:00: no line position open.
    expect(b.maxHeads[28]).toBe(0);
    const w = waveProfile(s, "normal");
    for (let q = 0; q < s.shopDay.serviceCloseQ; q++) {
      expect(w[q]).toBeGreaterThanOrEqual(b.minHeads[q]!);
      expect(w[q]).toBeLessThanOrEqual(b.maxHeads[q]!);
    }
  });

  it("Astra P2-6 / the W ruling: W is the configured waves placed as the mockup places them (no head-count fill), clamped to [floor, capacity] over the service period", () => {
    // Zero waves → W is the floor (plus the closers from their trim), never the capacity: 10:30–16:00 reads 4, not 6.
    const none = structuredClone(s);
    for (const k of ["setup", "service", "rush"] as const) none.crews.normal.waves[k].heads = 0;
    const b = lineBounds(none, "normal");
    const w0 = waveProfile(none, "normal");
    for (let q = 0; q < 64; q++) expect(w0[q]).toBe(b.minHeads[q]!);
    expect([w0[46], b.maxHeads[46], w0[70], w0[80]]).toEqual([4, 6, 3, 0]);
    expect(validScheduleStructure(none)).toEqual({ ok: true });
    // Zero waves AND no closing crew → exactly the floor over the whole service period.
    none.crews.normal.close = { registerHeads: 0, walkHeads: 0, prepDishHeads: 0 };
    const bare = waveProfile(none, "normal");
    for (let q = 0; q < 96; q++) expect(bare[q]).toBe(q < none.shopDay.serviceCloseQ ? b.minHeads[q]! : 0);
    // The v17 normal crew (setup 2 @ 9:30, service 3 @ 10:30, rush 3 @ 11:30; closers register @ 16:00, walk pair @ 17:00):
    //   9:30 setup → Crunchy Boi, 3rd Party (2) · 10:30 service → Register, Walk-ins / Online, Walk-ins (5) · 11:30 rush → Expeditor,
    //   then 2nd heads on Register and Walk-ins / Online (raw 8, capacity 6 → 6) · 14:00 Boi closes (raw 7, cap 5 → 5) · 15:30 3rd
    //   Party closes (raw 6, cap 4 → 4) · 16:00 the wave heads on Register / Expeditor end at the trim, the register closer starts
    //   (raw 4) · 17:00 the Walk-ins / Online wave heads end, the walk-pair closers start (raw 3: Register, Walk-ins / Online, Walk-ins).
    const w = waveProfile(s, "normal");
    expect([38, 42, 46, 56, 62, 64, 68, 79, 80].map((q) => w[q])).toEqual([2, 5, 6, 5, 4, 4, 3, 3, 0]);
    const slots = waveSlots(s, "normal");
    expect(slots.filter((x) => x.source === "closing_crew").map((x) => [x.positionId, x.fromQ, x.toQ])).toEqual([[I.$REG, 64, 84], [I.$WALKON, 68, 84], [I.$WALK, 68, 84]]);
    expect(slots.filter((x) => x.source === "setup").map((x) => x.positionId)).toEqual([I.$BOI, I.$THIRD]);
    expect(slots.filter((x) => x.source === "service").map((x) => x.positionId)).toEqual([I.$REG, I.$WALKON, I.$WALK]);
    expect(slots.filter((x) => x.source === "rush").map((x) => x.positionId)).toEqual([I.$EXPO, I.$REG, I.$WALKON]);
    // Waves far above the capacity are clamped, never refused (the mockup's busy crew asks 10 heads of 6 positions).
    const over = structuredClone(s);
    over.crews.busy.waves.setup.heads = 8;
    expect(validScheduleStructure(over)).toEqual({ ok: true });
    expect(waveProfile(over, "busy")[46]).toBe(lineBounds(over, "busy").maxHeads[46]);
  });
});

describe("structureFromStations: seeded once from the station columns (J4)", () => {
  const ST_LINE = "57000000-0000-4000-8000-000000000001";
  const ST_BOI = "57000000-0000-4000-8000-000000000002";
  const ST_THIRD = "57000000-0000-4000-8000-000000000003";
  const stations = [
    { id: ST_LINE, active: true, usuallyClosesAt: null, trims: null },
    { id: ST_BOI, active: true, usuallyClosesAt: "14:00:00", trims: null },
    { id: ST_THIRD, active: true, usuallyClosesAt: "15:30", trims: [{ at: "15:00", to_count: 1 }] },
  ];
  const positions = [
    { id: I.$REG, stationId: ST_LINE, active: true, usuallyTrimsAt: "16:00:00" },
    { id: I.$EXPO, stationId: ST_LINE, active: true, usuallyTrimsAt: null },
    { id: I.$BOI, stationId: ST_BOI, active: true, usuallyTrimsAt: null },
    { id: I.$THIRD, stationId: ST_THIRD, active: true, usuallyTrimsAt: null },
    { id: "5c000000-0000-4000-8000-0000000000ff", stationId: ST_LINE, active: false, usuallyTrimsAt: null },
  ];
  const roles = { [I.$REG]: "register", [I.$EXPO]: "expo", [I.$BOI]: "line_other", [I.$THIRD]: "line_other" } as const;

  it("close ← usually_closes_at, trim ← usually_trims_at / the first trims entry, missing → the role defaults; inactive positions dropped", () => {
    const r = structureFromStations(stations, positions, roles);
    if (!r.ok) throw new Error(r.key);
    expect(r.structure.positions[I.$BOI]).toMatchObject({ closeQ: 56, trimQ: 56 });
    expect(r.structure.positions[I.$THIRD]).toMatchObject({ closeQ: 62, trimQ: 60 });
    expect(r.structure.positions[I.$REG]).toMatchObject({ trimQ: 64, closeQ: 84, openQ: 42 });
    expect(r.structure.positions[I.$EXPO]).toMatchObject({ openQ: 46, trimQ: 64, closeQ: 80 });
    expect(Object.keys(r.structure.positions)).toHaveLength(4);
    expect(r.seededFrom[I.$BOI]).toEqual({ close: "station", trim: "default" });
    expect(r.seededFrom[I.$THIRD]).toEqual({ close: "station", trim: "station_trims" });
    expect(r.seededFrom[I.$REG]).toEqual({ close: "default", trim: "position" });
    // The register > expo pair is seeded; primaries get the floor 1, the secondary 0.
    expect(r.structure.priority).toEqual([{ pair: [I.$REG, I.$EXPO], primary: I.$REG }]);
    expect(r.structure.crews.normal.lineMinHeads).toEqual({ [I.$REG]: 1, [I.$EXPO]: 0, [I.$BOI]: 1, [I.$THIRD]: 1 });
    expect(validScheduleStructure(r.structure)).toEqual({ ok: true });
  });

  it("a position with no role mapping is line_other (never matched by name)", () => {
    const r = structureFromStations(stations, positions, {});
    if (!r.ok) throw new Error(r.key);
    expect(Object.values(r.structure.positions).every((p) => p.role === "line_other")).toBe(true);
  });

  it("a pre-noon trim (next day in the station rule) is REFUSED as a schedule time, key named", () => {
    const r = structureFromStations(stations, [{ ...positions[0]!, usuallyTrimsAt: "00:30:00" }], roles);
    expect(r).toEqual({ ok: false, code: "structure_invalid", key: `positions.${I.$REG}.trimQ` });
    const c = structureFromStations([{ ...stations[1]!, usuallyClosesAt: "01:00:00" }], [positions[2]!], roles);
    expect(c).toEqual({ ok: false, code: "structure_invalid", key: `positions.${I.$BOI}.closeQ` });
  });

  it("an off-grid station time is refused with its key, never rounded", () => {
    const r = structureFromStations([{ ...stations[1]!, usuallyClosesAt: "14:10:00" }], [positions[2]!], roles);
    expect(r).toEqual({ ok: false, code: "structure_invalid", key: `positions.${I.$BOI}.closeQ` });
  });
});

describe("no Date.now and no position names in the structure module", () => {
  it("reads no clock and matches no position name", () => {
    const src = readFileSync("lib/scheduling/structure-shared.ts", "utf8") + readFileSync("lib/scheduling/time-shared.ts", "utf8");
    expect(src).not.toMatch(/Date\.now|new Date\(\)/);
    expect(src).not.toMatch(/Crunchy|Walk-ins|Register &|Expeditor|Prep\/Dish|'EM'|'MEP'|"EM"|"MEP"/);
  });
});
