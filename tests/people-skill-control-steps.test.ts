/**
 * CC ruling 2 on chunk E: a numeric delta like 0.149 is REFUSED, never rounded — so the adjust and rate
 * controls must offer ONLY values the RPC accepts. Walk every value the stepper can reach, from both ends
 * and from off-grid starts, and prove each passes the same validators the lib and the 0270 RPCs apply.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SKILL_ADJUSTMENT_LIMIT, snapSkillStep, stepSkillControl, validAdjustmentDelta, validSkillRating,
} from "@/lib/people/skills-shared";

function reachable(start: number, min: number, max: number): number[] {
  const seen = new Set<number>([snapSkillStep(start, min, max)]);
  const queue = [...seen];
  while (queue.length) {
    const v = queue.shift()!;
    for (const dir of [1, -1] as const) {
      const n = stepSkillControl(v, dir, min, max);
      if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  return [...seen].sort((a, b) => a - b);
}

describe("the skill control offers only valid steps", () => {
  const adjust = { min: -SKILL_ADJUSTMENT_LIMIT, max: SKILL_ADJUSTMENT_LIMIT, valid: validAdjustmentDelta, n: 13 };
  const rate = { min: 0, max: 1, valid: validSkillRating, n: 21 };
  for (const [name, r] of [["adjust (±0.30)", adjust], ["rate (0..1)", rate]] as const) {
    it(`${name}: every reachable value from every start is accepted, and every valid value is reachable`, () => {
      for (const start of [r.min, r.max, 0, 0.149, 0.151, 0.63, -0.27, 0.1 + 0.2, 1.2, -1, Number.NaN]) {
        const values = reachable(start, r.min, r.max);
        for (const v of values) expect(r.valid(v), `${name} from ${start}: ${v}`).toBe(true);
        expect(values).toHaveLength(r.n);
      }
    });
    it(`${name}: + and − clamp at the ends and never leave the grid`, () => {
      expect(stepSkillControl(r.max, 1, r.min, r.max)).toBe(r.max);
      expect(stepSkillControl(r.min, -1, r.min, r.max)).toBe(r.min);
      expect(stepSkillControl(0.149, 1, r.min, r.max)).toBe(0.2);
      expect(snapSkillStep(0.149, r.min, r.max)).toBe(0.15);
    });
  }
  it("0.1 + 0.2 lands on 0.3 exactly (no 0.30000000000000004 reaches the RPC)", () => {
    expect(stepSkillControl(0.25, 1, -0.3, 0.3)).toBe(0.3);
    expect(stepSkillControl(0.1, 1, -0.3, 0.3) + 0).toBe(0.15);
  });
  it("the SkillsSection control steps ONLY through the pure stepper", () => {
    const src = readFileSync("components/people/SkillsSection.tsx", "utf8");
    expect(src).toContain("useState(() => snapSkillStep(initial, min, max))");
    expect(src).toContain("setDraft((d) => stepSkillControl(d, dir, min, max))");
    expect(src).not.toContain("SKILL_ADJUSTMENT_STEP");
  });
});
