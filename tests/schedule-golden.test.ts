/**
 * Scheduling Phase 2, Task 8 — THE GENERATOR GOLDENS. Every fixture in `FIXTURES` builds; the output
 * `{shifts, days, gaps, reasons, notes, stats}` is compared byte-for-byte to tests/fixtures/schedule/
 * golden-<name>.json. Each golden is asserted VALIDATOR-CLEAN first (zero new error-class problems,
 * every gap certified), and the constrained fixtures (F0a–F0j) are asserted on their causes before the
 * byte comparison. Regenerate ONLY with a written reason in the PR, and bump GENERATOR_VERSION:
 *   UPDATE_SCHEDULE_GOLDEN=1 npx vitest run tests/schedule-golden.test.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GENERATOR_VERSION, buildWeek, type GeneratorOutput } from "@/lib/scheduling/generator/build-shared";
import { canonicalJson } from "@/lib/scheduling/context-shared";
import { approvalRefusal, checkScheduleRules } from "@/lib/scheduling/rules-shared";
import { DATES, F10_IDS, FIXTURES, I } from "./fixtures/schedule/fixtures";

const DIR = path.resolve(__dirname, "fixtures/schedule");
const HEADER = `Generator golden ${GENERATOR_VERSION}. Regenerate ONLY with a written reason in the PR, and bump GENERATOR_VERSION.`;

function clean(out: GeneratorOutput): void {
  const errors = out.problems.filter((p) => p.severity === "error" && !p.inherited);
  expect(errors, JSON.stringify(errors.slice(0, 3))).toEqual([]);
  // Every declared gap on a BUILT day is seen by the validator as a certified gap at its start (inherited days are never re-judged).
  const inherited = new Set(out.days.filter((d) => d.inherited).map((d) => d.date));
  for (const g of out.gaps.filter((x) => !inherited.has(x.date))) {
    expect(out.problems.some((p) => p.day === g.date && p.severity === "gap" && p.code === g.code && p.q === g.fromQ), `${g.date} ${g.code} ${g.fromQ}`).toBe(true);
  }
  // And re-validating the output reproduces its problem list.
  const again = checkScheduleRules({ locationId: out.context.locationId, weekStart: out.context.weekStart, shifts: out.shifts, gaps: out.gaps, days: out.days }, out.context);
  expect(canonicalJson(again)).toBe(canonicalJson(out.problems));
}

/** The shaped NEED per hour (the F10 numbers live in the need grid; the 4 h minimum then staffs whole blocks around it). */
const perHour = (out: GeneratorOutput, date: string) => [44, 48, 52, 56].map((q) => out.context.days[date]!.need.lineTotal[q]);
/** Scheduled heads cover the need at every quarter of every position (no gaps). */
const covers = (out: GeneratorOutput, date: string) => {
  const day = out.context.days[date]!;
  for (const [id, need] of Object.entries(day.need.positions)) for (let q = 0; q < 96; q++) {
    const on = out.shifts.filter((x) => x.date === date).reduce((n, sh) => n + sh.segments.filter((g) => g.positionId === id && g.startQ <= q && g.endQ > q).length, 0);
    expect(on, `${date} ${id}@${q}`).toBeGreaterThanOrEqual(need[q]!);
  }
};

