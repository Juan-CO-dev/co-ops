/**
 * Scheduling Phase 2, Task 4 Steps 5–6 — the curve → shape transform (r2 P2-4, rewritten r3, r4 zero
 * demand; the worked fixtures F10 / F14 / F15 asserted EXACTLY) and the need grid per position id.
 */
import { describe, expect, it } from "vitest";
import { CASE_POSITION_IDS as I, shopBase } from "../scripts/schedule-structure-cases.mjs";
import { buildDayNeed, needGrid, roundHalfUp, shapeFromCurve } from "@/lib/scheduling/need-shared";
import { lineBounds, validScheduleStructure, waveProfile, type ScheduleStructure } from "@/lib/scheduling/structure-shared";

const zeros = () => new Array<number>(96).fill(0);
/** Per-hour values over 11:00–15:00 (q 44–60) → a 96-quarter array (a STEP: 4 quarters per hour). */
const hours4 = (v: [number, number, number, number]) => {
  const a = zeros();
  v.forEach((x, i) => { for (let k = 0; k < 4; k++) a[44 + i * 4 + k] = x; });
  return a;
};
const cents = (v: [number, number, number, number]) => {
  const a = new Array<number>(24).fill(0);
  v.forEach((x, i) => { a[11 + i] = x; });
  return a;
};
const perHour = (heads: number[]) => [44, 48, 52, 56].map((q) => heads[q]);

// F10 setup: line 11:00–15:00; Walk-ins/Online 1/1, Walk-ins 0/1, Register 1/1, Expeditor 0/1 → min 2, max 4.
const W = hours4([2, 3, 3, 2]);
const MIN = hours4([2, 2, 2, 2]);
const MAX = hours4([4, 4, 4, 4]);

