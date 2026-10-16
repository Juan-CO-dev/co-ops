/**
 * Scheduling Phase 1, Task 15 — the skill model, pure. Dated observations, the distinct quality-day set
 * (r1 P2-7), counting kinds and the zero-weight rule (r2 #3), confidence, bands, the clamp, evidence keys,
 * and the signal builders (closing on time, prep yield one-per-production-row, PM by observed minutes).
 */
import { describe, expect, it } from "vitest";
import {
  closeOnTimeObservations, formatDelta, pmObservations, positionAt, prepYieldObservations, signalsFor, skillBand,
  skillFor, skillWindowStart, workedDays, type PositionSignals, type QualityObservation,
} from "@/lib/people/skills-shared";
import type { PositionInterval } from "@/lib/people/positions-shared";
import { SKILL_TUNABLE_DEFAULTS as D, type SkillTunables } from "@/lib/people/tunables-shared";
import { etCalendarDate } from "@/lib/operational-day";

const POS = "pos-walkins";
const AS_OF = "2026-10-15";
const obs = (day: string, kind: QualityObservation["kind"], value: number, sourceId: string, weight = 1, positionId = POS): QualityObservation =>
  ({ positionId, day, kind, value, weight, sourceId });
const sig = (observations: QualityObservation[], worked: PositionSignals["worked"] = []): PositionSignals =>
  ({ positionId: POS, asOf: AS_OF, worked, observations });
/** n consecutive ET days ending on AS_OF (all inside the default 90-day window). */
const days = (n: number) => Array.from({ length: n }, (_, i) => skillWindowStart(AS_OF, n - i).slice(0, 10));

describe("skillFor — the prior, the blend, confidence", () => {
  it("no data, no rating → the neutral 0.5, a starting point, confidence 0", () => {
    const r = skillFor(sig([]), null, 0, D);
    expect(r).toMatchObject({ learned: 0.5, prior: 0.5, priorSource: "neutral", value: 0.5, band: "solid", qualityDays: 0, confidence: 0, startingPoint: true });
    expect(r.perKind).toEqual({ pm: null, closeOnTime: null, prepYield: null });
    expect(r.evidence).toEqual([]);
  });

  it("a rating of 0.8 and 2 quality days of q = 0.4 → (6·0.8 + 2·0.4) / 8 = 0.7, confidence 2/8", () => {
    const r = skillFor(sig([obs("2026-10-10", "pm", 0.4, "g1"), obs("2026-10-11", "pm", 0.4, "g2")]), 0.8, 0, D);
    expect(r.learned).toBeCloseTo(0.7, 12);
    expect(r.confidence).toBeCloseTo(0.25, 12);
    expect(r.priorSource).toBe("manager_rating");
    expect(r.startingPoint).toBe(true); // 2 < minQualityDaysForLearned (3)
  });

  it("40 quality days pull the value toward q", () => {
    const many = days(40).map((d, i) => obs(d, "closeOnTime", 1, `c${i}`));
    const r = skillFor(sig(many), 0.2, 0, D);
    expect(r.qualityDays).toBe(40);
    expect(r.learned).toBeCloseTo((6 * 0.2 + 40 * 1) / 46, 12);
    expect(r.learned).toBeGreaterThan(0.85);
    expect(r.startingPoint).toBe(false);
  });
});

