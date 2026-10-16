/**
 * Scheduling Phase 1, Task 14 (r2 #3) — the TS half of the ONE tunables rule set. The SAME case file
 * runs against the SQL CHECK in scripts/sql-harness-0270.mjs (pinned by tests/people-layer-migration.test.ts).
 */
import { describe, expect, it } from "vitest";
import { CASE_DEFAULTS, loadTunablesCases, materializeTunablesCase } from "../scripts/skill-tunables-cases.mjs";
import {
  SKILL_TUNABLE_DEFAULTS, canonicalTunables, resolveTunables, tunablesDigest, tunablesProblem, validSkillTunables,
  type SkillTunables,
} from "@/lib/people/tunables-shared";

interface TunablesCase { name: string; valid: boolean; problem?: string }
const cases = loadTunablesCases() as TunablesCase[];

describe("the shared tunables case file against validSkillTunables", () => {
  it("the case file's defaults ARE SKILL_TUNABLE_DEFAULTS (the SQL harness starts from the same set)", () => {
    expect(CASE_DEFAULTS).toEqual(SKILL_TUNABLE_DEFAULTS);
  });

  it("covers the ruled edges: k = 0, building = 0, strong = 1, building = strong, all-zero, negative, string, 3/1/1, a lone weight of 5, 1e308 ×3", () => {
    const names = cases.map((c) => c.name);
    for (const n of ["k = 0", "building = 0", "strong = 1", "building = strong", "all weights 0", "a negative weight", "a string number",
      "weights 3 / 1 / 1 (no per-weight cap)", "one weight above 1, the others 0", "three weights of 1e308 (the sum overflows a double)"]) {
      expect(names).toContain(n);
    }
  });

  for (const c of cases) {
    it(`${c.valid ? "accepts" : "refuses"}: ${c.name}`, () => {
      const value = materializeTunablesCase(c);
      expect(validSkillTunables(value)).toBe(c.valid);
      expect(tunablesProblem(value)).toBe(c.valid ? null : c.problem);
    });
  }
});

describe("resolveTunables, the digest", () => {
  const shop: SkillTunables = { ...SKILL_TUNABLE_DEFAULTS, priorStrength: 10 };
  const company: SkillTunables = { ...SKILL_TUNABLE_DEFAULTS, priorStrength: 8 };
  it("shop row, else company row, else the defaults; an invalid row is skipped", () => {
    expect(resolveTunables(company, shop).priorStrength).toBe(10);
    expect(resolveTunables(company, null).priorStrength).toBe(8);
    expect(resolveTunables(null, null)).toBe(SKILL_TUNABLE_DEFAULTS);
    expect(resolveTunables({ ...company, priorStrength: 0 }, { ...shop, windowDays: 1 })).toBe(SKILL_TUNABLE_DEFAULTS);
  });
  it("the defaults are deeply frozen", () => {
    expect(Object.isFrozen(SKILL_TUNABLE_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(SKILL_TUNABLE_DEFAULTS.weights)).toBe(true);
    expect(Object.isFrozen(SKILL_TUNABLE_DEFAULTS.bands)).toBe(true);
  });
  it("the digest is stable under key order and changes with any value", () => {
    const reordered = JSON.parse(JSON.stringify({ windowDays: 90, ...SKILL_TUNABLE_DEFAULTS })) as SkillTunables;
    expect(canonicalTunables(reordered)).toBe(canonicalTunables(SKILL_TUNABLE_DEFAULTS));
    expect(tunablesDigest(reordered)).toBe(tunablesDigest(SKILL_TUNABLE_DEFAULTS));
    expect(tunablesDigest(shop)).not.toBe(tunablesDigest(SKILL_TUNABLE_DEFAULTS));
    expect(tunablesDigest(SKILL_TUNABLE_DEFAULTS)).toMatch(/^[0-9a-f]{8}$/);
  });
});