describe("shapeFromCurve — the worked fixtures, exactly", () => {
  it("(F10) Day A 2/4/2/2 (rush at 12:00), Day B 2/2/4/2 (rush at 13:00), flat 2/3/3/2; 10 line hours each", () => {
    const a = shapeFromCurve({ hourlyCents: cents([20000, 40000, 20000, 20000]), demandKind: "ok", wave: W, minHeads: MIN, maxHeads: MAX });
    const b = shapeFromCurve({ hourlyCents: cents([20000, 20000, 40000, 20000]), demandKind: "ok", wave: W, minHeads: MIN, maxHeads: MAX });
    const flat = shapeFromCurve({ hourlyCents: null, demandKind: "no_history", wave: W, minHeads: MIN, maxHeads: MAX });
    expect(perHour(a.heads)).toEqual([2, 4, 2, 2]);
    expect(perHour(b.heads)).toEqual([2, 2, 4, 2]);
    expect(perHour(flat.heads)).toEqual([2, 3, 3, 2]);
    expect([a.rushQ, b.rushQ, flat.rushQ]).toEqual([48, 52, 48]);
    expect([a.lineHours, b.lineHours, flat.lineHours]).toEqual([10, 10, 10]);
    expect(a.targetHours).toBe(10);
    expect(a.arrivals).toEqual([{ q: 44, heads: 2 }, { q: 48, heads: 2 }]);
    expect(b.arrivals).toEqual([{ q: 44, heads: 2 }, { q: 52, heads: 2 }]);
    expect([a.note, flat.note]).toEqual(["normal", "normal"]);
  });

  it("two equal-total days with peak hours 12:00 vs 13:00 get different rush times AND different hourly line counts", () => {
    const a = shapeFromCurve({ hourlyCents: cents([20000, 40000, 20000, 20000]), demandKind: "ok", wave: W, minHeads: MIN, maxHeads: MAX });
    const b = shapeFromCurve({ hourlyCents: cents([20000, 20000, 40000, 20000]), demandKind: "ok", wave: W, minHeads: MIN, maxHeads: MAX });
    expect(a.rushQ).not.toBe(b.rushQ);
    expect(perHour(a.heads)).not.toEqual(perHour(b.heads));
  });

  it("a flat curve reproduces the configured waves exactly, whatever its level", () => {
    for (const level of [1, 37, 123456]) {
      const s = shapeFromCurve({ hourlyCents: cents([level, level, level, level]), demandKind: "ok", wave: W, minHeads: MIN, maxHeads: MAX });
      expect(s.heads).toEqual(W);
    }
  });

  it("(F14) all-zero forecast → minHeads 2/2/2/2, 8 line hours, note zero_demand; finite, no throw", () => {
    const s = shapeFromCurve({ hourlyCents: cents([0, 0, 0, 0]), demandKind: "ok", wave: W, minHeads: MIN, maxHeads: MAX });
    expect(perHour(s.heads)).toEqual([2, 2, 2, 2]);
    expect(s.lineHours).toBe(8);
    expect(s.note).toBe("zero_demand");
    expect(s.heads.every(Number.isFinite)).toBe(true);
  });

  it("(F15) zero weighted-profile sum → an even split 1/1/1/1, 4 line hours, note zero_profile", () => {
    const s = shapeFromCurve({ hourlyCents: cents([40000, 0, 0, 40000]), demandKind: "ok", wave: hours4([0, 2, 2, 0]), minHeads: zeros(), maxHeads: hours4([2, 2, 2, 2]) });
    expect(perHour(s.heads)).toEqual([1, 1, 1, 1]);
    expect(s.lineHours).toBe(4);
    expect(s.targetHours).toBe(4);
    expect(s.note).toBe("zero_profile");
  });

  it("ties: round_half_up per quarter (0.5 → 1, 1.5 → 2), computed in exact integers", () => {
    const w = zeros();
    for (let q = 44; q < 52; q++) w[q] = 1;
    const max = zeros();
    for (let q = 44; q < 52; q++) max[q] = 2;
    const s = shapeFromCurve({ hourlyCents: cents([1, 3, 0, 0]), demandKind: "ok", wave: w, minHeads: zeros(), maxHeads: max });
    expect([s.heads[44], s.heads[48]]).toEqual([1, 2]);
    expect([roundHalfUp(1, 2), roundHalfUp(3, 2), roundHalfUp(5, 4), roundHalfUp(0, 7)]).toEqual([1, 2, 1, 0]);
  });

  it("every shaped count stays within [floor, limit]; deterministic", () => {
    for (const d of [[1, 900000, 1, 1], [900000, 1, 1, 1], [0, 0, 0, 5]] as Array<[number, number, number, number]>) {
      const s = shapeFromCurve({ hourlyCents: cents(d), demandKind: "ok", wave: W, minHeads: MIN, maxHeads: MAX });
      for (let q = 0; q < 96; q++) {
        expect(s.heads[q]).toBeGreaterThanOrEqual(MIN[q]!);
        expect(s.heads[q]).toBeLessThanOrEqual(MAX[q]!);
      }
      expect(JSON.stringify(shapeFromCurve({ hourlyCents: cents(d), demandKind: "ok", wave: W, minHeads: MIN, maxHeads: MAX }))).toBe(JSON.stringify(s));
    }
  });

  it("a rush moved more than rushShiftMaxQ from its configured time is FLAGGED (display only); heads never change", () => {
    const base = { demandKind: "ok" as const, wave: W, minHeads: MIN, maxHeads: MAX };
    const b = shapeFromCurve({ ...base, hourlyCents: cents([20000, 20000, 40000, 20000]), rush: { atQ: 46, maxShiftQ: 4 } });
    expect(b.rushMoved).toBe(true);
    expect(perHour(b.heads)).toEqual([2, 2, 4, 2]);
    const a = shapeFromCurve({ ...base, hourlyCents: cents([20000, 40000, 20000, 20000]), rush: { atQ: 46, maxShiftQ: 4 } });
    expect(a.rushMoved).toBe(false);
  });
});