/** The per-fixture assertions beyond the bytes. */
const ASSERT: Record<string, (out: GeneratorOutput) => void> = {
  "F0a-infeasible-structure": (out) => {
    expect(out.gaps.some((g) => g.cause === "structure" && g.certificate.rule === "primary_window_closed")).toBe(true);
    expect(out.gaps.some((g) => g.cause === "structure" && g.certificate.rule === "no_mod_member")).toBe(true);
  },
  "F0b-tight-budget-zero": (out) => {
    expect(out.gaps.length).toBeGreaterThan(0); expect(out.gaps.every((g) => g.cause === "budget_limited")).toBe(true); expect(out.shifts.some((x) => x.closingManager)).toBe(true);
    // CC chunk C ruling 3: the essential closer hours at budget 0 are correct, provided the note shows them.
    expect(out.notes).toContainEqual({ code: "essential_past_budget", date: null, userId: null, positionId: null, params: { hours: out.stats.essentialHours, budgetHours: 0 } });
  },
  "F0b-tight-budget-essential-plus-6": (out) => {
    expect(out.gaps.every((g) => g.cause === "budget_limited")).toBe(true); expect(out.stats.hourlyHours - out.stats.essentialHours).toBeLessThanOrEqual(22);
    // p2.19 KNOWN COST of primary-first (CC ruling 2026-10-20): Gus's Register primary is a budgeted block where the closer Hal
    // used to cover Register at no budget cost, so the budget-limited gap is 18 quarters (p2.17: 12). Pinned both ways — a fix
    // (the closer re-shape move, docs/ROADMAP.md) shows up as a deliberate improvement; anything worse fails.
    expect(out.gaps.map((g) => [g.date, g.positionId, g.fromQ, g.toQ, g.cause])).toEqual([[DATES[0], I.$BOI, 38, 56, "budget_limited"]]);
  },
  "F0c-no-eligible": (out) => expect(out.gaps.filter((g) => g.positionId === I.$DISH).map((g) => g.cause)).toEqual(["eligibility"]),
  "F0d-floor-capped": (out) => {
    // The fixture's point stands: Sunday's GM-only Expo is certified floor_limit. p2.19 (accepted, CC ruling 2026-10-20): one
    // more Approve-blocking gap by count (6 vs 5) while uncovered time FALLS 165 → 113 quarters.
    const f = out.gaps.filter((g) => g.positionId === I.$EXPO);
    expect(f.some((g) => g.date === DATES[6] && g.cause === "floor_limit")).toBe(true);
    expect(out.gaps.reduce((n, g) => n + g.toQ - g.fromQ, 0)).toBeLessThanOrEqual(113);
  },
  // p2.19: Sam's Register PRIMARY puts him on the Register close in the fill, so the repair this fixture once needed is not
  // needed — no gap, no chain (the chain itself is pinned by F0i / F0j and the repair (a) variant in the generator tests).
  "F0e-repair-needed": (out) => { expect(out.gaps).toEqual([]); },
  "F0f-all-unproven": (out) => {
    // p2.19 KNOWN COST of primary-first (CC ruling 2026-10-20): one Approve-blocking 12-quarter Sunday Walk-ins gap the bounded
    // repair cannot close — the people who could cover Sunday are at their 5-day cap after Gus's Register / Expo week (a
    // cross-day day-off swap would fix it; docs/ROADMAP.md). Pinned both ways.
    expect(out.gaps.filter((g) => !["structure", "eligibility", "availability"].includes(g.cause)).map((g) => [g.date, g.code, g.positionId, g.fromQ, g.toQ, g.cause]))
      .toEqual([[DATES[6], "coverage_gap", I.$WALK, 44, 56, "unresolved_search"]]);
  },
  "F0g-history": (out) => { expect(out.days.find((d) => d.date === DATES[0]!)).toMatchObject({ inherited: true, originRevisionId: "rev-1" }); expect(out.shifts.filter((x) => x.userId === "u-x-gone" && x.date !== DATES[0]!)).toEqual([]); },
  "F0h-insufficient-capacity": (out) => expect(out.gaps).toMatchObject([{ cause: "capacity", certificate: { requiredHeads: 2, people: 1, shortBy: 1 } }]),
  "F0i-fourth-donor": (out) => { expect(out.gaps).toEqual([]); expect(out.stats.repair.donorsTried).toBeGreaterThanOrEqual(4); },
  "F0j-long-chain": (out) => { expect(out.gaps).toEqual([]); expect(out.stats.repair.chainDepth).toBe(3); },
  "F0j-four-links": (out) => expect(out.gaps).toMatchObject([{ cause: "unresolved_search", certificate: { searched: { chainDepth: 3 } } }]),
  "F1-mockup-v17": (out) => {
    // The Closing Manager is a Key Holder every day, never an opens-only leader (the v17 Dani bug, pinned).
    const cms = out.shifts.filter((x) => x.closingManager);
    expect(cms.length).toBe(7);
    expect(cms.every((x) => ["u-06-iris", "u-10-nora"].includes(x.userId))).toBe(true);
    expect(out.shifts.filter((x) => x.userId === "u-05-dani" && x.closingManager)).toEqual([]);
  },
  "F5-priority-flipped": (out) => { for (const d of DATES) expect(out.shifts.some((x) => x.date === d && x.segments.some((g) => g.positionId === I.$WALK && g.endQ >= 80))).toBe(true); },
  "F8-partial-month": (out) => expect(out.days.filter((d) => d.inherited).map((d) => d.date)).toEqual([DATES[0], DATES[1], DATES[6]]),
  "F9-edited-head": (out) => { expect(out.shifts.filter((x) => x.date === DATES[0]!)).toHaveLength(1); expect(out.days[0]).toMatchObject({ inherited: true, originRevisionId: "rev-edit" }); },
  "F10-shifted-peaks": (out) => {
    expect(perHour(out, DATES[0]!)).toEqual([2, 4, 2, 2]);
    expect(perHour(out, DATES[1]!)).toEqual([2, 2, 4, 2]);
    expect(perHour(out, DATES[2]!)).toEqual([2, 3, 3, 2]);
    for (const d of DATES.slice(0, 3)) covers(out, d);
    expect(out.gaps).toEqual([]);
    // With a 4 h window and a 4 h minimum every block is 11:00–15:00: the shape lives in the need grid (asserted above). Day A's
    // peak hour asks 4 heads (both secondaries), the flat day's 3 (one secondary): the staffing follows the shape's heads.
    const secondaries = (d: string) => out.shifts.filter((x) => x.date === d && [F10_IDS.WK, F10_IDS.EX].includes(x.segments[0]!.positionId)).length;
    expect([secondaries(DATES[0]!), secondaries(DATES[1]!), secondaries(DATES[2]!)]).toEqual([2, 2, 1]);
  },
  "F14-zero-demand": (out) => { expect(perHour(out, DATES[0]!)).toEqual([2, 2, 2, 2]); covers(out, DATES[0]!); expect(out.notes.some((n) => n.code === "zero_demand")).toBe(true); },
  "F15-zero-profile": (out) => { expect(perHour(out, DATES[0]!)).toEqual([1, 1, 1, 1]); covers(out, DATES[0]!); expect(out.notes.some((n) => n.code === "zero_profile")).toBe(true); },
  "F11-budget-week-then-month": (out) => { expect(out.stats.budgetedDates).toEqual(DATES); expect(out.stats.budgetHours).toBe(60 * 6 + 48); expect(out.notes.filter((n) => n.code === "unbudgeted_date")).toEqual([]); },
  "F13-budget-partial-week": (out) => { expect(out.stats.budgetedDates).toEqual(DATES.slice(0, 6)); expect(out.notes.filter((n) => n.code === "unbudgeted_date").map((n) => n.date)).toEqual([DATES[6]]); },
  "F17-inherited-unresolved": (out) => {
    const sunday = DATES[6]!;
    expect(out.gaps.filter((g) => g.date === sunday)).toMatchObject([{ cause: "unresolved_search" }]);
    expect(out.days.find((d) => d.date === sunday)).toMatchObject({ inherited: true, originRevisionId: "rev-prev" });
    expect(approvalRefusal({ locationId: out.context.locationId, weekStart: out.context.weekStart, shifts: out.shifts, gaps: out.gaps, days: out.days }, out.problems)).toBe("unresolved_gaps");
  },
};

describe("the generator goldens (validator-clean by construction)", () => {
  for (const name of Object.keys(FIXTURES).sort()) {
    it(`${name}`, () => {
      const out = buildWeek(FIXTURES[name]!());
      clean(out);
      ASSERT[name]?.(out);
      const golden = { _header: HEADER, shifts: out.shifts, days: out.days, gaps: out.gaps, reasons: out.reasons, notes: out.notes, stats: out.stats };
      const file = path.join(DIR, `golden-${name}.json`);
      const text = JSON.stringify(JSON.parse(canonicalJson(golden)), null, 1) + "\n";
      if (process.env.UPDATE_SCHEDULE_GOLDEN === "1") { mkdirSync(DIR, { recursive: true }); writeFileSync(file, text); }
      expect(existsSync(file), `missing ${file}: run with UPDATE_SCHEDULE_GOLDEN=1 and a written reason`).toBe(true);
      expect(text).toBe(readFileSync(file, "utf8"));
    });
  }
});