describe("skillFor — the distinct quality-day set (r1 P2-7)", () => {
  it("one day with a PM grade + 3 closing lines + 2 batches → ONE quality day, not 6 and not 3", () => {
    const d = "2026-10-12";
    const r = skillFor(sig([
      obs(d, "pm", 1, "g1", 60), obs(d, "closeOnTime", 1, "c1"), obs(d, "closeOnTime", 1, "c2"), obs(d, "closeOnTime", 0, "c3"),
      obs(d, "prepYield", 1, "p1"), obs(d, "prepYield", 1, "p2"),
    ]), null, 0, D);
    expect(r.qualityDays).toBe(1);
    expect(r.perKind.closeOnTime).toMatchObject({ count: 3, days: 1 });
    expect(r.confidence).toBeCloseTo(1 / 7, 12);
  });

  it("three kinds on three DIFFERENT days → 3", () => {
    const r = skillFor(sig([obs("2026-10-10", "pm", 1, "g"), obs("2026-10-11", "closeOnTime", 1, "c"), obs("2026-10-12", "prepYield", 1, "p")]), null, 0, D);
    expect(r.qualityDays).toBe(3);
  });

  it("20 worked days with ONE quality day → qualityDays 1, workedDays 20, confidence from qualityDays", () => {
    const worked = days(20).map((day) => ({ positionId: POS, day, minutes: 300 }));
    const r = skillFor(sig([obs("2026-10-05", "closeOnTime", 1, "c")], worked), null, 0, D);
    expect(r).toMatchObject({ qualityDays: 1, workedDays: 20, minutesWorked: 6000 });
    expect(r.confidence).toBeCloseTo(1 / 7, 12);
  });

  it("a duplicated sourceId (a re-loaded row) counts once", () => {
    const r = skillFor(sig([obs("2026-10-10", "closeOnTime", 1, "c1"), obs("2026-10-10", "closeOnTime", 0, "c1"), obs("2026-10-11", "closeOnTime", 1, "c1")]), null, 0, D);
    expect(r.perKind.closeOnTime).toMatchObject({ count: 1, mean: 1, days: 1 });
    expect(r.qualityDays).toBe(1);
  });

  it("an observation outside windowDays is excluded from q AND n; the window's first day is inside", () => {
    const first = skillWindowStart(AS_OF, D.windowDays);
    expect(first).toBe("2026-07-18");
    const r = skillFor(sig([obs("2026-07-17", "closeOnTime", 0, "old"), obs(first, "closeOnTime", 1, "edge"), obs("2026-10-16", "closeOnTime", 0, "future")]), null, 0, D);
    expect(r.perKind.closeOnTime).toMatchObject({ count: 1, mean: 1 });
    expect(r.qualityDays).toBe(1);
  });

  it("another position's observations and worked days never enter", () => {
    const r = skillFor(sig([obs("2026-10-10", "pm", 0, "g", 10, "other-pos")], [{ positionId: "other-pos", day: "2026-10-10", minutes: 400 }]), null, 0, D);
    expect(r).toMatchObject({ qualityDays: 0, workedDays: 0, minutesWorked: 0 });
  });
});

describe("skillFor — counting kinds and the zero-weight rule (r2 #3)", () => {
  const pmOnly: SkillTunables = { ...D, weights: { pm: 1, closeOnTime: 0, prepYield: 0 } };
  it("weights {pm:1, close:0, prep:0} and ONLY closing evidence → learned = prior, confidence 0, qualityDays 0, a starting point; closing still reported", () => {
    const r = skillFor(sig(days(17).map((d, i) => obs(d, "closeOnTime", i === 0 ? 0 : 1, `c${i}`))), 0.65, 0, pmOnly);
    expect(r).toMatchObject({ learned: 0.65, value: 0.65, confidence: 0, qualityDays: 0, startingPoint: true });
    expect(r.perKind.closeOnTime).toMatchObject({ count: 17, counted: false });
    expect(r.evidence.map((e) => e.key)).toContain("people.skills.evidence.closeOnTimeNotCounted");
    for (const v of [r.learned, r.value, r.confidence, r.perKind.closeOnTime!.mean]) expect(Number.isFinite(v)).toBe(true);
  });
  it("… the same person with one PM grade added → n = 1 and q = that PM mean", () => {
    const r = skillFor(sig([...days(17).map((d, i) => obs(d, "closeOnTime", 1, `c${i}`)), obs("2026-10-14", "pm", 0.2, "g1", 30)]), 0.65, 0, pmOnly);
    expect(r.qualityDays).toBe(1);
    expect(r.learned).toBeCloseTo((6 * 0.65 + 1 * 0.2) / 7, 12);
  });
  it("weights renormalise over the kinds present: only PM present → q is the PM mean (3/1/1 ≡ 0.6/0.2/0.2)", () => {
    const o = [obs("2026-10-10", "pm", 0.9, "g1", 60)];
    const a = skillFor(sig(o), null, 0, D);
    const b = skillFor(sig(o), null, 0, { ...D, weights: { pm: 3, closeOnTime: 1, prepYield: 1 } });
    expect(a.learned).toBeCloseTo((6 * 0.5 + 0.9) / 7, 12);
    expect(b.learned).toBeCloseTo(a.learned, 12);
    const mixed = [obs("2026-10-10", "pm", 1, "g"), obs("2026-10-11", "closeOnTime", 0, "c")];
    expect(skillFor(sig(mixed), null, 0, { ...D, weights: { pm: 3, closeOnTime: 1, prepYield: 1 } }).learned)
      .toBeCloseTo(skillFor(sig(mixed), null, 0, D).learned, 12);
  });
  it("within a kind, zero observation weights fall back to EQUAL weights (flagged), so the mean is finite", () => {
    const r = skillFor(sig([obs("2026-10-10", "pm", 1, "g1", 0), obs("2026-10-10", "pm", 0, "g2", 0)]), null, 0, D);
    expect(r.perKind.pm).toMatchObject({ mean: 0.5, equalWeightFallback: true, count: 2, days: 1 });
  });
  it("PM means are weighted by observed minutes", () => {
    const r = skillFor(sig([obs("2026-10-10", "pm", 1, "g1", 90), obs("2026-10-10", "pm", 0, "g2", 30)]), null, 0, D);
    expect(r.perKind.pm!.mean).toBeCloseTo(0.75, 12);
  });
});

