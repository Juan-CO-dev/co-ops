/**
 * Fulledit PR-2 — the answer law (migration 0165).
 *
 * Two pure functions carry the council's guardrail and must always agree:
 * validateAnswerForInputType (the write gate — what an answer must look like)
 * and interpretAnswer (the read gate — what a stored answer means). The pin
 * that matters most: count_value 0 on a yes_no line is a RECORDED NO, never
 * "unanswered" — conflating those was the failure mode the council rejected.
 */
import { describe, it, expect } from "vitest";
import { validateAnswerForInputType } from "@/lib/checklists";
import { interpretAnswer } from "@/lib/checklist-answers";

describe("validateAnswerForInputType — the write gate", () => {
  it("yes_no accepts exactly 0 and 1", () => {
    expect(validateAnswerForInputType("yes_no", 1, null)).toBeNull();
    expect(validateAnswerForInputType("yes_no", 0, null)).toBeNull();
  });

  it("yes_no rejects null/undefined/other numbers", () => {
    expect(validateAnswerForInputType("yes_no", null, null)).not.toBeNull();
    expect(validateAnswerForInputType("yes_no", undefined, null)).not.toBeNull();
    expect(validateAnswerForInputType("yes_no", 2, null)).not.toBeNull();
  });

  it("free_text requires non-empty trimmed notes", () => {
    expect(validateAnswerForInputType("free_text", null, "Walk-in at 38F")).toBeNull();
    expect(validateAnswerForInputType("free_text", null, "")).not.toBeNull();
    expect(validateAnswerForInputType("free_text", null, "   ")).not.toBeNull();
    expect(validateAnswerForInputType("free_text", null, null)).not.toBeNull();
  });

  it("legacy NULL input_type constrains nothing here", () => {
    expect(validateAnswerForInputType(null, null, null)).toBeNull();
    expect(validateAnswerForInputType(null, 5, "note")).toBeNull();
  });
});

describe("interpretAnswer — the read gate", () => {
  const completion = (over: { countValue?: number | null; notes?: string | null }) =>
    ({ countValue: over.countValue ?? null, notes: over.notes ?? null });

  it("THE NO PIN: count_value 0 on a yes_no line is a recorded NO, not unanswered", () => {
    const r = interpretAnswer({ inputType: "yes_no", expectsCount: false }, completion({ countValue: 0 }));
    expect(r).toEqual({ kind: "no", value: null });
  });

  it("count_value 1 on a yes_no line is YES", () => {
    const r = interpretAnswer({ inputType: "yes_no", expectsCount: false }, completion({ countValue: 1 }));
    expect(r).toEqual({ kind: "yes", value: null });
  });

  it("an out-of-contract yes_no row degrades to a tick, never a lie", () => {
    const r = interpretAnswer({ inputType: "yes_no", expectsCount: false }, completion({ countValue: null }));
    expect(r).toEqual({ kind: "tick", value: null });
  });

  it("free_text renders the notes as the answer", () => {
    const r = interpretAnswer({ inputType: "free_text", expectsCount: false }, completion({ notes: "All clear" }));
    expect(r).toEqual({ kind: "text", value: "All clear" });
  });

  it("legacy count and tick lines are unchanged", () => {
    expect(interpretAnswer({ inputType: null, expectsCount: true }, completion({ countValue: 7 })))
      .toEqual({ kind: "count", value: 7 });
    expect(interpretAnswer({ inputType: null, expectsCount: false }, completion({})))
      .toEqual({ kind: "tick", value: null });
  });

  it("no completion → null (unanswered)", () => {
    expect(interpretAnswer({ inputType: "yes_no", expectsCount: false }, null)).toBeNull();
  });
});