describe("the need grid, per position id (mockup structure)", () => {
  const s = shopBase() as ScheduleStructure;
  const OUT = 83;
  const flat = (st: ScheduleStructure, dayType: "slow" | "normal" | "busy" | "weekend", catering: Array<{ id: string; headcount: number; eventQ: number | null }> = []) =>
    buildDayNeed({ structure: st, dayType, scheduledOutQ: OUT, hourlyCents: null, demandKind: "no_history", catering });
  const run = (arr: number[] | undefined) => {
    const out: Array<[number, number, number]> = [];
    (arr ?? []).forEach((v, q) => {
      const last = out[out.length - 1];
      if (last && last[2] === v && last[1] === q) last[1] = q + 1;
      else if (v > 0) out.push([q, q + 1, v]);
    });
    return out;
  };

  it("Walk-ins / Online is needed open → close (no trim); 3rd Party ends at its trim; Crunchy Boi at 2 PM", () => {
    const n = flat(s, "normal").need;
    expect(run(n.positions[I.$WALKON])).toEqual([[42, 83, 1]]);
    expect(run(n.positions[I.$THIRD])).toEqual([[38, 62, 1]]);
    expect(run(n.positions[I.$BOI])).toEqual([[38, 56, 1]]);
  });

  it("Register & Delivery 2 → 1 at the 4 PM trim when headsBefore is 2 (§5.7)", () => {
    const two = structuredClone(s);
    two.positions[I.$REG]!.headsBefore = 2;
    expect(run(flat(two, "normal").need.positions[I.$REG])).toEqual([[42, 64, 2], [64, 83, 1]]);
  });

  it("BOH: slow = 1 Prep/Dishwasher only; weekend = both until prepUntil, then Prep/Dishwasher only", () => {
    const slow = flat(s, "slow").need;
    expect(run(slow.positions[I.$PREP])).toEqual([]);
    expect(run(slow.positions[I.$DISH])).toEqual([[28, 83, 1]]);
    const weekend = flat(s, "weekend").need;
    expect(run(weekend.positions[I.$PREP])).toEqual([[28, 68, 1]]);
    expect(run(weekend.positions[I.$DISH])).toEqual([[28, 83, 1]]);
  });

  it("the closing crew counts by day type (Walk-ins closes only when the crew rule says 2)", () => {
    const close = (t: "slow" | "normal") => [80, 82].map((q) => [flat(s, t).need.positions[I.$WALKON]![q], flat(s, t).need.positions[I.$WALK]![q], flat(s, t).need.positions[I.$REG]![q]]);
    expect(close("slow")).toEqual([[1, 0, 1], [1, 0, 1]]);
    expect(close("normal")).toEqual([[1, 1, 1], [1, 1, 1]]);
    expect(flat(s, "normal").need.positions[I.$EXPO]![80]).toBe(0);
  });

  it("the line counts come from the shape: lineTotal = the shaped heads, split min-first, primaries before secondaries", () => {
    const hourly = new Array<number>(24).fill(1000);
    hourly[12] = 900000; // a huge lunch: capped at the line's capacity
    hourly[10] = 0;
    const r = buildDayNeed({ structure: s, dayType: "normal", scheduledOutQ: OUT, hourlyCents: hourly, demandKind: "ok", catering: [] });
    for (let q = 0; q < 80; q++) {
      const sum = [I.$REG, I.$EXPO, I.$WALKON, I.$WALK, I.$BOI, I.$THIRD].reduce((n, p) => n + r.need.positions[p]![q]!, 0);
      expect(sum, `q${q}`).toBe(r.need.lineTotal[q]);
      expect(r.need.lineTotal[q]).toBeGreaterThanOrEqual(r.need.minHeads[q]!);
      expect(r.need.lineTotal[q]).toBeLessThanOrEqual(r.need.maxHeads[q]!);
    }
    // 10:30 (hour 10 has no demand): the floor — the primaries only, never a secondary.
    expect([I.$REG, I.$WALKON, I.$BOI, I.$THIRD].map((p) => r.need.positions[p]![42])).toEqual([1, 1, 1, 1]);
    expect(r.need.positions[I.$WALK]![42]).toBe(0);
    expect(r.need.sources.some((x) => x.source === "shape")).toBe(true);
  });

  it("the catering rule adds Prep/Dishwasher heads in [event − lead, event), or its default window; below the threshold, nothing", () => {
    const two = structuredClone(s);
    two.positions[I.$DISH]!.headsBefore = 2;
    const timed = flat(two, "normal", [{ id: "c-1", headcount: 80, eventQ: 52 }]).need; // event 13:00, lead 210 min → from 9:30
    expect(run(timed.positions[I.$DISH])).toEqual([[28, 38, 1], [38, 52, 2], [52, 83, 1]]);
    const untimed = flat(two, "normal", [{ id: "c-2", headcount: 80, eventQ: null }]).need; // default 8:30–13:00
    expect(untimed.positions[I.$DISH]!.slice(34, 52).every((v) => v === 2)).toBe(true);
    expect(untimed.positions[I.$DISH]![52]).toBe(1);
    expect(untimed.sources.filter((x) => x.source === "catering")).toEqual([{ positionId: I.$DISH, fromQ: 34, toQ: 52, heads: 1, source: "catering" }]);
    const small = flat(two, "normal", [{ id: "c-3", headcount: 10, eventQ: 52 }]).need;
    expect(small.positions[I.$DISH]![40]).toBe(1);
    // At the default head limit of 1 the extra head cannot be placed: capped, never over the limit.
    expect(flat(s, "normal", [{ id: "c-4", headcount: 80, eventQ: 52 }]).need.positions[I.$DISH]![40]).toBe(1);
  });

  it("a line_other position with no crew rule follows its heads only", () => {
    const n = flat(s, "busy").need;
    expect(run(n.positions[I.$BOI])).toEqual([[38, 56, 1]]);
    expect(n.positions[I.$BOI]![80]).toBe(0);
  });

  it("needGrid takes shaped heads directly; every number traces to a source run", () => {
    const shaped = shapeFromCurve({ hourlyCents: null, demandKind: "no_history", wave: zeros(), minHeads: zeros(), maxHeads: zeros() });
    const n = needGrid({ structure: s, dayType: "normal", scheduledOutQ: OUT, lineHeads: shaped.heads, shapeNote: shaped.note, catering: [] });
    for (const [p, arr] of Object.entries(n.positions)) {
      arr.forEach((v, q) => {
        if (v === 0) return;
        const covered = n.sources.filter((x) => x.positionId === p && x.fromQ <= q && q < x.toQ).reduce((a, x) => a + x.heads, 0);
        expect(covered, `${p}@${q}`).toBe(v);
      });
    }
  });
});