describe("skillFor — adjustment, bands, tunables as a parameter, determinism", () => {
  it("the adjustment clamps the value at 0 and 1 (learned untouched)", () => {
    expect(skillFor(sig([]), 0.9, 0.3, D)).toMatchObject({ learned: 0.9, value: 1, band: "strong" });
    expect(skillFor(sig([]), 0.1, -0.3, D)).toMatchObject({ learned: 0.1, value: 0, band: "building" });
  });
  it("bands at their boundaries: < building · building..strong · ≥ strong", () => {
    expect(skillBand(0.4499, D)).toBe("building");
    expect(skillBand(0.45, D)).toBe("solid");
    expect(skillBand(0.7499, D)).toBe("solid");
    expect(skillBand(0.75, D)).toBe("strong");
  });
  it("the same signals under two tunables give the two expected values", () => {
    const o = [obs("2026-10-10", "closeOnTime", 1, "c1")];
    expect(skillFor(sig(o), null, 0, D).learned).toBeCloseTo((6 * 0.5 + 1) / 7, 12);
    expect(skillFor(sig(o), null, 0, { ...D, priorStrength: 1, priorWhenNoRating: 0 }).learned).toBeCloseTo(0.5, 12);
  });
  it("minQualityDaysForLearned decides the starting point", () => {
    const o = days(3).map((d, i) => obs(d, "closeOnTime", 1, `c${i}`));
    expect(skillFor(sig(o), null, 0, D).startingPoint).toBe(false);
    expect(skillFor(sig(o), null, 0, { ...D, minQualityDaysForLearned: 4 }).startingPoint).toBe(true);
  });
  it("determinism: the same input gives the same output", () => {
    const o = [obs("2026-10-10", "pm", 0.6, "g1", 45), obs("2026-10-11", "prepYield", 1, "p1")];
    expect(skillFor(sig(o), 0.4, 0.05, D)).toEqual(skillFor(sig([...o]), 0.4, 0.05, D));
  });
  it("formatDelta signs two decimals", () => {
    expect([formatDelta(0.1), formatDelta(-0.05), formatDelta(0)]).toEqual(["+0.10", "−0.05", "0.00"]);
  });
});

