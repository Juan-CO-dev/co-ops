/**
 * Lock-up gate hardening (2026-07-31, council P1). The C.26 invariant — "only a
 * key holder (level ≥ 4) locks up, and Walk-Out Verification is the finalize
 * signal" — was client-side only; confirmInstance now enforces it server-side
 * for closing templates via the pure evaluateLockUpGate predicate. These tests
 * pin the load-bearing constants AND the gate logic itself (adversarial C1).
 */
import { describe, it, expect } from "vitest";
import { WALK_OUT_VERIFICATION_STATION, evaluateLockUpGate } from "@/lib/checklist-constants";
import { CLOSING_CONFIRM_FLOOR_LEVEL } from "@/lib/admin/template-builder-shared";

const WO = WALK_OUT_VERIFICATION_STATION;
const done = (...ids: string[]) => new Set(ids);
/** A closing template with two Walk-Out items + one ordinary item. */
const closingItems = () => [
  { id: "wo1", station: WO },
  { id: "wo2", station: WO },
  { id: "misc", station: "General" },
];

describe("finalize gate invariants", () => {
  it("the key-holder floor is level 4 (KH+)", () => {
    expect(CLOSING_CONFIRM_FLOOR_LEVEL).toBe(4);
  });

  it("the Walk-Out station system-key is the shared, single-source value", () => {
    // Server (confirmInstance) + client (closing-client) both import THIS —
    // the constant they gate on can no longer drift.
    expect(WALK_OUT_VERIFICATION_STATION).toBe("Walk-Out Verification");
  });
});

describe("evaluateLockUpGate — the closing lock-up logic (adversarial C1 coverage)", () => {
  const FLOOR = CLOSING_CONFIRM_FLOOR_LEVEL;

  it("a key holder with Walk-Out complete passes", () => {
    const r = evaluateLockUpGate({ templateType: "closing", actorLevel: 4, floorLevel: FLOOR, items: closingItems(), completedItemIds: done("wo1", "wo2") });
    expect(r.ok).toBe(true);
  });

  it("THE BYPASS PIN: a level-3 completer is blocked (reason=role) even with Walk-Out done", () => {
    const r = evaluateLockUpGate({ templateType: "closing", actorLevel: 3, floorLevel: FLOOR, items: closingItems(), completedItemIds: done("wo1", "wo2") });
    expect(r).toEqual({ ok: false, reason: "role" });
  });

  it("a key holder with an incomplete Walk-Out item is blocked (reason=walk_out) + names the item", () => {
    const r = evaluateLockUpGate({ templateType: "closing", actorLevel: 5, floorLevel: FLOOR, items: closingItems(), completedItemIds: done("wo1") });
    expect(r).toEqual({ ok: false, reason: "walk_out", incompleteItemIds: ["wo2"] });
  });

  it("role is checked BEFORE walk-out (a non-KH with incomplete walk-out fails on role)", () => {
    const r = evaluateLockUpGate({ templateType: "closing", actorLevel: 3, floorLevel: FLOOR, items: closingItems(), completedItemIds: done() });
    expect(r).toEqual({ ok: false, reason: "role" });
  });

  it("a closing template with NO Walk-Out station does not brick (KH passes; empty station skipped)", () => {
    const r = evaluateLockUpGate({ templateType: "closing", actorLevel: 4, floorLevel: FLOOR, items: [{ id: "misc", station: "General" }], completedItemIds: done() });
    expect(r.ok).toBe(true);
  });

  it("non-closing templates always pass (opening/prep finalize via their own paths)", () => {
    for (const t of ["opening", "am_prep", "mid_day_prep", "deep_cleaning", ""]) {
      const r = evaluateLockUpGate({ templateType: t, actorLevel: 1, floorLevel: FLOOR, items: closingItems(), completedItemIds: done() });
      expect(r.ok).toBe(true);
    }
  });
});