/**
 * Astra P2-6 / the W ruling: F10, F14 and F15 re-derived through the REAL integration — a configured
 * structure → `waveProfile` → `buildDayNeed` — not hand-supplied arrays.
 *
 * F10 / F14 structure: line 11:00–15:00; Walk-ins / Online (primary 1/1) and Register (primary 1/1)
 * open 11:00–15:00; Walk-ins (secondary 1/1) and Expeditor (secondary 1/1) open 11:00, TRIM 14:00,
 * close 15:00; floors 1/1/0/0 → minHeads 2, maxHeads 4 at every quarter (the limits are 1 before and
 * after the trim). Waves: setup 2 @ 11:00, service 0, rush 1 @ 12:00; no closing crew.
 *   setup 2 @ 11:00 → the two primaries (deficit 1 each; primaries first) → [11:00, 15:00) each;
 *   rush 1 @ 12:00 → the first secondary by id (deficit 1; the primaries are at 0) → [12:00, 14:00),
 *   ending at ITS TRIM, the mockup's rule for a wave head.
 *   W per hour = 2 / 3 / 3 / 2 → ΣW = 4 × 10 = 40 quarter-heads → T = 10 h — the plan's F10 numbers.
 * F15 structure: only the two secondaries, 11:00–15:00, trim 14:00, floors 0 → minHeads 0, maxHeads 2;
 *   waves setup 0, service 0, rush 2 @ 12:00 → both secondaries [12:00, 14:00) → W = 0 / 2 / 2 / 0 →
 *   ΣW = 16 → T = 4 h — the plan's F15 numbers.
 */