describe("skillFor — evidence keys present for each signal, absent when null", () => {
  it("every signal names its key; manager notes add the rating and adjustment lines", () => {
    const r = skillFor(sig(
      [obs("2026-10-10", "pm", 1, "g"), obs("2026-10-10", "closeOnTime", 1, "c"), obs("2026-10-11", "prepYield", 1, "p")],
      [{ positionId: POS, day: "2026-10-10", minutes: 240 }],
    ), 0.6, 0.1, D, {
      rating: { rating: 0.6, actorName: "Alex", at: "2026-10-01T15:00:00Z" },
      adjustment: { delta: 0.1, actorName: "Alex", at: "2026-10-12T15:00:00Z", reasonCode: "observed_on_floor" },
      noMakerBatches: 3,
    });
    expect(r.evidence.map((e) => [e.key, e.source])).toEqual([
      ["people.skills.evidence.worked", "worked"], ["people.skills.evidence.pm", "pm"],
      ["people.skills.evidence.closeOnTime", "closeOnTime"], ["people.skills.evidence.prepYield", "prepYield"],
      ["people.skills.evidence.noMaker", "noMaker"], ["people.skills.evidence.rating", "rating"],
      ["people.skills.evidence.adjustment", "adjustment"],
    ]);
    expect(r.evidence.find((e) => e.source === "adjustment")!.params).toEqual({ delta: "+0.10", actor: "Alex", date: "2026-10-12", reason: "observed_on_floor" });
    expect(r.evidence.find((e) => e.source === "worked")!.params).toEqual({ days: 1, hours: 4 });
  });
  it("no worked days, no kinds, no notes → no lines", () => {
    expect(skillFor(sig([]), null, 0, D).evidence).toEqual([]);
  });
});

// ─── the signal builders ─────────────────────────────────────────────────────

const U = "user-ana";
const iv = (positionId: string | null, start: string, end: string | null, userId = U, businessDate = "2026-10-14"): PositionInterval =>
  ({ locationId: "shop", businessDate, userId, stationId: "st", positionId, start, end, source: "claimed" });

