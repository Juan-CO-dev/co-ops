/**
 * Scheduling Phase 1, Task 15 (r2 #3, J23) — PROPERTY TEST, finite outputs. No new dependency: a seeded
 * deterministic generator (mulberry32, fixed seeds, 2,000 cases) plus an exhaustive EDGE grid.
 *
 * For EVERY configuration the TS validator ACCEPTS: every numeric output is finite and in range, `band` is
 * one of the three, value = clamp(learned + adjustment, 0, 1), and confidence = 0 ⇔ qualityDays = 0.
 * Configurations the validator refuses are asserted refused (the same edges as the shared case file).
 */
import { describe, expect, it } from "vitest";
import { loadTunablesCases, materializeTunablesCase } from "../scripts/skill-tunables-cases.mjs";
import { QUALITY_KINDS, SKILL_BANDS, skillFor, skillWindowStart, type QualityObservation, type SkillResult } from "@/lib/people/skills-shared";
import { SKILL_TUNABLE_DEFAULTS as D, validSkillTunables, type SkillTunables } from "@/lib/people/tunables-shared";

const POS = "pos";
const AS_OF = "2026-10-15";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertSane(r: SkillResult, adjustment: number, label: string): void {
  const inUnit = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;
  const ok = inUnit(r.learned) && inUnit(r.value) && inUnit(r.confidence) && inUnit(r.prior)
    && Number.isFinite(r.adjustment)
    && [r.qualityDays, r.workedDays, r.minutesWorked].every((n) => Number.isInteger(n) && n >= 0)
    && QUALITY_KINDS.every((k) => r.perKind[k] === null || inUnit(r.perKind[k]!.mean))
    && SKILL_BANDS.includes(r.band)
    && ((r.confidence === 0) === (r.qualityDays === 0))
    && Math.abs(r.value - Math.min(1, Math.max(0, r.learned + adjustment))) < 1e-12;
  if (!ok) throw new Error(`not sane: ${label} → ${JSON.stringify(r)}`);
}

const day = (offset: number) => skillWindowStart(AS_OF, offset + 1); // offset 0 = AS_OF
const o = (kind: QualityObservation["kind"], dayOffset: number, value: number, weight: number, sourceId: string): QualityObservation =>
  ({ positionId: POS, day: day(dayOffset), kind, value, weight, sourceId });

/** The sparse evidence combinations of the edge grid. */
const OBSERVATION_SETS: Record<string, QualityObservation[]> = {
  empty: [],
  pmOnly: [o("pm", 1, 1, 60, "g1")],
  closeOnly: [o("closeOnTime", 2, 0, 1, "c1")],
  prepOnly: [o("prepYield", 3, 1, 1, "p1")],
  allSameDay: [o("pm", 4, 0.6, 30, "g"), o("closeOnTime", 4, 1, 1, "c"), o("prepYield", 4, 0, 1, "p")],
  disjointDays: [o("pm", 5, 0.2, 10, "g"), o("closeOnTime", 6, 1, 1, "c"), o("prepYield", 7, 1, 1, "p")],
  zeroMinutePm: [o("pm", 8, 1, 0, "g1"), o("pm", 9, 0, 0, "g2")],
  duplicateSourceIds: [o("closeOnTime", 1, 1, 1, "dup"), o("closeOnTime", 2, 0, 1, "dup"), o("pm", 1, 1, 5, "dup")],
  allOutsideWindow: [o("pm", 400, 1, 60, "old"), o("closeOnTime", -3, 1, 1, "future")],
};

