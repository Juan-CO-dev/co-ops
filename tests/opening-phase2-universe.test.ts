/**
 * W15/B085: a mirror added to today's opening after its Phase 1 snapshot had no Phase 1 row,
 * so it could never be saved and the opening could never be finalized. Once Phase 1 is
 * submitted, Phase 2 lists only items with a live Phase 1 row on THIS instance (owner
 * decision W15-2 a: the new line starts with tomorrow's opening). The SQL half is 0320 §D.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { inPhase2Universe, phase1ItemIds } from "@/lib/opening-phase2-universe-shared";

const completions = [
  { templateItemId: "tuna", prepData: { phase1: { prep_need: 2 } } },
  { templateItemId: "tuna", prepData: { phase2: { opener_prepped: 2 } } },
  { templateItemId: "bacon", prepData: { phase2: { opener_prepped: 1 } } },
  { templateItemId: "slicer", prepData: null },
];

describe("W15/B085 the Phase 2 universe is frozen at this instance's Phase 1", () => {
  it("a mirror with no Phase 1 row on this instance is not in today's Phase 2", () => {
    const ids = phase1ItemIds(completions);
    expect(inPhase2Universe("late-mirror", true, ids)).toBe(false);
    expect(inPhase2Universe("bacon", true, ids)).toBe(false); // a phase2 row alone is not a Phase 1 row
  });
  it("every mirror with a live Phase 1 row is", () => {
    expect(inPhase2Universe("tuna", true, phase1ItemIds(completions))).toBe(true);
  });
  it("before Phase 1 is submitted nothing changes", () => {
    expect(inPhase2Universe("late-mirror", false, phase1ItemIds([]))).toBe(true);
  });
  it("the opening screen builds its Phase 2 list with the rule", () => {
    const src = readFileSync("app/(authed)/operations/opening/opening-client.tsx", "utf8");
    expect(src).toMatch(/if \(isOpeningPhase2 && inPhase2Universe\(it\.id, phase1Submitted, phase1Ids\)\) p2\.push\(it\);/);
  });
});