describe("the builders", () => {
  it("positionAt: the closed interval containing the instant, half-open", () => {
    const ivs = [iv("A", "2026-10-14T14:00:00Z", "2026-10-14T18:00:00Z"), iv("B", "2026-10-14T18:00:00Z", null)];
    expect(positionAt(ivs, U, "2026-10-14T17:59:59Z")?.positionId).toBe("A");
    expect(positionAt(ivs, U, "2026-10-14T18:00:00Z")).toBeNull(); // B is still open: close it first
    expect(positionAt(ivs, "someone", "2026-10-14T15:00:00Z")).toBeNull();
  });

  it("workedDays: minutes per (person, position, day); a null position never makes a skill row (Position not recorded)", () => {
    const { byUser, unrecordedMinutes } = workedDays([
      iv("A", "2026-10-14T14:00:00Z", "2026-10-14T16:00:00Z"), iv("A", "2026-10-14T17:00:00Z", "2026-10-14T18:00:00Z"),
      iv(null, "2026-10-14T18:00:00Z", "2026-10-14T18:45:00Z"), iv("B", "2026-10-14T19:00:00Z", null),
    ]);
    expect(byUser.get(U)).toEqual([{ positionId: "A", day: "2026-10-14", minutes: 180 }]);
    expect(unrecordedMinutes.get(U)).toBe(45);
    const s = signalsFor(U, "A", AS_OF, byUser, []);
    expect(skillFor(s, null, 0, D)).toMatchObject({ workedDays: 1, minutesWorked: 180, qualityDays: 0 });
  });

  it("closeOnTimeObservations: by the usual close + grace (ET wall time), else the observed closure; attributed to the position held", () => {
    const ivs = [iv("A", "2026-10-14T20:00:00Z", "2026-10-15T04:00:00Z"), iv("B", "2026-10-14T20:00:00Z", "2026-10-15T04:00:00Z", "bo")];
    const out = closeOnTimeObservations({
      completions: [
        { id: "c1", instanceId: "i1", templateItemId: "line-walk", completedBy: U, completedAt: "2026-10-15T02:14:00Z" }, // 22:14 EDT ≤ 22:00+15
        { id: "c2", instanceId: "i1", templateItemId: "line-walk", completedBy: U, completedAt: "2026-10-15T02:16:00Z" }, // 22:16 > 22:15
        { id: "c3", instanceId: "i1", templateItemId: "line-exp", completedBy: "bo", completedAt: "2026-10-15T03:00:00Z" }, // no usual close: ≤ closure
        { id: "c4", instanceId: "i1", templateItemId: "line-none", completedBy: U, completedAt: "2026-10-15T01:00:00Z" }, // no matching station
        { id: "c5", instanceId: "i1", templateItemId: "line-walk", completedBy: "ghost", completedAt: "2026-10-15T01:00:00Z" }, // no position held
      ],
      instanceDay: new Map([["i1", "2026-10-14"]]),
      lineStation: new Map([["line-walk", " Walk-ins "], ["line-exp", "Expeditor"], ["line-none", "Nowhere"]]),
      stations: [{ id: "s-walk", name: "Walk-ins", usuallyClosesAt: "22:00:00" }, { id: "s-exp", name: "Expeditor", usuallyClosesAt: null }],
      closures: new Map([["s-exp/2026-10-14", "2026-10-15T03:30:00Z"]]),
      intervals: ivs,
    }, D);
    expect(out.map((o) => [o.sourceId, o.userId, o.positionId, o.day, o.value])).toEqual([
      ["c1", U, "A", "2026-10-14", 1], ["c2", U, "A", "2026-10-14", 0], ["c3", "bo", "B", "2026-10-14", 1],
    ]);
  });

  it("prepYieldObservations: ONE observation per production row (r1 P2-6); maker's position, else the shop's prep position, else unplaced", () => {
    const b = (id: string, madeBy: string | null, producedAt: string, cameOutTo: number) =>
      ({ id, itemId: "item", producedAt, madeBy, batchesMade: 2, cameOutTo, yieldAtTime: 10 });
    const ivs = [iv("PREP-A", "2026-10-14T12:00:00Z", "2026-10-14T16:00:00Z")];
    const { observations, noMaker, unplaced } = prepYieldObservations([
      b("p1", U, "2026-10-14T13:00:00Z", 20), // on target, held PREP-A
      b("p2", U, "2026-10-14T13:30:00Z", 23.1), // 15.5% off → 0
      b("p3", U, "2026-10-14T18:00:00Z", 17), // not in an interval → the shop's prep position; 15% exactly → on target
      b("p4", null, "2026-10-14T13:00:00Z", 20), // no maker: counted, never attributed
    ], ivs, "SHOP-PREP", D, etCalendarDate);
    expect(observations.map((o) => [o.sourceId, o.positionId, o.value, o.day])).toEqual([
      ["p1", "PREP-A", 1, "2026-10-14"], ["p2", "PREP-A", 0, "2026-10-14"], ["p3", "SHOP-PREP", 1, "2026-10-14"],
    ]);
    expect(noMaker).toBe(1);
    expect(unplaced.size).toBe(0);
    const none = prepYieldObservations([b("p5", U, "2026-10-14T18:00:00Z", 20)], [], null, D, etCalendarDate);
    expect(none.observations).toEqual([]);
    expect(none.unplaced.get(U)).toBe(1);
  });

  it("ONE maker × TWO sessions × TWO productions → exactly TWO observations", () => {
    const rows = [
      { id: "prod-1", itemId: "ham", producedAt: "2026-10-14T13:00:00Z", madeBy: U, batchesMade: 1, cameOutTo: 10, yieldAtTime: 10 },
      { id: "prod-2", itemId: "ham", producedAt: "2026-10-14T15:00:00Z", madeBy: U, batchesMade: 1, cameOutTo: 10, yieldAtTime: 10 },
    ];
    expect(prepYieldObservations(rows, [], "SHOP-PREP", D, etCalendarDate).observations).toHaveLength(2);
  });

  it("pmObservations: gradeValue by grade, weighted by observed minutes; two managers on one day → one quality day", () => {
    const o = pmObservations([
      { id: "g1", day: "2026-10-14", subjectId: U, positionId: POS, grade: "great", observedMinutes: 120 },
      { id: "g2", day: "2026-10-14", subjectId: U, positionId: POS, grade: "needs_work", observedMinutes: 40 },
    ], D);
    expect(o.map((x) => [x.value, x.weight])).toEqual([[1, 120], [0.2, 40]]);
    const r = skillFor(signalsFor(U, POS, AS_OF, new Map(), o), null, 0, D);
    expect(r.qualityDays).toBe(1);
    expect(r.perKind.pm!.mean).toBeCloseTo((120 * 1 + 40 * 0.2) / 160, 12);
  });
});