describe("the edge grid: every accepted configuration × every sparse evidence combination is finite and in range", () => {
  it("weights over {0, 0.0001, 0.5, 1, 3}³ (sum > 0) × k × bands × prior × adjustment × gradeValue × evidence", () => {
    const W = [0, 0.0001, 0.5, 1, 3];
    const K = [0.0001, 1, 6, 60];
    const BANDS = [{ building: 0.0001, strong: 0.9999 }, { building: 0.7499, strong: 0.75 }, D.bands];
    const PRIORS = [0, 1, null];
    const ADJ = [-0.3, 0, 0.3];
    const GRADES = [{ great: 0.5, good: 0.5, needs_work: 0.5 }, { great: 0, good: 0, needs_work: 0 }, D.gradeValue];
    let accepted = 0, refused = 0, results = 0;
    for (const pm of W) for (const closeOnTime of W) for (const prepYield of W) {
      const weights = { pm, closeOnTime, prepYield };
      for (const priorStrength of K) for (const bands of BANDS) for (const gradeValue of GRADES) {
        const t: SkillTunables = { ...D, weights, priorStrength, bands, gradeValue };
        if (!validSkillTunables(t)) {
          refused++;
          expect(pm + closeOnTime + prepYield).toBe(0); // the only refusal on this grid: all weights 0
          continue;
        }
        accepted++;
        for (const prior of PRIORS) for (const adjustment of ADJ) for (const [name, observations] of Object.entries(OBSERVATION_SETS)) {
          const r = skillFor({ positionId: POS, asOf: AS_OF, worked: [{ positionId: POS, day: AS_OF, minutes: 0 }], observations }, prior, adjustment, t);
          assertSane(r, adjustment, `${JSON.stringify(weights)} k=${priorStrength} ${name}`);
          if (name === "empty" || name === "allOutsideWindow") expect(r.qualityDays).toBe(0);
          results++;
        }
      }
    }
    expect(refused).toBe(4 * 3 * 3); // the all-zero vector, once per (k, bands, gradeValue)
    expect(accepted).toBe(124 * 4 * 3 * 3);
    expect(results).toBe(accepted * 3 * 3 * Object.keys(OBSERVATION_SETS).length);
  });

  it("the shared case file's refused edges stay refused (the same file the SQL CHECK runs)", () => {
    for (const c of loadTunablesCases() as Array<{ name: string; valid: boolean }>) {
      expect(validSkillTunables(materializeTunablesCase(c)), c.name).toBe(c.valid);
    }
  });
});

describe("the seeded generator: 2,000 random configurations and evidence sets", () => {
  for (const seed of [20261015, 7, 424242, 9001]) {
    it(`seed ${seed}: 500 cases, every accepted configuration finite and in range`, () => {
      const rnd = mulberry32(seed);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
      const num = (lo: number, hi: number) => lo + rnd() * (hi - lo);
      let checked = 0;
      for (let i = 0; i < 500; i++) {
        const building = pick([0.0001, num(0.0001, 0.9), 0.5]);
        const t = {
          ...D,
          priorWhenNoRating: pick([0, 1, rnd()]),
          priorStrength: pick([0.0001, 60, num(0.0001, 60), 0]),
          weights: { pm: pick([0, 3, 1e300, rnd()]), closeOnTime: pick([0, rnd(), 5]), prepYield: pick([0, rnd(), -0.1]) },
          gradeValue: pick([{ great: 1, good: 0.6, needs_work: 0.2 }, { great: 0, good: 0, needs_work: 0 }, { great: 0.4, good: 0.6, needs_work: 0 }]),
          bands: { building, strong: pick([0.9999, building + 0.0001, building, 1]) },
          windowDays: pick([7, 90, 365]),
          minQualityDaysForLearned: pick([0, 3, 30]),
        };
        if (!validSkillTunables(t)) continue; // refused configurations are pinned by the case file
        const n = Math.floor(rnd() * 14);
        const observations: QualityObservation[] = Array.from({ length: n }, (_, j) => ({
          positionId: rnd() < 0.9 ? POS : "elsewhere",
          day: day(Math.floor(num(-5, 400))),
          kind: pick(QUALITY_KINDS),
          value: pick([0, 1, rnd(), rnd()]),
          weight: pick([0, 1, rnd() * 480, 1e300]),
          sourceId: `s${Math.floor(rnd() * (n + 1))}-${j % 3}`,
        }));
        const prior = pick([null, 0, 1, rnd()]);
        const adjustment = pick([-0.3, -0.05, 0, 0.1, 0.3]);
        const worked = Array.from({ length: Math.floor(rnd() * 5) }, () => ({ positionId: POS, day: day(Math.floor(num(0, 120))), minutes: rnd() * 600 }));
        const r = skillFor({ positionId: POS, asOf: AS_OF, worked, observations }, prior, adjustment, t);
        assertSane(r, adjustment, `seed ${seed} case ${i}`);
        checked++;
      }
      expect(checked).toBeGreaterThan(50);
    });
  }
});