describe("F10 / F14 / F15 through the real integration (structure → waveProfile → buildDayNeed)", () => {
  const WO = "5f000000-0000-4000-8000-000000000001";
  const RG = "5f000000-0000-4000-8000-000000000002";
  const WK = "5f000000-0000-4000-8000-000000000003";
  const EX = "5f000000-0000-4000-8000-000000000004";
  const roles = ["trainee", "employee", "trainer", "key_holder", "shift_lead", "agm", "gm", "moo", "owner"] as const;
  const pos = (role: "walk_online" | "register" | "walk" | "expo", trimQ: number) => ({ role, openQ: 44, trimQ, closeQ: 60, headsBefore: 1, headsAfter: 1, allowedRoles: [...roles] });
  const f10 = (onlySecondaries = false): ScheduleStructure => {
    const st = structuredClone(shopBase()) as ScheduleStructure;
    st.shopDay = { prepStartQ: 28, prepDishArrivalQ: 28, serviceStartQ: 44, serviceCloseQ: 60, outEarliestQ: 60, outLatestQ: 64 };
    st.positions = onlySecondaries
      ? { [WK]: pos("walk", 56), [EX]: pos("expo", 56) }
      : { [WO]: pos("walk_online", 60), [RG]: pos("register", 60), [WK]: pos("walk", 56), [EX]: pos("expo", 56) };
    st.priority = onlySecondaries ? [] : [{ pair: [WO, WK], primary: WO }, { pair: [RG, EX], primary: RG }];
    for (const t of ["slow", "normal", "busy", "weekend"] as const) {
      st.crews[t] = {
        prepHeads: 0, prepUntilQ: 44, prepDishHeads: 0,
        waves: { setup: { heads: onlySecondaries ? 0 : 2, atQ: 44 }, service: { heads: 0 }, rush: { heads: onlySecondaries ? 2 : 1, atQ: 48 } },
        close: { registerHeads: 0, walkHeads: 0, prepDishHeads: 0 },
        lineMinHeads: onlySecondaries ? { [WK]: 0, [EX]: 0 } : { [WO]: 1, [RG]: 1, [WK]: 0, [EX]: 0 },
      };
    }
    return st;
  };
  const build = (st: ScheduleStructure, hourly: number[] | null) =>
    buildDayNeed({ structure: st, dayType: "normal", scheduledOutQ: 60, hourlyCents: hourly, demandKind: hourly ? "ok" : "no_history", catering: [] });

  it("the F10 structure is valid and its configured waves give W = 2/3/3/2 (T = 10 h) with minHeads 2 and maxHeads 4 at every quarter", () => {
    const st = f10();
    expect(validScheduleStructure(st)).toEqual({ ok: true });
    expect(perHour(waveProfile(st, "normal"))).toEqual([2, 3, 3, 2]);
    expect(waveProfile(st, "normal").reduce((a, b) => a + b, 0)).toBe(40);
    const b = lineBounds(st, "normal");
    expect([44, 48, 52, 56, 59].map((q) => [b.minHeads[q], b.maxHeads[q]])).toEqual([[2, 4], [2, 4], [2, 4], [2, 4], [2, 4]]);
  });

  it("(F10) Day A 2/4/2/2 (rush 12:00), Day B 2/2/4/2 (rush 13:00), flat 2/3/3/2 — 10 line hours each, through buildDayNeed", () => {
    const st = f10();
    const a = build(st, cents([20000, 40000, 20000, 20000]));
    const b = build(st, cents([20000, 20000, 40000, 20000]));
    const flat = build(st, null);
    expect(perHour(a.need.lineTotal)).toEqual([2, 4, 2, 2]);
    expect(perHour(b.need.lineTotal)).toEqual([2, 2, 4, 2]);
    expect(perHour(flat.need.lineTotal)).toEqual([2, 3, 3, 2]);
    expect([a.shape.rushQ, b.shape.rushQ, flat.shape.rushQ]).toEqual([48, 52, 48]);
    expect([a.shape.lineHours, b.shape.lineHours, flat.shape.lineHours, a.shape.targetHours]).toEqual([10, 10, 10, 10]);
    // The floor goes to the primaries; the extra heads to the secondaries (never over a limit of 1).
    expect([WO, RG, WK, EX].map((p) => a.need.positions[p]![48])).toEqual([1, 1, 1, 1]);
    expect([WO, RG, WK, EX].map((p) => a.need.positions[p]![44])).toEqual([1, 1, 0, 0]);
  });

  it("(F14) all-zero forecast on the F10 structure → 2/2/2/2, 8 line hours, zero_demand", () => {
    const r = build(f10(), cents([0, 0, 0, 0]));
    expect(perHour(r.need.lineTotal)).toEqual([2, 2, 2, 2]);
    expect([r.shape.lineHours, r.shape.note, r.need.shapeNote]).toEqual([8, "zero_demand", "zero_demand"]);
  });

  it("(F15) only secondaries: W = 0/2/2/0 (T = 4 h); demand $400/0/0/$400 → an even split 1/1/1/1, zero_profile", () => {
    const st = f10(true);
    expect(validScheduleStructure(st)).toEqual({ ok: true });
    expect(perHour(waveProfile(st, "normal"))).toEqual([0, 2, 2, 0]);
    const r = build(st, cents([40000, 0, 0, 40000]));
    expect(perHour(r.need.lineTotal)).toEqual([1, 1, 1, 1]);
    expect([r.shape.lineHours, r.shape.targetHours, r.shape.note]).toEqual([4, 4, "zero_profile"]);
  });
});
