// Item 4 PR 1: the nightly par loop was MOVED into a pure module so the replay harness runs the very
// engine the shop runs. This pin proves the move changed nothing: the golden was produced by the loop's
// text at ba3e603c (before the move) over the same fixture. With no signal live, every row is byte-identical.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeParLedger, NIGHTLY_HORIZON_WALK_MINUTES } from "@/lib/dynamic-pars-engine-shared";
import { buildParInputs, type FixtureOptions } from "./helpers/par-engine-fixture";

const golden = JSON.parse(readFileSync("tests/fixtures/demand-signals/par-engine-golden.json", "utf8")) as { cases: Record<string, unknown[]> };
const CASES: Record<string, FixtureOptions> = { base: {}, later: { runDate: "2026-10-19", seed: 7 }, scaled: { scale: 1.6, seed: 99 } };

describe("par engine extraction: byte-identical to the pre-move nightly loop", () => {
  for (const [name, o] of Object.entries(CASES)) {
    for (const mode of ["shadow", "live"] as const) {
      it(`${name} / ${mode}`, () => {
        const rows = computeParLedger(buildParInputs(o), mode);
        expect(JSON.stringify(rows)).toBe(JSON.stringify(golden.cases[`${name}:${mode}`]));
      });
    }
  }
  it("covers the branches that matter", () => {
    const seen = new Set<string>();
    for (const rows of Object.values(golden.cases)) for (const r of rows as Array<{ reason_code: string; suppressed_by: string | null; outcome: string; detail: { floored_by_peak?: boolean; velocity_applied?: boolean } }>) {
      seen.add(r.reason_code); if (r.suppressed_by) seen.add(`by:${r.suppressed_by}`); seen.add(`out:${r.outcome}`);
      if (r.detail.floored_by_peak) seen.add("floor"); if (r.detail.velocity_applied) seen.add("velocity");
    }
    for (const want of ["ok", "inventory_only", "product_retired", "no_weight_basis", "unresolvable_pack", "thin_history", "no_vendor_rhythm",
      "slot_creation", "pinned", "budget_spent", "par_unit_suspect", "zero_target", "no_lane_start", "below_band_resolution",
      "by:band", "by:hysteresis", "by:pin", "by:budget", "out:would_apply", "out:applied", "floor", "velocity"]) expect(seen, want).toContain(want);
  });
  it("the nightly horizon constant did not move", () => { expect(NIGHTLY_HORIZON_WALK_MINUTES).toBe(0); });
  it("the server module runs the extracted engine and no second copy of the loop", () => {
    const src = readFileSync("lib/dynamic-pars.ts", "utf8");
    expect(src).toContain("computeParLedger(inputs, mode)");
    expect(src).not.toContain("computeBaseRate(");
    expect(src).not.toContain("applyGuardStack(");
  });
});
